/**
 * 带真实 Cookie 的验证 —— 在你自己的机器上跑，Cookie 不会离开本机。
 *
 *   npm run verify:local -- --bvid=BV1xxxxxxxx
 *
 * Cookie 来源（按优先级）：
 *   1. 环境变量 BILI_A / BILI_B
 *   2. 项目根目录的 .verify.local.json（已在 .gitignore 中）
 *
 * 输出会自动脱敏（不打印任何 Cookie、mid 打码），你可以把结果贴给别人看。
 *
 * 它要回答的问题只有三个：
 *   Q1  A（非会员）按页面原始参数请求 → 能拿到什么画质？
 *   Q2  B（大会员）按**同样的**参数请求 → 能拿到什么画质？   （= 旧脚本的效果上限）
 *   Q3  B + 本项目的参数抬高与重签     → 能拿到什么画质？   （= 新脚本的效果）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { loadCredentials, printCredentialHelp } from './credentials.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------- 参数 ----------------
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const RAW_BVID = arg('bvid', '');
const RAW_EPID = arg('epid', '');
const SHOW_MID = argv.includes('--show-mid');

// ---------------- 加载 Cookie ----------------
// 统一走 credentials.mjs：它同时认 DevTools 的 12 列 TSV、Cookie 字符串和 JSON，
// 这样用户把 DevTools 原始复制内容直接存成 .txt 就能用，不必手工拼。
// 注意：必须在 clean/parse 定义之后再取（它们是 const，有 TDZ）。
const cred = loadCredentials();

// ---------------- 工具 ----------------
async function loadWbi() {
  const res = await esbuild.build({
    entryPoints: [path.join(ROOT, 'src/core/wbi.js')],
    bundle: true, format: 'esm', write: false, platform: 'neutral', target: 'es2022', logLevel: 'silent'
  });
  return import('data:text/javascript;base64,' + Buffer.from(res.outputFiles[0].text, 'utf8').toString('base64'));
}

const parse = (s) => {
  const o = {};
  for (const p of String(s).split(';')) {
    const i = p.indexOf('=');
    if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  }
  return o;
};
const clean = (s) => String(s).replace(/[\r\n]+/g, '; ').trim();
const maskMid = (m) => (SHOW_MID ? String(m) : String(m).replace(/^(\d{2})\d+(\d{2})$/, '$1****$2'));

const H = {
  Referer: 'https://www.bilibili.com/',
  Origin: 'https://www.bilibili.com',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
};

function withCookie(cookie) {
  return { ...H, Cookie: cookie };
}

async function req(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: opts.cookie ? withCookie(opts.cookie) : H });
  const text = await r.text();
  try {
    return { code: 'http' + r.status, json: JSON.parse(text) };
  } catch {
    return { code: 'non-json', raw: text.slice(0, 120) };
  }
}

const QUALITY_NAME = {
  6: '240P', 16: '360P', 32: '480P', 64: '720P', 74: '720P60', 80: '1080P',
  112: '1080P+', 116: '1080P60', 120: '4K', 125: 'HDR', 126: '杜比视界', 127: '8K'
};
const qName = (q) => (q === undefined || q === null ? '—' : `${q} (${QUALITY_NAME[q] || '?'})`);

function describePlayurl(j) {
  const d = j && j.data;
  if (!d) return { quality: null, dash: 0, accept: null, formats: null, note: `code=${j.code}` };
  return {
    quality: d.quality,
    dash: d.dash?.video?.length || 0,
    audio: d.dash?.audio?.length || 0,
    durl: d.durl?.length || 0,
    accept: d.accept_quality,
    formats: (d.support_formats || []).map((f) => f.quality),
    vip: d.vip ? `${d.vip.status}/${d.vip.type}` : undefined
  };
}

function line(label, r) {
  return `  ${label.padEnd(34)} ${r}`;
}

// ---------------- 主流程 ----------------

const { signUrl, extractWbiKeys } = await loadWbi();

if (!cred.a || !cred.b) {
  if (!cred.a && !cred.b) printCredentialHelp('A / B');
  else printCredentialHelp(cred.a ? 'B' : 'A');
}
const cookieA = clean(cred.a);
const cookieB = clean(cred.b);

console.log(`Cookie 来源：${cred.source}`);
const pa = parse(cookieA);
const pb = parse(cookieB);
const mark = (v) => (v ? '有' : '缺');
console.log(`A 字段：${Object.keys(pa).length} 项  SESSDATA ${mark(pa.SESSDATA)}｜bili_jct ${mark(pa.bili_jct)}｜DedeUserID ${mark(pa.DedeUserID)}｜buvid3 ${mark(pa.buvid3)}`);
console.log(`B 字段：${Object.keys(pb).length} 项  SESSDATA ${mark(pb.SESSDATA)}｜bili_jct ${mark(pb.bili_jct)}｜DedeUserID ${mark(pb.DedeUserID)}｜buvid3 ${mark(pb.buvid3)}`);

const warnB = [];
if (!pb.DedeUserID) warnB.push('DedeUserID 缺失');
if (!pb.buvid3 && !pb.buvid4) warnB.push('buvid3/buvid4 缺失（可能 -412）');
if (!pb.bili_jct) warnB.push('bili_jct 缺失（番剧 OGV 会失败）');
if (warnB.length) console.log(`  ⚠ B 建议补齐：${warnB.join('、')} —— 跑 npm run probe:cookie 可实测各字段作用`);
if (pa.SESSDATA === pb.SESSDATA) {
  console.error('\n✖ A 和 B 的 SESSDATA 相同，请确认贴的是两个不同账号。\n');
  process.exit(2);
}

console.log('\n[1] 身份与会员状态');
const navA = (await req('https://api.bilibili.com/x/web-interface/nav', { cookie: cookieA })).json;
const navB = (await req('https://api.bilibili.com/x/web-interface/nav', { cookie: cookieB })).json;
if (!navA || navA.code !== 0 || !navA.data?.isLogin) { console.error('✖ A 的 Cookie 无效（nav 未登录）'); process.exit(2); }
if (!navB || navB.code !== 0 || !navB.data?.isLogin) { console.error('✖ B 的 Cookie 无效（nav 未登录）'); process.exit(2); }
const vipText = (d) => (d.vipStatus === 1 ? `大会员(${d.vipType === 1 ? '月度' : d.vipType === 2 ? '年度' : '?'})` : '非会员');
console.log(line('A', `${navA.data.uname}  mid=${maskMid(navA.data.mid)}  ${vipText(navA.data)}`));
console.log(line('B', `${navB.data.uname}  mid=${maskMid(navB.data.mid)}  ${vipText(navB.data)}`));
if (navB.data.vipStatus !== 1) console.error('  ⚠ B 不是大会员，下面的画质对比不会体现差异（脚本无法凭空造权益）');

const keys = extractWbiKeys(navB) || extractWbiKeys(navA);
if (!keys) { console.error('✖ 拿不到 wbi 密钥'); process.exit(2); }
console.log(line('wbi mixinKey', keys.mixinKey));

console.log('\n[2] 选一个测试视频');
let bvid = RAW_BVID;
let cid = null;
if (!bvid) {
  const popular = (await req('https://api.bilibili.com/x/web-interface/popular?ps=5&pn=1')).json;
  bvid = popular.data.list[0].bvid;
}
const view = (await req(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, { cookie: cookieA })).json;
if (view.code !== 0) { console.error('✖ 视频不存在：' + view.message); process.exit(2); }
cid = view.data.cid;
console.log(line('bvid / cid', `${bvid} / ${cid}`));
console.log(line('标题', (view.data.title || '').slice(0, 40)));
const dur = view.data.duration;
console.log(line('时长', `${Math.floor(dur / 60)}分${dur % 60}秒`));

const buildUrl = (qn) =>
  `https://api.bilibili.com/x/player/wbi/playurl?bvid=${bvid}&cid=${cid}` +
  `&qn=${qn}&fnver=0&fnval=4048&fourk=1&otype=json&platform=pc`;

console.log('\n[3] 三个关键对照（这是本项目的核心验证）');
const rA = (await req(buildUrl(32), { cookie: cookieA })).json;
console.log(line('Q1  A + 页面原始参数(qn=32)', JSON.stringify(describePlayurl(rA).quality) + '  ← 旧脚本之前拿到的就是这种'));

const rB = (await req(buildUrl(32), { cookie: cookieB })).json;
const bLow = describePlayurl(rB);
console.log(line('Q2  B + 同样参数(qn=32)', `${bLow.quality}` + '  ← 旧脚本的效果上限'));

const signedUrl = signUrl(new URL(buildUrl(127)), keys.mixinKey);
const rB2 = (await req(signedUrl.href, { cookie: cookieB })).json;
const bUp = describePlayurl(rB2);
console.log(line('Q3  B + 抬高参数+重签(qn=127)', `${bUp.quality}` + '  ← 新脚本的效果'));

console.log('\n[4] 画质清单（决定播放器下拉菜单里出现什么）');
console.log(line('Q3 的 accept_quality', JSON.stringify(bUp.accept)));
console.log(line('Q3 的 support_formats', JSON.stringify(bUp.formats)));
console.log(line('Q3 音视频流数量', `dash video=${bUp.dash} audio=${bUp.audio}`));

console.log('\n[5] 校验我们把 /x/player/wbi/v2 移出代理的决定');
const v2B = (await req(`https://api.bilibili.com/x/player/wbi/v2?bvid=${bvid}&cid=${cid}`, { cookie: cookieB })).json;
const acceptKeys = Object.keys(v2B.data || {}).filter((k) => k.startsWith('accept'));
console.log(line('登录态下 v2 的 accept_* 字段', acceptKeys.length ? acceptKeys.join(',') : '（仍然没有）'));
console.log('  ⇒ ' + (acceptKeys.length
  ? '登录态下确实存在 accept_*，需要把 v2 改回 merge 模式'
  : '确认 accept_* 只在 playurl 里，本地伪装即可，不必多发一次请求'));

console.log('\n[6] 参数抬高是否会引入副作用（对比 Q2/Q3 的流数量）');
if (bUp.dash > bLow.dash || bUp.quality > bLow.quality) {
  console.log('  ✔ 抬高参数确实带来了更高画质/更多码流');
} else {
  console.log('  ⚠ 没有提升。可能原因：B 的权益对该视频无效 / 该视频最高只有 480P / 参数被服务端忽略');
}

if (RAW_EPID) {
  console.log('\n[7] 番剧 OGV 验证');
  const csrf = pb.bili_jct || pb['bili-jct'];
  if (!csrf) {
    console.log('  ⚠ B 的 Cookie 里没有 bili_jct，跳过（番剧解锁必需）');
  } else {
    const url =
      `https://api.bilibili.com/ogv/player/playview?ep_id=${RAW_EPID}&qn=127&fnver=0&fnval=4048&fourk=1&otype=json&csrf=${csrf}`;
    const ogv = (await req(url, {
      cookie: cookieB,
      method: 'POST',
      headers: { ...H, Cookie: cookieB, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ep_id: Number(RAW_EPID), csrf, business: 'play' })
    })).json;
    const vi = ogv.data?.video_info;
    console.log(line('playview code', ogv.code + ' ' + (ogv.message || '')));
    if (vi) console.log(line('video_info.quality', vi.quality));
    if (vi) console.log(line('durl / dash', `${vi.durl?.length || 0} / ${vi.dash?.video?.length || 0}`));
    if (ogv.code === 0 && vi?.quality) console.log('  ✔ 番剧播放地址可用（csrf 替换 + 参数抬高生效）');
  }
}

console.log('\n────────────────────────────────────────');
console.log('判定标准：Q3 > Q2  ⇒  参数抬高确实是关键（与本项目的设计一致）');
console.log('           Q3 ≥ 120 ⇒ B 的大会员权益已通过本项目的链路取到');
console.log('若两者都不满足，请把这段输出贴出来（已脱敏，可安全分享）。');
console.log('');