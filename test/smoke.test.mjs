/**
 * 冒烟测试：不依赖浏览器，验证纯逻辑部分与产物完整性。
 *   node test/smoke.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;

function check(name, cond, extra) {
  if (cond) {
    console.log(`  \x1b[32m✔\x1b[0m ${name}`);
  } else {
    failed++;
    console.error(`  \x1b[31m✖\x1b[0m ${name}${extra ? '  → ' + extra : ''}`);
  }
}

/** 用 esbuild 就地打包单个模块，再以 data: URL 导入（避开相对 import 与浏览器 API） */
const loadCache = new Map();
async function load(rel) {
  if (loadCache.has(rel)) return loadCache.get(rel);
  const res = await esbuild.build({
    entryPoints: [path.join(ROOT, rel)],
    bundle: true,
    format: 'esm',
    write: false,
    platform: 'neutral',
    target: 'es2022',
    logLevel: 'silent'
  });
  const mod = await import('data:text/javascript;base64,' + Buffer.from(res.outputFiles[0].text, 'utf8').toString('base64'));
  loadCache.set(rel, mod);
  return mod;
}

console.log('\n[1] MD5');
{
  const { md5 } = await load('src/core/md5.js');
  const crypto = await import('node:crypto');
  const cases = ['', 'abc', 'w_rid', 'x'.repeat(1000), '中文 abc 🎬'];
  let ok = true;
  for (const c of cases) {
    const ref = crypto.createHash('md5').update(c, 'utf8').digest('hex');
    if (md5(c) !== ref) ok = false;
  }
  check('与 node:crypto 结果一致', ok);
}

console.log('\n[2] mixinKey（公开测试向量）');
{
  const { buildMixinKey, signUrl } = await load('src/core/wbi.js');
  check(
    'img_key/sub_key → mixinKey',
    buildMixinKey('7cd084941338484aae1ad9425b84077c', '4932caff0ff746eab6f01bf08b70ac45') ===
      'ea1db124af3c7062474693fa704f4ff8',
    buildMixinKey('7cd084941338484aae1ad9425b84077c', '4932caff0ff746eab6f01bf08b70ac45')
  );

  const u = signUrl(new URL('https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1&cid=2&qn=127'), 'ea1db124af3c7062474693fa704f4ff8');
  const rid = u.searchParams.get('w_rid');
  const wts = u.searchParams.get('wts');
  check('重签后带 wts/w_rid', !!rid && /^[0-9a-f]{32}$/.test(rid), rid + ' / ' + wts);
  check('原始参数被保留', u.searchParams.get('bvid') === 'BV1' && u.searchParams.get('qn') === '127');

  // 确定性校验：同一参数、同一 wts 必须得到同一个 w_rid
  const u2 = new URL(u.href);
  u2.searchParams.set('wts', wts);
  const { md5 } = await load('src/core/md5.js');
  const expect = md5(
    'bvid=BV1&cid=2&qn=127&wts=' + wts + 'ea1db124af3c7062474693fa704f4ff8'
  );
  check('w_rid 与手算一致', expect === rid, expect + ' != ' + rid);
}

console.log('\n[3] Cookie 工具');
{
  const { sanitizeCookie, parseCookie, backfillDeviceCookies, maskCookie } = await load('src/core/cookie.js');
  const pasted = 'SESSDATA=abc\nDedeUserID=123\nbili_jct=xyz';
  const cleaned = sanitizeCookie(pasted);
  check('换行被规整成分号', parseCookie(cleaned).SESSDATA === 'abc' && parseCookie(cleaned).bili_jct === 'xyz', cleaned);

  const filled = parseCookie(backfillDeviceCookies('SESSDATA=abc; DedeUserID=123', 'buvid3=DEV3; SESSDATA=AAC; buvid4=DEV4'));
  check('缺失的设备 Cookie 被补齐', filled.buvid3 === 'DEV3' && filled.buvid4 === 'DEV4');
  check('身份 Cookie 不会被 A 覆盖', filled.SESSDATA === 'abc');

  const noMix = parseCookie(backfillDeviceCookies('SESSDATA=abc', 'sid=ASID; bili_jct=AJCT'));
  check('不会混入 A 的 sid', noMix.sid === undefined, JSON.stringify(noMix));
  check('缺失 bili_jct 时会用 A 的补上（番剧需要）', noMix.bili_jct === 'AJCT');

  const masked = maskCookie('SESSDATA=0123456789abcdefghij; DedeUserID=42');
  check('脱敏不泄露完整 SESSDATA', !masked.includes('0123456789abcdefghij') && masked.includes('42'), masked);
}

console.log('\n[4] Cookie 完整性分级');
{
  const { validateCookie } = await load('src/core/cookie.js');
  const { helperHelp, TIERS } = await load('src/core/cookie-parse.js');

  const none = validateCookie('');
  check('空 Cookie 判定为不可用', none.ok === false && none.problems.length === 1);

  const onlySess = validateCookie('SESSDATA=abc');
  check('只有 SESSDATA 时可用（ok=true）', onlySess.ok === true, JSON.stringify(onlySess.problems));
  check('缺 DedeUserID/bili_jct 归为 warning 而非 problem', onlySess.warnings.length === 2, JSON.stringify(onlySess.warnings));
  check('warning 文案点明 bili_jct 与番剧相关', onlySess.warnings.some((w) => w.includes('番剧')), JSON.stringify(onlySess.warnings));
  // 设备字段确实可省：不该再劝用户去存
  check('不再提示补 buvid（实测无影响）', !onlySess.warnings.some((w) => w.includes('buvid')), JSON.stringify(onlySess.warnings));

  const full = validateCookie('SESSDATA=a; DedeUserID=1; bili_jct=b');
  check('字段齐全时无任何提示（设备字段不再算缺失）', full.ok && full.problems.length === 0 && full.warnings.length === 0, JSON.stringify(full.warnings));

  const legacy = validateCookie('SESSDATA=a; bili-jct=b; buvid4=d; DedeUserID=9');
  check('兼容 bili-jct（下划线变体）', legacy.ok && legacy.warnings.length === 0, JSON.stringify(legacy.warnings));

  check('字段表覆盖 SESSDATA 与 bili_jct', !!TIERS.SESSDATA && !!TIERS.bili_jct);
  check('帮助文案提到必需要素', helperHelp().includes('SESSDATA') && helperHelp().includes('bili_jct'));
  // 帮助文案是唯一能告诉用户「设备字段为什么不存」的地方
  check('帮助文案说明了设备字段为什么不存', helperHelp().includes('不保存') && helperHelp().includes('buvid3'), helperHelp());
  check('帮助文案点明 bili_jct 无法推导', helperHelp().includes('推导'), helperHelp());
}

console.log('\n[5] 端点白名单');
{
  const { resolveEndpoint } = await load('src/core/endpoints.js');
  check('命中 playurl', !!resolveEndpoint('https://api.bilibili.com/x/player/wbi/playurl?bvid=x', 'GET'));
  check('http 拒绝', resolveEndpoint('http://api.bilibili.com/x/player/wbi/playurl', 'GET') === null);
  check('GET 不能打 POST 接口', resolveEndpoint('https://api.bilibili.com/ogv/player/playview', 'GET') === null);
  check('非白名单主机拒绝', resolveEndpoint('https://evil.com/x/player/wbi/playurl', 'GET') === null);
  check('路径不完全匹配时拒绝', resolveEndpoint('https://api.bilibili.com/x/player/wbi/playurlXXX', 'GET') === null);
  check('导航接口不属于代理表', resolveEndpoint('https://api.bilibili.com/x/web-interface/nav', 'GET') === null);
}

console.log('\n[6] 会员字段补丁');
{
  const { patchVipFlags } = await load('src/core/patch.js');
  const o = { data: { user: { vipStatus: 0, vipType: 0, vip: { status: 0, type: 0 } }, login_mid: 7 } };
  patchVipFlags(o);
  check('vipStatus -> 1', o.data.user.vipStatus === 1);
  check('vip.type -> 2', o.data.user.vip.type === 2);
  check('身份字段 login_mid 不受影响', o.data.login_mid === 7);
}

console.log('\n[7] 区域形态改写');
{
  const { patchRegion, REGION_MODES } = await load('src/core/region.js');
  const o = {
    data: {
      ip_region: 'CN',
      rights: { area_limit: 1194, ban_area_show: 1, can_watch: 0 },
      areas: [{ id: 2, name: '日本' }],
      login_mid: 5
    }
  };
  const n = patchRegion(o, 'hkmo');
  check('ip_region 被改为 HK', o.data.ip_region === 'HK', o.data.ip_region);
  check('area_limit 归零', o.data.rights.area_limit === 0);
  check('ban_area_show 归零', o.data.rights.ban_area_show === 0);
  check('can_watch 置 1', o.data.rights.can_watch === 1);
  check('areas 补上目标区域', o.data.areas.some((a) => a.name === '港澳台'));
  check('身份字段 login_mid 不受影响', o.data.login_mid === 5);
  check('有字段被改动', n > 0, n);

  const before = JSON.stringify(o.data);
  patchRegion(o, 'off');
  check('off 模式完全不干预', JSON.stringify(o.data) === before);

  check('模式表完整', ['off', 'hkmo', 'tw', 'cn'].every((k) => REGION_MODES[k]));
}

console.log('\n[7b] 死导出清理：留着只会让人以为「改这份就够了」');
{
  // 这些注释里点名了被删的函数名，是有意留的说明。断言必须只看真正的声明，
  // 否则「解释为什么删」的注释本身会把测试顶红。
  const declaredIn = (file) => {
    const s = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const noComments = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    return noComments;
  };
  const decl = (file, name) => new RegExp('(export\\s+)?(async\\s+)?function\\s+' + name + '\\b').test(declaredIn(file));

  const dead = [
    ['src/core/session.js', 'mixinKeyStatus', '面板改走日志/诊断，不再调用'],
    ['src/core/browser-cookie.js', 'browserAccountMid', '身份识别改用 nav 的 mid，不依赖 HttpOnly'],
    ['src/core/browser-cookie.js', 'listBrowserCookies', '只被 browserAccountMid 用，跟着一起死'],
    ['src/core/bus.js', 'notifyReady', '握手方向是单向的，钩子从不监听 ready'],
    ['src/core/store.js', 'setCacheTtl', '界面上没有这个控件，看着可调其实调不了'],
    ['src/core/region.js', 'describeMode', '没有任何界面用到'],
    ['src/core/region.js', 'patchSsRegion', '钩子里有独立副本，这份从未被调用'],
    ['src/core/transport.js', 'headerValue', '没有任何模块使用响应头解析']
  ];
  for (const [file, name, why] of dead) {
    check(`${file} 已删除 ${name}（${why}）`, !decl(file, name), name);
  }
  // clearConfirm 是文案不是函数，单独查
  check('text.js 已删除 clearConfirm（清空按钮没有确认步骤）', !/^\s*clearConfirm\s*:/m.test(declaredIn('src/core/text.js')));

  // 双份区域逻辑：钩子是字符串化注入的独立作用域，只能各写一份。
  // 真正的风险是有人只改一边，所以两边都必须留着互相指向的警告。
  const hook = fs.readFileSync(path.join(ROOT, 'src/injected/hook.js'), 'utf8');
  const region = fs.readFileSync(path.join(ROOT, 'src/core/region.js'), 'utf8');
  check('钩子那份 patchSsRegion 标明了自己是副本', /独立副本[\s\S]{0,120}?不是引用/.test(hook));
  check('region.js 指向了钩子那份', /src\/injected\/hook\.js/.test(region));
}

console.log('\n[8] 钩子源码与自检协议');
{
  const hook = fs.readFileSync(path.join(ROOT, 'src/injected/hook.js'), 'utf8');
  check('占位符存在且唯一', hook.split('__BILI_VIP_CFG__').length - 1 === 1);

  // 自检协议：钩子必须能在被问到时如实汇报，且汇报的字段名要和沙箱读的一致。
  // 这些字段名是跨 postMessage 的契约，改名不会报错，只会静默显示「未连接」。
  check('钩子响应 ping', /d\.type === 'ping'/.test(hook));
  check('回的是 pong', /type: 'pong'/.test(hook));
  // 字段名的契约跨三个文件：钩子产出 → bus 收下 → panel 读出来渲染。
  // 任何一环改名都不会报错，只会让诊断区永远显示「未连接」。
  const bus = fs.readFileSync(path.join(ROOT, 'src/core/bus.js'), 'utf8');
  const panel = fs.readFileSync(path.join(ROOT, 'src/ui/panel.js'), 'utf8');
  for (const f of ['intercepted', 'playinfoHooked', 'playinfoHidden']) {
    check(`自检字段 ${f} 在钩子里有定义`, new RegExp('\\b' + f + ':').test(hook), f);
    check(`自检字段 ${f} 被面板读出来`, panel.includes('sc.' + f), f);
  }
  check('bus 会存下钩子回的状态', /case 'pong'/.test(bus) && /hookSelfCheck = d\.state/.test(bus));
  check('bus 提供 pingHook 与 getHookSelfCheck', /export function pingHook/.test(bus) && /export function getHookSelfCheck/.test(bus));
  // 计数必须挂在唯一的转交点上，否则「已接管 N 个请求」恒为 0
  check('计数挂在 callSandbox 的投递处', /payload\.token = token;[\s\S]{0,200}?intercepted\+\+/.test(hook));
  check('__playinfo__ 装成功后置位', /playinfoHooked = true/.test(hook));
  // playinfoHidden 必须要求「装上了」且「读出来是 undefined」，两者缺一不可
  check('playinfoHidden 要求访问器已装上', /playinfoHidden: playinfoHooked && hidden/.test(hook));
  let parses = true;
  try {
    await esbuild.transform(hook.replace('__BILI_VIP_CFG__', '{}'), { loader: 'js' });
  } catch (e) {
    parses = false;
    console.error(e.message);
  }
  check('语法可解析', parses);
}

console.log('\n[9] 构建产物');
{
  const distPath = path.join(ROOT, 'dist/bili-toolkit.user.js');
  const dist = fs.readFileSync(distPath, 'utf8');
  check('userscript 头在最前面', dist.startsWith('// ==UserScript=='));
  check('run-at document-start', dist.includes('@run-at       document-start'));
  // 钩子源码是以字符串形式内联的，占位符必须原样保留在产物里，由 inject.js 在运行时替换
  check('钩子源码已内联（占位符保留待运行时替换）', dist.includes('__BILI_VIP_CFG__'));
  check('内联配置已序列化进代码', dist.includes('"sandboxEntries"') || dist.includes('sandboxEntries'));
  check('包含 wbi mixin 表', dist.includes('MIXIN_KEY_ENC_TAB') || dist.includes('46,47,18,2,53'));
  check('产物可再次解析', (await esbuild.transform(dist, { loader: 'js' })).code.length > 0);
}

console.log('\n[10] 菜单命令注册与符号完整性');
{
  const registered = [];
  const ctx = {
    GM_registerMenuCommand: (name, fn) => registered.push({ name, fn }),
    GM_notification: () => {},
    GM_getValue: () => null,
    GM_setValue: () => {},
    GM_deleteValue: () => {},
    GM_xmlhttpRequest: () => {},
    navigator: { clipboard: { readText: async () => '' } },
    document: { createElement: () => ({ appendChild: () => {}, querySelector: () => null }), head: null, body: null, documentElement: null },
    window: {},
    location: { href: 'https://www.bilibili.com/', reload() {} },
    console: { log(){}, error(){}, warn(){} }
  };
  ctx.window = ctx;

  const res = await esbuild.build({
    entryPoints: [path.join(ROOT, 'src/ui/menu.js')],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'neutral',
    target: 'es2022',
    logLevel: 'silent'
  });
  const vm = await import('node:vm');
  vm.createContext(ctx);
  vm.runInContext(
    `(function(){ const module = {exports:{}}; const exports = module.exports;\n${res.outputFiles[0].text}\n;return module.exports; })().registerMenus();`,
    ctx
  );
  check('9 项菜单命令全部成功注册', registered.length === 9, registered.length);
  check('所有菜单回调均为有效函数（无未定义符号缺失）', registered.every((m) => typeof m.fn === 'function'));

  // 真实调用测试：确保 handler 内部没有未绑定的自由变量（如丢失 import 抛出 ReferenceError）
  const refErrors = [];
  for (const m of registered) {
    try {
      await m.fn();
    } catch (e) {
      if (e instanceof ReferenceError || /is not defined/.test(String(e))) {
        refErrors.push(m.name + ': ' + e.message);
      }
    }
  }
  check('所有菜单回调执行时无未定义符号缺失 (ReferenceError)', refErrors.length === 0, refErrors);
}

console.log('\n[11] 编码偏好重排');
{
  const { reorderStreams, patchJsonText } = await load('src/core/patch.js');
  const rawJson = JSON.stringify({
    data: {
      dash: {
        video: [
          { id: 125, codecid: 12 },
          { id: 120, codecid: 7 },
          { id: 120, codecid: 12 },
          { id: 112, codecid: 7 },
          { id: 112, codecid: 12 },
          { id: 112, codecid: 13 }
        ]
      }
    }
  });

  // 1) 全部开关关闭且 codec='auto' 时，零解析直接返回原字符串（字节级完全相等）
  const unmutated = patchJsonText(rawJson, { patchVip: false, region: 'off', codec: 'auto' });
  check('默认且无干预时直接原样返回（字节级相等）', unmutated === rawJson);

  // 2) 多分辨率分组：分辨率首次出现顺序保持不变，各组内按偏好编码排序
  const mockJson = JSON.parse(rawJson);
  reorderStreams(mockJson, 'av1');
  const vList = mockJson.data.dash.video;
  check('分辨率 125/120/112 原始顺序保持不变', vList[0].id === 125 && vList[1].id === 120 && vList[3].id === 112);
  check('125 档位仅有 HEVC 时保持原样', vList[0].codecid === 12);
  check('120 档位优先排入 HEVC（无 AV1 时回退）', vList[1].codecid === 12 && vList[2].codecid === 7);
  check('112 档位优先排入 AV1', vList[3].codecid === 13 && vList[4].codecid === 12 && vList[5].codecid === 7);

  // 3) 优先 HEVC
  const mockHevc = JSON.parse(rawJson);
  reorderStreams(mockHevc, 'hevc');
  check('优先 HEVC 时 112 档位首选 HEVC 编码', mockHevc.data.dash.video[3].codecid === 12);

  // 4) 兼容 AVC
  const patched = JSON.parse(patchJsonText(rawJson, { codec: 'avc' }));
  check('兼容 AVC 时 112 档位首选 AVC 编码', patched.data.dash.video[3].codecid === 7);
}

console.log('\n[12] 扫码登录凭据提取与矢量二维码');
{
  const { extractCookies } = await load('src/core/qr-login.js');
  const crossUrl = 'https://passport.biligame.com/crossDomain?DedeUserID=123456&DedeUserID__ckMd5=abc&Expires=175000&SESSDATA=sess-qr&bili_jct=jct-qr';
  const headers = 'set-cookie: sid=sid-qr; path=/\r\nset-cookie: buvid3=dev3; path=/';
  const extracted = extractCookies(crossUrl, headers);
  check('从 crossDomain URL 中提取 SESSDATA', extracted.includes('SESSDATA=sess-qr'), extracted);
  check('从 URL 提取 bili_jct', extracted.includes('bili_jct=jct-qr'), extracted);
  check('从 URL 提取 DedeUserID', extracted.includes('DedeUserID=123456'), extracted);
  check('从响应头提取 sid', extracted.includes('sid=sid-qr'), extracted);

  const { renderSVG } = await import('uqr');
  const svg = renderSVG('https://passport.bilibili.com/test');
  check('uqr 输出有效 SVG 矢量代码', svg.startsWith('<svg') && svg.includes('viewBox'), svg.slice(0, 50));
}
console.log('');
if (failed) {
  console.error(`\x1b[31m${failed} 项失败\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32m全部通过\x1b[0m');