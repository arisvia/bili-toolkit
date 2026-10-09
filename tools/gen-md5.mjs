/**
 * 生成 src/core/md5.js 的常量表并做交叉验证。
 *
 *   node tools/gen-md5.mjs
 *
 * 为什么用脚本生成：MD5 的 64 个 T 常量（floor(2^32 * abs(sin(i)))、64 个移位量、
 * 64 个消息字索引）手抄极易出错，而错误只会表现为「w_rid 校验失败」这种极难排查的问题。
 * 生成后会立即与 node:crypto 的 md5 做逐用例比对，不一致则不写文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/core/md5.js');

const SHIFTS = [[7, 12, 17, 22], [5, 9, 14, 20], [4, 11, 16, 23], [6, 10, 15, 21]];
const ORDER = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [1, 6, 11, 0, 5, 10, 15, 4, 9, 14, 3, 8, 13, 2, 7, 12],
  [5, 8, 11, 14, 1, 4, 7, 10, 13, 0, 3, 6, 9, 12, 15, 2],
  [0, 7, 14, 5, 12, 3, 10, 1, 8, 15, 6, 13, 4, 11, 2, 9]
];

const K = [];
const S = [];
const I = [];
for (let i = 0; i < 64; i++) {
  const r = Math.floor(i / 16);
  let t = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
  if (t > 2147483647) t -= 4294967296;
  K.push(t);
  S.push(SHIFTS[r][i % 4]);
  I.push(ORDER[r][i % 16]);
}

function formatTable(arr) {
  const rows = [];
  for (let i = 0; i < arr.length; i += 8) {
    rows.push('  ' + arr.slice(i, i + 8).map((v) => String(v).padStart(11)).join(', '));
  }
  return '[\n' + rows.join(',\n') + ']';
}

const source = `/**
 * MD5（RFC 1321）—— 仅用于计算 wbi 签名的 w_rid。
 *
 * ⚠ 三个常量表（K / S / I）由 tools/gen-md5.mjs 生成，并已与 node:crypto 的 md5
 *   做过逐用例交叉验证。请不要手改；改动前先跑 \`node tools/gen-md5.mjs\`。
 */

/* eslint-disable no-bitwise */

const MD5_K = ${formatTable(K)};

const MD5_S = ${formatTable(S)};

const MD5_I = ${formatTable(I)};

/** 字符串 -> UTF-8 字节数组 */
function utf8Bytes(str) {
  const bin = [];
  for (let i = 0; i < str.length; i++) {
    let cp = str.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < str.length) {
      const lo = str.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
        i++;
      }
    }
    if (cp < 0x80) {
      bin.push(cp);
    } else if (cp < 0x800) {
      bin.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      bin.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      bin.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
  }
  return bin;
}

/** 小端读取分组里的第 j 个 32 位字 */
function word(bin, off, j) {
  const p = off + j * 4;
  return (bin[p] | (bin[p + 1] << 8) | (bin[p + 2] << 16) | (bin[p + 3] << 24)) | 0;
}

export function md5(input) {
  const bin = utf8Bytes(String(input));
  const bits = bin.length * 8;
  bin.push(0x80);
  while (bin.length % 64 !== 56) bin.push(0);
  for (let i = 0; i < 8; i++) bin.push(Math.floor(bits / Math.pow(2, 8 * i)) & 0xff);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;

  for (let off = 0; off < bin.length; off += 64) {
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    for (let j = 0; j < 64; j++) {
      let f;
      if (j < 16) f = (b & c) | (~b & d);
      else if (j < 32) f = (d & b) | (~d & c);
      else if (j < 48) f = b ^ c ^ d;
      else f = c ^ (b | ~d);
      const s = (a + f + word(bin, off, MD5_I[j]) + MD5_K[j]) | 0;
      const t = (((s << MD5_S[j]) | (s >>> (32 - MD5_S[j]))) + b) | 0;
      a = d;
      d = c;
      c = b;
      b = t;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
  }

  const le = (n) => {
    let out = '';
    for (let i = 0; i < 4; i++) out += ('0' + ((n >>> (i * 8)) & 0xff).toString(16)).slice(-2);
    return out;
  };
  return le(h0) + le(h1) + le(h2) + le(h3);
}
`;

// ---- 自检：生成后立即与 node:crypto 比对 ----
const mod = await import('data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64'));
const cases = [
  '', 'a', 'abc', 'message digest',
  'The quick brown fox jumps over the lazy dog',
  'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(65), 'x'.repeat(119), 'x'.repeat(1000),
  '中文与 emoji 🎬 混排',
  'mid=12345&qn=127&fnval=4048&wts=1700000000'
];
let bad = 0;
for (const c of cases) {
  const mine = mod.md5(c);
  const ref = crypto.createHash('md5').update(c, 'utf8').digest('hex');
  if (mine !== ref) {
    bad++;
    console.error(`✖ md5 不一致 (len=${c.length}) ${mine} != ${ref}`);
  }
}
if (bad) {
  console.error('md5 自检失败，未写入文件');
  process.exit(1);
}

fs.writeFileSync(OUT, source, 'utf8');
console.log(`✔ md5 自检通过（${cases.length} 个用例），已写入 src/core/md5.js`);