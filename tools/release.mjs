/**
 * 发布：构建并产出可直接安装的 userscript。
 *
 *   node tools/release.mjs            # 校验 + 构建
 *   node tools/release.mjs --bump     # 版本号 +1（自动判定 patch/minor）
 *   node tools/release.mjs --check    # 只检查产物是否与 src 同步
 *
 * 产物命名带版本号，方便在 Releases 里区分，也避免覆盖用户正在用的旧版本。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const BUMP = argv.includes('--bump');
const CHECK_ONLY = argv.includes('--check');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const write = (p, s) => fs.writeFileSync(path.join(ROOT, p), s, 'utf8');

function fail(msg) {
  console.error('\x1b[31m✖ ' + msg + '\x1b[0m');
  process.exit(1);
}

/* ---------- 版本号 ---------- */
function currentVersion() {
  return read('src/meta.js').match(/export const VERSION = '([^']+)'/)[1];
}

function bumpVersion() {
  const cur = currentVersion();
  const [maj, min, pat] = cur.split('.').map(Number);
  const kind = argv.includes('--minor') ? 'minor' : 'patch';
  const next =
    kind === 'minor' ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;
  write('src/meta.js', read('src/meta.js').replace(/VERSION = '[^']+'/, `VERSION = '${next}'`));
  const pkg = JSON.parse(read('package.json'));
  pkg.version = next;
  write('package.json', JSON.stringify(pkg, null, 2) + '\n');
  console.log(`版本 ${cur} → ${next}`);
}

/* ---------- 构建 ---------- */
function build() {
  console.log('构建中…');
  execFileSync(process.execPath, ['build.mjs'], { cwd: ROOT, stdio: 'inherit' });
}

/* ---------- 产物校验 ---------- */
function verifyArtifact() {
  const out = path.join(ROOT, 'dist/bili-toolkit.user.js');
  if (!fs.existsSync(out)) fail('产物不存在');

  const code = fs.readFileSync(out, 'utf8');
  const meta = read('src/meta.js');
  const version = currentVersion();

  const checks = [
    ['头在最前面', code.startsWith('// ==UserScript==')],
    ['@version 与 src 一致', code.includes(`@version      ${version}`)],
    // 占位符必须保留：钩子源码以字符串内联，运行时才把 CFG 替换进去。
    // 反过来「产物里找不到占位符」才说明钩子没被正确内联。
    ['钩子已内联（占位符保留待运行时替换）', code.includes('__BILI_VIP_CFG__')],
    ['没有 console.log 泄漏调试', !/console\.log\(/.test(code)],
    ['没有把调试开关写死为 true', !/setDebug\(true\)/.test(code)],
    ['体积合理 (<200KB)', code.length < 200 * 1024]
  ];
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? '\x1b[32m✔\x1b[0m' : '\x1b[31m✖\x1b[0m'} ${name}`);
    if (!ok) fail(`产物校验失败：${name}`);
  }
  console.log(`  体积 ${(code.length / 1024).toFixed(1)} KB · v${version}`);
  return { code, version };
}

/* ---------- 归档 ---------- */
function archive(code, version) {
  const dir = path.join(ROOT, 'dist');
  fs.mkdirSync(dir, { recursive: true });
  const name = `bili-toolkit-v${version}.user.js`;
  fs.writeFileSync(path.join(dir, name), code, 'utf8');
  console.log(`\n已打包 → dist/${name}`);
  console.log('安装：Tampermonkey → 添加新脚本 → 粘贴该文件内容');
}

/* ---------- 主流程 ---------- */
if (BUMP) bumpVersion();
build();
const { code, version } = verifyArtifact();
if (!CHECK_ONLY) archive(code, version);
console.log('\x1b[32m✔ 完成\x1b[0m');