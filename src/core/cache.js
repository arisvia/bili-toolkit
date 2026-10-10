/** 极简 TTL 缓存 + 在途去重，用来消除「切画质 / 反复选集」时的重复请求。 */

const store = new Map(); // key -> {value, expire}
const inflight = new Map(); // key -> Promise

export const stats = { hit: 0, miss: 0, coalesced: 0 };

/**
 * 缓存代际号。每次清空 +1。
 *
 * 为什么需要它：清缓存只能清掉**已经写进去的**东西。
 * 切换账号 / 改借用源时会 resetCache()，但那一刻可能正好有一个在途请求
 * 用的是上一个账号的 Cookie。它回来后若照原样写回，就会把旧账号的播放地址
 * 继续供出去最多一个 TTL（默认 120 秒）—— 正是「切了号画质却没变」的一类原因。
 * 由调用方在发起前取一次号、写回前再比一次，不一致就不写。
 */
let generation = 0;
export function cacheGeneration() {
  return generation;
}
export function cacheClear() {
  store.clear();
  inflight.clear();
  stats.hit = 0;
  stats.miss = 0;
  stats.coalesced = 0;
  // 最后递增代际号。顺序要紧：必须在动表之后，
  // 否则旧 promise 的 .finally() 会跑去删新代际下同 key 的 promise。
  generation++;
}

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

/**
 * 去重执行：同一个 key 在途时复用同一个 Promise。
 * 这是「打开一个视频时首屏只发一次 playurl」的关键。
 */
export function coalesce(key, factory) {
  const hit = inflight.get(key);
  if (hit) {
    stats.coalesced++;
    return hit;
  }
  const gen = generation;
  const p = Promise.resolve()
    .then(factory)
    .finally(() => {
      // 只在代际没变时才删。缓存被清过（切号/改设置）之后，
      // 同 key 上可能已经注册了新的 promise，旧 promise 回来时不能把它一起删掉。
      if (generation === gen && inflight.get(key) === p) inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

/** 供诊断使用 */
export function cacheInfo() {
  return { size: store.size, inflight: inflight.size, ...stats };
}