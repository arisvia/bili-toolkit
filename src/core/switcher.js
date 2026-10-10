/**
 * 账号操作的编排层 —— 面板与菜单只调这里，不直接碰 store / GM API。
 *
 * 每一类操作都有「必须一起做的事」，散在 UI 里最容易漏：
 *   · 换借用源 → 清播放缓存 + 重签 wbi 密钥 + 通知钩子更新配置
 *   · 切登录态 → 先删旧账号独有字段，再写新账号，最后刷新页面
 *   · 探测身份 → 结果写回池子，同时镜像回旧版键
 * 这层就是把这些不漏。
 */
import { sanitizeCookie, validateCookie } from './cookie.js';
import { TEXT } from './text.js';
import { log } from './log.js';
import { resetCache } from './proxy.js';
import { pushConfig, getToken } from './bus.js';
import { liveConfig } from './inject.js';
import {
  probeIdentity,
  probeAccount,
  invalidateMixinKey,
  syncLegacyMirror,
  identifyBrowserAccount,
  readBrowserCookie,
  getEffectiveCookie,
  getBCsrf,
  hasCookie,
  needsProbe
} from './session.js';

import {
  addAccount,
  removeAccount,
  renameAccount,
  setActiveId,
  setBorrowId,
  byId,
  list,
  activeAccount,
  borrowAccountId,
  borrowCookie,
  resolveBorrow,
  markProbed
} from './accounts.js';
import { applyAccount, staleKeysFor, presentIdentityKeys, canWriteCookies } from './browser-cookie.js';

/** 换借用源 / 换账号后，播放器侧的缓存与签名必须一起失效 */
function afterSwitch() {
  resetCache();
  invalidateMixinKey();
  pushConfig(liveConfig(getToken()));
}

/* ------------------------------------------------------------------ *
 * 加入账号
 * ------------------------------------------------------------------ */

/**
 * 保存一个账号（粘贴的 Cookie），并探测身份。
 * 探测失败也保留 Cookie —— 保留比丢弃好：用户能看到「已保存但验证失败」，
 * 而不是刚粘贴就没了还得重新从 DevTools 复制。
 *
 * @returns {Promise<{ok:boolean, reason:string, account?:object, saved:boolean, isNew:boolean}>}
 */
export async function saveAccount(cookieInput, opts = {}) {
  const cookie = sanitizeCookie(cookieInput);
  if (!cookie) return { ok: false, reason: 'empty', saved: false, isNew: false };

  const check = validateCookie(cookie);
  if (!check.ok) {
    // 连 SESSDATA 都没有的 Cookie 没有任何价值，直接拒绝，别让池子里堆垃圾
    return { ok: false, reason: 'incomplete', saved: false, isNew: false, problems: check.problems };
  }

  const added = addAccount(cookie, { label: opts.label || '' });
  if (!added.ok) return { ok: false, reason: added.reason, saved: false, isNew: false };

  invalidateMixinKey();
  const r = await probeIdentity(cookie, { adopt: false });
  if (r.ok) {
    markProbed(added.id, r.account);
    if (opts.label) renameAccount(added.id, opts.label);
  }
  syncLegacyMirror();
  afterSwitch();
  return {
    ok: r.ok,
    reason: r.reason,
    account: r.account,
    saved: true,
    isNew: added.isNew,
    id: added.id,
    strategy: r.strategy,
    aAccount: r.aAccount
  };
}

/** 仅验证，不保存（面板上的「仅验证」按钮） */
export async function testAccount(cookieInput) {
  const cookie = sanitizeCookie(cookieInput);
  if (!cookie) return { ok: false, reason: 'empty' };
  const check = validateCookie(cookie);
  if (!check.ok) return { ok: false, reason: 'incomplete', problems: check.problems };
  return probeIdentity(cookie, { adopt: false });
}

/** 重探某个账号的会员状态（不传 id 则探当前借用源） */
export async function reprobe(id) {
  const r = await probeAccount(id);
  if (r.ok) syncLegacyMirror();
  return r;
}

/* ------------------------------------------------------------------ *
 * 借用源
 * ------------------------------------------------------------------ */

/**
 * 指定借用来源；传 null 恢复自动挑选。
 * 只影响「用谁的 Cookie 取播放地址」，不碰浏览器登录态 —— 弹幕评论仍归当前号。
 */
export function useAsBorrowSource(id) {
  if (id && !byId(id)) return { ok: false, reason: 'notFound' };
  setBorrowId(id || null);
  afterSwitch();
  syncLegacyMirror();
  const r = resolveBorrow();
  return { ok: true, reason: r.reason, borrowId: r.account ? r.account.id : '' };
}

/** 恢复自动挑选 */
export function useAutoBorrowSource() {
  return useAsBorrowSource(null);
}

/* ------------------------------------------------------------------ *
 * 一键切号（改写浏览器登录态）
 * ------------------------------------------------------------------ */

/**
 * 把浏览器登录态切成指定账号。
 *
 * 流程刻意是「先算差集 → 写 → 删 → 切记录 → 刷新」，理由：
 *   · 差集必须用**切换前**的 Cookie 算。切换后再问「浏览器里有什么」，
 *     拿到的已经是新值，差集恒为空，旧字段就永久残留了。
 *   · 写完必须刷新页面。首屏 SSR 里嵌的是旧身份（__INITIAL_STATE__.user、
 *     __playinfo__），不刷新的话界面上还是旧号，且播放器会先播一次低画质。
 *   · 需要重新探测 wbi 密钥 —— 密钥与账号无关，但保险起见一并作废，
 *     避免切换途中用旧缓存签了名。
 *
 * @returns {Promise<{ok:boolean, reason:string, needReload:boolean, stale:string[], written:string[]}>}
 */
export async function switchLoginTo(id) {
  const target = byId(id);
  if (!target) return { ok: false, reason: 'notFound', needReload: false, stale: [], written: [] };
  if (!canWriteCookies()) {
    return { ok: false, reason: 'unsupported', needReload: false, stale: [], written: [] };
  }
  if (target.id === activeAccount()?.id && hasCookie()) {
    // 已经是当前身份了，但用户可能就是想重新写一遍以修复失效 Cookie —— 允许，只是不必刷新
    const already = await applyAccount(target.cookie, []);
    return {
      ok: already.ok,
      reason: already.ok ? TEXT.notify.switchAlready : already.reason,
      needReload: false,
      stale: [],
      written: already.written
    };
  }

  // 切换前「已知存在」的字段：池内记录的旧账号 Cookie（它就是上次写进去的那份，
  // 含 HttpOnly 字段）＋ 页面 document.cookie。两者合起来才够算出该删谁。
  const before = presentIdentityKeys(borrowCookie());
  const stale = staleKeysFor(target.cookie, before);

  const applied = await applyAccount(target.cookie, stale);
  if (!applied.ok) {
    return { ok: false, reason: applied.reason, needReload: false, stale, written: applied.written };
  }

  setActiveId(target.id);
  invalidateBrowserWho(); // 浏览器登录态刚变，30 秒缓存必须立刻作废
  afterSwitch();
  syncLegacyMirror();
  log.info(TEXT.notify.switchLogged + (target.uname || target.mid || target.id), '写入', applied.written.length, '个字段');

  return { ok: true, reason: applied.reason, needReload: true, stale: applied.removed, written: applied.written };
}

/* ------------------------------------------------------------------ *
 * 删除与重命名
 * ------------------------------------------------------------------ */

/**
 * 删除账号。
 *
 * 刻意**不**改浏览器登录态：删掉的只是池子里的记录。如果顺带把浏览器也登出，
 * 用户可能正用着这个号，被一次误点踢下线就无法挽回。要停用请用「切号」。
 */
export function forgetAccount(id) {
  const acc = byId(id);
  if (!acc) return { ok: false, reason: 'notFound' };
  const wasBorrow = borrowAccountId() === id;
  const r = removeAccount(id);
  if (!r.ok) return r;
  afterSwitch();
  syncLegacyMirror();
  return { ok: true, reason: '', wasBorrow };
}

/* ------------------------------------------------------------------ *
 * 面板用的只读视图
 * ------------------------------------------------------------------ */

/**
 * 汇总面板需要的全部信息。
 * 放在一处是为了让「界面显示的」与「代理实际用的」必然同源 ——
 * 分别算两次迟早会出现界面说 A、请求发 B 的情况。
 */
export function overview() {
  const accounts = list();
  const active = activeAccount();
  const borrow = resolveBorrow();
  const borrowAcc = borrow.account;
  const rows = accounts.map((a) => ({
    id: a.id,
    label: a.label,
    uname: a.uname,
    face: a.face || '',
    mid: a.mid,
    vip: a.vipStatus === 1,
    checkedAt: a.checkedAt,
    stale: needsProbe(a),
    isActive: !!active && a.id === active.id,
    isBorrow: !!borrowAcc && a.id === borrowAcc.id
  }));
  return {
    rows,
    activeId: active ? active.id : '',
    borrowId: borrowAcc ? borrowAcc.id : '',
    borrowMode: borrow.mode,
    borrowReason: borrow.reason,
    /** 借用源与当前身份不一致 —— 界面必须把这件事说出来，否则用户会困惑「我明明不是大会员」 */
    borrowedFromOther: !!active && !!borrowAcc && active.id !== borrowAcc.id,
    canWrite: canWriteCookies(),
    hasCsrf: !!getBCsrf(),
    effectiveMasked: hasCookie() ? maskSummary() : ''
  };
}

/**
 * 浏览器身份缓存的存活期。
 *
 * 面板每次展开、每次池子操作都会重绘，没有缓存的话等于每次都发一个 nav。
 * 30 秒足够短 —— 用户真去登录/登出，30 秒后必然反映出来。
 */
const BROWSER_ID_TTL_MS = 30 * 1000;
let browserWhoCache = { at: 0, who: { mid: '', uname: '', vipStatus: 0 } };

export function invalidateBrowserWho() {
  browserWhoCache = { at: 0, who: { mid: '', uname: '', vipStatus: 0 } };
}

/**
 * 异步版：额外识别「浏览器当前登录的是谁」，以及它与池子的关系。
 *
 * 与 overview 分开是因为它要发一次 nav 请求，而 overview 是渲染列表时的同步入口 ——
 * 不能让列表渲染被网络延迟拖住。
 *
 * 关键区分（面板文案也是这么写的）：
 *   · 脚本能知道当前是谁（nav 会返回）
 *   · 脚本拿不到当前的 SESSDATA（HttpOnly）
 * 所以 `inPool` 命中时可以直接复用池里那份凭证；没命中时只能提示去 DevTools 复制，
 * 绝不能假装「已自动导入」。
 */
export async function overviewAsync() {
  const o = overview();
  if (Date.now() - browserWhoCache.at > BROWSER_ID_TTL_MS) {
    browserWhoCache = { at: Date.now(), who: await identifyBrowserAccount() };
  }
  const who = browserWhoCache.who;
  const row = who.mid ? o.rows.find((r) => r.mid && r.mid === who.mid) : null;

  // 能不能一键导入，取决于**此刻** document.cookie 里有没有 SESSDATA ——
  // 运行时探测而不是写死结论。不同浏览器 / 扩展 / 站点版本下都可能不同。
  const bc = readBrowserCookie();

  return Object.assign(o, {
    browserMid: who.mid,
    browserUname: who.uname,
    browserFace: who.face || '',
    browserVip: who.vipStatus === 1,
    /** 当前登录的号在池子里 —— 凭证现成，可以直接借用，不必再复制 */
    inPool: !!row,
    inPoolId: row ? row.id : '',
    inPoolBorrow: !!row && row.id === o.borrowId,
    /** 当前号不在池中，但脚本读得到它的 Cookie → 可以一键导入 */
    canAutoImport: !!who.mid && !row && bc.hasSessdata,
    /** 读不到凭证 → 只能走 DevTools（界面必须如实说明，不能假装能自动导入） */
    needsManualCopy: !!who.mid && !row && !bc.hasSessdata,
    /** 池里记录的当前身份与浏览器真实状态对不上 —— 常见于用户在别处改了登录 */
    browserMismatch: !!who.mid && !!o.activeId && !row
  });
}

/**
 * 一键把当前登录的号收进池子。
 *
 * 只在 `readBrowserCookie().hasSessdata` 为真时才可能成功 —— 读不到就明确
 * 返回 needManualCopy，**绝不用别的东西凑一个假 Cookie**（比如拿 A 的 device
 * 字段拼一个空壳，那会在切号时把用户踢下线）。
 *
 * @returns {Promise<{ok:boolean, reason:string, account?:object, isNew?:boolean}>}
 */
export async function importBrowserAccount() {
  const bc = readBrowserCookie();
  if (!bc.hasSessdata) return { ok: false, reason: 'needManualCopy' };

  // 探测走 addAccount 的常规路径：入池 → 探 nav → 回写昵称与会员状态
  const r = await saveAccount(bc.cookie);
  if (!r.ok) return r;
  invalidateBrowserWho(); // 池子变了，重新认一次（现在它已在池中）
  return r;
}

/** 借用源 Cookie 的脱敏摘要（只给字段数与身份，绝不给完整值） */
function maskSummary() {
  const p = getEffectiveCookie();
  const parsed = {};
  for (const part of String(p).split(';')) {
    const i = part.indexOf('=');
    if (i > 0) parsed[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  const s = parsed.SESSDATA || '';
  const n = Object.keys(parsed).length;
  if (!s) return TEXT.pool.borrowNoSessdata;
  return `mid=${parsed.DedeUserID || '?'} SESSDATA=${s.slice(0, 4)}***${s.slice(-3)} (${n} 项)`;
}

/** 面板的改名按钮直接转发到这里，保持 UI 只依赖 switcher */
export function renamePoolAccount(id, label) {
  return renameAccount(id, label);
}

/**
 * 扫码添加成功后的处理流程：
 *  1. 入池并探测身份（同 mid 已存在时就地刷新新凭证）；
 *  2. 同步写入浏览器当前登录态（与官方扫码登录体验对齐）；
 *  3. 切号后刷新配置并重置缓存。
 */
export async function saveAndApplyScannedAccount(cookieString) {
  const r = await saveAccount(cookieString);
  if (!r.ok) return r;
  await switchLoginTo(r.id);
  invalidateBrowserWho();
  return r;
}