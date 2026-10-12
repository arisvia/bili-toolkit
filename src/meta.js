/**
 * userscript 元数据常量。
 * 注意：这里只导出纯常量供运行时（panel、menu、log）和构建时使用。
 * 切勿在此导出包含 `// ==UserScript==` 的模板字符串，
 * 否则会被 esbuild 打包进正文代码作为无用死字符串残留。
 */

export const VERSION = '1.0.4';

export const NAME = 'B站 · 会员权益借用';
export const NAME_EN = 'Bilibili Membership Borrow';
export const NS = 'bili-toolkit';

export const DESCRIPTION =
  '多账号池：以主账号浏览互动，用已开通大会员的副账号获取播放地址，解锁 4K/8K/HDR/杜比/高码率与大会员专享内容。' +
  '一键切号、自动借用有权益的号，弹幕、评论、投币、收藏、观看历史仍归属当前账号。';

export const DESCRIPTION_EN =
  'Multi-account pool: browse with your main account while fetching playback URLs with a VIP account — ' +
  'unlocks 4K/8K/HDR/Dolby and VIP-only titles, with one-click account switching. ' +
  'Danmaku, comments and watch history stay on the logged-in account.';

export const AUTHOR = 'arisvia';
export const LICENSE = 'MIT';
export const HOMEPAGE = 'https://github.com/arisvia/bili-toolkit';
export const ISSUES = 'https://github.com/arisvia/bili-toolkit/issues';
export const ICON = 'https://www.bilibili.com/favicon.ico';