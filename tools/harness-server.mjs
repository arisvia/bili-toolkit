/**
 * 本地静态服务器 —— 用于在真实浏览器里跑测试夹具与独立工具。
 *
 *   npm run harness
 *
 * 提供：
 *   /                       → 重定向到 test/fixtures/harness.html（脚本端到端冒烟）
 *   /fixtures/cookie-helper.html → 独立的 Cookie 整理工具
 *   /dist/*.user.js         → 构建产物（带 CORS，供页面取源码注入）
 *
 * 安全：只读，且只暴露项目根目录内的文件。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8931;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml'
};

http
  .createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/' || rel === '') rel = '/test/fixtures/harness.html';
    if (!rel.startsWith('/')) rel = '/' + rel;

    const file = path.join(ROOT, rel);
    // 防目录穿越
    if (!file.startsWith(ROOT + path.sep)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found: ' + rel);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () => {
    console.log('harness 已启动：');
    console.log(`  端到端冒烟   http://localhost:${PORT}/`);
    console.log(`  Cookie 工具  http://localhost:${PORT}/fixtures/cookie-helper.html`);
    console.log(`  构建产物     http://localhost:${PORT}/dist/bili-toolkit.user.js`);
    console.log('');
    console.log('（页面底部逐条列出 ✔/✖；Ctrl+F12 可看 console）');
  });