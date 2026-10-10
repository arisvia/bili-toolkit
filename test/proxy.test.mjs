/**
 * 代理流水线集成测试：用 mock 的 GM_* 环境跑真实的 src/core/proxy.js。
 *   node test/proxy.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;

function check(name, cond, extra) {
  if (cond) console.log(`  \x1b[32m✔\x1b[0m ${name}`);
  else {
    failed++;
    console.error(`  \x1b[31m✖\x1b[0m ${name}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`);
  }
}

/* ---------------- 搭建 mock 沙箱 ---------------- */

const B_COOKIE = 'SESSDATA=b-secret; DedeUserID=999; bili_jct=b-csrf; buvid3=b-dev3';
const calls = [];
const replies = new Map(); // urlPrefix -> handler

function makeContext() {
  const storeMap = new Map();

  const ctx = {
    console,
    URL,
    URLSearchParams,
    Promise,
    Math,
    JSON,
    Date,
    Error,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    crypto: { getRandomValues: (a) => a },
    navigator: { userAgent: 'test' },
    location: { href: 'https://www.bilibili.com/video/BV1test' },
    confirm: () => true,
    document: { cookie: 'buvid3=a-dev3; DedeUserID=111; bili_jct=a-csrf' },

    GM_getValue: (k, d) => (storeMap.has(k) ? storeMap.get(k) : d),
    GM_setValue: (k, v) => storeMap.set(k, v),
    GM_deleteValue: (k) => storeMap.delete(k),

    GM_xmlhttpRequest(opts) {
      const record = {
        url: opts.url,
        method: opts.method,
        cookie: opts.cookie,
        anonymous: opts.anonymous,
        headers: opts.headers,
        data: opts.data
      };
      calls.push(record);
      const key = Array.from(replies.keys()).find((p) => opts.url.startsWith(p));
      const handler = key !== undefined ? replies.get(key) : null;
      const respond = () => {
        if (!handler) {
          if (opts.onerror) opts.onerror({ status: 0 });
          return;
        }
        const r = handler(record);
        if (r.networkError) {
          if (opts.onerror) opts.onerror({ status: 0 });
        } else {
          opts.onload({
            status: r.status ?? 200,
            statusText: 'OK',
            responseText: r.text ?? '',
            responseHeaders: r.headers ?? 'content-type: application/json'
          });
        }
      };
      setTimeout(respond, 0);
    }
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.window.postMessage = () => {};
  ctx.window.addEventListener = () => {};
  return ctx;
}

async function loadPlainModule(ctx, rel) {
  const res = await esbuild.build({
    entryPoints: [path.join(ROOT, rel)],
    bundle: true,
    format: 'cjs',
    platform: 'neutral',
    target: 'es2022',
    write: false,
    logLevel: 'silent'
  });
  vm.createContext(ctx);
  vm.runInContext(
    `const module={exports:{}};const exports=module.exports;\n${res.outputFiles[0].text}\n;globalThis.__m=module.exports;`,
    ctx,
    { filename: rel.replace(/\//g, '_') }
  );
  return ctx.__m;
}

async function loadProxyModule(ctx) {
  const res = await esbuild.build({
    entryPoints: [path.join(ROOT, 'src/core/proxy.js')],
    bundle: true,
    format: 'cjs',
    platform: 'neutral',
    target: 'es2022',
    write: false,
    logLevel: 'silent'
  });
  const code = res.outputFiles[0].text;
  vm.createContext(ctx);
  vm.runInContext(
    `const module = {exports:{}}; const exports = module.exports;\n${code}\n;globalThis.__api = module.exports;`,
    ctx,
    { filename: 'proxy.bundle.js' }
  );
  return ctx.__api;
}

/* ---------------- 用例 ---------------- */

console.log('\n[1] 未配置 Cookie 时必须放行');
{
  const ctx = makeContext();
  const api = await loadProxyModule(ctx);
  const r = await api.handleRequest({ url: 'https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1&cid=1', method: 'GET' });
  check('返回 passthrough', r.passthrough === true, r);
  check('没有发出任何请求', calls.length === 0, calls.length);
}

console.log('\n[2] 普通视频：抬高画质 + 重签 wbi');
{
  calls.length = 0;
  replies.clear();
  const ctx = makeContext();
  ctx.GM_setValue('b.cookie', B_COOKIE);

  let seenPlayurl = null;
  replies.set('https://api.bilibili.com/x/web-interface/wbi/img', () => ({
    text: JSON.stringify({ code: 0, data: { img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png' } })
  }));
  replies.set('https://api.bilibili.com/x/player/wbi/playurl', (rec) => {
    seenPlayurl = rec;
    return {
      text: JSON.stringify({
        code: 0,
        data: { quality: 120, accept_quality: [120, 116, 80], timelength: 1000, dash: { video: [{ id: 120 }], audio: [{ id: 30280 }] }, support_formats: [{ quality: 120 }, { quality: 116 }] }
      })
    };
  });

  const api = await loadProxyModule(ctx);
  const r = await api.handleRequest({
    url: 'https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1xx&cid=42&qn=32&fnval=16&fourk=0',
    method: 'GET'
  });

  check('返回 B 的响应而非放行', r.passthrough === false, r.passthrough);
  check('拿到大会员画质 120', JSON.parse(r.body).data.quality === 120);
  const u = new URL(seenPlayurl.url);
  check('qn 被抬到 127', u.searchParams.get('qn') === '127', u.searchParams.get('qn'));
  check('fnval 被抬到 4048', u.searchParams.get('fnval') === '4048', u.searchParams.get('fnval'));
  check('fourk 置 1', u.searchParams.get('fourk') === '1');
  check('try_look 已删除', !u.searchParams.has('try_look'));
  check('重新生成了 w_rid', /^[0-9a-f]{32}$/.test(u.searchParams.get('w_rid')));
  check('生成了 wts', /^\d{10}$/.test(u.searchParams.get('wts')));
  check('保留了 bvid/cid', u.searchParams.get('bvid') === 'BV1xx' && u.searchParams.get('cid') === '42');
  check('携带 B 的 SESSDATA', String(seenPlayurl.cookie).includes('SESSDATA=b-secret'));
  check('排除了浏览器 Cookie', seenPlayurl.anonymous === true);
}

console.log('\n[3] wbi 密钥取不到时退回原始参数（宁可画质低也不能签名错）');
{
  calls.length = 0;
  replies.clear();
  const ctx = makeContext();
  ctx.GM_setValue('b.cookie', B_COOKIE);
  let seen = null;
  replies.set('https://api.bilibili.com/x/web-interface/wbi/img', () => ({ text: JSON.stringify({ code: -404, message: 'nope' }) }));
  replies.set('https://api.bilibili.com/x/player/wbi/playurl', (rec) => {
    seen = rec;
    return { text: JSON.stringify({ code: 0, data: { quality: 64 } }) };
  });
  const api = await loadProxyModule(ctx);
  const r = await api.handleRequest({
    url: 'https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1&cid=7&qn=32&fnval=16',
    method: 'GET'
  });
  const u = new URL(seen.url);
  check('仍然返回了可用响应', r.passthrough === false);
  check('退回页面原始 qn', u.searchParams.get('qn') === '32', u.searchParams.get('qn'));
  check('没有注入 w_rid', !u.searchParams.has('w_rid'));
}

console.log('\n[4] 番剧 OGV：csrf 换成 B 的，body 也同步');
{
  calls.length = 0;
  replies.clear();
  const ctx = makeContext();
  ctx.GM_setValue('b.cookie', B_COOKIE);
  let seen = null;
  replies.set('https://api.bilibili.com/ogv/player/playview', (rec) => {
    seen = rec;
    return { text: JSON.stringify({ code: 0, data: { video_info: { quality: 120, durl: [{ url: 'http://cdn/x.mp4' }] } } }) };
  });
  const api = await loadProxyModule(ctx);
  const r = await api.handleRequest({
    url: 'https://api.bilibili.com/ogv/player/playview?ep_id=7&cid=9&qn=32&csrf=a-csrf',
    method: 'POST',
    body: JSON.stringify({ ep_id: 7, cid: 9, csrf: 'a-csrf', business: 'play' })
  });
  const u = new URL(seen.url);
  check('query 里的 csrf 被换成 B 的', u.searchParams.get('csrf') === 'b-csrf', u.searchParams.get('csrf'));
  check('body 里的 csrf 也被换成 B 的', JSON.parse(seen.data).csrf === 'b-csrf', seen.data);
  check('body 其他字段保留', JSON.parse(seen.data).business === 'play');
  check('qn 被抬高', u.searchParams.get('qn') === '127');
  check('返回 OGV 响应', r.passthrough === false && JSON.parse(r.body).data.video_info.quality === 120);

  // form-urlencoded 形态：不能错拼成 cid=9csrf=b-csrf
  await api.handleRequest({
    url: 'https://api.bilibili.com/ogv/player/playview?ep_id=7&cid=9&qn=32',
    method: 'POST',
    body: 'ep_id=7&cid=9'
  });
  check('form-urlencoded body 正确用 & 拼接 csrf', seen.data.includes('cid=9&csrf=b-csrf'), seen.data);
}

console.log('\n[5] 业务错误 → 回退，不把错误页喂给播放器');
{
  calls.length = 0;
  replies.clear();
  const ctx = makeContext();
  ctx.GM_setValue('b.cookie', B_COOKIE);
  replies.set('https://api.bilibili.com/x/player/wbi/playurl', () => ({
    text: JSON.stringify({ code: -10403, message: '大会员专享' })
  }));
  const api = await loadProxyModule(ctx);
  const r = await api.handleRequest({ url: 'https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1&cid=1&qn=32', method: 'GET' });
  check('回退为 passthrough', r.passthrough === true, r);
}

console.log('\n[6] -403 签名被拒 → 退回原始参数再试一次');
{
  calls.length = 0;
  replies.clear();
  const ctx = makeContext();
  ctx.GM_setValue('b.cookie', B_COOKIE);
  let n = 0;
  replies.set('https://api.bilibili.com/x/web-interface/wbi/img', () => ({
    text: JSON.stringify({ code: 0, data: { img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png' } })
  }));
  replies.set('https://api.bilibili.com/x/player/wbi/playurl', () => {
    n++;
    if (n === 1) return { text: JSON.stringify({ code: -403, message: '签名错误' }) };
    return { text: JSON.stringify({ code: 0, data: { quality: 64 } }) };
  });
  const api = await loadProxyModule(ctx);
  const r = await api.handleRequest({ url: 'https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1&cid=1&qn=32', method: 'GET' });
  const playurlCalls = calls.filter((c) => c.url.includes('/playurl'));
  check('确实重试了一次', playurlCalls.length === 2, playurlCalls.length);
  check('重试用的是未抬高参数的原始 URL', new URL(playurlCalls[1].url).searchParams.get('qn') === '32');
  check('第二次成功返回', r.passthrough === false && JSON.parse(r.body).data.quality === 64);
}

console.log('\n[6b] POST 端点的参数重试也必须退回未注入 csrf 的 body');
{
  // 曾经的 bug：重试时把 msg.body 原样再发一次。对 csrf:true 的 POST 端点
  // （/ogv/player/playview、/ogv/player/playurl）来说，prepare() 已把 B 的 bili_jct
  // 写进 prep.body，于是「退回原始参数」其实发的是 A 的 csrf + B 的 SESSDATA，
  // 服务端必然再拒一次 —— 重试对最需要它的番剧端点反而永远失败。
  calls.length = 0;
  replies.clear();
  const ctx = makeContext();
  ctx.GM_setValue('b.cookie', B_COOKIE);
  const seen = [];
  replies.set('https://api.bilibili.com/ogv/player/playview', (rec) => {
    seen.push(JSON.parse(rec.data).csrf);
    if (seen.length === 1) return { text: JSON.stringify({ code: -403, message: '签名错误' }) };
    return { text: JSON.stringify({ code: 0, data: { video_info: { quality: 120 } } }) };
  });
  const api = await loadProxyModule(ctx);
  const r = await api.handleRequest({
    url: 'https://api.bilibili.com/ogv/player/playview?ep_id=7&cid=9&qn=32&csrf=a-csrf',
    method: 'POST',
    body: JSON.stringify({ ep_id: 7, cid: 9, csrf: 'a-csrf', business: 'play' })
  });
  check('第一次用 B 的 csrf', seen[0] === 'b-csrf', seen[0]);
  check('重试退回页面原始的 csrf（不是 A 配 B 的混合）', seen[1] === 'a-csrf', seen[1]);
  check('最终成功', r.passthrough === false && JSON.parse(r.body).data.video_info.quality === 120);
}

console.log('\n[6c] 切号后清缓存，不能把在途的旧账号响应写回去');
{
  // 曾经的 bug：cacheSet 在 coalesce 之外、await 之后执行。
  // 用户切换借用源 → resetCache() 清掉已缓存内容，但在途请求用的是旧账号 Cookie；
  // 它回来时照原样写回，旧账号的播放地址就继续供最多一个 TTL（120 秒）。
  calls.length = 0;
  replies.clear();
  const ctx = makeContext();
  ctx.GM_setValue('b.cookie', B_COOKIE);
  replies.set('https://api.bilibili.com/x/player/wbi/playurl', () => ({
    text: JSON.stringify({ code: 0, data: { quality: 120 } })
  }));
  const api = await loadProxyModule(ctx);
  const first = api.handleRequest({ url: 'https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1&cid=11&qn=32', method: 'GET' });
  api.resetCache();
  await first;
  check('清缓存后不再接受旧在途结果', api.cacheStats().size === 0, api.cacheStats());
  const before = calls.length;
  await api.handleRequest({ url: 'https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1&cid=11&qn=32', method: 'GET' });
  check('同 key 会重新联网而不是命中旧缓存', calls.length > before, { before, after: calls.length });
  check('在途表最终清空', api.cacheStats().inflight === 0, api.cacheStats().inflight);
}

console.log('\n[6d] coalesce 与 cacheClear 的交互（缓存模块级，不走网络时序）');
{
  const { coalesce, cacheClear, cacheGeneration, cacheInfo } = await loadPlainModule(makeContext(), 'src/core/cache.js');
  let resolve = null;
  const factory = () => new Promise((r) => { resolve = r; });
  // resolve 会被第二次调用覆盖，所以分别存
  const resolvers = [];
  const f = () => new Promise((r) => resolvers.push(r));

  // A 在途
  const pa = coalesce('K', f);
  const genA = cacheGeneration();
  // coalesce 内部是 Promise.resolve().then(factory)，factory 异步才跑，
  // 先让出一个 microtask 让 A 真正挂起来
  await Promise.resolve();
  await Promise.resolve();
  // 清缓存（模拟切号）——此刻 A 仍挂起
  cacheClear();
  check('代际号递增', cacheGeneration() === genA + 1, cacheGeneration());
  // 清之后同 key 再来一个：必须注册新的在途，而且不与 A 共用
  const pb = coalesce('K', f);
  check('新请求不落到旧在途上', pb !== pa);
  // A 现在才回来：它的 finally 不能把 B 的在途记录删掉
  resolvers[0]('a-result');
  await pa;
  check('A 回来后 B 的在途仍登记着', cacheInfo().inflight === 1, cacheInfo().inflight);
  // B 也回来
  resolvers[1]('b-result');
  const rb = await pb;
  check('B 仍拿到自己的结果', rb === 'b-result', rb);
  check('在途表最终清空', cacheInfo().inflight === 0, cacheInfo().inflight);

  // 同代际下的正常去重不能被这次修复破坏
  cacheClear();
  let ran = 0;
  const f2 = () => { ran++; return Promise.resolve('shared'); };
  const [x, y] = await Promise.all([coalesce('S', f2), coalesce('S', f2)]);
  check('未清缓存时仍然合并', ran === 1 && x === 'shared' && y === 'shared', { ran });
}

console.log('\n[7] 缓存：同一个 cid 连发 3 次只打一次网络');
{
  calls.length = 0;
  replies.clear();
  const ctx = makeContext();
  ctx.GM_setValue('b.cookie', B_COOKIE);
  replies.set('https://api.bilibili.com/x/player/wbi/playurl', () => ({
    text: JSON.stringify({ code: 0, data: { quality: 120 } })
  }));
  const api = await loadProxyModule(ctx);
  const msg = { url: 'https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1&cid=5&qn=32', method: 'GET' };
  const rs = await Promise.all([api.handleRequest(msg), api.handleRequest(msg), api.handleRequest(msg)]);
  await api.handleRequest(msg);
  check('三次并发只发一次请求', calls.filter((c) => c.url.includes('/playurl')).length === 1, calls.length);
  check('三次都拿到成功响应', rs.every((r) => r.passthrough === false));
}

console.log('\n[8] 发送方式失败时自动换下一种');
{
  calls.length = 0;
  replies.clear();
  const ctx = makeContext();
  ctx.GM_setValue('b.cookie', B_COOKIE);
  let attempts = 0;
  ctx.GM_xmlhttpRequest = (opts) => {
    if (opts.url.includes('playurl')) {
      attempts++;
      calls.push({ url: opts.url, strategy: opts.useOption });
      if (attempts === 1) {
        setTimeout(() => opts.onerror({ status: 0 }), 0);
        return;
      }
      setTimeout(() => opts.onload({ status: 200, statusText: 'OK', responseText: JSON.stringify({ code: 0, data: { quality: 120 } }), responseHeaders: '' }), 0);
      return;
    }
    setTimeout(() => opts.onload({ status: 200, statusText: 'OK', responseText: JSON.stringify({ code: 0, data: { img_url: 'https://x/7cd084941338484aae1ad9425b84077c.png', sub_url: 'https://x/4932caff0ff746eab6f01bf08b70ac45.png' } }), responseHeaders: '' }), 0);
  };
  const api = await loadProxyModule(ctx);
  const r = await api.handleRequest({ url: 'https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1&cid=2&qn=32', method: 'GET' });
  check('换方式后成功', r.passthrough === false, r);
  check('确实尝试了不止一种方式', attempts >= 2, attempts);
}

console.log('\n[9] 会员字段补丁会作用在代理响应上');
{
  calls.length = 0;
  replies.clear();
  const ctx = makeContext();
  ctx.GM_setValue('b.cookie', B_COOKIE);
  ctx.GM_setValue('b.patchUi', true);
  replies.set('https://api.bilibili.com/x/player/wbi/playurl', () => ({
    text: JSON.stringify({ code: 0, data: { quality: 120, vip: { status: 0, type: 0 }, vipStatus: 0 } })
  }));
  const api = await loadProxyModule(ctx);
  const r = await api.handleRequest({ url: 'https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1&cid=3&qn=32', method: 'GET' });
  const d = JSON.parse(r.body).data;
  check('vip.status -> 1', d.vip.status === 1);
  check('vipStatus -> 1', d.vipStatus === 1);
}

console.log('');
if (failed) {
  console.error(`\x1b[31m${failed} 项失败\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32m全部通过\x1b[0m');