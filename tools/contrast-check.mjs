/**
 * 面板配色的对比度核算。
 *
 *   node tools/contrast-check.mjs
 *
 * 为什么要有这个：面板的标签色和主按钮色都带透明度，最终观感取决于它叠在
 * 面板底色上的结果。光看 CSS 变量看不出来 —— 半透明前景叠半透明底，
 * 对比度可能差出一档。眼睛在小图上看不出 3:1 和 4.5:1 的区别，
 * 但用户能感觉到「发灰」或「看不清」。
 *
 * 这里把「最终合成色」算出来再比，评级按 WCAG AA：
 *   ≥ 4.5 正文级（本次涉及的字号都属这一档）
 *   ≥ 3.0 仅可用于大号文字或纯装饰
 */
const lin = (c) => {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** 同时接受 `#rrggbb` 与 `rgba(r,g,b,a)`，后者缺 alpha 时按 1 */
const rgba = (s) => {
  const str = String(s).trim();
  if (str[0] === '#') return [...hex(str), 1];
  const m = str.match(/[\d.]+/g);
  if (!m) throw new Error('无法解析颜色：' + s);
  const n = m.map(Number);
  return [n[0], n[1], n[2], n[3] === undefined ? 1 : n[3]];
};
/** 把带透明度的颜色叠到底色上 */
const over = (fg, a, bg) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));
const ratio = (a, b) => {
  const l1 = lum(a);
  const l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

/** 面板底色：面板本身是半透明的，这里取它叠在页面上的结果 */
const PANEL = { light: [252, 252, 253], dark: [26, 26, 30] };

/**
 * 每组是 [主题, 名称, 前景, 背景, 是否基线]。
 * 基线是**修之前**的取值，留着是为了让「改好了多少」有对照，
 * 不参与达标判定 —— 否则工具会永远红着。
 */
const CASES = [
  ['light', '主按钮（旧：白字）', '#ffffff', 'rgba(0,150,136,.18)', true],
  ['light', '主按钮（现：深青字）', '#007065', 'rgba(0,150,136,.15)'],
  ['dark', '主按钮', '#d6fbf2', 'rgba(120,220,200,.24)'],
  // 账号池标签
  ['light', '标签 登录中', '#007065', 'rgba(0,150,136,.13)'],
  ['light', '标签 借用中', '#8c5200', 'rgba(230,162,60,.14)'],
  ['light', '标签 大会员', '#b82153', 'rgba(251,114,153,.14)'],
  ['light', '标签 非会员', 'rgba(20,22,26,.6)', 'rgba(20,22,26,.06)'],
  ['light', '标签 浏览器自带', 'rgba(20,22,26,.62)', 'transparent'],
  ['dark', '标签 登录中', '#7fe3cd', 'rgba(120,220,200,.16)'],
  ['dark', '标签 借用中', '#ffc966', 'rgba(230,162,60,.20)'],
  ['dark', '标签 大会员', '#ffa3be', 'rgba(251,114,153,.20)'],
  ['dark', '标签 非会员', 'rgba(255,255,255,.7)', 'rgba(255,255,255,.09)'],
  ['dark', '标签 浏览器自带', 'rgba(255,255,255,.55)', 'transparent'],
  // 粘性头部：内容会从底下滚过去，0.72 半透明磨砂底色叠在面板底色上
  ['light', '粘性头部', 'rgba(20,22,26,.9)', 'rgba(252,252,253,.72)'],
  ['dark', '粘性头部', 'rgba(255,255,255,.92)', 'rgba(30,30,34,.72)'],
  // 文本域内嵌操作图标（粘贴 / 清除）
  ['light', '文本域操作图标', 'rgba(20,22,26,.72)', 'rgba(20,22,26,.045)'],
  ['dark', '文本域操作图标', 'rgba(255,255,255,.72)', 'rgba(255,255,255,.07)']
];
let failed = 0;
console.log('配色'.padEnd(26) + '对比度   评级');
console.log('-'.repeat(52));
for (const [theme, name, fg, bg, baseline] of CASES) {
  const base = PANEL[theme];
  const b = bg === 'transparent' ? [0, 0, 0, 0] : rgba(bg);
  const backdrop = b[3] ? over(b.slice(0, 3), b[3], base) : base;
  const f = rgba(fg);
  const color = over(f.slice(0, 3), f[3], backdrop);
  const r = ratio(color, backdrop);
  const ok = r >= 4.5;
  if (!ok && !baseline) failed++;
  const mark = baseline ? '\x1b[90m' : ok ? '\x1b[32m' : '\x1b[31m';
  const level = baseline ? '修复前基线' : ok ? 'AA 达标' : r >= 3 ? '仅够大字/装饰' : '不达标';
  console.log(`${(theme + ' ' + name).padEnd(26)}` + r.toFixed(2).padStart(6) + '   ' + mark + level + '\x1b[0m');
}

console.log('');
if (failed) {
  console.error(`\x1b[31m${failed} 组未达 AA（正文级 4.5:1）\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32m全部达到 WCAG AA 正文级对比度\x1b[0m');