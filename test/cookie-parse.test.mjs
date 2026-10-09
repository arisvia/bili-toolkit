/** cookie-parse 的单元测试（Node 侧，不需要浏览器） */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  \x1b[32m✔\x1b[0m ${name}`);
  else { failed++; console.error(`  \x1b[31m✖\x1b[0m ${name}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`); }
}

const res = await esbuild.build({
  entryPoints: [path.join(ROOT, 'src/core/cookie-parse.js')],
  bundle: true, format: 'esm', write: false, platform: 'neutral', target: 'es2022', logLevel: 'silent'
});
const M = await import('data:text/javascript;base64,' + Buffer.from(res.outputFiles[0].text, 'utf8').toString('base64'));
const { parseCookieText, pickFields, joinCookie, sortFields, tierOf } = M;

console.log('\n[1] DevTools 12 列 TSV');
{
  // 复刻真实结构：Name⇥Value⇥Domain⇥Path⇥Expires⇥Size⇥HTTPOnly⇥Secure⇥SameSite⇥Priority⇥PartitionKey
  const sess = 'A'.repeat(222);
  const tsv = [
    `CURRENT_FNVAL\t4048\t.bilibili.com\t/\t2027-10-09T07:28:33.000Z\t17\t\t\t\t\t\tMedium`,
    `SESSDATA\t${sess}\t.bilibili.com\t/\t2027-10-09T05:56:45.000Z\t225\t✓\t✓\tNone\t\t\tMedium`,
    `bili_jct\t${'b'.repeat(32)}\t.bilibili.com\t/\t2027-10-09T05:56:45.000Z\t35\t\t✓\tNone\t\t\tMedium`,
    `buvid3\t${'c'.repeat(46)}\t.bilibili.com\t/\t2026-04-06T02:48:35.000Z\t49\t\t\t\t\t\tMedium`
  ].join('\n');
  const { fields, format } = parseCookieText(tsv);
  check('识别为多列表格', format.includes('多列') || format.includes('12'), format);
  check('SESSDATA 值完整且未被其它列污染', fields.SESSDATA === sess, { got: fields.SESSDATA?.length, want: 222 });
  check('bili_jct 正确', fields.bili_jct === 'b'.repeat(32));
  check('只解析出 4 个字段（没有把列名当 cookie）', Object.keys(fields).length === 4, Object.keys(fields));
  check('分级正确', tierOf('SESSDATA').tier === 'required' && tierOf('bili_jct').tier === 'ogv');
}

console.log('\n[2] Cookie 字符串（含 ; 和引号的字段）');
{
  const s =
    'SESSDATA=abc123; bili_jct=csrf456; buvid3=dev789; ' +
    'bmg_af_sc={"none":{"on":1,"def":"i1.hdslb.com"},"sgp":{"on":1}}; ' +
    'DedeUserID=42; sid=SID_SHOULD_EXCLUDE';
  const { fields } = parseCookieText(s);
  check('SESSDATA 正确', fields.SESSDATA === 'abc123');
  check('bili_jct 正确', fields.bili_jct === 'csrf456');
  check('buvid3 正确', fields.buvid3 === 'dev789');
  check('DedeUserID 正确（bmg_af_sc 里的 ; 没把它切断）', fields.DedeUserID === '42', fields.DedeUserID);
  check('bmg_af_sc 完整保留（含引号与花括号）', (fields.bmg_af_sc || '').includes('i1-sgp') || (fields.bmg_af_sc || '').startsWith('{"none"'), fields.bmg_af_sc);
  check('sid 也在（解析层不丢弃，由 preset 决定）', fields.sid === 'SID_SHOULD_EXCLUDE');
}

console.log('\n[3] Chrome 导出的 JSON');
{
  const json = JSON.stringify([
    { name: 'SESSDATA', value: 'json-sess' },
    { name: 'bili_jct', value: 'json-jct' }
  ]);
  const { fields, format } = parseCookieText(json);
  check('识别为 JSON', format.includes('JSON'), format);
  check('SESSDATA 正确', fields.SESSDATA === 'json-sess');
  check('bili_jct 正确', fields.bili_jct === 'json-jct');
}

console.log('\n[4] 预设挑选');
{
  const fields = {
    SESSDATA: '1', bili_jct: '2', DedeUserID: '3', buvid3: '4',
    sid: '5', bmg_af_sc: '6', rpdid: '7'
  };
  const min = pickFields(fields, 'min');
  const rec = pickFields(fields, 'recommended');
  const all = pickFields(fields, 'all');
  check('min 只含 SESSDATA + bili_jct', min.length === 2 && min.includes('SESSDATA') && min.includes('bili_jct'), min);
  check('recommended 含防风控字段', rec.includes('buvid3') && rec.includes('DedeUserID'), rec);
  check('recommended 不含 bmg_af_sc', !rec.includes('bmg_af_sc'));
  check('all 剔除 sid', !all.includes('sid'), all);
  check('all 保留其它全部', all.includes('bmg_af_sc') && all.includes('rpdid'));
  check('min 缺 bili-jct 变体也算', pickFields({ SESSDATA: '1', 'bili-jct': '2' }, 'min').length === 2);

  const out = joinCookie(fields, min);
  check('joinCookie 输出正确', out === 'SESSDATA=1; bili_jct=2', out);
  check('joinCookie 跳过不存在的键', joinCookie({ SESSDATA: '1' }, ['SESSDATA', 'nope']) === 'SESSDATA=1');
}

console.log('\n[5] 排序');
{
  const sorted = sortFields(['rpdid', 'bili_jct', 'buvid3', 'SESSDATA', 'sid']);
  check('必需排最前', sorted[0] === 'SESSDATA', sorted);
  check('番剧/别混用 紧随其后', sorted[1] === 'bili_jct' || sorted[1] === 'sid', sorted);
  check('可选排最后', sorted[sorted.length - 1] === 'rpdid', sorted);
}

console.log('\n[6] 空输入不炸');
{
  for (const v of ['', null, undefined, '   ', 'garbage']) {
    const { fields } = parseCookieText(v);
    check(`输入 ${JSON.stringify(v)} 安全返回`, typeof fields === 'object');
  }
  check('garbage 的 format 标记为无法识别', parseCookieText('garbage').format === '无法识别');
  check('joinCookie 空输入', joinCookie({}, []) === '');
  check('pickFields 空输入', pickFields({}, 'min').length === 0);
}

console.log('');
if (failed) { console.error(`\x1b[31m${failed} 项失败\x1b[0m`); process.exit(1); }
console.log('\x1b[32m全部通过\x1b[0m');