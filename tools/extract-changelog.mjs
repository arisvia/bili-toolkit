/**
 * 从 CHANGELOG.md 提取指定版本的更新说明。
 *
 * 用法：
 *   node tools/extract-changelog.mjs [tag]
 *   例如：node tools/extract-changelog.mjs v1.1.0
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHANGELOG_PATH = path.join(ROOT, 'CHANGELOG.md');

export function extractChangelog(tag, changelogContent) {
  const content = changelogContent || fs.readFileSync(CHANGELOG_PATH, 'utf8');
  const targetTag = (tag || '').trim();
  const cleanVersion = targetTag.replace(/^v/, '');

  const lines = content.split('\n');
  let capturing = false;
  let capturedLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headerMatch = line.match(/^##\s+\[v?([^\]]+)\]/);

    if (headerMatch) {
      const ver = headerMatch[1].trim();
      const match = !targetTag || ver === targetTag || ver === cleanVersion || ver === `v${cleanVersion}`;

      if (capturing) {
        // 遇到下一个版本头部，提取结束
        break;
      }

      if (match) {
        capturing = true;
        capturedLines.push(line);
        continue;
      }
    }

    if (capturing) {
      capturedLines.push(line);
    }
  }

  const result = capturedLines.join('\n').trim();
  return result;
}

// 命令行直接调用
if (process.argv[1] && process.argv[1].endsWith('extract-changelog.mjs')) {
  const tag = process.argv[2] || '';
  const result = extractChangelog(tag);
  if (result) {
    process.stdout.write(result + '\n');
  } else {
    process.stderr.write(`[warn] 未能在 CHANGELOG.md 中找到版本 ${tag} 的条目，回落提取最新条目\n`);
    const fallback = extractChangelog('');
    process.stdout.write(fallback + '\n');
  }
}
