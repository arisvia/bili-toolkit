/**
 * Cookie 可读性诊断 —— 粘进 B 站页面的控制台执行。
 *
 * 为什么需要它：仓库里「SESSDATA 是 HttpOnly，document.cookie 取不到」
 * 这条结论此前只有 mock 支撑，没有真实浏览器复验（mock 是照着结论写的，
 * 等于循环论证）。这段代码把「到底能不能读」变成当场可测的事实。
 *
 * 怎么读结果：
 *   docHasSess = true   → 脚本能自动导入当前账号，界面应给「一键加入池子」
 *   docHasSess = false  → 只能从 DevTools 复制，界面给对应提示
 *
 * 无副作用：只读取并打印字段是否存在，不打印任何值。
 */
(function () {
  if (typeof document === 'undefined') {
    console.log('[bili-toolkit] 此脚本需复制并粘贴到 B 站网页的浏览器控制台（DevTools Console）中执行。');
    return;
  }
  var ck = document.cookie || '';
  var names = ck.split(';').map(function (s) { return s.trim().split('=')[0]; }).filter(Boolean);
  var m = ck.match(/(?:^|;\s*)SESSDATA=([^;]*)/);
  var out = {
    host: location.hostname,
    // 关键结论
    docHasSess: names.indexOf('SESSDATA') !== -1,
    sessLen: m ? m[1].length : 0,
    // 其它字段用来交叉验证「读到的确实是 B 站登录态」
    hasJct: names.indexOf('bili_jct') !== -1,
    hasUid: names.indexOf('DedeUserID') !== -1,
    hasSid: names.indexOf('sid') !== -1,
    hasBuvid3: names.indexOf('buvid3') !== -1,
    // 全量字段名（只列名字，不含值）
    docNames: names,
    // 权限对照：没有这个就说明连基本的 document.cookie 访问都没
    canAccessCookie: typeof document.cookie === 'string'
  };
  console.log('[bili-toolkit] Cookie 可读性诊断', out);
  return out;
})();