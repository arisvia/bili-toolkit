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
  debug: false,
  codec: 'auto' // 编码偏好：auto | av1 | hevc | avc
};

/** 视频编码偏好 */
export const CODEC_PRESETS = {
  auto: { id: 'auto', label: '默认', priority: [] },
  av1: { id: 'av1', label: '优先 AV1', priority: [13, 12, 7] },
  hevc: { id: 'hevc', label: '优先 HEVC', priority: [12, 13, 7] },
  avc: { id: 'avc', label: '兼容 AVC', priority: [7, 12, 13] }
};
export const DEFAULT_CODEC = 'auto';

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

/**
 * 多账号池：每个账号的身份字段探测结果缓存 24h。
 *
 * 为什么缓存而不是每次开面板都探：nav 是按账号计的请求，池里 N 个账号就是 N 次往返，
 * 而会员状态一天之内几乎不变（过期也会在下次重探时被发现）。
 */
export const PROBE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 「切换浏览器登录态」时要写/删的 Cookie 清单 —— **只有身份字段**。
 *
 * 必须整组换，混着发就是线上最典型的故障：
 *   · SESSDATA / bili_jct  —— 身份与 csrf，番剧 OGV 静默失败就是这两者不同源
 *   · sid                   —— 与 SESSDATA 成对的服务端会话，绝不能跨账号沿用（见 findings §11）
 *   · DedeUserID(+__ckMd5)  —— 前端按它判断「我是谁」，不换会出现头像与昵称错位
 *
 * **设备字段刻意不在这里**（buvid* / bili_ticket / b_nut / b_lsid / _uuid）：
 * 它们属于**浏览器这台设备**，不属于任何一个账号。切号时写进去会造成两个问题 ——
 * 写：把某个账号的设备指纹盖到浏览器上；
 * 删：账号池里存的是最小字段集，于是每次切号都把这些字段算成「旧号残留」删掉，
 *     反而破坏了浏览器自己的设备指纹。
 * 所以它们既不写也不删，由站点自己刷新。
 *
 * 借用路径上缺设备字段也不要紧：`cookie.js` 的 backfillDeviceCookies 会从
 * 当前页面的 document.cookie 取同名值补上 —— 同一台设备，混用是安全的。
 *
 * 清单之外的 Cookie 一律不动 —— 写错一个无关字段比留着旧值更糟。
 */
export const IDENTITY_COOKIE_KEYS = [
  'SESSDATA',
  'bili_jct',
  'DedeUserID',
  'DedeUserID__ckMd5',
  'sid'
];

/**
 * 这些字段在 B 站上本来就是 HttpOnly，写回时必须带上同样的标记。
 * 写成非 HttpOnly 会让页面 JS 突然能读到登录态，凭空扩大暴露面。
 * 刻意只列这三个 —— DedeUserID、buvid* 在站点上本来就不是 HttpOnly，
 * 给它们加上标记会让依赖 document.cookie 的页面代码读不到。
 */
export const HTTP_ONLY_COOKIE_KEYS = new Set(['SESSDATA', 'bili_jct', 'sid']);