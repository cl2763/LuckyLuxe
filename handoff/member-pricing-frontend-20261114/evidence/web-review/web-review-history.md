# 历史过程记录（不是当前验收结论）
以下网络中断、未拍、未执行描述均为当时状态；最终状态以 web-review.md 为准。

# 网页独立核验（进行中）
使用独立浏览器标签页、合成店铺、隔离 4346 API。没有提交充值、会员修改或签署。

## 实拍证据
U01、U02：展示类型在上架服务。5 次打开/取消均返回正确编辑器，repeat.json 留证。
U04：五个原有营销页签保留；会员体系独立标签。
U05/U05-wheel：套餐字段、赠物、滚轮和保存按钮在原弹层，长内容可滚动。
U09/U10-U28：会员资格、折扣和历史正确；7.0折滚轮选中正确，文字及输入框未溢出。
U11/U11-wheel/S20：账户充值保留原字段，滚轮在确认到账之前；选择无折扣出现优惠减少提示。
U23/S21：退卡与冲销原入口存在，未执行财务动作。
S03：客户列表现状留证。

## 已发现的问题
1. U10 单独调整折扣误用退款说明“退款后是否仍可使用…”（截图 U10-U28）。已反馈主代理。
2. S03 老板客户列表缺个人折扣摘要（S03.txt）。详情已存在；已反馈主代理。
3. U02 标题仍为“服务编辑”，与图稿“修改上架服务·名称”不同；属旧表单文字差异，未擅自改动。

## 范围限制
U03/U03B/S16 在回归脚本换档杀掉测试 API 时出现网络中断，已重命名 network-interrupted，不能计为正常态/空态通过。
未检查的顾客端、员工只读、零余额、英文、非会员店、平台配置、未知提交结果等状态仍为 Unverified。未声称全部59屏通过。
本轮浏览器原主题跟随系统为深色，后按现有 ll-admin-theme 设置切换浅色重拍后续页；未改 CSS。

## 恢复测试服务后的补拍
U03/U03B 已重新正常加载并覆盖正常态文件；network-interrupted 留作环境中断说明。U03B 价格字段值200/190，展示价450，两个体系分离可见。字段布局有足够内边距，未见数字贴框。价格输入缺门店币种标签，已反馈主代理。原需报价复选框标签纵向拆行，已反馈定点排版建议。
U27-entry 仅核对客服工作台入口，测试租户暂无会话，报价口径未实拍。

## 已修复并复查
U10退款误文案、U02标题、U02/U03B币种、U03B报价复选框横排均已改源码；U04新增个人折扣说明并澄清不分级并不代表同折扣。小程序会员页五标签索引也修正（原会员体系按钮误指积分商城）。JS语法检查通过。展示编辑开关5轮均看到CAD与新标题；折扣弹层开关5轮均读到当时接口当前值8.5折（主流程完成随单充值后）且没有退款误文案，未保存折扣。对应 *-fixed.png / *repeat-fixed.json。

## 2026-11-15 独立收尾：实拍与范围限制

本次继续只使用 127.0.0.1:4346 合成 QA。未向真实用户发送消息，未执行充值冲销/退卡，未提交或发布。以下为真实页面/组件渲染，不代表 59 屏全量视觉通过。

- `S21-confirm-final.png`：充值冲销最后确认。原本金 CAD20.00、明确关联赠金 CAD2.00、当前折扣8.5折、必填原因与取消/确认齐全；实际点击取消，未冲销。旧无关联回执的赠金显示“未记录”，不按时间靠近猜测。
- `S21-facts-types-final.png`：保留四项原参考数，条件展示“已转预约定金 CAD50…”；预约定金储值抵扣/取消返还采用后端 typeText。新类型不可冲销；网页/小程序账户调整都仅 recharge 可冲销。小程序财务流水的金额正负改为真实 cents 符号，避免新类型被误标充值。
- `S13-legacy-final.png`：正门测试生成的旧式已签单 P1-20261114-IARC，取真实 snapshots API 后按 admin 使用的同样映射打开 openSnapViewer。图片 naturalWidth1440，已目视确认。旧单提示不记录个人折扣，原交易400/定金50/到店350和原签名完整。此项验证原件查看器；未复测所有旧单入口。
- `U26-discount-history-final.png`：发现原记录仅展示折扣/原因/人员，已补时间、来源类别、来源编号、本金/赠金。实际新增随单充值1000/赠金0及历史500/0、20/2均真实读取。金额来自明确 operation_id 或 document-group 对应 inline 回执，再严格同租户/同顾客查询流水；旧未记录显示未记录。网页为现有详情展开式（确认图是浮层，布局容器不完全一致），字段完整且未溢出。
- `S15-blank-price-final.png`：真实清空原价点击保存，显示“请填写有效金额，最多两位小数；空白不等于零元”，随后取消。未写入价格。目录编辑器仍沿用原表单结构，缺确认图的“编辑价档 · 项目名”标题属于结构差异。
- `U24-empty-final.png`：当前顾客无导入历史资料，验证空态与“历史充值金额不直接转换为个人折扣”说明；未证明有旧余额数据时的全部控件。
- `U27-empty-final.png`：客服工作台当前合成店没有会话，只能验证空态。未发送 AI/客服消息，因此不能标记公开报价内容态通过。
- 【已被下方独立新店内容态验收取代】S22：当前原 fixture 业绩模式为 total_only，memberPricingDetails=null 属权限预期。服务/充值分列、原成交折扣、已日结/技师/租户过滤已有运行测试证据，但本轮未取得 with_split 内容态截图；为不锁主资金回归日期未对该租户确认日结。
- 【本段状态已由下方新增实拍取代】当时尚缺 U12/U22/S17/S06/S12/S18/S19。

验证：`node apps/api/test-member-discount-history-display.mjs` 通过；`test-membership-summary-ui.mjs` 14项；`test-member-pricing-client.mjs`12组通过。补丁涉及的 JS syntax 通过。小程序源已同步，本轮未占用另一个 agent 的9422，因此无这部分新增小程序实拍。

### U26 时间口径修正

后续复核发现设备 `toLocaleString()` 会使店时区与设备时区不同的记录时间不一致。现由 policy.history 输出 `createdText`，服务注入与服务单相同的 `localParts(at, tenantTimezone(tenantId))`，并显式标注门店时区；双端只渲染服务端文本。布局未变，以上 U26 实拍是修正前时间展示，不作为店时区正确性的证据。新增跨多伦多/上海午夜、切换运行环境 Honolulu/Tokyo 的后端测试证明同门店时间稳定。history 套件现有 3 条 `ok`，已纳入 run-all 默认套件及 assertion-baseline 的新增项3；原基线未削弱。


## 2026-11-15 最终独立新店实拍（取代上方未完成状态）

使用独立 QA 店 `qa-web-mwgo6f40`，正门建顾客/员工/充值/两人服务单，浏览器 `localhost:4346` 与其他 agent 的127.0.0.1本地存储分离。原主夹具未写。以下逐项对照 approved-screens.json 对应合同，观察真实图的结构、关键字段/状态/按钮、留白、文本边框、金额对齐；原页面非价格区域保留。通过范围是已拍状态和实际交互，不声称像素复刻整张图，亦不代表本报告独自覆盖59屏或所有响应式尺寸。

|屏|最终实际截图|观察/验证|
|---|---|---|
|U12|[U12-qa-receipt-final.png](/Users/changliu/Desktop/有迹管家/Codex/LuckyLuxe_Claude_Handoff_2026-07-03/worktrees/member-pricing-20261113/handoff/member-pricing-frontend-20261114/evidence/web-review/U12-qa-receipt-final.png)|真实回执20本金/2赠金、8.5折前后、到账、店时区、核对/联系门店；另一笔真实核对余额71000分不变。旧无个人折扣回执pending仍有核对入口，测试23保护。|
|U22|[U22-qa-pending-final.png](/Users/changliu/Desktop/有迹管家/Codex/LuckyLuxe_Claude_Handoff_2026-07-03/worktrees/member-pricing-20261113/handoff/member-pricing-frontend-20261114/evidence/web-review/U22-qa-pending-final.png)|真实两人0/2待签组；充值本金/赠金/新折扣；卡主先签、朋友随后；仅两种签署入口。|
|U25|[U25-qa-daily-final.png](/Users/changliu/Desktop/有迹管家/Codex/LuckyLuxe_Claude_Handoff_2026-07-03/worktrees/member-pricing-20261113/handoff/member-pricing-frontend-20261114/evidence/web-review/U25-qa-daily-final.png)|真实两人服务170×2，按人归档与原件入口；营业340、充值1000、抽屉1000，未重复计入充值。|
|S06|[S06-qa-staff-final.png](/Users/changliu/Desktop/有迹管家/Codex/LuckyLuxe_Claude_Handoff_2026-07-03/worktrees/member-pricing-20261113/handoff/member-pricing-frontend-20261114/evidence/web-review/S06-qa-staff-final.png)|真实员工账号查看已服务顾客，8.5折只读，无独立改折扣/资金入口。|
|S12|[S12-qa-correction-final.png](/Users/changliu/Desktop/有迹管家/Codex/LuckyLuxe_Claude_Handoff_2026-07-03/worktrees/member-pricing-20261113/handoff/member-pricing-frontend-20261114/evidence/web-review/S12-qa-correction-final.png)|真实更正入口与原单170/8.5折；输入160后服务端预览退回储值10，未提交更正。输入debounce及reviewHash闸已双端接线。|
|S17|[S17-qa-partial-final.png](/Users/changliu/Desktop/有迹管家/Codex/LuckyLuxe_Claude_Handoff_2026-07-03/worktrees/member-pricing-20261113/handoff/member-pricing-frontend-20261114/evidence/web-review/S17-qa-partial-final.png)|真实先签卡主后1/2，朋友待签；已签不重复扣款说明；原两按钮保留。|
|S18|[S18-qa-nonmember-final.png](/Users/changliu/Desktop/有迹管家/Codex/LuckyLuxe_Claude_Handoff_2026-07-03/worktrees/member-pricing-20261113/handoff/member-pricing-frontend-20261114/evidence/web-review/S18-qa-nonmember-final.png)|独立测试店暂时关闭会员制度：原价必选/会员价可选，列表只展示启用原价；非会员文案已双端修正，之后恢复配置。|
|S18B|[S18B-qa-ineligible-final.png](/Users/changliu/Desktop/有迹管家/Codex/LuckyLuxe_Claude_Handoff_2026-07-03/worktrees/member-pricing-20261113/handoff/member-pricing-frontend-20261114/evidence/web-review/S18B-qa-ineligible-final.png)|另一独立zero店暂时drop规则：余额0、资格失效、保留8.5折记录但暂停使用；拍后已恢复keep。|
|S19|[S19-qa-platform-final.png](/Users/changliu/Desktop/有迹管家/Codex/LuckyLuxe_Claude_Handoff_2026-07-03/worktrees/member-pricing-20261113/handoff/member-pricing-frontend-20261114/evidence/web-review/S19-qa-platform-final.png)|真实平台会员配置：资格、有效期、退卡、等级开关、结算折扣说明、保存；截图状态未启用等级，未保存平台规则。|
|S22|[S22-qa-performance-final.png](/Users/changliu/Desktop/有迹管家/Codex/LuckyLuxe_Claude_Handoff_2026-07-03/worktrees/member-pricing-20261113/handoff/member-pricing-frontend-20261114/evidence/web-review/S22-qa-performance-final.png)|独立QA已确认日结with_split：业绩340、两人170各一单，8.5折及原单号、充值500×2、赠金50单列。目标进度空白已修为后端34%。|

布局差异明确保留：U25沿用原财务导航/现金手记，S12为原日结内联更正卡而非模态框；U12为储值流水内真实回执卡。合同的价格/状态/动作信息已落地。截图为989 CSS px宽、2倍像素的真实浏览器视口，长页滚动至相关区域；部分图仅覆盖相关区域。S12随后补了按钮8px间距和日期导航可换行，并重拍最终图。U25不把服务与充值合为营业额。

本次修复：U22/S17双端充值说明和签署阶段文字；S12网页ASI导致点击无响应、项目序号undefined、店时区，双端只读更正预览与reviewHash；S11小程序错误卡片新增返回订单安全导航；S18非会员条件说明；S22进度读后端pct；U12网页回执/核对及旧pending兼容。后端资金重复项和回执单源由主agent/顾客agent分别修复。

实际重复：S12连续160/165/160/169/160五轮，分别显示退回10/5/10/1/10且仅预览成功后启用提交，见 `S12-preview-five-rounds.json`；未提交更正。只对新QA店重开/确认日结用于预览，原商家历史未改。U12已核对操作真实调用且余额不变。现客户端测试23组全部通过；新history测试3组、原policy4组及membership-summary14项此前通过。小程序仅改源/测试，不占用另一agent的9422；其真实图归对方报告。
