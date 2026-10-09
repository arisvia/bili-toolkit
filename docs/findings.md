# 实测结论

本文只记录**用真实请求/真实数据验证过的事实**，不含设想与计划。

每条都标了复验命令。服务端行为会变，**结论与代码冲突时，先跑复验命令，不要相信本文**。

| 复验命令 | 需要凭证 | 覆盖 |
|---|---|---|
| `npm run verify:online` | 否 | §1 §2 §4 §5 §6 §7 |
| `npm run verify:local` | 是（仅本机，输出脱敏） | §3 §5 |
| `npm test` | 否 | §8 §9 |

最近一次全量复验：**2026-10-09**

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

**结论**：这两个字段是**固定的完整档位表**，与账号无关。

```
匿名 accept_quality  = [120,112,80,64,32,16]   ← 匿名也给 120
匿名 support_formats = [120,112,80,64,32,16]
匿名 dash.video 最大流 = 32 (480P)               ← 但 4K 根本不存在
大会员 accept_quality = [120,112,80,64,32,16]   ← 与匿名完全相同
```

**影响**：会员状态只能读 **nav 的 `data.vipStatus`**（`patch.js` 的 `extractVipFromNav()`）。
若哪天看到有人用 `accept_quality.includes(120)` 判断大会员，那是错的。

**复验**：`npm run verify:online` 第 [8] 段（已固化为断言）。

---

## §5 `accept_quality` 在 `playurl` 里，不在 `/x/player/wbi/v2` 里

**结论**：**登录态**下请求 `/x/player/wbi/v2`，响应里没有任何 `accept_*` 字段。
画质清单只存在于 playurl 响应。

**影响**：`v2` 因此走本地伪装（改写会员字段）、**不走代理**，省掉一次 HTTP 往返。
若将来发现画质菜单不完整，把 `endpoints.js` 里 `LOCAL_PATCH_PATHS` 的 `v2`
改回 `mode: 'merge'` 即可（该处有注释说明）。

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

## §7 `SESSDATA` 是 HttpOnly

**结论**：`document.cookie` 取不到 `SESSDATA`。

**影响**：这是 userscript 的硬边界。Cookie 只能由用户从 DevTools 的
Application/Storage 面板手动复制，**没有脚本侧的替代方案**。
面板里的粘贴解析流程就是为这件事设计的。

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

## §11 观察但未稳定复现

- 携带 `buvid3` / `bili_ticket` 等风控字段与不携带，常规测试下**响应无差异**。
  但历史上观察到过 `-412`。未能稳定构造复现条件，因此**不下结论**。
  保守做法仍是保留这些字段。
- 逐字段消融显示：只有 `SESSDATA` 影响 playurl；`bili_jct` 是番剧 OGV POST 的必需项。
  **`sid` 绝不能跨账号混用**（多账号改造时尤其注意）。

**复验**：`npm run verify:cookie`（逐字段消融）。