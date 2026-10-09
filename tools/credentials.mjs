/**
 * 凭证加载 —— 刻意支持「纯文本」格式。
 *
 * 为什么不只支持 JSON：B 站 Cookie 里存在 bmg_af_sc={"none":...} 这类
 * 值内含双引号的字段，粘进 JSON 必然要转义，很容易出错且报错信息难懂。
 * 纯文本文件直接粘贴原始 Cookie，不需要任何转义。
 *
 * 查找顺序（先到先得）：
 *   1. 环境变量  BILI_COOKIE_B / BILI_A
 *   2. .verify.local.json   {"a": "...", "b": "..."}   （容错解析）
 *   3. credentials/B.txt    纯文本，一行一段
 *   4. credentials/A.txt
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 本文件位于 tools/ 下，项目根目录是上一级
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readText(p) {
  try {
    return fs.readFileSync(p, 'utf8').trim();
  } catch {
    return '';
  }
}

/**
 * 容错读 .verify.local.json：
 * 先试标准 JSON；失败则退化为「按顶层 "a"/"b" 的值抽取」。
 * 后者专门对付值里带未转义双引号的情况。
 */
function readJsonLenient(file) {
  const raw = readText(file);
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    if (j && (j.a || j.b)) return j;
  } catch {
    /* 落到容错分支 */
  }
  const out = {};
  for (const key of ['a', 'b']) {
    // 匹配 "key": "...." 到该行/结尾，取最长可能值
    const re = new RegExp('"' + key + '"\\s*:\\s*"(.*)', 's');
    const m = raw.match(re);
    if (m) {
      let v = m[1];
      // 去掉结尾多余的 '"' 或 '"}' 之类
      v = v.replace(/"\s*[,}]?\s*\}\s*$/s, '');
      v = v.replace(/"$/, '');
      if (v.length > 10) out[key] = v;
    }
  }
  return out.a || out.b ? out : null;
}

function readPlain(which) {
  for (const p of [
    path.join(ROOT, 'credentials', `${which}.txt`),
    path.join(ROOT, `.cookie-${which.toUpperCase()}.txt`),
    path.join(ROOT, `${which}-cookie.txt`)
  ]) {
    const t = readText(p);
    if (t) return t;
  }
  return '';
}

/**
 * 把任意来源的原文规范化成 Cookie 字符串。
 *
 * 支持三种：
 *   1. DevTools 表格 Ctrl+C 的 **12 列 TSV**（必须只取前两列，
 *      否则 Domain/Path/Expires 等 10 列会被拼进值里，粘到脚本上必然失效）
 *   2. `name=value; name=value` 的 Cookie 字符串
 *   3. Chrome 导出的 JSON（数组或 {cookies:[...]}）
 */
export function normalizeCookie(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const out = new Map();

  // 1) JSON
  if (raw[0] === '[' || raw[0] === '{') {
    try {
      const j = JSON.parse(raw);
      const arr = Array.isArray(j) ? j : j.cookies || [];
      for (const c of arr) if (c && c.name) out.set(c.name, String(c.value ?? ''));
    } catch {
      /* 不是 JSON，继续 */
    }
    if (out.size) return serialize(out);
  }

  const lines = raw.split(/\r?\n/).filter((l) => l.trim());

  // 2) TSV：只要有 tab 就按表格处理，取前两列
  if (lines.some((l) => l.includes('\t'))) {
    for (const line of lines) {
      if (!line.includes('\t')) continue;
      const cols = line.split('\t');
      const name = (cols[0] || '').trim();
      if (!name) continue;
      let value = (cols[1] ?? '').trim();
      if (value.length > 1 && value[0] === '"' && value[value.length - 1] === '"') {
        value = value.slice(1, -1).replace(/""/g, '"');
      }
      out.set(name, value);
    }
    if (out.size) return serialize(out);
  }

  // 3) Cookie 字符串
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      const k = part.slice(0, i).trim();
      if (k) out.set(k, part.slice(i + 1).trim());
    }
  }
  return serialize(out);
}

function serialize(map) {
  return [...map].map(([k, v]) => `${k}=${v}`).join('; ');
}

/** 返回 {a, b, source}；缺失的账号为 '' */
export function loadCredentials() {
  if (process.env.BILI_COOKIE_B || process.env.BILI_COOKIE_A) {
    return {
      a: normalizeCookie(process.env.BILI_COOKIE_A),
      b: normalizeCookie(process.env.BILI_COOKIE_B),
      source: '环境变量 BILI_COOKIE_A / BILI_COOKIE_B'
    };
  }
  const j = readJsonLenient(path.join(ROOT, '.verify.local.json'));
  if (j && (j.a || j.b)) {
    return { a: normalizeCookie(j.a), b: normalizeCookie(j.b), source: '.verify.local.json' };
  }
  const b = readPlain('b');
  const a = readPlain('a');
  if (a || b) return { a: normalizeCookie(a), b: normalizeCookie(b), source: 'credentials/*.txt' };
  return { a: '', b: '', source: '' };
}

/** 缺少凭证时打印可操作的指引 */
export function printCredentialHelp(which = 'B') {
  console.error(
    [
      '',
      `没找到 ${which} 账号的 Cookie。三种方式任选其一：`,
      '',
      '【推荐】纯文本文件 —— 直接粘贴，不用转义：',
      '   创建 credentials/B.txt，把 Cookie 原样粘进去保存即可。',
      '   （该目录已被 .gitignore 忽略，不会误提交）',
      '',
      '【或】.verify.local.json：',
      '   { "a": "A的cookie", "b": "B的cookie" }',
      '   注意 Cookie 里若有 bmg_af_sc={"..."} 这类含引号的字段，',
      '   放进 JSON 会被引号截断 —— 所以更推荐上面的纯文本方式。',
      '',
      '【或】环境变量：',
      '   PowerShell:  $env:BILI_COOKIE_B="..."',
      '',
      '获取方式：该账号页面 F12 → Application → Cookies →',
      '            https://www.bilibili.com → 全选复制。',
      ''
    ].join('\n')
  );
}