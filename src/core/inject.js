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
  return {
    ns: NS,
    token,
    hosts: HOSTS,
    // 钩子里路径+方法是精确匹配的，代理端点与合并端点都需要转交沙箱
    sandboxEntries: ENDPOINTS.map((ep) => ({ host: ep.host, path: ep.path, method: ep.method })),
    localEntries: LOCAL_PATCH_PATHS.map((p) => ({ host: p.host, path: p.path })),
    timeoutMs: DEFAULTS.timeoutMs,
    hidePlayinfo: store.isEnabled() && hasCookie(),
    patchUi: store.isPatchUi(),
    prefetch: store.isPrefetch(),
    region: store.getRegion()
  };
}

/** 当前配置（用于 postMessage 推送时的增量更新） */
export function liveConfig() {
  return {
    hidePlayinfo: store.isEnabled() && hasCookie(),
    patchUi: store.isPatchUi(),
    prefetch: store.isPrefetch(),
    region: store.getRegion()
  };
}

function injectNow(source, done) {
  const el = document.createElement('script');
  el.textContent = source;
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