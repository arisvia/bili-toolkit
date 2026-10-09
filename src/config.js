/**
 * 全局常量与默认值。
 *
 * 这里的 HOSTS / SANDBOX_PATHS / LOCAL_PATHS 会被序列化后内联进「主世界钩子」，
 * 因此必须是纯 JSON 可序列化的字面量，不能引用运行期变量。
 */

/** postMessage 通道命名空间（沙箱与主世界共用） */
export const NS = '__BILI_VIP__';

/** 钩子源码里的占位符，由沙箱在注入前替换成 JSON 配置 */
export const CFG_PLACEHOLDER = '__BILI_VIP_CFG__';

/** 唯一主机白名单：沙箱与主世界必须一致 */
export const HOSTS = ['api.bilibili.com', 'api.live.bilibili.com'];

/** 默认设置（GM 存储里的键不存在时用这些） */
export const DEFAULTS = {
  enabled: true, // 权益借用总开关
  patchUi: true, // 把页面上的大会员界面状态一并伪装（仅显示，身份仍是 A）
  prefetch: true, // 进入视频页时预热 playurl 缓存
  region: 'off', // 区域形态：off | hkmo | tw | cn（详见 core/region.js 的诚实边界）
  cacheTtlMs: 120000, // playurl 结果缓存时长（2 分钟）
  timeoutMs: 15000, // 单次代理请求超时
  strategy: -1, // -1 = 未探测，运行时自动选
  debug: false
};

/**
 * 画质档位。qn 是服务端返回码流的上限，所以必须由客户端显式抬高，
 * 否则即使用 B 的 Cookie 也会被 A 身份协商出的 qn 卡住。
 */
export const QUALITY_PRESETS = {
  max: { label: '自动最高（B 能拿多高就多高）', qn: 127, fnval: 4048, fourk: 1 },
  uhd: { label: '4K / HDR / 杜比', qn: 120, fnval: 4048, fourk: 1 },
  hd60: { label: '1080P 高帧率', qn: 116, fnval: 4048, fourk: 0 },
  hd: { label: '1080P 高码率', qn: 80, fnval: 4048, fourk: 0 }
};
export const DEFAULT_QUALITY = 'max';

/** 直播画质（qn：10000 原画 / 400 蓝光 / 250 超清 / 150 高清） */
export const LIVE_QN_PRESETS = {
  max: 10000,
  blue: 400,
  super: 250
};
export const DEFAULT_LIVE_QN = 'max';

/**
 * 需要补齐的「设备级」Cookie。B 的 Cookie 里若缺失，从当前页面（A 的浏览器）取同名值补上，
 * 避免 playurl 返回 -412。这些与登录身份无关，混用是安全的。
 * 注意：故意不含 sid / bili_jct —— 那两个是身份相关的，必须以 B 为准。
 */
export const DEVICE_COOKIE_BACKFILL = [
  'buvid3',
  'buvid4',
  'buvid_fp',
  '_uuid',
  'bili_ticket',
  'bili_ticket_expires',
  'b_nut',
  'b_lsid'
];

/** B 账号 Cookie 的发送策略，按优先级尝试；探测成功后记住下标 */
export const STRATEGIES = [
  { anonymous: true, useOption: true, useHeader: true, label: '排除浏览器 Cookie + cookie 选项 + Cookie 头' },
  { anonymous: true, useOption: true, useHeader: false, label: '排除浏览器 Cookie + 仅 cookie 选项' },
  { anonymous: true, useOption: false, useHeader: true, label: '排除浏览器 Cookie + 仅 Cookie 头' }
];