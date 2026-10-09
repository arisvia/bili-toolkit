/** Cookie 字符串的解析、清洗、补齐与脱敏。 */
import { DEVICE_COOKIE_BACKFILL } from '../config.js';

/**
 * 清洗粘贴的 Cookie：从 DevTools 复制常带换行、制表符，
 * 这里统一成 "; " 分隔。不会破坏 cookie 值本身。
 */
export function sanitizeCookie(input) {
  return String(input || '')
    .replace(/\r?\n/g, '; ')
    .replace(/\t/g, '; ')
    .replace(/;\s*;/g, '; ')
    .trim();
}

/** 解析成对象；同名键后者覆盖前者 */
export function parseCookie(str) {
  const out = {};
  for (const part of String(str || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = part.slice(i + 1).trim();
  }
  return out;
}

/** 取单个字段 */
export function cookieField(str, name) {
  return parseCookie(str)[name] || '';
}

/**
 * 校验 B 账号 Cookie 的完整性。
 * 分级说明见 cookie-parse.js；这里只负责给出「缺什么、严不严重」。
 * 返回 ok=false 时 problems 里是硬性缺失；warnings 是建议补齐项（不阻断）。
 */
export function validateCookie(str) {
  const p = parseCookie(str);
  const problems = [];
  const warnings = [];

  if (!p.SESSDATA) {
    problems.push('缺少 SESSDATA —— 这是登录态，没有它任何权益都借不到');
    return { ok: false, problems, warnings, parsed: p }; // 没有它其余检查无意义
  }
  if (!p.DedeUserID) warnings.push('缺少 DedeUserID（账号 UID，建议带上）');
  if (!p.buvid3 && !p.buvid4) warnings.push('缺少 buvid3/buvid4（设备指纹，容易触发 -412）');
  if (!p.bili_jct && !p['bili-jct']) {
    warnings.push('缺少 bili_jct（番剧 OGV 必需 —— playview 是 POST 接口要用 csrf）');
  }
  return { ok: problems.length === 0, problems, warnings, parsed: p };
}

/**
 * 补齐设备级 Cookie。
 * 策略：只补「B 里没有、且确实是设备级」的键；身份相关的（SESSDATA / bili_jct / sid）绝不混用 A 的。
 */
export function backfillDeviceCookies(bCookie, aCookie) {
  const b = parseCookie(bCookie);
  const a = parseCookie(aCookie);

  // bili_jct 也允许补齐：它是 CSRF token，不是密码学绑定的身份凭证，
  // 而番剧 OGV 的 playview 是 POST 接口，必须带 csrf。
  // 注意必须在提前返回之前判断，否则 B 缺少 bili_jct 时补不上。
  const needJct = !(b.bili_jct || b['bili-jct']) && !!(a.bili_jct || a['bili-jct']);
  const missing = DEVICE_COOKIE_BACKFILL.filter((k) => !b[k] && a[k]);
  if (!missing.length && !needJct) return bCookie;

  const parts = String(bCookie).split(';').map((s) => s.trim()).filter(Boolean);
  const have = new Set(parts.map((s) => s.slice(0, s.indexOf('=')).trim()));
  for (const k of missing) {
    if (have.has(k)) continue;
    parts.push(`${k}=${a[k]}`);
  }
  if (needJct && !have.has('bili_jct')) parts.push('bili_jct=' + (a.bili_jct || a['bili-jct']));
  return parts.join('; ');
}

/** 脱敏显示，绝不把完整 SESSDATA 打到日志里 */
export function maskCookie(str) {
  const p = parseCookie(str);
  if (!p.SESSDATA) return '（未设置或缺少 SESSDATA）';
  const s = p.SESSDATA;
  const head = s.slice(0, 4);
  const tail = s.slice(-3);
  const n = Object.keys(p).length;
  return `mid=${p.DedeUserID || '?'} SESSDATA=${head}***${tail} (${n} 项)`;
}

/** 生成一个不会泄露内容的指纹，用于判断「换了 B 账号」 */
export function cookieFingerprint(str) {
  const s = cookieField(str, 'SESSDATA');
  if (!s) return 'none';
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}