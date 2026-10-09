/** 极简 TTL 缓存 + 在途去重，用来消除「切画质 / 反复选集」时的重复请求。 */

const store = new Map(); // key -> {value, expire}
const inflight = new Map(); // key -> Promise

export const stats = { hit: 0, miss: 0, coalesced: 0 };

export function cacheGet(key) {
  const hit = store.get(key);
  if (!hit) {
    stats.miss++;
    return undefined;
  }
  if (hit.expire <= Date.now()) {
    store.delete(key);
    stats.miss++;
    return undefined;
  }
  // 命中后顺延过期时间（滑动窗口），连续刷同一个视频时不会中途失效
  hit.expire = Date.now() + hit.ttl;
  stats.hit++;
  return hit.value;
}

export function cacheSet(key, value, ttl) {
  if (!ttl || ttl <= 0) return value;
  // 简单的容量上限，避免长时间使用后无限增长
  if (store.size > 200) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, ttl, expire: Date.now() + ttl });
  return value;
}

export function cacheClear() {
  store.clear();
  inflight.clear();
  stats.hit = 0;
  stats.miss = 0;
  stats.coalesced = 0;
}

/**
 * 去重执行：同一个 key 在途时复用同一个 Promise。
 * 这是「打开一个视频时首屏只发一次 playurl」的关键。
 */
export function coalesce(key, factory) {
  if (inflight.has(key)) {
    stats.coalesced++;
    return inflight.get(key);
  }
  const p = Promise.resolve()
    .then(factory)
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** 供诊断使用 */
export function cacheInfo() {
  return { size: store.size, inflight: inflight.size, ...stats };
}