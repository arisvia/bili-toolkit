/**
 * Cookie 原文解析 —— 主世界面板、cookie-helper.html、命令行工具共用同一份实现。
 *
 * 为什么要吃「DevTools 原始复制内容」：
 *   在 Chrome 的 Application → Cookies 里 Ctrl+A / Ctrl+C，出来的是 **12 列 TSV**：
 *     Name ⇥ Value ⇥ Domain ⇥ Path ⇥ Expires ⇥ Size ⇥ HTTPOnly ⇥ Secure ⇥ SameSite ⇥ Priority ⇥ PartitionKey
 *   不是「name⇥value」两列。所以只能取前两列 —— 否则 Domain/Path 这些会被
 *   一起拼进值里，保存后必然失效。这是实测踩过的坑。
 *
 * 另外注意：SESSDATA 是 HttpOnly，document.cookie 拿不到，
 * 因此「从 DevTools 面板复制」是唯一可行的取用方式，没有捷径可绕。
 */

/** 字段分级 —— 全项目唯一事实源，校验器与面板都读这里。 */
export const TIERS = {
  SESSDATA: { tier: 'required', label: '必需' },
  bili_jct: { tier: 'ogv', label: '番剧必需' },
  'bili-jct': { tier: 'ogv', label: '番剧必需' },
  DedeUserID: { tier: 'recommended', label: '建议' },
  buvid3: { tier: 'recommended', label: '防-412' },
  buvid4: { tier: 'recommended', label: '防-412' },
  bili_ticket: { tier: 'recommended', label: '反爬' },
  bili_ticket_expires: { tier: 'recommended', label: '反爬' },
  buvid_fp: { tier: 'recommended', label: '设备' },
  b_nut: { tier: 'recommended', label: '设备' },
  b_lsid: { tier: 'recommended', label: '设备' },
  _uuid: { tier: 'recommended', label: '设备' },
  sid: { tier: 'never', label: '别混用' }
};

const RECOMMENDED = [
  'SESSDATA', 'DedeUserID', 'bili_jct', 'bili-jct', 'buvid3', 'buvid4',
  'bili_ticket', 'bili_ticket_expires', 'buvid_fp', 'b_nut', 'b_lsid', '_uuid'
];

/** 最小的必需集：登录态 + 番剧 csrf */
export const MINIMAL = ['SESSDATA', 'bili_jct', 'bili-jct'];

export function tierOf(name) {
  return TIERS[name] || { tier: 'optional', label: '可选' };
}

/**
 * 解析任意来源的 Cookie 文本。
 * @param {string} raw
 * @returns {{fields: Object, format: string}}
 */
export function parseCookieText(raw) {
  const text = String(raw || '').trim();
  const fields = {};
  if (!text) return { fields, format: '' };

  // 1) Chrome 导出的 JSON
  if (text[0] === '[' || text[0] === '{') {
    try {
      const j = JSON.parse(text);
      const arr = Array.isArray(j) ? j : j.cookies || [];
      for (const c of arr) if (c && c.name) fields[c.name] = String(c.value ?? '');
    } catch {
      /* 不是 JSON，往下走 */
    }
    if (Object.keys(fields).length) return { fields, format: 'Chrome 导出的 JSON' };
  }

  const lines = text.split(/\r?\n/).filter((l) => l.trim());

  // 2) TSV —— 关键：只取前两列
  if (lines.some((l) => l.includes('\t'))) {
    let wide = 0;
    for (const line of lines) {
      if (!line.includes('\t')) continue;
      const cols = line.split('\t');
      const name = (cols[0] || '').trim();
      if (!name) continue;
      let value = (cols[1] ?? '').trim();
      if (value.length > 1 && value[0] === '"' && value[value.length - 1] === '"') {
        value = value.slice(1, -1).replace(/""/g, '"');
      }
      if (cols.length > 2) wide++;
      fields[name] = value;
    }
    if (Object.keys(fields).length) {
      return {
        fields,
        format: wide > 0
          ? `DevTools 表格文本（${Object.keys(fields).length} 行 × ${12} 列，已只取 Name/Value）`
          : '表格文本（两列）'
      };
    }
  }

  // 3) Cookie 字符串
  //
  // 难点：bmg_af_sc={"none":{"on":1},"sgp":{"on":1}} 这类字段的值里本身含 ; 和 "，
  // 所以不能用「下一个 ;name=」去找边界。实测那种写法会把 DedeUserID 的值
  // 错误地粘成 "42; sid=XXX"。
  //
  // 正确做法：逐字符扫描每个 ';',只有当它后面**紧跟合法 cookie 名 + '='** 时
  // 才算真分隔符。cookie 名只允许 [A-Za-z0-9_.-]，而 bmg_af_sc 内部必然出现
  // { " : , 这些字符，所以值内部的 ';' 自然不会命中。
  const segments = [];
  let segStart = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== ';') continue;
    let j = i + 1;
    while (j < text.length && /\s/.test(text[j])) j++;
    let k = j;
    while (k < text.length && /[A-Za-z0-9_.\-]/.test(text[k])) k++;
    if (k > j && k - j <= 64 && text[k] === '=') {
      const seg = text.slice(segStart, i);
      if (seg.includes('=')) segments.push(seg);
      segStart = j;
      i = j - 1; // 从名字起点继续
    }
  }
  const tailSeg = text.slice(segStart);
  if (tailSeg.includes('=')) segments.push(tailSeg);

  for (const seg of segments) {
    const i = seg.indexOf('=');
    if (i <= 0) continue;
    const name = seg.slice(0, i).trim();
    if (name) fields[name] = seg.slice(i + 1).trim();
  }
  if (Object.keys(fields).length) return { fields, format: 'Cookie 字符串' };

  return { fields, format: '无法识别' };
}

/** 按预设挑字段：min | recommended | all（all 会剔除 sid） */
export function pickFields(fields, preset) {
  const keys = Object.keys(fields);
  if (preset === 'min') return keys.filter((k) => MINIMAL.includes(k));
  if (preset === 'recommended') return keys.filter((k) => RECOMMENDED.includes(k));
  return keys.filter((k) => k !== 'sid');
}

/** 字段排序：必需 → 番剧 → 建议 → 别混用 → 可选 */
const ORDER = { required: 0, ogv: 1, never: 1, recommended: 2, optional: 3 };

export function sortFields(keys) {
  return keys.slice().sort((a, b) => {
    const d = ORDER[tierOf(a).tier] - ORDER[tierOf(b).tier];
    return d !== 0 ? d : a.localeCompare(b);
  });
}

/** 组装成 Cookie 字符串 */
export function joinCookie(fields, keys) {
  return keys
    .filter((k) => fields[k] !== undefined)
    .map((k) => `${k}=${fields[k]}`)
    .join('; ');
}

/** 面板里的帮助文案 */
export function helperHelp() {
  return [
    '【怎么拿】',
    'F12 → Application → Cookies → https://www.bilibili.com → 全选复制',
    '',
    '把复制到的内容原样粘进上面的框即可 —— 不用整理格式：',
    '· DevTools 的 12 列表格文本（默认就是这个）',
    '· name=value; name=value 字符串',
    '· Chrome 导出的 JSON',
    '',
    '【必需】',
    '· SESSDATA —— 登录态。它是 HttpOnly，document.cookie 拿不到，',
    '  所以只能从 DevTools 面板复制，这是唯一途径。',
    '· bili_jct —— 番剧 OGV 必需（playview 是 POST 接口，要 csrf）。',
    '',
    '【建议】',
    '· DedeUserID / buvid3 / buvid4 / bili_ticket',
    '  平时测不出差别，但触发风控（-412）时会要命，且脚本无法补救。',
    '',
    '【别带】',
    '· sid —— 与 SESSDATA 成对的服务端会话，不要混入另一个账号的。',
    '',
    'Cookie 只写入本机的油猴存储，不会上传到任何地方。'
  ].join('\n');
}