/**
 * userscript 元数据。build.mjs 会把它作为 banner 放在产物最顶部。
 * 改版本号只需要改这里。
 */

export const VERSION = '1.0.0';

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
// @grant        GM_setCookie
// @grant        GM.cookie
// @connect      api.bilibili.com
// @connect      api.live.bilibili.com
// @connect      passport.bilibili.com
// @connect      www.bilibili.com
// ==/UserScript==
`;