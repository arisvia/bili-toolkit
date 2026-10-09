/**
 * 用真实 B 账号 Cookie 做端到端验证，并实测各字段的真实作用。
 *
 *   node tools/verify-cookie.mjs
 *
 * 不打印任何 Cookie 值 —— 只输出字段是否存在、以及删掉之后接口的表现。
 *
 * 注意（这里曾经踩过的坑）：
 *   画质探测必须显式传 qn。之前写成 probe(cookie, label)，qn 永远是默认值 127，
 *   于是「qn=32」和「qn=127」两行输出一模一样，差点得出「抬高 qn 无效」的错误结论。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { loadCredentials, printCredentialHelp } from './credentials.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadWbi() {
  const res = await esbuild.build({
    entryPoints: [path.join(ROOT, 'src/core/wbi.js')],
    bundle: true, format: 'esm', write: false, platform: 'neutral', target: 'es2022', logLevel: 'silent'
  });
  return import('data:text/javascript;base64,' + Buffer.from(res.outputFiles[0].text, 'utf8').toString('base64'));
}

/** 只按第一个 = 切分，值里含 = 或 {} 都不影响 */
const parse = (s) => {
  const o = {};
  for (const seg of String(s).split(';')) {
    const i = seg.indexOf('=');
    if (i > 0) {
      const k = seg.slice(0, i).trim();
      if (k) o[k] = seg.slice(i + 1).trim();
    }
  }
  return o;
};
const ser = (o) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join('; ');

const H = {
  Referer: 'https://www.bilibili.com/',
  Origin: 'https://www.bilibili.com',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
};

async function req(url, cookie, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...H, ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) } });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { code: 'non-json', raw: t.slice(0, 100) }; }
}

const QN = { 6:'240P',16:'360P',32:'480P',64:'720P',74:'720P60',80:'1080P',112:'1080P+',116:'1080P60',120:'4K',125:'HDR',126:'杜比',127:'8K' };
const q = (x) => (x === undefined || x === null ? '—' : `${x}/${QN[x] || '?'}`);

/* ---------------- 加载 ---------------- */
const cred = loadCredentials();
if (!cred.b) printCredentialHelp('B');
const B = String(cred.b).replace(/[\r\n]+/g, '; ').replace(/;\s*;/g, '; ').trim();
const fields = parse(B);

console.log(`凭证来源：${cred.source}`);
console.log(`解析出 ${Object.keys(fields).length} 个字段：`);
console.log('  ' + Object.keys(fields).sort().join(', '));

console.log('\n关键字段检查：');
for (const k of ['SESSDATA', 'bili_jct', 'DedeUserID', 'buvid3', 'buvid4', 'bili_ticket', 'b_lsid', 'b_nut', 'buvid_fp']) {
  console.log(`  ${k.padEnd(16)} ${k in fields ? '有' : '缺'}`);
}

/* ---------------- 身份 ---------------- */
console.log('\n【1】身份与会员状态');
const nav = await req('https://api.bilibili.com/x/web-interface/nav', B);
if (!nav || nav.code !== 0) { console.error(`\n✖ nav 失败 code=${nav && nav.code} —— Cookie 无效或已过期`); process.exit(1); }
const mask = (m) => String(m).replace(/^(\d{2})\d+(\d{2})$/, '$1****$2');
console.log(`  登录成功：${nav.data.uname}  mid=${mask(nav.data.mid)}`);
console.log(`  会员：vipStatus=${nav.data.vipStatus} vipType=${nav.data.vipType} ⇒ ${nav.data.vipStatus === 1 ? '大会员 ✅' : '非大会员 ❌'}`);

const { signUrl, extractWbiKeys } = await loadWbi();
const keys = extractWbiKeys(nav);
console.log(`  wbi 密钥：${keys ? '可用' : '不可用'}`);

/* ---------------- 样本 ---------------- */
console.log('\n【2】样本视频（选含 4K 的）');
const pop = await req('https://api.bilibili.com/x/web-interface/popular?ps=20&pn=1', B);
let S = null;
for (const v of pop.data.list) {
  const pu = await req(`https://api.bilibili.com/x/player/wbi/playurl?bvid=${v.bvid}&cid=${v.cid}&qn=127&fnver=0&fnval=4048&fourk=1&otype=json`, B);
  if ((pu.data && pu.data.support_formats || []).some((f) => f.quality >= 120)) { S = { bvid: v.bvid, cid: v.cid, title: v.title }; break; }
}
if (!S) { console.error('  ✖ 热门里没有含 4K 的视频'); process.exit(2); }
console.log(`  ${S.bvid}  ${S.title.slice(0, 34)}`);

const playUrl = (qn) =>
  signUrl(
    new URL(`https://api.bilibili.com/x/player/wbi/playurl?bvid=${S.bvid}&cid=${S.cid}&qn=${qn}&fnver=0&fnval=4048&fourk=1&otype=json&platform=pc`),
    keys.mixinKey
  ).href;

/** @param {string|null} cookie @param {number} qn —— qn 必须显式传 */
async function probe(cookie, qn) {
  const r = await req(playUrl(qn), cookie);
  if (!r || r.code !== 0) return { ok: false, code: (r && r.code) ?? 'x' };
  const d = r.data || {};
  const fmts = (d.support_formats || []).map((f) => f.quality).sort((a, b) => b - a);
  const streams = (d.dash && d.dash.video || []).map((v) => v.id);
  return {
    ok: true,
    quality: d.quality,
    maxFmt: fmts[0] ?? null,
    fmtCount: fmts.length,
    maxStream: streams.length ? Math.max(...streams) : null
  };
}

/* ---------------- qn 扫描 ---------------- */
console.log('\n【3】B 账号扫 qn（确认 qn 是否真的是协商上限）');
console.log('   请求qn   返回quality   最高可选   dash里最大流');
const scan = {};
for (const n of [16, 32, 64, 80, 116, 127]) {
  await sleep(450);
  const r = await probe(B, n);
  scan[n] = r;
  console.log(`   ${String(n).padEnd(7)} ${String(r.ok ? r.quality : r.code).padEnd(12)} ${q(r.maxFmt).padEnd(10)} ${q(r.maxStream)}`);
}

console.log('\n【4】核心对照（这次 qn 真的不同了）');
await sleep(450);
const anon127 = await probe(null, 127);
await sleep(450);
const b32 = await probe(B, 32);
await sleep(450);
const b127 = await probe(B, 127);
console.log(`  匿名  qn=127   quality=${q(anon127.ok ? anon127.quality : null)}  dash最大流=${q(anon127.maxStream)}`);
console.log(`  B    qn=32    quality=${q(b32.quality)}  dash最大流=${q(b32.maxStream)}   ← 旧脚本的效果`);
console.log(`  B    qn=127   quality=${q(b127.quality)}  dash最大流=${q(b127.maxStream)}   ← 本脚本的效果`);
console.log(`\n  ⇒ 结论：`);
console.log(`     权益来自 Cookie —— 匿名 dash 里最大流只有 ${q(anon127.maxStream)}，B 是 ${q(b127.maxStream)}`);
console.log(`     档位来自 qn    —— 同样是 B，qn=32 播放器只播 ${q(b32.quality)}，qn=127 才播 ${q(b127.quality)}`);
console.log(`     ${b127.quality > b32.quality ? '✔ 抬高 qn 确实换来了更高画质（两个条件缺一不可）' : '⚠ 本样本抬 qn 未提升，可能已到该视频上限'}`);

/* ---------------- 字段消融 ---------------- */
console.log('\n【5】逐个删字段实测（固定 qn=127，只说影响，不打印值）');
const order = [
  'SESSDATA', 'bili_jct', 'DedeUserID', 'buvid3', 'buvid4', 'bili_ticket', 'bili_ticket_expires',
  'b_lsid', 'b_nut', 'buvid_fp', '_uuid', 'DedeUserID__ckMd5',
  'bmg_af_sc', 'bmg_af_switch', 'bmg_src_def_domain', 'browser_resolution', 'CURRENT_FNVAL', 'home_feed_column'
];
for (const f of order) {
  if (!(f in fields)) { console.log(`  删 ${f.padEnd(22)} —（你的 Cookie 里没有）`); continue; }
  const clone = { ...fields };
  delete clone[f];
  await sleep(450);
  const r = await probe(ser(clone), 127);
  let v;
  if (!r.ok) v = `✖ 失败 code=${r.code}`;
  else if (r.quality !== b127.quality) v = `↓ 画质 ${q(b127.quality)} → ${q(r.quality)}`;
  else if (r.maxStream !== b127.maxStream) v = `↓ dash最大流 ${q(b127.maxStream)} → ${q(r.maxStream)}`;
  else if (r.fmtCount !== b127.fmtCount) v = `↓ 档位数 ${b127.fmtCount} → ${r.fmtCount}`;
  else v = '· 无影响';
  console.log(`  删 ${f.padEnd(22)} ${v}`);
}

/* ---------------- 最小集 ---------------- */
console.log('\n【6】最小可用组合（同样固定 qn=127）');
const sets = [
  ['SESSDATA'],
  ['SESSDATA', 'DedeUserID'],
  ['SESSDATA', 'DedeUserID', 'bili_jct'],
  ['SESSDATA', 'DedeUserID', 'bili_jct', 'buvid3'],
  ['SESSDATA', 'DedeUserID', 'bili_jct', 'buvid3', 'buvid4', 'bili_ticket']
];
for (const set of sets) {
  const missing = set.filter((k) => !(k in fields));
  if (missing.length) { console.log(`  ${set.join(' + ').padEnd(60)} 跳过（缺 ${missing.join(',')}）`); continue; }
  await sleep(450);
  const r = await probe(ser(Object.fromEntries(set.map((k) => [k, fields[k]]))), 127);
  console.log(`  ${set.join(' + ').padEnd(60)} ${r.ok ? `quality=${q(r.quality)} dash最大流=${q(r.maxStream)} 档位=${r.fmtCount}` : `✖ code=${r.code}`}`);
}

console.log('\n────────────────────────────────────────');
console.log('判读：✖失败=该接口必需；↓下降=影响权益或风控；·无影响=本次测不出差别');
console.log('注意：消融只覆盖了普通视频的 playurl（GET）。');
console.log('      番剧 playview 是 POST + csrf，bili_jct 的作用要在那里才测得到，');
console.log('      反爬字段也只在真正触发风控时才显形 —— 所以「无影响」≠「可以省」。');