/**
 * 多账号池测试：池的形状、迁移、借用来源的自动解析、切换时的字段整组替换。
 *   node test/accounts.test.mjs
 */
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;

function check(name, cond, extra) {
  if (cond) console.log(`  \x1b[32m✔\x1b[0m ${name}`);
  else {
    failed++;
    console.error(`  \x1b[31m✖\x1b[0m ${name}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`);
  }
}

/* ---------------- mock 沙箱 ---------------- */

// 账号池里存的应该是「最小字段集」：只有身份字段，没有设备字段。
// 设备字段属于浏览器这台设备，不属于任何账号（实测见 findings §16）。
const A_COOKIE = 'SESSDATA=a-sess; DedeUserID=111; bili_jct=a-csrf; sid=a-sid';
const B_COOKIE = 'SESSDATA=b-sess; DedeUserID=222; bili_jct=b-csrf; sid=b-sid';
/** 带设备字段的账号（从 DevTools 原样粘贴会是这样），用来验证切号不会误删设备字段 */
const B_WITH_DEVICE = B_COOKIE + '; buvid3=b-dev3; buvid4=b-dev4; bili_ticket=b-ticket';

/** 浏览器里当前真实存在的 Cookie（GM.cookie.set 会写进来） */
function makeContext(seed = {}) {
  const storeMap = new Map(Object.entries(seed));
  const browserCookies = new Map();

  const ctx = {
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    URL,
    URLSearchParams,
    Promise,
    Math,
    JSON,
    Date,
    Error,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    document: { cookie: 'buvid3=page-dev3; DedeUserID=111' },
    location: { href: 'https://www.bilibili.com/video/BV1', reload() {} },

    GM_getValue: (k, d) => (storeMap.has(k) ? storeMap.get(k) : d),
    GM_setValue: (k, v) => storeMap.set(k, v),
    GM_deleteValue: (k) => storeMap.delete(k),
    GM_setCookie: (str, details, cb) => {
      const [pair] = String(str).split(';');
      const i = pair.indexOf('=');
      browserCookies.set(pair.slice(0, i).trim(), {
        value: pair.slice(i + 1).trim(),
        domain: (details && details.domain) || ''
      });
      if (cb) cb();
    },
    GM: {
      cookie: {
        set(details, cb) {
          browserCookies.set(details.name, { value: details.value, domain: details.domain, httpOnly: !!details.httpOnly });
          if (cb) cb();
        },
        delete(details, cb) {
          browserCookies.delete(details.name);
          if (cb) cb();
        },
        list(details, cb) {
          cb([...browserCookies].map(([name, v]) => ({ name, value: v.value, domain: v.domain })), null);
        }
      }
    },
    GM_xmlhttpRequest: () => {},
    window: null,
    globalThis: null
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.window.postMessage = () => {};
  ctx.window.addEventListener = () => {};
  ctx.__store = storeMap;
  ctx.__browserCookies = browserCookies;
  return ctx;
}

async function load(rel, ctx) {
  const res = await esbuild.build({
    entryPoints: [path.join(ROOT, rel)],
    bundle: true,
    format: 'cjs',
    platform: 'neutral',
    target: 'es2022',
    write: false,
    logLevel: 'silent'
  });
  vm.createContext(ctx);
  // 放进函数作用域：同一 ctx 里要能反复 load 不同模块，
  // 否则第二个模块的 `const module` 会与第一个撞出语法错误
  vm.runInContext(
    `globalThis.__api = (function(){ const module = {exports:{}}; const exports = module.exports;\n${res.outputFiles[0].text}\n;return module.exports; })();`,
    ctx,
    { filename: rel.replace(/[\\/]/g, '_') + '.cjs' }
  );
  return ctx.__api;
}

function seedPool(accounts, extra = {}) {
  return { 'b.accounts': { v: 1, accounts, ...extra } };
}

function acc(id, cookie, over = {}) {
  return { id, cookie, mid: '', uname: '', vipStatus: 0, vipType: 0, checkedAt: Date.now(), addedAt: Date.now(), ...over };
}

/* ---------------- 用例 ---------------- */

console.log('\n[1] 账号池基本形状与旧数据迁移');
{
  const ctx = makeContext({ 'b.cookie': A_COOKIE, 'b.lastAccount': { mid: '111', uname: 'A', vipStatus: 1, vipType: 2, at: 1000 } });
  const api = await load('src/core/accounts.js', ctx);
  const list = api.list();
  check('旧单账号被收编进池子', list.length === 1, list.length);
  check('昵称与会员状态都带过来了', list[0].uname === 'A' && list[0].vipStatus === 1, list[0]);
  check('探测时间沿用旧的（不重复发 nav）', list[0].checkedAt === 1000, list[0].checkedAt);
  check('没有丢 mid', list[0].mid === '111', list[0].mid);
  check('池子落盘了', !!ctx.__store.get('b.accounts'));

  // 空池不应反复触发迁移读旧键
  const ctx2 = makeContext({});
  const api2 = await load('src/core/accounts.js', ctx2);
  check('无旧数据时池子为空', api2.list().length === 0);
}

console.log('\n[2] 重复粘贴同一账号不会产生第二条');
{
  const ctx = makeContext();
  const api = await load('src/core/accounts.js', ctx);
  const r1 = api.addAccount(A_COOKIE);
  const r2 = api.addAccount(A_COOKIE);
  check('第一次是新增', r1.isNew === true && r1.ok);
  check('第二次识别为已有', r2.isNew === false && r2.ok);
  check('id 相同（同一 SESSDATA）', r1.id === r2.id, [r1.id, r2.id]);
  check('池里仍然只有一个', api.list().length === 1);
  check('id 不含 SESSDATA 内容', !r1.id.includes('a-sess') && r1.id.length <= 8, r1.id);

  check('缺 SESSDATA 的 Cookie 被拒', api.addAccount('buvid3=x; DedeUserID=9').reason === 'noSessdata');
  check('空输入被拒', api.addAccount('').reason === 'empty');
}

console.log('\n[3] 借用来源：当前号有会员就用自己的');
{
  const ctx = makeContext();
  const api = await load('src/core/accounts.js', ctx);
  const a = api.addAccount(A_COOKIE);
  const b = api.addAccount(B_COOKIE);
  api.markProbed(a.id, { mid: '111', uname: 'A', vipStatus: 1, vipType: 2 });
  api.markProbed(b.id, { mid: '222', uname: 'B', vipStatus: 1, vipType: 2 });
  api.setActiveId(a.id);
  const r = api.resolveBorrow();
  check('借的是当前登录号', r.account.id === a.id, r.account.id);
  check('模式为自动', r.mode === 'auto');
}

console.log('\n[4] 切到无权益号时自动借用有权益号（核心诉求）');
{
  const ctx = makeContext();
  const api = await load('src/core/accounts.js', ctx);
  const a = api.addAccount(A_COOKIE);
  const b = api.addAccount(B_COOKIE);
  api.markProbed(a.id, { mid: '111', uname: 'A', vipStatus: 0 });
  api.markProbed(b.id, { mid: '222', uname: 'B', vipStatus: 1 });
  api.setActiveId(a.id);

  const r = api.resolveBorrow();
  check('借到了有大会员的号', r.account.id === b.id, r.account.id);
  check('且不是当前登录号', r.account.id !== a.id);
  check('给出了可解释的原因', r.reason.length > 0, r.reason);
  check('borrowCookie 返回的是 B 的 Cookie', api.borrowCookie() === B_COOKIE);

  const active = api.activeAccount();
  check('当前身份仍然是 A（互动归属不变）', active.id === a.id);
}

console.log('\n[5] 手动指定借用来源优先于自动');
{
  const ctx = makeContext();
  const api = await load('src/core/accounts.js', ctx);
  const a = api.addAccount(A_COOKIE);
  const b = api.addAccount(B_COOKIE);
  api.markProbed(a.id, { mid: '111', uname: 'A', vipStatus: 1 });
  api.markProbed(b.id, { mid: '222', uname: 'B', vipStatus: 0 });
  api.setActiveId(a.id);

  api.setBorrowId(b.id);
  const manual = api.resolveBorrow();
  check('手动指定生效（哪怕它没会员）', manual.mode === 'manual' && manual.account.id === b.id, manual);

  api.setBorrowId(null);
  const auto = api.resolveBorrow();
  check('清空后恢复自动，回到有会员的号', auto.mode === 'auto' && auto.account.id === a.id, auto);
}

console.log('\n[6] 池内都没有大会员时不乱挑');
{
  const ctx = makeContext();
  const api = await load('src/core/accounts.js', ctx);
  const a = api.addAccount(A_COOKIE);
  const b = api.addAccount(B_COOKIE);
  api.markProbed(a.id, { mid: '111', uname: 'A', vipStatus: 0 });
  api.markProbed(b.id, { mid: '222', uname: 'B', vipStatus: 0 });
  api.setActiveId(b.id);
  const r = api.resolveBorrow();
  check('退回用自己的', r.account.id === b.id && r.mode === 'self', r);
  check('说明原因', r.reason.includes('没有大会员'), r.reason);

  // 未探测过的号不算「确认没有会员」，但也不能凭空被选中
  const ctx2 = makeContext();
  const api2 = await load('src/core/accounts.js', ctx2);
  const a2 = api2.addAccount(A_COOKIE);
  const b2 = api2.addAccount(B_COOKIE);
  api2.markProbed(a2.id, { mid: '111', uname: 'A', vipStatus: 0 });
  api2.setActiveId(a2.id);
  const r2 = api2.resolveBorrow();
  check('未探测的号不会被当成借用源', r2.account.id === a2.id, r2.account.id);
}

console.log('\n[7] 池结构自愈：悬空 id、无 SESSDATA 条目');
{
  const ctx = makeContext(
    seedPool([
      acc('good', A_COOKIE, { mid: '111' }),
      acc('nosess', 'buvid3=x; DedeUserID=9'), // 没有 SESSDATA 的废条目
      acc('good', B_COOKIE) // 重复 id
    ], { activeId: 'nosess', borrowId: 'ghost' })
  );
  const api = await load('src/core/accounts.js', ctx);
  const list = api.list();
  check('没有 SESSDATA 的条目被丢弃', !list.some((a) => a.id === 'nosess'), list.map((a) => a.id));
  check('重复 id 只留一个', list.filter((a) => a.id === 'good').length === 1);
  check('activeId 指向已删除的条目时被重置到有效值', list.some((a) => a.id === api.pool().activeId), api.pool().activeId);
  check('悬空的 borrowId 被清空', api.pool().borrowId === '');
}

console.log('\n[8] 删除账号后引用被清理');
{
  const ctx = makeContext();
  const api = await load('src/core/accounts.js', ctx);
  const a = api.addAccount(A_COOKIE);
  const b = api.addAccount(B_COOKIE);
  api.markProbed(a.id, { mid: '111', vipStatus: 0 });
  api.markProbed(b.id, { mid: '222', vipStatus: 1 });
  api.setActiveId(a.id);
  api.setBorrowId(b.id);

  api.removeAccount(b.id);
  check('借用的号被删后 borrowId 清空', api.pool().borrowId === '');
  check('自动回落到当前号', api.borrowAccountId() === a.id, api.borrowAccountId());
  check('删不存在的账号不报错', api.removeAccount('nope').ok === false);
}

console.log('\n[9] 探测缓存过期判定');
{
  const ctx = makeContext();
  const api = await load('src/core/accounts.js', ctx);
  const a = api.addAccount(A_COOKIE);
  // 刚加入、还没探过 → 必须探一次，否则借用的自动挑选无从判断
  check('未探测过的号需要重探', api.needsProbe(api.byId(a.id)) === true);
  api.markProbed(a.id, { mid: '111', uname: 'A', vipStatus: 1 });
  check('探测后写入 checkedAt', api.byId(a.id).checkedAt > 0);
  check('刚探过 → 不需要重探', api.needsProbe(api.byId(a.id)) === false);
  const old = { ...api.byId(a.id), checkedAt: Date.now() - 25 * 3600 * 1000 };
  check('超过 24h 需要重探', api.needsProbe(old) === true);
  check('null 不需要重探', api.needsProbe(null) === false);
}

console.log('\n[10] 切换登录态：SESSDATA / bili_jct / sid 一起换');
{
  const ctx = makeContext(
    seedPool([acc('idA', A_COOKIE, { mid: '111', uname: 'A', vipStatus: 0 })], { activeId: 'idA' })
  );
  const accApi = await load('src/core/accounts.js', ctx);
  const added = accApi.addAccount(B_COOKIE, { mid: '222', uname: 'B', vipStatus: 1 });
  const sw = await load('src/core/switcher.js', ctx);

  const r = await sw.switchLoginTo(added.id);
  check('切换成功', r.ok === true, r.reason);
  check('需要刷新页面', r.needReload === true);
  check('登录记录已切到新号', accApi.pool().activeId === added.id);

  const bc = ctx.__browserCookies;
  check('SESSDATA 已换成 B', bc.get('SESSDATA').value === 'b-sess', bc.get('SESSDATA'));
  check('bili_jct 跟着换（不能留 A 的）', bc.get('bili_jct').value === 'b-csrf', bc.get('bili_jct'));
  check('sid 跟着换（不能跨账号沿用）', bc.get('sid').value === 'b-sid', bc.get('sid'));
  check('DedeUserID 跟着换', bc.get('DedeUserID').value === '222');
  check('SESSDATA 保持 HttpOnly', bc.get('SESSDATA').httpOnly === true);
  check('bili_jct 保持 HttpOnly', bc.get('bili_jct').httpOnly === true);
  check('DedeUserID 不该被标 HttpOnly（站点本来就不是）', bc.get('DedeUserID').httpOnly !== true);
  // B_COOKIE 自带 sid，所以不该进删除名单；下面换到没有 sid 的 C 才验证删除路径
  check('目标账号有的字段不进删除名单', !r.stale.includes('sid') && !r.stale.includes('bili_jct'), r.stale);

  // 再切到一个**没有 sid** 的号：浏览器里不能残留上一个号的 sid
  ctx.__browserCookies.clear();
  const added2 = accApi.addAccount('SESSDATA=c-sess; DedeUserID=333; bili_jct=c-csrf', { mid: '333' });
  const r2 = await sw.switchLoginTo(added2.id);
  check('新号没有的旧字段被删掉（sid 不残留）', !ctx.__browserCookies.has('sid'), [...ctx.__browserCookies.keys()]);
  check('删除名单里确实有 sid', r2.stale.includes('sid'), r2.stale);
  check('新号有值时不会被误删', ctx.__browserCookies.get('bili_jct').value === 'c-csrf');
}

console.log('\n[11] 设备字段不会被切号误删（回归：曾把设备字段写进白名单）');
{
  // 场景：浏览器里已有设备字段（属于这台设备），账号池里存的是最小字段集。
  // 若白名单里含设备字段，每次切号都会把它们算成「旧号残留」删掉。
  const ctx = makeContext(
    seedPool([acc('idA', A_COOKIE, { mid: '111', vipStatus: 0 })], { activeId: 'idA' })
  );
  ctx.document.cookie = 'buvid3=page-dev3; buvid4=page-dev4; bili_ticket=page-ticket';
  const accApi = await load('src/core/accounts.js', ctx);
  const added = accApi.addAccount(B_COOKIE, { mid: '222', vipStatus: 1 });
  const sw = await load('src/core/switcher.js', ctx);

  const r = await sw.switchLoginTo(added.id);
  check('切换成功', r.ok === true, r.reason);
  check('设备字段不在删除名单里', !r.stale.includes('buvid3') && !r.stale.includes('bili_ticket'), r.stale);
  check('浏览器里的设备字段没被动过', !ctx.__browserCookies.has('buvid3') && !ctx.__browserCookies.has('bili_ticket'), [...ctx.__browserCookies.keys()]);
  check('身份字段照常写入', ctx.__browserCookies.get('SESSDATA').value === 'b-sess');

  // 反向：即使账号自己存了设备字段，切号时也不写进浏览器 ——
  // 那会把某个账号的设备指纹盖到这台设备上
  const ctx2 = makeContext(
    seedPool([acc('idA', A_COOKIE, { mid: '111', vipStatus: 0 })], { activeId: 'idA' })
  );
  const accApi2 = await load('src/core/accounts.js', ctx2);
  const added2 = accApi2.addAccount(B_WITH_DEVICE, { mid: '222', vipStatus: 1 });
  const sw2 = await load('src/core/switcher.js', ctx2);
  await sw2.switchLoginTo(added2.id);
  check('账号自带的设备字段也不写进浏览器', !ctx2.__browserCookies.has('buvid3'), [...ctx2.__browserCookies.keys()]);
  check('身份字段仍全部写入', ctx2.__browserCookies.has('bili_jct') && ctx2.__browserCookies.has('sid'));
}

console.log('\n[12] 借用来源切换不会改浏览器登录态');
{
  const ctx = makeContext(
    seedPool([acc('idA', A_COOKIE, { mid: '111', vipStatus: 0 })], { activeId: 'idA' })
  );
  const accApi = await load('src/core/accounts.js', ctx);
  const added = accApi.addAccount(B_COOKIE, { mid: '222', uname: 'B', vipStatus: 1 });
  const sw = await load('src/core/switcher.js', ctx);

  const r = sw.useAsBorrowSource(added.id);
  check('改借用来源成功', r.ok === true);
  check('当前身份不变', accApi.pool().activeId === 'idA');
  check('借用源已改', accApi.borrowAccountId() === added.id);
  check('没有碰浏览器 Cookie', ctx.__browserCookies.size === 0, [...ctx.__browserCookies.keys()]);
  check('自动恢复也可用', sw.useAutoBorrowSource().ok === true);
}

console.log('\n[12b] 不支持写 Cookie 的管理器如实报告');
{
  const ctx = makeContext(seedPool([acc('idA', A_COOKIE)], { activeId: 'idA' }));
  delete ctx.GM_setCookie;
  delete ctx.GM;
  const accApi = await load('src/core/accounts.js', ctx);
  const added = accApi.addAccount(B_COOKIE, { mid: '222', vipStatus: 1 });
  const sw = await load('src/core/switcher.js', ctx);

  check('overview 报告不可写', sw.overview().canWrite === false);
  const r = await sw.switchLoginTo(added.id);
  check('切换返回 unsupported 而非假装成功', r.ok === false && r.reason === 'unsupported', r);
  check('也不会误改当前身份', accApi.pool().activeId === 'idA');
}

console.log('\n[13] 重复添加同一账号：去重而非新增');
{
  const ctx = makeContext();
  const api = await load('src/core/accounts.js', ctx);
  const a = api.addAccount(A_COOKIE);
  api.markProbed(a.id, { mid: '111', uname: 'A号', vipStatus: 1 });
  api.renameAccount(a.id, '我的大会员号');

  const again = api.addAccount(A_COOKIE);
  check('第二次识别为已存在（isNew=false）', again.isNew === false && again.ok === true, again);
  check('不会产生第二条', api.list().length === 1, api.list().length);
  check('id 与第一次相同（同一 SESSDATA）', again.id === a.id, [a.id, again.id]);
  check('用户起的名字保住了', api.byId(a.id).label === '我的大会员号', api.byId(a.id).label);
  check('探测结论保留（Cookie 没变）', api.byId(a.id).checkedAt > 0);

  // Cookie 内容变了（重新复制，多带了设备字段）→ 凭证换了，结论必须一起作废
  const changed = api.addAccount(A_COOKIE + '; buvid3=dev3');
  check('内容变化仍算已存在（同一 SESSDATA）', changed.isNew === false);
  check('池里依然只有一条', api.list().length === 1);
  const after = api.byId(a.id);
  check('探测时间归零（凭证已换）', after.checkedAt === 0, after.checkedAt);
  // 回归：只清 checkedAt 而留着 vipStatus，会让面板把「未证实的结论」显示成事实
  check('会员结论一并作废，不能沿用旧的', after.vipStatus === 0, after.vipStatus);
  check('但名字仍然保住', after.label === '我的大会员号');

  // 同人刷新（mid 相同但换了新 SESSDATA，如重新扫码或过期后再次登录）：
  // 应识别为已有账号、更新条目、不产生第二条，并将 activeId 迁移到新 id
  const newSessCookie = 'SESSDATA=brand-new-sess; DedeUserID=111; bili_jct=new-jct';
  const refreshed = api.addAccount(newSessCookie);
  check('新 SESSDATA 但相同 mid 识别为更新已存在账号 (isNew=false)', refreshed.isNew === false, refreshed);
  check('池里依然只有一条（不产生幽灵孤立条目）', api.list().length === 1, api.list().length);
  check('id 更新为新凭证的指纹', refreshed.id === api.fingerprintId(newSessCookie));
  check('activeId 引用同步迁移到新 id', api.pool().activeId === refreshed.id);
  check('原来自定义名字仍然保住', api.byId(refreshed.id).label === '我的大会员号');
}

console.log('\n[14] 浏览器已登录时：能认人，认不到 Cookie');
{
  // nav 用浏览器自身 Cookie 请求 → 返回的是登录者的 mid/uname。
  // 但 SESSDATA 是 HttpOnly，脚本读不到，所以「认人」≠「能入池」。
  const ctx = makeContext();
  const navText = JSON.stringify({ code: 0, data: { mid: 111, uname: '登录着的号', vipStatus: 1 } });
  ctx.GM_xmlhttpRequest = (opts) => setTimeout(() => opts.onload({ status: 200, statusText: 'OK', responseText: navText, responseHeaders: '' }), 0);

  const sess = await load('src/core/session.js', ctx);
  const who = await sess.identifyBrowserAccount();
  check('能认出浏览器当前登录的是谁', who.mid === '111' && who.uname === '登录着的号', who);
  check('也能读出它的会员状态', who.vipStatus === 1);

  // 认到人 ≠ 拿得到 Cookie：document.cookie 里没有 SESSDATA
  check('浏览器 Cookie 里确实没有 SESSDATA（所以无法自动入池）', !(await load('src/core/cookie.js', ctx)).parseCookie(ctx.document.cookie).SESSDATA, ctx.document.cookie);

  // 该号已在池中 → overviewAsync 直接判定 inPool，凭证现成
  const ctx2 = makeContext(
    seedPool([acc('idA', A_COOKIE, { mid: '111', uname: '登录着的号', vipStatus: 0 })], { activeId: 'idA' })
  );
  ctx2.document.cookie = 'buvid3=dev3';
  ctx2.GM_xmlhttpRequest = (opts) => setTimeout(() => opts.onload({ status: 200, statusText: 'OK', responseText: navText, responseHeaders: '' }), 0);
  const accApi = await load('src/core/accounts.js', ctx2);
  const sw = await load('src/core/switcher.js', ctx2);
  accApi.pool();
  const o = await sw.overviewAsync();
  check('池里已有这个号 → inPool', o.inPool === true && o.inPoolId === 'idA', o);
  check('给出 mid 与昵称', o.browserMid === '111' && o.browserUname === '登录着的号', o);
  check('已在池中就不需要一键导入', o.canAutoImport === false);

  // 不在池中 + 读得到 SESSDATA → 可以一键导入
  // 关键：这条曾被写成「SESSDATA 是 HttpOnly 所以读不到」，而那个结论只有 mock 支撑，
  // 等于循环论证。改成运行时探测后，两种环境都能正确处理。
  const ctx3 = makeContext();
  ctx3.document.cookie = 'SESSDATA=auto-import-sess; DedeUserID=111; bili_jct=auto-jct';
  ctx3.GM_xmlhttpRequest = (opts) => setTimeout(() => opts.onload({ status: 200, statusText: 'OK', responseText: navText, responseHeaders: '' }), 0);
  const accApi3 = await load('src/core/accounts.js', ctx3);
  accApi3.pool();
  const sw3 = await load('src/core/switcher.js', ctx3);
  const o3 = await sw3.overviewAsync();
  check('读得到 SESSDATA → canAutoImport', o3.canAutoImport === true, o3);
  check('此时不再要求手动复制', o3.needsManualCopy === false);
  check('仍认出浏览器是谁', o3.browserMid === '111');

  // 真去导入：应当入池、探出昵称与会员状态
  const imported = await sw3.importBrowserAccount();
  check('一键导入成功', imported.ok === true, imported);
  const pool3 = accApi3.list();
  check('导入后池里有一条', pool3.length === 1, pool3.length);
  check('导入的是浏览器当前登录的号', pool3[0].mid === '111' && pool3[0].uname === '登录着的号', pool3[0]);
  check('导入后带上了会员状态', pool3[0].vipStatus === 1, pool3[0]);
  check('导入的是同一份 SESSDATA', pool3[0].cookie.includes('auto-import-sess'));

  // 读不到 SESSDATA → 明确要求手动复制，且**不**拼一个假 Cookie 进来
  const ctx3b = makeContext();
  ctx3b.document.cookie = 'buvid3=dev3; DedeUserID=111';
  ctx3b.GM_xmlhttpRequest = (opts) => setTimeout(() => opts.onload({ status: 200, statusText: 'OK', responseText: navText, responseHeaders: '' }), 0);
  const accApi3b = await load('src/core/accounts.js', ctx3b);
  accApi3b.pool();
  const sw3b = await load('src/core/switcher.js', ctx3b);
  const o3b = await sw3b.overviewAsync();
  check('读不到 → needsManualCopy', o3b.needsManualCopy === true, o3b);
  check('不给一键导入的假象', o3b.canAutoImport === false);
  const bad = await sw3b.importBrowserAccount();
  check('导入请求被明确拒绝', bad.ok === false && bad.reason === 'needManualCopy', bad);
  check('池子仍然是空的（没拼假 Cookie）', accApi3b.list().length === 0, accApi3b.list());

  // nav 挂了也不能影响面板：读不到就静默降级
  const ctx4 = makeContext(seedPool([acc('idA', A_COOKIE, { mid: '111' })], { activeId: 'idA' }));
  ctx4.GM_xmlhttpRequest = (opts) => setTimeout(() => opts.onerror({ status: 0 }), 0);
  const accApi4 = await load('src/core/accounts.js', ctx4);
  accApi4.pool();
  const sw4 = await load('src/core/switcher.js', ctx4);
  const o4 = await sw4.overviewAsync();
  check('nav 不可用时静默降级，不抛错', o4.inPool === false && o4.browserMid === '');

  // 认不出浏览器是谁时不能报「不一致」—— 那是在没有证据的情况下指控用户改过登录。
  check('认不出身份时不误报 mismatch', o4.browserMismatch === false, o4);
}

console.log('\n[15] browserMismatch：池里记的当前号与浏览器实际登录的对不上');
{
  // nav 固定返回 mid=999（浏览器实际登录的是 999），池里 activeId 指向 111。
  const nav = JSON.stringify({ code: 0, data: { mid: 999, uname: '实际登录的号', vipStatus: 1 } });
  const navPooled = JSON.stringify({ code: 0, data: { mid: 111, uname: '池里记的号', vipStatus: 1 } });
  const mk = () => {
    const c = makeContext(seedPool([acc('idA', A_COOKIE, { mid: '111', uname: '池里记的号' })], { activeId: 'idA' }));
    c.GM_xmlhttpRequest = (o) => setTimeout(() => o.onload({ status: 200, statusText: 'OK', responseText: nav, responseHeaders: '' }), 0);
    return c;
  };

  // 1) 池里记 111，浏览器实际是 999 → 确实不一致
  const c1 = mk();
  const a1 = await load('src/core/accounts.js', c1);
  a1.pool();
  const o1 = await (await load('src/core/switcher.js', c1)).overviewAsync();
  check('浏览器登录的不是池里记的那个号 → browserMismatch', o1.browserMismatch === true, o1);
  check('仍能认出浏览器是谁（否则无法提示）', o1.browserMid === '999', o1);
  check('不影响 inPool / 借用逻辑', o1.inPool === false && o1.borrowId === 'idA', o1);

  // 2) 浏览器实际就是池里记的那个号 → 不该报
  const c2 = makeContext(seedPool([acc('idA', A_COOKIE, { mid: '111', uname: '池里记的号' })], { activeId: 'idA' }));
  c2.GM_xmlhttpRequest = (o) => setTimeout(() => o.onload({ status: 200, statusText: 'OK', responseText: navPooled, responseHeaders: '' }), 0);
  const a2 = await load('src/core/accounts.js', c2);
  a2.pool();
  const o2 = await (await load('src/core/switcher.js', c2)).overviewAsync();
  check('一致时不报 mismatch', o2.browserMismatch === false, o2);

  // 3) 池非空时 activeId 一定会被补上（accounts.js 的迁移逻辑），
  //    所以「记着 A、实际是 B」在池非空时是常态而不是边缘情况 —— 确认这条不变量成立，
  //    否则上面的 mismatch 分支在正常使用中永远不会触发，测了也说明不了什么。
  const c3 = makeContext(seedPool([acc('idA', A_COOKIE, { mid: '111' })], { activeId: '' }));
  const a3 = await load('src/core/accounts.js', c3);
  a3.pool();
  check('池非空而 activeId 为空时会被补上', a3.pool().activeId === 'idA', a3.pool());
}

console.log('\n[16] 防串号检查不能误伤「导入当前登录账号」');
{
  // probeIdentity 靠「返回的 mid 是否等于页面那个号」判断发送方式有没有生效。
  // 但导入当前登录账号时，待测 Cookie 就是页面那个号的，mid 相同是正确结果。
  // 不区分的话一键导入永远失败 —— 而这是最常见的第一个动作。
  const nav = JSON.stringify({ code: 0, data: { mid: 111, uname: '当前号', vipStatus: 1 } });

  // 1) 待测 Cookie == 浏览器当前 Cookie → 应判为成功
  const ctxA = makeContext();
  ctxA.document.cookie = 'SESSDATA=same-sess; DedeUserID=111; bili_jct=j';
  ctxA.GM_xmlhttpRequest = (o) => setTimeout(() => o.onload({ status: 200, statusText: 'OK', responseText: nav, responseHeaders: '' }), 0);
  const sA = await load('src/core/session.js', ctxA);
  const rA = await sA.probeIdentity('SESSDATA=same-sess; DedeUserID=111; bili_jct=j', { adopt: false });
  check('导入当前号不会被误判为「没送出去」', rA.ok === true, rA.reason);
  check('认出的就是当前号', rA.account && rA.account.mid === '111', rA.account);

  // 2) 待测 Cookie 是**另一个**号，但服务端仍返回页面的 mid → 仍要判为串号
  const ctxB = makeContext();
  ctxB.document.cookie = 'SESSDATA=browser-sess; DedeUserID=111';
  ctxB.GM_xmlhttpRequest = (o) => setTimeout(() => o.onload({ status: 200, statusText: 'OK', responseText: nav, responseHeaders: '' }), 0);
  const sB = await load('src/core/session.js', ctxB);
  const rB = await sB.probeIdentity('SESSDATA=other-sess; DedeUserID=222; bili_jct=j', { adopt: false });
  check('另一个号仍会被防串号检查拦下', rB.ok === false, rB);
  check('并给出「都是浏览器账号」的明确原因', rB.reason.includes('当前浏览器账号'), rB.reason);

  // 3) 真实浏览器 HttpOnly 场景：document.cookie 读不到 SESSDATA（只有 DedeUserID），
  //    但待测 Cookie 明确是当前号（DedeUserID=111）→ 应成功，且不伪造策略认证
  const ctxC = makeContext({ 'b.strategy': 2 });
  ctxC.document.cookie = 'buvid3=page-dev3; DedeUserID=111'; // 无 SESSDATA
  ctxC.GM_xmlhttpRequest = (o) => setTimeout(() => o.onload({ status: 200, statusText: 'OK', responseText: nav, responseHeaders: '' }), 0);
  const sC = await load('src/core/session.js', ctxC);
  const rC = await sC.probeIdentity('SESSDATA=real-a-sess; DedeUserID=111; bili_jct=j', { adopt: false });
  check('真实浏览器 HttpOnly 环境下手动导入当前号成功', rC.ok === true, rC.reason);
  check('认出当前号 mid=111', rC.account && rC.account.mid === '111');
  check('同号验证不持久化发送策略（避免伪认证）', ctxC.__store.get('b.strategy') === 2, ctxC.__store.get('b.strategy'));

  // 4) 真实浏览器 HttpOnly 环境下，待测 Cookie 是另一个号（DedeUserID=222）→ 仍被正确拦截
  const ctxD = makeContext();
  ctxD.document.cookie = 'buvid3=page-dev3; DedeUserID=111';
  ctxD.GM_xmlhttpRequest = (o) => setTimeout(() => o.onload({ status: 200, statusText: 'OK', responseText: nav, responseHeaders: '' }), 0);
  const sD = await load('src/core/session.js', ctxD);
  const rD = await sD.probeIdentity('SESSDATA=real-b-sess; DedeUserID=222; bili_jct=j', { adopt: false });
  check('真实浏览器 HttpOnly 环境下另一个号串号仍被拦截', rD.ok === false, rD);
}

console.log('\n[17] 旧版单账号数据的镜像与清理');
{
  const ctx = makeContext({ 'b.cookie': A_COOKIE, 'b.lastAccount': { mid: '111', uname: 'A', vipStatus: 1, at: 5 } });
  const api = await load('src/core/accounts.js', ctx);
  const sess = await load('src/core/session.js', ctx);

  api.pool(); // 触发迁移
  api.markProbed(api.pool().activeId, { mid: '111', uname: 'A', vipStatus: 1 });
  sess.syncLegacyMirror();
  check('镜像回写的 Cookie 仍可用（旧版脚本降级不丢设置）', ctx.__store.get('b.cookie') === A_COOKIE, ctx.__store.get('b.cookie'));
  check('身份也一并镜像', (ctx.__store.get('b.lastAccount') || {}).uname === 'A');

  api.clearPool();
  check('清空池子后旧键也一并清掉', api.list().length === 0 && ctx.__store.get('b.cookie') === '');
}

console.log('\n[18] overview 与代理取值同源');
{
  const ctx = makeContext(
    seedPool(
      [
        acc('idA', A_COOKIE, { mid: '111', uname: 'A', vipStatus: 0 }),
        acc('idB', B_COOKIE, { mid: '222', uname: 'B', vipStatus: 1 })
      ],
      { activeId: 'idA' }
    )
  );
  const accApi = await load('src/core/accounts.js', ctx);
  const sw = await load('src/core/switcher.js', ctx);
  const sess = await load('src/core/session.js', ctx);

  const o = sw.overview();
  check('借用的不是当前登录号', o.borrowedFromOther === true);
  check('csrf 来自借用源', o.hasCsrf === true);
  check('脱敏摘要不含完整 SESSDATA', !o.effectiveMasked.includes('b-sess') && o.effectiveMasked.includes('b-sess'.slice(0, 4)));
  check('session 取到的正是借用源 Cookie', sess.getEffectiveCookie().includes('SESSDATA=b-sess'));
  check('csrf 取的是 B 的', sess.getBCsrf() === 'b-csrf', sess.getBCsrf());
  check('指纹随借用源变化', sess.fingerprint() === accApi.fingerprintId(B_COOKIE));
  void accApi;
}

console.log('');
if (failed) {
  console.error(`\x1b[31m${failed} 项失败\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32m全部通过\x1b[0m');