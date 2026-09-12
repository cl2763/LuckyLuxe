# `currentTenantId()` 回落清单(夜 9 段 5 · 07b §三)· **只查不改**

> 2026-09-12 · 被测 `apps/api @ 81cac2c` · 全部**现读源码 + 机械扫描**得出
> 🔴 **本段一行代码都没改。** 改法等店主看着定(四条红线同族)。

---

## 〇、先把「回落」这个词钉死:它有**三个口**,不是一个

```
apps/api/local-server.mjs:173-176   function currentTenantId() {
                                      const store = tenantContext.getStore()
                                      return (store && store.tenantId) || DEFAULT_TENANT_ID   ← 口①
                                    }
apps/api/tenant-gate.mjs:23-33      function validTenantId(raw) { … return defaultTenantId }   ← 口②
apps/api/local-server.mjs:10906/10919/10931/10959/11528
                                    tenantContext.enterWith({ tenantId: X || DEFAULT_TENANT_ID }) ← 口③
```

`DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || 'lucky-luxe'`(`local-server.mjs:171`)——
**回落目的地就是旗舰店(店主本店)**。

全仓 `currentTenantId()` 调用点 **457 处**(29 个业务模块),但**它们绝大多数不是回落点** ——
它们只是「读当前上下文」。真正决定会不会回落的是**这个请求有没有进过闸门**。所以下面按**路径**列,不按调用点列。

---

## 一、三栏清单

### A 类 · 闸门之前的路由(**store 为空 ⇒ 口① 必回落**)

`route()` 起于 `local-server.mjs:10460`,**route 内第一道 `tenantContext.enterWith` 在 `:10780`**。
之间 **23 条路由判头**,逐条:

| # | `file:line` | 路由 |
|---|---|---|
| 1–6 | `local-server.mjs:10466`–`:10472` | `GET /` `/admin` `/platform` `/wechat-simulator` `/share` `/sign(/*)` —— 静态页 |
| 7–9 | `:10480` `:10489` `:10490` | `GET /*.txt` · `/web/*` · `/assets/*` —— 静态资源 |
| 10 | `:10493` | `GET /store/deposit-policy` |
| 11 | `:10517` | `GET /settlements/:code` |
| 12 | `:10534` | `POST /settlements/:code/coupon` |
| 13 | `:10546` | `GET /settlements/:code/signature.svg` |
| 14 | `:10585` | `GET /settlements/:code/snapshot` |
| 15 | `:10614` | `GET /settlements/by-token/:token` |
| 16–17 | `:10630` `:10647` | `GET /bind-tokens/:token` · `POST /bind-tokens/:token/confirm` |
| 18 | `:10665` | `POST /settlements/:code/claim` |
| 19 | `:10701` | `POST /member-code/:code/claim` |
| 20 | `:10712` | `POST /settlements/:code/sign` |
| 21 | `:10726` | `GET /health` |
| 22–23 | `:10734` `:10746` | 企微客服 webhook(GET 验签 / POST 收消息) |

**② 会造成什么** —— 现查结论:**这 23 条里 `currentTenantId()` 的直接调用是 0 处**(机械扫过 `:10460`–`:10780`)。
它们调到的本仓顶层函数 22 个,其中 4 个带 `tenantId = currentTenantId()` 默认参
(`getDepositConfig` `depositPolicyText` `depositAmountForService` `formatMoneyCents`),
共 **6 次调用,6 次全部显式传了租户**:

```
:10495  getDepositConfig(tid)              :10501  depositAmountForService(service, config, tid)
:10510  formatMoneyCents(amountCents, tid) :10513  depositPolicyText(config, tid, 'zh'/'en')
:10521  getDepositConfig(row.tenant_id)    :10524  depositPolicyText(config, row.tenant_id, 'zh')
```
(`tid` 来自 `:10494 const tid = resolveTenant(req, query)` —— **这一层不回落,缺就 400**。)

顾客签字页那条链也查过:`serializeSettlement → amendmentShape`(`:10248`)里
`formatMoneyCents(…, row.tenant_id, …)`(`:10269`)、`tenantTimezone(row.tenant_id)`(`:10251`)
**都显式带租户**。全仓 `formatMoneyCents` 调用 80 处:**传租户 74 处,没传 6 处 —— 其中 3 处是注释**
(`:7281` `:7733` `:16672`),真正吃默认参的 3 处(`intake-interrupt.mjs:199`、`local-server.mjs:3037` `:3883`)
**全在闸门之后的 AI 客服/报价链上**。

> 所以 A 类今天的实际后果是:**不是「读错」,是「一个都没走到」** —— 这一段的租户全靠显式传参撑着。
> ⚠️ 但这是**靠自觉不靠护栏**:任何人在这 23 条里新写一句 `getDepositConfig()` 少传一个参,
> 立刻变成「小婕店的顾客看到旗舰店的定金政策/币种」,而**没有任何判据会红**。

**③ 能不能改成「拿不到就拒绝」** —— **能,而且这一类最该改**:
这 23 条要么根本不需要租户(静态页/资源/`/health`),要么已经自己算出租户了
(`resolveTenant` / `row.tenant_id` / 企微 `open_kfid` 映射,`:10772` 映射不到直接拒收)。
**建议:在闸门之前把 `currentTenantId()` 设成「抛错而不是回落」**(或加一条判据禁止在这一段调它)。
风险面小,因为现测调用数就是 0 —— 改的是**未来**,不是现在。

---

### B 类 · 闸门自身带回落(`X || DEFAULT_TENANT_ID`,口③)

| # | `file:line` | 闸门 | ② 后果 | ③ 能不能改成拒绝 |
|---|---|---|---|---|
| 1 | `local-server.mjs:10906` | `/admin/staff-accounts` (GET) | `admin.tenantId` 空 ⇒ **读到旗舰店的员工账号列表**(跨店泄露) | **能**。这四条是交付纪律⑦ 点名的「排在闸门前、事后手动 enterWith」那三条 + 一条。`admin` 已过 `requireAdmin`,租户为空本身就是数据异常 —— 应当 **500/403 而不是当旗舰店**。 |
| 2 | `:10919` | `/admin/staff-accounts` (POST 建号) | **把员工账号建到旗舰店名下**(写错) | 同上,**写错比读错更该拒绝** |
| 3 | `:10931` | `/admin/staff-accounts/:id` (改) | 同上(写错) | 同上 |
| 4 | `:10959` | `/admin/staff-accounts/:id/reset-password` | 同上(写错) | 同上 |
| 5 | `:11528` | `/admin/ai/*` 一段 | `adminSession.tenantId` 空 ⇒ AI 配置/知识库读写落到旗舰店 | **能**,同一条理由 |

> 这五处是**全仓仅有的五处** `enterWith(… || DEFAULT_TENANT_ID)`(机械扫 14 处 `enterWith/run`,
> 其余 9 处都是显式租户:`routedTenant`(`:10780`,映射不到已经拒收)、`resolveTenant(req, query)`
> ×3(`:11483` `:11492` `:11508`,拿不到就 400)、`tenantId`(`:5514` `:5524` `:13215`)、
> `bk.tenant_id`(`:17187` `:17197`))。

---

### C 类 · 默认参数族 `function f(tenantId = currentTenantId())` —— **53 个函数**

**② 后果:它们本身不是回落点,是「继承上下文」**,在闸门内正确、在闸门外回落。
真正的风险是**调用时省了那个参数**。现测「一个参数都不传」的调用 10 处,逐处查完:
`booking-intake.mjs:435/499`(`depositPolicyText()`)、`local-server.mjs:6855/13638/13686`
(`financeLockEnabled()`)、`:113/5796/5837`(`tenantTimezone()`,其中 `:113` 是注释)、
`:12054/12065`(`todayOf()`)—— **全部在闸门之后的 `/admin/*` 或已入上下文的链上**,今天都拿得到真租户。

**③ 能不能改成拒绝** —— **不能整族改,但能加护栏**。
默认参这个写法本身是对的(它让 500 多个调用点不必层层传租户);
问题是**「省参数」和「真拿不到」长得一模一样**。
建议(**等店主定**):不动默认参,改为**在 A 类那一段禁用**(见 A 类③),
并补一条判据:闸门前的代码块里出现 `currentTenantId()` 或调用带默认参的这 53 个函数而不传租户 ⇒ 红。

---

### D 类 · 非请求上下文(定时器 / 开机)

| `file:line` | 是什么 | ② 后果 | ③ |
|---|---|---|---|
| `local-server.mjs:17704-17706` | 通知调度心跳 `safeTick → notifyScheduler.runTick()` | **不回落**:`notify-scheduler.mjs:373` 现查 —— 它自己 `SELECT id FROM tenants WHERE status='active'` **逐店循环**,`:374` 只在**读不到 tenants 表**时才 `[DEFAULT_TENANT_ID]` | 那一句兜底可改成「读不到就报错并跳过这一轮」——但它是**表坏了**才触发,优先级低 |
| `:17699` `runBackup` | 每 6 小时备份 | 与租户无关(整库文件快照) | 不适用 |

---

## 二、一句话总结(给店主拍板用)

| 类 | 处数 | 今天有没有真在回落 | 建议 |
|---|---|---|---|
| **A** 闸门前 23 条路由 | 23 | **没有**(直接调用 0 处,6 次间接调用全显式传参) | 🔴 **最该改**:改成「闸门前调 `currentTenantId()` 直接抛错」,风险面为 0、护住未来 |
| **B** 闸门自带 `\|\| DEFAULT` | **5** | 只在 `admin.tenantId` 为空时;那本身是数据异常 | 🔴 **该改**:空就 403/500,不许当旗舰店(四条**写**口尤其) |
| **C** 默认参族 | 53 个函数 | 没有(10 处省参调用全在上下文内) | ⚠️ 不整族改;加「闸门前不许用」的判据 |
| **D** 定时器 | 2 | 没有(调度器自己逐店循环) | 低优先 |

**没有一处今天正在把别人的数据回落成旗舰店的。** 但 A 与 B 是**靠自觉撑着**的两处:
A 没有判据拦「新写一句不传参」,B 的五处一旦 `admin.tenantId` 为空就**静默写到旗舰店名下**。

> 与 §段 0 那条残余一起看:`IS_PRODUCTION` 是纯环境变量判定(`local-server.mjs:163`),
> 与这里的「回落」是同一种味道 —— **拿不到就默认一个,而不是拒绝**。
> 两件都**只报不改**,等店主裁。
