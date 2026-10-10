/**
 * 油猴菜单命令 —— 全部指向同一个悬浮面板，不重复提供配置项。
 * 单一入口是刻意的设计：菜单只放「面板里点两下就能做完」的快捷操作。
 */
import { QUALITY_PRESETS } from '../config.js';
import { store } from '../core/store.js';
import { NAME } from '../meta.js';
import { TEXT } from '../core/text.js';
import { log } from '../core/log.js';
import {
  overview,
  saveAccount,
  reprobe,
  switchLoginTo,
  useAutoBorrowSource
} from '../core/switcher.js';
import { strategyLabel } from '../core/session.js';
import { refreshPanel, openPanel, invalidateAfterSettingsChange } from './panel.js';

function notify(text) {
  try {
    GM_notification({ title: NAME, text, timeout: 4500 });
  } catch (e) {
    /* 部分管理器不支持 */
  }
}

/** 切号 / 改借用都会改播放器侧状态，所以统一在这之后刷新徽标与配置 */
function announce(text) {
  notify(text);
  refreshPanel();
}

/** 从剪贴板导入一个账号（面板里粘贴是主路径，这里给不方便开面板的场景） */
async function importFromClipboard() {
  let text;
  try {
    text = await navigator.clipboard.readText();
  } catch (e) {
    notify(TEXT.notify.clipboardDenied);
    return;
  }
  if (!text || !text.trim()) {
    notify(TEXT.notify.clipboardEmpty);
    return;
  }
  const r = await saveAccount(text);
  if (!r.ok) {
    const why = r.reason === 'incomplete' ? TEXT.notify.importNoSessdata : r.reason || '验证失败';
    announce(TEXT.notify.importFail + why);
    return;
  }
  announce(
    (r.isNew ? TEXT.notify.added : TEXT.notify.updated) +
      (r.account.uname || '?') +
      '\n会员：' +
      (r.account.vipStatus === 1 ? TEXT.notify.vip : TEXT.notify.plain)
  );
}

/** 切到下一个有大会员的号并改写浏览器登录态 */
async function switchToNextVip() {
  const o = overview();
  if (!o.canWrite) {
    announce(TEXT.notify.switchUnsupportedLong);
    return;
  }
  const current = o.activeId;
  const vips = o.rows.filter((r) => r.vip && r.id !== current);
  const target = vips[0] || o.rows.find((r) => r.id !== current);
  if (!target) {
    announce(TEXT.notify.nextVipOnly);
    return;
  }
  const r = await switchLoginTo(target.id);
  if (!r.ok) {
    announce(TEXT.notify.switchFail + (r.reason === 'unsupported' ? TEXT.notify.switchUnsupportedShort : r.reason));
    return;
  }
  announce(TEXT.notify.switchDone + (target.label || target.uname || target.mid) + TEXT.notify.reloadSoon);
  setTimeout(() => location.reload(), 1200);
}

export function registerMenus() {
  GM_registerMenuCommand(TEXT.menu.open, openPanel);

  GM_registerMenuCommand(TEXT.menu.toggle, () => {
    store.setEnabled(!store.isEnabled());
    invalidateAfterSettingsChange();
    notify(store.isEnabled() ? TEXT.notify.enabled : TEXT.notify.disabled);
  });

  GM_registerMenuCommand(TEXT.menu.nextVip, switchToNextVip);

  GM_registerMenuCommand(TEXT.menu.autoBorrow, () => {
    const r = useAutoBorrowSource();
    announce(r.ok ? TEXT.notify.autoBorrowOk : TEXT.notify.autoBorrowFail + r.reason);
  });

  GM_registerMenuCommand(TEXT.menu.quality, () => {
    const order = Object.keys(QUALITY_PRESETS);
    const next = order[(order.indexOf(store.getQuality()) + 1) % order.length];
    store.setQuality(next);
    // 必须失效缓存：URL 稳定的端点缓存里存着上一个档位的 qn，
    // 不清的话改档位后最多一个 TTL（120 秒）内画质不会变。
    invalidateAfterSettingsChange();
    // qn 直接取自 config，档位表改了这里不会跟着过期
    notify(TEXT.notify.quality + TEXT.notify.qualityName[next] + ' (qn=' + QUALITY_PRESETS[next].qn + ')');
  });

  GM_registerMenuCommand(TEXT.menu.region, () => {
    const order = ['off', 'hkmo', 'tw', 'cn'];
    const next = order[(order.indexOf(store.getRegion()) + 1) % order.length];
    store.setRegion(next);
    invalidateAfterSettingsChange();
    notify(TEXT.notify.region + next + TEXT.notify.regionTail);
  });

  GM_registerMenuCommand(TEXT.menu.recheck, async () => {
    const r = await reprobe();
    if (!r.ok) {
      announce(TEXT.notify.recheckFail + r.reason);
      return;
    }
    // 重探可能把借用来源换成另一个账号（vipStatus 变了 → resolveBorrow 改判），
    // 旧账号的播放地址还在缓存里，必须失效，否则最多一个 TTL 内仍用旧号的流。
    invalidateAfterSettingsChange();
    announce(
      TEXT.notify.recheckOk + (r.account.uname || '?') + TEXT.notify.recheckMid + r.account.mid + TEXT.notify.recheckMidEnd +
        '\n会员：' + (r.account.vipStatus === 1 ? TEXT.notify.vip : TEXT.notify.plain) +
        '\n' + strategyLabel(r.strategy)
    );
  });

  GM_registerMenuCommand(TEXT.menu.import, importFromClipboard);

  GM_registerMenuCommand(TEXT.menu.debug, () => {
    const next = !store.isDebug();
    store.setDebug(next);
    log.setDebug(next);
    refreshPanel();
    notify(TEXT.notify.debug + (next ? TEXT.notify.on : TEXT.notify.off));
  });
}

