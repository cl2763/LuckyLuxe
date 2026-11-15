# 网页独立核验：最终范围记录

2026-11-15。全部操作仅隔离 QA 4346、合成门店及合成顾客。未提交 Git、未发布、未接触生产。

本轮已通过正常接口建立独立合成充值、两张签署服务单、日结与旧系统迁移资料；早期“未充值/未签署”仅指第一轮只读检查，已归档到 web-review-history.md，不代表当前状态。更正仅预览未提交；冲销仅打开确认未提交。

本报告覆盖下列真实实拍，不把代码存在等同全59屏视觉通过。其余屏幕及小程序状态由总矩阵和其他验收报告归并。页面截图已目视检查主次、对齐、间距、溢出和核心控件；非关联旧页面结构保持原样。

|屏幕|最终证据|实测结论/限制|
|---|---|---|
|U12|[U12-qa-receipt-final](/Users/changliu/Desktop/有迹管家/Codex/LuckyLuxe_Claude_Handoff_2026-07-03/worktrees/member-pricing-20261113/handoff/member-pricing-frontend-20261114/evidence/web-review/U12-qa-receipt-final.png)|真实本金/赠金回执及待核对；旧无折扣回执确认入口由 client 第23条覆盖。确认动作不变余额。|
|U22|[U22-qa-pending-final](/Users/changliu/Desktop/有迹管家/Codex/LuckyLuxe_Claude_Handoff_2026-07-03/worktrees/member-pricing-20261113/handoff/member-pricing-frontend-20261114/evidence/web-review/U22-qa-pending-final.png)|两人各一单，先签含充值单，两个签署入口。|
|U25|[U25-qa-daily-final](/Users/changliu/Desktop/有迹管家/Codex/LuckyLuxe_Claude_Handoff_2026-07-03/worktrees/member-pricing-20261113/handoff/member-pricing-frontend-20261114/evidence/web-review/U25-qa-daily-final.png)|多人服务170×2=340，与充值1000分开；日结后实拍。|
|S06|[S06-qa-staff-final](/Users/changliu/Desktop/有迹管家/Codex/LuckyLuxe_Claude_Handoff_2026-07-03/worktrees/member-pricing-20261113/handoff/member-pricing-frontend-20261114/evidence/web-review/S06-qa-staff-final.png)|员工只读个人折扣；独立调整不开放。|
|S12|[S12-qa-correction-final](/Users/changliu/Desktop/有迹管家/Codex/LuckyLuxe_Claude_Handoff_2026-07-03/worktrees/member-pricing-20261113/handoff/member-pricing-frontend-20261114/evidence/web-review/S12-qa-correction-final.png)|真实更正预览160，提示退储值10；reviewHash后才允许提交，未提交更正。|
|S17|[S17-qa-partial-final](/Users/changliu/Desktop/有迹管家/Codex/LuckyLuxe_Claude_Handoff_2026-07-03/worktrees/member-pricing-20261113/handoff/member-pricing-frontend-20261114/evidence/web-review/S17-qa-partial-final.png)|卡主已签/朋友待签1/2，充值不重复。|
|S18|[S18-qa-nonmember-final](/Users/changliu/Desktop/有迹管家/Codex/LuckyLuxe_Claude_Handoff_2026-07-03/worktrees/member-pricing-20261113/handoff/member-pricing-frontend-20261114/evidence/web-review/S18-qa-nonmember-final.png)|非会员店会员价格为可选，临时配置已恢复。|
|S19|[S19-qa-platform-final](/Users/changliu/Desktop/有迹管家/Codex/LuckyLuxe_Claude_Handoff_2026-07-03/worktrees/member-pricing-20261113/handoff/member-pricing-frontend-20261114/evidence/web-review/S19-qa-platform-final.png)|平台真实会员规则设置。|
|S22|[S22-qa-performance-final](/Users/changliu/Desktop/有迹管家/Codex/LuckyLuxe_Claude_Handoff_2026-07-03/worktrees/member-pricing-20261113/handoff/member-pricing-frontend-20261114/evidence/web-review/S22-qa-performance-final.png)|with_split独立服务/充值真实明细；服务340，充值500×2，赠金另列。|
|S13|[S13-legacy-final](/Users/changliu/Desktop/有迹管家/Codex/LuckyLuxe_Claude_Handoff_2026-07-03/worktrees/member-pricing-20261113/handoff/member-pricing-frontend-20261114/evidence/web-review/S13-legacy-final.png)|真实QA旧签署图，明确旧单未记录个人折扣，不回写旧单。|
|S21|[S21-confirm-final](/Users/changliu/Desktop/有迹管家/Codex/LuckyLuxe_Claude_Handoff_2026-07-03/worktrees/member-pricing-20261113/handoff/member-pricing-frontend-20261114/evidence/web-review/S21-confirm-final.png)|原本金/关联赠金、原因、新折扣确认，未实际冲销；未知旧单赠金不猜。|
|U26|[U26-history-modal-final](/Users/changliu/Desktop/有迹管家/Codex/LuckyLuxe_Claude_Handoff_2026-07-03/worktrees/member-pricing-20261113/handoff/member-pricing-frontend-20261114/evidence/web-review/U26-history-modal-final.png)|折扣记录现为浮层，时间门店时区，原因/操作人/来源/充值本金赠金；关闭不保存。|
|S15|[S15-editor-title-final](/Users/changliu/Desktop/有迹管家/Codex/LuckyLuxe_Claude_Handoff_2026-07-03/worktrees/member-pricing-20261113/handoff/member-pricing-frontend-20261114/evidence/web-review/S15-editor-title-final.png)|编辑价档·项目名及关闭返回；改变输入后取消重开仍为原值。|
|U24|[U24-legacy-content-final](/Users/changliu/Desktop/有迹管家/Codex/LuckyLuxe_Claude_Handoff_2026-07-03/worktrees/member-pricing-20261113/handoff/member-pricing-frontend-20261114/evidence/web-review/U24-legacy-content-final.png)|通过标准迁移正门导入合成旧余额123.45/消费/卡/赠品；旧余额仍待核对，不计可用余额。|
|U27|[U27-public-price-content-final](/Users/changliu/Desktop/有迹管家/Codex/LuckyLuxe_Claude_Handoff_2026-07-03/worktrees/member-pricing-20261113/handoff/member-pricing-frontend-20261114/evidence/web-review/U27-public-price-content-final.png)|mock合成询价会话，规则回复公开原价200；没有向真实顾客发消息。沿用工作台真实会话结构，未伪造待发送AI草稿。|
|S18B|[S18B-ineligible-composer-final](/Users/changliu/Desktop/有迹管家/Codex/LuckyLuxe_Claude_Handoff_2026-07-03/worktrees/member-pricing-20261113/handoff/member-pricing-frontend-20261114/evidence/web-review/S18B-ineligible-composer-final.png)|真实结算开单，0余额资格失效只显示原价200。挂充值300后服务端catalog允许8.5折并自动会员价；撤挂后回原价。未创建服务单或入账。|
|S07|[S07-zero-drop-final](/Users/changliu/Desktop/有迹管家/Codex/LuckyLuxe_Claude_Handoff_2026-07-03/worktrees/member-pricing-20261113/handoff/member-pricing-frontend-20261114/evidence/web-review/S07-zero-drop-final.png)|0余额、资格失效、8.5折记录保留且不可用。|
|S08|[S08-zero-keep-final](/Users/changliu/Desktop/有迹管家/Codex/LuckyLuxe_Claude_Handoff_2026-07-03/worktrees/member-pricing-20261113/handoff/member-pricing-frontend-20261114/evidence/web-review/S08-zero-keep-final.png)|0余额、资格有效、8.5折可用；独立QA配置已恢复keep。|
|S16|[S16-empty-recharge-final](/Users/changliu/Desktop/有迹管家/Codex/LuckyLuxe_Claude_Handoff_2026-07-03/worktrees/member-pricing-20261113/handoff/member-pricing-frontend-20261114/evidence/web-review/S16-empty-recharge-final.png)|真实无充值套餐空态，保留五个营销板块与新建入口。|

测试：member-pricing-client 24组通过；第24组覆盖资格失效→随单充值有效→撤挂失效。S12真实金额预览五轮留证 S12-preview-five-rounds.json；展示编辑及折扣取消五轮保留 *repeat-fixed.json。U26门店时区由history display测试覆盖，未使用设备时区。

修复：U26展开改浮层；S15标题/关闭返回；S18B网页资格信息补齐，双端可用价格档以服务端catalog资格为准，首次加载用真实会员资格。U12旧pending充值保留核对入口。所有旧截屏和中间失败证据保留供追溯，不能代替上表最终截图。

U27本次实际命中规则报价而非生成式AI待发草稿；已验证公开价格200，没有把个人8.5折折入客服公开报价。U24旧迁移操作按钮沿用现有旧UI样式，未扩大到迁移功能重设计。
