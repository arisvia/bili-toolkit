/**
 * 沙箱 ↔ 主世界 的消息通道。
 *
 * 安全边界在这里：沙箱收到请求后会**独立**用 endpoints 表复检 host/method/path，
 * 只有命中白名单才允许携带 B 的 Cookie。页面脚本即使伪造消息、猜到令牌，
 * 也无法让脚本把 B 的凭证发往白名单之外的目标。
 */
import { NS } from '../config.js';
import { handleRequest, prefetch } from './proxy.js';
import { log, stats } from './log.js';

let channelToken = '';

export function setToken(t) {
  channelToken = String(t || '');
}

export function getToken() {
  return channelToken;
}

function post(msg) {
  msg.__ns = NS;
  window.postMessage(msg, '*');
}

/** 把当前配置推给钩子 */
export function pushConfig(cfg) {
  post({ type: 'cfg', token: channelToken, cfg });
}

export function notifyReady(hookReady) {
  post({ type: 'ready', token: channelToken, hookReady: !!hookReady });
}

function respond(id, data) {
  post(Object.assign({ type: 'resp', id, token: channelToken }, data));
}

let hookAlive = false;
export function isHookAlive() {
  return hookAlive;
}

export function startBus(getConfig) {
  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (!d || d.__ns !== NS) return;
    // 只接受同源窗口发来的消息，避免被第三方 iframe 干扰
    if (ev.source !== window) return;
    if (d.token !== channelToken) return;

    switch (d.type) {
      case 'hello': {
        hookAlive = true;
        post({ type: 'welcome', token: channelToken });
        // 握手时立刻补发一次配置，覆盖「注入早于配置生成」的情况
        pushConfig(getConfig());
        break;
      }
      case 'req': {
        const id = d.id;
        if (id === undefined || id === null) return;
        if (typeof d.url !== 'string' || !d.url) {
          respond(id, { passthrough: true });
          return;
        }
        handleRequest({
          url: d.url,
          method: d.method || 'GET',
          headers: d.headers || {},
          body: d.body || ''
        })
          .then((r) => respond(id, r))
          .catch(() => respond(id, { passthrough: true }));
        break;
      }
      case 'prefetch': {
        if (typeof d.url !== 'string') return;
        prefetch(d.url, d.method || 'GET', d.body || '', d.headers || {});
        break;
      }
      case 'stats': {
        post({ type: 'stats', token: channelToken, stats });
        break;
      }
      default:
        break;
    }
  });

  // 页面导航不会重置钩子，但会清掉 __playinfo__；这里不做处理，由钩子自己监听
  log.debug('消息通道已启动');
}