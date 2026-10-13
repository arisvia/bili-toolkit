/**
 * 浏览器 Cookie 改写 —— 把账号池里的某个账号真正设为浏览器登录态。
 *
 * 为什么需要这个模块：用户脚本不能读 document.cookie 里的 SESSDATA（HttpOnly），
 * 但**能写** —— GM_setCookie / GM.cookie.set 是管理器的特权能力。
 * 于是「一键切换登录态」成立：把目标账号的身份字段写进浏览器，刷新后浏览器就是那个号。
 *
 * 三条硬约束，都来自实测与安全边界，破坏其中任何一条都会出线上故障：
 *
 *   1. **整组换，不换半个。** SESSDATA / bili_jct / sid / DedeUserID 必须同时换成同一个账号的值。
 *      只换 SESSDATA 会得到「B 的登录态 + A 的 csrf」，番剧 OGV 静默失败（code=0 但没有视频）。
 *   2. **删除也要删。** 旧账号独有的字段必须显式删除，否则会残留在浏览器里继续生效。
 *   3. **HttpOnly 属性要跟着走。** 写成非 HttpOnly 等于凭空把登录态暴露给页面 JS。
 *
 * 能力探测：不同管理器提供的 API 名字不一样（GM.cookie.* 优先，退回 GM_setCookie）。
 * 两者都没有时如实报告不可用 —— 不能假装成功，也不能拿别的方式糊弄过去。
 */
import { IDENTITY_COOKIE_KEYS, HTTP_ONLY_COOKIE_KEYS } from '../config.js';
import { parseCookie } from './cookie.js';
import { TEXT } from './text.js';
import { log } from './log.js';

const COOKIE_DOMAIN = '.bilibili.com';
const COOKIE_PATH = '/';

/**
 * 支持层级：
 *   2 = GM.cookie.*  —— 有独立的 delete，能精确删掉旧号残留字段
 *   1 = 仅 GM_setCookie —— 只能覆盖写；删除靠「写一个过期时间」等价实现
 *   0 = 都没有       —— 切号整体不可用
 */
export function getCookieApi() {
  try {
    if (typeof GM !== 'undefined' && GM && GM.cookie && typeof GM.cookie.set === 'function') {
      return GM.cookie;
    }
  } catch (e) {}
  try {
    if (typeof GM_cookie !== 'undefined' && GM_cookie && typeof GM_cookie.set === 'function') {
      return GM_cookie;
    }
  } catch (e) {}
  return null;
}

function apiLevel() {
  if (getCookieApi()) return 2;
  if (typeof GM_setCookie === 'function') return 1;
  return 0;
}

/** 能否改写浏览器登录态 */
export function canWriteCookies() {
  return apiLevel() > 0;
}

/* ------------------------------------------------------------------ *
 * 底层调用（两种 API 形态都归一化成 Promise）
 * ------------------------------------------------------------------ */

/*
 * 关键细节：`GM.cookie.set()` 返回 Promise，同时**也**接受 callback；
 * 但 Violentmonkey 的实现只在 Promise 形态下回调。
 * 所以必须看返回值而不是「我传了 callback 就会有人调」——
 * 只等 callback 会让请求永远悬着，切号界面就一直卡在「正在改写」。
 */
function gmCookieSet(details) {
  const api = getCookieApi();
  if (!api) return Promise.reject(new Error('no-cookie-api'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      // 成功时回调不带参数或传 undefined，都算成功
      if (err === undefined || err === null || err === false) resolve();
      else reject(new Error(String(err)));
    };
    try {
      const p = api.set(details, done);
      if (p && typeof p.then === 'function') p.then(() => done(), done);
    } catch (e) {
      reject(e);
    }
  });
}

function gmCookieDelete(details) {
  const api = getCookieApi();
  if (!api) return Promise.reject(new Error('no-cookie-api'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      if (err === undefined || err === null || err === false) resolve();
      else reject(new Error(String(err)));
    };
    try {
      const p = api.delete(details, done);
      if (p && typeof p.then === 'function') p.then(() => done(), done);
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * GM_setCookie 的签名是 (cookieString, details, callback) 或 (cookieString, callback)，
 * 且 details 里没有 domain 时默认当前页域名 —— 必须显式给 .bilibili.com，
 * 否则只会写到当前页（www.bilibili.com）的 host-only Cookie 上，api. 域拿不到。
 */
function gmSetCookie(cookieString, details) {
  return new Promise((resolve, reject) => {
    try {
      GM_setCookie(cookieString, details, (err) => {
        // 某些实现成功时回调不带参数，传 undefined 视为成功
        if (err) reject(new Error(String(err)));
        else resolve();
      });
    } catch (e) {
      reject(e);
    }
  });
}

/** 用「过期时间设为过去」的方式删除（兼容只有 set 没有 delete 的实现） */
function gmSetCookieExpired(name, domain, path) {
  return new Promise((resolve, reject) => {
    const details = { domain, path, expirationDate: Math.floor(Date.now() / 1000) - 3600 };
    try {
      if (typeof GM_setCookie === 'function') {
        GM_setCookie(name + '=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT', details, (err) =>
          err ? reject(new Error(String(err))) : resolve()
        );
        return;
      }
    } catch (e) {
      reject(e);
    }
    reject(new Error('no-api'));
  });
}

/* ------------------------------------------------------------------ *
 * 对外接口
 * ------------------------------------------------------------------ */

/**
 * 把某个账号的 Cookie 写进浏览器。
 *
 * @param {string} cookieString 该账号的完整 Cookie
 * @param {string[]} staleKeys  旧账号独有、需要删掉的字段名
 * @returns {Promise<{ok:boolean, level:number, written:string[], removed:string[], reason:string}>}
 */
export async function applyAccount(cookieString, staleKeys = []) {
  const level = apiLevel();
  if (!level) {
    return { ok: false, level, written: [], removed: [], reason: TEXT.notify.cookieApiMissing };
  }

  const target = parseCookie(cookieString);
  if (!target.SESSDATA) {
    return { ok: false, level, written: [], removed: [], reason: TEXT.notify.noSessdataWrite };
  }

  const written = [];
  const errors = [];

  // 计算持久有效期：B 站官方凭证生命周期通常为 180 天。
  // 若 Cookie 写入时不带 expirationDate / Max-Age，浏览器会默认将其标记为 Session Cookie，
  // 导致用户关闭浏览器后再打开时会话凭据被浏览器全部清空并变成未登录状态。
  const nowSec = Math.floor(Date.now() / 1000);
  const DEFAULT_TTL_SEC = 180 * 24 * 3600; // 180 天持久有效期 (秒)
  const exp = nowSec + DEFAULT_TTL_SEC;
  const maxAge = DEFAULT_TTL_SEC;
  const expiresUtc = new Date(exp * 1000).toUTCString();

  for (const key of IDENTITY_COOKIE_KEYS) {
    const value = target[key];
    if (value === undefined) continue; // 目标账号没有这个字段，不该凭空造一个
    try {
      if (level >= 2) {
        const details = {
          url: 'https://www.bilibili.com/',
          name: key,
          value,
          domain: COOKIE_DOMAIN,
          path: COOKIE_PATH,
          secure: true,
          expirationDate: exp
        };
        if (HTTP_ONLY_COOKIE_KEYS.has(key)) details.httpOnly = true;
        await gmCookieSet(details);
      } else {
        const parts = [
          `${key}=${value}`,
          `path=${COOKIE_PATH}`,
          `domain=${COOKIE_DOMAIN}`,
          'secure',
          `Max-Age=${maxAge}`,
          `Expires=${expiresUtc}`
        ];
        if (HTTP_ONLY_COOKIE_KEYS.has(key)) parts.push('httponly');
        await gmSetCookie(parts.join('; '), { domain: COOKIE_DOMAIN, path: COOKIE_PATH, expirationDate: exp });
      }
      if (!HTTP_ONLY_COOKIE_KEYS.has(key) && typeof document !== 'undefined' && typeof document.cookie === 'string') {
        try {
          document.cookie = `${key}=${value}; path=${COOKIE_PATH}; domain=${COOKIE_DOMAIN}; max-age=${maxAge}; expires=${expiresUtc}; secure`;
        } catch (e) {}
      }
      written.push(key);
    } catch (e) {
      errors.push(key + ': ' + (e && e.message));
      log.warn('写入 Cookie 失败', key, e && e.message);
    }
  }

  // 登录态没写成功就没有「切换」可言，直接失败，不要继续删东西
  if (!written.includes('SESSDATA')) {
    return {
      ok: false,
      level,
      written,
      removed: [],
      reason: 'SESSDATA ' + TEXT.notify.fieldFail + (errors.join('；') || '未知原因')
    };
  }

  const removed = [];
  if (staleKeys.length) {
    for (const key of staleKeys) {
      if (target[key] !== undefined) continue; // 目标账号本来就有，不删
      try {
        if (level >= 2) {
          await gmCookieDelete({ name: key, url: 'https://www.bilibili.com/' });
          await gmCookieDelete({ name: key, domain: 'www.bilibili.com', url: 'https://www.bilibili.com/' }).catch(() => {});
        } else {
          await gmSetCookieExpired(key, COOKIE_DOMAIN, COOKIE_PATH);
        }
        if (typeof document !== 'undefined' && typeof document.cookie === 'string') {
          try {
            document.cookie = `${key}=; path=${COOKIE_PATH}; domain=${COOKIE_DOMAIN}; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
          } catch (e) {}
        }
        removed.push(key);
      } catch (e) {
        log.warn('删除旧 Cookie 失败', key, e && e.message);
      }
    }
  }

  return {
    ok: true,
    level,
    written,
    removed,
    reason: errors.length ? TEXT.notify.fieldsFailed + errors.join('；') : ''
  };
}

/**
 * 彻底清空浏览器本地持久化的身份 Cookie（SESSDATA / bili_jct / DedeUserID / sid）。
 * 用于软登出保活，不碰设备字段（buvid* 等）。
 */
export async function clearBrowserIdentityCookies() {
  const level = apiLevel();
  if (!level) {
    return { ok: false, level, removed: [], reason: TEXT.notify.cookieApiMissing };
  }
  const removed = [];
  const errors = [];
  for (const key of IDENTITY_COOKIE_KEYS) {
    try {
      if (level >= 2) {
        await gmCookieDelete({ name: key, url: 'https://www.bilibili.com/' });
        await gmCookieDelete({ name: key, domain: COOKIE_DOMAIN, url: 'https://www.bilibili.com/' }).catch(() => {});
        await gmCookieDelete({ name: key, domain: 'www.bilibili.com', url: 'https://www.bilibili.com/' }).catch(() => {});
        await gmCookieDelete({ name: key, domain: 'passport.bilibili.com', url: 'https://passport.bilibili.com/' }).catch(() => {});
      } else if (level === 1) {
        await gmSetCookieExpired(key, COOKIE_DOMAIN, COOKIE_PATH);
        await gmSetCookieExpired(key, 'www.bilibili.com', COOKIE_PATH).catch(() => {});
      }
      if (typeof document !== 'undefined' && typeof document.cookie === 'string') {
        try {
          document.cookie = `${key}=; path=${COOKIE_PATH}; domain=${COOKIE_DOMAIN}; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
          document.cookie = `${key}=; path=${COOKIE_PATH}; domain=www.bilibili.com; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
          document.cookie = `${key}=; path=${COOKIE_PATH}; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
        } catch (e) {}
      }
      removed.push(key);
    } catch (e) {
      errors.push(key + ': ' + (e && e.message));
      log.warn('清空 Cookie 失败', key, e && e.message);
    }
  }
  const ok = removed.includes('SESSDATA');
  return { ok, level, removed, errors };
}

/**
 * 浏览器里当前实际存在哪些身份字段。
 *
 * 两个来源都要看，因为它们覆盖不同情况：
 *   · document.cookie —— 拿不到 HttpOnly，但能证明 DedeUserID / buvid* 在
 *   · GM.cookie.list   —— 非 beta 上也读不到 HttpOnly，但能证明其余字段在
 * 合起来仍可能漏（SESSDATA / bili_jct / sid 在两者里都不可见），
 * 所以这里的结果只是「已知存在」，真正的差集还要并上池内记录的旧账号 Cookie。
 */
export function presentIdentityKeys(extraCookie) {
  const names = new Set();
  const add = (cookieText) => {
    const p = parseCookie(cookieText);
    for (const k of Object.keys(p)) if (IDENTITY_COOKIE_KEYS.includes(k)) names.add(k);
  };
  add(extraCookie || '');
  add((typeof document !== 'undefined' && document.cookie) || '');
  return names;
}

/**
 * 判断切换后还需要删哪些字段：目标账号没有、而浏览器里有的身份字段。
 * 纯计算，不碰浏览器。
 *
 * @param {string} targetCookie 目标账号的 Cookie
 * @param {Set<string>|Iterable<string>} presentKeys 已知存在的字段名
 */
export function staleKeysFor(targetCookie, presentKeys) {
  const target = parseCookie(targetCookie);
  const stale = [];
  for (const key of IDENTITY_COOKIE_KEYS) {
    if (!presentKeys || !presentKeys.has(key)) continue; // 浏览器里没有，无需删
    if (target[key] !== undefined) continue; // 目标账号有，会被覆盖写
    stale.push(key);
  }
  return stale;
}

// 已删除 listBrowserCookies() 与 browserAccountMid()：
// 前者走 GM.cookie.list（TM 文档说 HttpOnly 只在 beta 可读），后者拿它的结果去认 mid。
// 两者都没被调用 —— 「浏览器当前登录的是谁」后来改用 nav 返回的 mid + nickname 判断，
// 那条路不依赖读不读得到 HttpOnly（见 findings §7、§17），覆盖面更广也更能实测。
// 保留这段只会让人以为「beta 上自动识别会更准」，其实那条分支从来没跑过。