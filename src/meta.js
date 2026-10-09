/**
 * userscript 元数据。build.mjs 会把它作为 banner 放在产物最顶部。
 * 改版本号只需要改这里。
 */

export const VERSION = '2.1.0';

export const NAME = 'B站 · 会员权益借用';
export const NAME_EN = 'Bilibili Membership Borrow';
export const NS = 'bili-toolkit';

export const DESCRIPTION =
  '以主账号浏览互动，用已开通大会员的副账号获取播放地址，解锁 4K/8K/HDR/杜比/高码率与大会员专享内容，无需切换账号。' +
  '弹幕、评论、投币、收藏、观看历史仍归属主账号。';

export const DESCRIPTION_EN =
  'Browse with your main account while fetching playback URLs with a second VIP account — ' +
  'unlocks 4K/8K/HDR/Dolby and VIP-only titles without switching accounts. ' +
  'Danmaku, comments and watch history stay on the main account.';

export const meta = `// ==UserScript==
// @name         ${NAME}
// @name:en      ${NAME_EN}
// @namespace    ${NS}
// @version      ${VERSION}
// @description  ${DESCRIPTION}
// @description:en  ${DESCRIPTION_EN}
// @author       arisvia
// @license      MIT
// @homepageURL  https://github.com/arisvia/bili-toolkit
// @supportURL   https://github.com/arisvia/bili-toolkit/issues
// @match        *://*.bilibili.com/*
// @exclude      *://api.bilibili.com/*
// @exclude      *://api.live.bilibili.com/*
// @exclude      *://passport.bilibili.com/*
// @run-at       document-start
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @connect      api.bilibili.com
// @connect      api.live.bilibili.com
// @connect      www.bilibili.com
// ==/UserScript==
`;