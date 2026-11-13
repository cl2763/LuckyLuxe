# 个人折扣与一人一单：双端接口约定

本阶段仅后端分支实现，未上线、未接入网页或小程序 UI。两端必须使用同一预览接口，不自行计算金额。先读 approved-scope.md 的 B01–B19 与 U01–U28。

## 数值、状态与兼容

- 金额均为整数分，币种取门店返回值。折扣 `rateBps=8500` 表示 8.5 折，`10000` 表示无折扣；有效数字 100–10000，步长 100。
- `null` 是尚未设置个人折扣，沿用门店原默认会员价；不是无折扣。滚轮由 `GET /admin/member-pricing/discount-input` 提供 100 个选项，`unset` 单独说明。滚动不立即保存，随确认按钮提交。
- 新功能按门店 `active` 默认关闭。关闭时保留旧客户端及旧计价。开启后旧建单/预览接口拒绝新版业务，防止旧客户端绕过新价格；必须等双端上线后才启用。
- 所有 admin 路径均在现有租户闸门后，使用现有登录及财务门禁。不存在的或跨店顾客/项目返回 404。独立改折扣、配置、退款及更正仅老板；员工可预览、开单，并在实际充值中确认折扣。
- 版本字段 `expectedRevision` 必须来自最近一次读取；过时返回 `PRICING_CHANGED`，前端刷新并让操作者确认，不能自动重发新版本。
- `operationId`（退款也可沿用 `requestId`）1–64 位字母、数字、下划线或连字符。网络重试复用原编号与原内容；修改内容应重新确认并用新编号。不要每次网络重试生成新编号。

## 配置与个人权益

| 路径（均以 /admin/member-pricing 开头） | 方法 | 内容 |
|---|---|---|
| /config | GET、PUT | `{expectedRevision,active,displayTypes,settlementTypes}`；类型 list/member/share/course；list 必选；会员店结算 member 必选；会员制度开关沿用平台权限 |
| /services/:id/display | GET、PUT | 展示体系，PUT `{expectedRevision,prices:{list:{priceCents},member:{priceCents},…}}` |
| /services/:id/settlement | GET、PUT | 独立结算体系，同上；course 可含 courseTimes；首次独立写入冻结另一体系的原值 |
| /packages/:id | GET、PUT | 充值套餐建议折扣，PUT `{expectedRevision,rateBps}`；不会直接改顾客折扣 |
| /members/:id | GET、PUT | 当前 rateBps/revision/eligible/effectiveRateBps/status/balanceCents；PUT `{expectedRevision,rateBps,reason,operationId}`，仅老板 |
| /members/:id/history | GET | 修改前后、来源、操作编号、原因、经手人、时间 |
| /operations/:id | GET | 充值/退款/冲销操作原始回执，含折扣前后状态 |

原套餐新增/编辑接口也接收 `defaultPersonalDiscount:{expectedRevision,rateBps}`，金额、赠送配置和建议折扣整体保存；折扣版本冲突时不会仅保存金额。未传此字段保持旧行为。

顾客自己的权益读取 `GET /my/member-pricing`；顾客只能读本人。公开服务目录的 `displayPricing`、`startingPriceCents`、`referenceOnly`、`priceSource` 来自展示体系，不含个人折扣。会员列表/档案新增 `personalDiscount`。

## 独立充值与退充值

原 `POST /admin/stored-value/recharge` 的 userId、套餐/金额、渠道、经手技师、赠项等参数保持；新模式增加：

```json
{"operationId":"recharge-unique-id","discountConfirmation":{"rateBps":8500,"expectedRevision":2,"reason":"本次充值确认"}}
```

必须明确确认最终折扣，可等于原值。前端选套餐后先用套餐建议值，未设置则带出会员原折扣/门店默认；员工可以修改。

充值回执含 `discountReceipt:{before,after,actor,source,operationId}`、建议折扣 suggestedRateBps/suggestionSource、余额及充值/赠金流水关联。预览及签署快照同样保留建议值、来源和是否显式选择，能核对商家是否修改过套餐建议。金额与折扣在同一数据库事务内提交。独立代充继续沿用原到账和充值回执确认流程，不能将它显示成随单签署。

原退款与充值流水 reverse 接口同样增加操作编号及 `discountConfirmation`，必须重新确认；没有确认不能执行。不用原充值前折扣覆盖之后的合法修改。新充值用确定的充值/赠金关联执行冲销；旧记录保留原兼容路径。

## 预览与按人开单

`POST /admin/member-pricing/preview` 为只读；`POST /admin/member-pricing/documents` 正式建立待签单。后者增加 operationId。请求示例：

```json
{
  "operationId":"visit-unique-id",
  "userId":"card-owner-id",
  "settlements":[
    {"beneficiaryKey":"self","items":[{"serviceId":"service-id"}],"technicians":[{"technicianId":"tech-id"}],"rechargePackageId":"package-id","personalRateBps":8500},
    {"beneficiaryKey":"friend-1","servedPersonName":"被服务者姓名","items":[{"serviceId":"another-service-id"}],"technicians":[{"technicianId":"tech-id"}]}
  ]
}
```

- 同一 beneficiaryKey 合并一张服务单，其他被服务者必须有独立稳定标记和姓名；不要仅凭姓名合并。self 不填写其他人姓名。
- 同人多个技师/次卡业务以多个 components 保留，顾客仍只签一张 document。原同一次开单不可重复选择同一张次卡的约束保留。
- 选定有效会员默认 member，否则 list；可以从本店结算启用类型中选择。个人折扣作用于 member。需报价项目填写 `quotedListCents`；固定价项目不允许用该字段覆盖。
- 随单充值最多一笔，必须放 self；可选套餐或 `rechargeAmountCents`。`personalRateBps` 只随真实正金额充值接受，不能借普通开单改个人折扣。原赠送规则保持。
- 每张按人服务单最多一张券，符合范围、门槛、有效期可叠加；合并项目达到门槛才可用。按适用服务分摊，不把美甲券折到美睫项目。
- 预览返回 components（逐项价格、技师、支付构成）、documents（按人汇总）、totals、personalDiscount（当前与拟生效值）及 readOnly。所有收费服务含加项/足部/手填服务一起折扣；充值/购卡不是服务优惠基数，次卡核销不再重复打折。
- 舍入以每位被服务者的收费服务总额为准，整数分四舍五入，逐行分摊后总计严格相等；个人折扣与券优惠分开。

## 签署、撤回与更正

| 接口 | 用途 |
|---|---|
| GET /admin/member-pricing/documents | 本店可访问的最近 100 张按人服务单 |
| GET /admin/member-pricing/documents/:id | 单据、components、状态、原始已签内容及更正信息 |
| POST /admin/member-pricing/documents/:id/sign-link | 单据专用 token，30 分钟有效，重新生成吊销旧 token；前端负责组装已批准的签署页面入口 |
| POST /admin/member-pricing/documents/:id/void | `{reason}`；含充值单撤回会同时撤回其未签依赖单；不会动余额 |
| POST /admin/member-pricing/documents/:id/requote | 新 operationId、最新完整项目、原因；保留原预约；部分已签时只重开这一位未签被服务者，不能再充值；重试幂等 |
| POST /admin/member-pricing/documents/:id/amend | 老板填写 reason、components 数组（id 及原更正参数）；整批原子追加，不改原签署快照；充值退款必须走专用路径 |
| GET /my/member-documents | 登录顾客本人的单据 |
| GET /member-documents/:id | 顾客登录或请求头 x-document-token 授权 |
| POST /member-documents/:id/sign | confirmationHash、signature、strokes、disclaimerAccepted:true；链接授权另需 signerConfirmed:true |
| GET /member-documents/:id/snapshot | 已签 JSON 凭证，包括签名笔迹、当时价格与折扣、充值、券、支付构成和余额；视觉版式待 UI 确认 |

服务单 `expiresAt:null`，不因放置时间失效。授权链接过期只需重新发链接。实际签署再次检查结算价、个人折扣、会员资格、余额构成、定金、券和次卡；变化或不足返回明确错误，由商家重新核对并重开。仅展示类型调整不影响结算单。已签单不重新套用当前价格。

多人共卡时返回 `dependencyId`，先签含充值的单。主单签署在一个事务内处理充值、赠送、折扣和本单扣款；失败全部回滚。其他单统一按预览的新折扣，在主单签后继续签；重复签署返回 duplicate，不重复扣款。

旧项目级单据返回 `serviceDocument` 关联。新 UI 必须转向完整服务单，不能为其中一个 component 单独签署、撤回、改券或更正；旧操作会返回 PERSON_DOCUMENT_REQUIRED。财务/技师分配仍保留组件明细，页面上的顾客单数须按 document 计。

## 前端尚待实施的事项

U01–U28 全部仍待设计及网页/小程序接入。特别包括：轮盘控件、默认值说明、前后折扣对照、按人合单、含充值单先签提示、状态刷新、通知/扫码/历史入口指向完整单据、凭证视觉版式与打印。不能把新 JSON 接口存在当成 UI 已交付。
