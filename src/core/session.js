/**
 * B 账号会话：Cookie 解析补齐、发送策略探测、wbi 密钥获取、身份自检。
 */
import { STRATEGIES } from '../config.js';
import { store } from './store.js';
import { sanitizeCookie, parseCookie, backfillDeviceCookies, validateCookie, cookieFingerprint } from './cookie.js';
import { httpRequest, parseJsonSafe } from './transport.js';
import { extractWbiKeys } from './wbi.js';
import { extractMidFromNav, extractVipFromNav } from './patch.js';
import { log } from './log.js';

const NAV_URL = 'https://api.bilibili.com/x/web-interface/nav';
const WBI_URL = 'https://api.bilibili.com/x/web-interface/wbi/img';

let cachedFingerprint = null;

/** 当前生效的 B Cookie（含设备 Cookie 补齐） */
export function getEffectiveCookie() {
  const raw = store.getCookie();
  if (!raw) return '';
  const filled = backfillDeviceCookies(raw, document.cookie || '');
  cachedFingerprint = cookieFingerprint(raw);
  return filled;
}

export function hasCookie() {
  return !!store.getCookie();
}

/** 用户是否真的配置了有效 Cookie（UI 用来给明确提示，而不是等到播放才失败） */
export function cookieProblem() {
  const raw = store.getCookie();
  if (!raw) return '尚未设置 B 账号 Cookie';
  const v = validateCookie(sanitizeCookie(raw));
  return v.ok ? '' : v.problems.join('；');
}

/** B 的 bili_jct（番剧 OGV 接口的 csrf） */
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
 * 结果按天缓存 —— wbi 密钥每天轮换。
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
      const keys = parseJsonSafe(res.text) && extractWbiKeys(parseJsonSafe(res.text));
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

/** wbi 密钥是否可用（面板用来提示「画质为什么没升级」） */
export function mixinKeyStatus() {
  const cached = store.getMixinKey();
  return { ok: !!(cached && cached.mixinKey), date: cached && cached.date };
}

/** 强制下次重新拉取（用户点了「重新探测」） */
export function invalidateMixinKey() {
  store.setMixinKey(null);
}

/* ------------------------------------------------------------------ *
 * 发送策略探测
 * ------------------------------------------------------------------ */
/**
 * 自动找出当前管理器可用的 Cookie 发送方式。
 * 先用「不带任何 Cookie 覆盖」的方式请求 nav，得到 A 的 mid 作为对照；
 * 再逐个尝试发送方式，只要拿到的 mid 不是 A 的就算成功并记住。
 *
 * @param {string} cookie 要测试的 Cookie（默认用已保存的）
 * @returns {Promise<{ok:boolean, reason:string, account?:object, aAccount?:object, strategy?:number}>}
 */
export async function probeIdentity(cookie) {
  const raw = sanitizeCookie(cookie || store.getCookie());
  if (!raw) return { ok: false, reason: '尚未填写 B 账号 Cookie' };

  const check = validateCookie(raw);
  if (!check.ok) return { ok: false, reason: 'Cookie 不完整：' + check.problems.join('；') };

  // 对照组：使用浏览器当前 Cookie（即 A）
  const aRes = await httpRequest({
    method: 'GET',
    url: NAV_URL,
    headers: { Referer: 'https://www.bilibili.com/' },
    timeout: 10000
  });
  const aAccount = aRes.ok ? extractMidFromNav(aRes.text) : { mid: '', uname: '' };

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
    if (aAccount.mid && mid === aAccount.mid) {
      // 返回的还是 A：说明这一种方式没把 B 的 Cookie 送出去
      sawALeak = true;
      continue;
    }

    store.setStrategy(i);
    const vip = extractVipFromNav(res.text);
    const account = {
      mid,
      uname: json.data.uname || '',
      vipStatus: vip.vipStatus,
      vipType: vip.vipType
    };
    store.setLastAccount({ ...account, at: Date.now(), strategy: i });
    log.info('B 账号验证通过：', account.uname, 'mid=' + account.mid, '发送方式', i + 1);
    return { ok: true, reason: '', account, aAccount, strategy: i };
  }

  invalidateMixinKey();
  if (sawALeak) {
    return {
      ok: false,
      reason:
        '所有发送方式返回的都还是当前浏览器账号（' + (aAccount.uname || '未知') + '，mid=' + (aAccount.mid || '?') + '）。' +
        '请确认粘贴的是 B 账号的 Cookie，且当前脚本管理器支持指定 Cookie（建议 Tampermonkey 4.18+）。'
    };
  }
  return {
    ok: false,
    reason:
      'B 账号 Cookie 未能通过验证（服务端返回未登录 / 校验失败）。' +
      '可能是 Cookie 已失效（SESSDATA 有有效期），或复制不完整。建议重新登录 B 账号后完整复制 Cookie 再试。'
  };
}

/** 当前使用的发送策略；未探测过时先探测一次 */
export async function resolveStrategy() {
  const saved = store.getStrategy();
  if (saved >= 0 && saved < STRATEGIES.length) return saved;
  if (!hasCookie()) return 0;
  const probe = await probeIdentity();
  return probe.ok ? probe.strategy : Math.max(0, saved);
}

export function strategyLabel(idx) {
  const s = STRATEGIES[idx];
  return s ? `方式 ${idx + 1}：${s.label}` : '未探测';
}

/** 校验 B Cookie 是否满足基本要求（UI 用；区分「必需缺失」与「建议补齐」） */
export function quickCheck() {
  const raw = store.getCookie();
  if (!raw) return { ok: false, msg: '未设置' };
  const v = validateCookie(sanitizeCookie(raw));
  if (!v.ok) return { ok: false, msg: v.problems.join('；') };
  if (v.warnings.length) {
    return { ok: true, warn: v.warnings.join('\n'), msg: '可用，但建议补齐：' + v.warnings[0] + (v.warnings.length > 1 ? ` 等 ${v.warnings.length} 项` : '') };
  }
  return { ok: true, msg: '字段完整' };
}