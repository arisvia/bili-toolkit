/**
 * 主世界钩子 —— 这段代码会被内联进页面（document-start，appendChild 一个 <script>）。
 *
 * 它只做三件事：
 *   1. 拦截 window.fetch 与 XMLHttpRequest，命中白名单的转交沙箱；
 *   2. 隐藏 SSR 里内嵌的 __playinfo__，强制播放器走播放地址 API（否则会一直用 A 的数据）；
 *   3. 在进入视频页时把 bvid/cid 报给沙箱做预热。
 *
 * 关键设计：**它不做「是否启用」的判断**。
 * 旧版本用 postMessage 下发 enabled 开关，首屏那个 playurl 请求往往在消息到达前就发出，
 * 于是第一次永远走 A，之后切画质/换集（时间上晚了几秒）才成功 —— 这正是「要先切画质再反复选集」的成因。
 * 现在无论开关状态都转交沙箱，沙箱立刻回一个 passthrough，开/关都不再有竞态。
 */
(function () {
  'use strict';

  var CFG = __BILI_VIP_CFG__;

  if (window.__BILI_VIP_HOOKED__) return;
  window.__BILI_VIP_HOOKED__ = true;

  var NS = CFG.ns;
  var HOSTS = CFG.hosts;
  var SANDBOX_ENTRIES = CFG.sandboxEntries; // [{host, path, method}]
  var LOCAL_ENTRIES = CFG.localEntries; // [{host, path}]
  var TIMEOUT = CFG.timeoutMs || 15000;

  var token = CFG.token || '';
  var hidePlayinfo = !!CFG.hidePlayinfo;
  var patchUi = !!CFG.patchUi;
  var doPrefetch = !!CFG.prefetch;
  var softLogout = CFG.softLogout !== false;
  var region = CFG.region || 'off';

  // 钩子是由沙箱注入的，沙箱必然存在，因此初始就认为通道可用。
  // 早期版本等握手回包才置 true，导致「注入后、回包前」的那一拍请求被丢掉 —— 正是首次加载失效的成因。
  var sandboxAlive = true;
  var pending = Object.create(null);
  var seq = 1;

  /* ---------------- 自检状态 ----------------
   * 「脚本跑起来了」和「拦截真的接管了请求」是两件事，必须分开报。
   * 最难查的故障是「首次不生效、切画质后才行」——它静默，而面板当时没有任何
   * 信号能证明钩子到底有没有接管。这里把两件事都做成可观测的：
   *   intercepted      —— 已经转交沙箱的请求数（>0 才说明拦截链路是通的）
   *   playinfoHooked   —— __playinfo__ 的访问器有没有装上
   *   playinfoHidden   —— 装上之后，当前是否真的在返回 undefined
   */
  var intercepted = 0;
  var playinfoHooked = false;

  /* ---------------- URL 工具 ---------------- */

  function toAbsolute(u) {
    if (!u) return '';
    try {
      return new URL(String(u), location.href).href;
    } catch (e) {
      return '';
    }
  }

  function hit(u, entries, method) {
    var parsed;
    try {
      parsed = new URL(u);
    } catch (e) {
      return false;
    }
    if (parsed.protocol !== 'https:') return false;
    if (HOSTS.indexOf(parsed.hostname) === -1) return false;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
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
    var parsed;
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
    return new Promise(function (resolve) {
      if (!sandboxAlive) {
        resolve({ passthrough: true, error: 'sandbox-dead' });
        return;
      }
      var id = seq++;
      var timer = setTimeout(function () {
        if (pending[id]) {
          delete pending[id];
          // 沙箱没在时限内回应：这一次回退给页面自己处理。
          // 不把 sandboxAlive 永久置否 —— 单次超时（网络抖动）不应让后续请求全部失效。
          resolve({ passthrough: true, error: 'timeout' });
        }
      }, timeoutMs || TIMEOUT);
      pending[id] = function (res) {
        clearTimeout(timer);
        resolve(res);
      };
      payload.type = payload.type || 'req';
      payload.id = id;
      payload.token = token;
      // 转交成功即计数。自检要看的是「拦截链路通不通」，不是沙箱答得快不快。
      intercepted++;
      post(payload);
    });
  }

  window.addEventListener('message', function (ev) {
    if (ev.origin && ev.origin !== location.origin) return;
    var d = ev.data;
    if (!d || d.__ns !== NS) return;
    sandboxAlive = true;
    if (d.token !== token) return;
    if (d.type === 'resp' && d.id !== undefined) {
      var fn = pending[d.id];
      if (fn) {
        delete pending[d.id];
        fn(d);
      }
    } else if (d.type === 'welcome' || d.type === 'cfg') {
      applyCfg(d.cfg);
    } else if (d.type === 'ping') {
      // 面板主动问一次当前状态。只在沙箱问的时候才回，不主动刷消息。
      post({ type: 'pong', token: token, state: selfState() });
    }
  });

  /** 供沙箱自检使用。字段含义见上方注释，别改名字（沙箱按名字读）。 */
  function selfState() {
    // 必须区分「装了访问器」和「真的在返回 undefined」。
    // 曾经的写法只看 typeof window.__playinfo__ === 'undefined'，
    // 而 document-start 那一刻 SSR 还没跑、playinfoValue 本来就是 undefined，
    // 于是借用功能**没开**时也报「已隐藏」——诊断给出的是假信号。
    // hidePlayinfo 是本地读的钩子开关，才是这里的判据。
    var hidden = false;
    try {
      hidden = hidePlayinfo && typeof window.__playinfo__ === 'undefined';
    } catch (e) {}
    return {
      intercepted: intercepted,
      playinfoHooked: playinfoHooked,
      playinfoHidden: playinfoHooked && hidden,
      // 借用总开关是否要求隐藏 playinfo。false 时「未隐藏」是正常状态，不是故障。
      hidePlayinfo: hidePlayinfo,
      softLogout: softLogout,
      sandboxAlive: sandboxAlive
    };
  }

  function applyCfg(cfg) {
    if (!cfg) return;
    if (typeof cfg.hidePlayinfo === 'boolean') hidePlayinfo = cfg.hidePlayinfo;
    if (typeof cfg.patchUi === 'boolean') patchUi = cfg.patchUi;
    if (typeof cfg.prefetch === 'boolean') doPrefetch = cfg.prefetch;
    if (typeof cfg.softLogout === 'boolean') softLogout = cfg.softLogout;
    if (typeof cfg.region === 'string') region = cfg.region;
    updateSsHooks();
  }

  /* ---------------- 响应模拟 ---------------- */

  function parseHeaders(raw) {
    var out = {};
    String(raw || '').split(/\r?\n/).forEach(function (line) {
      var i = line.indexOf(':');
      if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    });
    return out;
  }

  function makeResponse(res, url) {
    var body = res.body || '';
    var headers = parseHeaders(res.headersRaw);
    if (!headers['content-type']) headers['content-type'] = 'application/json; charset=utf-8';
    if (!headers['content-length']) headers['content-length'] = String(body.length);
    var r = new Response(body, {
      status: res.status || 200,
      statusText: res.statusText || 'OK',
      headers: headers
    });
    try {
      Object.defineProperty(r, 'url', { configurable: true, value: url || '' });
    } catch (e) {}
    return r;
  }

  /**
   * 用实例自有属性遮蔽原型访问器，模拟一次完成的 XHR。
   * 按真实 XHR 的顺序依次抛出 readystatechange(2/3/4) + load + loadend，
   * 播放器里那些检查 readyState / onprogress 的封装才能正常走完。
   */
  function emulateXhr(xhr, res, url) {
    var body = res.body || '';
    var status = res.status || 200;
    var headers = parseHeaders(res.headersRaw);
    if (!headers['content-type']) headers['content-type'] = 'application/json; charset=utf-8';

    function setProp(name, value) {
      try {
        Object.defineProperty(xhr, name, { configurable: true, writable: true, value: value });
      } catch (e) {}
    }

    setProp('readyState', 0);
    setProp('status', status);
    setProp('statusText', res.statusText || 'OK');
    setProp('responseURL', url);

    var decoded = body;
    if (xhr.responseType === 'json') {
      try {
        decoded = JSON.parse(body);
      } catch (e) {
        decoded = null;
      }
    } else if (xhr.responseType === 'blob') {
      try {
        decoded = new Blob([body], { type: headers['content-type'] });
      } catch (e) {
        decoded = body;
      }
    } else if (xhr.responseType === 'arraybuffer') {
      try {
        var buf = new ArrayBuffer(body.length);
        var view = new Uint8Array(buf);
        for (var i = 0; i < body.length; i++) view[i] = body.charCodeAt(i) & 0xff;
        decoded = buf;
      } catch (e) {
        decoded = body;
      }
    }

    setProp('response', decoded);
    setProp('responseText', xhr.responseType === '' || xhr.responseType === 'text' ? body : '');
    setProp('responseXML', null);

    try {
      xhr.getResponseHeader = function (name) {
        var v = headers[String(name).toLowerCase()];
        return v === undefined ? null : v;
      };
      xhr.getAllResponseHeaders = function () {
        var s = '';
        for (var k in headers) {
          if (Object.prototype.hasOwnProperty.call(headers, k)) s += k + ': ' + headers[k] + '\r\n';
        }
        return s;
      };
    } catch (e) {}

    function fire(type, extra) {
      try {
        var ev = new Event(type);
        if (extra) {
          for (var k in extra) ev[k] = extra[k];
        }
        xhr.dispatchEvent(ev);
      } catch (e) {}
    }

    function step(state) {
      setProp('readyState', state);
      fire('readystatechange');
    }

    // 异步推进，模拟真实 XHR 的事件时序
    setTimeout(function () {
      fire('loadstart');
      step(2); // HEADERS_RECEIVED
      step(3); // LOADING
            // 只派发事件，不再直接调 xhr.onXxx。
      // 曾经的写法是两者都做，结果 onprogress / onload / onloadend 各触发两遍：
      // onXxx 是 XMLHttpRequestEventTarget 上的 IDL 事件处理器属性，
      // 给 xhr.onload 赋值就等同于注册了 load 监听器，dispatchEvent 会再调它一次。
      // 用 addEventListener 注册的只受派发影响，直接调用对它无效 ——
      // 所以单靠派发就能同时覆盖两种注册方式，直接调用纯属重复。
      fire('progress', { lengthComputable: true, loaded: body.length, total: body.length });
      setProp('readyState', 4); // DONE
      fire('readystatechange');
      fire('load');
      fire('loadend');
    }, 0);
  }

  /* ---------------- 请求体序列化 ---------------- */

  function serializeHeaders(h) {
    if (!h) return {};
    try {
      if (typeof Headers !== 'undefined' && h instanceof Headers) {
        var o = {};
        h.forEach(function (v, k) {
          o[k] = v;
        });
        return o;
      }
    } catch (e) {}
    if (Object.prototype.toString.call(h) === '[object Array]') {
      var o2 = {};
      for (var i = 0; i < h.length; i++) o2[h[i][0]] = h[i][1];
      return o2;
    }
    return h;
  }

  function serializeBody(init, input) {
    var b = (init && init.body) || (input && input.body);
    if (!b) return '';
    if (typeof b === 'string') return b;
    try {
      if (typeof URLSearchParams !== 'undefined' && b instanceof URLSearchParams) return b.toString();
      if (typeof FormData !== 'undefined' && b instanceof FormData) return new URLSearchParams(b).toString();
    } catch (e) {}
    try {
      return JSON.stringify(b);
    } catch (e) {
      return '';
    }
  }

  /* ---------------- SSR 处理 ---------------- */

  // 用访问器属性确定性地屏蔽 __playinfo__：
  // SSR 内联脚本写入时先存进闭包，启用借用时读出 undefined，
  // 播放器就只能去请求播放地址 API —— 而那个请求会被上面的钩子转交沙箱。
  var playinfoValue;
  try {
    // 先接住可能已经存在的值：defineProperty 会把原来的数据属性覆盖掉，
    // 直接丢弃会让「脚本晚于 SSR 执行」的场景永远拿不到播放信息。
    playinfoValue = window.__playinfo__;
  } catch (e) {}
  try {
    Object.defineProperty(window, '__playinfo__', {
      configurable: true,
      enumerable: true,
      get: function () {
        return hidePlayinfo ? undefined : playinfoValue;
      },
      set: function (v) {
        playinfoValue = v;
      }
    });
    playinfoHooked = true;
  } catch (e) {}

  var hydrateValue;
  try {
    hydrateValue = window.__PLAYURL_HYDRATE_DATA__;
  } catch (e) {}
  try {
    Object.defineProperty(window, '__PLAYURL_HYDRATE_DATA__', {
      configurable: true,
      enumerable: true,
      get: function () {
        return hidePlayinfo && hydrateValue ? patchVipFlags(hydrateValue, 0) : hydrateValue;
      },
      set: function (v) {
        hydrateValue = hidePlayinfo && v ? patchVipFlags(v, 0) : v;
      }
    });
  } catch (e) {}


  /* ---------------- nanoPlayer (番剧/OGV现代播放器) 劫持 ---------------- */
  function hookNano(nano) {
    if (!nano || nano.__biliVipHooked) return nano;
    nano.__biliVipHooked = true;
    var origCreate = nano.createPlayer;
    if (typeof origCreate !== 'function') return nano;

    nano.createPlayer = function (config) {
      if (config && hidePlayinfo) {
        if (config.prefetch) {
          delete config.prefetch.playUrl;
        }
        if (config.requestConfig) {
          delete config.requestConfig.reqHttpPlayUrlInfo;
          delete config.requestConfig.reqHttpPlayUrlInfoScope;
        }
      }
      var player = origCreate.apply(this, arguments);
      if (player && hidePlayinfo) {
        var origOn = player.on;
        if (typeof origOn === 'function') {
          player.on = function (event, handler) {
            if (
              event === 'Player_Access_Changed' ||
              event === 'player_access_changed' ||
              (window.nano && window.nano.EventType && event === window.nano.EventType.Player_Access_Changed)
            ) {
              return this;
            }
            return origOn.apply(this, arguments);
          };
        }

        if (typeof origOn === 'function') {
          try {
            origOn.call(player, 'player_block', function () {
              try {
                if (typeof player.toggleFeature === 'function') {
                  player.toggleFeature({ play: false, pause: false, seek: false, shortcut: false });
                }
                var bp = typeof document !== 'undefined' ? document.getElementById('big-block-panel') : null;
                if (bp) bp.remove();
                if (typeof player.play === 'function') {
                  player.play().catch(function () {});
                }
              } catch (e) {}
            });
          } catch (e) {}
        }

        if (!player.__biliReloaded) {
          player.__biliReloaded = true;
          setTimeout(function () {
            try {
              if (typeof player.toggleFeature === 'function') {
                player.toggleFeature({ play: false, pause: false, seek: false, shortcut: false });
              }
              if (typeof player.reload === 'function') {
                player.reload();
              }
            } catch (e) {}

            var attempts = 0;
            var unlockTimer = setInterval(function () {
              attempts++;
              var bp = typeof document !== 'undefined' ? document.getElementById('big-block-panel') : null;
              if (bp) bp.remove();

              try {
                if (typeof player.toggleFeature === 'function') {
                  player.toggleFeature({ play: false, pause: false, seek: false, shortcut: false });
                }
              } catch (e) {}

              var v = player.mediaElement || (typeof document !== 'undefined' ? document.querySelector('video') : null);
              var isBlob = v && v.currentSrc && v.currentSrc.indexOf('blob:') === 0;

              if (v && v.paused) {
                try {
                  if (typeof player.play === 'function') {
                    player.play().catch(function () {});
                  }
                } catch (e) {}
              }

              if ((v && !v.paused && isBlob) || attempts >= 15) {
                clearInterval(unlockTimer);
              }
            }, 300);
          }, 50);
        }
      }
      return player;
    };
    return nano;
  }

  var nanoVal = window.nano;
  if (nanoVal) hookNano(nanoVal);
  try {
    Object.defineProperty(window, 'nano', {
      configurable: true,
      enumerable: true,
      get: function () {
        return nanoVal;
      },
      set: function (v) {
        nanoVal = hookNano(v);
      }
    });
  } catch (e) {}
  /**
   * 只改首屏 SSR 状态里的区域字段。
   *
   * ⚠ 这里是 `src/core/region.js` 的**独立副本**，不是引用 —— 钩子被字符串化注入，
   *   作用域完全独立，import 不进来。region.js:patchRegion 有同样的警告。
   *   改字段清单时两边都要改；只改一边不会报错，只会静默不生效。
   */
  function patchSsRegion(s) {
    var cfg = REGION_CFG[region];
    if (!cfg || region === 'off' || !s || typeof s !== 'object') return;
    var holders = [s, s.user, s.videoData, s.epInfo, s.videoInfo, s.mediaInfo];
    for (var i = 0; i < holders.length; i++) {
      var h = holders[i];
      if (!h || typeof h !== 'object') continue;
      if (typeof h.ip_region === 'string' && h.ip_region !== cfg.ipRegion) h.ip_region = cfg.ipRegion;
      if (h.rights && typeof h.rights === 'object') {
        if (typeof h.rights.area_limit === 'number' && h.rights.area_limit !== cfg.areaLimit) {
          h.rights.area_limit = cfg.areaLimit;
        }
        if (h.rights.ban_area_show) h.rights.ban_area_show = 0;
      }
    }
  }

  // 同步修正 SSR 里的会员状态，避免播放器仅凭本地字段就弹「开通大会员」
  function patchSsUser() {
    try {
      var s = window.__INITIAL_STATE__;
      if (!s) return;
      if (s.user && typeof s.user === 'object') {
        if (typeof s.user.vipStatus === 'number' && s.user.vipStatus !== 1) s.user.vipStatus = 1;
        if (typeof s.user.vipType === 'number' && s.user.vipType !== 2) s.user.vipType = 2;
        var v = s.user.vip;
        if (v && typeof v === 'object') {
          if (typeof v.status === 'number' && v.status !== 1) v.status = 1;
          if (typeof v.type === 'number' && v.type !== 2) v.type = 2;
        }
      }
      // 区域形态（详见 core/region.js 的诚实边界：这里只改首屏渲染形态）
      if (region !== 'off') patchSsRegion(s);
    } catch (e) {}
  }

  var ssTimer = null;
  function updateSsHooks() {
    if (patchUi || hidePlayinfo || region !== 'off') {
      if (!ssTimer) {
        ssTimer = setInterval(patchSsUser, 200);
        setTimeout(function () {
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

  /* ---------------- 网络拦截（XHR 与 fetch） ---------------- */

  var origFetch = window.fetch;
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  var origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

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
    var st = this.__biliVip;
    if (!st || st.handled) return origSend.apply(this, arguments);

    if (softLogout && isLogoutTarget(st.url, st.method)) {
      st.handled = true;
      var self0 = this;
      callSandbox({
        type: 'logout',
        method: st.method,
        url: st.url
      }).then(function (res) {
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
      var self = this;
      callSandbox({
        method: st.method,
        url: st.url,
        headers: st.headers,
        body: typeof body === 'string' ? body : ''
      }).then(function (res) {
        if (res && !res.passthrough && res.body !== undefined) {
          emulateXhr(self, res, st.url);
          return;
        }
        // 沙箱没给出替代结果（未启用/失败/超时）：原样回放页面自己的请求
        origSend.call(self, body);
      });
      return;
    }

    if (isLocalTarget(st.url)) {
      st.handled = true;
      var self2 = this;
      origFetch(st.url, {
        method: st.method,
        headers: st.headers,
        credentials: 'include'
      })
        .then(function (resp) {
          if (!resp || !resp.ok) throw new Error('bad response');
          return resp.clone().text();
        })
        .then(function (text) {
          emulateXhr(self2, { status: 200, statusText: 'OK', body: patchLocal(text), headersRaw: '' }, st.url);
        })
        .catch(function () {
          origSend.call(self2, body);
        });
      return;
    }

    return origSend.apply(this, arguments);
  };

  /* ---------------- 本地伪装（不离开页面） ---------------- */

  var REGION_CFG = {
    off: { ipRegion: null, areaLimit: null, label: null },
    hkmo: { ipRegion: 'HK', areaLimit: 0, label: '港澳台' },
    tw: { ipRegion: 'TW', areaLimit: 0, label: '台湾' },
    cn: { ipRegion: 'CN', areaLimit: 0, label: '中国大陆' }
  };

  function looksLikeVipObject(o) {
    return (
      o &&
      typeof o === 'object' &&
      (typeof o.status === 'number' || typeof o.type === 'number' || typeof o.due_date === 'number')
    );
  }

  function patchVipObject(v) {
    if (typeof v.status === 'number' && v.status !== 1) v.status = 1;
    if (typeof v.type === 'number' && v.type !== 2) v.type = 2;
    if (typeof v.due_date === 'number') v.due_date = 4102444800000;
  }

  function patchVipFlags(root, depth) {
    if (!root || typeof root !== 'object' || depth > 12) return root;
    if (Array.isArray(root)) {
      for (var i = 0; i < root.length; i++) patchVipFlags(root[i], depth + 1);
      return root;
    }
    if (typeof root.vipStatus === 'number' && root.vipStatus !== 1) root.vipStatus = 1;
    if (typeof root.vip_status === 'number' && root.vip_status !== 1) root.vip_status = 1;
    if (typeof root.vip_status === 'string' && root.vip_status !== '1') root.vip_status = '1';
    if (typeof root.vipType === 'number' && root.vipType !== 2) root.vipType = 2;
    if (typeof root.vip_type === 'number' && root.vip_type !== 2) root.vip_type = 2;
    if (typeof root.vip_type === 'string' && root.vip_type !== '2') root.vip_type = '2';
    if (typeof root.is_preview === 'number' && root.is_preview !== 0) root.is_preview = 0;
    if (root.has_paid === false) root.has_paid = true;
    if (root.real_vip === false) root.real_vip = true;
    if (root.play_detail === 'PLAY_PREVIEW' || root.play_detail === 'PLAY_NONE') root.play_detail = 'PLAY_WHOLE';
    if (typeof root.pay_check === 'number' && root.pay_check !== 1) root.pay_check = 1;
    if (root.play_video_type !== undefined || root.video_info || root.view_info) {
      root.play_video_type = 'whole';
    }
    if (looksLikeVipObject(root.vip)) patchVipObject(root.vip);
    if (looksLikeVipObject(root.vip_info)) patchVipObject(root.vip_info);
    for (var k in root) {
      if (Object.prototype.hasOwnProperty.call(root, k) && k !== 'vip' && k !== 'vip_info') {
        if (root[k] && typeof root[k] === 'object') patchVipFlags(root[k], depth + 1);
      }
    }
    return root;
  }

  function patchRegionFlags(root, depth) {
    var cfg = REGION_CFG[region];
    if (!cfg || region === 'off') return root;
    if (!root || typeof root !== 'object' || depth > 10) return root;
    if (Array.isArray(root)) {
      for (var i = 0; i < root.length; i++) patchRegionFlags(root[i], depth + 1);
      return root;
    }
    if (typeof root.ip_region === 'string' && root.ip_region !== cfg.ipRegion) root.ip_region = cfg.ipRegion;
    var r = root.rights;
    if (r && typeof r === 'object' && !Array.isArray(r)) {
      if (typeof r.area_limit === 'number' && r.area_limit !== cfg.areaLimit) r.area_limit = cfg.areaLimit;
      if (r.ban_area_show) r.ban_area_show = 0;
      if (typeof r.can_watch === 'number' && r.can_watch !== 1) r.can_watch = 1;
    }
    if (Array.isArray(root.areas) && root.areas.length && cfg.label) {
      var has = false;
      for (var j = 0; j < root.areas.length; j++) {
        if (root.areas[j] && root.areas[j].name === cfg.label) { has = true; break; }
      }
      if (!has) root.areas.unshift({ id: -1, name: cfg.label });
    }
    for (var k in root) {
      if (Object.prototype.hasOwnProperty.call(root, k) && root[k] && typeof root[k] === 'object') {
        patchRegionFlags(root[k], depth + 1);
      }
    }
    return root;
  }

  function patchLocal(text) {
    try {
      var o = JSON.parse(text);
      if (o && typeof o === 'object') {
        patchVipFlags(o, 0);
        patchRegionFlags(o, 0);
        return JSON.stringify(o);
      }
    } catch (e) {}
    return text;
  }

  /* ---------------- fetch 钩子 ---------------- */
  window.fetch = function (input, init) {
    var self = this;
    var args = arguments;
    var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    var url = toAbsolute(typeof input === 'string' ? input : (input && (input.url || input.href)) || '');

    if (softLogout && isLogoutTarget(url, method)) {
      return callSandbox({
        type: 'logout',
        method: method,
        url: url
      }).then(function (res) {
        if (res && !res.passthrough && res.body !== undefined) return makeResponse(res, url);
        return origFetch.apply(self, args);
      });
    }

    if (isSandboxTarget(url, method)) {
      return callSandbox({
        method: method,
        url: url,
        headers: serializeHeaders((init && init.headers) || (input && input.headers)),
        body: serializeBody(init, input)
      }).then(function (res) {
        if (res && !res.passthrough && res.body !== undefined) return makeResponse(res, url);
        return origFetch.apply(self, args);
      });
    }

    if (isLocalTarget(url)) {
      return origFetch.apply(self, args).then(function (resp) {
        if (!resp || !resp.ok) return resp;
        return resp.clone().text().then(function (t) {
          return makeResponse({ body: patchLocal(t), status: resp.status, statusText: resp.statusText, headersRaw: '' }, url);
        });
      });
    }

    return origFetch.apply(self, args);
  };

  /* ---------------- 预热 ---------------- */

  var lastPrefetchKey = '';

  function tryPrefetch() {
    if (!doPrefetch) return;
    var path = location.pathname;
    var qs = {};

    if (path.indexOf('/video/') === 0) {
      var s = window.__INITIAL_STATE__;
      var vd = s && s.videoData;
      if (!vd || !vd.bvid || !vd.cid) return;
      qs.bvid = vd.bvid;
      qs.cid = vd.cid;
    } else if (path.indexOf('/bangumi/play/') === 0) {
      var s2 = window.__INITIAL_STATE__;
      var vi = s2 && (s2.videoInfo || (s2.epInfo || null));
      if (!vi || !vi.ep_id || !vi.cid) return;
      var url = 'https://api.bilibili.com/ogv/player/playview?ep_id=' + encodeURIComponent(vi.ep_id) + '&cid=' + encodeURIComponent(vi.cid);
      var key = url;
      if (key === lastPrefetchKey) return;
      lastPrefetchKey = key;
      post({ type: 'prefetch', token: token, url: url, method: 'POST', body: '', headers: {} });
      return;
    } else {
      return;
    }

    var prefetchUrl =
      'https://api.bilibili.com/x/player/wbi/playurl?bvid=' +
      encodeURIComponent(qs.bvid || '') +
      '&cid=' +
      encodeURIComponent(qs.cid || '') +
      '&fnver=0&fnval=4048&fourk=1';
    var k = prefetchUrl;
    if (k === lastPrefetchKey) return;
    lastPrefetchKey = k;
    post({ type: 'prefetch', token: token, url: prefetchUrl, method: 'GET', headers: {} });
  }

  // __INITIAL_STATE__ 可能比钩子安装晚到，短时间内轮询几次即可
  var prefetchTimer = setInterval(function () {
    tryPrefetch();
  }, 1200);
  setTimeout(function () {
    clearInterval(prefetchTimer);
  }, 30000);

  // SPA 路由变化时重新预热
  ['pushState', 'replaceState'].forEach(function (name) {
    var orig = history[name];
    if (typeof orig !== 'function') return;
    history[name] = function () {
      lastPrefetchKey = '';
      var r = orig.apply(this, arguments);
      tryPrefetch();
      return r;
    };
  });
  window.addEventListener('popstate', function () {
    lastPrefetchKey = '';
    tryPrefetch();
  });

  /* ---------------- 握手 ---------------- */

  post({ type: 'hello', token: token, state: selfState() });
  tryPrefetch();
})();