/**
 * userscript 元数据常量。
 * 注意：这里只导出纯常量供运行时（panel、menu、log）和构建时使用。
 * 切勿在此导出包含 `// ==UserScript==` 的模板字符串，
 * 否则会被 esbuild 打包进正文代码作为无用死字符串残留。
 */

export const VERSION = '1.2.0';

export const NAME = 'B站 · 多账号多权益工具箱';
export const NAME_EN = 'Bilibili Multi-Account Toolkit';
export const NS = 'bili-toolkit';

export const DESCRIPTION =
  '多账号无缝漫游、软登出凭据保活、大会员权益借用、4K/杜比画质解锁。' +
  '以主号互动弹幕，借副号大会员取流，左下角胶囊秒切账号。';

export const DESCRIPTION_EN =
  'Multi-account seamless roaming, soft-logout credential preservation, VIP playback borrowing, ' +
  'and 4K/Dolby unlocking with bottom-left mini dock switcher.';

export const AUTHOR = 'arisvia';
export const LICENSE = 'MIT';
export const HOMEPAGE = 'https://github.com/arisvia/bili-toolkit';
export const ISSUES = 'https://github.com/arisvia/bili-toolkit/issues';
export const ICON = 'https://www.bilibili.com/favicon.ico';