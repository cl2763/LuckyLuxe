export const setupGroups=[
 {key:'store',title:'门店基础',modules:['store','hours','specialDates','hero','guide'],rights:'老板可改；币种、时区由平台核对'},
 {key:'services',title:'上架服务',modules:['services','bookingAddons'],rights:'老板可改展示内容与价格'},
 {key:'settlement',title:'结算单目录',modules:['settlement','pricingRules'],rights:'老板可改；会员价按本人折扣'},
 {key:'membership',title:'会员与营销',modules:['recharge','times','coupons','points','membership'],rights:'套餐老板可改；会员资格平台管理'},
 {key:'booking',title:'预约与通知',modules:['deposit','notifications'],rights:'老板可改；部分规则在网页修改'},
 {key:'staff',title:'人员与薪资',modules:['staff','accounts','visibility','schedule','salary','targets','recurring'],rights:'老板管理；员工权限保持原规则'},
 {key:'knowledge',title:'客服与知识',modules:['knowledge','quote'],rights:'本店知识老板可改，接入需授权'},
 {key:'customers',title:'顾客与迁移',modules:['segments'],rights:'分层老板可改；旧资料与旧权益走专项核对'}
]
export function setupProgress(modules,drafts){const related=drafts.filter(d=>modules.includes(d.module)&&d.status!=='discarded');if(related.some(d=>d.status==='draft'&&d.needsOwnerConfirmation&&!d.ownerConfirmed))return '待老板确认';if(related.some(d=>d.status==='draft'))return '草稿待核对';if(related.some(d=>d.status==='applied'))return '已应用 · 待交付核对';return '本次尚未整理'}
