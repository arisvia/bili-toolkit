/**
 * 代理编排层 —— 把「页面的播放请求」变成「用 B 账号发出的、参数已抬高并重新签名的请求」。
 *
 * 流水线：
 *   校验白名单 → 查缓存 → 抬高画质参数 → 注入 csrf → 重签 wbi → 用 B 的 Cookie 发送
 *   → 失败时降级重试（换发送方式 / 退回原始参数）→ 仍然失败则交还原页面（走 A）
 *   → 打会员补丁 → 写缓存 → 返回
 */
import { QUALITY_PRESETS, LIVE_QN_PRESETS, STRATEGIES, DEFAULTS } from '../config.js';
import { store } from './store.js';
import { resolveEndpoint } from './endpoints.js';
import { httpRequest, parseJsonSafe } from './transport.js';
import { ensureMixinKey, getEffectiveCookie, hasCookie, getBCsrf, resolveStrategy } from './session.js';
import { borrowAccountId, markInvalid } from './accounts.js';
import { signUrl, hasWbiSignature } from './wbi.js';
import { patchJsonText } from './patch.js';
import { cacheGet, cacheSet, cacheClear, cacheGeneration, coalesce, cacheInfo } from './cache.js';
import { log, stats, setCurrentMedia } from './log.js';

/** 从 B 的响应里把「实际拿到的播放流」提取出来，用于日志与面板实时展示 */
export function summarize(text) {
  try {
    const o = JSON.parse(text);
    const d = (o && (o.data || o.result)) || null;
    if (!d || typeof d !== 'object') return { quality: null };
    const pu = d.playurl && typeof d.playurl === 'object' ? d.playurl : null;
    const src = pu || (d.video_info && typeof d.video_info === 'object' ? d.video_info : d);

    const videoStreams = [];
    const audioStreams = [];
    if (src.dash && Array.isArray(src.dash.video)) {
      for (const v of src.dash.video) {
        if (!v) continue;
        videoStreams.push({
          id: v.id,
          codec: v.codecid,
          bandwidth: v.bandwidth,
          width: v.width,
          height: v.height,
          frameRate: v.frameRate || v.frame_rate
        });
      }
    }
    if (src.dash && Array.isArray(src.dash.audio)) {
      for (const a of src.dash.audio) {
        if (a) audioStreams.push({ id: a.id, bandwidth: a.bandwidth });
      }
    }

    const rawFormats = Array.isArray(src.support_formats)
      ? src.support_formats
      : Array.isArray(d.support_formats)
      ? d.support_formats
      : [];
    const formats = rawFormats.length
      ? rawFormats.map((f) => (f && typeof f === 'object' ? f.quality : f)).filter(Boolean)
      : Array.isArray(src.accept_quality)
      ? src.accept_quality
      : Array.isArray(d.accept_quality)
      ? d.accept_quality
      : [];

    let durlKbps = null;
    const durlList = Array.isArray(src.durl) ? src.durl : [];
    if (durlList.length && durlList[0] && durlList[0].size && durlList[0].length) {
      const durSec = durlList[0].length / 1000;
      if (durSec > 0) durlKbps = Math.round((durlList[0].size * 8) / durSec / 1000);
    }

    return {
      quality: src.quality !== undefined ? src.quality : null,
      videoStreams,
      audioStreams: audioStreams.length,
      codec: src.video_codecid || src.codecid || null,
      kbps: durlKbps,
      durl: durlList.length,
      formats,
      timelength: src.timelength
    };
  } catch {
    return { quality: null };
  }
}

/** 基础请求头：过滤掉不该转发的头 */
function buildHeaders(src, method) {
  const out = {
    Accept: '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Origin: 'https://www.bilibili.com',
    Referer: 'https://www.bilibili.com/'
  };
  const blocked = /^(cookie|host|origin|referer|content-length|connection|sec-|accept-encoding)$/i;
  for (const [k, v] of Object.entries(src || {})) {
    if (!blocked.test(k)) out[k] = String(v);
  }
  if (method === 'POST') out['Content-Type'] = out['Content-Type'] || 'application/json';
  return out;
}

/* ------------------------------------------------------------------ *
 * 参数改写
 * ------------------------------------------------------------------ */
function applyQuality(ep, url) {
  if (ep.kind === 'live') {
    url.searchParams.set('qn', String(LIVE_QN_PRESETS[store.getLiveQn()] || LIVE_QN_PRESETS.max));
    return;
  }
  // 服务端把 qn 当作「返回码流的上限」：客户端不主动抬高，就拿不到更高的画质。
  const preset = QUALITY_PRESETS[store.getQuality()] || QUALITY_PRESETS.max;
  url.searchParams.set('qn', String(preset.qn));
  url.searchParams.set('fnval', String(preset.fnval));
  url.searchParams.set('fnver', '0');
  url.searchParams.set('fourk', String(preset.fourk));
  url.searchParams.set('otype', 'json');
  url.searchParams.set('platform', 'pc');
  url.searchParams.set('high_quality', '1');
  url.searchParams.delete('try_look'); // 试看限定由服务端控制，这里不主动请求
  // 新版番剧页会带 is_qn_trial=1（未登录/非会员的试看标记）；带着它请求 B 的会员画质
  // 会被服务端降级成试看流，必须删掉，让 qn=127 真正按大会员档位取流。
  url.searchParams.delete('is_qn_trial');
}

/** 把 csrf 写进 body（JSON 或 form-urlencoded） */
function injectCsrf(body, csrf) {
  if (!body || !csrf) return body;
  const s = String(body);
  if (s.trim().startsWith('{')) {
    try {
      const o = JSON.parse(s);
      if (o && typeof o === 'object') {
        o.csrf = csrf;
        return JSON.stringify(o);
      }
    } catch {
      /* 交给下面的正则兜底 */
    }
  }
  if (/csrf=/.test(s)) return s.replace(/(csrf=)[^&]*/g, '$1' + csrf);
  return (s ? s + (s.endsWith('&') ? '' : '&') : '') + 'csrf=' + encodeURIComponent(csrf);
}

/** 反向操作：把 body 里的 csrf 删干净（借用源没有 csrf 时用） */
function stripCsrf(body) {
  const s = String(body || '');
  if (!s) return s;
  if (s.trim().startsWith('{')) {
    try {
      const o = JSON.parse(s);
      if (o && typeof o === 'object') {
        delete o.csrf;
        return JSON.stringify(o);
      }
    } catch {
      /* 交给下面的正则兜底 */
    }
  }
  return s
    .replace(/(^|&)csrf=[^&]*/g, '')
    .replace(/(^|&)csrf_token=[^&]*/g, '')
    .replace(/^&/, '');
}

/**
 * 准备最终的请求：抬高参数 + 注入 csrf + 重签 wbi。
 * @returns {{url:string, body:string, originalUrl:string, originalBody:string, upgraded:boolean, signed:boolean, note?:string}}
 *
 * `originalBody` 是**没有注入 B 的 csrf** 的 body，专门给「参数被拒后退回原始参数重试」用。
 * 拿不到时为空串（GET 请求）。`originalUrl` 同理（borrow 源没有 csrf 时已删掉页面那个）。
 */
async function prepare(ep, method, rawUrl, rawBody) {
  const url = new URL(rawUrl);
  applyQuality(ep, url);

  const csrf = ep.csrf ? getBCsrf() : '';
  if (csrf) {
    url.searchParams.set('csrf', csrf);
    url.searchParams.delete('csrf_token');
  } else if (ep.csrf) {
    // 借用源没有 csrf 时必须**删掉页面自带的**那个：留下就是拿 A 的 csrf 配 B 的
    // SESSDATA 发出去（findings §13），服务端只会回 -111，比不带更难查。
    url.searchParams.delete('csrf');
    url.searchParams.delete('csrf_token');
  }

  // 「原始参数」也必须是清干净 csrf 的版本：重试路径和「拿不到 wbi 密钥」的退回
  // 都用它，直接用 rawUrl 会把 A 的 csrf 一起发出去。
  let originalUrl = rawUrl;
  if (ep.csrf && !csrf) {
    const o = new URL(rawUrl);
    o.searchParams.delete('csrf');
    o.searchParams.delete('csrf_token');
    originalUrl = o.href;
  }

  let body = method === 'POST' && rawBody ? (csrf ? injectCsrf(rawBody, csrf) : ep.csrf ? stripCsrf(rawBody) : rawBody) : '';

  // 重试要用的「没注入过 B 的 csrf」的 body。
  // 直接拿 rawBody 是不行的：POST 端点被抬高参数时不改 body，
  // 于是 rawBody === prep.body，退回它等于没退。必须显式分开记。
  // 但 rawBody 里可能带着 A 的 csrf，退回时同样要删干净。
  const originalBody = method === 'POST' && rawBody ? (ep.csrf && !csrf ? stripCsrf(rawBody) : rawBody) : '';

  // wbi 签名：参数动过就必须重签，否则 -403
  const needsSign = ep.wbi === 'required' || (ep.wbi === 'if-present' && hasWbiSignature(url));
  if (!needsSign) {
    return { url: url.href, body, originalUrl, originalBody, upgraded: true, signed: false };
  }

  const mixinKey = await ensureMixinKey();
  if (!mixinKey) {
    if (ep.wbi === 'required') {
      // 拿不到密钥就不要改参数，否则签名必挂；退回原样请求，至少能播放。
      // 这个状态必须让用户看得见 —— 否则表现为「画质死活不升级」且毫无线索。
      stats.signedFallback = (stats.signedFallback || 0) + 1;
      const note = '缺少 wbi 密钥，已退回原始参数（画质不升级）';
      log.warn(ep.id, note);
      return {
        url: originalUrl,
        body: method === 'POST' && rawBody ? injectCsrf(rawBody, csrf) : '',
        originalBody,
        upgraded: false,
        signed: false,
        note
      };
    }
    return { url: url.href, body, originalUrl, originalBody, upgraded: true, signed: false, note: '缺少 wbi 密钥，参数已抬高但未重签' };
  }

  const signed = signUrl(url, mixinKey);
  return { url: signed.href, body, originalUrl, originalBody, upgraded: true, signed: true };
}

/* ------------------------------------------------------------------ *
 * 发送（含策略重试）
 * ------------------------------------------------------------------ */
async function sendWithB(method, url, headers, body) {
  const cookie = getEffectiveCookie();
  const strategy = await resolveStrategy();
  const order = [strategy, ...STRATEGIES.map((_, i) => i).filter((i) => i !== strategy)];

  let lastErr = '';
  for (let attempt = 0; attempt < order.length; attempt++) {
    const res = await httpRequest({
      method,
      url,
      headers,
      body,
      cookie,
      strategyIdx: order[attempt],
      timeout: DEFAULTS.timeoutMs
    });
    // 有 HTTP 结果就直接交给上层判断业务码；只有纯网络错误才值得换一种发送方式
    if (res.ok || res.text) return res;
    lastErr = res.error || 'http' + res.status;
    if (attempt < order.length - 1) log.warn(`发送方式 ${order[attempt] + 1} 失败（${lastErr}），换下一种重试`);
  }
  return { ok: false, status: 0, text: '', headersRaw: '', error: lastErr || 'unknown' };
}

/* ------------------------------------------------------------------ *
 * mode: proxy
 * ------------------------------------------------------------------ */
function cacheKey(ep, url, body) {
  return `${ep.id}|${url}|${body ? body.length + ':' + body.slice(0, 64) : ''}`;
}

/**
 * 这些业务码很可能是「抬高参数 / 重签名」引起的，用原始参数再试一次。
 * 其它码（如 -10403 大会员专享、-101 未登录）重试没有意义，直接回退给页面。
 */
const RETRY_ON_ORIGINAL = new Set([-400, -403, -404, -405, -412]);

export async function handleProxy(ep, msg) {
  const method = msg.method || 'GET';
  const ttl = store.getCacheTtl();
  const key = cacheKey(ep, msg.url, method === 'POST' ? msg.body : '');

  const cached = cacheGet(key);
  if (cached) {
    stats.cacheServed++;
    log.debug(`[缓存命中] ${ep.id}`);
    setCurrentMedia(ep.id, cached.summary, true);
    return { passthrough: false, status: cached.status, statusText: 'OK', body: cached.body, headersRaw: cached.headersRaw, cached: true };
  }

  // 记下发起时的借用来源。切号 / 改借用源会 resetCache()，
  // 但已经在途的请求不受影响 —— 它回来时若还按原样写进缓存，
  // 就会把上一个账号的播放地址继续供出去最多一个 TTL（默认 120 秒）。
  // 用代际号比对：缓存被清空过就不写，宁可不缓存也不能供错号的响应。
  const myGen = cacheGeneration();

  const result = await coalesce(key, async () => {
    const prep = await prepare(ep, method, msg.url, msg.body);
    const headers = buildHeaders(msg.headers, method);

    let res = await sendWithB(method, prep.url, headers, prep.body);

    // 业务错误：签名/参数被拒则退回未抬高参数的原始请求再试一次
    let json = parseJsonSafe(res.text);
    if (res.ok && json && json.code !== 0 && prep.upgraded && RETRY_ON_ORIGINAL.has(json.code)) {
      log.warn(`${ep.id} 参数被拒（code=${json.code}），退回原始参数重试`);
      // 必须连 body 一起退回：POST 端点（/ogv/player/playview、/ogv/player/playurl）是 csrf:true，
      // prepare() 已把 B 的 bili_jct 写进 prep.body。这里若还用 msg.body，
      // 等于把 A 的 csrf 配 B 的 SESSDATA 发出去 —— 服务端必然再拒一次，
      // 重试对最需要它的番剧端点反而永远失败。
      res = await sendWithB(method, prep.originalUrl, buildHeaders(msg.headers, method), prep.originalBody);
      json = parseJsonSafe(res.text);
    }

    if (!res.ok) {
      stats.proxyFail++;
      stats.lastError = `${ep.id} ${res.error || 'HTTP ' + res.status}`;
      log.warn(`代理失败 ${ep.id}：${res.error || 'HTTP ' + res.status}，已回退为 A 账号原始请求`);
      return { passthrough: true };
    }

    if (json && json.code !== 0) {
      stats.proxyFail++;
      stats.lastError = `${ep.id} code=${json.code} ${json.message || ''}`;
      log.warn(`代理返回业务错误 ${ep.id}：code=${json.code} ${json.message || ''}`);
      if (json.code === -101 || json.code === -10403) {
        const curBorrowId = borrowAccountId();
        if (curBorrowId) markInvalid(curBorrowId, `${json.code} ${json.message || ''}`);
      }
      return { passthrough: true };
    }

    const summary = summarize(res.text);
    stats.proxyOk++;
    stats.lastEndpoint = ep.id;
    setCurrentMedia(ep.id, summary, false);
    log.info(
      `代理成功 ${ep.id}${prep.upgraded ? '（已抬高画质参数' + (prep.signed ? '并重签 wbi）' : '）') : '（原始参数）'}` +
        ` 画质=${summary.quality ?? '-'} 码流=${summary.videoStreams.length} 条` +
        (prep.note ? ` [${prep.note}]` : '')
    );

    const patched = patchJsonText(res.text, {
      patchVip: store.isPatchUi(),
      region: store.getRegion(),
      codec: store.getCodec()
    });
    return {
      passthrough: false,
      status: res.status,
      statusText: res.statusText || 'OK',
      body: patched,
      headersRaw: res.headersRaw,
      summary
    };
  });

  if (!result.passthrough && ttl > 0 && myGen === cacheGeneration()) {
    cacheSet(key, { status: result.status, statusText: result.statusText, body: result.body, headersRaw: result.headersRaw, summary: result.summary }, ttl);
  }
  return result;
}

/* ------------------------------------------------------------------ *
 * 对外入口
 * ------------------------------------------------------------------ */
/**
 * 处理来自主世界钩子的一条请求。
 * @returns {Promise<object>} 至少包含 passthrough:boolean
 */
export async function handleRequest(msg) {
  const ep = resolveEndpoint(msg.url, msg.method);
  if (!ep) return { passthrough: true };
  if (!store.isEnabled() || !hasCookie()) {
    stats.passthrough++;
    return { passthrough: true };
  }

  try {
    return await handleProxy(ep, msg);
  } catch (e) {
    stats.proxyFail++;
    stats.lastError = String((e && e.message) || e);
    log.error('代理异常', e);
    return { passthrough: true };
  }
}

/**
 * 预热缓存：在播放器发起首个 playurl 之前就把 B 侧的响应准备好。
 * 这是「首次打开就能出大会员画质、且不必反复切选集」的关键优化。
 */
export function prefetch(url, method, body, headers) {
  return handleRequest({ url, method: method || 'GET', body: body || '', headers: headers || {} }).catch(() => null);
}

export function resetCache() {
  cacheClear();
}

/** 转发缓存模块的统计，供 UI 显示 */
export function cacheStats() {
  return cacheInfo();
}