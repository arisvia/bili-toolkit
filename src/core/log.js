import { NAME, NS, VERSION } from '../meta.js';

/**
 * 日志与运行统计。
 * 环形缓冲保留最近 N 条，方便在设置面板里导出排查信息。
 */
const RING_MAX = 200;
const ring = [];

export const stats = {
  proxyOk: 0,
  proxyFail: 0,
  passthrough: 0,
  cacheServed: 0,
  lastError: '',
  lastEndpoint: '',
  /** 最近一次拿到的播放流信息，供面板实时展示 */
  current: null
};

/** 画质码 → 默认标准分辨率 [宽, 高]（当码流未显式带宽高时兜底） */
export const STD_RESOLUTION = {
  6: [426, 240], 16: [640, 360], 32: [852, 480], 64: [1280, 720],
  74: [1280, 720], 80: [1920, 1080], 112: [1920, 1080], 116: [1920, 1080],
  120: [3840, 2160], 125: [3840, 2160], 126: [3840, 2160], 127: [7680, 4320]
};

/** 画质码 → 名称 */
export const QUALITY_NAME = {
  6: '240P', 16: '360P', 32: '480P', 64: '720P', 74: '720P60', 80: '1080P',
  112: '1080P+', 116: '1080P60', 120: '4K', 125: 'HDR', 126: '杜比视界', 127: '8K'
};

const CODEC_NAME = { 7: 'AVC', 12: 'HEVC', 13: 'AV1' };

export function qualityName(q) {
  if (q === null || q === undefined) return '—';
  return QUALITY_NAME[q] || ('Q' + q);
}

export function codecName(c) {
  return CODEC_NAME[c] || (c === undefined || c === null ? '—' : 'codec' + c);
}

/** 记录一次播放流信息；cache=true 表示来自缓存而非新请求 */
export function setCurrentMedia(epId, summary, cache) {
  const vids = (summary && summary.videoStreams) || [];
  if (stats.current && stats.current.videoStreams > 0 && vids.length === 0 && (!summary || !summary.durl)) {
    return;
  }
  const best = vids.reduce((a, b) => (!a || (b.bandwidth || 0) > (a.bandwidth || 0) ? b : a), null);
  const maxVidQuality = vids.reduce((m, v) => Math.max(m, v.id || 0), 0);
  const q = maxVidQuality > 0 ? maxVidQuality : (summary ? summary.quality : null);
  const stdRes = (q !== null && STD_RESOLUTION[q]) || null;
  const width = (best && best.width) || (summary && summary.width) || (stdRes ? stdRes[0] : null);
  const height = (best && best.height) || (summary && summary.height) || (stdRes ? stdRes[1] : null);
  const codec = (best && best.codec) || (summary && summary.codec) || null;
  const kbps = (best && best.bandwidth)
    ? Math.round(best.bandwidth / 1000)
    : (summary && summary.kbps)
    ? summary.kbps
    : null;
  stats.current = {
    at: Date.now(),
    endpoint: epId,
    quality: q,
    fromCache: !!cache,
    videoStreams: vids.length,
    audioStreams: (summary && summary.audioStreams) || 0,
    width,
    height,
    codec,
    kbps,
    durl: (summary && summary.durl) || 0,
    formats: (summary && summary.formats) || []
  };
}

function now() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

const BADGE_STYLES = {
  info: 'background:#00a396;color:#fff;border-radius:3px;padding:1px 5px;font-size:11px;font-weight:600;',
  warn: 'background:#e6a23c;color:#fff;border-radius:3px;padding:1px 5px;font-size:11px;font-weight:600;',
  error: 'background:#f56c6c;color:#fff;border-radius:3px;padding:1px 5px;font-size:11px;font-weight:600;',
  debug: 'background:#6c757d;color:#fff;border-radius:3px;padding:1px 5px;font-size:11px;font-weight:600;'
};

/** 打印类似 B 站前端包风格的脚本标识横幅 */
export function printBanner() {
  if (typeof console === 'undefined') return;
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const badge1 = 'background:#00a396;color:#fff;padding:2px 7px;border-radius:3px 0 0 3px;font-weight:bold;font-size:11px;';
    const badge2 = 'background:#00b4d8;color:#fff;padding:2px 7px;border-radius:0 3px 3px 0;font-weight:bold;font-size:11px;';
    const titleStyle = 'color:#00a396;font-size:11px;font-weight:500;margin-left:4px;';
    console.info(`%c ${NS} %c v${VERSION} %c ${NAME}`, badge1, badge2, titleStyle);
  } else {
    console.info(`[${NS}] v${VERSION} · ${NAME}`);
  }
}

function push(level, args) {
  const line = { t: now(), level, msg: args.map(stringify).join(' ') };
  ring.push(line);
  if (ring.length > RING_MAX) ring.shift();
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const badgeStyle = BADGE_STYLES[level] || BADGE_STYLES.info;
    const method = level === 'warn' ? console.warn : level === 'error' ? console.error : console.info;
    method(`%c B权益 %c`, badgeStyle, '', ...args);
  } else {
    const prefix = `[B权益]`;
    if (level === 'warn') console.warn(prefix, ...args);
    else if (level === 'error') console.error(prefix, ...args);
    else console.info(prefix, ...args);
  }
}

function stringify(v) {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.message;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

let debugOn = false;
export function setDebug(on) {
  debugOn = !!on;
}
export function isDebug() {
  return debugOn;
}

export const log = {
  info: (...a) => push('info', a),
  warn: (...a) => push('warn', a),
  error: (...a) => push('error', a),
  debug: (...a) => {
    if (debugOn) push('debug', a);
  }
};

/** 一行描述当前播放流，供日志与面板复用 */
export function describeCurrent() {
  const c = stats.current;
  if (!c) return '—';
  return [
    qualityName(c.quality),
    c.width ? c.width + 'x' + c.height : null,
    codecName(c.codec),
    c.kbps ? c.kbps + 'kbps' : null,
    c.fromCache ? '缓存' : '实时'
  ].filter(Boolean).join(' ');
}

/** 导出为纯文本，供「复制诊断信息」使用。绝不包含完整 SESSDATA。 */
export function exportLog() {
  const head = [
    `${NAME} · 诊断信息`,
    `统计：代理成功 ${stats.proxyOk} / 回退 ${stats.proxyFail} / 放行 ${stats.passthrough} / 缓存命中 ${stats.cacheServed}`,
    `最近播放流：${describeCurrent()}`,
    `最近端点：${stats.lastEndpoint || '-'}`,
    `最近错误：${stats.lastError || '无'}`,
    '-'.repeat(60)
  ].join('\n');
  const body = ring.map((l) => `[${l.t}] ${l.level.toUpperCase().padEnd(5)} ${l.msg}`).join('\n');
  return head + '\n' + body;
}