/**
 * 首屏与 SPA 路由切换时的播放地址预热（UGC 普通投稿 + OGV 新版番剧）。
 */

export function createPrefetcher(getState, post) {
  let lastPrefetchKey = '';

  function tryPrefetch() {
    const st = getState();
    if (!st.doPrefetch) return;
    const path = location.pathname;

    if (path.indexOf('/video/') === 0) {
      const s = window.__INITIAL_STATE__;
      const vd = s && s.videoData;
      if (!vd || !vd.bvid || !vd.cid) return;
      const prefetchUrl =
        'https://api.bilibili.com/x/player/wbi/playurl?bvid=' +
        encodeURIComponent(vd.bvid) +
        '&cid=' +
        encodeURIComponent(vd.cid) +
        '&fnver=0&fnval=4048&fourk=1';
      if (prefetchUrl === lastPrefetchKey) return;
      lastPrefetchKey = prefetchUrl;
      post({ type: 'prefetch', token: st.token, url: prefetchUrl, method: 'GET', headers: {} });
      return;
    }

    if (path.indexOf('/bangumi/play/') === 0) {
      const s2 = window.__INITIAL_STATE__;
      const vi = s2 && (s2.videoInfo || s2.epInfo || null);
      let epId = vi && vi.ep_id;
      let cid = vi && vi.cid;
      if (!epId || !cid) {
        const h = window.__PLAYURL_HYDRATE_DATA__;
        const arc = h && h.result && h.result.arc;
        const m = path.match(/^\/bangumi\/play\/ep(\d+)/);
        if (!epId && m) epId = m[1];
        if (!cid && arc) cid = arc.cid;
      }
      if (!epId || !cid) return;
      const url =
        'https://api.bilibili.com/ogv/player/playview?biz_type=ogv&scene=normal&ep_id=' +
        encodeURIComponent(epId) +
        '&cid=' +
        encodeURIComponent(cid);
      if (url === lastPrefetchKey) return;
      lastPrefetchKey = url;
      post({ type: 'prefetch', token: st.token, url, method: 'GET', body: '', headers: {} });
    }
  }

  function start() {
    const prefetchTimer = setInterval(tryPrefetch, 1200);
    setTimeout(() => clearInterval(prefetchTimer), 30000);

    ['pushState', 'replaceState'].forEach((name) => {
      const orig = history[name];
      if (typeof orig !== 'function') return;
      history[name] = function () {
        lastPrefetchKey = '';
        const r = orig.apply(this, arguments);
        tryPrefetch();
        return r;
      };
    });
    window.addEventListener('popstate', () => {
      lastPrefetchKey = '';
      tryPrefetch();
    });

    tryPrefetch();
  }

  return { start, tryPrefetch };
}
