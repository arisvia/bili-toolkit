/**
 * 核对 B站播放器 bundle 里真实存在的功能开关 key。
 *
 *   node tools/player-keys.mjs
 *
 * 背景：网上流传的「强制 HDR / 8K」脚本里有一批 key 是虚构的，
 * 写进 localStorage 什么也不会发生。这个工具直接从播放器源码里核对。
 *
 * 已知结论（2026-10 实测，见 findings §20）：
 *   bilibili_player_force_hdr  真实 —— 只拆掉「显示能力」门，硬件探测仍生效
 *   bilibili_player_force_8k   真实 —— 直接短路浏览器类型/版本判断
 *   enableHEVCError            真实 —— sessionStorage，被设为 "1" 时播放器认定 HEVC 不可用
 *   bilibili_player_force_DolbyAtmos&8K&HDR  不存在（网上脚本编的）
 *
 * 不需要凭证，只读公开页面。
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' };

const NEEDLES = [
  'bilibili_player_force_hdr',
  'bilibili_player_force_8k',
  'bilibili_player_force_DolbyAtmos&8K&HDR',
  'enableHEVCError'
];

/** 页面里可能写成 https:\/\/ 或带多余斜杠，统一规整 */
function normalize(u) {
  return u.replace(/\\\//g, '/').replace(/^(https?:)\/{3,}/, '$1//');
}

const page = await (await fetch('https://www.bilibili.com/video/BV1PTHS6MEC5/', { headers: HEADERS })).text();

const urls = new Set();
for (const m of page.matchAll(/(?:https?:)?\\?\/\\?\/s1\.hdslb\.com[^"'()\\\s<>]+/g)) {
  const u = normalize(m[0]);
  urls.add(/^https?:/.test(u) ? u : 'https://' + u);
}
const scripts = [...urls].filter((u) => /\.js(\?|$)/.test(u));

let scanned = 0;
const hits = new Map(NEEDLES.map((n) => [n, []]));

for (const u of scripts) {
  let txt;
  try {
    const r = await fetch(u, { headers: HEADERS });
    if (!r.ok) continue;
    txt = await r.text();
  } catch {
    continue;
  }
  scanned++;
  for (const n of NEEDLES) {
    for (const m of txt.matchAll(new RegExp(n.replace(/[&]/g, '\\$&'), 'g'))) {
      const list = hits.get(n);
      if (list.length >= 2) break;
      list.push({
        file: u.split('/').pop().slice(0, 50),
        ctx: txt.slice(Math.max(0, m.index - 130), m.index + 190).replace(/\s+/g, ' ')
      });
    }
  }
}

console.log(`扫描 ${scanned}/${scripts.length} 个播放器脚本\n`);
for (const n of NEEDLES) {
  const list = hits.get(n);
  console.log(`${list.length ? '存在' : '不存在'}  ${n}`);
  for (const h of list) {
    console.log(`        ${h.file}`);
    console.log(`        …${h.ctx}…`);
  }
}

const missing = NEEDLES.filter((n) => !hits.get(n).length);
console.log(
  missing.length
    ? `\n注意：「不存在」只说明首屏加载的 bundle 里没有，播放器是 webpack 分包，按需 chunk 未覆盖。`
    : '\n全部命中。'
);