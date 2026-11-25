/**
 * 响应补丁。
 *
 * 四条独立的补丁：
 *  1) patchVipFlags  —— 把「会员形状」的字段改成大会员（共享实现见 src/shared/vip.js）。
 *  2) stripTrialFlags —— 删除试看标记（默认关闭，仅用于排查对照）。
 *  3) reorderStreams —— 音频按码率/音质降序，视频在同一分辨率内按编码偏好重排。
 *  4) reorderCdnUrls —— 可选优选官源 CDN，将已知卡顿的 PCDN/MCDN 节点降权到备选末尾。
 */
import { DEFAULTS, CODEC_PRESETS } from '../config.js';
import { patchVipFlags } from '../shared/vip.js';
import { patchRegion } from './region.js';

export { patchVipFlags };

const TRIAL_KEYS = ['trial_avail', 'trial_time', 'trial_start', 'preview_avail'];

/** 删除试看标记（不改变服务端授权，仅去掉前端提示） */
export function stripTrialFlags(root) {
  const seen = new WeakSet();
  const walk = (o) => {
    if (!o || typeof o !== 'object' || seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) {
      for (const item of o) walk(item);
      return;
    }
    for (const k of TRIAL_KEYS) delete o[k];
    for (const k of Object.keys(o)) walk(o[k]);
  };
  walk(root);
  return root;
}

/** 定位响应体中的 playurl / video_info 容器 */
function resolveMediaContainer(root) {
  if (!root || typeof root !== 'object') return null;
  const d = root.data || root.result;
  if (!d || typeof d !== 'object') return null;
  const pu = d.playurl && typeof d.playurl === 'object' ? d.playurl : null;
  return pu || (d.video_info && typeof d.video_info === 'object' ? d.video_info : d);
}

/** 对音轨数组按带宽降序、次级按音质 id 降序重排；返回顺序是否发生变化 */
function sortAudioList(list) {
  if (!Array.isArray(list) || list.length <= 1) return false;
  const before = list.slice();
  list.sort((a, b) => {
    const bwA = Number(a && a.bandwidth) || 0;
    const bwB = Number(b && b.bandwidth) || 0;
    if (bwA !== bwB) return bwB - bwA;
    const idA = Number(a && a.id) || 0;
    const idB = Number(b && b.id) || 0;
    return idB - idA;
  });
  for (let i = 0; i < list.length; i++) {
    if (list[i] !== before[i]) return true;
  }
  return false;
}

/**
 * 1. 对同一 DASH 响应内的 audio / dolby.audio 流按码率与音质规格降序重排。
 * 2. 在保持分辨率档位原始先后顺序的前提下，按用户编码偏好对同一分辨率内的视频流重排。
 * @returns {boolean} 是否发生实际顺序变动
 */
export function reorderStreams(root, codecPref = 'auto') {
  const src = resolveMediaContainer(root);
  const dash = src && src.dash;
  if (!dash) return false;

  let changed = false;
  if (sortAudioList(dash.audio)) changed = true;
  if (dash.dolby && sortAudioList(dash.dolby.audio)) changed = true;

  const preset = CODEC_PRESETS[codecPref];
  const pri = preset && Array.isArray(preset.priority) ? preset.priority : [];
  if (!pri.length || !Array.isArray(dash.video) || dash.video.length <= 1) return changed;

  // 按分辨率 id 归类，保留各档位首次出现的先后顺序
  const groups = new Map();
  for (const v of dash.video) {
    if (!v) continue;
    const q = v.id;
    let list = groups.get(q);
    if (!list) {
      list = [];
      groups.set(q, list);
    }
    list.push(v);
  }

  const out = [];
  for (const list of groups.values()) {
    list.sort((a, b) => {
      const pA = pri.indexOf(a.codecid);
      const pB = pri.indexOf(b.codecid);
      return (pA === -1 ? 99 : pA) - (pB === -1 ? 99 : pB);
    });
    out.push(...list);
  }
  for (let i = 0; i < out.length; i++) {
    if (dash.video[i] !== out[i]) {
      changed = true;
      break;
    }
  }
  dash.video = out;
  return changed;
}

/**
 * 给媒体流 URL 打优先级分（数值越小越优先）：
 *   0: 官源 UPOS 镜像节点（upos-sz-mirror* / upos-hz-mirror* / cn-*.bilivideo.com 等）
 *   1: 其他常规 CDN（不含明显 PCDN 特征）
 *   2: 已知 PCDN / MCDN / 非常规高端口边缘节点
 */
export function scoreCdnUrl(raw) {
  if (typeof raw !== 'string' || !raw) return 9;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return 9;
  }
  const host = u.hostname.toLowerCase();
  const isPcdn =
    host.includes('mcdn.') ||
    host.includes('.mcdn') ||
    host.endsWith('.szbdyd.com') ||
    host.includes('pcdn') ||
    /^xy\d+x/.test(host) ||
    (u.port && u.port !== '443' && u.port !== '80');
  if (isPcdn) return 2;
  const isOfficialUpos =
    /^upos-[a-z0-9-]+-mirror[a-z0-9-]*\.bilivideo\.com$/i.test(host) ||
    /^upos-[a-z0-9-]+\.bilivideo\.com$/i.test(host) ||
    /^cn-[a-z0-9-]+\.bilivideo\.com$/i.test(host);
  return isOfficialUpos ? 0 : 1;
}

function reorderStreamUrls(item) {
  if (!item || typeof item !== 'object') return false;
  const baseKey =
    typeof item.baseUrl === 'string'
      ? 'baseUrl'
      : typeof item.base_url === 'string'
        ? 'base_url'
        : typeof item.url === 'string'
          ? 'url'
          : '';
  if (!baseKey) return false;

  const backupKey = Array.isArray(item.backupUrl)
    ? 'backupUrl'
    : Array.isArray(item.backup_url)
      ? 'backup_url'
      : '';
  const backups = backupKey ? item[backupKey] : [];
  if (!backups.length) return false;

  const all = [];
  const seen = new Set();
  for (const u of [item[baseKey], ...backups]) {
    if (typeof u === 'string' && u && !seen.has(u)) {
      seen.add(u);
      all.push(u);
    }
  }
  if (all.length <= 1) return false;

  const ranked = all
    .map((u, idx) => ({ u, idx, score: scoreCdnUrl(u) }))
    .sort((a, b) => (a.score !== b.score ? a.score - b.score : a.idx - b.idx))
    .map((x) => x.u);

  if (
    ranked[0] === item[baseKey] &&
    ranked.length - 1 === backups.length &&
    ranked.slice(1).every((u, i) => u === backups[i])
  ) {
    return false;
  }

  item[baseKey] = ranked[0];
  if (baseKey === 'baseUrl' && typeof item.base_url === 'string') item.base_url = ranked[0];
  if (baseKey === 'base_url' && typeof item.baseUrl === 'string') item.baseUrl = ranked[0];

  const rest = ranked.slice(1);
  if (backupKey) item[backupKey] = rest;
  if (backupKey === 'backupUrl' && Array.isArray(item.backup_url)) item.backup_url = rest;
  if (backupKey === 'backup_url' && Array.isArray(item.backupUrl)) item.backupUrl = rest;
  return true;
}

/** 优选官源 CDN，将 PCDN/MCDN 降权到备选末尾；返回被调整的流条目数 */
export function reorderCdnUrls(root) {
  const src = resolveMediaContainer(root);
  if (!src) return 0;
  let changed = 0;
  const lists = [];
  if (src.dash) {
    if (Array.isArray(src.dash.video)) lists.push(src.dash.video);
    if (Array.isArray(src.dash.audio)) lists.push(src.dash.audio);
    if (src.dash.dolby && Array.isArray(src.dash.dolby.audio)) lists.push(src.dash.dolby.audio);
    if (src.dash.flac && src.dash.flac.audio) lists.push([src.dash.flac.audio]);
  }
  if (Array.isArray(src.durl)) lists.push(src.durl);
  for (const list of lists) {
    for (const item of list) {
      if (reorderStreamUrls(item)) changed++;
    }
  }
  return changed;
}

/**
 * 统一的响应补丁入口。
 * @param {string} text 原始 JSON 文本
 * @param {{patchVip?:boolean, stripTrial?:boolean, region?:string, codec?:string, preferCdn?:boolean}} opts
 * @returns {string}
 */
export function patchJsonText(text, opts = {}) {
  const patchVip = opts.patchVip !== undefined ? opts.patchVip : DEFAULTS.patchUi !== false;
  const stripTrial = opts.stripTrial === true;
  const region = opts.region || 'off';
  const codec = opts.codec || 'auto';
  const preferCdn = opts.preferCdn === true;
  const noTransform = !patchVip && !stripTrial && region === 'off' && codec === 'auto' && !preferCdn;
  // 无任何显式改动且响应不含音轨数组时，直接原样返回（零 parse 开销且字节级一致）
  if (noTransform && !text.includes('"audio"')) return text;
  try {
    const o = JSON.parse(text);
    if (!o || typeof o !== 'object') return text;
    if (patchVip) patchVipFlags(o);
    if (stripTrial) stripTrialFlags(o);
    if (region !== 'off') patchRegion(o, region);
    const reordered = reorderStreams(o, codec);
    const cdnChanged = preferCdn ? reorderCdnUrls(o) > 0 : false;
    if (noTransform && !reordered && !cdnChanged) return text;
    return JSON.stringify(o);
  } catch {
    return text;
  }
}

/** 从 nav 响应里提取 A 账号自己的 mid（用于判断 Cookie 是否真的换了身份） */
export function extractMidFromNav(text) {
  try {
    const o = JSON.parse(text);
    if (o && o.code === 0 && o.data) {
      return { mid: String(o.data.mid ?? ''), uname: o.data.uname || '', face: o.data.face || '' };
    }
  } catch {
    /* ignore */
  }
  return { mid: '', uname: '', face: '' };
}

/** 从 nav 响应里提取会员信息 */
export function extractVipFromNav(text) {
  try {
    const o = JSON.parse(text);
    if (o && o.code === 0 && o.data) {
      const d = o.data;
      const status = typeof d.vipStatus === 'number' ? d.vipStatus : d.vip && d.vip.status;
      const type = typeof d.vipType === 'number' ? d.vipType : d.vip && d.vip.type;
      return { vipStatus: status || 0, vipType: type || 0 };
    }
  } catch {
    /* ignore */
  }
  return { vipStatus: 0, vipType: 0 };
}
