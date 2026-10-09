/**
 * 入口。
 *
 * 启动顺序很重要：
 *   1. 生成通道令牌（每次页面加载随机）
 *   2. 先把消息通道挂上 —— 否则钩子注入后立刻发来的 hello 会丢失
 *   3. 再把钩子注入主世界（配置内联，见 core/inject.js）
 *   4. 最后起 UI
 */
import hookSource from './injected/hook.js';
import { setToken, startBus, pushConfig, getToken } from './core/bus.js';
import { injectHook, liveConfig } from './core/inject.js';
import { store } from './core/store.js';
import { setDebug, log } from './core/log.js';
import { mountPanel, refreshPanel } from './ui/panel.js';
import { registerMenus } from './ui/menu.js';
import { cookieProblem, ensureMixinKey } from './core/session.js';

function randomToken() {
  const buf = new Uint32Array(4);
  try {
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(buf);
  } catch (e) {}
  let hex = '';
  for (const v of buf) {
    hex += (v || Math.floor(Math.random() * 0xffffffff) + 1).toString(16).padStart(8, '0');
  }
  return hex;
}

function boot() {
  setDebug(store.isDebug());
  const token = randomToken();
  setToken(token);

  startBus(() => liveConfig(getToken()));
  injectHook(hookSource, token, (ok) => {
    if (!ok) log.warn('钩子注入失败（documentElement 迟迟不可用）');
    else pushConfig(liveConfig(token));
    refreshPanel();
  });

  // 提前把 wbi 密钥拉好。原来是懒加载（等第一次要签名时才去取），
  // 而播放器的首个 playurl 往往几十毫秒内就到，必然赶不上 → 第一次永远退回原始参数。
  if (store.isEnabled() && store.getCookie()) {
    ensureMixinKey().then((k) => {
      if (!k) log.warn('未能获取 wbi 密钥，画质参数将不会升级。可在面板诊断区点「重探签名密钥」重试。');
      else refreshPanel();
    });
  }

  mountPanel();
  registerMenus();

  // 没有 Cookie 时给一次性提示，避免用户对着「画质没变」发呆
  if (store.isEnabled() && !store.getCookie()) {
    setTimeout(() => log.warn('尚未设置 B 账号 Cookie，点左下角圆点打开面板。'), 1500);
  } else if (store.isEnabled()) {
    const problem = cookieProblem();
    if (problem) setTimeout(() => log.warn('B 账号 Cookie 有问题：' + problem), 1500);
  }
}

// @run-at document-start：立刻启动，抢在播放器发出首个播放请求之前
boot();