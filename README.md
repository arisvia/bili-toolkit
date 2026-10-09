<div align="center">

# bili-toolkit

**B 站用户脚本工具箱** —— 会员权益借用 · 多账号管理 · 播放体验

[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=node.js)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Userscript](https://img.shields.io/badge/userscript-Tampermonkey%20%7C%20Violentmonkey%20%7C%20ScriptCat-42b883?style=flat-square)](https://www.tampermonkey.net/)

</div>

---

## 这是什么

以**主账号**浏览、互动、记录历史；
只有「播放地址获取接口」改用**已开通大会员的副账号**去请求，
从而拿到 4K / 8K / HDR / 杜比 / 大会员专享剧集，**全程无需切换账号**。

> 文中 `A` = 主账号（浏览用），`B` = 已开通大会员的副账号。

弹幕、评论、投币、收藏、观看历史**仍然归属 A**。

## 快速开始

1. 从 [Releases](https://github.com/arisvia/bili-toolkit/releases) 下载 `bili-toolkit-v*.user.js`
2. 打开 Tampermonkey → 添加新脚本 → 粘贴文件内容 → 保存
3. 页面左下角出现圆点，点开设置 B 账号 Cookie → 「保存并验证」
4. 刷新视频页

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

## 功能

| | 说明 |
|---|---|
| 权益借用 | 视频 / 番剧 OGV / 直播的播放地址走 B 账号 |
| 参数抬高 | `qn` / `fnval` / `fourk` 抬到预设档位，并重签 `w_rid` |
| Cookie 整理 | 直接粘贴 DevTools 复制的内容，自动解析、分级、剔除 `sid` |
| 实时面板 | 画质、分辨率、编码、码率、可用档位，每秒刷新 |
| 区域形态 | 按所选地区渲染页面提示与分区入口 |
| 播放缓存 | TTL 缓存 + 并发去重，避免重复请求触发风控 |

### 区域形态的边界

页面显示、分区入口、版权提示可以改写；但**服务端按 IP 判定的授权改不了**。

已实测：`geoip` 的 9 种取值对 `nav` 响应毫无影响。
若你本就在代理 / VPN 之后（请求从境外发出），服务端会真正放流，
此时该切换即等于完整解锁，无需另配。

## 开发

```bash
npm install          # 只依赖 esbuild
npm run build        # 构建 dist/bilibili-vip-proxy.user.js
npm test             # 44 项 Node 测试
npm run verify       # 测试 + 线上契约校验 + 构建
npm run dev          # 监听重建
npm run harness      # 真实浏览器端到端冒烟
npm run release      # 构建 + 产物校验 + 打包
```

### 验证层次

| 命令 | 需要凭证 | 验证什么 |
|---|---|---|
| `npm test` | 否 | 纯逻辑：MD5、wbi 签名、白名单边界、代理流水线、钩子行为 |
| `npm run verify:online` | 否 | **真实服务端契约**：密钥来源、`qn` 是否真的决定画质、端点路径 |
| `npm run harness` | 否 | 真实浏览器端到端（模拟 GM 环境 + 假响应） |
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
    endpoints.js       ★ 端点表：哪些 host+method+path 允许带 B 的 Cookie
    proxy.js           ★ 代理流水线
    bus.js             沙箱 ↔ 主世界 消息通道
    inject.js          钩子注入 + 配置内联
    session.js         B 会话：Cookie 补齐、发送方式探测、wbi 密钥
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
  mode: 'proxy',       // 'proxy' = 用 B 替换；'merge' = 双发并合并字段
  kind: 'video',       // 'video' | 'ogv' | 'live' | 'player-info'
  csrf: false,         // true 则把 B 的 bili_jct 写进 query 与 body
  wbi: 'if-present'    // 'required' | 'if-present' | undefined
}
```

界面文案统一在 `src/core/text.js`，build 时会检查 `panel.js` 里有没有漏进来的中文串。

## 安全说明

- 沙箱侧独立复检 `host + method + 精确 path`，白名单外永远不会带上 B 的 Cookie
- `http` 协议一律拒绝
- Cookie 存于油猴本地存储，不上传任何地方
- 日志与诊断输出会脱敏，不打印完整 `SESSDATA`

## 许可

[MIT](LICENSE) · 仅供个人学习使用