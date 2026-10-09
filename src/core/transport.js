/**
 * GM_xmlhttpRequest 的 Promise 封装 + Cookie 发送策略。
 *
 * 背景：不同脚本管理器对「指定 Cookie」的支持差异很大。
 *   - Tampermonkey v4.18+ 支持 `cookie` 选项（同时可用 `anonymous` 排除浏览器 Cookie）
 *   - 早期版本只认 `Cookie` 请求头
 *   - 部分管理器两个都丢
 * 所以这里准备多种策略，运行时逐个探测，记住第一个有效的（见 session.js）。
 */
import { STRATEGIES } from '../config.js';

/**
 * @param {object} req
 * @param {string} req.method
 * @param {string} req.url
 * @param {object} [req.headers]
 * @param {string} [req.body]
 * @param {number} [req.timeout]
 * @param {string} [req.cookie]      要发送的 Cookie；不传则使用浏览器当前 Cookie（= A）
 * @param {number} [req.strategyIdx] 发送策略下标；不传用 0
 * @param {boolean} [req.anonymous]  是否显式排除浏览器 Cookie
 * @returns {Promise<{ok:boolean,status:number,statusText:string,text:string,headersRaw:string,error?:string}>}
 */
export function httpRequest(req) {
  const useBrowserCookies = req.cookie === undefined || req.cookie === null || req.cookie === '';
  const s = STRATEGIES[Math.max(0, Number(req.strategyIdx) | 0)] || STRATEGIES[0];

  const opts = {
    method: (req.method || 'GET').toUpperCase(),
    url: req.url,
    timeout: req.timeout || 15000,
    headers: Object.assign({}, req.headers || {})
  };

  if (!useBrowserCookies) {
    opts.anonymous = req.anonymous === undefined ? s.anonymous : req.anonymous;
    if (s.useOption) opts.cookie = req.cookie;
    if (s.useHeader) opts.headers.Cookie = req.cookie;
  }

  if ((req.method || 'GET').toUpperCase() !== 'GET' && req.body) opts.data = req.body;

  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    opts.onload = (res) => {
      done({
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        statusText: res.statusText || '',
        text: res.responseText || '',
        headersRaw: res.responseHeaders || ''
      });
    };
    opts.onerror = (res) => done({ ok: false, status: res && res.status || 0, statusText: '', text: '', headersRaw: '', error: 'network' });
    opts.ontimeout = () => done({ ok: false, status: 0, statusText: '', text: '', headersRaw: '', error: 'timeout' });
    opts.onabort = () => done({ ok: false, status: 0, statusText: '', text: '', headersRaw: '', error: 'aborted' });

    try {
      GM_xmlhttpRequest(opts);
    } catch (e) {
      done({ ok: false, status: 0, statusText: '', text: '', headersRaw: '', error: 'throw:' + (e && e.message) });
    }
  });
}

/** 解析 B 站 JSON 接口响应；非 JSON 或结构异常时返回 null */
export function parseJsonSafe(text) {
  try {
    const o = JSON.parse(text);
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

/** 从响应头字符串里取某个头（大小写不敏感） */
export function headerValue(headersRaw, name) {
  const target = name.toLowerCase();
  for (const line of String(headersRaw || '').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0 && line.slice(0, i).trim().toLowerCase() === target) return line.slice(i + 1).trim();
  }
  return null;
}