/**
 * GM_* 存储的薄封装。
 *
 * 键的形状分两代：
 *   · 扁平键（b.enabled / b.quality …）—— 互相独立的开关与档位，一直没变。
 *   · `b.accounts` 这一个嵌套键 —— 多账号池的全部数据都在里面。
 *
 * 为什么账号数据要收进单个嵌套键，而不是给每个账号一个扁平键：
 * 账号 id 是 Cookie 指纹，会随账号增删而变化，用它拼 GM 键名就等于把存储层
 * 和业务模型焊死，而且删除时容易漏掉残留键。收在一个键里，删除就是替换整个对象，
 * 不存在漏网之鱼。
 *
 * 旧版单账号数据（b.cookie / b.lastAccount）**继续镜像写回**，不是删掉 ——
 * 这样降级回旧版本脚本时设置不会凭空消失。读的时候优先以池子为准。
 */
import { DEFAULTS } from '../config.js';

const KEYS = {
  // 扁平：设置项
  enabled: 'b.enabled',
  patchUi: 'b.patchUi',
  softLogout: 'b.softLogout',
  prefetch: 'b.prefetch',
  quality: 'b.quality',
  liveQn: 'b.liveQn',
  region: 'b.region',
  codec: 'b.codec',
  preferCdn: 'b.preferCdn',
  cacheTtlMs: 'b.cacheTtlMs',
  debug: 'b.debug',
  strategy: 'b.strategy',
  mixinKey: 'b.mixinKey', // {mixinKey, date}
  // 嵌套：账号池（形状见 core/accounts.js）
  pool: 'b.accounts',
  // 旧版单账号键，仅用于迁移与镜像
  legacyCookie: 'b.cookie',
  legacyAccount: 'b.lastAccount' // {mid, uname, vipStatus, vipType, at}
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

function readBool(key, fallback) {
  const v = read(key, fallback);
  return v !== false && v !== 0 && v !== 'false';
}

/** 跨标签页同步需要监听的存储键集合 */
export const SYNC_KEYS = [
  KEYS.enabled,
  KEYS.patchUi,
  KEYS.softLogout,
  KEYS.prefetch,
  KEYS.quality,
  KEYS.liveQn,
  KEYS.region,
  KEYS.codec,
  KEYS.preferCdn,
  KEYS.pool
];

export const store = {
  /* --- 设置项 --- */
  isEnabled: () => readBool(KEYS.enabled, DEFAULTS.enabled),
  setEnabled: (v) => write(KEYS.enabled, !!v),

  isPatchUi: () => readBool(KEYS.patchUi, DEFAULTS.patchUi),
  setPatchUi: (v) => write(KEYS.patchUi, !!v),

  isPrefetch: () => readBool(KEYS.prefetch, DEFAULTS.prefetch),
  setPrefetch: (v) => write(KEYS.prefetch, !!v),

  isSoftLogout: () => readBool(KEYS.softLogout, DEFAULTS.softLogout),
  setSoftLogout: (v) => write(KEYS.softLogout, !!v),

  getQuality: () => String(read(KEYS.quality, 'max')),
  setQuality: (v) => write(KEYS.quality, String(v)),

  getLiveQn: () => String(read(KEYS.liveQn, 'max')),
  setLiveQn: (v) => write(KEYS.liveQn, String(v)),

  getRegion: () => String(read(KEYS.region, DEFAULTS.region)),
  setRegion: (v) => write(KEYS.region, String(v)),

  getCodec: () => String(read(KEYS.codec, DEFAULTS.codec || 'auto')),
  setCodec: (v) => write(KEYS.codec, String(v)),

  isPreferCdn: () => readBool(KEYS.preferCdn, DEFAULTS.preferCdn),
  setPreferCdn: (v) => write(KEYS.preferCdn, !!v),

  // TTL 是常量，不是设置项。这里原本有 setCacheTtl() 但没人调用 ——
  // 界面上没有这个控件，写进存储的值永远等于 DEFAULTS.cacheTtlMs，
  // 看起来「可调」其实调不了。要开放的话得先加界面。
  getCacheTtl: () => Number(read(KEYS.cacheTtlMs, DEFAULTS.cacheTtlMs)) || DEFAULTS.cacheTtlMs,

  isDebug: () => read(KEYS.debug, DEFAULTS.debug) === true,
  setDebug: (v) => write(KEYS.debug, !!v),

  /**
   * Cookie 发送策略。
   *
   * 这是**管理器能力**（当前的脚本管理器能不能按要求发 Cookie），与账号无关，
   * 所以全池共用一个值，不随账号切换而变。
   */
  getStrategy: () => {
    const v = Number(read(KEYS.strategy, DEFAULTS.strategy));
    return Number.isFinite(v) ? v : DEFAULTS.strategy;
  },
  setStrategy: (v) => write(KEYS.strategy, Number(v)),

  getMixinKey: () => read(KEYS.mixinKey, null),
  setMixinKey: (v) => write(KEYS.mixinKey, v),

  /* --- 账号池 --- */
  getPool: () => read(KEYS.pool, null),
  setPool: (v) => write(KEYS.pool, v),

  /* --- 旧版单账号键（迁移 + 镜像） --- */
  getLegacyCookie: () => String(read(KEYS.legacyCookie, '') || ''),
  setLegacyCookie: (v) => write(KEYS.legacyCookie, String(v || '')),
  getLegacyAccount: () => read(KEYS.legacyAccount, null),
  setLegacyAccount: (v) => write(KEYS.legacyAccount, v),

  /**
   * 监听其他标签页对 GM 存储的修改（不支持 GM_addValueChangeListener 时安全降级为空操作）。
   * @param {string[]} keys
   * @param {(key:string, oldVal:any, newVal:any, remote:boolean) => void} handler
   * @returns {() => void} 取消监听函数
   */
  onChange(keys, handler) {
    if (typeof GM_addValueChangeListener !== 'function') return () => {};
    const ids = [];
    for (const key of keys) {
      try {
        const id = GM_addValueChangeListener(key, (name, oldVal, newVal, remote) => {
          try {
            handler(name, oldVal, newVal, !!remote);
          } catch {}
        });
        if (id !== undefined) ids.push(id);
      } catch {}
    }
    return () => {
      if (typeof GM_removeValueChangeListener !== 'function') return;
      for (const id of ids) {
        try {
          GM_removeValueChangeListener(id);
        } catch {}
      }
    };
  }
};