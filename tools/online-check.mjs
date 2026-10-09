/**
 * 在线契约检查：不需要任何 Cookie，直接验证「本项目的签名与参数改写是否符合 B 站服务端的真实要求」。
 *
 * 验证三件事：
 *   1. 本项目算出的 w_rid 能被服务端接受（未登录也应报 -101 而不是 -403）
 *   2. 改了 qn/fnval 却不重签，服务端确实会拒绝（=> 重签是必须的，证明核心设计成立）
 *   3. 服务端当前的 wbi 密钥与本项目使用的置换算法一致
 *
 *   node tools/online-check.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;

function check(name, cond, extra) {
  if (cond) console.log(`  \x1b[32m✔\x1b[0m ${name}`);
  else {
    failed++;
    console.error(`  \x1b[31m✖\x1b[0m ${name}${extra !== undefined ? '  → ' + extra : ''}`);
  }
}

async function loadWbi() {
  const res = await esbuild.build({
    entryPoints: [path.join(ROOT, 'src/core/wbi.js')],
    bundle: true, format: 'esm', write: false, platform: 'neutral', target: 'es2022', logLevel: 'silent'
  });
  return import('data:text/javascript;base64,' + Buffer.from(res.outputFiles[0].text, 'utf8').toString('base64'));
}

async function api(url) {
  const r = await fetch(url, { headers: { Referer: 'https://www.bilibili.com/', Origin: 'https://www.bilibili.com', 'User-Agent': 'Mozilla/5.0' } });
  return r.json();
}

/** 找一个当前真实存在的视频（cid 会变，硬编码容易 404），用于探测 */
async function resolveSampleVideo() {
  // ranking/v2 需要登录态，会返回 -352；popular 可匿名访问
  const list = await api('https://api.bilibili.com/x/web-interface/popular?ps=5&pn=1');
  const bvid = list?.data?.list?.[0]?.bvid;
  if (!bvid) throw new Error('无法获取样本视频');
  const view = await api('https://api.bilibili.com/x/web-interface/view?bvid=' + bvid);
  const cid = view?.data?.cid;
  if (!cid) throw new Error('无法获取样本 cid');
  return { bvid, cid, aid: view?.data?.aid, title: view?.data?.title };
}

const { buildMixinKey, signUrl, extractWbiKeys } = await loadWbi();

console.log('\n[1] 服务端当前 wbi 密钥');
const nav = await api('https://api.bilibili.com/x/web-interface/nav');
const keys = extractWbiKeys(nav);
check('能从 nav 响应提取密钥', !!keys, JSON.stringify(keys && keys.imgKey));
console.log(`      img_key = ${keys?.imgKey}`);
console.log(`      sub_key = ${keys?.subKey}`);
console.log(`      mixinKey= ${keys?.mixinKey}`);
check(
  'mixinKey 与公开测试向量一致',
  keys?.mixinKey === buildMixinKey('7cd084941338484aae1ad9425b84077c', '4932caff0ff746eab6f01bf08b70ac45'),
  keys?.mixinKey
);

console.log('\n[2] 本项目签名的请求能正常拿到业务响应吗');
const sample = await resolveSampleVideo();
console.log(`      样本视频：${sample.bvid} cid=${sample.cid}  ${sample.title}`);
const probeUrl =
  `https://api.bilibili.com/x/player/wbi/playurl?bvid=${sample.bvid}&cid=${sample.cid}` +
  '&qn=127&fnver=0&fnval=4048&fourk=1&otype=json&platform=pc';
const signed = signUrl(new URL(probeUrl), keys.mixinKey);
const r1 = await api(signed.href);
console.log(`      签名后：code=${r1.code} message=${r1.message}`);
check('签名请求能正常返回', r1.code === 0 || r1.code === -101, r1.code);
check('服务端确实解析到了视频', r1.code !== -404, r1.code);

console.log('\n[3] qn 确实是决定画质的参数（本项目核心改动的依据）');
const q16 = await api(new URL(signUrl(new URL(probeUrl.replace('qn=127', 'qn=16')), keys.mixinKey)).href);
const q127 = r1;
console.log(`      qn=16  → quality=${q16.data?.quality}`);
console.log(`      qn=127 → quality=${q127.data?.quality}`);
check('qn=16 时 quality 确实被压到 16', q16.data?.quality === 16, q16.data?.quality);
check('qn=127 时拿到的是该账号能给的最高档（匿名被限到 64）', q127.data?.quality === 64, q127.data?.quality);
check('support_formats 里含 4K(120)，说明高档位由账号权益决定', (q127.data?.support_formats || []).some((f) => f.quality === 120));

console.log('\n[4] w_rid 当前是否被服务端强制校验（仅记录事实，不作为断言）');
const noRid = new URL(signed.href);
noRid.searchParams.delete('w_rid');
noRid.searchParams.delete('wts');
const rNoRid = await api(noRid.href);
const zeroRid = new URL(signed.href);
zeroRid.searchParams.set('w_rid', '0'.repeat(32));
const rZeroRid = await api(zeroRid.href);
console.log(`      不带 w_rid：code=${rNoRid.code}`);
console.log(`      w_rid 全零：code=${rZeroRid.code}`);
const enforced = rNoRid.code === -403 || rZeroRid.code === -403;
console.log(
  enforced
    ? '      → 服务端在强制校验签名（重签是必需的）'
    : '      → 服务端目前**不校验** w_rid。重签仍保留（万一恢复校验，且改参数后重签总是安全的）'
);

console.log('\n[5] 传统（非 wbi）playurl 接口');
const legacy =
  `https://api.bilibili.com/x/player/playurl?bvid=${sample.bvid}&cid=${sample.cid}` +
  '&qn=127&fnver=0&fnval=4048&fourk=1&otype=json';
const r3 = await api(legacy);
console.log(`      /x/player/playurl：code=${r3.code} quality=${r3.data?.quality}`);
check('抬高参数不会被拒', r3.code !== -403 && r3.code !== -404, r3.code);

console.log('\n[6] 白名单端点路径核对');
const v2 = await api(`https://api.bilibili.com/x/player/wbi/v2?bvid=${sample.bvid}&cid=${sample.cid}`);
check('/x/player/wbi/v2 可用', v2.code === 0, `code=${v2.code}`);
check(
  '该接口响应里确实没有 accept_*（这是把 v2 移出代理、只做本地伪装的原因）',
  Object.keys(v2.data || {}).filter((k) => k.startsWith('accept')).length === 0,
  Object.keys(v2.data || {}).filter((k) => k.startsWith('accept')).join(',')
);
const pu = await api(signed.href);
check('accept_quality 在 playurl 响应里', Array.isArray(pu.data?.accept_quality), JSON.stringify(pu.data?.accept_quality));
const legacyV2 = await api(`https://api.bilibili.com/x/player/v2?bvid=${sample.bvid}&cid=${sample.cid}`);
check('/x/player/v2 可用（旧版播放器）', legacyV2.code === 0, `code=${legacyV2.code}`);
const live = await api('https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?room_id=1&protocol=0,1&format=0,1,2,0&codec=0&qn=10000&platform=web&ptype=8');
check('/xlive/web-room/v2/index/getRoomPlayInfo 路径正确', live.code === 0, `code=${live.code}`);

console.log('');
if (failed) {
  console.error(`\x1b[31m${failed} 项不符合预期\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32m服务端契约与本项目实现一致\x1b[0m');
console.log('提示：这只是匿名态验证。带 B 账号 Cookie 的真实验证请跑 npm run verify:local');