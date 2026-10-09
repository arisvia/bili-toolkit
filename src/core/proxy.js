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
import { signUrl, hasWbiSignature } from './wbi.js';
import { patchJsonText } from './patch.js';
import { cacheGet, cacheSet, cacheClear, coalesce, cacheInfo } from './cache.js';
import { log, stats, setCurrentMedia } from './log.js';

/** 从 B 的响应里把「实际拿到的播放流」提取出来，用于日志与面板实时展示 */
export function summarize(text) {
  try {
    const o = JSON.parse(text);
    const d = o && o.data;
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

    return {
      quality: src.quality !== undefined ? src.quality : null,
      videoStreams,
      audioStreams: audioStreams.length,
      durl: Array.isArray(src.durl) ? src.durl.length : 0,
      formats: Array.isArray(d.support_formats) ? d.support_formats.map((f) => f.quality) : [],
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
  return s + (s.includes('?') ? '&' : '') + 'csrf=' + encodeURIComponent(csrf);
}

/**
 * 准备最终的请求：抬高参数 + 注入 csrf + 重签 wbi。
 * @returns {{url:string, body:string, upgraded:boolean, signed:boolean, note?:string}}
 */
async function prepare(ep, method, rawUrl, rawBody) {
  const url = new URL(rawUrl);
  applyQuality(ep, url);

  const csrf = ep.csrf ? getBCsrf() : '';
  if (csrf) {
    url.searchParams.set('csrf', csrf);
    url.searchParams.delete('csrf_token');
  }

  let body = method === 'POST' && rawBody ? injectCsrf(rawBody, csrf) : '';

  // wbi 签名：参数动过就必须重签，否则 -403
  const needsSign = ep.wbi === 'required' || (ep.wbi === 'if-present' && hasWbiSignature(url));
  if (!needsSign) {
    return { url: url.href, body, upgraded: true, signed: false };
  }

  const mixinKey = await ensureMixinKey();
  if (!mixinKey) {
    if (ep.wbi === 'required') {
      // 拿不到密钥就不要改参数，否则签名必挂；退回原样请求，至少能播放。
      // 这个状态必须让用户看得见 —— 否则表现为「画质死活不升级」且毫无线索。
      stats.signedFallback = (stats.signedFallback || 0) + 1;
      const orig = new URL(rawUrl);
      const note = '缺少 wbi 密钥，已退回原始参数（画质不升级）';
      log.warn(ep.id, note);
      return {
        url: orig.href,
        body: method === 'POST' && rawBody ? injectCsrf(rawBody, csrf) : '',
        upgraded: false,
        signed: false,
        note
      };
    }
    return { url: url.href, body, upgraded: true, signed: false, note: '缺少 wbi 密钥，参数已抬高但未重签' };
  }

  const signed = signUrl(url, mixinKey);
  return { url: signed.href, body, upgraded: true, signed: true };
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

  const result = await coalesce(key, async () => {
    const prep = await prepare(ep, method, msg.url, msg.body);
    const headers = buildHeaders(msg.headers, method);

    let res = await sendWithB(method, prep.url, headers, prep.body);

    // 业务错误：签名/参数被拒则退回未抬高参数的原始请求再试一次
    let json = parseJsonSafe(res.text);
    if (res.ok && json && json.code !== 0 && prep.upgraded && RETRY_ON_ORIGINAL.has(json.code)) {
      log.warn(`${ep.id} 参数被拒（code=${json.code}），退回原始参数重试`);
      res = await sendWithB(method, msg.url, buildHeaders(msg.headers, method), method === 'POST' ? msg.body : '');
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
      return { passthrough: true };
    }

    const summary = summarize(res.text);
    stats.proxyOk++;
    stats.lastEndpoint = ep.id;
    setCurrentMedia(ep.id, summary, false);
    log.info(
      `代理成功 ${ep.id}${prep.upgraded ? '（已抬高画质参数' + (prep.signed ? '并重签 wbi）' : '）') : '（原始参数）'}` +
        ` 画质=${summary.quality ?? '-'} 码流=${summary.videoStreams} 条` +
        (prep.note ? ` [${prep.note}]` : '')
    );

    const patched = patchJsonText(res.text, { patchVip: store.isPatchUi(), region: store.getRegion() });
    return {
      passthrough: false,
      status: res.status,
      statusText: res.statusText || 'OK',
      body: patched,
      headersRaw: res.headersRaw,
      summary
    };
  });

  if (!result.passthrough && ttl > 0) {
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