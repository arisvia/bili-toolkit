/** GM_* 存储的薄封装：统一默认值、统一键名，避免各模块散落魔法字符串。 */
import { DEFAULTS } from '../config.js';

const KEYS = {
  cookie: 'b.cookie',
  enabled: 'b.enabled',
  patchUi: 'b.patchUi',
  prefetch: 'b.prefetch',
  quality: 'b.quality',
  liveQn: 'b.liveQn',
  region: 'b.region',
  cacheTtlMs: 'b.cacheTtlMs',
  debug: 'b.debug',
  strategy: 'b.strategy',
  mixinKey: 'b.mixinKey', // {key, date}
  lastAccount: 'b.lastAccount' // 探测到的 B 身份，用于界面显示
};

function read(key, fallback) {
  try {
    const v = GM_getValue(key, undefined);
    return v === undefined || v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    GM_setValue(key, value);
  } catch {
    /* 忽略：隐私模式等 */
  }
}

export const store = {
  /** B 账号完整 Cookie */
  getCookie: () => String(read(KEYS.cookie, '') || ''),
  setCookie: (v) => write(KEYS.cookie, String(v || '')),

  isEnabled: () => read(KEYS.enabled, DEFAULTS.enabled) !== false,
  setEnabled: (v) => write(KEYS.enabled, !!v),

  isPatchUi: () => read(KEYS.patchUi, DEFAULTS.patchUi) !== false,
  setPatchUi: (v) => write(KEYS.patchUi, !!v),

  isPrefetch: () => read(KEYS.prefetch, DEFAULTS.prefetch) !== false,
  setPrefetch: (v) => write(KEYS.prefetch, !!v),

  getQuality: () => String(read(KEYS.quality, 'max')),
  setQuality: (v) => write(KEYS.quality, String(v)),

  getLiveQn: () => String(read(KEYS.liveQn, 'max')),
  setLiveQn: (v) => write(KEYS.liveQn, String(v)),

  getRegion: () => String(read(KEYS.region, DEFAULTS.region)),
  setRegion: (v) => write(KEYS.region, String(v)),

  getCacheTtl: () => Number(read(KEYS.cacheTtlMs, DEFAULTS.cacheTtlMs)) || DEFAULTS.cacheTtlMs,
  setCacheTtl: (v) => write(KEYS.cacheTtlMs, Number(v)),

  isDebug: () => read(KEYS.debug, DEFAULTS.debug) === true,
  setDebug: (v) => write(KEYS.debug, !!v),

  getStrategy: () => {
    const v = Number(read(KEYS.strategy, DEFAULTS.strategy));
    return Number.isFinite(v) ? v : DEFAULTS.strategy;
  },
  setStrategy: (v) => write(KEYS.strategy, Number(v)),

  getMixinKey: () => read(KEYS.mixinKey, null),
  setMixinKey: (v) => write(KEYS.mixinKey, v),

  getLastAccount: () => read(KEYS.lastAccount, null),
  setLastAccount: (v) => write(KEYS.lastAccount, v)
};