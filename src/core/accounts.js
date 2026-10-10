/**
 * 多账号池 —— 账号列表、当前身份、借用来源的解析。
 *
 * 这个模块只做**纯数据与决策**，不发任何网络请求：
 *   · 存储形状与旧版单账号数据的兼容迁移
 *   · 「当前是谁」与「从谁那里借」的解耦与自动选择
 * 身份探测（nav 请求）在 session.js 侧做，结果回写到这里。
 *
 * 三个概念必须分开，混在一起是这个功能最容易出错的地方：
 *   activeId  浏览器当前登录的是谁（一键切号改的就是它）
 *   borrowId  显式指定的借用来源；null = 自动
 *   自动解析  激活号有大会员就用它，没有就从池里找一个有大会员的
 *
 * 借用来源与当前身份分开，是为了让「用大会员号借权益、用普通号发弹幕」成立。
 * 把两者绑死的话，切到无权益号就立刻没有画质了 —— 那正是这个功能要解决的事。
 */
import { store } from './store.js';
import { sanitizeCookie, parseCookie, cookieFingerprint } from './cookie.js';
import { PROBE_TTL_MS } from '../config.js';
import { TEXT } from './text.js';
import { log } from './log.js';

/**
 * 账号 id 用 Cookie 指纹（SESSDATA 的 FNV 哈希）当键。
 * 好处：同一个账号粘贴两次不会产生重复条目，id 也不会泄露任何凭证内容。
 */
export function fingerprintId(cookie) {
  const fp = cookieFingerprint(sanitizeCookie(cookie));
  return fp && fp !== 'none' ? fp : '';
}

export function hasVip(account) {
  return !!account && Number(account.vipStatus) === 1;
}

/* ------------------------------------------------------------------ *
 * 存储
 * ------------------------------------------------------------------ */

function emptyPool() {
  return { v: 1, accounts: [], activeId: '', borrowId: '' };
}

function normalizeAccount(raw) {
  const cookie = sanitizeCookie(raw.cookie);
  const parsed = parseCookie(cookie);
  return {
    id: String(raw.id || fingerprintId(cookie) || ''),
    cookie,
    label: String(raw.label || ''),
    mid: String(raw.mid ?? parsed.DedeUserID ?? ''),
    uname: String(raw.uname || ''),
    face: String(raw.face || ''),
    vipStatus: Number(raw.vipStatus) === 1 ? 1 : 0,
    vipType: Number(raw.vipType) || 0,
    checkedAt: Number(raw.checkedAt) || 0,
    addedAt: Number(raw.addedAt) || 0
  };
}

/** 补齐缺失的 / 清掉悬空的 id，保证池内自洽 */
function normalizePool(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const out = emptyPool();
  out.borrowId = p.borrowId ? String(p.borrowId) : '';

  const seen = new Set();
  const list = Array.isArray(p.accounts) ? p.accounts : [];
  for (const raw2 of list) {
    if (!raw2 || typeof raw2 !== 'object') continue;
    const acc = normalizeAccount(raw2);
    // 没有 SESSDATA 的条目毫无用处（借不到任何权益），直接丢弃。
    // 这里判 Cookie 字段本身而不是判 id —— 显式写了一个 id 的坏条目照样要清掉。
    if (!acc.id || !parseCookie(acc.cookie).SESSDATA || seen.has(acc.id)) continue;
    seen.add(acc.id);
    out.accounts.push(acc);
  }

  const activeId = p.activeId ? String(p.activeId) : '';
  out.activeId = seen.has(activeId) ? activeId : '';
  if (out.borrowId && !seen.has(out.borrowId)) out.borrowId = '';
  // 从没设过当前身份时，姑且用第一个，避免界面完全空着无从下手
  if (!out.activeId && out.accounts.length) out.activeId = out.accounts[0].id;
  return out;
}

/**
 * 兼容旧版单账号数据。
 *
 * 旧版把 Cookie 存在 `b.cookie`、身份存在 `b.lastAccount`，两者都是扁平键。
 * 升级后第一次读到 `b.accounts` 为空时，把它们收编进池子，然后**继续镜像写回** `b.cookie`
 * （不是删掉），这样即使用户降级回旧版本脚本，设置也不会凭空消失。
 */
function migrateLegacy() {
  const legacyCookie = store.getLegacyCookie();
  const legacyAccount = store.getLegacyAccount();
  if (!legacyCookie) return false;

  const id = fingerprintId(legacyCookie);
  if (!id) return false;

  const acc = normalizeAccount({
    id,
    cookie: legacyCookie,
    mid: legacyAccount && legacyAccount.mid,
    uname: legacyAccount && legacyAccount.uname,
    vipStatus: legacyAccount && legacyAccount.vipStatus,
    vipType: legacyAccount && legacyAccount.vipType,
    // 迁移来的探测时间是旧版的，避免刚升级就为了一次历史结论再发一遍 nav
    checkedAt: (legacyAccount && legacyAccount.at) || 0,
    addedAt: (legacyAccount && legacyAccount.at) || Date.now()
  });

  store.setPool({ v: 1, accounts: [acc], activeId: id, borrowId: '' });
  // 只记指纹，绝不把 uname/mid 之外的任何内容带进日志
  log.debug('旧的单账号设置已并入账号池', acc.uname || acc.mid || id);
  return true;
}

/** 读池子（必要时先迁移旧数据） */
export function pool() {
  const raw = store.getPool();
  if (raw && typeof raw === 'object' && Array.isArray(raw.accounts) && raw.accounts.length) {
    return normalizePool(raw);
  }
  // 池子是空的：可能是首次使用，也可能装着一个没有 SESSDATA 的废条目。
  // 两种情况都再试一次旧数据迁移，之后就落一个空池。
  if (migrateLegacy()) return normalizePool(store.getPool());
  store.setPool(emptyPool());
  return emptyPool();
}

export function savePool(p) {
  store.setPool(normalizePool(p));
}

export function list() {
  return pool().accounts;
}

export function byId(id) {
  if (!id) return null;
  return pool().accounts.find((a) => a.id === id) || null;
}

export function activeAccount() {
  const p = pool();
  return byId(p.activeId);
}

/* ------------------------------------------------------------------ *
 * 借用来源
 * ------------------------------------------------------------------ */
/**
 * 解析「当前该用谁的 Cookie 去取播放地址」。
 *
 * @returns {{account: object|null, mode: 'manual'|'auto'|'self', reason: string}}
 *   manual 显式指定了借用来源
 *   auto   自动挑了一个池内有大会员的号
 *   self   池里只有激活号，或没有任何号有会员 —— 只能用自己的
 */
export function resolveBorrow() {
  const p = pool();
  if (p.borrowId) {
    const acc = p.accounts.find((a) => a.id === p.borrowId);
    if (acc) return { account: acc, mode: 'manual', reason: '' };
  }

  const active = p.accounts.find((a) => a.id === p.activeId);
  if (!active) return { account: null, mode: 'self', reason: TEXT.pool.borrowEmpty };
  if (hasVip(active)) return { account: active, mode: 'auto', reason: '' };

  const donor = p.accounts.find((a) => a.id !== active.id && hasVip(a));
  if (donor) return { account: donor, mode: 'auto', reason: TEXT.pool.borrowFromMember };

  const known = p.accounts.filter((a) => a.checkedAt > 0);
  if (known.length === p.accounts.length) return { account: active, mode: 'self', reason: TEXT.pool.borrowNoMember };
  return { account: active, mode: 'self', reason: TEXT.pool.borrowUnprobed };
}

/** 借用来源的 Cookie；没有可用账号时返回空串 */
export function borrowCookie() {
  const r = resolveBorrow();
  return r.account ? r.account.cookie : '';
}

export function borrowAccountId() {
  const r = resolveBorrow();
  return r.account ? r.account.id : '';
}

/* ------------------------------------------------------------------ *
 * 增删改
 * ------------------------------------------------------------------ */

/**
 * 加入账号。已存在（同 SESSDATA）则就地更新，返回同一个 id。
 * @returns {{ok:boolean, id:string, reason:string, isNew:boolean}}
 */
export function addAccount(cookieInput, meta = {}) {
  const cookie = sanitizeCookie(cookieInput);
  if (!cookie) return { ok: false, id: '', reason: 'empty', isNew: false };

  const parsed = parseCookie(cookie);
  if (!parsed.SESSDATA) return { ok: false, id: '', reason: 'noSessdata', isNew: false };

  const p = pool();
  const id = fingerprintId(cookie);
  const mid = String(meta.mid || parsed.DedeUserID || '');
  const existing = p.accounts.find((a) => a.id === id) || (mid ? p.accounts.find((a) => a.mid && a.mid === mid) : null);
  // Cookie 变了就是换了凭证 —— 旧的探测结论（会员状态、昵称）全部作废。
  // 只清 checkedAt 而留着 vipStatus 会出现这种假象：
  // 用户粘了一份已失效的 Cookie 进来、探测失败，面板却继续显示「大会员」。
  const sameCookie = !!existing && existing.cookie === cookie;

  const acc = normalizeAccount({
    id,
    cookie,
    // 名字是用户起的，与 Cookie 无关，换 Cookie 时必须保住
    label: meta.label || (existing && existing.label) || '',
    // mid 优先用探测结果，其次用 Cookie 里的 DedeUserID —— 后者足以在池里区分账号
    mid: meta.mid || parsed.DedeUserID || (sameCookie && existing.mid) || '',
    uname: meta.uname || (sameCookie && existing.uname) || '',
    face: meta.face || (sameCookie && existing.face) || '',
    vipStatus: sameCookie && meta.vipStatus === undefined ? existing.vipStatus : meta.vipStatus,
    vipType: sameCookie && meta.vipType === undefined ? existing.vipType : meta.vipType,
    checkedAt: sameCookie ? existing.checkedAt : 0,
    addedAt: (existing && existing.addedAt) || Date.now()
  });

  // 如果是同一个账号（同 mid）刷新了新 SESSDATA，清理旧 id 条目并将引用迁移到新 id
  p.accounts = p.accounts.filter((a) => a.id !== id && (!existing || a.id !== existing.id)).concat([acc]);
  if (!p.activeId || (existing && p.activeId === existing.id)) p.activeId = id;
  if (existing && p.borrowId === existing.id) p.borrowId = id;
  savePool(p);
  return { ok: true, id, reason: '', isNew: !existing };
}

export function removeAccount(id) {
  const p = pool();
  const acc = p.accounts.find((a) => a.id === id);
  if (!acc) return { ok: false, reason: 'notFound' };

  p.accounts = p.accounts.filter((a) => a.id !== id);
  if (p.activeId === id) p.activeId = p.accounts.length ? p.accounts[0].id : '';
  if (p.borrowId === id) p.borrowId = '';
  savePool(p);
  return { ok: true, reason: '' };
}

export function renameAccount(id, label) {
  const p = pool();
  const acc = p.accounts.find((a) => a.id === id);
  if (!acc) return false;
  acc.label = String(label || '').slice(0, 40);
  savePool(p);
  return true;
}

/** 切换「浏览器当前身份」（只改记录，不动浏览器 Cookie） */
export function setActiveId(id) {
  const p = pool();
  if (id && !p.accounts.some((a) => a.id === id)) return false;
  p.activeId = id ? String(id) : '';
  savePool(p);
  return true;
}

/** 指定借用来源；传 null 恢复自动挑选 */
export function setBorrowId(id) {
  const p = pool();
  if (id && !p.accounts.some((a) => a.id === id)) return false;
  p.borrowId = id ? String(id) : '';
  savePool(p);
  return true;
}

/** 回写探测结果（session.js 在拿到 nav 响应后调用） */
export function markProbed(id, info) {
  const p = pool();
  const acc = p.accounts.find((a) => a.id === id);
  if (!acc) return false;
  acc.mid = String(info.mid ?? acc.mid);
  acc.uname = String(info.uname ?? acc.uname);
  if (info.face) acc.face = String(info.face);
  acc.vipStatus = Number(info.vipStatus) === 1 ? 1 : 0;
  acc.vipType = Number(info.vipType) || 0;
  acc.checkedAt = Date.now();
  savePool(p);
  return true;
}

/** 探测结果是否已过期（从未探过也算过期） */
export function needsProbe(account, now = Date.now()) {
  if (!account) return false;
  return now - (Number(account.checkedAt) || 0) > PROBE_TTL_MS;
}

/** 清空整个池子（含旧版镜像键）。目前只有测试用，但语义明确，单点保留比散落各处好。 */
export function clearPool() {
  store.setPool(emptyPool());
  store.setLegacyCookie('');
  store.setLegacyAccount(null);
}