/**
 * 主世界钩子集成测试：在 vm 里跑真实的 src/injected/hook.js。
 *   node test/hook.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = fs.readFileSync(path.join(ROOT, 'src/injected/hook.js'), 'utf8');

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  \x1b[32m✔\x1b[0m ${name}`);
  else {
    failed++;
    console.error(`  \x1b[31m✖\x1b[0m ${name}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`);
  }
}

const TOKEN = 'test-token-1234';

function makeEnv(cfgOverrides = {}, responder) {
  const listeners = { message: [], popstate: [] };
  const state = { sent: [], fetched: [] };

  const win = {};
  win.window = win;
  win.globalThis = win;
  win.location = { href: 'https://www.bilibili.com/video/BV1xx', pathname: '/video/BV1xx', search: '' };
  win.history = { pushState: () => {}, replaceState: () => {} };
  win.console = { info() {}, warn() {}, error() {}, debug() {} };
  win.setTimeout = setTimeout;
  win.clearTimeout = clearTimeout;
  const intervals = new Set();
  win.setInterval = (fn, ms) => {
    const h = setInterval(fn, ms);
    intervals.add(h);
    return h;
  };
  win.clearInterval = (h) => {
    intervals.delete(h);
    clearInterval(h);
  };
  win.__teardown = () => intervals.forEach(clearInterval);
  win.URL = URL;
  win.URLSearchParams = URLSearchParams;
  win.Headers = Headers;
  win.FormData = FormData;
  win.Blob = Blob;
  win.ArrayBuffer = ArrayBuffer;
  win.Uint8Array = Uint8Array;
  win.Promise = Promise;
  win.JSON = JSON;
  win.Math = Math;
  win.Date = Date;
  win.Error = Error;
  win.Event = Event;
  win.Response = Response;
  win.Response.prototype.clone = Response.prototype.clone;

  win.addEventListener = (type, fn) => {
    (listeners[type] || (listeners[type] = [])).push(fn);
  };
  win.postMessage = (msg) => {
    if (!msg || msg.__ns !== '__BILI_VIP__') return;
    if (msg.type === 'hello') {
      setTimeout(() => dispatch({ type: 'welcome', token: TOKEN, cfg: CFG }), 0);
      return;
    }
    if (msg.type === 'req') {
      state.sent.push(msg);
      const res = responder ? responder(msg) : { passthrough: true };
      if (!res) return; // 模拟沙箱完全没有回应
      setTimeout(() => dispatch({ type: 'resp', id: msg.id, token: TOKEN, ...res }), 0);
    }
  };
  function dispatch(data) {
    for (const fn of listeners.message || []) fn({ data: { __ns: '__BILI_VIP__', ...data }, source: vmGlobalRef });
  }
  let vmGlobalRef = null;
  win.__dispatch = dispatch;

  // 假的原生 XHR：只关心「有没有真的发出去」，并忠实转发事件
  class FakeXHR {
    constructor() {
      this.readyState = 0;
      this.status = 0;
      this.responseType = '';
      this._headers = {};
      this._listeners = Object.create(null);
      /** 事件到达顺序与次数，供断言「每个事件只触发一次」 */
      this.events = [];
    }
    open(method, url) {
      this._method = method;
      this._url = url;
    }
    setRequestHeader(k, v) {
      this._headers[k] = v;
    }
    send() {
      state.fetched.push({ kind: 'xhr', url: this._url });
    }
    addEventListener(type, fn) {
      (this._listeners[type] || (this._listeners[type] = [])).push(fn);
    }
    removeEventListener(type, fn) {
      const a = this._listeners[type] || [];
      const i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    }
    /**
     * 忠实模拟：真实的 dispatchEvent 会自动调用 onXxx 这个 IDL 事件处理器属性。
     * 这里曾写成 return true 的空实现，于是「onload 被触发两次」这类缺陷
     * 在整个测试里都看不见（钩子当时既直接调 onXxx 又派发事件）。
     */
    dispatchEvent(ev) {
      this.events.push(ev.type);
      const handler = this['on' + ev.type];
      if (typeof handler === 'function') handler.call(this, ev);
      for (const fn of this._listeners[ev.type] || []) fn.call(this, ev);
      return true;
    }
  }
  win.XMLHttpRequest = FakeXHR;

  const realFetch = (url) =>
    Promise.resolve(
      new Response(JSON.stringify({ code: 0, data: { vipStatus: 0, vipType: 0, vip: { status: 0, type: 0 }, from: 'A-account' } }), {
        headers: { 'content-type': 'application/json' }
      })
    );
  win.fetch = (input) => {
    const url = typeof input === 'string' ? input : input.url;
    state.fetched.push({ kind: 'fetch', url });
    return realFetch(url);
  };

  const CFG = {
    ns: '__BILI_VIP__',
    token: TOKEN,
    hosts: ['api.bilibili.com', 'api.live.bilibili.com'],
    sandboxEntries: [
      { host: 'api.bilibili.com', path: '/x/player/wbi/playurl', method: 'GET' },
      { host: 'api.bilibili.com', path: '/pgc/player/web/v2/playurl', method: 'GET' },
      { host: 'api.bilibili.com', path: '/ogv/player/playview', method: 'POST' }
    ],
    localEntries: [{ host: 'api.bilibili.com', path: '/x/web-interface/nav' }],
    timeoutMs: 2000,
    hidePlayinfo: true,
    patchUi: true,
    prefetch: false,
    ...cfgOverrides
  };

  win.__INITIAL_STATE__ = { videoData: { bvid: 'BV1xx', cid: 123 }, user: { vipStatus: 0, vipType: 0 } };
  win.__playinfo__ = { data: { quality: 32 } }; // 模拟 SSR 内嵌的播放信息

  vm.createContext(win);
  vm.runInContext(HOOK.replace('__BILI_VIP_CFG__', JSON.stringify(CFG)), win, { filename: 'hook.js' });
  // vm 的 context 会给出一层代理，VM 内的 window !== 宿主的 win。
  // 真实浏览器里 ev.source 就是同一个 window，这里必须取 VM 自己的 globalThis 才等价。
  const vmGlobal = vm.runInContext('globalThis', win);
  vmGlobalRef = vmGlobal;

  return { win, state, FakeXHR, vmGlobal };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 用例 ---------------- */

console.log('\n[1] SSR 的 __playinfo__ 按配置屏蔽');
{
  const on = makeEnv({ hidePlayinfo: true });
  await sleep(260); // 等 SSR 会员字段轮询跑一次
  check('启用借用时读不到 __playinfo__', on.win.__playinfo__ === undefined, on.win.__playinfo__);
  check('vipStatus 被改成 1', on.win.__INITIAL_STATE__.user.vipStatus === 1);
  on.win.__teardown();

  const off = makeEnv({ hidePlayinfo: false });
  check('未启用时 __playinfo__ 原样可读', off.win.__playinfo__ && off.win.__playinfo__.data.quality === 32);
  off.win.__teardown();
}

console.log('\n[2] 白名单内的 XHR 转交沙箱并模拟响应');
{
  const { win, state, FakeXHR } = makeEnv({}, () => ({
    passthrough: false,
    status: 200,
    statusText: 'OK',
    body: JSON.stringify({ code: 0, data: { quality: 120, from: 'B-account' } }),
    headersRaw: 'content-type: application/json'
  }));

  const xhr = new FakeXHR();
  xhr.open('GET', '//api.bilibili.com/x/player/wbi/playurl?bvid=BV1xx&cid=1');
  xhr.onload = function () { xhr.onloadCalls = (xhr.onloadCalls || 0) + 1; };
  xhr.send();
  await sleep(30);

  check('已向沙箱发出请求', state.sent.length === 1, state.sent.length);
  check('url 被补成绝对地址', state.sent[0].url.startsWith('https://api.bilibili.com/x/player/wbi/playurl'), state.sent[0].url);
  check('没有回落到原生 send', state.fetched.length === 0, state.fetched);
  check('readyState 推进到 4', xhr.readyState === 4, xhr.readyState);
  check('status 为 200', xhr.status === 200);
  check('responseText 是 B 的响应', JSON.parse(xhr.responseText).data.quality === 120);
  check('getResponseHeader 可用', xhr.getResponseHeader('content-type') === 'application/json');

  // 事件恰好各一次。曾经的 bug：onprogress / onload / onloadend 既被直接调用、
  // 又随 fire() 的 dispatchEvent 再触发一遍（onXxx 是 IDL 事件处理器属性，
  // dispatchEvent 会自动调它）。异常翻倍的 onloadend 会让包了一层
  // 「追加数据 / 收尾」的调用方把响应处理两遍。
  // readystatechange 按 readyState 2/3/4 触发三次是正常语义，这里不重复断言。
  check('onload 只被调一次', xhr.onloadCalls === 1, xhr.onloadCalls);
}

console.log('\n[2b] 伪造 XHR：responseType 与事件恰好一次');
{
  const { win, state, FakeXHR } = makeEnv({}, () => ({
    passthrough: false,
    status: 200,
    statusText: 'OK',
    body: JSON.stringify({ code: 0, data: { quality: 120, from: 'B-account' } }),
    headersRaw: 'content-type: application/json'
  }));

  // 播放器常先 send() 再改 responseType —— 钩子按 send 之后的当前值解码
  const xhr = new FakeXHR();
  xhr.open('GET', '//api.bilibili.com/x/player/wbi/playurl?bvid=BV1xx&cid=1');
  xhr.onload = function () { xhr.onloadCalls = (xhr.onloadCalls || 0) + 1; };
  xhr.send();
  xhr.responseType = 'json';
  await sleep(30);
  check('responseType 改在 send 之后也能解码', !!(xhr.response && xhr.response.data && xhr.response.data.quality === 120), xhr.response);
  check('onload 只触发一次', xhr.onloadCalls === 1, xhr.onloadCalls);
  // readystatechange 按 readyState 2/3/4 触发三次是正常语义，其余必须各一次
  const once = ['loadstart', 'progress', 'load', 'loadend'];
  for (const t of once) check(`${t} 恰好一次`, xhr.events.filter((x) => x === t).length === 1, xhr.events);
  check('事件顺序正确', xhr.events.join(',') === 'loadstart,readystatechange,readystatechange,progress,readystatechange,load,loadend', xhr.events);
}

console.log('\n[3] 非白名单请求原样放行');
{
  const { state, FakeXHR } = makeEnv();
  const xhr = new FakeXHR();
  xhr.open('GET', '//api.bilibili.com/x/web-interface/view/detail?bvid=BV1xx');
  xhr.send();
  await sleep(20);
  check('没有转交沙箱', state.sent.length === 0);
  check('走了原生 send', state.fetched.length === 1 && state.fetched[0].url.includes('/x/web-interface/view/detail'));

  const xhr2 = new FakeXHR();
  xhr2.open('GET', 'https://api.bilibili.com/x/player/wbi/playurlXX');
  xhr2.send();
  await sleep(10);
  check('相似路径不会误伤', state.fetched.length === 2);

  const xhr3 = new FakeXHR();
  xhr3.open('GET', 'https://evil.com/x/player/wbi/playurl');
  xhr3.send();
  await sleep(10);
  check('非白名单主机不会误伤', state.fetched.length === 3);
}

console.log('\n[4] 方法不匹配时不转交');
{
  const { state, FakeXHR } = makeEnv();
  const xhr = new FakeXHR();
  xhr.open('GET', '/ogv/player/playview?ep_id=1');
  xhr.send();
  await sleep(10);
  check('GET 不会打到只允许 POST 的端点', state.sent.length === 0 && state.fetched.length === 1);

  const xhr2 = new FakeXHR();
  xhr2.open('POST', '//api.bilibili.com/ogv/player/playview?ep_id=1');
  xhr2.send('{}');
  await sleep(10);
  check('POST 会转交', state.sent.length === 1, state.sent.length);
}

console.log('\n[5] fetch 路径');
{
  const { win, state } = makeEnv({}, () => ({
    passthrough: false,
    status: 200,
    statusText: 'OK',
    body: JSON.stringify({ code: 0, data: { quality: 127 } }),
    headersRaw: 'content-type: application/json'
  }));
  const resp = await win.fetch('//api.bilibili.com/x/player/wbi/playurl?bvid=BV1&cid=1');
  const j = await resp.json();
  check('fetch 返回 B 的数据', j.data.quality === 127, j);
  check('没有回落到原生 fetch', state.fetched.length === 0);

  const resp2 = await win.fetch('//api.bilibili.com/x/web-interface/view/detail');
  check('非白名单走原生 fetch', state.fetched.length === 1);
  check('原生响应可正常读取', (await resp2.json()).code === 0);
}

console.log('\n[6] 沙箱判定 passthrough 时回落到原生请求');
{
  const { win, state, FakeXHR } = makeEnv({}, () => ({ passthrough: true }));
  const xhr = new FakeXHR();
  xhr.open('GET', '//api.bilibili.com/x/player/wbi/playurl?bvid=BV1&cid=1');
  xhr.send();
  await sleep(20);
  check('回落到原生 send', state.fetched.length === 1, state.fetched);
  check('XHR 状态保持未完成', xhr.readyState !== 4);
}

console.log('\n[7] 沙箱不回应时靠超时兜底（不永久熔断）');
{
  const { state, FakeXHR } = makeEnv({}, () => null); // responder 返回 undefined → 永不回应
  const xhr = new FakeXHR();
  xhr.open('GET', '//api.bilibili.com/x/player/wbi/playurl?bvid=BV1&cid=1');
  xhr.send();
  await sleep(20);
  check('超时前不会重复发原生请求', state.fetched.length === 0);
}

console.log('\n[8] 本地伪装接口不打扰沙箱');
{
  const { win, state, FakeXHR } = makeEnv();
  const xhr = new FakeXHR();
  xhr.open('GET', '//api.bilibili.com/x/web-interface/nav');
  xhr.send();
  await sleep(40);
  check('nav 没有转交沙箱', state.sent.length === 0);
  check('用原生 fetch 取回并本地改写', state.fetched.some((f) => f.url.includes('/x/web-interface/nav')));
  check('vipStatus 被改成 1', JSON.parse(xhr.responseText).data.vipStatus === 1);
}

console.log('\n[9] 总开关关闭（沙箱回放行）时对页面完全无感');
{
  const env = makeEnv({}, () => ({ passthrough: true }));
  const xhr = new env.FakeXHR();
  xhr.open('GET', '//api.bilibili.com/x/player/wbi/playurl?bvid=BV1&cid=1');
  xhr.send();
  await sleep(20);
  check('走原生请求', env.state.fetched.length === 1);
  check('XHR 不被伪造完成态', xhr.readyState !== 4);
  env.win.__teardown();
}

console.log('\n[10] nanoPlayer (现代番剧播放器) 劫持与流地址接管');
{
  let sandboxedUrl = null;
  const env = makeEnv({ hidePlayinfo: true }, (req) => {
    sandboxedUrl = req.url;
    return {
      body: JSON.stringify({ code: 0, result: { video_info: { quality: 120 } } }),
      headersRaw: 'content-type: application/json'
    };
  });
  const win = env.win;
  // 模拟真实页面初始化 nanoPlayer
  const dummyNano = {
    createPlayer: (cfg) => ({ cfg })
  };
  win.nano = dummyNano;
  const created = win.nano.createPlayer({
    episodeId: 766336,
    prefetch: { playUrl: { preview: true } },
    requestConfig: {
      reqHttpPlayUrlInfo: () => Promise.resolve({ preview: true })
    }
  });

  check('prefetch.playUrl 被删除', created.cfg.prefetch.playUrl === undefined);
  check('reqHttpPlayUrlInfo 属性被显式删除', created.cfg.requestConfig.reqHttpPlayUrlInfo === undefined);
  check('reqHttpPlayUrlInfoScope 被删除', created.cfg.requestConfig.reqHttpPlayUrlInfoScope === undefined);
  await win.fetch('https://api.bilibili.com/pgc/player/web/v2/playurl?ep_id=766336');
  check('回落请求被接管转交沙箱', sandboxedUrl && sandboxedUrl.includes('ep_id=766336'), sandboxedUrl);
  win.__teardown();
}

console.log('');
if (failed) {
  console.error(`\x1b[31m${failed} 项失败\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32m全部通过\x1b[0m');