/**
 * 流导出只读模块与面板隔离区测试：
 *   node test/stream-export.test.mjs
 */
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;

function check(name, cond, extra) {
  if (cond) {
    console.log(`  \x1b[32m✔\x1b[0m ${name}`);
  } else {
    failed++;
    console.error(`  \x1b[31m✖\x1b[0m ${name}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`);
  }
}

function makeFakeElement(tag) {
  const listeners = new Map();
  const children = [];
  const classSet = new Set();
  const attrs = new Map();
  const elem = {
    tagName: String(tag || 'div').toUpperCase(),
    id: '',
    style: {},
    children,
    _text: '',
    _value: '',
    open: false,
    title: '',
    classList: {
      add: (...cs) => cs.forEach((c) => classSet.add(c)),
      contains: (c) => classSet.has(c),
      toggle: (c, f) =>
        f === undefined
          ? classSet.has(c)
            ? classSet.delete(c)
            : classSet.add(c)
          : f
            ? classSet.add(c)
            : classSet.delete(c)
    },
    get className() {
      return Array.from(classSet).join(' ');
    },
    set className(v) {
      classSet.clear();
      String(v || '')
        .split(/\s+/)
        .filter(Boolean)
        .forEach((c) => classSet.add(c));
    },
    get textContent() {
      if (children.length === 0) return this._text;
      return children.map((c) => c.textContent || '').join('');
    },
    set textContent(v) {
      children.length = 0;
      this._text = String(v ?? '');
    },
    get value() {
      if (this.tagName === 'SELECT' && !this._value && children.length > 0) {
        return children[0].value;
      }
      return this._value;
    },
    set value(v) {
      this._value = String(v ?? '');
    },
    setAttribute(k, v) {
      attrs.set(k, String(v));
    },
    getAttribute(k) {
      return attrs.has(k) ? attrs.get(k) : null;
    },
    append(...nodes) {
      for (const n of nodes) children.push(n);
    },
    appendChild(n) {
      children.push(n);
      return n;
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatchEvent(evt) {
      const list = listeners.get(evt.type) || [];
      for (const fn of list) fn(evt);
    },
    select() {},
    remove() {}
  };
  return elem;
}

async function loadExports(ctx) {
  const res = await esbuild.build({
    stdin: {
      contents:
        "export * as exp from './src/core/stream-export.js';\nexport * as drawerMod from './src/ui/export-drawer.js';\n",
      resolveDir: ROOT,
      loader: 'js'
    },
    bundle: true,
    format: 'cjs',
    platform: 'neutral',
    target: 'es2022',
    write: false,
    logLevel: 'silent'
  });
  const mod = { exports: {} };
  const fn = vm.runInNewContext(`(function(module, exports){${res.outputFiles[0].text}})`, ctx);
  fn(mod, mod.exports);
  return mod.exports;
}

function makeSandbox() {
  const gmWrites = [];
  const logCalls = [];
  let netCalls = 0;
  let copiedText = '';

  const ctx = {
    URL,
    URLSearchParams,
    Map,
    Set,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Math,
    Date,
    JSON,
    RegExp,
    Error,
    Promise,
    parseInt,
    setTimeout,
    clearTimeout,
    console: {
      info: (...a) => logCalls.push(a.join(' ')),
      warn: (...a) => logCalls.push(a.join(' ')),
      error: (...a) => logCalls.push(a.join(' ')),
      debug: (...a) => logCalls.push(a.join(' '))
    },
    location: {
      href: 'https://www.bilibili.com/video/BV1Ab4y1z789?p=2',
      pathname: '/video/BV1Ab4y1z789'
    },
    __INITIAL_STATE__: {
      bvid: 'BV1Ab4y1z789',
      videoData: {
        bvid: 'BV1Ab4y1z789',
        pages: [
          { page: 1, cid: 1001, part: '序章' },
          { page: 2, cid: 1002, part: '进阶 "$实操`演示" <8K>' }
        ]
      }
    },
    player: {
      getVideoData: () => ({ bvid: 'BV1Ab4y1z789', cid: 1002, p: 2, part: '进阶 "$实操`演示" <8K>' })
    },
    navigator: {
      clipboard: {
        writeText: async (s) => {
          copiedText = s;
        }
      }
    },
    document: {
      title: '测试合集_哔哩哔哩_bilibili',
      documentElement: makeFakeElement('html'),
      body: makeFakeElement('body'),
      createElement: makeFakeElement,
      querySelector(sel) {
        if (sel === 'h1.video-title') return { textContent: '测试合集' };
        return null;
      },
      querySelectorAll: () => []
    },
    fetch: () => {
      netCalls++;
      throw new Error('unexpected fetch');
    },
    GM_xmlhttpRequest: () => {
      netCalls++;
      throw new Error('unexpected GM_xmlhttpRequest');
    },
    GM_setValue: (k, v) => gmWrites.push([k, v]),
    GM_getValue: (_k, d) => d
  };
  ctx.window = ctx;
  ctx.unsafeWindow = ctx;
  ctx.globalThis = ctx;

  return {
    ctx,
    getNetCalls: () => netCalls,
    getGmWrites: () => gmWrites,
    getLogCalls: () => logCalls,
    getCopiedText: () => copiedText
  };
}

console.log('\n[1] 纯内存 DASH 解析、多 P 识别与防迟到回退');
{
  const sb = makeSandbox();
  const { exp } = await loadExports(sb.ctx);

  const dashPayload = JSON.stringify({
    code: 0,
    data: {
      quality: 120,
      dash: {
        video: [
          {
            id: 80,
            codecid: 7,
            codecs: 'avc1.640032',
            bandwidth: 3000000,
            width: 1920,
            height: 1080,
            baseUrl: 'https://upos-sz-mirrorcos.bilivideo.com/v1080.m4s'
          },
          {
            id: 120,
            codecid: 12,
            codecs: 'hev1.1.6.L153.90',
            bandwidth: 14000000,
            width: 3840,
            height: 2160,
            baseUrl: 'https://upos-sz-mirrorali.bilivideo.com/v4k.m4s'
          }
        ],
        audio: [
          {
            id: 30280,
            bandwidth: 192000,
            codecs: 'mp4a.40.2',
            baseUrl: 'https://upos-sz-mirrorali.bilivideo.com/a192.m4s'
          }
        ],
        flac: {
          audio: {
            id: 30251,
            bandwidth: 960000,
            codecs: 'fLaC',
            baseUrl: 'https://upos-sz-mirrorali.bilivideo.com/aflac.m4s'
          }
        }
      }
    }
  });

  const media = exp.recordMediaStreams(
    'video-playurl',
    dashPayload,
    'https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1Ab4y1z789&cid=1002'
  );
  check('未发起任何额外分 P HTTP 请求', sb.getNetCalls() === 0, sb.getNetCalls());
  check('识别当前第 2 集', media.pageIndex === 2 && media.cid === '1002', media);
  check('视频轨按清晰度降序（4K 在首位）', media.videoTracks[0].id === 120, media.videoTracks);
  check('Hi-Res 音轨排在普通音轨之前', media.audioTracks[0].id === 30251, media.audioTracks);

  // 模拟第 1 集迟到响应：当前处于 P2 时不应覆盖 P2 轨道
  const stalePayload = JSON.stringify({
    code: 0,
    data: {
      quality: 64,
      dash: {
        video: [
          {
            id: 64,
            codecid: 7,
            bandwidth: 1500000,
            baseUrl: 'https://upos-sz-mirrorcos.bilivideo.com/p1.m4s'
          }
        ]
      }
    }
  });
  const afterStale = exp.recordMediaStreams(
    'video-playurl',
    stalePayload,
    'https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1Ab4y1z789&cid=1001'
  );
  check(
    '高分集播放期间屏蔽迟到 P1 包覆盖',
    afterStale.cid === '1002' && afterStale.videoTracks[0].url.includes('v4k.m4s'),
    afterStale
  );

  // 校验 URL 既不落盘，也不进日志
  check('未写任何 GM_setValue 存储', sb.getGmWrites().length === 0, sb.getGmWrites());
  const logsJoined = sb.getLogCalls().join('\n');
  check('直链未进入控制台/日志输出', !logsJoined.includes('bilivideo.com'), logsJoined);
}

console.log('\n[2] 文件名清洗、命令行安全转义与单流 durl');
{
  const sb = makeSandbox();
  const { exp } = await loadExports(sb.ctx);

  const dirty = '  标题:带\\斜杠/引号"美元$反引号`与末尾点..  ';
  const clean = exp.sanitizeFilename(dirty);
  check('非法字符被清洗且去除尾随点', !/[\\/:*?"<>|\r\n]/.test(clean) && !clean.endsWith('.'), clean);

  const cmd = exp.getFfmpegCommand({
    videoFilename: 'demo_$1_`id`_"v".m4s',
    audioFilename: 'demo_a.m4s',
    outputFilename: 'demo_out.mp4'
  });
  check('FFmpeg 参数转义双引号、美元符与反引号', cmd.includes('demo_\\$1_\\`id\\`_\\"v\\".m4s'), cmd);

  const aria = exp.getAria2Command({
    videoUrl: 'https://upos.example.com/v.m4s?auth=1',
    videoFilename: 'v.m4s',
    audioUrl: 'https://upos.example.com/a.m4s?auth=2',
    audioFilename: 'a.m4s',
    outputFilename: 'out.mp4'
  });
  check(
    'Aria2 命令包含 Referer 且含合并语句',
    aria.includes('--referer="https://www.bilibili.com/"') && aria.includes('ffmpeg -i "v.m4s"'),
    aria
  );

  // live 端点应忽略，durl 单流应可解析
  const liveIgnored = exp.recordMediaStreams(
    'live-playinfo',
    JSON.stringify({ code: 0, data: { durl: [{ url: 'https://live.example.com/1.flv' }] } }),
    'https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo'
  );
  check('忽略直播流导出', liveIgnored === null);

  const durlMedia = exp.recordMediaStreams(
    'video-playurl',
    JSON.stringify({
      code: 0,
      data: { quality: 80, durl: [{ url: 'https://upos.example.com/legacy.flv', size: 12345 }] }
    }),
    'https://api.bilibili.com/x/player/playurl?bvid=BV1Ab4y1z789&cid=1002'
  );
  check('支持传统 durl 单流解析', durlMedia && durlMedia.durlTracks.length === 1);
  const durlAria = exp.getAria2Command({
    durlUrl: durlMedia.durlTracks[0].url,
    durlFilename: 'legacy.flv'
  });
  check('单流 Aria2 命令带 Referer', durlAria.includes('--referer="https://www.bilibili.com/"'), durlAria);
}

console.log('\n[3] 折叠区默认收起与状态抗刷新隔离');
{
  const sb = makeSandbox();
  const { exp, drawerMod } = await loadExports(sb.ctx);

  const drawerObj = drawerMod.createStreamExportDrawer('__TEST__');
  check('挂载时默认收起', drawerObj.drawer.open === false);
  check('独立容器 ID 避开 renderLive 容器', drawerObj.root.id === '__TEST__-export');

  exp.recordMediaStreams(
    'video-playurl',
    JSON.stringify({
      code: 0,
      data: {
        quality: 120,
        dash: {
          video: [
            { id: 120, codecid: 12, bandwidth: 12000000, baseUrl: 'https://upos.example.com/4k.m4s' },
            { id: 80, codecid: 7, bandwidth: 4000000, baseUrl: 'https://upos.example.com/1080.m4s' }
          ],
          audio: [{ id: 30280, bandwidth: 192000, baseUrl: 'https://upos.example.com/192k.m4s' }]
        }
      }
    }),
    'https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1Ab4y1z789&cid=1002'
  );

  const selects = [];
  const buttons = [];
  const walk = (n) => {
    if (!n) return;
    if (n.tagName === 'SELECT') selects.push(n);
    if (n.tagName === 'BUTTON') buttons.push(n);
    if (Array.isArray(n.children)) n.children.forEach(walk);
  };
  walk(drawerObj.root);
  const videoSel = selects[0];
  check(
    '下拉框已填充 2 条视频流选项',
    videoSel && videoSel.children.length === 2,
    videoSel?.children?.length
  );

  // 模拟用户展开折叠区并切换到第二档（1080P）
  drawerObj.drawer.open = true;
  videoSel.value = videoSel.children[1].value;
  videoSel.dispatchEvent({ type: 'change' });

  // 模拟每秒周期触发 sync（如刷新周期同步）—— 指纹相同，不能重置选区和展开状态
  for (let i = 0; i < 5; i++) drawerObj.sync();
  check('重复 sync 后保持折叠区展开状态', drawerObj.drawer.open === true);
  check(
    '重复 sync 后保留用户所选 1080P 清晰度',
    videoSel.value === videoSel.children[1].value,
    videoSel.value
  );

  const aria2Btn = buttons.find((b) => b.textContent.includes('Aria2'));
  aria2Btn.dispatchEvent({ type: 'click' });
  await new Promise((r) => setTimeout(r, 10));
  check(
    '复制的 Aria2 命令使用用户选中的 1080P 流',
    sb.getCopiedText().includes('https://upos.example.com/1080.m4s'),
    sb.getCopiedText()
  );
}

console.log('');
if (failed) {
  console.error(`\x1b[31m${failed} 项失败\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32m全部通过\x1b[0m');
