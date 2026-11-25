/**
 * 会员状态字段补丁 —— 沙箱（src/core/patch.js）与主世界钩子（src/injected/hook.js）的唯一事实源。
 *
 * 仅修改界面展示与前端付费墙判定的会员标志字段，不改变服务端实际授权。
 */

const VIP_KEYS = ['vipStatus', 'vipType', 'vip_status', 'vip_type'];
const VIP_OBJ_KEYS = ['vip', 'vip_info', 'vipInfo'];

export function looksLikeVipObject(obj) {
  return !!(
    obj &&
    typeof obj === 'object' &&
    (typeof obj.status === 'number' || typeof obj.type === 'number' || typeof obj.due_date === 'number')
  );
}

export function patchVipObject(v) {
  if (typeof v.status === 'number' && v.status !== 1) v.status = 1;
  if (typeof v.type === 'number' && v.type !== 2) v.type = 2;
  if (typeof v.due_date === 'number') v.due_date = 4102444800000;
}

/** 深度遍历，把所有「会员形状」字段改成大会员（防循环引用，限制最大深度） */
export function patchVipFlags(root, maxDepth = 12) {
  const seen = typeof WeakSet !== 'undefined' ? new WeakSet() : null;

  function walk(o, depth) {
    if (!o || typeof o !== 'object' || depth > maxDepth) return;
    if (seen) {
      if (seen.has(o)) return;
      seen.add(o);
    }
    if (Array.isArray(o)) {
      for (let i = 0; i < o.length; i++) walk(o[i], depth + 1);
      return;
    }

    for (let i = 0; i < VIP_KEYS.length; i++) {
      const k = VIP_KEYS[i];
      if (k === 'vipStatus' || k === 'vip_status') {
        if (typeof o[k] === 'number' && o[k] !== 1) o[k] = 1;
        else if (typeof o[k] === 'string' && o[k] !== '1') o[k] = '1';
      } else {
        if (typeof o[k] === 'number' && o[k] !== 2) o[k] = 2;
        else if (typeof o[k] === 'string' && o[k] !== '2') o[k] = '2';
      }
    }

    if (typeof o.is_preview === 'number' && o.is_preview !== 0) o.is_preview = 0;
    if (o.has_paid === false) o.has_paid = true;
    if (o.real_vip === false) o.real_vip = true;
    if (o.play_detail === 'PLAY_PREVIEW' || o.play_detail === 'PLAY_NONE') o.play_detail = 'PLAY_WHOLE';
    if (typeof o.pay_check === 'number' && o.pay_check !== 1) o.pay_check = 1;
    if (o.play_video_type !== undefined || o.video_info || o.view_info) {
      o.play_video_type = 'whole';
    }

    for (let i = 0; i < VIP_OBJ_KEYS.length; i++) {
      const k = VIP_OBJ_KEYS[i];
      if (looksLikeVipObject(o[k])) patchVipObject(o[k]);
    }

    const keys = Object.keys(o);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k === 'vip' || k === 'vip_info' || k === 'vipInfo') continue;
      if (o[k] && typeof o[k] === 'object') walk(o[k], depth + 1);
    }
  }

  walk(root, 0);
  return root;
}
