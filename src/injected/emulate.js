/**
 * 主世界钩子的响应模拟与请求体序列化工具（供 XHR / fetch 拦截复用）。
 */

export function parseHeaders(raw) {
  const out = {};
  String(raw || '')
    .split(/\r?\n/)
    .forEach((line) => {
      const i = line.indexOf(':');
      if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    });
  return out;
}

export function makeResponse(res, url) {
  const body = res.body || '';
  const headers = parseHeaders(res.headersRaw);
  if (!headers['content-type']) headers['content-type'] = 'application/json; charset=utf-8';
  if (!headers['content-length']) headers['content-length'] = String(body.length);
  const r = new Response(body, {
    status: res.status || 200,
    statusText: res.statusText || 'OK',
    headers
  });
  try {
    Object.defineProperty(r, 'url', { configurable: true, value: url || '' });
  } catch (e) {}
  return r;
}

/**
 * 用实例自有属性遮蔽原型访问器，模拟一次完成的 XHR。
 * 按真实 XHR 的顺序依次抛出 readystatechange(2/3/4) + load + loadend。
 */
export function emulateXhr(xhr, res, url) {
  const body = res.body || '';
  const status = res.status || 200;
  const headers = parseHeaders(res.headersRaw);
  if (!headers['content-type']) headers['content-type'] = 'application/json; charset=utf-8';

  function setProp(name, value) {
    try {
      Object.defineProperty(xhr, name, { configurable: true, writable: true, value });
    } catch (e) {}
  }

  setProp('readyState', 0);
  setProp('status', status);
  setProp('statusText', res.statusText || 'OK');
  setProp('responseURL', url);

  let decoded = body;
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
      const buf = new ArrayBuffer(body.length);
      const view = new Uint8Array(buf);
      for (let i = 0; i < body.length; i++) view[i] = body.charCodeAt(i) & 0xff;
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
      const v = headers[String(name).toLowerCase()];
      return v === undefined ? null : v;
    };
    xhr.getAllResponseHeaders = function () {
      let s = '';
      for (const k in headers) {
        if (Object.prototype.hasOwnProperty.call(headers, k)) s += k + ': ' + headers[k] + '\r\n';
      }
      return s;
    };
  } catch (e) {}

  function fire(type, extra) {
    try {
      const ev = new Event(type);
      if (extra) {
        for (const k in extra) ev[k] = extra[k];
      }
      xhr.dispatchEvent(ev);
    } catch (e) {}
  }

  function step(state) {
    setProp('readyState', state);
    fire('readystatechange');
  }

  // 异步推进，模拟真实 XHR 的事件时序；只派发事件不直接调 onXxx（dispatchEvent 会触发 IDL handler）
  setTimeout(() => {
    fire('loadstart');
    step(2); // HEADERS_RECEIVED
    step(3); // LOADING
    fire('progress', { lengthComputable: true, loaded: body.length, total: body.length });
    setProp('readyState', 4); // DONE
    fire('readystatechange');
    fire('load');
    fire('loadend');
  }, 0);
}

export function serializeHeaders(h) {
  if (!h) return {};
  try {
    if (typeof Headers !== 'undefined' && h instanceof Headers) {
      const o = {};
      h.forEach((v, k) => {
        o[k] = v;
      });
      return o;
    }
  } catch (e) {}
  if (Object.prototype.toString.call(h) === '[object Array]') {
    const o2 = {};
    for (let i = 0; i < h.length; i++) o2[h[i][0]] = h[i][1];
    return o2;
  }
  return h;
}

export function serializeBody(init, input) {
  const b = (init && init.body) || (input && input.body);
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
