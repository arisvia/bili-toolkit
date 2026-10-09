/**
 * WBI 签名（B 站接口鉴权）。
 *
 * 正确流程：
 *   1. 取 img_key / sub_key —— 现以 /x/web-interface/nav 的 data.wbi_img 为主源
 *      （旧的 /x/web-interface/wbi/img 已下线，见 session.js 与 docs/findings.md）
 *   2. 按固定置换表拼出 32 位 mixinKey
 *   3. 参数（含 wts）按 key 升序、值做 encodeURIComponent 并去掉 !'()* 后拼接
 *   4. md5(query + mixinKey) -> w_rid
 *
 * 关于「改参数不重签会 -403」：实测服务端**当前并不校验** w_rid
 * （带签名 / 全零签名 / 完全不带都返回 code=0）。
 * 重签保留是为了「万一恢复校验」，且改参数后重签总是安全的，
 * 但不要把它当成当前生效的必要步骤。
 */
import { md5 } from './md5.js';


const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28,
  14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54,
  21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
];

/** 由 img_key + sub_key 拼出 mixinKey（截前 32 位） */
export function buildMixinKey(imgKey, subKey) {
  const raw = String(imgKey) + String(subKey);
  let out = '';
  for (let i = 0; i < 32; i++) out += raw[MIXIN_KEY_ENC_TAB[i]];
  return out;
}

/**
 * 从响应里抽出 img_key / sub_key 并预先算好 mixinKey。
 * 兼容两种形状：
 *   /x/web-interface/wbi/img  -> data.img_url / data.sub_url
 *   /x/web-interface/nav      -> data.wbi_img.img_url / data.wbi_img.sub_url
 */
export function extractWbiKeys(json) {
  const d = json && json.data;
  if (!d) return null;
  const src = d.img_url && d.sub_url ? d : d.wbi_img;
  if (!src || !src.img_url || !src.sub_url) return null;
  const imgUrl = String(src.img_url);
  const subUrl = String(src.sub_url);
  const imgKey = imgUrl.slice(imgUrl.lastIndexOf('/') + 1, imgUrl.lastIndexOf('.'));
  const subKey = subUrl.slice(subUrl.lastIndexOf('/') + 1, subUrl.lastIndexOf('.'));
  if (!imgKey || !subKey) return null;
  return { imgKey, subKey, mixinKey: buildMixinKey(imgKey, subKey) };
}

/** URLSearchParams -> 有序的待签名字符串（wts 已放进 params，这里不再追加） */
function buildQueryString(params) {
  const pairs = [];
  for (const [k, v] of params.entries()) {
    if (v === null || v === undefined) continue;
    const ek = encodeURIComponent(k);
    const ev = encodeURIComponent(String(v)).replace(/[!'()*]/g, '');
    pairs.push([ek, ev]);
  }
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join('&');
}

/**
 * 给 URL 补/重算 w_rid。
 * @param {URL} url 待签名的 URL（不会被修改）
 * @param {string} mixinKey
 * @returns {URL} 含正确 wts / w_rid 的新 URL
 */
export function signUrl(url, mixinKey) {
  const u = new URL(url.href);
  u.searchParams.delete('w_rid');
  u.searchParams.set('wts', String(Math.floor(Date.now() / 1000)));
  const qs = buildQueryString(u.searchParams);
  u.searchParams.set('w_rid', md5(qs + mixinKey));
  return u;
}

/** 判断一个 URL 是否已经带 wbi 签名 */
export function hasWbiSignature(url) {
  try {
    const u = url instanceof URL ? url : new URL(url);
    return u.searchParams.has('w_rid') && u.searchParams.has('wts');
  } catch {
    return false;
  }
}
