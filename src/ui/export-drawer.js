/**
 * 面板「导出流与命令」默认折叠区。
 *
 * 设计要点：
 *   · 挂载在 renderLive 容器之外，且仅在流指纹变化时更新下拉选项，
 *     避免每秒定时刷新的 renderLive 把用户已选轨道与折叠状态冲掉。
 *   · 零额外权限、零额外请求，仅将内存中已捕获的直链 / 命令复制到剪贴板。
 */
import { TEXT } from '../core/text.js';
import {
  getCurrentMedia,
  onMediaUpdate,
  streamSummaryKey,
  getPageVideoTitle,
  buildTrackFilenames,
  getFfmpegCommand,
  getAria2Command
} from '../core/stream-export.js';
import { el, row, mkBtn } from './dom.js';

function trackKey(track, kind) {
  if (!track) return '';
  if (kind === 'video') return `${track.id}:${track.codec}:${track.bandwidth || 0}`;
  if (kind === 'audio') return `${track.id}:${track.bandwidth || 0}`;
  return String(track.url || '');
}

async function copyText(str) {
  if (!str) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(str);
      return true;
    }
  } catch {
    /* fallback below */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = str;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    (document.body || document.documentElement).appendChild(ta);
    ta.select();
    const ok = typeof document.execCommand === 'function' && document.execCommand('copy');
    ta.remove();
    return !!ok;
  } catch {
    return false;
  }
}

function formatVideoLabel(t) {
  const kbps = t.bandwidth ? ` · ${Math.round(t.bandwidth / 1000)}kbps` : '';
  const res = t.width && t.height ? ` (${t.width}×${t.height})` : '';
  return `${t.qualityName} · ${t.codecName}${kbps}${res}`;
}

function formatAudioLabel(t) {
  const kbps = t.bandwidth ? ` · ${Math.round(t.bandwidth / 1000)}kbps` : '';
  return `${t.name}${kbps}`;
}

/** 创建独立于 renderLive 的默认折叠流导出区。 */
export function createStreamExportDrawer(idPrefix) {
  const t = TEXT.streamExport;
  const wrap = el('div', 'sec export-sec');
  wrap.id = idPrefix + '-export';

  const drawer = el('details', 'export-details');
  drawer.open = false;
  drawer.appendChild(el('summary', '', t.summary));

  const body = el('div', 'export-body');
  const emptyHint = el('div', 'hint', t.empty);

  const controls = el('div', 'export-controls');
  const videoSel = el('select', 'sel');
  const audioSel = el('select', 'sel');
  const videoRow = row(t.videoLabel, videoSel);
  const audioRow = row(t.audioLabel, audioSel);

  const btns = el('div', 'btns');
  const copyVideoBtn = mkBtn(t.copyVideo, () => handleCopy('video'));
  const copyAudioBtn = mkBtn(t.copyAudio, () => handleCopy('audio'));
  const copyFfmpegBtn = mkBtn(t.copyFfmpeg, () => handleCopy('ffmpeg'));
  const copyAria2Btn = mkBtn(t.copyAria2, () => handleCopy('aria2'), { className: 'act pri' });
  btns.append(copyVideoBtn, copyAudioBtn, copyFfmpegBtn, copyAria2Btn);

  const tip = el('div', 'hint', t.dashOnlyHint);
  const statusMsg = el('div', 'msg');

  controls.append(videoRow, audioRow, btns, tip, statusMsg);
  body.append(emptyHint, controls);
  drawer.appendChild(body);
  wrap.appendChild(drawer);

  let lastKey = null;
  let selectedVideoKey = '';
  let selectedAudioKey = '';
  let msgTimer = null;

  videoSel.addEventListener('change', () => {
    selectedVideoKey = videoSel.value;
  });
  audioSel.addEventListener('change', () => {
    selectedAudioKey = audioSel.value;
  });

  function say(text, color) {
    statusMsg.textContent = text || '';
    statusMsg.style.color = color || '';
    if (msgTimer) clearTimeout(msgTimer);
    if (text) {
      msgTimer = setTimeout(() => {
        statusMsg.textContent = '';
      }, 2400);
    }
  }

  function currentSelection(media) {
    const vTracks = media.videoTracks || [];
    const aTracks = media.audioTracks || [];
    const dTracks = media.durlTracks || [];
    const vTrack = vTracks.find((x) => trackKey(x, 'video') === selectedVideoKey) || vTracks[0] || null;
    const aTrack = aTracks.find((x) => trackKey(x, 'audio') === selectedAudioKey) || aTracks[0] || null;
    const dTrack = !vTrack && dTracks.length ? dTracks[0] : null;
    return { vTrack, aTrack, dTrack };
  }

  async function handleCopy(mode) {
    const media = getCurrentMedia();
    const { vTrack, aTrack, dTrack } = currentSelection(media);
    if (!vTrack && !aTrack && !dTrack) {
      say(t.unavailable, '#e6a23c');
      return;
    }
    const freshTitle =
      media.bvid && typeof location !== 'undefined' && String(location.pathname || '').includes(media.bvid)
        ? getPageVideoTitle(media)
        : media.title;
    const files = buildTrackFilenames({ ...media, title: freshTitle || media.title }, vTrack, aTrack, dTrack);
    let out = '';
    if (mode === 'video') {
      out = (vTrack && vTrack.url) || (dTrack && dTrack.url) || '';
    } else if (mode === 'audio') {
      out = (aTrack && aTrack.url) || '';
    } else if (mode === 'ffmpeg') {
      if (vTrack && aTrack) {
        out = getFfmpegCommand(files);
      }
    } else if (mode === 'aria2') {
      out = getAria2Command({
        videoUrl: vTrack && vTrack.url,
        videoFilename: files.videoFilename,
        audioUrl: aTrack && aTrack.url,
        audioFilename: files.audioFilename,
        outputFilename: files.outputFilename,
        durlUrl: dTrack && dTrack.url,
        durlFilename: files.durlFilename
      });
    }
    if (!out) {
      say(t.unavailable, '#e6a23c');
      return;
    }
    const ok = await copyText(out);
    say(ok ? t.copied : t.copyFailed, ok ? 'var(--fg)' : '#e6a23c');
  }

  function populateSelect(sel, tracks, kind, formatter, prevKey) {
    sel.textContent = '';
    let matchedKey = '';
    for (const item of tracks) {
      const val = trackKey(item, kind);
      const opt = el('option', '', formatter(item));
      opt.value = val;
      if (val === prevKey) matchedKey = val;
      sel.appendChild(opt);
    }
    const nextKey = matchedKey || (tracks[0] ? trackKey(tracks[0], kind) : '');
    if (nextKey) sel.value = nextKey;
    return nextKey;
  }

  function sync(media = getCurrentMedia()) {
    const nextSig = streamSummaryKey(media);
    if (nextSig === lastKey) return;
    lastKey = nextSig;

    const vTracks = (media && media.videoTracks) || [];
    const aTracks = (media && media.audioTracks) || [];
    const dTracks = (media && media.durlTracks) || [];
    const hasDash = vTracks.length > 0 || aTracks.length > 0;
    const hasAny = hasDash || dTracks.length > 0;

    emptyHint.style.display = hasAny ? 'none' : '';
    controls.style.display = hasAny ? '' : 'none';
    if (!hasAny) {
      videoSel.textContent = '';
      audioSel.textContent = '';
      return;
    }

    if (hasDash) {
      videoRow.style.display = vTracks.length ? '' : 'none';
      audioRow.style.display = aTracks.length ? '' : 'none';
      selectedVideoKey = populateSelect(videoSel, vTracks, 'video', formatVideoLabel, selectedVideoKey);
      selectedAudioKey = populateSelect(audioSel, aTracks, 'audio', formatAudioLabel, selectedAudioKey);
      copyVideoBtn.style.display = vTracks.length ? '' : 'none';
      copyAudioBtn.style.display = aTracks.length ? '' : 'none';
      copyFfmpegBtn.style.display = vTracks.length && aTracks.length ? '' : 'none';
      copyAria2Btn.style.display = '';
      tip.style.display = vTracks.length && aTracks.length ? '' : 'none';
    } else {
      videoRow.style.display = 'none';
      audioRow.style.display = 'none';
      copyVideoBtn.style.display = '';
      copyAudioBtn.style.display = 'none';
      copyFfmpegBtn.style.display = 'none';
      copyAria2Btn.style.display = '';
      tip.style.display = 'none';
    }
  }

  const unbind = onMediaUpdate((m) => sync(m));
  sync(getCurrentMedia());
  return { root: wrap, drawer, sync, destroy: unbind };
}
