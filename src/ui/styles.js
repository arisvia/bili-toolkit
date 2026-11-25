/**
 * 液态玻璃悬浮面板与微缩胶囊样式表。
 */

export function buildStyles(ID) {
  return `
#${ID}, #${ID} * { box-sizing: border-box; }
#${ID} {
  position: fixed; left: 12px; bottom: 12px; z-index: 2147483647;
  font: 13px/1.6 "PingFang SC","Microsoft YaHei",-apple-system,sans-serif;
  color: var(--fg);
  -webkit-font-smoothing: antialiased;
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
  min-width: 176px;
  max-width: 248px;
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  font-weight: 600;
  opacity: .65;
  padding-bottom: 5px;
  border-bottom: 1px solid var(--sep);
}
#${ID} .dock-toggle {
  border: 1px solid var(--sep);
  background: var(--hov);
  color: var(--fg);
  border-radius: 99px;
  padding: 1px 7px;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  transition: background .15s, border-color .15s;
}
#${ID} .dock-toggle.on {
  background: var(--tag-on-bg);
  color: var(--tag-on-fg);
  border-color: transparent;
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
#${ID} .lbl { font-size: 10.5px; opacity: .45; margin-bottom: 7px; font-weight: 600; }
#${ID} .lbl-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 7px; }
#${ID} .lbl-row .lbl { margin-bottom: 0; }
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
#${ID} .stats { display: flex; flex-wrap: wrap; gap: 3px 12px; align-items: baseline; }
#${ID} .stats .s { display: inline-flex; gap: 4px; align-items: baseline; }
#${ID} .stats .s .k { font-size: 10.5px; opacity: .55; }
#${ID} .stats .s .v { font-size: 12px; font-variant-numeric: tabular-nums; font-weight: 600; }
#${ID} .tag {
  font-size: 9.5px; line-height: 1.5; padding: 1px 6px; border-radius: 99px;
  flex-shrink: 0; white-space: nowrap;
}
#${ID} .tag.on     { background: var(--tag-on-bg);     color: var(--tag-on-fg); }
#${ID} .tag.borrow { background: var(--tag-borrow-bg); color: var(--tag-borrow-fg); }
#${ID} .tag.vip    { background: var(--tag-vip-bg);    color: var(--tag-vip-fg); }
#${ID} .tag.plain  { background: var(--tag-plain-bg);  color: var(--tag-plain-fg); }
#${ID} .tag.warn   { background: var(--tag-warn-bg);   color: var(--tag-warn-fg); }
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
    --tag-warn-bg: rgba(245,108,108,.20); --tag-warn-fg: #ff8585;
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
    --pri-fg: #007065;
    --btn-hl: rgba(255,255,255,.5);
    --tag-on-bg: rgba(0,150,136,.13); --tag-on-fg: #007065;
    --tag-borrow-bg: rgba(230,162,60,.14); --tag-borrow-fg: #8c5200;
    --tag-vip-bg: rgba(251,114,153,.14); --tag-vip-fg: #b82153;
    --tag-plain-bg: rgba(20,22,26,.06); --tag-plain-fg: rgba(20,22,26,.6);
    --tag-warn-bg: rgba(245,108,108,.15); --tag-warn-fg: #d32f2f;
    --tag-muted-fg: rgba(20,22,26,.62);
  }
}
`;
}

export function ensureStyle(id) {
  if (document.getElementById(id + '-css')) return;
  const st = document.createElement('style');
  st.id = id + '-css';
  st.textContent = buildStyles(id);
  (document.head || document.documentElement).appendChild(st);
}
