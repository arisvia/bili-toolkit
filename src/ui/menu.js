/**
 * 油猴菜单命令 —— 全部指向同一个悬浮面板，不重复提供配置项。
 * 单一入口是刻意的设计：旧脚本在菜单和弹窗里各放了一份开关，改一处忘一处。
 */
import { store } from '../core/store.js';
import { sanitizeCookie } from '../core/cookie.js';
import { invalidateMixinKey, probeIdentity } from '../core/session.js';
import { resetCache } from '../core/proxy.js';
import { pushConfig, getToken } from '../core/bus.js';
import { liveConfig } from '../core/inject.js';
import { setDebug } from '../core/log.js';
import { refreshPanel, openPanel } from './panel.js';
import { NAME } from '../meta.js';

function notify(text) {
  try {
    GM_notification({ title: NAME, text, timeout: 4500 });
  } catch (e) {
    /* 部分管理器不支持 */
  }
}

function applyChange() {
  resetCache();
  invalidateMixinKey();
  pushConfig(liveConfig(getToken()));
  refreshPanel();
}

export function registerMenus() {
  GM_registerMenuCommand('⚙️ 打开面板', openPanel);

  GM_registerMenuCommand('🔀 启用 / 停用权益借用', () => {
    store.setEnabled(!store.isEnabled());
    applyChange();
    notify(store.isEnabled() ? '已启用（刷新视频页生效）' : '已停用（刷新视频页生效）');
  });

  GM_registerMenuCommand('🎚 切换画质请求档位', () => {
    const order = ['max', 'uhd', 'hd60', 'hd'];
    const labels = { max: '自动最高 (qn=127)', uhd: '4K (qn=120)', hd60: '1080P60 (qn=116)', hd: '1080P (qn=80)' };
    const next = order[(order.indexOf(store.getQuality()) + 1) % order.length];
    store.setQuality(next);
    applyChange();
    notify('画质档位 → ' + labels[next]);
  });

  GM_registerMenuCommand('🌏 切换区域形态', () => {
    const order = ['off', 'hkmo', 'tw', 'cn'];
    const next = order[(order.indexOf(store.getRegion()) + 1) % order.length];
    store.setRegion(next);
    applyChange();
    notify('区域形态 → ' + next + '（刷新页面生效）');
  });

  GM_registerMenuCommand('🧪 测试 B 账号 Cookie', async () => {
    const r = await probeIdentity();
    if (!r.ok) { notify('❌ ' + r.reason); return; }
    notify(`B = ${r.account.uname}（mid=${r.account.mid}）\n会员：${r.account.vipStatus === 1 ? '大会员' : '非会员'}\n发送方式 ${r.strategy + 1}`);
  });

  GM_registerMenuCommand('🧽 从剪贴板导入并保存', async () => {
    try {
      const text = await navigator.clipboard.readText();
      const c = sanitizeCookie(text);
      if (!c) { notify('剪贴板是空的'); return; }
      store.setCookie(c);
      store.setStrategy(-1);
      applyChange();
      const r = await probeIdentity(c);
      notify(r.ok ? `已导入：${r.account.uname}，会员：${r.account.vipStatus === 1 ? '是' : '否'}` : '已导入但验证失败：' + r.reason);
    } catch (e) {
      notify('无法读取剪贴板，请打开面板手动粘贴');
    }
  });

  GM_registerMenuCommand('🗑 清除 B 账号 Cookie', () => {
    if (!confirm('确定清除 B 账号（大会员）Cookie 吗？')) return;
    store.setCookie('');
    store.setLastAccount(null);
    store.setStrategy(-1);
    applyChange();
    notify('已清除');
  });

  GM_registerMenuCommand('🐛 调试日志开关', () => {
    const next = !store.isDebug();
    store.setDebug(next);
    setDebug(next);
    refreshPanel();
    notify('调试日志：' + (next ? '开' : '关'));
  });
}