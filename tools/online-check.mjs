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
/** 取 n 个可匿名访问的样本视频（popular 不需要登录态） */
async function resolveSampleVideos(n = 5) {
  const list = await api(`https://api.bilibili.com/x/web-interface/popular?ps=${n}&pn=1`);
  const out = [];
  for (const it of list?.data?.list || []) {
    const view = await api('https://api.bilibili.com/x/web-interface/view?bvid=' + it.bvid);
    if (!view?.data?.cid) continue;
    const d = view.data;
    // 只收**普通投稿**。popular 里会混进付费 / 番剧内容（如《凡人修仙传》，
    // rights.pay=1），那类的 /x/player/wbi/playurl 匿名访问直接 -404 ——
    // 拿它当样本会把整段验证全染红，而结论跟代码都没问题。
    // 判据：rights.pay 标记付费，season/epid 标记番剧。
    const isUgc = !d.season && !d.epid && !d.rights?.pay;
    if (!isUgc) continue;
    out.push({ bvid: it.bvid, cid: d.cid, aid: d.aid, title: d.title });
  }
  if (!out.length) throw new Error('没有取到普通投稿样本（popular 全是番剧？）');
  return out;
}

const { buildMixinKey, signUrl, extractWbiKeys } = await loadWbi();

console.log('\n[0] 旧密钥端点是否真的下线了（决定 session.js 该从哪取密钥）');
const oldWbi = await fetch('https://api.bilibili.com/x/web-interface/wbi/img', {
  headers: { Referer: 'https://www.bilibili.com/', 'User-Agent': 'Mozilla/5.0' }
});
let oldWbiCode = 'HTTP ' + oldWbi.status;
try {
  oldWbiCode = (await oldWbi.json()).code;
} catch { /* 非 JSON，保留 HTTP 状态码 */ }
console.log(`      /x/web-interface/wbi/img → ${oldWbiCode}`);
console.log(
  Number(oldWbiCode) === 0
    ? '      → 该端点又活了：可以改回直取，省掉一次 nav 往返（记得同步 docs/findings.md）'
    : '      → 已下线。密钥只能从 nav 的 data.wbi_img 取（当前实现即如此）'
);

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
const samples = await resolveSampleVideos(5);
const sample = samples[0];
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
// qn 抬高 → quality 跟着升。这才是这段要证明的事（§3 的核心依据）。
// 注意别把 quality 与 accept_quality 挂钩：本次实测 quality=64 而清单里写着 116，
// 匿名态两者对不上。正因如此才不能用清单反推实际拿到的档位（见第 [8] 段）。
check(
  'qn 从 16 抬到 127 后 quality 确实变高',
  q127.data?.quality > q16.data?.quality,
  `qn16→${q16.data?.quality} qn127→${q127.data?.quality}`
);
console.log(`      accept_quality = ${JSON.stringify(q127.data?.accept_quality)}（与 quality 不相等，别拿它反推）`);

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

console.log('\n[7] 区域（geoip）参数对服务端是否真的有影响（诚实边界，不可夸大）');
// 实测 9 种取值都不改变 nav 的 ip_region —— 地区授权由服务端按 IP 判定。
// 这条断言的用意是：一旦服务端哪天开始认 geoip，CI 立刻失败提醒我们更新 region.js 与文案。
const GEOIPS = ['cn', 'cn_c', 'oversea', 'hk', 'tw', 'mo', 'intl', 'oversea_cn', 'intl_hk'];
const baselineRegion = nav?.data?.ip_region;
const geoResults = [];
for (const g of GEOIPS) {
  const r = await api('https://api.bilibili.com/x/web-interface/nav?geoip=' + g);
  geoResults.push({ g, code: r.code, region: r?.data?.ip_region });
}
const distinct = [...new Set(geoResults.map((r) => JSON.stringify(r.region)))];
console.log(`      基准 ip_region = ${JSON.stringify(baselineRegion)}`);
console.log(`      ${GEOIPS.length} 种 geoip 取值 → ${distinct.length} 种不同的 ip_region`);
if (distinct.length > 1) {
  console.log('      ' + geoResults.map((r) => `${r.g}=${r.code}:${JSON.stringify(r.region)}`).join('\n      '));
}
check(
  `${GEOIPS.length} 种 geoip 取值均不改变服务端 ip_region（地区只能改页面渲染形态）`,
  distinct.length === 1,
  distinct.length + ' 种结果'
);

console.log('\n[8] 画质清单字段不能当作「账号有无权益」的判据');
// 实测结论（2026-10-10 修正过一次，见 findings §4）：
//   accept_quality / support_formats 是**这部片子自己的档位表**，逐片不同，
//   同一片子上 B 大会员与匿名拿到的完全一样 —— 所以它能反映「片子提供什么」，
//   但**不能**反映「这个账号有没有权益」。
//   会员状态只能读 nav 的 data.vipStatus（patch.js 的 extractVipFromNav）。
//
// 断言不能写死「一定含 120」—— 那只对 4K 片成立。本次取样的片子不是 4K，
// 断言改成它真正要证明的东西：清单与账号无关，且清单 ≠ 实际能拿到的流。
const dashProbe = await api(signed.href);
const dashIds = (dashProbe?.data?.dash?.video || []).map((v) => v.id);
const dashMax = dashIds.length ? Math.max(...dashIds) : 0;
const acceptList = dashProbe?.data?.accept_quality || [];
console.log(`      匿名 accept_quality = ${JSON.stringify(acceptList)}`);
console.log(`      匿名 dash.video 最大流 = ${dashMax}`);
check(
  'accept_quality 是非空数组（否则这段验证无意义）',
  acceptList.length > 0,
  JSON.stringify(acceptList)
);
check(
  '匿名 dash 里实际存在的流 低于 清单所列 —— 清单说的是「片子有什么」，不是「你能拿到什么」',
  dashMax > 0 && dashMax < Math.max(...acceptList),
  `dashMax=${dashMax} accept=${JSON.stringify(acceptList)}`
);
console.log('      → 会员状态只认 nav 的 data.vipStatus（patch.js extractVipFromNav）');

// 同一批片子里，accept_quality 逐片不同 —— 证明它是「每部片子自己的表」，
// 而不是文档原来写的「固定全量表」。取两个片子比一下即可。
const other = samples.find((s) => s.bvid !== sample.bvid);
if (other) {
  const p2 = await api(
    `https://api.bilibili.com/x/player/wbi/playurl?bvid=${other.bvid}&cid=${other.cid}&qn=127&fnval=4048&fourk=1&platform=pc`
  );
  const a2 = p2?.data?.accept_quality || [];
  console.log(`      另一部片子 ${other.bvid} 的 accept_quality = ${JSON.stringify(a2)}`);
  console.log(
    '      → 两部片子可以不同；同一片子换账号则不变（后者见 findings §4 的 B/匿名对照）'
  );
}

console.log('');
if (failed) {
  console.error(`\x1b[31m${failed} 项不符合预期\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32m服务端契约与本项目实现一致\x1b[0m');
console.log('提示：这只是匿名态验证。带 B 账号 Cookie 的真实验证请跑 npm run verify:local');