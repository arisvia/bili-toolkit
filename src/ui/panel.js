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
import {
  overview,
  overviewAsync,
  saveAccount,
  testAccount,
  reprobe,
  reprobeAll,
  useAsBorrowSource,
  useAutoBorrowSource,
  switchLoginTo,
  forgetAccount,
  renamePoolAccount,
  importBrowserAccount,
  saveAndApplyScannedAccount,
  exportEncryptedBackup,
  importEncryptedBackup
} from '../core/switcher.js';
import { fetchQrCode, pollQrCode } from '../core/qr-login.js';
import { REGION_MODES } from '../core/region.js';
import { stats, qualityName, codecName, exportLog, setDebug, isDebug } from '../core/log.js';
import { resetCache, cacheStats } from '../core/proxy.js';
import { pushConfig, isHookAlive, getHookSelfCheck, pingHook } from '../core/bus.js';
import { liveConfig } from '../core/inject.js';
import { ensureStyle } from './styles.js';
import { el, section, segmented, row, details, mkBtn, TAG_KIND } from './dom.js';
import { createDockRenderer } from './dock.js';

const ID = NS + '-panel';
const TITLE = NAME;
let root = null;
let open = false;
let tickTimer = null;
/**
 * 账号池的重绘函数。
 * 面板打开期间账号数据可能被外部修改，展开时需按最新状态重绘。
 */
let rerenderPool = null;

function state() {
  if (!store.isEnabled()) return { ok: false, dot: '#9aa0a6', note: TEXT.badge.off };
  if (!hasCookie()) return { ok: false, dot: '#fb7299', note: TEXT.badge.needSetup };
  if (!isHookAlive()) return { ok: false, dot: '#e6a23c', note: TEXT.badge.notReady };
  const o = overview();
  const borrowAcc = o.rows.find((r) => r.isBorrow);
  if (borrowAcc && borrowAcc.invalid) return { ok: false, dot: '#f56c6c', note: TEXT.badge.invalid };
  if (stats.proxyFail > 0 && stats.proxyOk === 0)
    return { ok: false, dot: '#f56c6c', note: TEXT.badge.failing };
  return { ok: true, dot: '', note: '' };
}

function afterChange() {
  resetCache();
  invalidateMixinKey();
  pushConfig(liveConfig());
  renderLive();
}

/** 供菜单命令复用：改完设置后必须走同一套失效，不能只刷界面。 */
export function invalidateAfterSettingsChange() {
  afterChange();
  refreshPanel();
}

const dock = createDockRenderer({
  getRoot: () => root,
  getState: state,
  onToggleBorrow: () => invalidateAfterSettingsChange()
});

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
  q.appendChild(
    row(
      TEXT.quality.video,
      segmented(qOpts, store.getQuality(), (v) => {
        store.setQuality(v);
        afterChange();
      })
    )
  );

  const lOpts = Object.entries(LIVE_QN_PRESETS).map(([k]) => ({
    value: k,
    label: { max: '原画', blue: '蓝光', super: '超清' }[k] || k
  }));
  q.appendChild(
    row(
      TEXT.quality.live,
      segmented(lOpts, store.getLiveQn(), (v) => {
        store.setLiveQn(v);
        afterChange();
      })
    )
  );

  const cOpts = Object.entries(TEXT.codec.presets).map(([k, label]) => ({
    value: k,
    label,
    title: TEXT.codec.titles[k] || label
  }));
  q.appendChild(
    row(
      TEXT.codec.label,
      segmented(cOpts, store.getCodec(), (v) => {
        store.setCodec(v);
        afterChange();
      })
    )
  );

  q.appendChild(el('div', 'hint', TEXT.quality.brief));
  q.appendChild(details(TEXT.quality.title + '怎么用', TEXT.quality.detail));
  q.appendChild(details(TEXT.codec.detailTitle, TEXT.codec.detail));
  body.appendChild(q);

  /* --- 区域 --- */
  const reg = section(TEXT.region.title);
  const rOpts = Object.entries(REGION_MODES).map(([k, v]) => ({ value: k, label: v.label, title: v.hint }));
  reg.appendChild(
    row(
      TEXT.region.label,
      segmented(rOpts, store.getRegion(), (v) => {
        store.setRegion(v);
        afterChange();
        regHint.textContent = TEXT.region.brief[v];
      })
    )
  );
  const regHint = el('div', 'hint', TEXT.region.brief[store.getRegion()]);
  reg.appendChild(regHint);
  reg.appendChild(details(TEXT.region.detailTitle, TEXT.region.detail));
  body.appendChild(reg);

  /* --- 其它开关 --- */
  const misc = section();
  const onOffSeg = (v, set) =>
    segmented(
      [
        { value: true, label: TEXT.switches.on },
        { value: false, label: TEXT.switches.off }
      ],
      v,
      set
    );
  misc.appendChild(
    row(
      TEXT.switches.ui,
      onOffSeg(store.isPatchUi(), (v) => {
        store.setPatchUi(v);
        afterChange();
      })
    )
  );
  misc.appendChild(
    row(
      TEXT.switches.prefetch,
      onOffSeg(store.isPrefetch(), (v) => {
        store.setPrefetch(v);
        afterChange();
      })
    )
  );
  misc.appendChild(
    row(
      TEXT.switches.preferCdn,
      onOffSeg(store.isPreferCdn(), (v) => {
        store.setPreferCdn(v);
        afterChange();
      }),
      TEXT.switches.preferCdnTip
    )
  );
  misc.appendChild(
    row(
      TEXT.switches.softLogout,
      onOffSeg(store.isSoftLogout(), (v) => {
        store.setSoftLogout(v);
        afterChange();
      })
    )
  );
  misc.appendChild(
    row(
      TEXT.switches.debug,
      onOffSeg(isDebug(), (v) => {
        store.setDebug(v);
        setDebug(v);
      })
    )
  );
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
  const poolSec = section();
  const poolHead = el('div', 'lbl-row');
  poolHead.appendChild(el('div', 'lbl', TEXT.pool.title));
  const recheckAllBtn = mkBtn(
    TEXT.pool.actions.recheckAll,
    async () => {
      recheckAllBtn.disabled = true;
      say(TEXT.pool.states.recheckingAll, 'var(--fg)');
      const res = await reprobeAll(({ index, total }) => {
        say(`${TEXT.pool.states.recheckingAll} (${index}/${total})`, 'var(--fg)');
      });
      recheckAllBtn.disabled = false;
      renderPool();
      dock.renderDot();
      say(
        `${TEXT.pool.states.recheckAllDone}${res.okCount}/${res.total}`,
        res.failCount ? '#e6a23c' : '#00a396'
      );
    },
    { title: TEXT.pool.states.recheckAllTip }
  );
  recheckAllBtn.style.cssText = 'padding:2px 8px;font-size:10.5px;display:none';
  poolHead.appendChild(recheckAllBtn);
  poolSec.appendChild(poolHead);
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
    recheckAllBtn.style.display = o.rows.length > 1 ? '' : 'none';
    poolList.textContent = '';
    poolMismatchNodes = [];
    currentTagNode = null;
    // 浏览器身份是异步拿的，而重绘可以被展开/切号/改借用源连续触发 ——
    // 不加序号的话，先发的请求可能后到，把过期的结果画进当前列表。
    const token = ++renderSeq;
    overviewAsync()
      .then((full) => {
        if (token !== renderSeq) return; // 已经有更新的渲染了，丢弃本次回包
        renderBrowserWho(full);
      })
      .catch(() => {});

    if (!o.rows.length) {
      poolList.appendChild(el('div', 'hint', TEXT.pool.emptyHint));
      return o;
    }

    // 说明条：借的不是当前登录号、或手动指定了借用源时，必须一眼看到，
    // 否则用户会以为「我不是大会员所以没生效」
    if (o.borrowedFromOther) {
      const donor = o.rows.find((r) => r.id === o.borrowId);
      const name = donor ? donor.label || donor.uname || 'mid ' + donor.mid : '';
      const tip = el('div', 'hint', '✨ ' + TEXT.pool.borrowOther + name);
      tip.style.cssText =
        'padding:6px 9px;border-radius:8px;background:rgba(0,163,150,.12);color:#00a396;font-weight:600;margin-bottom:4px';
      poolList.appendChild(tip);
    } else if (o.borrowMode === 'manual') {
      const tip = el('div', 'hint', '📌 ' + TEXT.pool.manualBorrow);
      tip.style.cssText =
        'padding:6px 9px;border-radius:8px;background:rgba(230,162,60,.12);color:#e6a23c;font-weight:600;margin-bottom:4px';
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
        const tip = el(
          'div',
          'hint',
          TEXT.pool.autoImportTip + (full.browserUname || 'mid=' + full.browserMid)
        );
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

    const name = el('span', '', r.label || r.uname || 'mid ' + (r.mid || '?'));
    name.style.cssText =
      'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:12px;font-weight:600';
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
    if (r.invalid) {
      const t = mark('warn', TEXT.pool.labels.invalid);
      t.title = TEXT.pool.states.invalidTip;
      tags.appendChild(t);
    } else if (r.stale && r.checkedAt) {
      const t = mark('muted', TEXT.pool.states.stale);
      t.title = TEXT.pool.states.staleTip;
      tags.appendChild(t);
    }
    const vip = el(
      'span',
      'tag ' + (r.vip ? 'vip' : r.invalid ? 'muted' : r.checkedAt ? 'plain' : 'muted'),
      r.vip
        ? TEXT.pool.labels.vip
        : r.invalid
          ? TEXT.pool.labels.plain
          : r.checkedAt
            ? TEXT.pool.labels.plain
            : TEXT.pool.labels.unknown
    );
    tags.appendChild(vip);
    head.appendChild(tags);
    card.appendChild(head);

    const meta = el('div');
    meta.style.cssText = 'font-size:10.5px;opacity:.5;margin-top:2px';
    meta.textContent = [r.uname && r.label ? r.uname : '', r.mid ? 'mid=' + r.mid : '']
      .filter(Boolean)
      .join(' · ');
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
    mgmt.appendChild(
      mkBtn(TEXT.pool.actions.recheck, () => doRecheck(r.id), { title: TEXT.pool.states.recheckTip })
    );
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
        '✅ ' +
          (r.account.uname || '?') +
          ' · ' +
          (r.account.vipStatus === 1 ? TEXT.pool.labels.vip : TEXT.pool.labels.plain),
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
      say(
        TEXT.pool.states.switched + (r.stale.length ? ' · ' + TEXT.pool.states.switchDeleted : '') + warn,
        '#00a396'
      );
      setTimeout(() => location.reload(), 1200);
    } else {
      say(
        (r.reason ? '⚠ ' + r.reason : TEXT.pool.states.switchSelf) + warn,
        r.reason ? '#e6a23c' : 'var(--fg)'
      );
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
      name.style.cssText =
        'font-family:var(--mono);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis';
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
    if (!text) {
      parsedFields = null;
      parseBox.style.display = 'none';
      return;
    }
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
    fmtLine.textContent =
      TEXT.account.parsed(format, n) + (fields.SESSDATA ? '' : ' · ⚠ ' + TEXT.account.missing);
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
  ta.addEventListener('paste', () =>
    setTimeout(() => {
      updateTaAction();
      doParse();
    }, 0)
  );

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

    if (r.reason === 'empty') {
      msg(TEXT.account.states.empty, '#f56c6c');
      return;
    }
    if (r.reason === 'incomplete') {
      msg('❌ ' + ((r.problems && r.problems.join('；')) || TEXT.account.states.noSessdata), '#f56c6c');
      return;
    }
    if (r.ok) {
      const vip = r.account.vipStatus === 1 ? TEXT.pool.labels.vip : TEXT.pool.labels.plain;
      msg(
        '✅ ' +
          (r.account.uname || '?') +
          '（mid=' +
          r.account.mid +
          '）\n' +
          '会员：' +
          vip +
          '\n' +
          strategyLabel(r.strategy) +
          '\n' +
          '本机账号：' +
          ((r.aAccount && r.aAccount.uname) || '未登录') +
          '\n' +
          (save
            ? r.isNew
              ? !overview().browserMid
                ? TEXT.account.states.savedNotLoggedIn
                : TEXT.account.states.savedNote
              : TEXT.account.states.savedTwice
            : ''),
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
    setTimeout(() => {
      card.style.boxShadow = '';
    }, 1400);
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
          say(
            '✅ ' +
              TEXT.qr.successToast +
              (saved.account ? ' (' + (saved.account.uname || saved.account.mid) + ')' : ''),
            '#00a396'
          );
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

  /* --- 加密备份与迁移 --- */
  const bak = section(TEXT.backup.title);
  const bakBtns = el('div', 'btns');
  bakBtns.append(
    mkBtn(TEXT.backup.exportBtn, async () => {
      if (!overview().rows.length) {
        say('⚠ ' + TEXT.backup.emptyPool, '#e6a23c');
        return;
      }
      const pwd = prompt(TEXT.backup.pwdPromptExport);
      if (pwd === null) return;
      try {
        const res = await exportEncryptedBackup(pwd);
        let copied = false;
        try {
          await navigator.clipboard.writeText(res.text);
          copied = true;
        } catch {}
        try {
          const blob = new Blob([res.text], { type: 'application/json;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `bili-toolkit-backup-${new Date().toISOString().slice(0, 10)}.json`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch {}
        say('✅ ' + (copied ? TEXT.backup.exportedOk : TEXT.backup.exportedDownloaded), '#00a396');
      } catch (e) {
        say('❌ ' + TEXT.backup.failed + ((e && e.message) || e), '#f56c6c');
      }
    }),
    mkBtn(TEXT.backup.importBtn, async () => {
      const raw = prompt(TEXT.backup.importPasteAsk);
      if (!raw || !raw.trim()) return;
      const pwd = prompt(TEXT.backup.pwdPromptImport);
      if (pwd === null) return;
      const applySettings = confirm(TEXT.backup.importApplySettings);
      try {
        const res = await importEncryptedBackup(raw, pwd, { applySettings });
        renderPool();
        dock.renderDot();
        renderLive();
        say(`✅ ${TEXT.backup.importedOk}+${res.added} / ↻${res.updated}`, '#00a396');
      } catch (e) {
        say('❌ ' + TEXT.backup.failed + ((e && e.message) || e), '#f56c6c');
      }
    })
  );
  bak.appendChild(bakBtns);
  body.appendChild(bak);

  /* --- 诊断 --- */
  const diag = section(TEXT.diag.title);
  const dbox = el('div', 'stats');
  dbox.id = ID + '-diag';
  diag.appendChild(dbox);
  const db = el('div', 'btns');
  db.append(
    mkBtn(TEXT.diag.actions.copyLog, async () => {
      try {
        await navigator.clipboard.writeText(exportLog());
        say(TEXT.account.states.copiedLog, '#00a396');
      } catch {
        say(TEXT.account.states.copyFailed, '#f56c6c');
      }
    }),
    mkBtn(TEXT.diag.actions.clearCache, () => {
      resetCache();
      renderLive();
    }),
    mkBtn(
      TEXT.diag.actions.reprobe,
      async () => {
        say(TEXT.diag.retrying, 'var(--fg)');
        store.setStrategy(-1);
        const r = await reprobe();
        invalidateAfterSettingsChange();
        renderPool();
        say(r.ok ? '✅ ' + strategyLabel(r.strategy) : '❌ ' + r.reason, r.ok ? '#00a396' : '#f56c6c');
      },
      { title: TEXT.diag.reprobeTip }
    )
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

  pingHook();
  const sc = getHookSelfCheck();
  const hits = stats.proxyOk + stats.cacheServed;
  const s2 = el('span', 's');
  s2.appendChild(el('span', 'k', TEXT.diag.selfCheck));
  let txt = TEXT.diag.selfDead;
  let warn = true;
  if (sc) {
    warn = !sc.playinfoHooked;
    const borrowActive = sc.canBorrow !== undefined ? sc.canBorrow : sc.hidePlayinfo;
    txt = !sc.playinfoHooked
      ? TEXT.diag.selfNoPlayinfo
      : !borrowActive
        ? (hits ? TEXT.diag.selfPlayinfoNotNeeded : TEXT.diag.selfNoBorrow).replace('{n}', hits)
        : !hits
          ? TEXT.diag.selfNoIntercept
          : (sc.playinfoHidden ? TEXT.diag.selfOk : TEXT.diag.selfPlayinfoOff).replace('{n}', hits);
  }
  const v2 = el('span', 'v', txt);
  if (warn) v2.style.color = '#e6a23c';
  s2.appendChild(v2);
  s2.title = sc
    ? TEXT.diag.selfCheckTip + TEXT.diag.selfHookForward.replace('{n}', sc.intercepted)
    : TEXT.diag.selfCheckTip;
  box.appendChild(s2);
}

/* ---------------- 挂载与开关 ---------------- */

function toggle(force) {
  open = force === undefined ? !open : force;
  const p = root.querySelector('.panel');
  p.classList.toggle('show', open);
  if (open) {
    if (rerenderPool) rerenderPool();
    renderLive();
    renderDiag();
    if (!tickTimer)
      tickTimer = setInterval(() => {
        renderLive();
        renderDiag();
      }, 1000);
  } else if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  dock.renderDot();
}

function isEditableTarget(elNode) {
  if (!elNode) return false;
  const tag = (elNode.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!elNode.isContentEditable;
}

export function mountPanel() {
  if (root && root.isConnected) {
    dock.renderDot();
    return;
  }
  ensureStyle(ID);
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
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  });
  const wrap = root.querySelector('.dock-wrap');
  if (wrap) {
    wrap.addEventListener('mouseenter', () => dock.renderDockTray());
  }
  void api;

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) {
      toggle(false);
      return;
    }
    if (
      e.altKey &&
      e.shiftKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      String(e.key || '').toLowerCase() === 'b' &&
      !isEditableTarget(e.target)
    ) {
      e.preventDefault();
      toggle();
    }
  });
  document.addEventListener('DOMContentLoaded', () => dock.renderDot());
  overviewAsync()
    .then(() => dock.renderDot())
    .catch(() => {});
  dock.renderDot();
  setInterval(() => dock.renderDot(), 2000);
}

/** 菜单命令统一走这里，避免出现第二份配置界面 */
export function openPanel() {
  mountPanel();
  toggle(true);
}

/** 外部（如代理完成或跨标签页同步）要求刷新徽标与面板时调用 */
export function refreshPanel() {
  if (!root) return;
  dock.renderDot();
  if (open) {
    if (rerenderPool) rerenderPool();
    renderLive();
    renderDiag();
  }
}
