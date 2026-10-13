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
import { softLogout } from './switcher.js';

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

// 这里原本有个 notifyReady()，往钩子发 type:'ready'。钩子从来没监听这个类型，
// 沙箱也从来没调用过这个函数 —— 握手方向是单向的（钩子 hello → 沙箱 welcome）。
// 真要报状态，钩子回的是 'pong'（见 pingHook / getHookSelfCheck）。

function respond(id, data) {
  post(Object.assign({ type: 'resp', id, token: channelToken }, data));
}

let hookAlive = false;
/** 钩子自检结果。null = 还没问过；对象见 hook.js 的 selfState() 字段说明 */
let hookSelfCheck = null;
export function isHookAlive() {
  return hookAlive;
}
export function getHookSelfCheck() {
  return hookSelfCheck;
}

/**
 * 问一次钩子的当前状态。
 *
 * 为什么要主动 ping 而不只是等 hello：hello 只能证明「脚本跑起来了」，
 * 而最难查的故障是「首次不生效、切画质后才行」—— 那时钩子活着，
 * 拦截链路却可能根本没接上。面板打开时问一次，把静默故障变成可见信号。
 */
export function pingHook() {
  if (!hookAlive) return false;
  post({ type: 'ping', token: channelToken });
  return true;
}

export function startBus(getConfig) {
  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (!d || d.__ns !== NS) return;
    // 只接受同源窗口发来的消息（在沙箱与主世界跨上下文通信中，ev.source 是跨界代理对象，不能用 ev.source !== window）
    if (ev.origin && ev.origin !== location.origin) return;
    if (d.token !== channelToken) return;

    switch (d.type) {
      case 'hello': {
        hookAlive = true;
        if (d.state) hookSelfCheck = d.state;
        post({ type: 'welcome', token: channelToken });
        // 握手时立刻补发一次配置，覆盖「注入早于配置生成」的情况
        pushConfig(getConfig());
        break;
      }
      case 'pong': {
        hookSelfCheck = d.state || hookSelfCheck;
        break;
      }
      case 'logout': {
        const id = d.id;
        if (id === undefined || id === null) return;
        softLogout()
          .then((res) => {
            if (!res.ok) {
              // 无法删除持久 Cookie 时绝不能伪造成功，放行让原生退出流程处理
              respond(id, { passthrough: true });
              return;
            }
            respond(id, {
              status: 200,
              statusText: 'OK',
              headersRaw: 'content-type: application/json; charset=utf-8\r\n',
              body: JSON.stringify({
                code: 0,
                status: true,
                data: { redirectUrl: 'https://www.bilibili.com' },
                message: ''
              })
            });
          })
          .catch((err) => {
            log.warn('软登出失败', err);
            respond(id, { passthrough: true });
          });
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