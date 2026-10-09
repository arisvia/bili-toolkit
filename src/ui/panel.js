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
import { NAME } from '../meta.js';
import { store } from '../core/store.js';
import { sanitizeCookie, maskCookie, validateCookie } from '../core/cookie.js';
import { parseCookieText, pickFields, joinCookie, sortFields, tierOf } from '../core/cookie-parse.js';
import { TEXT, TIER_STYLE } from '../core/text.js';
import { probeIdentity, strategyLabel, invalidateMixinKey, quickCheck, getEffectiveCookie, cookieProblem } from '../core/session.js';
import { REGION_MODES } from '../core/region.js';
import { stats, describeCurrent, qualityName, codecName, exportLog, setDebug, isDebug } from '../core/log.js';
import { resetCache, cacheStats } from '../core/proxy.js';
import { pushConfig, getToken, isHookAlive } from '../core/bus.js';
import { liveConfig } from '../core/inject.js';

const ID = NS + '-panel';
const TITLE = NAME;
let root = null;
let bodyEl = null;
let open = false;
let tickTimer = null;

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
#${ID} .panel.show { display: block; animation: ${ID}-in .22s cubic-bezier(.2,.8,.2,1); }
@keyframes ${ID}-in { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }
#${ID} .head {
  display: flex; align-items: center; gap: 8px; padding: 12px var(--pad-x) 10px;
  position: sticky; top: 0; z-index: 2;
  /* 粘性头部自身也要半透明，否则滚动时下层内容会透出来 */
  background: linear-gradient(var(--bg), color-mix(in srgb, var(--bg) 82%, transparent));
  backdrop-filter: blur(8px);
}
#${ID} .title { font-size: 13px; font-weight: 600; flex: 1; }
#${ID} .ver { font-size: 10px; opacity: .45; }
#${ID} .x {
  cursor: pointer; opacity: .5; font-size: 15px; line-height: 1; padding: 2px 5px;
  border-radius: 6px;
}
#${ID} .x:hover { opacity: 1; background: var(--hov); }
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
  background: var(--pri); border-color: transparent; color: #fff; font-weight: 600;
  box-shadow: inset 0 1px 0 var(--hl), 0 2px 8px var(--sh);
}
#${ID} button.act.pri:hover { filter: brightness(1.08); background: var(--pri); }
#${ID} .dot:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--ring-soft); }
#${ID} .live { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; align-items: baseline; }
#${ID} .live .k { font-size: 11.5px; opacity: .6; }
#${ID} .live .v { font-size: 12.5px; font-variant-numeric: tabular-nums; }
#${ID} .live .v.big { font-size: 17px; font-weight: 650; letter-spacing: -.01em; }
#${ID} .hero { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
#${ID} .hero .q { font-size: 26px; font-weight: 700; letter-spacing: -.02em; }
#${ID} .hero .sub { font-size: 11.5px; opacity: .55; }
#${ID} .hint { font-size: 10.5px; opacity: .42; line-height: 1.5; margin-top: 6px; }
#${ID} pre.help {
  white-space: pre-wrap; word-break: break-word; margin: 6px 0 0;
  font: 10.5px/1.65 var(--mono); opacity: .72;
  background: var(--hov); border-radius: 10px; padding: 9px 11px;
  max-height: 190px; overflow: auto;
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
    --pri: rgba(120,220,200,.24);
  }
}
@media (prefers-color-scheme: light) {
  #${ID} {
    --fg: rgba(20,22,26,.9); --bg: rgba(255,255,255,.56); --bd: rgba(20,22,26,.1);
    --hl: rgba(255,255,255,.75); --sh: rgba(20,22,26,.14); --ring: rgba(0,160,150,.55);
    --ring-soft: rgba(0,150,136,.14); --sb: rgba(20,22,26,.16); --sb2: rgba(20,22,26,.28);
    --dotc: #00a396; --hov: rgba(20,22,26,.045); --hov2: rgba(20,22,26,.09);
    --seg-on: rgba(255,255,255,.95); --sep: rgba(20,22,26,.075); --bd2: rgba(20,22,26,.16);
    --pri: rgba(0,150,136,.18);
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

function section(title) {
  const s = el('div', 'sec');
  if (title) s.appendChild(el('div', 'lbl', title));
  return s;
}

function segmented(options, current, onPick) {
  const seg = el('div', 'seg');
  for (const o of options) {
    const b = el('button', o.value === current ? 'on' : '', o.label);
    b.title = o.title || o.label;
    b.addEventListener('click', () => {
      if (o.value === current) return;
      onPick(o.value);
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
  if (!store.getCookie()) return { ok: false, dot: '#fb7299', note: TEXT.badge.needSetup };
  if (!isHookAlive()) return { ok: false, dot: '#e6a23c', note: TEXT.badge.notReady };
  if (stats.proxyFail > 0 && stats.proxyOk === 0) return { ok: false, dot: '#f56c6c', note: TEXT.badge.failing };
  return { ok: true, dot: '', note: '' };
}

function afterChange() {
  resetCache();
  invalidateMixinKey();
  pushConfig(liveConfig(getToken()));
  renderLive();
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
  q.appendChild(el('div', 'hint', TEXT.quality.brief));
  q.appendChild(details(TEXT.quality.title + '怎么用', TEXT.quality.detail));
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
  misc.appendChild(row(TEXT.switches.debug, onOffSeg(isDebug(), (v) => { store.setDebug(v); setDebug(v); })));
  body.appendChild(misc);

  /* --- B 账号 --- */
  const acc = section(TEXT.account.title);
  const accLine = el('div', 'hint');
  accLine.style.marginBottom = '6px';
  acc.appendChild(accLine);

  const ta = el('textarea', 'txt');
  ta.spellcheck = false;
  ta.placeholder = TEXT.account.placeholder;
  ta.style.minHeight = '76px';
  ta.value = store.getCookie();
  acc.appendChild(ta);

  const st = el('div', 'msg');
  acc.appendChild(st);

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
  const saveBtn = el('button', 'act pri', TEXT.account.actions.save);
  const testBtn = el('button', 'act', TEXT.account.actions.test);
  const clearBtn = el('button', 'act', TEXT.account.actions.clear);
  const pasteBtn = el('button', 'act', TEXT.account.actions.paste);
  btns.append(saveBtn, testBtn, pasteBtn, clearBtn);
  acc.appendChild(btns);

  acc.appendChild(details(TEXT.account.helpTitle, TEXT.account.help));
  body.appendChild(acc);

  const say = (text, color) => {
    st.textContent = text;
    st.style.color = color;
  };

  /* ---- 解析逻辑 ---- */
  let parsedFields = null;
  let chosen = new Set();

  function renderFields() {
    fieldList.textContent = '';
    if (!parsedFields) return;
    for (const k of sortFields(Object.keys(parsedFields))) {
      const t = tierOf(k);
      const lab = el('label');
      lab.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11.5px;padding:2px 0;cursor:pointer';
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = chosen.has(k);
      cb.addEventListener('change', () => {
        cb.checked ? chosen.add(k) : chosen.delete(k);
        updateTaFromChoice();
      });
      const name = el('span', '', k);
      name.style.cssText = 'font-family:var(--mono);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis';
      if (!chosen.has(k)) name.style.opacity = '.4';
      const badge = el('span', '', t.label);
      badge.style.cssText =
        'font-size:9.5px;padding:1px 5px;border-radius:99px;flex-shrink:0;background:' + (TIER_STYLE[t.tier] || TIER_STYLE.optional);
      lab.append(cb, name, badge);
      fieldList.appendChild(lab);
    }
  }

  function updateTaFromChoice() {
    if (!parsedFields) return;
    const picked = joinCookie(parsedFields, sortFields([...chosen]));
    if (picked) ta.value = picked;
    renderFields();
  }

  function doParse() {
    const text = ta.value.trim();
    if (!text) { parsedFields = null; parseBox.style.display = 'none'; return; }
    const { fields, format } = parseCookieText(text);
    const n = Object.keys(fields).length;
    if (!n) {
      parsedFields = null;
      parseBox.style.display = 'none';
      say('⚠ ' + TEXT.account.states.parseFail, '#e6a23c');
      return;
    }
    // 已经是干净 Cookie 字符串时不必再筛选，直接采用
    parsedFields = fields;
    chosen = new Set(pickFields(fields, 'recommended'));
    parseBox.style.display = '';
    fmtLine.textContent = TEXT.account.parsed(format, n) +
      (fields.SESSDATA ? '' : ' · ⚠ ' + TEXT.account.missing);
    presetRow.textContent = '';
    for (const p of [
      { v: 'min', label: TEXT.account.presets.min },
      { v: 'recommended', label: TEXT.account.presets.recommended },
      { v: 'all', label: TEXT.account.presets.all }
    ]) {
      const b = el('button', p.v === 'recommended' ? 'on' : '', p.label);
      b.addEventListener('click', () => {
        chosen = new Set(pickFields(fields, p.v));
        for (const x of presetRow.children) x.className = '';
        b.className = 'on';
        updateTaFromChoice();
      });
      presetRow.appendChild(b);
    }
    updateTaFromChoice();
    if (!fields.SESSDATA) say('⚠ ' + TEXT.account.states.noSessdata, '#f56c6c');
    else say(TEXT.account.states.ready, 'var(--fg)');
  }

  ta.addEventListener('input', () => {
    clearTimeout(ta._t);
    ta._t = setTimeout(doParse, 260);
  });
  ta.addEventListener('paste', () => setTimeout(doParse, 0));

  const runProbe = async (cookie, save) => {
    const c = sanitizeCookie(cookie);
    if (!c) { say(TEXT.account.states.empty, '#f56c6c'); return; }
    const v = validateCookie(c);
    if (!v.ok) { say('❌ ' + v.problems.join('；'), '#f56c6c'); return; }
    if (save) { store.setCookie(c); store.setStrategy(-1); invalidateMixinKey(); resetCache(); pushConfig(liveConfig(getToken())); }
    saveBtn.disabled = testBtn.disabled = true;
    say(TEXT.account.states.verifying, 'var(--fg)');
    const r = await probeIdentity(c);
    saveBtn.disabled = testBtn.disabled = false;
    if (r.ok) {
      const vip = r.account.vipStatus === 1 ? '大会员' : '非会员';
      say(
        '✅ ' + (r.account.uname || '?') + '（mid=' + r.account.mid + '）\n' +
          '会员：' + vip + '\n' +
          strategyLabel(r.strategy) + '\n' +
          '本机账号：' + ((r.aAccount && r.aAccount.uname) || '未登录') + '\n' +
          (save ? TEXT.account.states.savedNote : ''),
        r.account.vipStatus === 1 ? '#00a396' : '#f56c6c'
      );
      refreshAccountLine();
    } else {
      say('❌ ' + r.reason, '#f56c6c');
    }
  };

  saveBtn.addEventListener('click', () => runProbe(ta.value, true));
  testBtn.addEventListener('click', () => runProbe(ta.value || store.getCookie(), false));
  pasteBtn.addEventListener('click', async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) { ta.value = t; doParse(); }
      else say(TEXT.account.states.clipboardEmpty, '#f56c6c');
    } catch {
      say(TEXT.account.states.clipboardDenied, '#f56c6c');
    }
  });
  clearBtn.addEventListener('click', () => {
    if (!confirm(TEXT.account.states.clearConfirm)) return;
    store.setCookie('');
    store.setLastAccount(null);
    store.setStrategy(-1);
    invalidateMixinKey();
    resetCache();
    ta.value = '';
    parsedFields = null;
    parseBox.style.display = 'none';
    pushConfig(liveConfig(getToken()));
    refreshAccountLine();
    say(TEXT.account.states.cleared, '#00a1d6');
  });

  function refreshAccountLine() {
    const cookie = store.getCookie();
    if (!cookie) { accLine.textContent = TEXT.account.empty; return; }
    const last = store.getLastAccount();
    accLine.textContent =
      (last ? last.uname + '（mid=' + last.mid + '，' + (last.vipStatus === 1 ? '大会员' : '非会员') + '）· ' : '') +
      maskCookie(cookie);
  }
  refreshAccountLine();
  const qc = quickCheck();
  say(
    qc.ok ? (qc.warn ? '⚠ 建议补齐：\n' + qc.warn : TEXT.account.states.complete) : '⚠ ' + qc.msg,
    qc.ok ? (qc.warn ? '#e6a23c' : 'var(--fg)') : '#e6a23c'
  );

  /* --- 诊断 --- */
  const diag = section('诊断');
  const dbox = el('div', 'live');
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
      const r = await probeIdentity(getEffectiveCookie());
      say(r.ok ? '✅ ' + strategyLabel(r.strategy) : '❌ ' + r.reason, r.ok ? '#00a396' : '#f56c6c');
    })
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

function mkBtn(text, fn) {
  const b = el('button', 'act', text);
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
    box.appendChild(el('div', 'k', k));
    box.appendChild(el('div', 'v', v));
  };
  put(TEXT.diag.ok, String(stats.proxyOk));
  put(TEXT.diag.fallback, String(stats.proxyFail));
  put(TEXT.diag.cacheHit, String(stats.cacheServed));
  put(TEXT.diag.coalesced, String(c.coalesced));
}

/* ---------------- 挂载与开关 ---------------- */

function toggle(force) {
  open = force === undefined ? !open : force;
  const p = root.querySelector('.panel');
  p.classList.toggle('show', open);
  if (open) {
    renderLive();
    renderDiag();
    if (!tickTimer) tickTimer = setInterval(() => { renderLive(); renderDiag(); }, 1000);
  } else if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  renderDot();
}

function renderDot() {
  const dot = root.querySelector('.dot');
  const face = root.querySelector('.face');
  const s = state();
  face.style.background = s.ok ? '' : s.dot;
  dot.classList.toggle('on', s.ok);
  let badge = root.querySelector('.badge');
  if (!s.ok && s.note) {
    if (!badge) { badge = el('div', 'badge'); dot.appendChild(badge); }
    badge.textContent = '!';
    badge.title = s.note;
  } else if (badge) badge.remove();
  dot.title = (s.ok ? TEXT.badge.running : s.note) + '\n点击展开';
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
    <div class="dot glass" role="button" tabindex="0"><div class="face"></div></div>`;
  (document.body || document.documentElement).appendChild(root);

  const panel = root.querySelector('.panel');
  const api = buildPanel(panel);
  root.querySelector('.title').textContent = TITLE;
  root.querySelector('.x').addEventListener('click', () => toggle(false));
  const dot = root.querySelector('.dot');
  dot.addEventListener('click', () => toggle());
  dot.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });
  void api;

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) toggle(false);
  });
  document.addEventListener('DOMContentLoaded', () => renderDot());
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