/**
 * 主世界钩子入口 —— 经 esbuild 独立打包压缩后以字符串形式内联注入页面（document-start）。
 *
 * 与沙箱共享 src/shared/vip.js 与 src/shared/region.js，不再手写双份副本；
 * 网络响应模拟、nanoPlayer 接管与首屏预热分别拆至 emulate.js / nano.js / prefetch.js。
 */
import { patchVipFlags } from '../shared/vip.js';
import { patchRegion, patchSsRegionState } from '../shared/region.js';
import { makeResponse, emulateXhr, serializeHeaders, serializeBody } from './emulate.js';
import { createNanoController } from './nano.js';
import { createPrefetcher } from './prefetch.js';

(function () {
  'use strict';

  const CFG = __BILI_VIP_CFG__;

  if (window.__BILI_VIP_HOOKED__) return;
  window.__BILI_VIP_HOOKED__ = true;

  const NS = CFG.ns;
  const HOSTS = CFG.hosts;
  const SANDBOX_ENTRIES = CFG.sandboxEntries; // [{host, path, method}]
  const LOCAL_ENTRIES = CFG.localEntries; // [{host, path}]
  const TIMEOUT = CFG.timeoutMs || 15000;

  let token = CFG.token || '';
  let hidePlayinfo = !!CFG.hidePlayinfo;
  let canBorrow = CFG.canBorrow === undefined ? hidePlayinfo : !!CFG.canBorrow;
  let patchVip =
    CFG.patchVip === undefined ? canBorrow && (CFG.patchUi === undefined ? true : !!CFG.patchUi) : !!CFG.patchVip;
  let patchUi = !!CFG.patchUi;
  let doPrefetch = !!CFG.prefetch;
  let softLogout = CFG.softLogout !== false;
  let region = CFG.region || 'off';

  let sandboxAlive = true;
  const pending = Object.create(null);
  let seq = 1;

  let intercepted = 0;
  let playinfoHooked = false;

  function getState() {
    return { token, hidePlayinfo, canBorrow, patchVip, patchUi, doPrefetch, softLogout, region };
  }

  /* ---------------- URL 匹配 ---------------- */

  function toAbsolute(u) {
    if (!u) return '';
    try {
      return new URL(String(u), location.href).href;
    } catch (e) {
      return '';
    }
  }

  function hit(u, entries, method) {
    let parsed;
    try {
      parsed = new URL(u);
    } catch (e) {
      return false;
    }
    if (parsed.protocol !== 'https:') return false;
    if (HOSTS.indexOf(parsed.hostname) === -1) return false;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (parsed.hostname === e.host && parsed.pathname === e.path) {
        if (!method || !e.method || e.method === method) return true;
      }
    }
    return false;
  }

  function isSandboxTarget(u, method) {
    return hit(u, SANDBOX_ENTRIES, method);
  }

  function isLocalTarget(u) {
    return hit(u, LOCAL_ENTRIES, null);
  }

  function isLogoutTarget(u, method) {
    let parsed;
    try {
      parsed = new URL(u);
    } catch (e) {
      return false;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    if (parsed.hostname !== 'passport.bilibili.com') return false;
    if (parsed.pathname !== '/login/exit/v2') return false;
    if (method && String(method).toUpperCase() !== 'POST') return false;
    return true;
  }

  /* ---------------- 与沙箱通信 ---------------- */

  function post(msg) {
    msg.__ns = NS;
    window.postMessage(msg, '*');
  }

  function callSandbox(payload, timeoutMs) {
    return new Promise((resolve) => {
      if (!sandboxAlive) {
        resolve({ passthrough: true, error: 'sandbox-dead' });
        return;
      }
      const id = seq++;
      const timer = setTimeout(() => {
        if (pending[id]) {
          delete pending[id];
          resolve({ passthrough: true, error: 'timeout' });
        }
      }, timeoutMs || TIMEOUT);
      pending[id] = (res) => {
        clearTimeout(timer);
        resolve(res);
      };
      payload.type = payload.type || 'req';
      payload.id = id;
      payload.token = token;
      intercepted++;
      post(payload);
    });
  }

  const nanoCtrl = createNanoController(getState);

  function selfState() {
    let hidden = false;
    try {
      hidden = hidePlayinfo && typeof window.__playinfo__ === 'undefined';
    } catch (e) {}
    return {
      intercepted: intercepted,
      playinfoHooked: playinfoHooked,
      playinfoHidden: playinfoHooked && hidden,
      hidePlayinfo: hidePlayinfo,
      canBorrow: canBorrow,
      softLogout: softLogout,
      sandboxAlive: sandboxAlive
    };
  }

  function applyCfg(cfg) {
    if (!cfg) return;
    if (typeof cfg.hidePlayinfo === 'boolean') hidePlayinfo = cfg.hidePlayinfo;
    if (typeof cfg.canBorrow === 'boolean') canBorrow = cfg.canBorrow;
    if (typeof cfg.patchVip === 'boolean') patchVip = cfg.patchVip;
    if (typeof cfg.patchUi === 'boolean') patchUi = cfg.patchUi;
    if (typeof cfg.prefetch === 'boolean') doPrefetch = cfg.prefetch;
    if (typeof cfg.softLogout === 'boolean') softLogout = cfg.softLogout;
    if (typeof cfg.region === 'string') region = cfg.region;
    updateSsHooks();
    nanoCtrl.onConfigChange();
  }

  window.addEventListener('message', (ev) => {
    if (ev.origin && ev.origin !== location.origin) return;
    const d = ev.data;
    if (!d || d.__ns !== NS) return;
    sandboxAlive = true;
    if (d.token !== token) return;
    if (d.type === 'resp' && d.id !== undefined) {
      const fn = pending[d.id];
      if (fn) {
        delete pending[d.id];
        fn(d);
      }
    } else if (d.type === 'welcome' || d.type === 'cfg') {
      applyCfg(d.cfg);
    } else if (d.type === 'ping') {
      post({ type: 'pong', token: token, state: selfState() });
    }
  });

  /* ---------------- SSR 处理 ---------------- */

  let playinfoValue;
  try {
    playinfoValue = window.__playinfo__;
  } catch (e) {}
  try {
    Object.defineProperty(window, '__playinfo__', {
      configurable: true,
      enumerable: true,
      get() {
        return hidePlayinfo ? undefined : playinfoValue;
      },
      set(v) {
        playinfoValue = v;
      }
    });
    playinfoHooked = true;
  } catch (e) {}

  let hydrateValue;
  try {
    hydrateValue = window.__PLAYURL_HYDRATE_DATA__;
  } catch (e) {}
  try {
    Object.defineProperty(window, '__PLAYURL_HYDRATE_DATA__', {
      configurable: true,
      enumerable: true,
      get() {
        return patchVip && hydrateValue ? patchVipFlags(hydrateValue) : hydrateValue;
      },
      set(v) {
        hydrateValue = patchVip && v ? patchVipFlags(v) : v;
      }
    });
  } catch (e) {}

  nanoCtrl.install();

  function patchSsUser() {
    try {
      const s = window.__INITIAL_STATE__;
      if (!s) return;
      if (patchVip && s.user && typeof s.user === 'object') {
        if (typeof s.user.vipStatus === 'number' && s.user.vipStatus !== 1) s.user.vipStatus = 1;
        if (typeof s.user.vipType === 'number' && s.user.vipType !== 2) s.user.vipType = 2;
        const v = s.user.vip;
        if (v && typeof v === 'object') {
          if (typeof v.status === 'number' && v.status !== 1) v.status = 1;
          if (typeof v.type === 'number' && v.type !== 2) v.type = 2;
        }
      }
      if (region !== 'off') patchSsRegionState(s, region);
    } catch (e) {}
  }

  let ssTimer = null;
  function updateSsHooks() {
    if (patchVip || region !== 'off') {
      if (!ssTimer) {
        ssTimer = setInterval(patchSsUser, 200);
        setTimeout(() => {
          if (ssTimer) {
            clearInterval(ssTimer);
            ssTimer = null;
          }
        }, 30000);
      }
    } else if (ssTimer) {
      clearInterval(ssTimer);
      ssTimer = null;
    }
  }
  updateSsHooks();

  /* ---------------- 本地响应伪装 ---------------- */

  function patchLocal(text) {
    if (!patchVip && region === 'off') return text;
    try {
      const o = JSON.parse(text);
      if (o && typeof o === 'object') {
        if (patchVip) patchVipFlags(o);
        if (region !== 'off') patchRegion(o, region);
        return JSON.stringify(o);
      }
    } catch (e) {}
    return text;
  }

  /* ---------------- 网络拦截（XHR 与 fetch） ---------------- */

  const origFetch = window.fetch;
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__biliVip = {
      method: String(method || 'GET').toUpperCase(),
      url: toAbsolute(typeof url === 'string' ? url : (url && url.href) || ''),
      headers: {},
      handled: false
    };
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    if (this.__biliVip) this.__biliVip.headers[String(k)] = String(v);
    return origSetHeader.call(this, k, v);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const st = this.__biliVip;
    if (!st || st.handled) return origSend.apply(this, arguments);

    if (softLogout && isLogoutTarget(st.url, st.method)) {
      st.handled = true;
      const self0 = this;
      callSandbox({ type: 'logout', method: st.method, url: st.url }).then((res) => {
        if (res && !res.passthrough && res.body !== undefined) {
          emulateXhr(self0, res, st.url);
          return;
        }
        origSend.call(self0, body);
      });
      return;
    }

    if (isSandboxTarget(st.url, st.method)) {
      st.handled = true;
      const self = this;
      callSandbox({
        method: st.method,
        url: st.url,
        headers: st.headers,
        body: typeof body === 'string' ? body : ''
      }).then((res) => {
        if (res && !res.passthrough && res.body !== undefined) {
          emulateXhr(self, res, st.url);
          return;
        }
        origSend.call(self, body);
      });
      return;
    }

    if (isLocalTarget(st.url)) {
      st.handled = true;
      const self2 = this;
      origFetch(st.url, {
        method: st.method,
        headers: st.headers,
        credentials: 'include'
      })
        .then((resp) => {
          if (!resp || !resp.ok) throw new Error('bad response');
          return resp.clone().text();
        })
        .then((text) => {
          emulateXhr(self2, { status: 200, statusText: 'OK', body: patchLocal(text), headersRaw: '' }, st.url);
        })
        .catch(() => {
          origSend.call(self2, body);
        });
      return;
    }

    return origSend.apply(this, arguments);
  };

  window.fetch = function (input, init) {
    const self = this;
    const args = arguments;
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    const url = toAbsolute(typeof input === 'string' ? input : (input && (input.url || input.href)) || '');

    if (softLogout && isLogoutTarget(url, method)) {
      return callSandbox({ type: 'logout', method, url }).then((res) => {
        if (res && !res.passthrough && res.body !== undefined) return makeResponse(res, url);
        return origFetch.apply(self, args);
      });
    }

    if (isSandboxTarget(url, method)) {
      return callSandbox({
        method,
        url,
        headers: serializeHeaders((init && init.headers) || (input && input.headers)),
        body: serializeBody(init, input)
      }).then((res) => {
        if (res && !res.passthrough && res.body !== undefined) return makeResponse(res, url);
        return origFetch.apply(self, args);
      });
    }

    if (isLocalTarget(url)) {
      return origFetch.apply(self, args).then((resp) => {
        if (!resp || !resp.ok) return resp;
        return resp
          .clone()
          .text()
          .then((t) => makeResponse({ body: patchLocal(t), status: resp.status, statusText: resp.statusText, headersRaw: '' }, url));
      });
    }

    return origFetch.apply(self, args);
  };

  /* ---------------- 预热与握手 ---------------- */

  const prefetcher = createPrefetcher(getState, post);
  post({ type: 'hello', token: token, state: selfState() });
  prefetcher.start();
})();