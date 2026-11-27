/**
 * 当前播放流导出（纯只读、仅驻留内存）：
 *   1. 解析代理已捕获的播放响应（DASH 音视频轨 / 单文件 durl），保留现有 CDN 与编码偏好排序；
 *   2. 仅从当前页面状态（URL / player / __INITIAL_STATE__ / DOM）识别当前分 P，不额外发起请求；
 *   3. 构造复制直链、FFmpeg 合并命令与 Aria2 下载命令，并对文件名与命令行参数做安全转义。
 *
 * 约束：直链 URL 仅保存在内存状态中，绝不写入持久化存储或输出到日志。
 */
import { STD_RESOLUTION, QUALITY_NAME, codecName } from './log.js';

const DEFAULT_REFERER = 'https://www.bilibili.com/';
const EMPTY_MEDIA = Object.freeze({
  bvid: '',
  cid: '',
  title: '',
  pageIndex: 1,
  partTitle: '',
  quality: null,
  videoTracks: [],
  audioTracks: [],
  durlTracks: [],
  updatedAt: 0
});

let currentMedia = { ...EMPTY_MEDIA };
const pagesCache = new Map();
const listeners = new Set();

function getPageWindow() {
  try {
    if (typeof unsafeWindow !== 'undefined' && unsafeWindow) return unsafeWindow;
  } catch {
    /* ignore */
  }
  try {
    if (typeof window !== 'undefined' && window) return window;
  } catch {
    /* ignore */
  }
  return null;
}

/** 订阅当前播放流变化；回调参数不含任何持久副作用。 */
export function onMediaUpdate(fn) {
  if (typeof fn === 'function') listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyUpdate() {
  for (const fn of listeners) {
    try {
      fn(currentMedia);
    } catch {
      /* ignore */
    }
  }
}

export function getCurrentMedia() {
  return currentMedia;
}

/** 生成用于 UI 增量比对的指纹（不含直链 URL）。 */
export function streamSummaryKey(media = currentMedia) {
  if (!media) return '';
  const v = (media.videoTracks || []).map((t) => `${t.id}:${t.codec}:${t.bandwidth || 0}`).join(',');
  const a = (media.audioTracks || []).map((t) => `${t.id}:${t.bandwidth || 0}`).join(',');
  const d = (media.durlTracks || []).map((t) => `${t.quality || 0}:${t.size || 0}`).join(',');
  return `${media.bvid || ''}|${media.cid || ''}|${media.pageIndex || 1}|${media.title || ''}|${v}|${a}|${d}`;
}

/** 清洗文件名：去除路径分隔符、控制字符及尾随空白/点号。 */
export function sanitizeFilename(name) {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 120);
  return cleaned || 'bilibili_video';
}

/** 对双引号包裹的命令行参数进行转义，防止文件名/特殊字符破坏命令边界。 */
export function escapeShellArg(value) {
  return String(value || '')
    .replace(/[\r\n\x00]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`');
}

function cleanCommandUrl(url) {
  return String(url || '').replace(/[\r\n\x00"]/g, '');
}

/** 仅从页面已有 __INITIAL_STATE__ 或内存缓存获取当前视频的分 P 列表。 */
export function getKnownPages(bvid) {
  try {
    const win = getPageWindow();
    const state = win && win.__INITIAL_STATE__;
    if (state) {
      const stateBvid = (state.videoData && state.videoData.bvid) || state.bvid || '';
      if (!bvid || !stateBvid || stateBvid === bvid) {
        const rawPages = (state.videoData && state.videoData.pages) || state.pages;
        if (Array.isArray(rawPages) && rawPages.length > 0) {
          const list = rawPages.map((p, idx) => ({
            page: Number(p.page) || idx + 1,
            cid: String(p.cid || ''),
            part: String(p.part || '').trim()
          }));
          if (stateBvid) pagesCache.set(stateBvid, list);
          if (bvid) pagesCache.set(bvid, list);
          return list;
        }
        if (state.ugc_season && Array.isArray(state.ugc_season.sections)) {
          for (const sec of state.ugc_season.sections) {
            if (Array.isArray(sec.episodes) && sec.episodes.length > 0) {
              const list = sec.episodes.map((ep, idx) => ({
                page: idx + 1,
                cid: String(ep.cid || ''),
                bvid: String(ep.bvid || stateBvid || ''),
                part: String(ep.title || (ep.page && ep.page.part) || '').trim()
              }));
              if (stateBvid) pagesCache.set(stateBvid, list);
              if (bvid) pagesCache.set(bvid, list);
              return list;
            }
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
  return (bvid && pagesCache.get(bvid)) || [];
}

function detectDomPageState() {
  let domPageIndex = 0;
  let domPartTitle = '';
  try {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') {
      return { domPageIndex, domPartTitle };
    }
    const podContainers = document.querySelectorAll(
      '.video-pod, [class*="video-pod"], #multi_page, .multi-page-v1, .cur-list'
    );
    for (const pod of podContainers) {
      const hm = (pod.textContent || '').match(
        /(?:视频选集|选集|分集|列表)[^\d(（]*[（(]\s*(\d+)\s*\/\s*(\d+)\s*[)）]/
      );
      if (hm && hm[1]) {
        domPageIndex = parseInt(hm[1], 10);
        break;
      }
    }
    if (!domPageIndex) {
      const head = document.querySelector(
        '.video-pod__header, .video-pod .header, .cur-list-title, .multi-page-title, #multi_page .head-con'
      );
      const hm = head && head.textContent && head.textContent.match(/[（(]\s*(\d+)\s*\/\s*(\d+)\s*[)）]/);
      if (hm && hm[1]) domPageIndex = parseInt(hm[1], 10);
    }

    const items = Array.from(
      document.querySelectorAll(
        '.video-pod__item, [class*="video-pod__item"], .simple-base-item, ' +
          '.cur-list > li, .list-box > li, #multi_page li, .ep-item, [class*="episode-item"]'
      )
    );
    let activeEl = null;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it) continue;
      const cls = String(it.className || '');
      const cl = it.classList;
      const isClassActive =
        (cl &&
          typeof cl.contains === 'function' &&
          (cl.contains('active') || cl.contains('is-active') || cl.contains('on') || cl.contains('cur'))) ||
        /\b(active|on|selected|current|playing)\b/i.test(cls);
      const hasAria =
        typeof it.getAttribute === 'function' &&
        (it.getAttribute('aria-selected') === 'true' ||
          it.getAttribute('data-state') === 'active' ||
          it.getAttribute('data-playing') === 'true');
      if (isClassActive || hasAria) {
        activeEl = it;
        if (!domPageIndex) domPageIndex = i + 1;
        break;
      }
    }
    if (!activeEl && domPageIndex && items[domPageIndex - 1]) {
      activeEl = items[domPageIndex - 1];
    }
    if (activeEl) {
      const titleEl =
        (typeof activeEl.querySelector === 'function' &&
          activeEl.querySelector('.title-txt, [class*="title-txt"], [class*="title"], .ep-title, .part')) ||
        activeEl;
      if (titleEl && titleEl.textContent && titleEl.textContent.trim()) {
        domPartTitle = titleEl.textContent
          .trim()
          .replace(/\s*\d{1,2}:\d{2}(?::\d{2})?\s*$/, '')
          .replace(/^P\d+\s+/i, '')
          .trim();
      }
    }
  } catch {
    /* ignore */
  }
  return { domPageIndex, domPartTitle };
}

/** 识别当前正在播放的视频与分 P（只读页面已有状态，不发额外接口）。 */
export function detectPlayingVideo() {
  let bvid = '';
  let cid = '';
  let partTitle = '';
  let pageIndex = 0;

  if (typeof location !== 'undefined') {
    const m = String(location.pathname || '').match(/(BV[0-9a-zA-Z]{10})/i);
    if (m && m[1]) bvid = m[1];
    try {
      if (location.href) {
        const p = new URL(location.href).searchParams.get('p');
        if (p && /^\d+$/.test(p)) pageIndex = parseInt(p, 10);
      }
    } catch {
      /* ignore */
    }
  }

  try {
    const win = getPageWindow();
    const vd =
      win && win.player && typeof win.player.getVideoData === 'function' && win.player.getVideoData();
    if (vd) {
      if (vd.bvid) bvid = vd.bvid;
      if (vd.cid) cid = String(vd.cid);
      if (vd.part) partTitle = String(vd.part).trim();
      if (vd.p) pageIndex = parseInt(vd.p, 10) || pageIndex;
    }
  } catch {
    /* ignore */
  }

  const { domPageIndex, domPartTitle } = detectDomPageState();
  if (domPageIndex > 0) {
    pageIndex = domPageIndex;
    cid = '';
  }
  if (domPartTitle) partTitle = domPartTitle;

  const knownPages = getKnownPages(bvid);
  if (knownPages.length > 0) {
    let matched =
      (pageIndex > 0 &&
        (knownPages.find((p) => Number(p.page) === pageIndex) || knownPages[pageIndex - 1])) ||
      null;
    if (!matched && domPartTitle) {
      matched = knownPages.find(
        (p) => p.part === domPartTitle || domPartTitle.includes(p.part) || p.part.includes(domPartTitle)
      );
    }
    if (!matched && cid) matched = knownPages.find((p) => String(p.cid) === String(cid));
    if (!matched && !pageIndex && !domPartTitle && !cid) matched = knownPages[0];
    if (matched) {
      if (matched.cid) cid = String(matched.cid);
      if (matched.part) partTitle = matched.part;
      if (matched.page) pageIndex = Number(matched.page);
      if (matched.bvid) bvid = matched.bvid;
    }
  }

  if (!pageIndex || pageIndex < 1) pageIndex = 1;
  return { bvid, cid, partTitle, pageIndex };
}

/** 提取页面标题并附带当前分 P 名称。 */
export function getPageVideoTitle(customInfo) {
  let title = '';
  try {
    const el =
      typeof document !== 'undefined' &&
      (document.querySelector('h1.video-title') ||
        document.querySelector('.media-info-title-t') ||
        document.querySelector('.title-box .title') ||
        document.querySelector('.video-info-title .tit'));
    if (el && el.textContent && el.textContent.trim()) title = el.textContent.trim();
  } catch {
    /* ignore */
  }
  if (!title) {
    title = (typeof document !== 'undefined' ? document.title : '') || '';
  }
  title = title
    .replace(/_哔哩哔哩_bilibili.*$/i, '')
    .replace(/_哔哩哔哩.*$/i, '')
    .replace(/\s*-\s*哔哩哔哩.*$/i, '')
    .replace(/ - 视频在线观看.*$/i, '')
    .trim();

  const info = customInfo || detectPlayingVideo();
  if (!title && info && info.bvid) title = info.bvid;
  if (info && (info.partTitle || (info.pageIndex && info.pageIndex > 1))) {
    const pTag = info.pageIndex ? `P${info.pageIndex}` : '';
    const part = info.partTitle || '';
    const suffix = [pTag, part].filter(Boolean).join('_');
    if (suffix && !title.includes(suffix) && (!part || !title.includes(part))) {
      title = title ? `${title}_${suffix}` : suffix;
    }
  }
  return sanitizeFilename(title);
}

function firstUrl(item) {
  if (!item) return '';
  return (
    item.baseUrl ||
    item.base_url ||
    (Array.isArray(item.backupUrl) && item.backupUrl[0]) ||
    (Array.isArray(item.backup_url) && item.backup_url[0]) ||
    ''
  );
}

function inferCodecId(v) {
  const codecid = Number(v.codecid);
  if (codecid) return codecid;
  const codecs = String(v.codecs || '');
  if (/^(hev|hvc|dvh)/i.test(codecs)) return 12;
  if (/^av01/i.test(codecs)) return 13;
  if (/^avc/i.test(codecs)) return 7;
  return 0;
}

function parseDashTracks(dash) {
  const videoTracks = [];
  const audioTracks = [];
  if (!dash || typeof dash !== 'object') return { videoTracks, audioTracks };

  if (Array.isArray(dash.video)) {
    for (const v of dash.video) {
      const url = firstUrl(v);
      if (!url) continue;
      const q = Number(v.id);
      const codec = inferCodecId(v);
      videoTracks.push({
        id: q,
        quality: q,
        qualityName: QUALITY_NAME[q] || `Q${q}`,
        codec,
        codecName: codecName(codec),
        codecs: v.codecs || '',
        bandwidth: Number(v.bandwidth) || 0,
        width: Number(v.width) || (STD_RESOLUTION[q] ? STD_RESOLUTION[q][0] : 0),
        height: Number(v.height) || (STD_RESOLUTION[q] ? STD_RESOLUTION[q][1] : 0),
        url
      });
    }
  }

  if (Array.isArray(dash.audio)) {
    for (const a of dash.audio) {
      const url = firstUrl(a);
      if (!url) continue;
      const id = Number(a.id) || 0;
      let name = `音频 ${Math.round((Number(a.bandwidth) || 0) / 1000)}k`;
      if (id === 30280) name = '192K 高品质';
      else if (id === 30232) name = '132K 标准';
      else if (id === 30216) name = '64K 压缩';
      audioTracks.push({
        id,
        name,
        priority: 1,
        bandwidth: Number(a.bandwidth) || 0,
        codecs: a.codecs || 'mp4a',
        url
      });
    }
  }

  if (dash.dolby && Array.isArray(dash.dolby.audio)) {
    for (const da of dash.dolby.audio) {
      const url = firstUrl(da);
      if (!url) continue;
      audioTracks.push({
        id: Number(da.id) || 30250,
        name: '杜比全景声 (Dolby)',
        priority: 2,
        bandwidth: Number(da.bandwidth) || 0,
        codecs: da.codecs || 'ec-3',
        url
      });
    }
  }

  if (dash.flac && dash.flac.audio) {
    const fa = dash.flac.audio;
    const url = firstUrl(fa);
    if (url) {
      audioTracks.push({
        id: Number(fa.id) || 30251,
        name: 'Hi-Res 无损音质',
        priority: 3,
        bandwidth: Number(fa.bandwidth) || 0,
        codecs: fa.codecs || 'flac',
        url
      });
    }
  }

  const codecRank = { 12: 3, 13: 2, 7: 1 };
  videoTracks.sort((a, b) => {
    if (b.id !== a.id) return b.id - a.id;
    const rankDiff = (codecRank[b.codec] || 0) - (codecRank[a.codec] || 0);
    if (rankDiff !== 0) return rankDiff;
    return b.bandwidth - a.bandwidth;
  });
  audioTracks.sort((a, b) => b.priority - a.priority || b.bandwidth - a.bandwidth);
  return { videoTracks, audioTracks };
}

/** 记录代理已捕获并完成修补的播放响应（仅保存于内存）。 */
export function recordMediaStreams(epId, jsonTextOrObj, requestUrl) {
  if (String(epId || '').startsWith('live')) return null;
  try {
    const o = typeof jsonTextOrObj === 'string' ? JSON.parse(jsonTextOrObj) : jsonTextOrObj;
    const d = (o && (o.data || o.result)) || null;
    if (!d || typeof d !== 'object') return null;

    const pu = d.playurl && typeof d.playurl === 'object' ? d.playurl : null;
    const src = pu || (d.video_info && typeof d.video_info === 'object' ? d.video_info : d);
    if (!src || typeof src !== 'object') return null;

    let bvid = '';
    let cid = '';
    try {
      if (requestUrl) {
        const u = new URL(requestUrl, 'https://api.bilibili.com');
        bvid = u.searchParams.get('bvid') || '';
        cid = u.searchParams.get('cid') || '';
      }
    } catch {
      /* ignore */
    }

    const playing = detectPlayingVideo();
    if (!bvid && playing.bvid) bvid = playing.bvid;
    let pageIndex = playing.pageIndex || 1;
    let partTitle = playing.partTitle || '';

    const knownPages = getKnownPages(bvid);
    if (cid && knownPages.length > 0) {
      const matched = knownPages.find((p) => String(p.cid) === String(cid));
      if (matched) {
        pageIndex = Number(matched.page) || pageIndex;
        partTitle = matched.part || partTitle;
      }
    }

    // 防止高分集切换期间，第 1 集迟到预热包覆盖当前分 P 的流列表
    if (
      playing.pageIndex > 1 &&
      pageIndex === 1 &&
      currentMedia.bvid === bvid &&
      currentMedia.pageIndex === playing.pageIndex &&
      (currentMedia.videoTracks.length > 0 || currentMedia.durlTracks.length > 0)
    ) {
      return currentMedia;
    }

    if (!cid && playing.cid) cid = playing.cid;
    const { videoTracks, audioTracks } = parseDashTracks(src.dash);
    const durlTracks = [];
    if (Array.isArray(src.durl)) {
      for (const item of src.durl) {
        if (item && item.url) {
          durlTracks.push({
            url: item.url,
            size: Number(item.size) || 0,
            length: Number(item.length) || 0,
            quality: Number(src.quality) || 0
          });
        }
      }
    }
    if (!videoTracks.length && !audioTracks.length && !durlTracks.length) return null;

    const title = getPageVideoTitle({ bvid, cid, pageIndex, partTitle });
    currentMedia = {
      bvid: bvid || currentMedia.bvid,
      cid: cid || currentMedia.cid,
      title: title || currentMedia.title || 'bilibili_video',
      pageIndex,
      partTitle,
      quality: Number(src.quality) || (videoTracks[0] ? videoTracks[0].id : null),
      videoTracks,
      audioTracks,
      durlTracks,
      updatedAt: Date.now()
    };
    notifyUpdate();
    return currentMedia;
  } catch {
    return null;
  }
}

/** 按当前选中音视频轨道生成安全且可复现的输出文件名。 */
export function buildTrackFilenames(media, videoTrack, audioTrack, durlTrack) {
  const base = sanitizeFilename((media && media.title) || 'bilibili_video');
  const qTag = sanitizeFilename((videoTrack && videoTrack.qualityName) || 'video');
  const cTag = sanitizeFilename((videoTrack && videoTrack.codecName) || 'stream');
  const aTag = sanitizeFilename((audioTrack && audioTrack.name) || 'audio');
  const dExt = durlTrack && /\.flv(?:\?|$)/i.test(String(durlTrack.url || '')) ? '.flv' : '.mp4';
  return {
    videoFilename: sanitizeFilename(`${base}_${qTag}_${cTag}`) + '.m4s',
    audioFilename: sanitizeFilename(`${base}_${aTag}`) + '.m4s',
    outputFilename: sanitizeFilename(`${base}_${qTag}`) + '.mp4',
    durlFilename: base + dExt
  };
}

/** 构造 FFmpeg 音视频无损合并命令（带文件名安全转义）。 */
export function getFfmpegCommand({ videoFilename, audioFilename, outputFilename }) {
  return (
    `ffmpeg -i "${escapeShellArg(videoFilename)}" ` +
    `-i "${escapeShellArg(audioFilename)}" -c copy "${escapeShellArg(outputFilename)}"`
  );
}

/** 构造 Aria2 下载命令（带 Referer 与参数安全转义）。 */
export function getAria2Command({
  videoUrl,
  videoFilename,
  audioUrl,
  audioFilename,
  outputFilename,
  durlUrl,
  durlFilename,
  referer = DEFAULT_REFERER
}) {
  const ref = escapeShellArg(cleanCommandUrl(referer) || DEFAULT_REFERER);
  if (videoUrl && audioUrl) {
    return [
      `aria2c -c -s16 -x16 --referer="${ref}" -o "${escapeShellArg(videoFilename)}" "${cleanCommandUrl(videoUrl)}"`,
      `aria2c -c -s16 -x16 --referer="${ref}" -o "${escapeShellArg(audioFilename)}" "${cleanCommandUrl(audioUrl)}"`,
      getFfmpegCommand({ videoFilename, audioFilename, outputFilename })
    ].join('\n');
  }
  if (durlUrl) {
    return `aria2c -c -s16 -x16 --referer="${ref}" -o "${escapeShellArg(durlFilename)}" "${cleanCommandUrl(durlUrl)}"`;
  }
  return '';
}

/** 重置仅内存的当前流快照（主要供测试使用）。 */
export function resetStreamExport() {
  currentMedia = { ...EMPTY_MEDIA, videoTracks: [], audioTracks: [], durlTracks: [] };
  pagesCache.clear();
  notifyUpdate();
}
