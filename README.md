<div align="center">

# bili-toolkit

**B 站用户脚本工具箱** —— 会员权益借用 · 多账号管理 · 播放体验

[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=node.js)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Userscript](https://img.shields.io/badge/userscript-Tampermonkey%20%7C%20Violentmonkey%20%7C%20ScriptCat-42b883?style=flat-square)](https://www.tampermonkey.net/)

</div>

---

## 这是什么

多账号池。以**主账号**浏览、互动、记录历史；
只有「播放地址获取接口」改用**已开通大会员的账号**去请求，
从而拿到 4K / 8K / HDR / 杜比 / 大会员专享剧集，**全程无需切换账号**。

> 文中 `A` = 当前登录的号，`B` = 已开通大会员的号。

弹幕、评论、投币、收藏、观看历史**仍然归属当前登录的号**。

## 快速开始

### 1. 安装脚本
1. 浏览器安装脚本管理器（[Tampermonkey](https://www.tampermonkey.net/) / [Violentmonkey](https://violentmonkey.github.io/) / [ScriptCat](https://scriptcat.org/)）。
2. 从 [Releases](https://github.com/arisvia/bili-toolkit/releases) 下载 `bili-toolkit-v*.user.js`（或直接复制 `dist/bili-toolkit.user.js` 代码并在管理器中新建保存）。

### 2. 添加入池（两种方式）
- **方式 A：📷 扫码一键添加（推荐，无需任何复制）**  
  打开任意 B 站页面，点击左下角圆点展开面板 → 点击 **「📷 扫码添加」** → 用手机 B 站客户端扫码确认即可自动添加入池并识别大会员。
- **方式 B：📋 手动粘贴 Cookie / DevTools TSV**  
  在面板「添加账号」输入框中直接粘贴从 DevTools 复制的内容（支持 12 列 TSV、JSON、原始字符串，自动分级清洗）→ 点击 **「保存并验证」**。

### 3. 享受超清播放
刷新视频页面即可！播放器将自动借用有权益账号的会话获取 4K / 8K / HDR 流。
## 账号池

面板里可以放多个账号，两件事分开控制：

| | 做什么 | 影响 |
|---|---|---|
| **切到此号** | 改写浏览器 Cookie，浏览器真的登录成这个号 | 弹幕、评论、投币之后都记在这个号名下；成功后自动刷新页面 |
| **用它借用** | 手动指定该账号为借用源 | 页面仍登录在原账号，互动归属不变 |
| **恢复自动** | 解除手动锁定借用源 | 恢复为池子自动挑选大会员账号 |

**自动借用**：当前号没有大会员时，从池里挑一个有大会员的号来取播放地址。
所以「用大会员号借权益、用普通号发弹幕」直接成立，不必手动切换。若曾手动锁定过借用号，卡片上可随时点击「恢复自动」重归智能分配。

切号依赖脚本管理器写入 Cookie 的能力（Tampermonkey / Violentmonkey 支持）。
不支持时按钮会置灰并说明原因，「用它借用」仍然可用 —— 它不需要任何写权限。

> 整组替换的边界见 [docs/findings.md](docs/findings.md) §12–§16：
> 切号必须同时换 `SESSDATA` / `bili_jct` / `sid` / `DedeUserID`，
> 只换一半会得到「B 的登录态 + A 的 csrf」，番剧 OGV 静默失败。

### 存哪些 Cookie

只存 5 个身份字段：`SESSDATA` / `DedeUserID` / `DedeUserID__ckMd5` / `sid` / `bili_jct`。

`buvid3` / `bili_ticket` 等设备字段**不存** —— 实测逐个删掉对接口毫无影响
（`SESSDATA` 单独就是 4K），而且它们属于**浏览器这台设备**，存进来只会在切号时
被误当成旧号残留删掉。详见 [docs/findings.md](docs/findings.md) §16。

## 为什么需要「抬高画质参数」

两个条件**缺一不可**，这是实测结论：

```
A 账号 + qn=32   → quality=32/480P     ← 只换账号不抬参数，画质纹丝不动
B 账号 + qn=127  → quality=120/4K      ← 账号与参数都到位
```

| 来源 | 决定什么 |
|---|---|
| **Cookie** | 响应里**有没有** 4K 流（匿名请求时 `dash` 里最大只有 480P） |
| **`qn` 参数** | 播放器**选哪一路**（同样是 B，qn=32 仍只播 480P） |

只做前者，就是「代理明明成功了，画质却死活不上去」的典型症状。

> 本文所有结论都来自真实请求验证，逐条列在 **[docs/findings.md](docs/findings.md)**，
> 附带复验命令。改动相关逻辑前请先读那份文档，别凭印象推断服务端行为。

## 功能

| | 说明 |
|---|---|
| **扫码添加入池** | 内置矢量二维码生成与状态机，手机扫码即可免复制自动归档进池，支持站点同步 |
| **多账号池** | 多个账号共存，支持头像展示，自动探测大会员身份与有效期（缓存 24h） |
| **一键切号** | 改写浏览器 Cookie 真正换号，身份字段整组原子替换，刷新即生效 |
| **自动借用** | 当前号无权益时自动借用池内有大会员的号，主号弹幕/投币/评论归属完全不变 |
| **新版番剧播放器接管** | 深度接管 Next.js React 18 水合与 nanoPlayer，消除首屏 6 分钟试看与暂停死锁 |
| **参数抬高** | `qn` / `fnval` / `fourk` 抬到预设档位，并重签 `w_rid` 与 `wts` |
| **编码偏好** | 同一分辨率内按偏好选择 AV1 / HEVC / AVC 编码，优先硬件硬解降低发热 |
| **高码率音轨** | 自动索要并优先选择 320k / 192k 极高码率音频流 |
| **凭证智能去重** | 重新扫码或重粘自动识别已有 mid 并无缝更新凭据，不产生幽灵孤立条目 |
| **Cookie 整理** | 直接粘贴 DevTools 复制的内容，自动解析分级，安全排除无关设备字段 |
| **液态玻璃面板** | 0.72 晶莹透光毛玻璃与 WCAG AA 双主题高对比度调色，文本框内嵌多态操作 |
| **实时面板** | 实时画质、分辨率、编码、码率、缓存状态每秒动态刷新 |
| **区域形态** | 按所选地区渲染页面提示与分区入口（支持港澳台/大陆） |
| **播放缓存** | TTL 缓存 + 并发去重，避免重复请求触发风控 |
### 区域形态的边界

页面显示、分区入口、版权提示可以改写；但**服务端按 IP 判定的授权改不了**。

已实测：`geoip` 的 9 种取值对 `nav` 响应毫无影响。
若你本就在代理 / VPN 之后（请求从境外发出），服务端会真正放流，
此时该切换即等于完整解锁，无需另配。

## 开发

```bash
npm install          # 只依赖 esbuild
npm run build        # 构建 dist/bili-toolkit.user.js
npm test             # 267 项 Node 测试
npm run verify       # 测试 + 线上契约校验 + 构建
npm run dev          # 监听重建
npm run harness      # 真实浏览器端到端冒烟
npm run release      # 构建 + 产物校验 + 打包
```

### 验证层次

| 命令 | 需要凭证 | 验证什么 |
|---|---|---|
| `npm test` | 否 | 纯逻辑：MD5、wbi 签名、白名单边界、代理流水线、账号池与切号、钩子行为 |
| `npm run verify:online` | 否 | **真实服务端契约**：密钥来源、`qn` 是否真的决定画质、端点路径 |
| `npm run harness` | 否 | 真实浏览器端到端（模拟 GM 环境 + 假响应），72 项 |
| `npm run verify:local` | **是（仅本机）** | **两个真账号的画质对照** |
| `npm run verify:cookie` | **是（仅本机）** | 逐字段消融，测出哪些字段真的有用；含 `qn` 档位扫描 |

带凭证的命令**只在本机运行**，Cookie 不会离开本机，输出自动脱敏。

凭证放 `credentials/A.txt`、`credentials/B.txt`（已被 gitignore）。
格式随意 —— DevTools 原始 12 列 TSV、Cookie 字符串、Chrome 导出的 JSON 都认。

## 目录结构

```
src/
  meta.js              userscript 头部（改版本号只改这里）
  config.js            常量：画质档位、Cookie 策略
  text.js              界面文案（唯一事实源）
  index.js             入口
  injected/hook.js     主世界钩子（独立作用域，构建时内联）
  core/
    accounts.js        ★ 多账号池：池形状、迁移、借用来源的自动解析
    browser-cookie.js  ★ 浏览器 Cookie 改写（切号用，能力分层降级）
    switcher.js        ★ 账号操作编排：切号 / 借用 / 探测的统一入口
    endpoints.js       ★ 端点表：哪些 host+method+path 允许带 B 的 Cookie
    proxy.js           ★ 代理流水线
    bus.js             沙箱 ↔ 主世界 消息通道
    inject.js          钩子注入 + 配置内联
    session.js         会话：Cookie 取值、发送方式探测、wbi 密钥
    cookie-parse.js    Cookie 原文解析（DevTools 12 列 TSV 等）
    cookie.js          Cookie 清洗 / 补齐 / 脱敏
    wbi.js  md5.js     签名
    transport.js       GM_xmlhttpRequest 封装
    cache.js           TTL 缓存 + 在途去重
    patch.js           响应补丁
    region.js          区域形态
    log.js             日志与统计
  ui/
    panel.js           液态玻璃悬浮面板（全脚本唯一配置入口）
    menu.js            油猴菜单（全部指向面板，不重复提供配置）
test/                  Node 测试 + 浏览器夹具
tools/                 构建、发布、验证工具
docs/findings.md       ★ 实测结论（含复验命令）——改代码前先读
```

## 扩展

新增受控接口只需改 `src/core/endpoints.js` 一处，
主世界钩子的白名单由它自动派生：

```js
{
  id: 'my-endpoint',
  host: 'api.bilibili.com',
  method: 'GET',
  path: '/x/whatever',
  mode: 'proxy',       // 目前只实现了 'proxy'（用 B 的响应替换页面响应）
  kind: 'video',       // 'video' | 'ogv' | 'live'；只有 'live' 会走直播画质参数
  csrf: false,         // true 则把 B 的 bili_jct 写进 query 与 body
  wbi: 'if-present'    // 'required' | 'if-present' | undefined
}
```

> `mode: 'merge'`（双发并合并字段）和 `kind: 'player-info'` **还没有实现**，
> 写上去也不会生效 —— 需要什么再提，这里不预先占位。

界面文案统一在 `src/core/text.js`，build 时会检查 `panel.js` / `menu.js` /
`switcher.js` / `index.js` 里有没有漏进来的中文串。

### 关于「自动导入已登录账号」

脚本认得出浏览器当前登录的是谁（`nav` 会返回昵称和 mid）。
至于能不能顺手把它收进池子，**取决于本浏览器读不读得到登录 Cookie** ——
这一点不同环境不一样（HttpOnly、扩展、站点版本都可能影响），
所以代码是**运行时探测**而不是写死结论，界面会当场告诉你走哪条路：

- 当前号**已在池里** → 直接给它「用它借用」，不必再复制
- **读得到** `SESSDATA` → 给「一键加入池子」
- **读不到** → 提示从 DevTools 复制一次

想确认自己属于哪种，把 `tools/cookie-readability-check.js` 粘进 B 站控制台跑一下。

详见 [docs/findings.md](docs/findings.md) §7 与 §17。

## 安全说明

- 沙箱侧独立复检 `host + method + 精确 path`，白名单外永远不会带上 B 的 Cookie
- `http` 协议一律拒绝
- Cookie 存于油猴本地存储，不上传任何地方
- 日志与诊断输出会脱敏，不打印完整 `SESSDATA`
- 账号 id 是 `SESSDATA` 的哈希，不含凭证内容；同一个号粘贴两次不会产生重复条目
- 切号只写 `.bilibili.com`，且只动白名单里的身份字段

## 许可

[MIT](LICENSE) · 仅供个人学习使用