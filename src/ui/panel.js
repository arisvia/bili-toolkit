/**
 * 液态玻璃悬浮面板 —— 全脚本唯一的配置入口。
 *
 * 设计要点：
 *   · 只有一个入口：徽标点开就是全部设置，菜单命令也全部指向这里，不再出现
 *     「菜单里一份、弹窗里又一份」的重复配置。
 *   · 紧凑：默认只是一个 30px 的玻璃圆点，展开后是一块 ~320px 的面板。
 *   · 实时：画质 / 分辨率 / 码率 / 编码 / 缓存命中每秒刷新，不需要手动开面板看。
 *   · 自适应明暗：跟随页面的 prefers-color-scheme。
 */
import { NS, QUALITY_PRESETS, LIVE_QN_PRESETS } from '../config.js';
import { NAME, VERSION } from '../meta.js';
import { store } from '../core/store.js';
import { parseCookieText, pickFields, joinCookie, sortFields, tierOf } from '../core/cookie-parse.js';
import { TEXT } from '../core/text.js';
import { strategyLabel, invalidateMixinKey, quickCheck, hasCookie, cookieProblem } from '../core/session.js';
import { overview, overviewAsync, saveAccount, testAccount, reprobe, useAsBorrowSource, useAutoBorrowSource, switchLoginTo, forgetAccount, renamePoolAccount, importBrowserAccount, saveAndApplyScannedAccount } from '../core/switcher.js';
import { fetchQrCode, pollQrCode } from '../core/qr-login.js';
import { REGION_MODES } from '../core/region.js';
import { stats, qualityName, codecName, exportLog, setDebug, isDebug } from '../core/log.js';
import { resetCache, cacheStats } from '../core/proxy.js';
import { pushConfig, getToken, isHookAlive, getHookSelfCheck, pingHook } from '../core/bus.js';
import { liveConfig } from '../core/inject.js';

const ID = NS + '-panel';
const TITLE = NAME;
let root = null;
let bodyEl = null;
let open = false;
let tickTimer = null;
/**
 * 账号池的重绘函数。
 *
 * 单独提到模块级，是因为账号数据可能在面板打开期间被改掉：
 * 面板外导入账号、菜单里切号、甚至用户自己登了另一个号。
 * 只在构建时渲染一次的话，展开看到的一直是旧数据。
 */
let rerenderPool = null;

/* ---------------- 液态玻璃样式 ---------------- */
const CSS = `
#${ID}, #${ID} * { box-sizing: border-box; }
#${ID} {
  position: fixed; left: 12px; bottom: 12px; z-index: 2147483647;
  font: 13px/1.6 "PingFang SC","Microsoft YaHei",-apple-system,sans-serif;
  color: var(--fg);
  -webkit-font-smoothing: antialiased;
  /* 统一度量变量：面板与内部控件的宽度计算共用，避免各处 padding 写死 */
  --pad-x: 14px;
  --mono: Consolas, Monaco, "SF Mono", monospace;
}
#${ID} *, #${ID} *::before, #${ID} *::after { box-sizing: border-box; }
#${ID} .glass {
  background: var(--bg);
  -webkit-backdrop-filter: blur(22px) saturate(180%);
  backdrop-filter: blur(22px) saturate(180%);
  border: 1px solid var(--bd);
  box-shadow: 0 10px 34px var(--sh), inset 0 1px 0 var(--hl);
  border-radius: 18px;
}
#${ID} .dot {
  width: 34px; height: 34px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; user-select: none; position: relative;
  transition: transform .18s cubic-bezier(.2,.8,.2,1);
}
#${ID} .dot:active { transform: scale(.92); }
#${ID} .dot::after {
  content: ''; position: absolute; inset: -3px; border-radius: 50%;
  border: 1.5px solid var(--ring); opacity: 0; transition: opacity .2s;
}
#${ID} .dot.on::after { opacity: 1; animation: ${ID}-pulse 2.4s ease-out infinite; }
@keyframes ${ID}-pulse {
  0% { transform: scale(1); opacity: .8; }
  70% { transform: scale(1.55); opacity: 0; }
  100% { transform: scale(1.55); opacity: 0; }
}
#${ID} .face { width: 15px; height: 15px; border-radius: 50%; background: var(--dotc); transition: background .25s; }
#${ID} .badge {
  position: absolute; top: -5px; right: -5px; min-width: 15px; height: 15px;
  padding: 0 4px; border-radius: 8px; background: #fb7299; color: #fff;
  font-size: 10px; line-height: 15px; text-align: center; font-weight: 600;
  box-shadow: 0 0 0 2px var(--bg);
}
#${ID} .dock-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}
#${ID} .dock-tray {
  position: absolute;
  bottom: 42px;
  left: 0;
  min-width: 160px;
  max-width: 240px;
  padding: 8px 10px;
  border-radius: 14px;
  opacity: 0;
  transform: translateY(6px) scale(.96);
  pointer-events: none;
  transition: opacity .18s cubic-bezier(.2,.8,.2,1), transform .18s cubic-bezier(.2,.8,.2,1);
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 10;
  box-shadow: 0 10px 30px var(--sh), inset 0 1px 0 var(--hl);
}
#${ID} .dock-wrap:hover .dock-tray,
#${ID} .dock-wrap:focus-within .dock-tray {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}
#${ID} .panel.show ~ .dock-wrap .dock-tray {
  display: none !important;
}
#${ID} .dock-tray-head {
  font-size: 11px;
  font-weight: 600;
  opacity: .55;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--sep);
}
#${ID} .dock-tray-empty {
  font-size: 11.5px;
  opacity: .45;
  padding: 4px 2px;
}
#${ID} .dock-tray-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 200px;
  overflow-y: auto;
  scrollbar-width: thin;
}
#${ID} .dock-tray-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 6px;
  border-radius: 8px;
  cursor: pointer;
  transition: background .14s;
  font-size: 12px;
}
#${ID} .dock-tray-item:hover,
#${ID} .dock-tray-item:focus-visible {
  background: var(--hov);
  outline: none;
}
#${ID} .dock-tray-item.active {
  background: var(--hov2);
}
#${ID} .dock-tray-item.disabled {
  opacity: .5;
  cursor: not-allowed;
}
#${ID} .dock-tray-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#${ID} .dot-avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}
#${ID} .dot.has-avatar .face {
  position: absolute;
  right: 1px;
  bottom: 1px;
  width: 9px;
  height: 9px;
  border: 1.5px solid var(--bg);
}
#${ID} .dot.has-avatar .dot-vip-badge {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: linear-gradient(135deg, #ffd700, #ff8c00);
  border: 1.5px solid var(--bg);
  box-shadow: 0 0 4px rgba(255, 215, 0, .6);
}
#${ID} .panel {
  width: 324px; max-height: min(78vh, 620px); margin-bottom: 10px;
  overflow: hidden auto; display: none;
  scrollbar-width: thin; scrollbar-color: var(--sb) transparent;
  overscroll-behavior: contain;
}
/* 玻璃面板上默认滚动条太重，这里自定义：细、无轨道、悬停才显形 */
#${ID} .panel::-webkit-scrollbar { width: 8px; }
#${ID} .panel::-webkit-scrollbar-track { background: transparent; }
#${ID} .panel::-webkit-scrollbar-thumb {
  background: var(--sb); border-radius: 99px;
  border: 2px solid transparent; background-clip: content-box;
}
#${ID} .panel::-webkit-scrollbar-thumb:hover { background: var(--sb2); background-clip: content-box; }
#${ID} .panel.show { display: block; animation: ${ID}-in .28s cubic-bezier(.16, 1, .3, 1); }
@keyframes ${ID}-in { from { opacity: 0; transform: translateY(10px) scale(.97); } to { opacity: 1; transform: none; } }
#${ID} .head {
  display: flex; align-items: center; gap: 8px; padding: 12px var(--pad-x) 10px;
  position: sticky; top: 0; z-index: 2;
  background: var(--bg-head);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--sep);
  box-shadow: 0 4px 18px -4px var(--sh), inset 0 1px 0 var(--hl);
}
#${ID} .title {
  font-size: 13.5px; font-weight: 650; flex: 1; letter-spacing: .2px;
  display: flex; align-items: center; gap: 7px;
}
#${ID} .title::before {
  content: ''; width: 8px; height: 8px; border-radius: 50%;
  background: linear-gradient(135deg, #fb7299, #00a396);
  box-shadow: 0 0 8px var(--ring);
  display: inline-block; flex-shrink: 0;
}
#${ID} .ver {
  font-size: 10px; font-weight: 600; font-family: var(--mono);
  padding: 1.5px 8px; border-radius: 99px;
  background: var(--hov2); border: 1px solid var(--ring-soft);
  color: var(--fg); opacity: .85; line-height: 1.4;
  box-shadow: inset 0 1px 0 var(--hl);
}
#${ID} .x {
  cursor: pointer; opacity: .6; font-size: 13px; line-height: 1;
  width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center;
  border-radius: 50%; border: 1px solid transparent;
  transition: opacity .18s, background .18s, transform .22s cubic-bezier(.16,1,.3,1), border-color .18s;
}
#${ID} .x:hover {
  opacity: 1; background: var(--hov); border-color: var(--sep); transform: rotate(90deg);
}
#${ID} .sec { padding: 10px var(--pad-x); border-top: 1px solid var(--sep); }
/* 中文不需要字距/大写；数字类标签靠 opacity 拉开层次即可 */
#${ID} .lbl { font-size: 10.5px; opacity: .45; margin-bottom: 7px; font-weight: 600; }
#${ID} .row { display: flex; align-items: center; gap: 8px; min-height: 28px; }
#${ID} .row + .row { margin-top: 4px; }
#${ID} .row > span:first-child { flex: 0 0 74px; font-size: 12px; opacity: .72; }
#${ID} .seg {
  display: flex; gap: 2px; padding: 3px; border-radius: 11px;
  background: var(--hov); border: 1px solid var(--sep); flex: 1;
}
#${ID} .seg button {
  flex: 1; border: 0; background: transparent; color: var(--fg); cursor: pointer;
  font-size: 11.5px; padding: 5px 2px; border-radius: 8px; opacity: .58;
  transition: opacity .16s, background .2s, box-shadow .2s, transform .1s;
  white-space: nowrap; -webkit-tap-highlight-color: transparent;
}
#${ID} .seg button:hover { opacity: .92; }
#${ID} .seg button:active { transform: scale(.96); }
#${ID} .seg button.on {
  background: var(--seg-on); opacity: 1; font-weight: 600;
  box-shadow: 0 1px 4px var(--sh), inset 0 1px 0 var(--hl);
}
#${ID} .txt {
  /* 必须显式 width:100% —— 这些文本域直接挂在 .sec 下，不是 flex 子项，
     只写 flex:1 会退化成内容宽度（实测面板内区 284px 却只占 164px）。 */
  display: block; width: 100%; box-sizing: border-box;
  padding: 9px 11px; border-radius: 10px; border: 1px solid var(--sep);
  background: var(--hov); color: var(--fg); font-size: 12px; line-height: 1.65;
  font-family: var(--mono); resize: vertical; min-height: 74px; outline: none;
  transition: border-color .18s, box-shadow .18s, background .18s;
}
#${ID} .txt::placeholder { color: var(--fg); opacity: .28; }
#${ID} .txt:hover { border-color: var(--bd2); }
#${ID} .txt:focus {
  border-color: var(--ring); background: var(--hov2);
  box-shadow: 0 0 0 3px var(--ring-soft);
}
#${ID} .txt::-webkit-scrollbar { width: 6px; }
#${ID} .txt::-webkit-scrollbar-track { background: transparent; }
#${ID} .txt::-webkit-scrollbar-thumb { background: var(--sb); border-radius: 99px; }
#${ID} .ta-wrap { position: relative; width: 100%; box-sizing: border-box; }
#${ID} .ta-wrap .txt { padding-right: 28px; }
#${ID} .ta-action {
  position: absolute; top: 6px; right: 6px; width: 20px; height: 20px; border-radius: 6px;
  border: 1px solid transparent; background: transparent; color: var(--fg); opacity: .72;
  font-size: 11px; line-height: 1; display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: opacity .16s, background .16s, border-color .16s; padding: 0;
}
#${ID} .ta-action:hover { opacity: .95; background: var(--hov2); border-color: var(--sep); }
#${ID} .msg { font-size: 11.5px; margin-top: 6px; white-space: pre-line; line-height: 1.5; }
#${ID} .btns { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
#${ID} button.act {
  border: 1px solid var(--sep); background: var(--hov); color: var(--fg);
  border-radius: 9px; padding: 5px 11px; font-size: 11.5px; cursor: pointer;
  transition: background .16s, transform .1s, border-color .16s, box-shadow .16s;
  white-space: nowrap; -webkit-tap-highlight-color: transparent;
}
#${ID} button.act:hover { background: var(--hov2); border-color: var(--bd2); }
#${ID} button.act:active { transform: scale(.97); }
#${ID} button.act:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--ring-soft); }
#${ID} button.act:disabled { opacity: .45; cursor: default; transform: none; }
/*
 * 主按钮。
 *
 * 两个坑，都踩过：
 *  1. 顶部那道白条来自 inset 0 1px 0 var(--hl) —— --hl 是给玻璃面板用的
 *     顶部高光，浅色主题下是 rgba(255,255,255,.75)，放在按钮上就是一条白边。
 *     按钮自己用 --btn-hl，强度低一个量级。
 *  2. 文字写死 #fff 在浅色主题下几乎看不见：--pri 只有 18% 不透明度，
 *     白字对比度约 1.5:1。所以前景色随主题走：浅色用深青，深色用浅青。
 */
#${ID} button.act.pri {
  background: var(--pri); border-color: transparent;
  color: var(--pri-fg); font-weight: 600;
  box-shadow: inset 0 1px 0 var(--btn-hl), 0 1px 3px var(--sh);
}
#${ID} button.act.pri:hover { background: var(--pri-hover); }
#${ID} button.act.pri:active { filter: none; }
#${ID} .dot:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--ring-soft); }
#${ID} .live { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; align-items: baseline; }
#${ID} .live .k { font-size: 11.5px; opacity: .6; }
#${ID} .live .v { font-size: 12.5px; font-variant-numeric: tabular-nums; }
#${ID} .live .v.big { font-size: 17px; font-weight: 650; letter-spacing: -.01em; }
/*
 * 诊断区：原来是 2 列网格 ×4 行 = 8 格，占掉将近一屏高度。
 * 数字之间没有先后关系，压成一行即可，窄屏自然换行。
 */
#${ID} .stats { display: flex; flex-wrap: wrap; gap: 3px 12px; align-items: baseline; }
#${ID} .stats .s { display: inline-flex; gap: 4px; align-items: baseline; }
#${ID} .stats .s .k { font-size: 10.5px; opacity: .55; }
#${ID} .stats .s .v { font-size: 12px; font-variant-numeric: tabular-nums; font-weight: 600; }

/*
 * 标签。
 *
 * 之前「大会员」用浅底彩字、「登录中 / 借用中」用实底色 —— 两套风格混排。
 * 而且实底色上的文字继承 --fg：深色主题下变成白字压在饱和青/粉上，
 * 对比度只有约 3:1，看得清但不舒服。
 * 统一成浅底 + 同色系深字，两套主题都能保证可读。
 */
#${ID} .tag {
  font-size: 9.5px; line-height: 1.5; padding: 1px 6px; border-radius: 99px;
  flex-shrink: 0; white-space: nowrap;
}
#${ID} .tag.on    { background: var(--tag-on-bg);    color: var(--tag-on-fg); }
#${ID} .tag.borrow { background: var(--tag-borrow-bg); color: var(--tag-borrow-fg); }
#${ID} .tag.vip    { background: var(--tag-vip-bg);    color: var(--tag-vip-fg); }
#${ID} .tag.plain  { background: var(--tag-plain-bg);  color: var(--tag-plain-fg); }
#${ID} .tag.muted  { background: transparent; color: var(--tag-muted-fg); }
#${ID} .avatar {
  width: 24px; height: 24px; border-radius: 50%; object-fit: cover;
  flex-shrink: 0; border: 1px solid var(--sep); background: var(--hov2);
}
#${ID} .avatar-initial {
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 600; opacity: .8;
}
#${ID} .hero {
  display: flex; align-items: baseline; gap: 9px; margin-bottom: 8px;
  padding: 8px 12px; border-radius: 12px;
  background: var(--hov); border: 1px solid var(--sep);
}
#${ID} .hero .q { font-size: 26px; font-weight: 700; letter-spacing: -.02em; }
#${ID} .hero .sub {
  font-size: 11.5px; opacity: .72; padding: 2px 7px;
  border-radius: 99px; background: var(--hov2); border: 1px solid var(--sep);
}
#${ID} .hint { font-size: 10.5px; opacity: .42; line-height: 1.5; margin-top: 6px; }
#${ID} pre.help {
  white-space: pre-wrap; word-break: break-word; margin: 6px 0 0;
  font: 10.5px/1.65 var(--mono); opacity: .78;
  background: var(--hov); border-radius: 10px; padding: 9px 11px;
  /* 中文在等宽字体里是双宽，视觉行数约为字符数的一半 —— 排版时别按字符数估。
     420px 是量出来的：区域那节的代理分流规则刚好放得下，不必出现「像被截断」的观感。 */
  max-height: 420px; overflow: auto;
  scrollbar-width: thin; scrollbar-color: var(--sb) transparent;
}
#${ID} pre.help::-webkit-scrollbar { width: 6px; height: 6px; }
#${ID} pre.help::-webkit-scrollbar-track { background: transparent; }
#${ID} pre.help::-webkit-scrollbar-thumb { background: var(--sb); border-radius: 99px; }
#${ID} details { margin-top: 6px; }
#${ID} summary {
  cursor: pointer; font-size: 11.5px; opacity: .6; list-style: none;
  transition: opacity .16s; padding: 2px 0;
}
#${ID} summary:hover { opacity: .95; }
#${ID} summary::-webkit-details-marker { display: none; }
#${ID} summary::before { content: '▸ '; display: inline-block; transition: transform .18s; }
#${ID} details[open] summary::before { content: '▾ '; }

@media (prefers-color-scheme: dark) {
  #${ID} {
    --fg: rgba(255,255,255,.92); --bg: rgba(28,28,32,.6); --bd: rgba(255,255,255,.13);
    --hl: rgba(255,255,255,.1); --sh: rgba(0,0,0,.5); --ring: rgba(120,220,200,.6);
    --ring-soft: rgba(120,220,200,.16); --sb: rgba(255,255,255,.16); --sb2: rgba(255,255,255,.28);
    --dotc: #6fd3bd; --hov: rgba(255,255,255,.07); --hov2: rgba(255,255,255,.13);
    --seg-on: rgba(255,255,255,.15); --sep: rgba(255,255,255,.085); --bd2: rgba(255,255,255,.22);
    --pri: rgba(120,220,200,.24); --pri-hover: rgba(120,220,200,.34); --pri-fg: #d6fbf2;
    --bg-head: rgba(30,30,34,.72);
    --btn-hl: rgba(255,255,255,.14);
    --tag-on-bg: rgba(120,220,200,.16); --tag-on-fg: #7fe3cd;
    --tag-borrow-bg: rgba(230,162,60,.20); --tag-borrow-fg: #ffc966;
    --tag-vip-bg: rgba(251,114,153,.20); --tag-vip-fg: #ffa3be;
    --tag-plain-bg: rgba(255,255,255,.09); --tag-plain-fg: rgba(255,255,255,.7);
    --tag-muted-fg: rgba(255,255,255,.55);
  }
}
@media (prefers-color-scheme: light) {
  #${ID} {
    --fg: rgba(20,22,26,.9); --bg: rgba(255,255,255,.56); --bd: rgba(20,22,26,.1);
    --hl: rgba(255,255,255,.75); --sh: rgba(20,22,26,.14); --ring: rgba(0,160,150,.55);
    --ring-soft: rgba(0,150,136,.14); --sb: rgba(20,22,26,.16); --sb2: rgba(20,22,26,.28);
    --dotc: #00a396; --hov: rgba(20,22,26,.045); --hov2: rgba(20,22,26,.09);
    --seg-on: rgba(255,255,255,.95); --sep: rgba(20,22,26,.075); --bd2: rgba(20,22,26,.16);
    --pri: rgba(0,150,136,.15); --pri-hover: rgba(0,150,136,.24);
    --bg-head: rgba(252,252,253,.72);
    /*
     * 前景色是算出来的，不是挑出来的（npm run check:contrast）：
     *   #ffffff   → 1.27:1（几乎不可见，就是「按钮发白看不清」的由来）
     *   #00796b   → 4.35:1（差一点点）
     *   #007065   → 4.90:1 ← 取这个，再深就偏暗绿、失去「强调色」的意思
     */
    --pri-fg: #007065;
    --btn-hl: rgba(255,255,255,.5);
    --tag-on-bg: rgba(0,150,136,.13); --tag-on-fg: #007065;
    --tag-borrow-bg: rgba(230,162,60,.14); --tag-borrow-fg: #8c5200;
    --tag-vip-bg: rgba(251,114,153,.14); --tag-vip-fg: #b82153;
    --tag-plain-bg: rgba(20,22,26,.06); --tag-plain-fg: rgba(20,22,26,.6);
    --tag-muted-fg: rgba(20,22,26,.62);
  }
}
`;

function ensureStyle() {
  if (document.getElementById(ID + '-css')) return;
  const st = document.createElement('style');
  st.id = ID + '-css';
  st.textContent = CSS;
  (document.head || document.documentElement).appendChild(st);
}

/* ---------------- 构建 ---------------- */

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** cookie-parse 的分级 → 面板标签配色 */
const TAG_KIND = {
  required: 'vip',
  ogv: 'borrow',
  identity: 'on',
  auto: 'muted',
  optional: 'plain'
};

function section(title) {
  const s = el('div', 'sec');
  if (title) s.appendChild(el('div', 'lbl', title));
  return s;
}

/**
 * 分段选择器。
 *
 * `cur` 必须跟着点击一起变。曾经直接拿构建时传入的 `current` 做判断，
 * 于是「一开始选中的那一项」在用户点到别处之后就再也点不回来了 ——
 * 界面上看着能点，实际什么都不发生，只能刷新页面。
 * 典型症状：界面伪装默认开，关掉之后开不回来；画质选过 4K 就回不到「最高」。
 */
function segmented(options, current, onPick) {
  const seg = el('div', 'seg');
  let cur = current;
  for (const o of options) {
    const b = el('button', o.value === cur ? 'on' : '', o.label);
    b.title = o.title || o.label;
    b.addEventListener('click', () => {
      if (o.value === cur) return;
      onPick(o.value);
      cur = o.value;
      for (const x of seg.children) x.className = '';
      b.className = 'on';
    });
    seg.appendChild(b);
  }
  return seg;
}

function row(label, control) {
  const r = el('div', 'row');
  r.appendChild(el('span', '', label));
  r.appendChild(control);
  return r;
}

/** 折叠说明：主界面只留标题，长文案点开才看 */
function details(summary, text) {
  const d = el('details');
  d.appendChild(el('summary', '', summary));
  d.appendChild(el('pre', 'help', text));
  return d;
}

function state() {
  if (!store.isEnabled()) return { ok: false, dot: '#9aa0a6', note: TEXT.badge.off };
  if (!hasCookie()) return { ok: false, dot: '#fb7299', note: TEXT.badge.needSetup };
  if (!isHookAlive()) return { ok: false, dot: '#e6a23c', note: TEXT.badge.notReady };
  if (stats.proxyFail > 0 && stats.proxyOk === 0) return { ok: false, dot: '#f56c6c', note: TEXT.badge.failing };
  return { ok: true, dot: '', note: '' };
}

/**
 * 任何会改变「下一次 playurl 请求长什么样」的操作都必须走这里：
 *   resetCache() + invalidateMixinKey() + pushConfig()
 *
 * 为什么菜单也要用：菜单改的是同一份设置（画质 / 区域 / 开关 / 重探），
 * 但曾经只调 store.setX + refreshPanel() 收尾。后果分两种：
 *   · 画质：URL 稳定的端点（/x/player/playurl 等）缓存仍命中，
 *     于是「切了档位但画质没变」能持续一个 TTL（120 秒）。
 *   · 重探：markProbed 可能把 resolveBorrow() 指向**另一个账号**，
 *     而缓存里还是上一个账号的播放地址，同样要一个 TTL 才自愈。
 */
function afterChange() {
  resetCache();
  invalidateMixinKey();
  pushConfig(liveConfig(getToken()));
  renderLive();
}
/** 供菜单命令复用：改完设置后必须走同一套失效，不能只刷界面。 */
export function invalidateAfterSettingsChange() {
  afterChange();
  refreshPanel();
}

/* ---------------- 面板内容 ---------------- */

function buildPanel(body) {
  /* --- 实时状态 --- */
  const live = section(TEXT.liveTitle);
  live.id = ID + '-live';
  body.appendChild(live);
  renderLive();

  /* --- 开关（用分段控件代替 checkbox，更紧凑） --- */
  const sw = section();
  const onOff = segmented(
    [
      { value: true, label: TEXT.switches.enabled },
      { value: false, label: TEXT.switches.disabled }
    ],
    store.isEnabled(),
    (v) => {
      store.setEnabled(v);
      afterChange();
    }
  );
  sw.appendChild(row(TEXT.switches.borrow, onOff));
  body.appendChild(sw);

  /* --- 画质 --- */
  const q = section(TEXT.quality.title);
  const qOpts = Object.entries(QUALITY_PRESETS).map(([k, v]) => ({
    value: k,
    label: { max: '最高', uhd: '4K', hd60: '1080P60', hd: '1080P' }[k] || k,
    title: `${v.label}（qn=${v.qn}）`
  }));
  q.appendChild(row(TEXT.quality.video, segmented(qOpts, store.getQuality(), (v) => {
    store.setQuality(v);
    afterChange();
  })));

  const lOpts = Object.entries(LIVE_QN_PRESETS).map(([k]) => ({
    value: k,
    label: { max: '原画', blue: '蓝光', super: '超清' }[k] || k
  }));
  q.appendChild(row(TEXT.quality.live, segmented(lOpts, store.getLiveQn(), (v) => {
    store.setLiveQn(v);
    afterChange();
  })));

  const cOpts = Object.entries(TEXT.codec.presets).map(([k, label]) => ({
    value: k,
    label,
    title: TEXT.codec.titles[k] || label
  }));
  q.appendChild(row(TEXT.codec.label, segmented(cOpts, store.getCodec(), (v) => {
    store.setCodec(v);
    afterChange();
  })));

  q.appendChild(el('div', 'hint', TEXT.quality.brief));
  q.appendChild(details(TEXT.quality.title + '怎么用', TEXT.quality.detail));
  q.appendChild(details(TEXT.codec.detailTitle, TEXT.codec.detail));
  body.appendChild(q);

  /* --- 区域 --- */
  const reg = section(TEXT.region.title);
  const rOpts = Object.entries(REGION_MODES).map(([k, v]) => ({ value: k, label: v.label, title: v.hint }));
  reg.appendChild(row(TEXT.region.label, segmented(rOpts, store.getRegion(), (v) => {
    store.setRegion(v);
    afterChange();
    regHint.textContent = TEXT.region.brief[v];
  })));
  const regHint = el('div', 'hint', TEXT.region.brief[store.getRegion()]);
  reg.appendChild(regHint);
  reg.appendChild(details(TEXT.region.detailTitle, TEXT.region.detail));
  body.appendChild(reg);

  /* --- 其它开关 --- */
  const misc = section();
  const onOffSeg = (v, set) =>
    segmented([{ value: true, label: TEXT.switches.on }, { value: false, label: TEXT.switches.off }], v, set);
  misc.appendChild(row(TEXT.switches.ui, onOffSeg(store.isPatchUi(), (v) => { store.setPatchUi(v); afterChange(); })));
  misc.appendChild(row(TEXT.switches.prefetch, onOffSeg(store.isPrefetch(), (v) => { store.setPrefetch(v); afterChange(); })));
  misc.appendChild(row(TEXT.switches.softLogout, onOffSeg(store.isSoftLogout(), (v) => { store.setSoftLogout(v); afterChange(); })));
  misc.appendChild(row(TEXT.switches.debug, onOffSeg(isDebug(), (v) => { store.setDebug(v); setDebug(v); })));
  body.appendChild(misc);

  /* --- 添加账号 ---
   *
   * 放在账号池**之前**是有意的：第一次打开面板的人看到的是「输入框」，
   * 而不是一个空池子的报错文案。池子是输入之后的结果，顺序上应该在下面。
   */
  const acc = section(TEXT.account.title);
  const taWrap = el('div', 'ta-wrap');
  const ta = el('textarea', 'txt');
  ta.spellcheck = false;
  ta.placeholder = TEXT.account.placeholder;
  ta.style.minHeight = '76px';

  const taAction = el('button', 'ta-action', '📋');
  taAction.type = 'button';
  taAction.title = TEXT.account.actions.paste;
  taWrap.append(ta, taAction);
  acc.appendChild(taWrap);

  const st = el('div', 'msg');
  acc.appendChild(st);
  const poolMsg = el('div', 'msg');
  acc.appendChild(poolMsg);

  /* ---- 解析结果区（默认隐藏，粘贴后出现） ---- */
  const parseBox = el('div');
  parseBox.style.cssText = 'margin-top:8px;display:none';
  const fmtLine = el('div', 'hint');
  fmtLine.style.marginBottom = '6px';
  parseBox.appendChild(fmtLine);

  const presetRow = el('div', 'seg');
  presetRow.style.marginBottom = '6px';
  const fieldList = el('div');
  fieldList.style.cssText =
    'max-height:168px;overflow:auto;border:1px solid var(--sep);border-radius:9px;padding:6px 8px;' +
    'scrollbar-width:thin;scrollbar-color:var(--sb) transparent;background:var(--hov)';
  parseBox.appendChild(presetRow);
  parseBox.appendChild(fieldList);
  acc.appendChild(parseBox);

  const btns = el('div', 'btns');
  const qrBtn = el('button', 'act', TEXT.account.actions.qr);
  const saveBtn = el('button', 'act pri', TEXT.account.actions.save);
  const testBtn = el('button', 'act', TEXT.account.actions.test);
  btns.append(qrBtn, saveBtn, testBtn);
  acc.appendChild(btns);
  /* ---- 扫码卡片 ---- */
  const qrBox = el('div');
  qrBox.style.cssText =
    'display:none;margin-top:10px;padding:12px;border:1px solid var(--sep);border-radius:12px;' +
    'background:var(--hov);text-align:center';
  const qrImgWrap = el('div');
  qrImgWrap.style.cssText =
    'width:150px;height:150px;margin:0 auto 8px;padding:6px;border-radius:10px;' +
    'background:#fff;display:flex;align-items:center;justify-content:center;position:relative;cursor:pointer';
  const qrHint = el('div', 'hint');
  qrHint.style.cssText = 'font-size:11.5px;margin-bottom:8px';
  qrHint.textContent = TEXT.qr.hint;
  const qrCloseBtn = el('button', 'act', TEXT.qr.cancel);
  qrCloseBtn.style.fontSize = '11px';
  qrBox.append(qrImgWrap, qrHint, qrCloseBtn);
  acc.appendChild(qrBox);
  acc.appendChild(details(TEXT.account.helpTitle, TEXT.account.help));
  body.appendChild(acc);

  const say = (text, color) => {
    poolMsg.textContent = text;
    poolMsg.style.color = color;
  };
  /** 输入框的解析/校验反馈走另一行，避免被池子操作的消息盖掉 */
  const sayInput = (text, color) => {
    st.textContent = text;
    st.style.color = color;
  };

  /* --- 账号池 --- */
  const poolSec = section(TEXT.pool.title);
  const poolList = el('div');
  poolList.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-bottom:8px';
  poolSec.appendChild(poolList);
  // 错配提示挂在列表内部，随列表一起重绘
  poolSec.appendChild(details(TEXT.pool.helpTitle, TEXT.pool.help));
  body.appendChild(poolSec);
  let poolMismatchNodes = [];
  /** 「登录中」标记节点：浏览器身份是异步的，确认对不上时要把它降级 */
  let currentTagNode = null;
  /** 重绘序号：只有最后一次渲染的回包才允许画进列表 */
  let renderSeq = 0;
  /** 一键导入按钮的重绘会把它换掉，用引用保存才能在异步回调里禁用同一个 */
  let autoImportBtn = null;
  /* ---- 账号池渲染 ---- */
  function renderPool() {
    const o = overview();
    poolList.textContent = '';
    poolMismatchNodes = [];
    currentTagNode = null;
    // 浏览器身份是异步拿的，而重绘可以被展开/切号/改借用源连续触发 ——
    // 不加序号的话，先发的请求可能后到，把过期的结果画进当前列表。
    const token = ++renderSeq;
    overviewAsync().then((full) => {
      if (token !== renderSeq) return; // 已经有更新的渲染了，丢弃本次回包
      renderBrowserWho(full);
    }).catch(() => {});

    if (!o.rows.length) {
      poolList.appendChild(el('div', 'hint', TEXT.pool.emptyHint));
      return o;
    }

    // 说明条：借的不是当前登录号、或手动指定了借用源时，必须一眼看到，
    // 否则用户会以为「我不是大会员所以没生效」
    if (o.borrowedFromOther) {
      const donor = o.rows.find((r) => r.id === o.borrowId);
      const name = donor ? donor.label || donor.uname || ('mid ' + donor.mid) : '';
      const tip = el('div', 'hint', '✨ ' + TEXT.pool.borrowOther + name);
      tip.style.cssText = 'padding:6px 9px;border-radius:8px;background:rgba(0,163,150,.12);color:#00a396;font-weight:600;margin-bottom:4px';
      poolList.appendChild(tip);
    } else if (o.borrowMode === 'manual') {
      const tip = el('div', 'hint', '📌 ' + TEXT.pool.manualBorrow);
      tip.style.cssText = 'padding:6px 9px;border-radius:8px;background:rgba(230,162,60,.12);color:#e6a23c;font-weight:600;margin-bottom:4px';
      poolList.appendChild(tip);
    }

    for (const r of o.rows) {
      poolList.appendChild(poolRow(r, o));
    }
    return o;
  }

  /**
   * 一键把当前浏览器登录的账号导入池子。
   * 放在 renderBrowserWho 之前声明，避免事件绑定时出现 TDZ 风险。
   */
  async function doAutoImport() {
    if (autoImportBtn) autoImportBtn.disabled = true;
    say(TEXT.pool.states.importing, 'var(--fg)');
    const r = await importBrowserAccount();
    if (autoImportBtn) autoImportBtn.disabled = false;
    if (!r.ok) {
      say(TEXT.pool.states.importNeedCopy, '#e6a23c');
      renderPool();
      return;
    }
    // 名字默认用浏览器认出来的昵称，省得用户再点一次改名
    renamePoolAccount(r.id, (r.account && r.account.uname) || '');
    renderPool();
    highlightNew(r.id);
    say(TEXT.pool.states.imported, '#00a396');
  }

  /**
   * 浏览器当前登录身份与池子的关系。
   *
   * 三种情形分别对应三种文案，**都基于运行时探测**：
   *   已在池中      → 凭证现成，直接给「用它借用」
   * 不在池中但可读 → 一键导入
   * 不在池中且读不到 → 只能从 DevTools 复制
   * 「能不能读到 SESSDATA」不写死：不同浏览器 / 扩展 / 站点版本下都可能不同，
   * 曾经就因为把它当成恒定事实而写过一份循环论证的 mock（见 findings §7）。
   */
  function renderBrowserWho(full) {
    for (const node of poolMismatchNodes) node.remove();
    poolMismatchNodes = [];

    // 动态同步每张卡片上的切号/登录按钮
    for (const card of poolList.querySelectorAll('[data-acc]')) {
      const id = card.dataset.acc;
      const row = full.rows.find((r) => r.id === id);
      if (!row) continue;
      const isCur = full.browserMid && full.browserMid === row.mid;
      const btn = card.querySelector('[data-role="switch"]');
      if (isCur && btn) {
        btn.remove();
      } else if (!isCur && btn) {
        btn.textContent = full.browserMid ? TEXT.pool.actions.switchTo : TEXT.pool.actions.loginToBrowser;
      }
    }

    if (!full.browserMid) {
      if (full.rows && full.rows.length) {
        const tip = el('div', 'hint', TEXT.pool.notLoggedInTip);
        tip.style.cssText = 'color:#e6a23c;margin-bottom:6px';
        poolList.appendChild(tip);
        poolMismatchNodes.push(tip);
        if (currentTagNode) {
          currentTagNode.textContent = TEXT.pool.labels.currentMismatch;
          currentTagNode.className = 'tag muted';
        }
      }
      return;
    }
    // 池里记着的当前号与浏览器实际登录的对不上。
    // 这时**不能只加一句提示** —— 卡片上那个「登录中」本身就是错的，
    // 留着它等于让用户继续相信一个假状态。必须一起降级。
    if (full.browserMismatch) {
      const warn = el('div', 'hint', TEXT.pool.states.browserMismatch);
      warn.style.cssText = 'color:#e6a23c;margin-bottom:4px';
      poolList.appendChild(warn);
      poolMismatchNodes.push(warn);
      if (currentTagNode) {
        currentTagNode.textContent = TEXT.pool.labels.currentMismatch;
        currentTagNode.className = 'tag muted';
      }
    }

    // 若当前号不在池中，按探测结果提示导入；若已在池中，卡片本身已有完整信息，绝不重复显示
    if (!full.inPool) {
      if (full.canAutoImport) {
        const tip = el('div', 'hint', TEXT.pool.autoImportTip + (full.browserUname || 'mid=' + full.browserMid));
        tip.style.color = '#00a396';
        poolList.appendChild(tip);
        poolMismatchNodes.push(tip);
        const b = el('button', 'act pri', TEXT.pool.actions.autoImport);
        b.style.marginTop = '4px';
        b.addEventListener('click', doAutoImport);
        poolList.appendChild(b);
        autoImportBtn = b;
        poolMismatchNodes.push(b);
      } else {
        const tip = el('div', 'hint', TEXT.pool.notInPoolTip);
        tip.style.color = '#e6a23c';
        poolList.appendChild(tip);
        poolMismatchNodes.push(tip);
      }
    }
  }

  function poolRow(r, o) {
    const card = el('div');
    card.dataset.acc = r.id; // 供「保存后高亮新账号」定位
    let borderCss = 'border:1px solid var(--sep);background:var(--hov);';
    if (r.isBorrow && o.borrowedFromOther) {
      borderCss = 'border:1px solid rgba(0,163,150,.45);background:rgba(0,163,150,.04);';
    } else if (r.isActive) {
      borderCss = 'border:1px solid rgba(0,180,216,.3);background:var(--hov);';
    }
    card.style.cssText = borderCss + 'border-radius:10px;padding:8px 10px;';
    const head = el('div');
    head.style.cssText = 'display:flex;align-items:center;gap:7px';

    if (r.face) {
      const img = el('img', 'avatar');
      img.src = r.face;
      img.referrerPolicy = 'no-referrer';
      img.alt = '';
      head.appendChild(img);
    } else {
      const init = (r.label || r.uname || (r.mid ? String(r.mid) : '?'))[0] || '?';
      head.appendChild(el('div', 'avatar avatar-initial', init));
    }

    const name = el('span', '', r.label || r.uname || ('mid ' + (r.mid || '?')));
    name.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:12px;font-weight:600';
    head.appendChild(name);
    const tags = el('div');
    tags.style.cssText = 'display:flex;align-items:center;gap:4px;flex-shrink:0';
    if (r.isActive) {
      currentTagNode = mark('on', TEXT.pool.labels.current);
      tags.appendChild(currentTagNode);
    }
    if (r.isBorrow) {
      tags.appendChild(mark('borrow', TEXT.pool.labels.borrowed));
    }
    if (r.stale && r.checkedAt) {
      const t = mark('muted', TEXT.pool.states.stale);
      t.title = TEXT.pool.states.staleTip;
      tags.appendChild(t);
    }
    const vip = el('span', 'tag ' + (r.vip ? 'vip' : r.checkedAt ? 'plain' : 'muted'),
      r.vip ? TEXT.pool.labels.vip : r.checkedAt ? TEXT.pool.labels.plain : TEXT.pool.labels.unknown);
    tags.appendChild(vip);
    head.appendChild(tags);
    card.appendChild(head);

    const meta = el('div');
    meta.style.cssText = 'font-size:10.5px;opacity:.5;margin-top:2px';
    meta.textContent = [r.uname && r.label ? r.uname : '', r.mid ? 'mid=' + r.mid : ''].filter(Boolean).join(' · ');
    card.appendChild(meta);
    const acts = el('div');
    acts.style.cssText = 'display:flex;gap:4px;margin-top:7px;flex-wrap:wrap;align-items:center';

    const isBrowserCurrent = o.browserMid && o.browserMid === r.mid;
    if (!isBrowserCurrent) {
      const switchText = o.browserMid ? TEXT.pool.actions.switchTo : TEXT.pool.actions.loginToBrowser;
      const b = el('button', 'act' + (o.canWrite ? ' pri' : ''), switchText);
      b.dataset.role = 'switch';
      b.disabled = !o.canWrite;
      if (!o.canWrite) b.title = TEXT.pool.states.switchUnsupported;
      b.addEventListener('click', () => doSwitch(r.id));
      acts.appendChild(b);
    }
    // 只有拥有大会员权益的账号才提供「用它借用」；非会员账号无权益可借，避免误导
    if (r.vip && !r.isBorrow) {
      const b = el('button', 'act', TEXT.pool.actions.useAsBorrow);
      b.addEventListener('click', () => doBorrow(r.id));
      acts.appendChild(b);
    }
    if (o.borrowMode === 'manual' && r.isBorrow) {
      const b = el('button', 'act', TEXT.pool.actions.autoBorrow);
      b.title = TEXT.pool.states.autoBorrowTip;
      b.addEventListener('click', () => doAutoBorrow());
      acts.appendChild(b);
    }

    const mgmt = el('div');
    mgmt.style.cssText = 'display:flex;gap:4px;margin-left:auto';
    mgmt.appendChild(mkBtn(TEXT.pool.actions.recheck, () => doRecheck(r.id), { title: TEXT.pool.states.recheckTip }));
    mgmt.appendChild(mkBtn(TEXT.pool.actions.rename, () => doRename(r.id)));
    mgmt.appendChild(mkBtn(TEXT.pool.actions.remove, () => doForget(r.id)));
    acts.appendChild(mgmt);
    card.appendChild(acts);
    return card;
  }

  function mark(kind, text) {
    return el('span', 'tag ' + kind, text);
  }

  const doRecheck = async (id) => {
    say(TEXT.pool.states.rechecking, 'var(--fg)');
    const r = await reprobe(id);
    renderPool();
    if (r.ok) {
      say(
        '✅ ' + (r.account.uname || '?') + ' · ' + (r.account.vipStatus === 1 ? TEXT.pool.labels.vip : TEXT.pool.labels.plain),
        r.account.vipStatus === 1 ? '#00a396' : '#e6a23c'
      );
    } else say('❌ ' + r.reason, '#f56c6c');
  };

  const doBorrow = (id) => {
    useAsBorrowSource(id);
    renderPool();
    say(TEXT.pool.states.borrowSet, '#00a396');
  };

  const doAutoBorrow = () => {
    useAutoBorrowSource();
    renderPool();
    say(TEXT.pool.states.borrowAuto, '#00a396');
  };

  const doRename = (id) => {
    const cur = overview().rows.find((r) => r.id === id);
    const name = prompt(TEXT.pool.actions.renameAsk, (cur && cur.label) || (cur && cur.uname) || '');
    if (name === null) return;
    renamePoolAccount(id, name);
    renderPool();
    say(TEXT.pool.states.renamed, 'var(--fg)');
  };

  const doForget = (id) => {
    if (!confirm(TEXT.pool.confirms.remove)) return;
    const r = forgetAccount(id);
    renderPool();
    say(r.ok ? TEXT.pool.states.removed : r.reason, r.ok ? '#00a396' : '#f56c6c');
  };

  const doSwitch = async (id) => {
    const isLogin = !overview().browserMid;
    const confirmMsg = isLogin ? TEXT.pool.confirms.loginToBrowser : TEXT.pool.confirms.switch;
    if (!confirm(confirmMsg)) return;
    say(TEXT.pool.states.switching, 'var(--fg)');
    const r = await switchLoginTo(id);
    if (!r.ok) {
      say(r.reason === 'unsupported' ? TEXT.pool.states.switchUnsupported : '❌ ' + r.reason, '#f56c6c');
      return;
    }
    renderPool();
    // r.reason 非空说明有字段没写进去：仍刷新，但必须让用户看见「不完整」
    const warn = r.reason ? ' · ⚠ ' + TEXT.pool.states.switchPartial : '';
    if (r.needReload) {
      // 首屏 SSR 里嵌着旧身份，不刷新的话界面还是旧号，且会先播一次低画质
    say(TEXT.pool.states.switched + (r.stale.length ? ' · ' + TEXT.pool.states.switchDeleted : '') + warn, '#00a396');
      setTimeout(() => location.reload(), 1200);
    } else {
      say((r.reason ? '⚠ ' + r.reason : TEXT.pool.states.switchSelf) + warn, r.reason ? '#e6a23c' : 'var(--fg)');
    }
  };

  // 暴露给 toggle：面板每次展开都要重新读一遍池子（期间可能已被改过）
  rerenderPool = renderPool;
  renderPool();

  /* ---- 解析逻辑 ---- */
  let parsedFields = null;
  let chosen = new Set();

  function renderFields() {
    fieldList.textContent = '';
    if (!parsedFields) return;
    let inAuto = false;
    for (const k of sortFields(Object.keys(parsedFields))) {
      const t = tierOf(k);
      const isAuto = t.tier === 'auto';

      // 设备字段之前插一条分隔说明：它们不是「漏选了」，是「不需要选」
      if (isAuto && !inAuto) {
        inAuto = true;
        const sep = el('div', 'hint', TEXT.account.presetsHint);
        sep.style.cssText = 'margin:6px 0 2px;opacity:.5';
        fieldList.appendChild(sep);
      }

      const lab = el('label');
      lab.style.cssText =
        'display:flex;align-items:center;gap:6px;font-size:11.5px;padding:2px 0;' +
        (isAuto ? 'opacity:.45;cursor:default' : 'cursor:pointer');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = chosen.has(k);
      if (isAuto) {
        // 默认不选，但仍允许手动勾 —— 保守派用户要留设备字段时用得上
        cb.style.cursor = 'pointer';
      }
      cb.addEventListener('change', () => {
        cb.checked ? chosen.add(k) : chosen.delete(k);
        updateTaFromChoice();
      });
      const name = el('span', '', k);
      name.style.cssText = 'font-family:var(--mono);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis';
      if (!chosen.has(k)) name.style.opacity = '.4';
      const badge = el('span', 'tag ' + (TAG_KIND[t.tier] || 'plain'), t.label);
      lab.append(cb, name, badge);
      fieldList.appendChild(lab);
    }
  }

  function updateTaFromChoice() {
    if (!parsedFields) return;
    const picked = joinCookie(parsedFields, sortFields([...chosen]));
    if (picked) ta.value = picked;
    renderFields();
    updateTaAction();
  }

  function doParse() {
    updateTaAction();
    const text = ta.value.trim();
    if (!text) { parsedFields = null; parseBox.style.display = 'none'; return; }
    const { fields, format } = parseCookieText(text);
    const n = Object.keys(fields).length;
    if (!n) {
      parsedFields = null;
      parseBox.style.display = 'none';
      sayInput('⚠ ' + TEXT.account.states.parseFail, '#e6a23c');
      return;
    }
    // 已经是干净 Cookie 字符串时不必再筛选，直接采用
    parsedFields = fields;
    chosen = new Set(pickFields(fields, 'essential'));
    parseBox.style.display = '';
    fmtLine.textContent = TEXT.account.parsed(format, n) +
      (fields.SESSDATA ? '' : ' · ⚠ ' + TEXT.account.missing);
    presetRow.textContent = '';
    for (const p of [
      { v: 'essential', label: TEXT.account.presets.essential },
      { v: 'all', label: TEXT.account.presets.all }
    ]) {
      const b = el('button', p.v === 'essential' ? 'on' : '', p.label);
      b.addEventListener('click', () => {
        chosen = new Set(pickFields(fields, p.v));
        for (const x of presetRow.children) x.className = '';
        b.className = 'on';
        updateTaFromChoice();
      });
      presetRow.appendChild(b);
    }
    updateTaFromChoice();
    if (!fields.SESSDATA) sayInput('⚠ ' + TEXT.account.states.noSessdata, '#f56c6c');
    else sayInput(TEXT.account.states.ready, 'var(--fg)');
  }

  const updateTaAction = () => {
    if (ta.value.trim()) {
      taAction.textContent = '✕';
      taAction.title = TEXT.account.actions.clear;
    } else {
      taAction.textContent = '📋';
      taAction.title = TEXT.account.actions.paste;
    }
  };

  ta.addEventListener('input', () => {
    updateTaAction();
    clearTimeout(ta._t);
    ta._t = setTimeout(doParse, 260);
  });
  ta.addEventListener('paste', () => setTimeout(() => { updateTaAction(); doParse(); }, 0));

  taAction.addEventListener('click', async () => {
    if (ta.value.trim()) {
      ta.value = '';
      parsedFields = null;
      chosen = new Set();
      parseBox.style.display = 'none';
      sayInput(TEXT.account.states.cleared, 'var(--fg)');
      updateTaAction();
      ta.focus();
    } else {
      try {
        const t = await navigator.clipboard.readText();
        if (t) {
          ta.value = t;
          updateTaAction();
          doParse();
        } else sayInput(TEXT.account.states.clipboardEmpty, '#f56c6c');
      } catch {
        sayInput(TEXT.account.states.clipboardDenied, '#f56c6c');
      }
    }
  });

  const runProbe = async (cookie, save) => {
    const msg = save ? say : sayInput;
    msg(TEXT.account.states.verifying, 'var(--fg)');
    saveBtn.disabled = testBtn.disabled = true;
    const r = save ? await saveAccount(cookie) : await testAccount(cookie);
    saveBtn.disabled = testBtn.disabled = false;

    if (r.reason === 'empty') { msg(TEXT.account.states.empty, '#f56c6c'); return; }
    if (r.reason === 'incomplete') {
      msg('❌ ' + ((r.problems && r.problems.join('；')) || TEXT.account.states.noSessdata), '#f56c6c');
      return;
    }
    if (r.ok) {
      const vip = r.account.vipStatus === 1 ? TEXT.pool.labels.vip : TEXT.pool.labels.plain;
      msg(
        '✅ ' + (r.account.uname || '?') + '（mid=' + r.account.mid + '）\n' +
          '会员：' + vip + '\n' +
          strategyLabel(r.strategy) + '\n' +
          '本机账号：' + ((r.aAccount && r.aAccount.uname) || '未登录') + '\n' +
          (save ? (r.isNew ? (!overview().browserMid ? TEXT.account.states.savedNotLoggedIn : TEXT.account.states.savedNote) : TEXT.account.states.savedTwice) : ''),
        r.account.vipStatus === 1 ? '#00a396' : '#e6a23c'
      );
      if (save) {
        ta.value = '';
        parsedFields = null;
        chosen = new Set();
        parseBox.style.display = 'none';
        updateTaAction();
        renderPool();
        // 池子在输入框下方，不主动指过去的话用户会以为「保存了但没反应」
        highlightNew(r.id);
      }
    } else {
      msg('❌ ' + r.reason, '#f56c6c');
    }
  };

  /** 新加入的账号闪一下边框，让「保存 → 进池子」这件事被看见 */
  function highlightNew(id) {
    const card = poolList.querySelector('[data-acc="' + id + '"]');
    if (!card) return;
    card.scrollIntoView({ block: 'nearest' });
    card.style.transition = 'box-shadow .2s';
    card.style.boxShadow = '0 0 0 2px var(--ring)';
    setTimeout(() => { card.style.boxShadow = ''; }, 1400);
  }

  saveBtn.addEventListener('click', () => runProbe(ta.value, true));
  testBtn.addEventListener('click', () => runProbe(ta.value || '', false));

  /* ---- 扫码流程 ---- */
  let qrPollTimer = null;
  let currentQrKey = '';

  function stopQr() {
    if (qrPollTimer) {
      clearInterval(qrPollTimer);
      qrPollTimer = null;
    }
    currentQrKey = '';
    qrBox.style.display = 'none';
  }

  async function startQr() {
    stopQr();
    qrBox.style.display = '';
    qrImgWrap.textContent = '';
    qrImgWrap.appendChild(el('div', 'hint', TEXT.qr.loading));
    qrHint.textContent = TEXT.qr.hint;
    qrHint.style.color = 'var(--fg)';

    const res = await fetchQrCode();
    if (!res.ok) {
      qrImgWrap.textContent = '';
      const errEl = el('div', 'hint', res.error || '获取失败');
      errEl.style.color = '#f56c6c';
      qrImgWrap.appendChild(errEl);
      qrHint.textContent = TEXT.qr.refresh;
      qrHint.style.color = '#f56c6c';
      return;
    }

    currentQrKey = res.qrcodeKey;
    qrImgWrap.innerHTML = res.svg || '';
    const svgEl = qrImgWrap.querySelector('svg');
    if (svgEl) {
      svgEl.style.width = '100%';
      svgEl.style.height = '100%';
    }

    qrPollTimer = setInterval(async () => {
      if (!currentQrKey) return;
      const p = await pollQrCode(currentQrKey);
      if (!p.ok) {
        qrHint.textContent = p.message;
        qrHint.style.color = '#f56c6c';
        return;
      }
      if (p.state === 'waiting') {
        qrHint.textContent = TEXT.qr.hint;
        qrHint.style.color = 'var(--fg)';
      } else if (p.state === 'scanned') {
        qrHint.textContent = TEXT.qr.scanned;
        qrHint.style.color = '#00a396';
      } else if (p.state === 'expired') {
        stopQr();
        qrBox.style.display = '';
        qrImgWrap.textContent = '';
        const exp = el('div', 'hint', TEXT.qr.expiredBox);
        exp.style.cssText = 'color:#e6a23c;line-height:1.5;white-space:pre-line';
        qrImgWrap.appendChild(exp);
        qrHint.textContent = TEXT.qr.expired;
        qrHint.style.color = '#e6a23c';
      } else if (p.state === 'confirmed') {
        stopQr();
        say(TEXT.qr.confirmed, '#00a396');
        const saved = await saveAndApplyScannedAccount(p.cookie);
        renderPool();
        if (saved.ok) {
          highlightNew(saved.id);
          say('✅ ' + TEXT.qr.successToast + (saved.account ? ' (' + (saved.account.uname || saved.account.mid) + ')' : ''), '#00a396');
          if (saved.switch && saved.switch.needReload) {
            setTimeout(() => location.reload(), 1200);
          }
        } else {
          say('❌ ' + TEXT.qr.failedToast + saved.reason, '#f56c6c');
        }
      }
    }, 1500);
  }

  qrBtn.addEventListener('click', () => {
    if (qrBox.style.display === 'none') startQr();
    else stopQr();
  });
  qrImgWrap.addEventListener('click', () => {
    if (!qrPollTimer) startQr();
  });
  qrCloseBtn.addEventListener('click', stopQr);

  const qc = quickCheck();
  sayInput(
    qc.ok ? (qc.warn ? '⚠ 建议补齐：\n' + qc.warn : TEXT.account.states.complete) : '⚠ ' + qc.msg,
    qc.ok ? (qc.warn ? '#e6a23c' : 'var(--fg)') : '#e6a23c'
  );

  /* --- 诊断 --- */
  const diag = section(TEXT.diag.title);
  const dbox = el('div', 'stats');
  dbox.id = ID + '-diag';
  diag.appendChild(dbox);
  const db = el('div', 'btns');
  db.append(
    mkBtn(TEXT.diag.actions.copyLog, async () => {
      try { await navigator.clipboard.writeText(exportLog()); say(TEXT.account.states.copiedLog, '#00a396'); }
      catch { say(TEXT.account.states.copyFailed, '#f56c6c'); }
    }),
    mkBtn(TEXT.diag.actions.clearCache, () => { resetCache(); renderLive(); }),
    mkBtn(TEXT.diag.actions.reprobe, async () => {
      say(TEXT.diag.retrying, 'var(--fg)');
      store.setStrategy(-1);
      // 重探借用源：会员状态与发送方式一起刷新，改的正是池内那一条。
      // 与菜单里的「重探」同理：结果可能让 resolveBorrow 指向另一个账号，
      // 必须失效缓存 + 重推配置，否则旧账号的播放地址还会被供一个 TTL。
      const r = await reprobe();
      invalidateAfterSettingsChange();
      renderPool();
      say(r.ok ? '✅ ' + strategyLabel(r.strategy) : '❌ ' + r.reason, r.ok ? '#00a396' : '#f56c6c');
    }, { title: TEXT.diag.reprobeTip })
  );
  diag.appendChild(db);
  if (cookieProblem() || stats.lastError) {
    const w = el('div', 'hint', stats.lastError || cookieProblem());
    w.style.color = '#e6a23c';
    diag.appendChild(w);
  }
  body.appendChild(diag);

  renderDiag();
  return { renderLive, renderDiag, say };
}

function mkBtn(text, fn, attrs) {
  const b = el('button', 'act', text);
  if (attrs) for (const [k, v] of Object.entries(attrs)) b[k] = v;
  b.addEventListener('click', fn);
  return b;
}

/* ---------------- 实时刷新 ---------------- */

function renderLive() {
  const box = document.getElementById(ID + '-live');
  if (!box) return;
  box.textContent = '';
  const c = stats.current;
  const s = state();

  const hero = el('div', 'hero');
  const q = el('div', 'q', c ? qualityName(c.quality) : '—');
  if (c && c.quality >= 120) q.style.color = '#fb7299';
  hero.appendChild(q);
  hero.appendChild(
    el('div', 'sub', c ? (c.fromCache ? TEXT.live.cache : TEXT.live.live) : s.note || TEXT.live.idle)
  );
  box.appendChild(hero);

  const g = el('div', 'live');
  const put = (k, v) => {
    g.appendChild(el('div', 'k', k));
    g.appendChild(el('div', 'v', v));
  };
  put(TEXT.live.resolution, c && c.width ? c.width + '×' + c.height : '—');
  put(TEXT.live.codec, c ? codecName(c.codec) : '—');
  put(TEXT.live.bitrate, c && c.kbps ? c.kbps + ' kbps' : '—');
  put(TEXT.live.options, c && c.formats && c.formats.length ? c.formats.map(qualityName).join(' / ') : '—');
  put(TEXT.live.endpoint, stats.lastEndpoint || '—');
  box.appendChild(g);
}

function renderDiag() {
  const box = document.getElementById(ID + '-diag');
  if (!box) return;
  box.textContent = '';
  const c = cacheStats();
  const put = (k, v) => {
    const s = el('span', 's');
    s.appendChild(el('span', 'k', k));
    s.appendChild(el('span', 'v', String(v)));
    box.appendChild(s);
  };
  put(TEXT.diag.ok, stats.proxyOk);
  put(TEXT.diag.fallback, stats.proxyFail);
  put(TEXT.diag.cacheHit, stats.cacheServed);
  put(TEXT.diag.coalesced, c.coalesced);

  // 自检。刻意只占一行 —— 诊断区之前从 4 行压到 1 行就是嫌它占地方，
  // 但「钩子活着」和「拦截接管了请求」必须分开报，否则「画质没上去」时无从查起。
  pingHook();
  const sc = getHookSelfCheck();
  const s2 = el('span', 's');
  s2.appendChild(el('span', 'k', TEXT.diag.selfCheck));
  let txt = TEXT.diag.selfDead;
  let warn = true; // 没注入钩子 = 确定坏了
  if (sc) {
    warn = !sc.playinfoHooked; // 只在「访问器没装上」时报警
    txt = !sc.playinfoHooked
      ? TEXT.diag.selfNoPlayinfo
      : !sc.intercepted
        ? TEXT.diag.selfNoIntercept
        : (sc.playinfoHidden
            ? TEXT.diag.selfOk
            // 借用总开关关着时不隐藏是**应该的**，不能报成异常
            : sc.hidePlayinfo
              ? TEXT.diag.selfPlayinfoOff
              : TEXT.diag.selfPlayinfoNotNeeded
          ).replace('{n}', sc.intercepted);
  }
  const v2 = el('span', 'v', txt);
  // 「已连接但还没接管到请求」是非视频页的正常状态，不标黄 —— 误报比漏报更让人不信面板
  if (warn) v2.style.color = '#e6a23c';
  s2.appendChild(v2);
  s2.title = TEXT.diag.selfCheckTip;
  box.appendChild(s2);
}

/* ---------------- 挂载与开关 ---------------- */

function toggle(force) {
  open = force === undefined ? !open : force;
  const p = root.querySelector('.panel');
  p.classList.toggle('show', open);
  if (open) {
    // 池子数据可能已被面板外的操作改过（菜单切号、剪贴板导入、别处改了登录态）
    if (rerenderPool) rerenderPool();
    renderLive();
    renderDiag();
    if (!tickTimer) tickTimer = setInterval(() => { renderLive(); renderDiag(); }, 1000);
  } else if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  renderDot();
}

let lastTrayFingerprint = '';

function renderDockTray() {
  const tray = root.querySelector('.dock-tray');
  if (!tray) return;
  const o = overview();
  const rows = o.rows || [];
  const fp = rows.map((r) => `${r.id}:${r.isActive}:${r.uname}:${r.vip}:${r.face}`).join('|') + '|canWrite:' + o.canWrite;
  if (fp === lastTrayFingerprint && tray.children.length > 0) return;
  lastTrayFingerprint = fp;

  const focusedId = tray.contains(document.activeElement) ? document.activeElement.dataset?.id : null;
  tray.innerHTML = '';

  const head = el('div', 'dock-tray-head', TEXT.dock.quickSwitch);
  tray.appendChild(head);

  if (!rows.length) {
    tray.appendChild(el('div', 'dock-tray-empty', TEXT.dock.noOther));
    return;
  }

  const list = el('div', 'dock-tray-list');
  for (const r of rows) {
    const item = el('div', 'dock-tray-item' + (r.isActive ? ' active' : '') + (!o.canWrite ? ' disabled' : ''));
    item.dataset.id = r.id;
    item.tabIndex = 0;
    item.setAttribute('role', 'button');

    if (r.face) {
      const img = el('img', 'avatar');
      img.src = r.face;
      item.appendChild(img);
    } else {
      const init = el('span', 'avatar avatar-initial', (r.uname || r.mid || '?')[0]);
      item.appendChild(init);
    }

    const name = el('span', 'dock-tray-name', r.uname || r.mid || r.id.slice(0, 8));
    item.appendChild(name);

    if (r.vip) {
      item.appendChild(el('span', 'tag vip', TEXT.dock.vipBadge));
    }
    if (r.isActive) {
      item.appendChild(el('span', 'tag on', TEXT.dock.currentBadge));
    }

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      if (r.isActive) return;
      if (!o.canWrite) {
        alert(TEXT.notify.switchUnsupportedLong);
        return;
      }
      if (o.browserMid && !confirm(TEXT.pool.confirms.switch)) return;
      switchLoginTo(r.id).then((sw) => {
        if (sw.ok && sw.needReload) location.reload();
        else if (!sw.ok) alert(sw.reason || TEXT.notify.switchFail);
      });
    });
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        item.click();
      }
    });

    list.appendChild(item);
  }
  tray.appendChild(list);

  if (focusedId) {
    const nextFocus = tray.querySelector(`[data-id="${focusedId}"]`);
    if (nextFocus) nextFocus.focus();
  }
}

function renderDot() {
  const dot = root.querySelector('.dot');
  if (!dot) return;
  const face = root.querySelector('.face');
  const s = state();
  if (face) face.style.background = s.ok ? '' : s.dot;
  dot.classList.toggle('on', s.ok);
  let badge = root.querySelector('.badge');
  if (!s.ok && s.note) {
    if (!badge) { badge = el('div', 'badge'); dot.appendChild(badge); }
    badge.textContent = '!';
    badge.title = s.note;
  } else if (badge) badge.remove();

  const o = overview();
  const cur = o.rows.find((r) => r.isActive);
  let avatarImg = dot.querySelector('.dot-avatar');
  let vipBadge = dot.querySelector('.dot-vip-badge');

  if (cur && cur.face) {
    dot.classList.add('has-avatar');
    if (!avatarImg) {
      avatarImg = el('img', 'dot-avatar');
      dot.insertBefore(avatarImg, dot.firstChild);
    }
    if (avatarImg.src !== cur.face) avatarImg.src = cur.face;
    if (cur.vip) {
      if (!vipBadge) {
        vipBadge = el('span', 'dot-vip-badge');
        vipBadge.title = TEXT.dock.vipBadge;
        dot.appendChild(vipBadge);
      }
    } else if (vipBadge) vipBadge.remove();
  } else {
    dot.classList.remove('has-avatar');
    if (avatarImg) avatarImg.remove();
    if (vipBadge) vipBadge.remove();
  }

  dot.title = (s.ok ? TEXT.badge.running : s.note || '') + '\n' + (cur ? (cur.uname || cur.mid || '') + ' · ' : '') + (TEXT.dock.hoverTip || '');
  renderDockTray();
}

export function mountPanel() {
  if (root && root.isConnected) { renderDot(); return; }
  ensureStyle();
  root = document.createElement('div');
  root.id = ID;
  root.innerHTML = `
    <div class="panel glass">
      <div class="head">
        <div class="title"></div>
        <div class="ver"></div>
        <div class="x" title="收起">✕</div>
      </div>
    </div>
    <div class="dock-wrap">
      <div class="dock-tray glass"></div>
      <div class="dot glass" role="button" tabindex="0"><div class="face"></div></div>
    </div>`;
  (document.body || document.documentElement).appendChild(root);

  const panel = root.querySelector('.panel');
  const api = buildPanel(panel);
  root.querySelector('.title').textContent = TITLE;
  root.querySelector('.ver').textContent = 'v' + VERSION;
  root.querySelector('.x').addEventListener('click', () => toggle(false));
  const dot = root.querySelector('.dot');
  dot.addEventListener('click', () => toggle());
  dot.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });
  const wrap = root.querySelector('.dock-wrap');
  if (wrap) {
    wrap.addEventListener('mouseenter', () => renderDockTray());
  }
  void api;

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) toggle(false);
  });
  document.addEventListener('DOMContentLoaded', () => renderDot());
  overviewAsync().then(() => renderDot()).catch(() => {});
  renderDot();
  setInterval(renderDot, 2000);
}

/** 菜单命令统一走这里，避免出现第二份配置界面 */
export function openPanel() {
  mountPanel();
  toggle(true);
}

/** 外部（如代理完成）要求刷新徽标时调用 */
export function refreshPanel() {
  if (!root) return;
  renderDot();
  if (open) { renderLive(); renderDiag(); }
}