/**
 * 把钩子源码注入主世界。
 *
 * 用法上有一个关键点：**配置要内联进注入的源码**，而不是等注入完再 postMessage。
 * 内联之后，钩子一执行就知道该做什么，不存在「配置还没到，第一个请求已经发出去」的窗口。
 */
import { NS, CFG_PLACEHOLDER, HOSTS, DEFAULTS } from '../config.js';
import { ENDPOINTS, LOCAL_PATCH_PATHS } from './endpoints.js';
import { store } from './store.js';
import { hasCookie } from './session.js';

export function buildHookConfig(token) {
  const enabled = store.isEnabled();
  const hasB = hasCookie();
  const patchUi = store.isPatchUi();
  return {
    ns: NS,
    token,
    hosts: HOSTS,
    // 钩子里路径+方法是精确匹配的，代理端点与合并端点都需要转交沙箱
    sandboxEntries: ENDPOINTS.map((ep) => ({ host: ep.host, path: ep.path, method: ep.method })),
    localEntries: LOCAL_PATCH_PATHS.map((p) => ({ host: p.host, path: p.path })),
    timeoutMs: DEFAULTS.timeoutMs,
    // 首屏先挡掉 SSR 播放数据，强制播放器走 playurl（即便 GM 存储短暂未就绪也能防止先消费试看流）。
    hidePlayinfo: enabled,
    // 是否具备真实借用条件（总开关开启且有可用账号），用于控制播放器接管与 reload。
    canBorrow: enabled && hasB,
    // 是否改写页面会员标志并清理试看提示条 / 收银台：必须同时开启总开关、界面伪装且有可用账号。
    patchVip: enabled && patchUi && hasB,
    patchUi,
    prefetch: store.isPrefetch(),
    softLogout: store.isSoftLogout(),
    region: store.getRegion()
  };
}

/** 当前配置（用于 postMessage 推送时的增量更新） */
export function liveConfig() {
  const enabled = store.isEnabled();
  const hasB = hasCookie();
  const patchUi = store.isPatchUi();
  return {
    hidePlayinfo: enabled,
    canBorrow: enabled && hasB,
    patchVip: enabled && patchUi && hasB,
    patchUi,
    prefetch: store.isPrefetch(),
    softLogout: store.isSoftLogout(),
    region: store.getRegion()
  };
}

function getTrustedScript(source) {
  if (typeof window !== 'undefined' && window.trustedTypes && typeof window.trustedTypes.createPolicy === 'function') {
    try {
      const policy = window.trustedTypes.createPolicy('bili-toolkit#hook', {
        createScript: (s) => s
      });
      return policy.createScript(source);
    } catch (e) {
      // policy 名称已被占用时尝试直接返回原字符串或使用 default policy
    }
  }
  return source;
}

function injectNow(source, done) {
  const el = document.createElement('script');
  const trusted = getTrustedScript(source);
  try {
    el.textContent = trusted;
  } catch (e) {
    el.text = trusted;
  }
  el.setAttribute('data-bili-vip', '1');
  const parent = document.head || document.documentElement || document.body;
  if (!parent) return false;
  parent.appendChild(el);
  // 异步移除脚本节点，确保内联脚本在所有浏览器执行环境中均能完整执行
  try {
    setTimeout(() => {
      try { el.remove(); } catch (e) {}
    }, 0);
  } catch (e) {}
  if (done) done(true);
  return true;
}

/**
 * 等待 documentElement 出现后立刻注入。
 * document-start 阶段它通常已经存在；万一没有，用 0ms 轮询兜底（比原版的 10ms 更快）。
 */
export function injectHook(hookSource, token, done) {
  const source = hookSource.replace(CFG_PLACEHOLDER, JSON.stringify(buildHookConfig(token)));
  if (injectNow(source, done)) return;

  const started = Date.now();
  const timer = setInterval(() => {
    if (document.documentElement) {
      clearInterval(timer);
      injectNow(source, done);
    } else if (Date.now() - started > 3000) {
      clearInterval(timer);
      if (done) done(false);
    }
  }, 0);
}