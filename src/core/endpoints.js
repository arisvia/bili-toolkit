/**
 * 端点表 —— 「哪些请求要处理、怎么处理」的唯一事实源。
 *
 * mode:
 *   'proxy' : 用 B 账号 Cookie 重发，响应直接替换页面的响应（**目前唯一实现的模式**）
 *
 * 沙箱侧只有出现在这张表里的 host + method + path 才允许携带 B 的 Cookie。
 */

export const ENDPOINTS = [
  // ---------- 普通视频 ----------
  {
    id: 'video-playurl',
    host: 'api.bilibili.com',
    method: 'GET',
    path: '/x/player/wbi/playurl',
    mode: 'proxy',
    kind: 'video',
    wbi: 'required' // 必须带 w_rid，参数改写后需要重签
  },
  {
    id: 'video-playurl-legacy',
    host: 'api.bilibili.com',
    method: 'GET',
    path: '/x/player/playurl',
    mode: 'proxy',
    kind: 'video',
    wbi: 'if-present'
  },
  {
    id: 'pgc-playurl',
    host: 'api.bilibili.com',
    method: 'GET',
    path: '/pgc/player/web/playurl',
    mode: 'proxy',
    kind: 'video',
    wbi: 'if-present'
  },
  {
    id: 'pgc-playurl-v2',
    host: 'api.bilibili.com',
    method: 'GET',
    path: '/pgc/player/web/v2/playurl',
    mode: 'proxy',
    kind: 'video',
    wbi: 'if-present'
  },
  {
    id: 'pgc-playurl-v2-post',
    host: 'api.bilibili.com',
    method: 'POST',
    path: '/pgc/player/web/v2/playurl',
    mode: 'proxy',
    kind: 'ogv',
    csrf: true,
    wbi: 'if-present'
  },
  {
    id: 'pugv-playurl',
    host: 'api.bilibili.com',
    method: 'GET',
    path: '/pugv/player/web/playurl',
    mode: 'proxy',
    kind: 'video',
    wbi: 'if-present'
  },

  // ---------- 番剧 / OGV ----------
  {
    id: 'ogv-playview',
    host: 'api.bilibili.com',
    method: 'POST',
    path: '/ogv/player/playview',
    mode: 'proxy',
    kind: 'ogv',
    csrf: true, // csrf 必须替换为 B 的 bili_jct
    wbi: 'if-present'
  },
  {
    id: 'ogv-playurl-post',
    host: 'api.bilibili.com',
    method: 'POST',
    path: '/ogv/player/playurl',
    mode: 'proxy',
    kind: 'ogv',
    csrf: true,
    wbi: 'if-present'
  },

  // ---------- 直播 ----------
  {
    id: 'live-playinfo',
    host: 'api.live.bilibili.com',
    method: 'GET',
    path: '/xlive/web-room/v2/index/getRoomPlayInfo',
    mode: 'proxy',
    kind: 'live'
  },
  {
    id: 'live-playurl-legacy',
    host: 'api.live.bilibili.com',
    method: 'GET',
    path: '/room/v1/Room/playUrl',
    mode: 'proxy',
    kind: 'live'
  }
];

/**
 * 本地伪装 / 本地补写（不离开页面、不带 B 的 Cookie）。
 *
 * 为什么 `/x/player/wbi/v2` 放在这里而不是走代理：
 *   实测（tools/online-check.mjs）该接口的响应里**根本没有** accept_quality / accept_description，
 *   画质清单（accept_quality / support_formats）是在 playurl 响应里的，而那一份我们已经整体换成了 B 的。
 *   所以这里只需要把 vip 形状的字段改掉，避免播放器仅凭本地状态就隐藏高画质入口或弹付费墙。
 *
 *   如果将来出现「画质菜单仍然缺失」的情况，**先实测 playurl 响应里到底缺什么字段**
 *   （node tools/cdn-domains.mjs 旁边那套 request 打点最省事），再决定是本地补字段，
 *   还是真的需要双发合并。注意：merge 模式**目前没有实现**，
 *   光改这里没用，得同时在 proxy.js 里写出合并逻辑并放开 build.mjs 的校验。
 */
export const LOCAL_PATCH_PATHS = [
  { host: 'api.bilibili.com', path: '/x/player/wbi/v2' },
  { host: 'api.bilibili.com', path: '/x/player/v2' },
  { host: 'api.bilibili.com', path: '/x/web-interface/nav' },
  { host: 'api.bilibili.com', path: '/pgc/view/web/season' },
  { host: 'api.bilibili.com', path: '/pgc/view/web/ep/page' },
  { host: 'api.bilibili.com', path: '/pgc/season/episode/web/info' },
  { host: 'api.bilibili.com', path: '/pgc/season/player/ogv/cards' }
];

const BY_KEY = new Map();
for (const ep of ENDPOINTS) {
  BY_KEY.set(ep.host + '|' + ep.method + '|' + ep.path, ep);
}

/** 解析一个 URL + method 是否命中端点表；命中返回端点描述，否则 null */
export function resolveEndpoint(url, method) {
  let u;
  try {
    u = url instanceof URL ? url : new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const m = String(method || 'GET').toUpperCase();
  return BY_KEY.get(u.hostname + '|' + m + '|' + u.pathname) || null;
}