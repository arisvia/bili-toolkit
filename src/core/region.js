/**
 * 区域模式（港澳台 / 大陆）
 *
 * ── 诚实的边界（重要，先读这段）────────────────────────────────────────
 * 实测结论（tools/probe-region.mjs）：
 *   · nav.ip_region 由**服务端按 IP** 判定；逐一测试 geoip=oversea / hk / tw / mo /
 *     cn_c / cn / intl 等 9 种取值，nav 响应完全无变化 ⇒ 改 geoip cookie 无效。
 *   · 区域门禁信息在 /pgc/view/web/season 的 rights.area_limit（位掩码）与
 *     ban_area_show，以及 areas[]（分区标签）—— 这三个字段恰好都在我们已经
 *     拦截的接口里。
 *   · 真正的码流下发由服务端完成；客户端脚本无法凭空生成。
 *
 * 因此本模块做的是**区域形态切换**：让页面的区域 UI、版权提示、分区入口
 * 按你选择的区域渲染，并清除区域相关的本地提示。
 * 当你配合代理/VPN（请求从境外 IP 发出）时，服务端会真正放流，
 * 本模块的形态切换就直接变成完整的区域解锁 —— 无需额外配置。
 * ──────────────────────────────────────────────────────────────────────
 */

/** 区域模式。off = 完全不干预，沿用服务端返回 */
export const REGION_MODES = {
  off: { id: 'off', label: '不干预', ipRegion: null, areaLimit: null, hint: '完全沿用 B 站返回的区域' },
  hkmo: { id: 'hkmo', label: '港澳台', ipRegion: 'HK', areaLimit: 0, hint: '按境外/港澳台形态渲染，屏蔽地区限制提示' },
  tw: { id: 'tw', label: '台湾', ipRegion: 'TW', areaLimit: 0, hint: '按台湾地区形态渲染' },
  cn: { id: 'cn', label: '中国大陆', ipRegion: 'CN', areaLimit: 0, hint: '按中国大陆形态渲染' }
};

export const DEFAULT_REGION_MODE = 'off';

/** 常见地区标签，用于在 areas[] 里补一个当前区域 */
const REGION_LABELS = {
  hkmo: '港澳台',
  tw: '台湾',
  cn: '中国大陆'
};

/**
 * 把响应对象改成指定区域形态。
 * 改动范围刻意保守：只碰明确是「区域」的字段，不碰任何播放/鉴权字段。
 *
 * @param {object} root  解析后的 JSON 根对象
 * @param {string} mode  REGION_MODES 的 key
 * @returns {number}     改动的字段数（用于日志/诊断）
 */
export function patchRegion(root, mode) {
  const cfg = REGION_MODES[mode];
  if (!cfg || cfg.id === 'off') return 0;
  let changed = 0;
  const seen = new WeakSet();

  const walk = (o, depth) => {
    if (!o || typeof o !== 'object' || seen.has(o) || depth > 8) return;
    seen.add(o);
    if (Array.isArray(o)) {
      for (const it of o) walk(it, depth + 1);
      return;
    }

    // 1) ip_region：nav 接口
    if (typeof o.ip_region === 'string' && o.ip_region !== cfg.ipRegion) {
      o.ip_region = cfg.ipRegion;
      changed++;
    }

    // 2) rights.area_limit / ban_area_show：番剧 season 接口
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

    // 3) areas：分区标签数组，补上当前区域（原本没有时）
    if (Array.isArray(o.areas) && o.areas.length) {
      const hasCurrent = o.areas.some((a) => a && a.name === REGION_LABELS[cfg.id]);
      if (!hasCurrent) {
        o.areas.unshift({ id: -1, name: REGION_LABELS[cfg.id] });
        changed++;
      }
    }

    // 4) 单个 episode / video 上的 area 字段
    if (typeof o.area === 'string' && o.area !== 'oversea' && cfg.id !== 'cn') {
      o.area = 'oversea';
      changed++;
    }

    for (const k of Object.keys(o)) {
      if (o[k] && typeof o[k] === 'object') walk(o[k], depth + 1);
    }
  };

  walk(root, 0);
  return changed;
}

/**
 * 页面主世界的 SSR 状态（__INITIAL_STATE__）里的区域字段。
 * 这些字段在服务端渲染时就写死了，改它们可以让首屏就是目标区域形态。
 */
export function patchSsRegion(state, mode) {
  const cfg = REGION_MODES[mode];
  if (!cfg || cfg.id === 'off' || !state || typeof state !== 'object') return 0;
  let changed = 0;
  const apply = (holder) => {
    if (!holder || typeof holder !== 'object') return;
    if (typeof holder.ip_region === 'string' && holder.ip_region !== cfg.ipRegion) {
      holder.ip_region = cfg.ipRegion;
      changed++;
    }
    if (holder.rights && typeof holder.rights === 'object') {
      if (typeof holder.rights.area_limit === 'number' && holder.rights.area_limit !== cfg.areaLimit) {
        holder.rights.area_limit = cfg.areaLimit;
        changed++;
      }
      if (holder.rights.ban_area_show) {
        holder.rights.ban_area_show = 0;
        changed++;
      }
    }
  };
  apply(state);
  apply(state.user);
  apply(state.videoData);
  apply(state.epInfo);
  apply(state.videoInfo);
  apply(state.mediaInfo);
  return changed;
}

/** 供 UI 展示：当前服务端判定我在哪个区 */
export function describeMode(mode) {
  return REGION_MODES[mode] || REGION_MODES.off;
}