// Merchant-facing entry and permissions; no customer, account-secret or financial records.
const groups=[
 [['store','hours','specialDates','hero','guide'],'老板可修改','门店设置'],
 [['services','priceTypes'],'老板可修改','服务与价目 → 上架服务／价格类型'],
 [['settlement','pricingRules'],'老板可修改','服务与价目 → 结算单目录'],
 [['recharge','times','coupons','points'],'老板可修改','会员与营销'],
 [['membership'],'联系平台调整','会员与营销 → 会员体系（只读摘要）'],
 [['booking','notifications'],'老板可修改','门店设置 → 预约与通知'],
 [['deposit'],'老板在网页修改','门店设置 → 定金与取消'],
 [['staff','accounts','visibility','schedule','salary','targets'],'老板管理；员工权限沿用原规则','员工与排班；薪资／账号由老板核对'],
 [['recurring'],'老板在网页财务核对后修改','财务 → 固定费用'],
 [['knowledge','quote'],'老板在网页修改；接入授权由本人完成','门店设置 → 客服与知识'],
 [['segments'],'老板可修改','客户档案 → 分层规则']
]
export function setupDeliveryInfo(key){const g=groups.find(([keys])=>keys.includes(key));return {rights:g?.[1]||'请联系平台核对',entry:g?.[2]||'平台配置核对'}}
