/**
 * MD5（RFC 1321）—— 仅用于计算 wbi 签名的 w_rid。
 *
 * ⚠ 三个常量表（K / S / I）由 tools/gen-md5.mjs 生成，并已与 node:crypto 的 md5
 *   做过逐用例交叉验证。请不要手改；改动前先跑 `node tools/gen-md5.mjs`。
 */

/* eslint-disable no-bitwise */

const MD5_K = [
   -680876936,  -389564586,   606105819, -1044525330,  -176418897,  1200080426, -1473231341,   -45705983,
   1770035416, -1958414417,      -42063, -1990404162,  1804603682,   -40341101, -1502002290,  1236535329,
   -165796510, -1069501632,   643717713,  -373897302,  -701558691,    38016083,  -660478335,  -405537848,
    568446438, -1019803690,  -187363961,  1163531501, -1444681467,   -51403784,  1735328473, -1926607734,
      -378558, -2022574463,  1839030562,   -35309556, -1530992060,  1272893353,  -155497632, -1094730640,
    681279174,  -358537222,  -722521979,    76029189,  -640364487,  -421815835,   530742520,  -995338651,
   -198630844,  1126891415, -1416354905,   -57434055,  1700485571, -1894986606,    -1051523, -2054922799,
   1873313359,   -30611744, -1560198380,  1309151649,  -145523070, -1120210379,   718787259,  -343485551];

const MD5_S = [
            7,          12,          17,          22,           7,          12,          17,          22,
            7,          12,          17,          22,           7,          12,          17,          22,
            5,           9,          14,          20,           5,           9,          14,          20,
            5,           9,          14,          20,           5,           9,          14,          20,
            4,          11,          16,          23,           4,          11,          16,          23,
            4,          11,          16,          23,           4,          11,          16,          23,
            6,          10,          15,          21,           6,          10,          15,          21,
            6,          10,          15,          21,           6,          10,          15,          21];

const MD5_I = [
            0,           1,           2,           3,           4,           5,           6,           7,
            8,           9,          10,          11,          12,          13,          14,          15,
            1,           6,          11,           0,           5,          10,          15,           4,
            9,          14,           3,           8,          13,           2,           7,          12,
            5,           8,          11,          14,           1,           4,           7,          10,
           13,           0,           3,           6,           9,          12,          15,           2,
            0,           7,          14,           5,          12,           3,          10,           1,
            8,          15,           6,          13,           4,          11,           2,           9];

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
