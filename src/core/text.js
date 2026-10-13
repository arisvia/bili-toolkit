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
  /* --- 视频编码偏好 --- */
  codec: {
    label: '编码',
    presets: {
      auto: '默认',
      av1: 'AV1',
      hevc: 'HEVC',
      avc: 'AVC'
    },
    titles: {
      auto: '沿用 B 站官方返回的原始排布顺序',
      av1: '优先 AV1 编码（画质好、效率高）',
      hevc: '优先 HEVC 编码（主流硬解、发热低）',
      avc: '兼容 AVC 编码（H.264，兼容性高）'
    },
    detailTitle: '不同编码的区别',
    detail: [
      '在同一画质档位下优先重排指定编码；若片源未提供或设备不支持则自动回退。',
      '',
      '· 优先 AV1：最新下一代编码，压缩效率最高、画质最佳，支持现代显卡硬解（通常见于 1080P 及以下）。',
      '· 优先 HEVC (H.265)：主流现代编码，画质好且绝大多数设备支持硬解，播放发热量小（4K 及 HDR 通常由此提供）。',
      '· 兼容 AVC (H.264)：传统兼容编码，老设备兼容性最好，但码率极大。',
      '· 默认：完全沿用 B 站官方返回的原始排布顺序。',
      '',
      '提示：本设置仅重排响应内的流顺序，最终播放所选编码以播放器实际请求为准。'
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
    detailTitle: '能改什么 · 不能改什么',
    detail: [
      '【改得了】',
      '页面上的地区提示、版权横幅、分区入口，按所选地区渲染。',
      '',
      '【改不了】',
      '服务端按 IP 判定的授权。实测 geoip 的 9 种取值对 nav',
      '毫无影响 ——「切到港澳台」不等于「能看」。',
      '',
      '【真要解锁】自己挂代理，按域名分流：',
      '',
      '  代理  api.bilibili.com、api.live.bilibili.com',
      '  直连  *.bilivideo.com、*.bilivideo.cn、',
      '        *.mountaintoys.cn',
      '',
      '直连的是视频字节，代理就卡；走代理的只是几十 KB 的',
      'playurl JSON —— 它决定服务端给你哪套 CDN。',
      '',
      '港澳台独占内容境内没有资源，只能走境外 CDN，慢是',
      '物理限制。'
    ].join('\n')
  },

  /* --- 账号池 --- */
  pool: {
    title: '账号池',
    brief: '登录用哪个号、权益借哪个号，可以不是同一个',
    emptyHint: '池子是空的，粘一个账号 Cookie 进来开始',
    /** 借用源不是当前登录号时的提示，末尾会接上借用方的名字 */
    borrowOther: '当前登录号没有大会员，已借用 ',
    manualBorrow: '正在用手动指定的账号借用权益',
    /** 浏览器当前登录的号已在池中，末尾接昵称 */
    inPoolTip: '浏览器当前登录：',
    /** 不在池中，但脚本读得到它的 Cookie（运行时探测的结果，不是假设） */
    autoImportTip: '浏览器当前登录：',
    /** 不在池中且读不到凭证 —— 文案只说「本浏览器读不到」，不断言 HttpOnly */
    notInPoolTip: '浏览器当前登录的这个号还不在池子里，且本浏览器读不到它的登录 Cookie，需要从 DevTools 复制一次',
    notLoggedInTip: '浏览器当前未登录。点击账号卡片上的「登录到此号」即可写入 Cookie 并以此身份浏览。',
    labels: {
      current: '登录中',
      /** 池里记着它是当前号，但浏览器实际登录的是别人 —— 不能再显示「登录中」 */
      currentMismatch: '记录为当前',
      borrowed: '借用中',
      vip: '大会员',
      plain: '非会员',
      unknown: '未探测'
    },
    actions: {
      switchTo: '切到此号',
      loginToBrowser: '登录到此号',
      useAsBorrow: '用它借用',
      autoBorrow: '恢复自动',
      autoImport: '一键加入池子',
      recheck: '重探',
      rename: '改名',
      renameAsk: '给这个账号起个名字',
      remove: '移除'
    },
    confirms: {
      switch: '把浏览器登录态切成这个号？弹幕、评论、投币之后都记在这个号名下。',
      loginToBrowser: '将此账号的 Cookie 写入浏览器并登录？弹幕、评论、投币之后都记在这个号名下。',
      remove: '把这个账号从池中移除？浏览器当前登录不会被改变。'
    },
    /** 池内没有账号可用时的兜底说明（switcher 会带回更具体的原因） */
    emptyBorrow: '账号池为空，且没有旧的单账号设置',
    borrowNoSessdata: '（借用源缺少 SESSDATA）',
    borrowFromMember: '当前账号非会员',
    borrowNoMember: '池内没有大会员账号',
    borrowUnprobed: '会员状态未探测',
    borrowEmpty: '账号池为空',
    states: {
      switching: '正在改写浏览器 Cookie…',
      switched: '已切换，页面即将刷新',
      switchSelf: '已经是这个号了',
      switchUnsupported: '当前管理器不支持写入 Cookie，只能改借用来源',
      switchFailed: '切换失败',
      switchDeleted: '已清掉旧号残留字段',
      switchPartial: '部分字段写入失败，切号可能不完整',
      borrowSet: '已改用它借用权益',
      importing: '正在导入当前登录的账号…',
      imported: '已加入账号池',
      importNeedCopy: '本浏览器读不到登录 Cookie，请从 DevTools 复制后手动添加',
      borrowAuto: '已恢复自动挑选',
      removed: '已从池中移除',
      stale: '待刷新(超24h)',
      staleTip: '本地超过24小时未核验大会员状态，不代表Cookie失效。点击右侧重探即可联网刷新。',
      autoBorrowTip: '解除手动锁定，恢复为系统自动挑选借用来源',
      recheckTip: '联网核验该账号的昵称、头像与大会员状态',
      /**
       * 池里记着 activeId，但浏览器实际登录的不是它 —— 多半是用户在别处换了登录。
       * 这种状态下最危险的是界面还在显示「登录中」：用户会以为池子是准的。
       * 所以除了提示，还要把那个标记降级（见 panel.js 的 poolRow）。
       */
      browserMismatch: '池里记着这个号是当前登录，但浏览器实际登录的不是它 —— 多半是在别处换了登录。借用照常工作，但「登录中」的标记已不可信；切号或加入池子后会自动对齐。',
      rechecking: '重新探测中…',
      renamed: '已改名'
    },
    helpTitle: '切号与借用的区别',
    help: [
      '两件事分开，混起来会困惑：',
      '',
      '· 切号 = 把浏览器真的登录成这个号。',
      '  之后弹幕、评论、投币都记在这个号名下。',
      '  依赖管理器写入 Cookie 的能力；写入后会刷新页面。',
      '',
      '· 借用 = 只改「用谁的 Cookie 取播放地址」，',
      '  页面仍然登录在原账号上，互动归属不变。',
      '',
      '自动借用：当前号没有大会员时，从池里挑一个有大会员的。',
      '',
      '【关于自动识别】',
      '脚本认得出浏览器当前登录的是谁（nav 会返回昵称）。',
      '能不能顺手把它收进池子，取决于本浏览器读不读得到登录 Cookie ——',
      '这点在不同环境下不一样，界面会当场告诉你能不能：',
      '· 已在池里 → 直接用它借用',
      '· 读得到 → 「一键加入池子」',
      '· 读不到 → 从 DevTools 复制一次'
    ].join('\n')
  },

  /* --- B 账号 --- */
  account: {
    title: '添加账号',
    placeholder: '把 DevTools 复制的内容粘到这里，格式不用整理',
    empty: '未设置',
    actions: {
      qr: '扫码添加',
      save: '保存并验证',
      test: '仅验证',
      clear: '清空',
      paste: '粘贴'
    },
    states: {
      parseFail: '没解析出 Cookie，请确认复制的是 Cookies 列表的完整内容',
      noSessdata: '缺少 SESSDATA，无法登录',
      empty: '请先粘贴 Cookie',
      ready: '已解析，点「保存并验证」确认身份',
      complete: '字段完整',
      verifying: '正在验证…',
      cleared: '已清空输入',
      clipboardDenied: '浏览器拒绝了剪贴板读取，请手动 Ctrl+V',
      clipboardEmpty: '剪贴板是空的',
      copiedLog: '日志已复制',
      copyFailed: '复制失败，请到控制台查看',
      savedNote: '已加入账号池',
      savedNotLoggedIn: '已加入账号池 · 浏览器未登录，点击下方卡片「登录到此号」可登录',
      savedTwice: '这个号已在池中，已更新'
      // 这里原本有 clearConfirm（「清除已保存的 Cookie？」）。清空按钮只清输入框、
      // 不动账号池，所以没有确认步骤，文案也就没人用。
    },
    
    parsed: (format, n) => `识别为${format} · ${n} 项`,
    missing: '未找到 SESSDATA',

    presets: {
      essential: '仅账号字段',
      all: '连设备字段一起存'
    },
    presetsHint: '设备字段实测对接口无影响，且切号时不该动它们',

    helpTitle: '要存哪些字段',
    help: [
      '【会存】SESSDATA / DedeUserID / bili_jct / sid ——',
      '借用与切号够用，就这么几个。',
      '',
      '【不存】buvid3 / bili_ticket 等设备字段：',
      '逐个删掉实测对接口毫无影响（SESSDATA 单独就是 4K），',
      '而且它们属于浏览器这台设备，切号时动了反而坏事。',
      '',
      'bili_jct 无法从 SESSDATA 推导，只能一起复制。',
      '',
      '拿不到登录 Cookie 时（如 SESSDATA 为 HttpOnly 的环境），',
      '只能从 DevTools 面板复制。',
      '',
      'Cookie 只写入本机油猴存储，不外发。'
    ].join('\n')
  },

  /* --- 扫码登录 --- */
  qr: {
    btn: '扫码添加',
    title: '扫码添加入池',
    loading: '正在生成二维码…',
    hint: '请使用哔哩哔哩手机客户端扫码',
    refresh: '点击刷新',
    cancel: '收起',
    expired: '二维码已失效，点击刷新',
    expiredBox: '二维码已失效\n点击重新生成',
    scanned: '已扫码，请在手机端确认登录',
    confirmed: '扫码成功！正在添加入池…',
    successToast: '扫码添加成功！已同步为当前登录态',
    failedToast: '扫码添加失败：'
  },

  /* --- 开关 --- */
  switches: {
    borrow: '权益借用',
    ui: '界面伪装',
    prefetch: '预取',
    softLogout: '软登出保活',
    debug: '调试日志',
    on: '开',
    off: '关',
    enabled: '启用',
    disabled: '停用'
  },

  /* --- 启动期的一次性提示 --- */
  startup: {
    hookFailed: '钩子注入失败（documentElement 迟迟不可用）',
    noMixinKey: '未能获取 wbi 密钥，画质参数将不会升级。可在面板诊断区点「重探签名密钥」重试。',
    poolEmpty: '账号池是空的，点左下角圆点打开面板添加账号。',
    cookieProblem: '账号 Cookie 有问题：',
    autoBorrow: '当前登录号没有大会员，已自动改用',
    autoBorrowTail: '的权益取播放地址。'
  },

  /* --- 菜单命令与通知 --- */
  menu: {
    open: '⚙️ 打开面板',
    toggle: '🔀 启用 / 停用权益借用',
    nextVip: '👥 切到下一个大会员号',
    autoBorrow: '🧲 恢复自动借用',
    quality: '🎚 切换画质请求档位',
    region: '🌏 切换区域形态',
    recheck: '🧪 重探账号身份',
    import: '🧽 从剪贴板导入账号',
    debug: '🐛 调试日志开关'
  },

  notify: {
    enabled: '已启用（刷新视频页生效）',
    disabled: '已停用（刷新视频页生效）',
    autoBorrowOk: '已恢复自动挑选借用来源',
    autoBorrowFail: '恢复失败：',
    quality: '画质档位 → ',
    /** 画质档位的中文名；键与 config.js 的 QUALITY_PRESETS 一致，qn 由那边给出 */
    qualityName: { max: '自动最高', uhd: '4K', hd60: '1080P60', hd: '1080P' },
    region: '区域形态 → ',
    regionTail: '（刷新页面生效）',
    debug: '调试日志：',
    on: '开',
    off: '关',
    clipboardDenied: '无法读取剪贴板，请打开面板手动粘贴',
    clipboardEmpty: '剪贴板是空的',
    importFail: '导入未成功：',
    importNoSessdata: '缺少 SESSDATA',
    added: '已加入账号池：',
    updated: '已更新池内账号：',
    vip: '大会员',
    plain: '非会员',
    recheckOk: '账号 ',
    recheckFail: '探测失败：',
    recheckMid: '（mid=',
    recheckMidEnd: '）',
    strategy: '\n发送方式 ',
    /** switcher.js 返回给面板的 reason（面向用户） */
    switchAlready: '已是当前身份，已重写一次 Cookie',
    switchLogged: '已切换登录态到 ',
    fieldFail: '写入失败：',
    fieldsFailed: '部分字段写入失败：',
    noSessdataWrite: '该账号没有 SESSDATA，无法设为登录态',
    cookieApiMissing: '当前脚本管理器不支持写入 Cookie',
    partialWrite: '部分字段写入失败，切号可能不完整',
    notFound: '账号不存在',
    nextVipOnly: '池里只有这一个账号',
    switchDone: '已切换到 ',
    reloadSoon: '，页面即将刷新',
    switchFail: '切换失败：',
    switchUnsupportedLong: '当前管理器不支持写入 Cookie，请在面板里改用「用它借用」',
    switchUnsupportedShort: '管理器不支持写入 Cookie',
    softLogoutCleaned: '软登出：已清理本地身份 Cookie'
  },

  /* --- 迷你胶囊 Dock --- */
  dock: {
    quickSwitch: '快捷切号',
    noOther: '无其他账号',
    switching: '正在切号…',
    currentBadge: '当前',
    vipBadge: '大会员',
    hoverTip: '悬停快捷切号'
  },

  /* --- 诊断 --- */
  diag: {
    title: '诊断',
    ok: '成功',
    fallback: '回退',
    cacheHit: '缓存',
    coalesced: '合并',
    retrying: '重新探测中…',
    /* --- 自检：把「首次不生效」这种静默故障变成可见信号 --- */
    selfCheck: '钩子',
    selfOk: '已接管 {n} 个请求 · playinfo 已隐藏',
    selfNoIntercept: '已连接，尚未接管到请求（非视频页属正常）',
    /** 借用开着、访问器装着，但 SSR 的 __playinfo__ 还能读到 —— 真正的异常 */
    selfPlayinfoOff: '已接管 {n} 个请求，但 playinfo 仍可读 —— 首屏会走本地缓存',
    /** 借用总开关关着，此时不隐藏是设计如此，不是故障 */
    selfPlayinfoNotNeeded: '已接管 {n} 个请求（借用未启用，不屏蔽 playinfo）',
    selfNoPlayinfo: '__playinfo__ 访问器没装上',
    selfDead: '未连接 —— 本页没有注入钩子',
    selfCheckTip:
      '自检分三层：脚本有没有跑起来 → 有没有真的接管到播放地址请求 → __playinfo__ 是否被屏蔽。\n' +
      '最难查的故障是「首次不生效、切画质后才行」—— 那时面板此前没有任何信号。',
    actions: {
      copyLog: '复制日志',
      clearCache: '清缓存',
      reprobe: '重测通道'
    },
    reprobeTip: '重新测试网络发送策略并探测可用通道'
  },

  /* --- 状态徽标 --- */
  badge: {
    running: '点击展开',
    needSetup: '待添加账号',
    notReady: '未就绪',
    failing: '代理失败',
    off: '已停用'
  }
};

/**
 * 分级徽章的配色，供面板外的独立页面（cookie-helper.html）使用。
 *
 * 面板自己不用它 —— 面板的标签配色要跟着明暗主题走，写死颜色在深色主题下
 * 对比度不够。面板走 panel.js 里的 `.tag` 类 + CSS 变量。
 */
export const TIER_STYLE = {
  required: 'rgba(245,108,108,.18);color:#c93a3a',
  ogv: 'rgba(230,162,60,.2);color:#9a6a10',
  identity: 'rgba(0,150,136,.14);color:#00796b',
  // 「浏览器自带」刻意做得很淡：它表示「不需要你操心」，不是「次要」
  auto: 'rgba(128,128,128,.1);color:rgba(20,22,26,.45)',
  optional: 'rgba(128,128,128,.14);color:rgba(20,22,26,.55)'
};