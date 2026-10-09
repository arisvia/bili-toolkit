/**
 * 面板文案 —— 唯一事实源。
 *
 * 为什么要集中：这些字散在 panel.js 的十几处字符串里，
 * 想统一语气或改一个错字要翻半个文件，而且很容易漏掉。
 *
 * 写作原则：
 *   · 一句话说一件事，不写"本脚本""我们"这类自称
 *   · 只在用户可能踩坑的地方解释，能点一下就知道的不写
 *   · 折叠区才放长说明，主界面一律短句
 */

export const TEXT = {
  /* --- 实时状态 --- */
  liveTitle: '当前播放',
  live: {
    idle: '待播放',
    cache: '缓存',
    live: '实时',
    resolution: '分辨率',
    codec: '编码',
    bitrate: '码率',
    options: '可选档位',
    endpoint: '来源'
  },

  /* --- 画质 --- */
  quality: {
    title: '画质请求',
    video: '视频 / 番剧',
    live: '直播',
    // 主界面只留一句，完整说明在折叠区
    brief: '向上请求，不代表一定拿得到',
    detail: [
      '两个条件同时成立才有 4K：',
      '',
      '· Cookie 决定响应里有没有 4K 流',
      '· 本档位决定播放器选哪一路',
      '',
      '实测：',
      '匿名请求时 dash 里最大只有 480P；',
      '换成会员账号后，若档位仍停在低档，播放器也只播低档。'
    ].join('\n')
  },

  /* --- 区域 --- */
  region: {
    title: '区域形态',
    label: '地区',
    brief: {
      off: '跟随 B 站返回',
      hkmo: '按港澳台渲染',
      tw: '按台湾渲染',
      cn: '按中国大陆渲染'
    },
    detailTitle: '这项能做什么',
    detail: [
      '改写页面的地区提示、版权横幅与分区入口，让它们按所选地区渲染。',
      '',
      '不能改的是服务端按 IP 判定的授权 —— 这一点实测过：',
      'geoip 的 9 种取值对 nav 响应毫无影响。',
      '',
      '若你本就在代理 / VPN 之后（请求从境外发出），',
      '服务端会真正放流，这项切换即等于完整解锁，无需另配。'
    ].join('\n')
  },

  /* --- B 账号 --- */
  account: {
    title: '会员账号',
    placeholder: '把 DevTools 复制的内容粘到这里，格式不用整理',
    empty: '未设置',
    actions: {
      save: '保存并验证',
      test: '仅验证',
      clear: '清除',
      paste: '粘贴'
    },
    states: {
      parseFail: '没解析出 Cookie，请确认复制的是 Cookies 列表的完整内容',
      noSessdata: '缺少 SESSDATA，无法登录',
      empty: '请先粘贴 Cookie',
      ready: '已解析，点「保存并验证」确认身份',
      complete: '字段完整',
      verifying: '正在验证…',
      cleared: '已清除',
      clipboardDenied: '浏览器拒绝了剪贴板读取，请手动 Ctrl+V',
      clipboardEmpty: '剪贴板是空的',
      copiedLog: '日志已复制',
      copyFailed: '复制失败，请到控制台查看',
      savedNote: '已保存 · 刷新视频页生效',
      clearConfirm: '清除已保存的 Cookie？'
    },
    presets: {
      min: '仅必需',
      recommended: '推荐',
      all: '全部'
    },
    parsed: (format, n) => `识别为${format} · ${n} 项`,
    missing: '未找到 SESSDATA',

    helpTitle: '怎么拿 Cookie',
    help: [
      'DevTools → Application → Cookies',
      '→ https://www.bilibili.com → 全选复制。',
      '',
      '粘贴后会自动整理，不用手工拼。',
      '',
      'SESSDATA 是 HttpOnly，document.cookie 取不到，',
      '必须从 DevTools 面板复制。',
      '',
      'Cookie 只写入本机油猴存储，不外发。'
    ].join('\n')
  },

  /* --- 开关 --- */
  switches: {
    borrow: '权益借用',
    ui: '界面伪装',
    prefetch: '预取',
    debug: '调试日志',
    on: '开',
    off: '关',
    enabled: '启用',
    disabled: '停用'
  },

  /* --- 诊断 --- */
  diag: {
    ok: '成功',
    fallback: '回退',
    cacheHit: '缓存',
    coalesced: '合并',
    retrying: '重新探测中…',
    actions: {
      copyLog: '复制日志',
      clearCache: '清缓存',
      reprobe: '重探'
    }
  },

  /* --- 状态徽标 --- */
  badge: {
    running: '点击展开',
    needSetup: '待设置账号',
    notReady: '未就绪',
    failing: '代理失败',
    off: '已停用'
  }
};

/** 分级徽章的配色，面板与外部页面共用 */
export const TIER_STYLE = {
  required: 'rgba(245,108,108,.18);color:#f56c6c',
  ogv: 'rgba(230,162,60,.2);color:#e6a23c',
  never: 'rgba(245,108,108,.14);color:#f56c6c',
  recommended: 'rgba(0,163,150,.16);color:#00a396',
  optional: 'rgba(128,128,128,.14);color:rgba(20,22,26,.5)'
};