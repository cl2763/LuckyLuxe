import {PRICING_CONTEXT} from './member-pricing-policy.mjs'
/** Staff public quote calculator: display prices only, no customer/asset context. */
export function memberPricingReference({policy,computeSettlement,apiError,tenantId,body}) {
 const fail=(code,message)=>{throw apiError(400,code,message)}
 const config=policy.config(tenantId)
 if(!config.active)throw apiError(409,'PRICING_NOT_ENABLED','新版展示价格尚未启用。')
 if(Object.keys(body).some(k=>!['tierKey','items','applyFootSurcharge'].includes(k)))fail('REFERENCE_ONLY','公开参考报价不接受顾客、充值、优惠券或扣款信息。')
 const tierKey=body.tierKey||'list'
 if(!config.displayTypes.includes(tierKey))fail('PRICE_TYPE_DISABLED','本店展示价格未启用这个价格类型。')
 if(body.applyFootSurcharge!==undefined&&typeof body.applyFootSurcharge!=='boolean')fail('INVALID_ITEMS','足部加收选项无效。')
 if(!Array.isArray(body.items)||!body.items.length||body.items.length>100)fail('INVALID_ITEMS','请选择1至100个服务项目。')
 const items=body.items.map(item=>{
  if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(k=>!['serviceId','qty'].includes(k)))fail('INVALID_ITEMS','参考报价项目格式无效。')
  const qty=item.qty??1
  if(!Number.isSafeInteger(qty)||qty<1||qty>1000)fail('INVALID_ITEMS','数量须为1至1000的整数。')
  const service=policy.service(tenantId,item.serviceId)
  if(!service.is_active||service.is_timecard)fail('SERVICE_UNAVAILABLE','项目已停用或不属于服务参考报价。')
  if(!policy.publicPrices(tenantId,service.id).prices[tierKey])fail('PRICE_NOT_CONFIGURED','该项目未填写这个展示价格，请改选已配置的项目或价格类型。')
  return {serviceId:service.id,qty}
 })
 const settlement=computeSettlement({tenantId,tierKey,items,applyFootSurcharge:body.applyFootSurcharge===true,depositApplied:false,payIntent:'offline_full',[PRICING_CONTEXT]:{tenantId,publicReference:true,applyPersonal:false}})
 return {referenceOnly:true,settlement}
}
