/**
 * 列出 playurl 响应里引用的全部 CDN 域名。
 *
 *   node tools/cdn-domains.mjs
 *
 * 回答的是「自建代理该按哪些域名分流」这个问题。
 *
 * 关键事实（实测，2026-10）：**视频字节不在 api.bilibili.com 上**。
 * playurl 响应只是 JSON，里面的 `dash.video[].baseUrl` 才指向真正的 CDN。
 * 所以只代理 `api.bilibili.com` 的流量是每部片几十 KB 的 JSON，
 * 而几百 MB 的媒体仍由播放器直连 CDN —— 分流规则按域名写就够，不必按路径。
 *
 * 需要凭证；输出只含域名，不含任何 URL 参数。
 */
import { loadCredentials, printCredentialHelp } from './credentials.mjs';

const cred = loadCredentials();
if (!cred.b) printCredentialHelp('B');
const B = String(cred.b).replace(/[\r\n]+/g, '; ').replace(/;\s*;/g, '; ').trim();

const HEADERS = {
  Referer: 'https://www.bilibili.com/',
  Origin: 'https://www.bilibili.com',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
};
const api = async (u) => (await fetch(u, { headers: { ...HEADERS, Cookie: B } })).json();

/** 递归收集所有 URL 字符串的主机名 */
const hostsOf = (root) => {
  const set = new Set();
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    for (const v of Object.values(o)) {
      if (typeof v === 'string' && v.startsWith('http')) {
        try {
          set.add(new URL(v).hostname);
        } catch {
          /* 不是 URL，忽略 */
        }
      } else walk(v);
    }
  };
  walk(root);
  return [...set].sort();
};

/** 把逐个随机的 CDN 主机名归并成后缀，便于写分流规则 */
function toRules(hosts) {
  const counts = new Map();
  for (const h of hosts) {
    const parts = h.split('.');
    // 末两段当作基础域（bilivideo.cn / mountaintoys.cn）
    const base = parts.slice(-2).join('.');
    counts.set(base, (counts.get(base) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

async function probe(title, url) {
  const r = await api(url);
  if (r.code !== 0) {
    console.log(`【${title}】code=${r.code} ${r.message || ''} —— 跳过`);
    return;
  }
  const dash = r.data && r.data.dash;
  const max = dash && dash.video && dash.video.length ? Math.max(...dash.video.map((v) => v.id)) : null;
  const hosts = hostsOf(r.data);
  console.log(`\n【${title}】quality=${r.data.quality}${max ? ' dash最大流=' + max : ''}`);
  console.log(`  引用 ${hosts.length} 个主机名，归并后 ${toRules(hosts).length} 条规则：`);
  for (const [base, n] of toRules(hosts)) console.log(`    ${n.toString().padStart(3)} × ${base}`);
  return hosts;
}

// ---- 普通视频 ----
const pop = await api('https://api.bilibili.com/x/web-interface/popular?ps=20&pn=1');
const first = pop.data.list[0];
const view = await api('https://api.bilibili.com/x/web-interface/view?bvid=' + first.bvid);
const videoHosts = await probe(
  '普通视频 ' + first.bvid,
  `https://api.bilibili.com/x/player/wbi/playurl?bvid=${first.bvid}&cid=${view.data.cid}&qn=127&fnval=4048&fourk=1&platform=pc`
);

// ---- 番剧 ----
const tl = await api('https://api.bilibili.com/pgc/web/timeline?types=1&page=1');
const seasonId = tl.result && tl.result[0] && tl.result[0].season_id;
if (seasonId) {
  const s = await api('https://api.bilibili.com/pgc/view/web/season?season_id=' + seasonId);
  const ep = s.data.episodes[0];
  const pgcHosts = await probe(
    '番剧 ' + s.data.title,
    `https://api.bilibili.com/pgc/player/web/playurl?ep_id=${ep.ep_id}&cid=${ep.cid}&qn=127&fnval=4048&fourk=1`
  );
  if (videoHosts && pgcHosts) {
    const onlyPgc = pgcHosts.filter((h) => !videoHosts.includes(h));
    if (onlyPgc.length) console.log('\n  仅番剧出现的 CDN：\n    ' + onlyPgc.join('\n    '));
  }
}

console.log('\n────────────────────────────────────────');
console.log('分流建议（见 findings §19）：');
console.log('  走代理  api.bilibili.com          ← 区域判定发生在这里，流量只有 JSON');
console.log('  直连    *.bilivideo.com / *.bilivideo.cn / CDN 后缀   ← 视频字节，代理就卡');
console.log('  按需    akamaized.net             ← 境外独占内容的唯一源，慢是物理限制');