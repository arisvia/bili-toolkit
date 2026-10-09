/**
 * 响应补丁。
 *
 * 两条独立的补丁：
 *  1) patchVipFlags  —— 把「会员形状」的字段改成大会员。仅影响界面显示与前端是否弹付费墙，
 *     不改变服务端是否授权播放。刻意做得保守：只碰明确是会员状态的字段。
 *  2) stripTrialFlags —— 删除试看标记。**默认关闭**：它并不能解锁任何服务端限制，
 *     只是让前端不再显示「试看结束」。留着开关是为了排查问题时对照用。
 */
import { DEFAULTS } from '../config.js';
import { patchRegion } from './region.js';

const VIP_KEYS = new Set(['vipStatus', 'vipType', 'vip_status', 'vip_type']);
const VIP_OBJ_KEYS = ['vip', 'vip_info', 'vipInfo'];
const TRIAL_KEYS = ['trial_avail', 'trial_time', 'trial_start', 'preview_avail'];

function looksLikeVipObject(obj) {
  return (
    obj &&
    typeof obj === 'object' &&
    (typeof obj.status === 'number' || typeof obj.type === 'number' || typeof obj.due_date === 'number')
  );
}

function patchVipObject(v) {
  if (typeof v.status === 'number' && v.status !== 1) v.status = 1;
  if (typeof v.type === 'number' && v.type !== 2) v.type = 2;
  if (typeof v.due_date === 'number') v.due_date = 4102444800000;
}

/** 深度遍历，把所有「会员形状」字段改成大会员 */
export function patchVipFlags(root) {
  const seen = new WeakSet();
  const walk = (o) => {
    if (!o || typeof o !== 'object' || seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) {
      for (const item of o) walk(item);
      return;
    }
    for (const k of VIP_KEYS) {
      if (k === 'vipStatus' || k === 'vip_status') {
        if (typeof o[k] === 'number' && o[k] !== 1) o[k] = 1;
      } else if (typeof o[k] === 'number' && o[k] !== 2) {
        o[k] = 2;
      }
    }
    for (const k of VIP_OBJ_KEYS) {
      if (looksLikeVipObject(o[k])) patchVipObject(o[k]);
    }
    for (const k of Object.keys(o)) {
      if (VIP_OBJ_KEYS.includes(k)) continue;
      walk(o[k]);
    }
  };
  walk(root);
  return root;
}

/** 删除试看标记（不改变服务端授权，仅去掉前端提示） */
export function stripTrialFlags(root) {
  const seen = new WeakSet();
  const walk = (o) => {
    if (!o || typeof o !== 'object' || seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) {
      for (const item of o) walk(item);
      return;
    }
    for (const k of TRIAL_KEYS) delete o[k];
    for (const k of Object.keys(o)) walk(o[k]);
  };
  walk(root);
  return root;
}

/**
 * 统一的响应补丁入口。
 * @param {string} text 原始 JSON 文本
 * @param {{patchVip?:boolean, stripTrial?:boolean, region?:string}} opts
 * @returns {string}
 */
export function patchJsonText(text, opts = {}) {
  const patchVip = opts.patchVip !== undefined ? opts.patchVip : DEFAULTS.patchUi !== false;
  const stripTrial = opts.stripTrial === true;
  const region = opts.region || 'off';
  if (!patchVip && !stripTrial && region === 'off') return text;
  try {
    const o = JSON.parse(text);
    if (!o || typeof o !== 'object') return text;
    if (patchVip) patchVipFlags(o);
    if (stripTrial) stripTrialFlags(o);
    if (region !== 'off') patchRegion(o, region);
    return JSON.stringify(o);
  } catch {
    return text;
  }
}

/** 从 nav 响应里提取 A 账号自己的 mid（用于判断 Cookie 是否真的换了身份） */
export function extractMidFromNav(text) {
  try {
    const o = JSON.parse(text);
    if (o && o.code === 0 && o.data) return { mid: String(o.data.mid ?? ''), uname: o.data.uname || '' };
  } catch {
    /* ignore */
  }
  return { mid: '', uname: '' };
}

/** 从 nav 响应里提取会员信息 */
export function extractVipFromNav(text) {
  try {
    const o = JSON.parse(text);
    if (o && o.code === 0 && o.data) {
      const d = o.data;
      const status = typeof d.vipStatus === 'number' ? d.vipStatus : d.vip && d.vip.status;
      const type = typeof d.vipType === 'number' ? d.vipType : d.vip && d.vip.type;
      return { vipStatus: status || 0, vipType: type || 0 };
    }
  } catch {
    /* ignore */
  }
  return { vipStatus: 0, vipType: 0 };
}