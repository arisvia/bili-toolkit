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
  check('缺 DedeUserID/buvid3/bili_jct 归为 warning 而非 problem', onlySess.warnings.length === 3, JSON.stringify(onlySess.warnings));
  check('warning 文案点明 bili_jct 与番剧相关', onlySess.warnings.some((w) => w.includes('番剧')), JSON.stringify(onlySess.warnings));
  check('warning 文案点明 -412 风险', onlySess.warnings.some((w) => w.includes('-412')));

  const full = validateCookie('SESSDATA=a; DedeUserID=1; bili_jct=b; buvid3=c');
  check('字段齐全时无任何提示', full.ok && full.problems.length === 0 && full.warnings.length === 0);

  const legacy = validateCookie('SESSDATA=a; bili-jct=b; buvid4=d; DedeUserID=9');
  check('兼容 bili-jct（下划线变体）', legacy.ok && legacy.warnings.length === 0, JSON.stringify(legacy.warnings));

  check('字段表覆盖 SESSDATA 与 bili_jct', !!TIERS.SESSDATA && !!TIERS.bili_jct);
  check('帮助文案提到必需要素', helperHelp().includes('SESSDATA') && helperHelp().includes('bili_jct'));
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

console.log('\n[8] 钩子源码');
{
  const hook = fs.readFileSync(path.join(ROOT, 'src/injected/hook.js'), 'utf8');
  check('占位符存在且唯一', hook.split('__BILI_VIP_CFG__').length - 1 === 1);
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
  const distPath = path.join(ROOT, 'dist/bilibili-vip-proxy.user.js');
  const dist = fs.readFileSync(distPath, 'utf8');
  check('userscript 头在最前面', dist.startsWith('// ==UserScript=='));
  check('run-at document-start', dist.includes('@run-at       document-start'));
  // 钩子源码是以字符串形式内联的，占位符必须原样保留在产物里，由 inject.js 在运行时替换
  check('钩子源码已内联（占位符保留待运行时替换）', dist.includes('__BILI_VIP_CFG__'));
  check('内联配置已序列化进代码', dist.includes('"sandboxEntries"') || dist.includes('sandboxEntries'));
  check('包含 wbi mixin 表', dist.includes('MIXIN_KEY_ENC_TAB') || dist.includes('46,47,18,2,53'));
  check('产物可再次解析', (await esbuild.transform(dist, { loader: 'js' })).code.length > 0);
}

console.log('');
if (failed) {
  console.error(`\x1b[31m${failed} 项失败\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32m全部通过\x1b[0m');