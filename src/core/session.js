/**
 * B 账号会话：Cookie 取用、发送策略探测、wbi 密钥获取、身份自检。
 *
 * 取值入口只有两个，其余模块一律走这里 —— 账号池化之后 Cookie 有多个来源
 * （池内借用源、页面自身、旧版遗留键），分散取值必然会漏掉「切号后拿到旧号 Cookie」这类错。
 */
import { STRATEGIES } from '../config.js';
import { store } from './store.js';
import { sanitizeCookie, parseCookie, backfillDeviceCookies, validateCookie, cookieFingerprint } from './cookie.js';
import { httpRequest, parseJsonSafe } from './transport.js';
import { extractWbiKeys } from './wbi.js';
import { extractMidFromNav, extractVipFromNav } from './patch.js';
import { log } from './log.js';
import { borrowCookie, borrowAccountId, activeAccount, byId, markProbed, needsProbe, addAccount } from './accounts.js';

const NAV_URL = 'https://api.bilibili.com/x/web-interface/nav';
const WBI_URL = 'https://api.bilibili.com/x/web-interface/wbi/img';

let cachedFingerprint = null;
let cachedFingerprintFor = '';

/**
 * 当前生效的 Cookie（含设备 Cookie 补齐）。
 *
 * 来源优先级：账号池里的借用源 → 旧版遗留的 b.cookie。
 * 前者是唯一正常的路径，后者只是迁移期的兜底。
 */
export function getEffectiveCookie() {
  const raw = borrowCookie() || store.getLegacyCookie();
  if (!raw) return '';
  const filled = backfillDeviceCookies(raw, document.cookie || '');
  // 指纹跟着实际来源走，否则切号后仍会返回上一个账号的指纹，缓存判断就全错了
  const src = borrowAccountId() || 'legacy';
  if (cachedFingerprint === null || cachedFingerprintFor !== src) {
    cachedFingerprint = cookieFingerprint(raw);
    cachedFingerprintFor = src;
  }
  return filled;
}

export function hasCookie() {
  return !!(borrowCookie() || store.getLegacyCookie());
}

/** 用户是否真的配置了有效 Cookie（UI 用来给明确提示，而不是等到播放才失败） */
export function cookieProblem() {
  const raw = borrowCookie() || store.getLegacyCookie();
  if (!raw) return '账号池为空，且没有旧的单账号设置';
  const v = validateCookie(sanitizeCookie(raw));
  return v.ok ? '' : v.problems.join('；');
}

/** 借用源的 bili_jct（番剧 OGV 接口的 csrf） */
export function getBCsrf() {
  const p = parseCookie(getEffectiveCookie());
  return p.bili_jct || p['bili-jct'] || '';
}

export function fingerprint() {
  if (cachedFingerprint === null) getEffectiveCookie();
  return cachedFingerprint;
}

/* ------------------------------------------------------------------ *
 * wbi 密钥
 * ------------------------------------------------------------------ */
let mixinKeyPromise = null;

function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 拿 mixinKey（用于 wbi 签名）。
 *
 * 实测：`/x/web-interface/wbi/img` 现在返回 404，该端点已下线；
 * 密钥的真实来源是 `/x/web-interface/nav` 响应里的 `data.wbi_img`。
 * 所以这里以 nav 为主源，旧的 img 端点仅作为兜底（万一将来 nav 形状再变）。
 * 结果按天缓存 —— wbi 密钥每天轮换，且**全池共用**（与账号无关）。
 *
 * 注意：拿不到密钥时代理会自动退回「不抬高参数」的原始请求，
 *      所以这条链路失败的影响是「画质不升级」而不是「无法播放」。
 *
 * @returns {Promise<string|null>}
 */
export function ensureMixinKey() {
  const cached = store.getMixinKey();
  if (cached && cached.date === today() && cached.mixinKey) return Promise.resolve(cached.mixinKey);

  if (mixinKeyPromise) return mixinKeyPromise;

  mixinKeyPromise = httpRequest({
    method: 'GET',
    url: NAV_URL,
    headers: { Referer: 'https://www.bilibili.com/' },
    timeout: 10000,
    cookie: getEffectiveCookie() || undefined
  })
    .then((res) => {
      const json = parseJsonSafe(res.text);
      const keys = json && extractWbiKeys(json);
      if (keys) return saveKeys(keys, 'nav');
      log.warn('nav 未取到 wbi 密钥，尝试旧端点兜底');
      return fetchWbiImgEndpoint();
    })
    .catch((e) => {
      log.warn('获取 wbi 密钥异常：', e && e.message);
      return fetchWbiImgEndpoint();
    })
    .finally(() => {
      mixinKeyPromise = null;
    });

  return mixinKeyPromise;
}

function saveKeys(keys, via) {
  store.setMixinKey({ date: today(), mixinKey: keys.mixinKey, imgKey: keys.imgKey, subKey: keys.subKey });
  log.debug('wbi 密钥已更新（来源 ' + via + '）', keys.imgKey, keys.subKey);
  return keys.mixinKey;
}

/** 旧端点兜底（当前线上已 404，留着是为了形态再变时不至于彻底失联） */
async function fetchWbiImgEndpoint() {
  const res = await httpRequest({
    method: 'GET',
    url: WBI_URL,
    headers: { Referer: 'https://www.bilibili.com/' },
    timeout: 8000,
    cookie: getEffectiveCookie() || undefined
  });
  const keys = extractWbiKeys(parseJsonSafe(res.text));
  if (!keys) {
    log.warn('wbi 密钥获取失败（nav=' + (!res.ok ? 'fail' : 'no-keys') + '，img端点=' + (res.ok ? 'no-keys' : 'http' + res.status) + '）。本次请求不抬高画质参数。');
    return null;
  }
  return saveKeys(keys, 'wbi/img');
}

// 这里原本有个 mixinKeyStatus()（「面板提示画质为什么没升级」用）。
// 它从没被调用过 —— 面板后来改成在日志与诊断里直接报 wbi 相关的回退，不走这个函数。留着只是个没接线的承诺。

/** 强制下次重新拉取（用户点了「重新探测」） */
export function invalidateMixinKey() {
  store.setMixinKey(null);
}

/* ------------------------------------------------------------------ *
 * 身份探测
 * ------------------------------------------------------------------ */

/**
 * 用一个 Cookie 验证身份，并把结果并入账号池。
 *
 * 探测成功时：若这个 Cookie 已经在池里（指纹相同），就地更新该条目的
 * uname / vipStatus / checkedAt；若不在池里，先收编再标记 —— 这样
 * 「粘贴 → 保存并验证」与「重探」两条路径的副作用是一致的。
 *
 * @param {string} cookie 要测试的 Cookie；不传则用当前借用源
 * @param {{adopt?:boolean}} opts adopt=false 时不把 Cookie 收进池子（纯验证）
 * @returns {Promise<{ok:boolean, reason:string, account?:object, aAccount?:object, strategy?:number, id?:string}>}
 */
export async function probeIdentity(cookie, opts = {}) {
  const adopt = opts.adopt !== false;
  const raw = sanitizeCookie(cookie || borrowCookie() || store.getLegacyCookie());
  if (!raw) return { ok: false, reason: '尚未填写账号 Cookie' };

  const check = validateCookie(raw);
  if (!check.ok) return { ok: false, reason: 'Cookie 不完整：' + check.problems.join('；') };

  // 对照组：使用浏览器当前 Cookie（即页面真实登录的那个号）
  const aRes = await httpRequest({
    method: 'GET',
    url: NAV_URL,
    headers: { Referer: 'https://www.bilibili.com/' },
    timeout: 10000
  });
  const aAccount = aRes.ok ? extractMidFromNav(aRes.text) : { mid: '', uname: '', face: '' };

  /*
   * 「返回的还是页面那个号」本来是判据：说明这一种发送方式没把待测 Cookie 送出去。
   *
   * 但导入当前登录账号时，待测 Cookie 恰恰就是页面那个号的 Cookie ——
   * mid 相同是正确结果，不是串号。
   * 判定「是否正是当前浏览器账号」：
   *   1. 读到 document.cookie 里的 SESSDATA 且与待测相同（部分环境可读）；
   *   2. 待测 Cookie 里的 DedeUserID 明确等于当前浏览器账号的 mid（常规真实浏览器：
   *      SESSDATA 是 HttpOnly 读不到，但用户粘贴的 Cookie 里有 DedeUserID，
   *      既然用户粘贴的就是当前号，服务端返回该 mid 属正常）。
   * 只有在「待测 Cookie 是另一个号（DedeUserID 不同），但服务端仍返回页面的号」时，
   * 才是真的没送出去（串号）。
   */
  const parsedRaw = parseCookie(raw);
  const isSameAsBrowser =
    (!!parsedRaw.SESSDATA && parsedRaw.SESSDATA === browserSessdata()) ||
    (!!parsedRaw.DedeUserID && !!aAccount.mid && String(parsedRaw.DedeUserID) === String(aAccount.mid));

  let sawALeak = false;
  for (let i = 0; i < STRATEGIES.length; i++) {
    const res = await httpRequest({
      method: 'GET',
      url: NAV_URL,
      headers: { Referer: 'https://www.bilibili.com/' },
      timeout: 10000,
      cookie: raw,
      strategyIdx: i
    });
    if (!res.ok) continue;
    const json = parseJsonSafe(res.text);
    if (!json || json.code !== 0 || !json.data) continue;

    const mid = String(json.data.mid ?? '');
    if (aAccount.mid && mid === aAccount.mid && !isSameAsBrowser) {
      // 返回的还是页面那个号，且待测 Cookie 确实是另一个号 → 这一种方式没送出去
      sawALeak = true;
      continue;
    }
    // 若待测 Cookie 就是当前浏览器登录号，返回该 mid 是自然的，
    // 但它不能证明「当前管理器具备指定 Cookie 的发送能力」。
    // 只有待测 Cookie 是另一个号、且服务端确实返回了新号 mid 时，
    // 才能证实该策略有效并持久化它。
    if (!isSameAsBrowser) store.setStrategy(i);
    const vip = extractVipFromNav(res.text);
    const account = {
      mid,
      uname: json.data.uname || '',
      face: json.data.face || '',
      vipStatus: vip.vipStatus,
      vipType: vip.vipType
    };

    if (adopt) {
      const added = addAccount(raw, account);
      if (added.ok) {
        markProbed(added.id, account);
        account.id = added.id;
      }
    }
    mirrorLegacy(raw, account, isSameAsBrowser ? store.getStrategy() : i);

    log.info('账号验证通过：', account.uname, 'mid=' + account.mid, '会员', account.vipStatus === 1 ? '大会员' : '非会员', '发送方式', i + 1);
    return { ok: true, reason: '', account, aAccount, strategy: isSameAsBrowser ? store.getStrategy() : i, id: account.id };
  }

  invalidateMixinKey();
  if (sawALeak) {
    return {
      ok: false,
      reason:
        '所有发送方式返回的都还是当前浏览器账号（' + (aAccount.uname || '未知') + '，mid=' + (aAccount.mid || '?') + '）。' +
        '请确认粘贴的是目标账号的 Cookie，且当前脚本管理器支持指定 Cookie（建议 Tampermonkey 4.18+）。'
    };
  }
  return {
    ok: false,
    reason:
      '账号 Cookie 未能通过验证（服务端返回未登录 / 校验失败）。' +
      '可能是 Cookie 已失效（SESSDATA 有有效期），或复制不完整。建议重新登录该账号后完整复制 Cookie 再试。'
  };
}

/**
 * 把借用源的 Cookie 与身份继续镜像回旧版键。
 * 降级到旧脚本（或回看排查）时数据还在，也不会因为池子被改动而丢失。
 */
function mirrorLegacy(cookie, account, strategy) {
  store.setLegacyCookie(cookie);
  store.setLegacyAccount({ ...account, at: Date.now(), strategy });
  store.setStrategy(strategy);
}

/** 镜像当前借用源到旧版键（不加账号时也保持同步） */
export function syncLegacyMirror() {
  const acc = activeAccount();
  const cookie = borrowCookie();
  if (!acc || !cookie) return;
  store.setLegacyCookie(cookie);
  store.setLegacyAccount({ ...acc, at: Date.now(), strategy: store.getStrategy() });
}

/**
 * 读浏览器当前可见的 Cookie（`document.cookie`）。
 *
 * **不假设 SESSDATA 一定读不到** —— 这条结论此前只有 mock 支撑（mock 是照着
 * 结论写的，等于循环论证）。不同浏览器、扩展、站点版本下都可能不一样，
 * 所以运行时探测，结果决定界面给「一键导入」还是「去 DevTools 复制」。
 *
 * @returns {{ok:boolean, cookie:string, hasSessdata:boolean, readable:string[]}}
 */
export function readBrowserCookie() {
  let raw = '';
  try {
    raw = document.cookie || '';
  } catch (e) {
    return { ok: false, cookie: '', hasSessdata: false, readable: [] };
  }
  const p = parseCookie(raw);
  const readable = Object.keys(p);
  return { ok: true, cookie: raw, hasSessdata: !!p.SESSDATA, readable };
}

/** 浏览器当前可见的 SESSDATA 原值；读不到时返回空串 */
function browserSessdata() {
  try {
    return parseCookie(document.cookie || '').SESSDATA || '';
  } catch (e) {
    return '';
  }
}

/**
 * 识别「浏览器当前登录的是谁」—— 用浏览器自己的 Cookie 请求 nav，不带任何覆盖。
 *
 * 这是**能**做到的：nav 会把登录身份原样返回（mid / uname / vipStatus）。
 * 但拿 SESSDATA **本身**去入池则做不到（HttpOnly，见 findings §7/§12）。
 * 两者不是一回事，别混：
 *   · 知道「当前是谁」      → 能（就是本函数）
 *   · 拿到「当前的 Cookie」 → 不能，脚本侧无解，只能从 DevTools 复制
 *
 * 实际用处：当前登录的号若**已经在池子里**，凭证现成，不必再复制一遍；
 * 若不在，就必须如实告诉用户得去复制 —— 不能假装能自动导入。
 *
 * @returns {Promise<{mid:string, uname:string, vipStatus:number}>} 未登录时 mid 为空
 */
export async function identifyBrowserAccount() {
  try {
    // 不传 cookie → transport 走「用浏览器当前 Cookie」分支，即浏览器真实登录的那个号
    const res = await httpRequest({
      method: 'GET',
      url: NAV_URL,
      headers: { Referer: 'https://www.bilibili.com/' },
      timeout: 8000
    });
    if (!res.ok) return { mid: '', uname: '', vipStatus: 0 };
    const a = extractMidFromNav(res.text);
    const vip = extractVipFromNav(res.text);
    return { mid: a.mid, uname: a.uname, face: a.face || '', vipStatus: vip.vipStatus };
  } catch (e) {
    return { mid: '', uname: '', vipStatus: 0 };
  }
}

/**
 * 探测某个池内账号（用于「重探」按钮）。传 null 表示探当前借用源。
 * 结果会写回该条目，因此面板上的会员标记不会停留在旧结论。
 */
export async function probeAccount(id) {
  const targetId = id || borrowAccountId();
  const acc = targetId ? byId(targetId) : null;
  if (targetId && !acc) return { ok: false, reason: '账号不存在' };

  const r = await probeIdentity(acc ? acc.cookie : undefined);
  if (r.ok && r.id) markProbed(r.id, r.account);
  return r;
}

/** 当前使用的发送策略；未探测过时先探测一次 */
export async function resolveStrategy() {
  const saved = store.getStrategy();
  if (saved >= 0 && saved < STRATEGIES.length) return saved;
  if (!hasCookie()) return 0;
  const probe = await probeIdentity(undefined, { adopt: false });
  return probe.ok ? probe.strategy : Math.max(0, saved);
}

export function strategyLabel(idx) {
  const s = STRATEGIES[idx];
  return s ? `方式 ${idx + 1}：${s.label}` : '未探测';
}

/** 校验 Cookie 是否满足基本要求（UI 用；区分「必需缺失」与「建议补齐」） */
export function quickCheck() {
  const raw = borrowCookie() || store.getLegacyCookie();
  if (!raw) return { ok: false, msg: '未设置' };
  const v = validateCookie(sanitizeCookie(raw));
  if (!v.ok) return { ok: false, msg: v.problems.join('；') };
  if (v.warnings.length) {
    return { ok: true, warn: v.warnings.join('\n'), msg: '可用，但建议补齐：' + v.warnings[0] + (v.warnings.length > 1 ? ` 等 ${v.warnings.length} 项` : '') };
  }
  return { ok: true, msg: '字段完整' };
}

export { needsProbe };