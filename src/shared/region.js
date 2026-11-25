/**
 * 区域形态改写 —— 沙箱（src/core/region.js）与主世界钩子（src/injected/hook.js）的唯一事实源。
 *
 * 诚实边界：服务端按 IP 判定播放授权，本模块只改写响应与首屏状态里的区域渲染形态。
 */

export const REGION_MODES = {
  off: { id: 'off', label: '不干预', ipRegion: null, areaLimit: null, areaLabel: null, hint: '完全沿用 B 站返回的区域' },
  hkmo: { id: 'hkmo', label: '港澳台', ipRegion: 'HK', areaLimit: 0, areaLabel: '港澳台', hint: '按境外/港澳台形态渲染，屏蔽地区限制提示' },
  tw: { id: 'tw', label: '台湾', ipRegion: 'TW', areaLimit: 0, areaLabel: '台湾', hint: '按台湾地区形态渲染' },
  cn: { id: 'cn', label: '中国大陆', ipRegion: 'CN', areaLimit: 0, areaLabel: '中国大陆', hint: '按中国大陆形态渲染' }
};

export const DEFAULT_REGION_MODE = 'off';

/**
 * 把响应对象改成指定区域形态。
 * @param {object} root
 * @param {string} mode
 * @param {number} [maxDepth=10]
 * @returns {number} 改动的字段数
 */
export function patchRegion(root, mode, maxDepth = 10) {
  const cfg = REGION_MODES[mode];
  if (!cfg || cfg.id === 'off') return 0;
  let changed = 0;
  const seen = typeof WeakSet !== 'undefined' ? new WeakSet() : null;

  function walk(o, depth) {
    if (!o || typeof o !== 'object' || depth > maxDepth) return;
    if (seen) {
      if (seen.has(o)) return;
      seen.add(o);
    }
    if (Array.isArray(o)) {
      for (let i = 0; i < o.length; i++) walk(o[i], depth + 1);
      return;
    }

    if (typeof o.ip_region === 'string' && o.ip_region !== cfg.ipRegion) {
      o.ip_region = cfg.ipRegion;
      changed++;
    }

    if (o.rights && typeof o.rights === 'object' && !Array.isArray(o.rights)) {
      const r = o.rights;
      if (typeof r.area_limit === 'number' && r.area_limit !== cfg.areaLimit) {
        r.area_limit = cfg.areaLimit;
        changed++;
      }
      if (typeof r.ban_area_show === 'number' && r.ban_area_show !== 0) {
        r.ban_area_show = 0;
        changed++;
      }
      if (typeof r.can_watch === 'number' && r.can_watch !== 1) {
        r.can_watch = 1;
        changed++;
      }
    }

    if (Array.isArray(o.areas) && o.areas.length && cfg.areaLabel) {
      let hasCurrent = false;
      for (let j = 0; j < o.areas.length; j++) {
        if (o.areas[j] && o.areas[j].name === cfg.areaLabel) {
          hasCurrent = true;
          break;
        }
      }
      if (!hasCurrent) {
        o.areas.unshift({ id: -1, name: cfg.areaLabel });
        changed++;
      }
    }

    if (typeof o.area === 'string' && o.area !== 'oversea' && cfg.id !== 'cn') {
      o.area = 'oversea';
      changed++;
    }

    const keys = Object.keys(o);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (o[k] && typeof o[k] === 'object') walk(o[k], depth + 1);
    }
  }

  walk(root, 0);
  return changed;
}

/** 轻量改写首屏 SSR 状态（window.__INITIAL_STATE__）中的区域字段 */
export function patchSsRegionState(s, mode) {
  const cfg = REGION_MODES[mode];
  if (!cfg || cfg.id === 'off' || !s || typeof s !== 'object') return;
  const holders = [s, s.user, s.videoData, s.epInfo, s.videoInfo, s.mediaInfo];
  for (let i = 0; i < holders.length; i++) {
    const h = holders[i];
    if (!h || typeof h !== 'object') continue;
    if (typeof h.ip_region === 'string' && h.ip_region !== cfg.ipRegion) h.ip_region = cfg.ipRegion;
    if (h.rights && typeof h.rights === 'object') {
      if (typeof h.rights.area_limit === 'number' && h.rights.area_limit !== cfg.areaLimit) {
        h.rights.area_limit = cfg.areaLimit;
      }
      if (h.rights.ban_area_show) h.rights.ban_area_show = 0;
    }
  }
}
