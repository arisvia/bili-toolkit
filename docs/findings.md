# 实测结论

本文只记录**用真实请求/真实数据验证过的事实**，不含设想与计划。

每条都标了复验命令。服务端行为会变，**结论与代码冲突时，先跑复验命令，不要相信本文**。

| 复验命令 | 需要凭证 | 覆盖 |
|---|---|---|
| `npm run verify:online` | 否 | §1 §2 §4 §5 §6 §7 |
| `npm run verify:local` | 是（仅本机，输出脱敏） | §3 §5 |
| `npm test` | 否 | §8 §9 §12 §13 §15 §16 §17 §18 |
| `npm run verify:cookie` | 是（仅本机） | §16 |
| `node tools/player-keys.mjs` | 否 | §20 |
| `npm run harness` | 否 | §14 |

最近一次全量复验：**2026-10-10**

---

## §1 wbi 密钥的真实来源是 `nav`，不是 `wbi/img`

**结论**：`/x/web-interface/wbi/img` 已下线（HTTP 404）。密钥在
`/x/web-interface/nav` 响应的 `data.wbi_img.img_url` / `.sub_url`。

```
/x/web-interface/wbi/img  →  HTTP 404
/x/web-interface/nav      →  data.wbi_img.img_url / data.wbi_img.sub_url
```

**影响**：`session.js` 的 `ensureMixinKey()` 以 nav 为主源，旧端点仅兜底。
密钥拿不到时代理会退回原始参数——于是「代理有反应、画质永不升级」且无线索。

**复验**：`npm run verify:online` 第 [0] [1] 段。
`[0]` 是信息性的：哪天旧端点又活了会打印提示，可以改回直取省掉一次 nav 往返。

---

## §2 `w_rid` 当前不被服务端强制校验

**结论**：同一个 playurl 请求，带正确签名 / `w_rid` 全零 / 完全不带 `w_rid`，
**三种情况都返回 `code=0`**。

**影响**：重签 `w_rid` 保留是为了「万一恢复校验」，且改参数后重签总是安全的。
**不要把它当成当前生效的必要步骤**，也不要写成「不重签必然 -403」——
仓库早期的注释就是这么写的，是错的，已改。

**复验**：`npm run verify:online` 第 [4] 段（只记录事实，不作断言）。

---

## §3 画质需要两个条件，缺一不可

**结论**：Cookie 决定 dash 里**有没有**高码流，`qn` 决定播放器**选哪一路**。

实测（`verify:local`，同一视频 BV1PTHS6MEC5 / cid=42560719352）：

| 场景 | quality | 结果 |
|---|---|---|
| A（非会员）+ 页面原始参数 `qn=32` | 32 | 480P |
| B（大会员）+ **同样** `qn=32` | 32 | **480P，画质纹丝不动** |
| B（大会员）+ 抬高参数 `qn=127` + 重签 | 120 | **4K** |

Q2 是关键：只换 Cookie 不抬 `qn`，画质完全不变。这就是「借到了身份却没画质」的成因。

**匿名侧的补充实测**（`verify:online` 扩展探测）：

```
匿名 qn=16 → dash.video ids [32,32,32,16,16,16]
匿名 qn=32 → dash.video ids [32,32,32,16,16,16]
匿名 qn=64 → dash.video ids [32,32,32,16,16,16]
匿名 qn=127→ dash.video ids [32,32,32,16,16,16]   quality 字段回报 64
```

- 匿名状态下 **dash 里最大流恒为 32（480P）**，把 `qn` 抬到 127 也不会出现 4K 流。
- **`quality` 字段在匿名态不可信**：它回报 64，但 dash 里根本没有 64 以上的流。
  判断「实际能不能放」要看 `dash.video[].id`，不要看 `quality`。

**复验**：`npm run verify:local`（§3 表格）；匿名侧跑 `npm run verify:online` 第 [3] 段。

---

## §4 `accept_quality` / `support_formats` 不能用来判断账号权益

**结论**：这两个字段**与账号无关**，B 大会员和匿名拿到的完全一样。

但它**不是**「固定的完整档位表」—— 这一点原来写错了，2026-10-10 实测纠正。
它是**每部片子自己的档位表**，逐片不同：

```
片号            B                        匿名                     dash 最大流 B/匿名
BV1PTHS6MEC5    [120,112,80,64,32,16]    [120,112,80,64,32,16]    120 / 32
BV1hxHR68E24    [116,80,64,32,16]        [116,80,64,32,16]        116 / 32
BV1Xdps6nEhe    [120,116,80,64,32,16]    [120,116,80,64,32,16]    120 / 32
```

**另一个反直觉的点**：响应的 `quality` 与 `accept_quality` 的最大值**不相等**。
匿名 qn=127 时实测 `quality=64`，而清单里写着 116 —— 两者对不上。
所以也不能拿 `quality` 去反推清单、拿清单去反推 `quality`；
唯一可靠的读法是 `dash.video[].id` 的最大值，也就是响应里**真实存在的流**。

**为什么这个区别有实际后果**：正因为它随片子变，它恰好就是面板该显示的东西 ——
「这部片子提供哪些档」，配上响应的 `quality`（实际拿到了哪档），
用户一眼能看出借用是否生效。面板「可选档位」用的就是这个字段，实现是对的。

**影响**：会员状态只能读 **nav 的 `data.vipStatus`**（`patch.js` 的 `extractVipFromNav()`）。
若哪天看到有人用 `accept_quality.includes(120)` 判断大会员，那是错的。

**复验**：`npm run verify:online` 第 [8] 段（已固化为断言）。

---

## §5 `accept_quality` 在 `playurl` 里，不在 `/x/player/wbi/v2` 里

**结论**：**登录态**下请求 `/x/player/wbi/v2`，响应里没有任何 `accept_*` 字段。
画质清单只存在于 playurl 响应。

**影响**：`v2` 因此走本地伪装（改写会员字段）、**不走代理**，省掉一次 HTTP 往返。
若将来发现画质菜单不完整，先复验 `v2` 的 `accept_*` 是否真的出现（`verify:local` 第 [5] 段），
再决定是本地补字段还是纳入代理。注意 `mode: 'merge'` **从未实现**，
`build.mjs` 现在会直接拒绝它 —— 别照着旧结论去改。

**复验**：`npm run verify:online` 第 [6] 段（匿名）；`npm run verify:local` 第 [5] 段（登录态）。

---

## §6 区域（港澳台）无法真正解锁

**结论**：`geoip` 的 9 种取值对服务端**毫无影响**。

```
cn / cn_c / oversea / hk / tw / mo / intl / oversea_cn / intl_hk
→ 9 种取值，1 种 ip_region 结果（恒为 "CN"）
```

`nav.ip_region` 由服务端按请求来源 IP 判定。

**影响**：能改的只是**页面渲染形态** —— `rights.area_limit`、`ban_area_show`、`areas[]`，
这些字段恰好都在已拦截的接口里，所以 `region.js` 会改写它们。
**面板文案已写明这条边界，不要夸大宣传。**

例外情况：若用户本身在代理/VPN 之后（请求从境外 IP 发出），服务端会真正放流，
此时该切换等于完整解锁。

**复验**：`npm run verify:online` 第 [7] 段（已固化为断言；服务端哪天开始认 geoip，CI 会立刻失败提醒）。

---

## §7 `SESSDATA` 能不能用 `document.cookie` 读到 —— **结论作废，改为运行时探测**

**原结论（已作废）**：「`SESSDATA` 是 HttpOnly，`document.cookie` 取不到」。

**为什么作废**：这条从来没有被真实浏览器验证过。当时唯一的"证据"是
`test/fixtures/harness.html` 里的 mock：

```js
document: { cookie: 'buvid3=a-dev3; DedeUserID=111; bili_jct=a-csrf' }  // 没有 SESSDATA
```

而这个 mock 本身就是照着结论写的 —— 然后 `test/accounts.test.mjs` 又断言
`document.cookie` 里没有 `SESSDATA`。**拿自己的 mock 验证自己的假设，循环论证。**
用户实测在控制台能看到 `SESSDATA`，说明该结论至少不是普遍成立的。

**现在的做法：不写死，运行时探测**。

`session.js` 的 `readBrowserCookie()` 当场读 `document.cookie`，
面板据此走三条不同的路（`switcher.js` 的 `overviewAsync()`）：

| 探测结果 | 界面 |
|---|---|
| 当前号已在池中 | 给「用它借用」，凭证现成 |
| 不在池中且**读得到** `SESSDATA` | 给「一键加入池子」 |
| 不在池中且**读不到** | 提示从 DevTools 复制 |

**影响**：自动导入从「不可能」变成「取决于环境」。凡是以前写着
「SESSDATA 是 HttpOnly 所以读不到」的推断，现在都改成运行时判断。

**复验**：把 `tools/cookie-readability-check.js` 粘进 B 站页面控制台执行，
它会打印 `docHasSess` / `docNames` 等字段（只列名字不含值）。
`npm test` 覆盖三种分支（`test/accounts.test.mjs` 第 [14] 组）。

**仍然成立的部分**：`GM_cookie.list()` 读 HttpOnly 这条是 Tampermonkey 官方文档
明写的（仅 beta 版本支持），见 §12。

---

## §8 DevTools 复制出来的是 12 列 TSV

**结论**：从 DevTools 的 Cookie 表格里复制，粘到剪贴板的是制表符分隔的 **12 列**：

```
Name ⇥ Value ⇥ Domain ⇥ Path ⇥ Expires ⇥ Size ⇥ HTTPOnly ⇥ Secure ⇥ SameSite ⇥ Priority ⇥ PartitionKey
```

**只能取前两列**。否则 Domain / Path 会被拼进值里，保存后必然失效。

**复验**：`npm test`（`test/cookie-parse.test.mjs` 覆盖 12 列 TSV 解析）。

---

## §9 `bmg_af_sc={"none":{"on":1}}` 会破坏朴素的切分与 JSON 解析

**结论**：该字段的值里同时含 `;` 与 `"`：

- 放进 JSON 文件 → 被引号截断
- 用朴素 `split(';')` 或 `;([\w-]+)=` 正则切分 → 把 `DedeUserID` 的值
  错误粘成 `"42; sid=XXX"`

**解法**（`cookie-parse.js` 已实现）：逐字符扫描 `;`，
只有后面**紧跟合法 cookie 名 + `=`** 时才算真分隔符
（cookie 名不含 `{` `"` `:` `,`，而该字段内部必然出现这些字符）。

**复验**：`npm test`（`test/cookie-parse.test.mjs` 有专门的回归用例）。

---

## §10 抬高参数本身没有被风控拦截

**结论**：`qn=127` + `fnval=4048` + `fourk=1` 直接发出，服务端正常返回 `code=0`，
连续多次未见 `-412`。

**影响**：本项目的参数抬高策略目前是安全的。

**注意**：这与 §2 是一回事 —— 服务端当前既不强制校验 `w_rid`，
也不因为参数被抬高而拒绝。**这两条都是「当前如此」，不是「结构性保证」**，
不要据此认为抬高参数永远不会被拦。

**复验**：`npm run verify:local` 第 [6] 段。

---

## §16 设备字段不必存：实测消融 + 它们属于浏览器而非账号

**结论**：把 B 账号的 Cookie 逐个字段删掉再请求 playurl，**除 `SESSDATA` 外全部无影响**。

```
删 SESSDATA        → 画质 120/4K 降为 64/720P   ← 唯一必需
删 bili_jct        · 无影响
删 DedeUserID      · 无影响
删 buvid3/buvid4   · 无影响
删 bili_ticket     · 无影响
删 _uuid/b_nut/…   · 无影响

SESSDATA 单独                      → quality=120/4K，dash 最大流 120/4K
SESSDATA + DedeUserID + bili_jct   → quality=120/4K（与上面完全一致）
```

**所以账号池里只存身份字段**：

| 存 | 用途 |
|---|---|
| `SESSDATA` | 登录态，唯一必需 |
| `DedeUserID` / `DedeUserID__ckMd5` | 切号后前端认人 |
| `sid` | 与 SESSDATA 成对，切号必须整组换（§13） |
| `bili_jct` | 番剧 OGV 的 csrf |

**不存**：`buvid3` / `buvid4` / `bili_ticket` / `bili_ticket_expires` / `buvid_fp` /
`b_nut` / `b_lsid` / `_uuid`。

两条独立理由，缺一不可：

1. **实测无用** —— 见上。
2. **它们属于浏览器这台设备，不属于任何账号** —— 存进池子只会在切号时被
   `staleKeysFor()` 算成「旧号残留」删掉，反而破坏浏览器自己的设备指纹。
   **这个 bug 真实发生过**：白名单最初把 `buvid*` 也列了进去，
   而池子里存的是最小字段集，于是每次切号都在删设备字段。

所以 `config.js` 的 `IDENTITY_COOKIE_KEYS` 只含 5 个身份字段，
设备字段**既不写也不删**，由站点自己刷新。借用路径上确实缺设备字段也不要紧 ——
`cookie.js` 的 `backfillDeviceCookies()` 会从当前页面的 `document.cookie`
取同名值补上，同一台设备混用是安全的。

**`bili_jct` 无法从 `SESSDATA` 推导**：试过 5 种已知公式
（`md5(md5(K+s)+K)` 等）全部与真实值不匹配，只能从 DevTools 一起复制。

**注意**：消融只覆盖普通视频的 playurl（GET）。番剧 playview 有 GET（新版页面，无 csrf）
与 POST（旧版页面，需要 csrf）两种形态，`bili_jct` 的作用要在 POST 那里才测得到 ——
所以「无影响」只适用于普通视频。

**复验**：`npm run verify:cookie`（逐字段消融 + 最小集对照）。

---

## §17 「知道当前是谁」与「能不能拿到它的 Cookie」是两件事

**结论**：前者一定能做到，后者**取决于环境** —— 所以要运行时探测，不能写死。

| 能力 | 怎么做的 |
|---|---|
| 知道当前登录的是谁 | 用**浏览器自身 Cookie** 请求 `/x/web-interface/nav`，返回 `data.mid` / `uname` / `vipStatus` |
| 拿到当前账号的 Cookie | `document.cookie` —— **因环境而异**，见 §7 |

**易混点**：`GM_xmlhttpRequest` 能**用**浏览器的 Cookie 发请求，但那不等于能**读到**它。
`probeIdentity()` 里的「对照组」正是靠前者拿到浏览器身份的，不是靠后者。

**影响**：面板据此分三条路 —— `overviewAsync()` 返回
`inPool`（凭证现成）/ `canAutoImport`（读得到，给「一键加入池子」）/
`needsManualCopy`（读不到，如实提示去 DevTools）。
nav 失败或读不到时静默降级，不阻塞面板。

**注意**：`importBrowserAccount()` 读不到 SESSDATA 时返回 `needManualCopy`，
**绝不用别的东西凑一个假 Cookie** —— 比如拿浏览器的 device 字段拼个空壳，
那会在切号时把用户直接踢下线。

**复验**：`npm test`（`test/accounts.test.mjs` 第 [14] 组，三条分支都覆盖）。

---

## §18 重复添加同一账号是去重，不是新增

**结论**：账号 id = `SESSDATA` 的 FNV 哈希，所以同一个号粘贴多少次都只有一条。

```
第一次  → isNew=true，  池内 1 条
第二次  → isNew=false， 池内 1 条，id 相同
```

保留：用户起的 `label`、`addedAt`、没变时的探测结论。
替换：`cookie` 本身。

**换了 Cookie 内容就要连探测结论一起作废**（`vipStatus` / `vipType` / `checkedAt`）：

只清 `checkedAt` 而留着 `vipStatus` 会造成假象 ——
把一份已失效的 Cookie 粘到已有的会员号上、探测失败，
面板却继续显示「大会员」。**这个 bug 真实发生过。**

**复验**：`npm test`（`test/accounts.test.mjs` 第 [13] 组）。

---

## §19 视频字节不在 `api.bilibili.com`，按域名分流就够

**结论**：`playurl` 响应只是 JSON，里面的 `dash.video[].baseUrl` 才指向真正的 CDN。
所以「代理 api 域名」和「代理视频流量」是两件毫不相干的事。

实测（`node tools/cdn-domains.mjs`，国内普通视频）：

```
quality=116，dash 最大流=116
响应引用 38 个主机名，归并后只有 3 条规则：
  18 × bilivideo.cn      （*.mcdn.bilivideo.cn）
  14 × mountaintoys.cn   （b-* / *-edge.mountaintoys.cn，逐个随机）
   6 × bilivideo.com     （upos-sz-* / cn-gddg-ct-*）
```

**一条境外域名都没有。**

**影响：分区规则很简单**

| 域名 | 走不走代理 | 理由 |
|---|---|---|
| `api.bilibili.com` | **走** | 区域判定发生在这里（`rights.area_limit`、以及「给你哪套 CDN」都是这个响应决定的） |
| `api.live.bilibili.com` | **走** | 同理；只有想看港澳台直播才需要 |
| `www.bilibili.com` | 走 | 首屏 SSR 决定页面是不是直接给「地区限制」提示，代理后 UI 才一致；**不是解锁的必要条件** |
| `*.bilivideo.com` / `*.bilivideo.cn` / `*.mountaintoys.cn` | **不走** | 视频字节本体。代理 = 搬几百 MB = 卡 |

代理 `api.bilibili.com` 的代价是每部片几十 KB 的 JSON 和一次往返延迟；
媒体仍由播放器直连 CDN。**「全部代理会卡」的担心，在按域名分流的前提下不成立。**

**例外（别忽略）**：港澳台**独占**内容境内 CDN 根本没有那份资源，
服务端会返回 `upos-hz-mirrorakam.akamaized.net`。这时不代理 CDN 就没得看，
代理了就慢 —— 这是物理限制，不是配置能解决的。
（此条来自 bilimiao2 的文档，未在本仓库实测。）

**复验**：`node tools/cdn-domains.mjs`（需要 B 账号凭证，输出只含域名）。

---

## §20 播放器的画质开关：哪些 key 是真的

**结论**：网上流传的「强制 HDR/8K」脚本里有一批 key 是**虚构的**，
另有一条用 `navigator.userAgent` 冒充 Safari 的做法，是有官方替代的、且有风险的做法。

实测（`node tools/player-keys.mjs`，搜 `core.ba67b466.js` 原文）：

| key | 是否存在 | 原文语义 |
|---|---|---|
| `bilibili_player_force_hdr` | **存在** | `checkDisplayHDRCapability` 里 `parseInt(...)` 与 `matchMedia('(dynamic-range: high)')` 取或 |
| `bilibili_player_force_8k` | **存在** | `if (parseInt(getLocalStorage("bilibili_player_force_8k"),10)) return true;` |
| `enableHEVCError` | **存在** | `"1" !== getSessionStorage("enableHEVCError") && MediaSource.isTypeSupported(HEVC)` |
| `bilibili_player_force_DolbyAtmos&8K&HDR` | **不存在** | 网上脚本编的，写进 localStorage 什么也不会发生 |

**8K 的浏览器门就是要冒充 Safari 的原因**：

```js
if (!checkVideoCapabilitySync({codec,width,height}).supported) return false;   // 硬件能力探测
if (parseInt(getLocalStorage("bilibili_player_force_8k"),10)) return true;      // ← 官方短路
// 下面才是按浏览器类型/版本判断：Safari>=13 / ChromiumEdge>=120 / …
```

所以 `_force_8k` **就是** UA 骗术的正解，不需要冒充。

**三条边界**：

1. `_force_hdr` 只拆掉**显示能力**那一道门，`checkVideoCapabilitySync` 的硬件探测仍在。
   开了也不会让没有 HDR 能力的显示器硬出 HDR —— 它只影响播放器的**判定**，不影响屏幕。
2. `enableHEVCError` 屏蔽后播放器**永远认为 HEVC 可用**。
   真解码不了的机器会从「降级到 AVC 播放」变成「放不出来」。
   有效但有真实代价，不能无条件开。
3. 冒充 Safari 的代价是**真的**：播放器的 Safari 分支围绕 HLS/m3u8 构建，
   而本项目的代理发的是 DASH 响应（`otype=json`）。
   让播放器走 Safari 代码路径 = 去要一个我们没提供的流。
   这类改动的失败模式是「视频彻底放不出来」，是这个脚本最不能犯的错。

**因此**：以上三项**当前均未加入**，理由是它们解决的是「播放器要不要展示这些档」，
而实测（§4、§3）表明决定权在**服务端返回的 dash 里有没有对应的流**。
等真的遇到「流在响应里但播放器不给选」时，再按上面的边界逐条评估。

**复验**：`node tools/player-keys.mjs`（不需要凭证）。

---

## §11 观察但未稳定复现

- 携带 `buvid3` / `bili_ticket` 等风控字段与不携带，常规测试下**响应无差异**。
  但历史上观察到过 `-412`。未能稳定构造复现条件，因此**不下结论**。
  保守做法仍是保留这些字段。
- 逐字段消融显示：只有 `SESSDATA` 影响 playurl；`bili_jct` 是番剧 OGV POST 的必需项。
  **`sid` 绝不能跨账号混用**（多账号改造时尤其注意，详见 §13）。

**复验**：`npm run verify:cookie`（逐字段消融）。

---

## §12 一键切号靠管理器写 Cookie，`document.cookie` 写不了 HttpOnly

**结论**：用户脚本改不了浏览器登录态里的 `SESSDATA`，但**可以**通过管理器 API 写入。

```
document.cookie = 'SESSDATA=...'  → 被 HttpOnly 规则拒绝（写入也无效）
GM.cookie.set({name, value, httpOnly:true})  → 可以
```

能力是分层的，缺一层就少一项能力，**如实降级而不是假装成功**：

| 可用 API | 能覆盖写 | 能删除 |
|---|---|---|
| `GM.cookie.set/delete` | ✔ | ✔ |
| 仅 `GM_setCookie` | ✔ | ✔（用过期时间写） |
| 都没有 | ✘ | ✘ |

**影响**：`switcher.js` 在两种 API 都没有时返回 `unsupported`，面板把「切到此号」
置灰并说明原因，只保留「用它借用」——后者不需要任何 Cookie 写权限。

**注意**：`GM.cookie.list()` 文档明确写着 **HttpOnly 只在 beta 版本可读**。
所以「浏览器实际登录的是谁」这个信息可能读不到，读不到就不显示，
**不能靠它做任何必需功能**（`overviewAsync()` 里读不到时静默降级）。

**复验**：`npm test`（`test/accounts.test.mjs` 第 [10] [12] 组）。

---

## §13 切号必须整组换字段

**结论**：只写 `SESSDATA` 会得到「B 的登录态 + A 的 csrf」，
表现为**番剧 OGV 静默失败**（接口返回 code=0 但没有视频，不报错）。

必须同一账号、一起换的字段：

```
SESSDATA / bili_jct / sid / DedeUserID(+__ckMd5)
```

- `sid` 与 `SESSDATA` 成对的服务端会话，跨账号沿用必然出错（呼应 §11 的消融结论）
- `bili_jct` 是番剧 OGV POST 端点（playview/playurl）的 csrf，与 SESSDATA 同源
- `DedeUserID` 不换的话前端仍按旧号渲染头像与昵称

**还要删**：目标账号没有、而浏览器里有的字段必须显式删除，否则旧字段继续生效。
删除名单必须在**切换前**算（用池内记录的旧账号 Cookie，它就是上次写进去的那份），
切换后再问就只会拿到新值，差集恒为空。

**HttpOnly 只有 `SESSDATA` 一个。真机实测（2026-11-03）。**

**证据一（干净环境）**：`credentials/A.txt` 是污染前的 DevTools 12 列导出，
第 7 列（HttpOnly）只有 `SESSDATA` 是 `✓`，`bili_jct` / `sid` / `DedeUserID` 全空。
这与站点行为一致：真实浏览器里只有 `SESSDATA` 是 HttpOnly。

**证据二（站点源码）**：`core.befa0edb.js` 的 axios 请求拦截器原文

```js
w.A.interceptors.request.use(function (n) {
  var r = '[object Object]' === P(n.data);
  return /^POST$/i.test(n.method) && r && !n.data.csrf && Object.assign(n.data, { csrf: C.get('bili_jct') }),
         r && (n.data = R().stringify(n.data)), n;
});
```

条件是 `'[object Object]' === P(n.data)`，即只给 **JSON body** 的 POST 补 csrf；
form-urlencoded 的请求（如点赞 `archive/like`）不走这条，所以它们不带 csrf 也能成功。
`C.get` 的实现就是解析 `document.cookie`（同 bundle 的 `ty` / `ni` 系列函数）。
**站点自己都要从 `document.cookie` 读 `bili_jct` —— 标成 HttpOnly 它自己也读不到。**

**expires 精度不能用来判断写入方**：曾试图用「整数 = 脚本写、小数 = 站点写」推断，
但服务端 `Set-Cookie` 只有秒级精度，整数无法区分两者（`DedeUserID` 的 `.739696`
只能证明「带小数的必然不是服务端写的」，不能反推整数归属）。该论据已作废。
能确认的是：**你机器上 `bili_jct` / `sid` 当前是 HttpOnly，与站点行为不符**，
而 1.3.0 的 `applyAccount` 正是把它们写成 HttpOnly 的代码，改代码不会自动回滚已有写坏的属性。

**站点确实从 `document.cookie` 读 csrf** —— 见上「证据二」的拦截器原文。

**真机对照实验（同一账号、同一视频 `BV1i24P6rEmt`）**：

| 调用 | csrf 来源 | 结果 |
|---|---|---|
| `x/v3/fav/resource/deal` 加收藏 | 页面 `document.cookie`（读不到） | **-111 CSRF 校验失败** |
| `x/v3/fav/resource/deal` 加收藏 | CDP 拿到的真实值 | code 0，收藏夹里确认出现 |
| `x/v3/fav/resource/deal` 取消收藏 | CDP 真实值 | code 0，确认已移除 |
| `x/v2/history/toview/add` | 页面 `document.cookie`（读不到） | **-111 CSRF 校验失败** |
| `x/v2/history/toview/add` | CDP 真实值 | code 0，列表 556→557 |
| `x/v2/history/toview/del` | CDP 真实值 | code 0，回滚 557→556 |
| `x/web-interface/coin/add` multiply=1 | 页面 `document.cookie`（读不到） | **-111 CSRF 校验失败** |
| `x/web-interface/coin/add` multiply=1 | CDP 真实值 | code 0，`coins.multiply` 0→1（投币不可逆，1 枚） |

结论：**故障就出在 HttpOnly 这一个属性上，值与接口都是好的。**
`DedeUserID` / `buvid*` 误加标记同样会让依赖 `document.cookie` 的代码读不到。

**池里没有 bili_jct 的账号不允许切号。** csrf 无法从 SESSDATA 推导（§16），
而切过去之后浏览器里的 csrf 只能来自池内记录，所以缺了就是一个
「能播放、但互动全 -111」的登录态。`switchLoginTo` 直接返回失败。

**csrf 也绝不跨账号补。** `backfillDeviceCookies` 只补设备字段；
`bili_jct` 一律不补 —— `DedeUserID` 是可粘贴、可伪造的普通字段，用它
「证明是同一个号」不成立。同理，借用源没有 csrf 时 `prepare()` 会
**删掉页面自带的 csrf**（query 与 body 都删），而不是把 A 的发给服务端：
`-111` 比「没带 csrf」更难查。

下划线别名 `bili-jct` 在 `sanitizeCookie()` 里归一成 `bili_jct` ——
否则它能骗过上面的守卫，却因为不在写回白名单里而根本写不进浏览器。

**复验**：`npm test`（`test/accounts.test.mjs` 第 [10]/[12c] 组、
`test/cookie-parse.test.mjs` 第 [4] 组、`test/proxy.test.mjs` 第 [4] 组）。

---

## §14 切号后必须刷新页面

**结论**：首屏 SSR 里嵌着旧身份 —— `__INITIAL_STATE__.user` 与 `__playinfo__`
都是服务端按登录态渲染的。

**影响**：不刷新的话界面仍显示旧号，且播放器会先按旧数据播一次再纠正，
表现为「切号后要切一次画质才对」。所以 `switchLoginTo()` 返回 `needReload`，
面板与菜单都在成功后 1.2s 刷新。

**复验**：`npm run harness`（切号后断言触发了刷新）。

---

## §15 借用来源与当前身份是两个独立概念

**结论**：把两者绑死的话，切到无权益号就立刻没有画质 —— 那正是多账号要解决的事。

```
activeId  浏览器当前登录的是谁（一键切号改的就是它）
borrowId  显式指定的借用来源；null = 自动
自动解析   激活号有大会员就用它，没有就从池里挑一个有大会员的
```

自动挑选的三条规则（`accounts.js` 的 `resolveBorrow`）：

1. 显式指定了 `borrowId` → 用它
2. 当前号 `vipStatus === 1` → 用自己
3. 否则从池里找第一个 `vipStatus === 1` 的

**都没有大会员时退回自己**并说明原因，**绝不瞎挑一个** ——
未探测过的号（`checkedAt === 0`）不算「确认没有会员」，但也不会被当成借用源。

**探测缓存 24h**：nav 是按账号计的请求，池里 N 个账号就是 N 次往返，
而会员状态一天之内几乎不变。

**复验**：`npm test`（`test/accounts.test.mjs` 第 [3]–[6] 组）。

---

## §21 现代番剧播放器 (nanoPlayer) 劫持与 Next.js React 18 客户端水合

**结论**：B 站新版 OGV / 番剧页面采用 Next.js 服务端直出 (SSR)，首屏直接内联试看流数据并挂载至 `window.__playinfo__` 与 `window.__PLAYURL_HYDRATE_DATA__`。

1. **水合数据保护**：React 18 水合读取 `window.__PLAYURL_HYDRATE_DATA__`。若将其篡改为 `undefined` 或阻断访问，会触发 Minified React Error #418 & #423，导致选集列表 (`PaginatedEpList`) 永久卡在骨架屏 (`aria-busy="true"`)。必须保持原对象结构并就地修改试看/会员标志。
2. **播放器回退真实网络取流**：播放器 `nano.createPlayer(config)` 在首屏直接消费 `config.prefetch.playUrl` 与 `config.requestConfig.reqHttpPlayUrlInfo`，完全绕过 fetch/XHR。必须显式 `delete` 删除此两项属性（不可桩为返回 undefined 的函数，否则引发 `TypeError: Cannot read properties of undefined (reading 'then')`），促使其回退至原生 `this.request` 网络请求并被沙箱代理接管。
3. **解除未登录 Play Disabled 黑屏与拦截循环 reload()**：
   - **黑屏阻断源头**：B 站番剧 React 组件在监听 `Player_PlayUrl_Done` 时执行 `checkToBlock(result)`：未登录下 `result.play_video_type` 默认为 `_.None`，组件会触发 `this.block()`，注入 `toggleFeature({ play: true, pause: true, seek: true })` 并创建 `#big-block-panel` 阻断遮罩。在响应补丁与水合数据中将 `play_video_type` 补齐为 `'whole'`、`play_detail` 补齐为 `'PLAY_WHOLE'`，并监听 `player_block` 事件主动拆除遮罩与恢复 `toggleFeature({ play: false })`，黑屏死锁即可在首屏直接解开。
   - **反复 reload 的元凶**：番剧 React 页面注册了 `r.on(window.nano.EventType.Player_Access_Changed, () => window.location.reload())`。此前调用 `player.reloadAccess()` 会触发播放器发射该事件，进而导致**整个浏览器页面被无脑调用 location.reload()**，陷入多次刷新循环。必须在 `player.on` 中拦截阻断 `Player_Access_Changed` 刷新监听器的挂载，并彻底拔除多余的 `reloadAccess()` 调用，才能做到既秒解黑屏、又 0 次重复跳转。

**复验**：`npm test`（`test/hook.test.mjs` 第 [10] 组）。

---

## §22 视觉无障碍可读性与液态玻璃材质分层

**结论**：半透明液态玻璃与双主题在深色/浅色背景下的色彩对比度必须严格遵从 WCAG AA（正文对比度 $\ge 4.5:1$）。

1. **粘性头部材质**：`.head` 采用 `0.72` 半透明背景搭配 `backdrop-filter: blur(20px)`，在极端背景（纯黑背景与纯白弹幕穿越）下测得对比度分别为 7.40:1 与 5.86:1，既消除了实心纯白大补丁的生硬感，又满足 AA 级阅读清晰度。
2. **多态内嵌操作与紧凑排版**：文本框采用内嵌多态操作图标（内容为空时为粘贴 `📋`，输入后切换为一键清空 `✕`），使得添加账号的操作按钮收敛为单排三连（`[扫码添加]` `[保存并验证]` `[仅验证]`），避免在小屏面板中发生按钮孤立折行。

**复验**：`npm run check:contrast`。

---

## §23 Cookie 持久化生命周期与 Session Cookie 掉登录态实测

**结论**：用户脚本通过管理器的 `GM_cookie.set` / `GM.cookie.set` 或 `document.cookie` 改写浏览器登录态时，若未显式指定 `expirationDate` 或 `Max-Age`，浏览器默认将其视为**会话 Cookie（Session Cookie）**。

1. **掉登录态的根本原因**：
   - 浏览器改写登录态时，若未设置 `expirationDate`，写入浏览器的凭据将全数被标记为 Session Cookie；
   - 浏览器一旦完全退出关闭，内存中的 Session Cookie 被全部清空，下次打开 B 站自然回到「未登录」；
   - 脚本的账号池数据保存在油猴管理器的持久化存储中（`GM_setValue`），因此点击「切换此号」又能把凭证重新写回。
2. **持久有效期补全**：
   - 写入身份字段时显式设定 180 天持久有效期（`DEFAULT_TTL_SEC = 180 * 24 * 3600`，`details.expirationDate = now + 180 * 86400`，`Max-Age=15552000`）；
   - 即使本地 TTL 长于服务端真实会话有效期也完全安全：因为服务端一旦判定 SESSDATA 过期或被退出，会直接返回 `code=-101` 拒接请求，本地高估有效期无副作用。
3. **为什么不搞粗暴的开机自愈写回**：
   - 若在脚本初始化时检测到未登录就强制把池内账号注入浏览器，会导致用户在 B 站主动点击「退出登录」后，页面一刷新又被脚本强行登录回去，造成“无法退出登录”的死循环故障。
   - 遵从 RFC 6265 标准，让 Cookie 自带持久化寿命，交由浏览器原生管理，是最安全标准的设计。

**复验**：`npm test`（`test/accounts.test.mjs` 第 [10] 组）。

---

## §24 B 站生产环境退出登录与软登出机制设计

**结论**：用户在 B 站顶栏点击「退出登录」时，现代前端会向 B 站 Passport 服务器发送退出注销请求。

1. **生产环境调用链路实测逆向**：
   - 源码提取自 B 站生产底座脚本（`laputa-home/assets/index-12fc55c2.js`）的 `window.__BiliUser__.logout()`；
   - 目标端点：`POST //passport.bilibili.com/login/exit/v2`，表单载荷携带 `biliCSRF`（即 `bili_jct`）；
   - 底层传输：原生 `new XMLHttpRequest()`；
   - 成功判定契约：前端严格校验响应体 `M.status === true`，随后执行 `E._setBiliLoginState()` 并跳转至 `M.data.redirectUrl`；
   - 端点探测试验：该端点真实存在，未携带鉴权发起 POST 时返回 HTTP 200 与 `{"code":-101,"data":null,"message":"账号未登录"}`。
2. **软登出保活机制设计 (Soft Logout)**：
   - 主世界钩子精准匹配发往该端点的 XHR 与 fetch POST 请求，**阻断该请求向 B 站服务端发送**；
   - 沙箱通过特权 `GM_cookie.delete` 清空当前会话的本地持久化身份 Cookie（`SESSDATA` / `bili_jct` / `DedeUserID` / `sid`），不触碰设备级指纹；
   - 向页面回传模拟的 `{ code: 0, status: true, data: { redirectUrl: "https://www.bilibili.com" }, message: "" }`，页面前端本地会话干净重置为未登录态；
   - `[机制推断]`：由于服务端从未收到退出注销包，理论上服务端 Session 维持原有时效，账号池内保存的对应凭据可免扫码重新切回登录。
3. **防御性诚实回退实测**：
   - 当脚本管理器缺少 Cookie 删除特权（`level === 0`）时，软登出如实返回失败并触发 `passthrough: true`，放行原生退出请求让页面自己处理，绝不虚假伪造退出成功。
**复验**：`npm test`（`test/hook.test.mjs` 第 [11] 组，`test/accounts.test.mjs` 第 [19] 组）。

---

## §25 新版番剧页的 playview 是 GET，且 createPlayer 之后还会重设 requestConfig

**结论**：2026-11 的 Next.js 番剧播放页（nanoPlayer 4.10.13-bcb64775）不再用 `POST /ogv/player/playview`，而是 `GET /ogv/player/playview`；同时 `playpage.js` 在 `nano.createPlayer()` 返回后会调用 `player.updateRequestConfig(N(n))`，把首屏 SSR 的 `reqHttpPlayUrlInfo` / `reqHttpPlayUrlInfoScope` 重新塞回播放器。旧实现只删 `createPlayer` 首参里的这两个字段、且只登记 POST playview，于是：

1. 播放器重新走页面自己的 `/ogv/player/playview` GET，钩子白名单匹配不到 → 代理完全看不到请求；
2. 即使播放器回落到 `/pgc/player/web/v2/playurl`，页面重设的 `reqHttpPlayUrlInfo` 也可能让它改走未登记的 playview。

**证据**：
- 线上 page chunk `pages/bangumi/play/[videoId]-*.js`：`fetchPlayView(e,n,t){return e({url:E[this.env],method:"GET",headers:t,params:n})}`，`createPlayViewQuery` 带 `biz_type` / `scene` / `ep_id` / `season_id` / `cid` / `is_qn_trial` 等；
- 同一路径 `POST` → HTTP 405；`GET` 在带 `buvid3` 时返回 `code:0`；
- `playpage.js`：`o.current=(e,n)=>{e.updateRequestConfig(N(n))}`，`N` 返回 `{reqHttpPlayUrlInfo, reqHttpPlayUrlInfoScope:[T]}`。

**修法**：
- 端点表同时登记 `GET` 与 `POST` 两种 playview（GET 无 csrf，POST 保留 csrf）；
- `hookNano` 包装 `player.updateRequestConfig`，删除重新塞回的 `reqHttpPlayUrlInfo` / `reqHttpPlayUrlInfoScope`，让播放器回落到已登记的 `/pgc/player/web/v2/playurl`；
- `applyQuality` 删除新版页面携带的 `is_qn_trial=1`，否则 B 的大会员画质会被服务端按试看流降级；
- `tryPrefetch` 的番剧分支改为 GET，查询串补 `biz_type=ogv&scene=normal`，并从 `__PLAYURL_HYDRATE_DATA__.result.arc` 兜底取 `cid`（新版页面没有 `__INITIAL_STATE__`）。

**复验**：`npm test`（`test/hook.test.mjs` 第 [4]/[10] 组、`test/proxy.test.mjs` 第 [4b] 组、`test/smoke.test.mjs`）；真实浏览器探针确认页面不再发出未登记的 playview GET，播放器回落到 `/pgc/player/web/v2/playurl` 并被钩子接管。

---

## §26 首屏「大会员专享」提示条与晚到的 window.player

**结论**：番剧/影视首屏偶尔仍显示「本片是大会员专享内容 / 试看中」不是 `#big-block-panel`，而是播放器 toast 里的 `PromptBar`：

```
div.bpx-player-toast-item
  └─ div.bpx-player-toast-text
       └─ div.PromptBar_container...
            └─ div.PromptBar_title...[data-testid="prompt-bar-title"]
```

它由首屏 SSR 的试看数据直接渲染，刷新或切集后 B 的 playurl 回来才消失。只删 `#big-block-panel` 覆盖不到它。

**晚到场景**：用户脚本偶尔晚于页面内联脚本注入，`window.player` 已经创建；只包 `nano.createPlayer` 时，这个已存在的实例不会被接管，首屏会一直用 SSR 试看数据。现在 `hookNano` 会：

1. 对 `window.player` 的现有值与后续赋值调用 `hookPlayer`（打 `__biliVipPlayerHooked` 标记，避免重复包装）；
2. `hookPlayer` 里安装 `MutationObserver`，监听 `.bpx-player-toast-item` 插入，命中 `/大会员专享|成为大会员|试看中/` 就移除；
3. 播放器 `player_block` 回调与 300ms 解锁轮询里也调用同一个清理函数。

**证据**：VIP 集 `https://www.bilibili.com/bangumi/play/ep3854825`（凡人修仙传 201 集）无钩子时 toast 文本完整包含上述提示；晚注入钩子后 12 秒内 `bodyHasGate:false`、`.bpx-player-toast-item` 为空、`window.player.__biliVipPlayerHooked:true`，且播放器经代理发出 `GET /ogv/player/playview`。

**复验**：`npm test`（`test/hook.test.mjs` 第 [10b] 组）；Playwright 真实浏览器晚注入探针验证。

---

## §27 首屏 GM 存储未就绪与空账号池覆盖

**结论**：首屏有时仍用当前未开通大会员的账号取流、刷新后才恢复，根因不在 playurl 端点，而在账号池的初始化时序：

- 用户脚本在 `document-start` 执行时，脚本管理器的 GM 存储可能还没把 `b.accounts` 注入到页面世界；
- 旧版 `pool()` 在 `store.getPool()` 返回 `null` 时直接 `store.setPool(emptyPool())`，把空池写回存储；
- 后续即使真实账号池数据到达，`b.accounts` 已被空池覆盖，`hasCookie()` 一直为 false，代理只能放行 A 的请求；
- 刷新页面后 GM 存储先就绪，`pool()` 读到真实账号池，才恢复正常。

**修法**：

1. `src/core/accounts.js` 的 `pool()` 不再在无数据时写空池；空池只在 `savePool()`（用户主动增删账号）或 `clearPool()` 时落盘；
2. `buildHookConfig()` / `liveConfig()` 将配置拆分为三个语义清晰的开关：`hidePlayinfo`（总开关开启时挡 SSR 与净化 `updateRequestConfig`）、`canBorrow`（总开关 + 有可用账号，控制 `hookPlayer` 接管与重载）、`patchVip`（总开关 + 界面伪装 + 有可用账号，控制会员标志改写与提示条/收银台清理）；
3. `src/index.js` 在 `store.isEnabled() && !hasCookie()` 时静默轮询 GM 存储最多 15 秒（60 × 250ms），仅在 `hasCookie()` 真正就绪时补推一次配置并预热 wbi 密钥；钩子的 `applyCfg()` 收到 `canBorrow=true` 后立即接管已创建的播放器并触发 reload，且仅在番剧页或存在 `window.nano` 时按需启动有界监听。

**复验**：Playwright 真实浏览器延迟存储探针与 `test/hook.test.mjs` 回归用例（覆盖总开关关闭、空账号池、关闭界面伪装、延迟补推配置四类场景），以及 `test/accounts.test.mjs` 第 [1] 组「无旧数据时不写空池」断言。
