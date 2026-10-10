/**
 * 构建脚本：src/ (ESM)  ->  dist/bili-toolkit.user.js (单文件 userscript)
 *
 *   node build.mjs              生产构建（压缩）
 *   node build.mjs --dev        开发构建（不压缩、带日志）
 *   node build.mjs --watch      监听重建
 *   node build.mjs --check      只做静态检查，不产出文件
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import {
  VERSION,
  NAME,
  NAME_EN,
  NS,
  DESCRIPTION,
  DESCRIPTION_EN,
  AUTHOR,
  LICENSE,
  HOMEPAGE,
  ISSUES,
  ICON
} from './src/meta.js';
import { ENDPOINTS, LOCAL_PATCH_PATHS } from './src/core/endpoints.js';

export const meta = `// ==UserScript==
// @name         ${NAME}
// @name:en      ${NAME_EN}
// @namespace    ${NS}
// @version      ${VERSION}
// @description  ${DESCRIPTION}
// @description:en  ${DESCRIPTION_EN}
// @author       ${AUTHOR}
// @license      ${LICENSE}
// @icon         ${ICON}
// @homepageURL  ${HOMEPAGE}
// @supportURL   ${ISSUES}
// @match        *://*.bilibili.com/*
// @exclude      *://api.bilibili.com/*
// @exclude      *://api.live.bilibili.com/*
// @exclude      *://passport.bilibili.com/*
// @run-at       document-start
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @grant        GM_setCookie
// @grant        GM.cookie
// @connect      api.bilibili.com
// @connect      api.live.bilibili.com
// @connect      passport.bilibili.com
// @connect      www.bilibili.com
// ==/UserScript==
`;

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HOOK_ENTRY = path.resolve(ROOT, 'src/injected/hook.js');
const ENTRY = path.resolve(ROOT, 'src/index.js');
const OUTFILE = path.resolve(ROOT, 'dist/bili-toolkit.user.js');

const argv = process.argv.slice(2);
const DEV = argv.includes('--dev');
const WATCH = argv.includes('--watch');
const CHECK_ONLY = argv.includes('--check');

/* ------------------------------------------------------------------ *
 * 静态检查：构建前把「装不上去 / 一定失效」的错误挡在前面
 * ------------------------------------------------------------------ */
function fail(msg) {
  console.error('\x1b[31m✖ ' + msg + '\x1b[0m');
  process.exitCode = 1;
  throw new Error(msg);
}

function checkHookSource(src) {
  const placeholders = ['__BILI_VIP_CFG__'];
  for (const p of placeholders) {
    const n = src.split(p).length - 1;
    if (n !== 1) fail(`src/injected/hook.js 中占位符 ${p} 必须出现且只出现 1 次，实际 ${n} 次`);
  }
  // 用 textContent 注入，不受 </script> 影响；但仍提示避免误用 innerHTML
  if (/\bdocument\.write\b/.test(src)) fail('主世界钩子禁止使用 document.write');
  if (!/window\.fetch\s*=/.test(src)) fail('主世界钩子缺少 fetch 拦截');
  if (!/XMLHttpRequest\.prototype\.send\s*=/.test(src)) fail('主世界钩子缺少 XHR 拦截');
}

function checkMeta() {
  const required = ['@name', '@version', '@match', '@run-at', '@grant', '@connect', '@icon'];
  for (const k of required) {
    if (!meta.includes('// ' + k)) fail(`meta 缺少 // ${k}`);
  }
  if (!meta.includes('@version      ' + VERSION)) fail('meta 的 @version 与 meta.js 的 VERSION 不一致');
  if (!meta.includes('// @run-at       document-start')) {
    fail('必须 @run-at document-start，否则抢不到播放器的首个 playurl 请求');
  }
  // 名称/说明会出现在管理器的列表里，直接影响可读性 —— 卡一下长度与冗余
  const name = (meta.match(/\/\/ @name\s+(.+)/) || [])[1] || '';
  const desc = (meta.match(/\/\/ @description\s+(.+)/) || [])[1] || '';
  if (name.length > 30) fail(`@name 过长（${name.length} 字），列表里会溢出：${name}`);
  if (desc.length > 160) fail(`@description 过长（${desc.length} 字）：${desc}`);
  for (const bad of ['第一', '专用', '双账号助手', '仅供']) {
    if (name.includes(bad) || desc.includes(bad)) fail(`名称/说明里残留了实现细节或绝对化表述：${bad}`);
  }
}

function checkEndpoints() {
  const seen = new Set();
  for (const ep of ENDPOINTS) {
    const key = ep.host + ep.method + ep.path;
    if (seen.has(key)) fail(`端点重复：${key}`);
    seen.add(key);
    if (!ep.id || !ep.mode) fail(`端点缺少 id/mode：${JSON.stringify(ep)}`);
    // 只认 'proxy'。曾经这里也放过 'merge'，但 merge 从来没有实现 ——
    // 写上去构建能过、运行时静默按 proxy 走，是最坏的一类坑。
    // 要加 merge，先把 proxy.js 的合并逻辑写出来，再把这里放开。
    if (ep.mode !== 'proxy') fail(`未知 mode：${ep.mode}（目前只实现了 'proxy'）`);
  }
  for (const p of LOCAL_PATCH_PATHS) {
    if (!p.host || !p.path) fail(`本地伪装路径不合法：${JSON.stringify(p)}`);
  }
}

/**
 * 界面文案检查。
 * 这些字符串直接出现在用户面前，出现「本脚本」「我们」这类自称很出戏，
 * 而一旦写完就没人回头看，只能靠构建时卡一道。
 */
const COPY_FILES = ['src/ui/panel.js', 'src/ui/menu.js', 'src/core/switcher.js', 'src/index.js'];

function checkCopy() {
  const banned = ['本脚本', '我们', '您', '旧版本', '之前那版'];

  for (const rel of COPY_FILES) {
    const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');

    for (const w of banned) {
      if (raw.includes(w)) fail(`${rel} 里出现不该有的措辞：${w}`);
    }

    // 只看代码部分：先剥掉注释与 CSS 字符串，避免把文档/样式误判成文案
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
      .replace(/const CSS = `[\s\S]*?`;/, '');

    // 找直接写死的中文整句
    const offenders = [];
    for (const m of code.matchAll(/'([^'\\\n]{4,})'/g)) {
      const s = m[1];
      if (!/[\u4e00-\u9fa5]/.test(s)) continue;
      if (s.includes('${')) continue;               // 运行时拼接
      if (/^[×÷\s·—…/=｜|?+\-]+$/.test(s)) continue; // 纯符号
      if (s.length < 6) continue;
      offenders.push(s);
    }
    if (offenders.length) {
      fail(`${rel} 里仍有内联中文文案，请收进 core/text.js：\n    - ${offenders.join('\n    - ')}`);
    }
  }
}

function runChecks() {
  checkHookSource(fs.readFileSync(HOOK_ENTRY, 'utf8'));
  checkMeta();
  checkEndpoints();
  checkCopy();
  // 代理端点集合（钩子需要的）不能为空
  if (!ENDPOINTS.some((e) => e.mode === 'proxy')) fail('没有任何代理端点');
  console.log('\x1b[32m✔ 静态检查通过\x1b[0m');
}

/* ------------------------------------------------------------------ *
 * esbuild 插件：把「主世界钩子」当作字符串常量注入 bundle。
 * 这样钩子源码仍然是一个独立、可读、可高亮的 .js 文件（它有自己的全局作用域）。
 * ------------------------------------------------------------------ */
const hookSourcePlugin = {
  name: 'bili-hook-source',
  setup(build) {
    build.onLoad({ filter: /injected[\\/]hook\.js$/ }, () => ({
      contents: `export default ${JSON.stringify(fs.readFileSync(HOOK_ENTRY, 'utf8'))};`,
      loader: 'js'
    }));
  }
};

/* ------------------------------------------------------------------ *
 * 构建
 * ------------------------------------------------------------------ */
function buildOptions() {
  return {
    entryPoints: [ENTRY],
    outfile: OUTFILE,
    bundle: true,
    format: 'iife',
    target: ['chrome110', 'firefox110', 'safari16'],
    charset: 'utf8', // 保留中文可读性
    legalComments: 'none',
    minify: !DEV,
    sourcemap: false,
    write: !CHECK_ONLY,
    plugins: [hookSourcePlugin],
    define: { 'process.env.NODE_ENV': JSON.stringify(DEV ? 'development' : 'production') },
    banner: { js: meta }
  };
}

runChecks();

if (CHECK_ONLY) {
  console.log('（--check 模式，未产出文件）');
  process.exit(process.exitCode || 0);
}

fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });

if (WATCH) {
  const ctx = await esbuild.context({ ...buildOptions(), write: false });
  await ctx.watch();
  const { host, port } = await ctx.serve({ servedir: path.dirname(OUTFILE) });
  console.log(`\x1b[36m▸ 监听构建中… http://${host}:${port}/bili-toolkit.user.js\x1b[0m`);
} else {
  const t = Date.now();
  const result = await esbuild.build(buildOptions());
  const bytes = result.warnings.length ? '' : fs.statSync(OUTFILE).size;
  console.log(`\x1b[32m✔ 构建完成\x1b[0m dist/bili-toolkit.user.js  ${bytes} bytes  ${Date.now() - t}ms`);
  for (const w of result.warnings) console.warn(`  \x1b[33m! ${w.text}\x1b[0m`);
}