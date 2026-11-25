/**
 * 扫码快速添加入池 —— 调用 B 站官方 Passport 扫码登录接口。
 *
 * 流程：
 *  1. fetchQrCode() -> 获取 qrcode_key 与扫码 URL，渲染为 SVG 矢量图；
 *  2. pollQrCode(key) -> 轮询扫码状态（未扫码 / 已扫码待确认 / 已失效 / 成功）；
 *  3. 扫码成功时提取完整 Cookie（SESSDATA / bili_jct / DedeUserID 等）；
 *  4. 交由 switcher 添加入池并同步切换浏览器登录态。
 */
import { renderSVG } from 'uqr';
import { IDENTITY_COOKIE_KEYS } from '../config.js';
import { httpRequest, parseJsonSafe } from './transport.js';
import { sanitizeCookie } from './cookie.js';

const QR_GEN_URL = 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate';
const QR_POLL_URL = 'https://passport.bilibili.com/x/passport-login/web/qrcode/poll';
const QR_SOURCE = 'main_web';
const QR_SDK_URL = 'https://s1.hdslb.com/bfs/seed/jinkela/short/minntaki-wasm-sdk/bili-sc-sdk.umd.js';

const QR_SDK_TIMEOUT_MS = 5000;
const QR_TOKEN_TTL_MS = 60 * 1000;

let sdkLoadPromise = null;
let cachedRiskToken = '';
let cachedRiskTokenAt = 0;
let sdkPolicy = null;

function toTrustedScriptUrl(url) {
  if (
    typeof window === 'undefined' ||
    !window.trustedTypes ||
    typeof window.trustedTypes.createPolicy !== 'function'
  ) {
    return url;
  }
  try {
    if (!sdkPolicy) {
      sdkPolicy = window.trustedTypes.createPolicy('bili-toolkit#sdk', {
        createScriptURL: (u) => (u === QR_SDK_URL ? u : '')
      });
    }
    return sdkPolicy.createScriptURL(url);
  } catch {
    return url;
  }
}

function getPageWindow() {
  try {
    if (typeof unsafeWindow !== 'undefined' && unsafeWindow) return unsafeWindow;
  } catch {
    /* ignore */
  }
  return typeof window !== 'undefined' ? window : null;
}

function loadRiskSdk(pageWindow) {
  if (pageWindow.SecureCollectSDK) return Promise.resolve(pageWindow.SecureCollectSDK);
  if (sdkLoadPromise) return sdkLoadPromise;
  if (typeof document === 'undefined') return Promise.resolve(null);

  sdkLoadPromise = new Promise((resolve, reject) => {
    const root = document.head || document.documentElement;
    if (!root) {
      reject(new Error('DOM 未就绪'));
      return;
    }
    const s = document.createElement('script');
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('安全组件加载超时'));
    }, QR_SDK_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timer);
      s.onload = null;
      s.onerror = null;
    };
    s.src = toTrustedScriptUrl(QR_SDK_URL);
    s.async = true;
    s.onload = () => {
      cleanup();
      resolve(pageWindow.SecureCollectSDK || null);
    };
    s.onerror = () => {
      cleanup();
      reject(new Error('安全组件加载失败'));
    };
    root.appendChild(s);
  }).catch(() => {
    sdkLoadPromise = null;
    return null;
  });

  return sdkLoadPromise;
}

/**
 * 读取页面环境里的风控 token（b_ret）。
 *
 * 2025 版 passport 扫码流程由 bili-sc-sdk 生成 b_ret 并随 poll 一起提交；
 * 缺少它时服务端会在手机确认后把 qrcode_key 判成 86038（已失效）。
 * 优先复用页面已加载的 SDK；仅缓存成功获取的短有效期令牌，失败可自动重试。
 */
async function getQrRiskToken() {
  if (cachedRiskToken && Date.now() - cachedRiskTokenAt < QR_TOKEN_TTL_MS) {
    return cachedRiskToken;
  }
  try {
    const pageWindow = getPageWindow();
    if (!pageWindow) return '';
    const sdk = await loadRiskSdk(pageWindow);
    if (!sdk || typeof sdk.getEnvToken !== 'function') return '';
    const token = await sdk.getEnvToken();
    const text = token ? String(token) : '';
    if (text) {
      cachedRiskToken = text;
      cachedRiskTokenAt = Date.now();
    }
    return text;
  } catch {
    return '';
  }
}

function qrQuery(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  return q.toString();
}

/**
 * 获取新二维码及其 SVG 矢量图。
 * @returns {Promise<{ok:boolean, qrcodeKey?:string, url?:string, svg?:string, error?:string}>}
 */
export async function fetchQrCode() {
  try {
    const res = await httpRequest({
      method: 'GET',
      url: `${QR_GEN_URL}?${qrQuery({ source: QR_SOURCE, go_url: '' })}`,
      headers: { Referer: 'https://www.bilibili.com/' },
      anonymous: true,
      timeout: 10000
    });
    if (!res.ok) return { ok: false, error: '网络请求失败 (' + res.status + ')' };
    const json = parseJsonSafe(res.text);
    if (!json || json.code !== 0 || !json.data) {
      return { ok: false, error: (json && json.message) || '获取二维码失败' };
    }
    const { url, qrcode_key } = json.data;
    if (!url || !qrcode_key) return { ok: false, error: '接口未返回有效二维码信息' };

    const svg = renderSVG(url);
    return { ok: true, qrcodeKey: qrcode_key, url, svg };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/**
 * 从确认回调的跳转 URL 与响应头中提取 Cookie 字符串。
 */
export function extractCookies(urlStr, headersRaw) {
  const map = new Map();

  // 1. 从 headersRaw 中的 Set-Cookie 行提取
  for (const line of String(headersRaw || '').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    if (line.slice(0, i).trim().toLowerCase() === 'set-cookie') {
      const part = line
        .slice(i + 1)
        .trim()
        .split(';')[0];
      const eq = part.indexOf('=');
      if (eq > 0) map.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
    }
  }

  // 2. 从 data.url 的查询参数中提取（B 站 crossDomain URL 会带齐全量参数）
  if (urlStr) {
    try {
      const u = new URL(urlStr);
      for (const [k, v] of u.searchParams.entries()) {
        if (v && IDENTITY_COOKIE_KEYS.includes(k)) {
          map.set(k, v);
        }
      }
    } catch {
      /* ignore */
    }
  }

  const parts = [];
  for (const [k, v] of map.entries()) {
    parts.push(`${k}=${v}`);
  }
  return sanitizeCookie(parts.join('; '));
}

/**
 * 轮询二维码状态。
 * @param {string} qrcodeKey
 * @returns {Promise<{ok:boolean, state:'waiting'|'scanned'|'expired'|'confirmed'|'error', message:string, cookie?:string}>}
 */
export async function pollQrCode(qrcodeKey) {
  if (!qrcodeKey) return { ok: false, state: 'error', message: '缺少二维码凭据' };

  try {
    const riskToken = await getQrRiskToken();
    const res = await httpRequest({
      method: 'GET',
      url: `${QR_POLL_URL}?${qrQuery({ qrcode_key: qrcodeKey, source: QR_SOURCE, b_ret: riskToken })}`,
      headers: { Referer: 'https://www.bilibili.com/' },
      anonymous: true,
      timeout: 8000
    });
    if (!res.ok) return { ok: false, state: 'error', message: '网络异常' };
    const json = parseJsonSafe(res.text);
    if (!json || !json.data) return { ok: false, state: 'error', message: '解析异常' };

    const code = Number(json.data.code);
    if (code === 86101) {
      return { ok: true, state: 'waiting', message: '请使用哔哩哔哩手机客户端扫码' };
    }
    if (code === 86090) {
      return { ok: true, state: 'scanned', message: '已扫码，请在手机端确认登录' };
    }
    if (code === 86038) {
      return { ok: true, state: 'expired', message: '二维码已失效，点击刷新' };
    }
    if (code === 0) {
      const cookie = extractCookies(json.data.url, res.headersRaw);
      if (!cookie || !cookie.includes('SESSDATA=')) {
        return { ok: false, state: 'error', message: '扫码成功但未获取到有效凭证' };
      }
      return { ok: true, state: 'confirmed', message: '扫码成功！', cookie };
    }

    return { ok: false, state: 'error', message: json.data.message || json.message || '未知状态' };
  } catch (e) {
    return { ok: false, state: 'error', message: String((e && e.message) || e) };
  }
}
