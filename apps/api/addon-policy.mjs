import policy from '../web/addon-policy.js'
export const catalogInteractionEnabled=tid=>String(process.env.CATALOG_INLINE_TENANTS||'demo-ai').split(',').map(v=>v.trim()).some(v=>v==='*'||v===tid)
export function assertAddonScope(service,main,apiError){if(service.item_kind==='addon'&&!policy.matches(service,main))throw apiError(400,'ADDON_SCOPE_MISMATCH','加项“'+service.name_zh+'”不适用于本组主项目，请更换主项目或取消该加项。')}

export function settlementUnitPrices({svc,tierKey,mainRow,mainTierCents,rules,tenantId,priceOf,apiError}) {
  if(catalogInteractionEnabled(tenantId))assertAddonScope(svc,mainRow,apiError)
  let tierUnit=priceOf(svc,tierKey).priceCents,listUnit=priceOf(svc,'list').priceCents,ruleApplied=null
  // 单指挂靠主项目按比例：两档都按各自档的主项目价算。
  if((svc.unit||'once')==='per_finger'&&svc.price_rule==='pct_of_tier_price'&&rules.single_finger.isActive){
    if(catalogInteractionEnabled(tenantId)&&!mainRow)throw apiError(400,'ADDON_MAIN_REQUIRED','按主项目比例计价的加项需要先选择本组主项目。')
    const pct=Number(svc.price_rule_value)>0?Number(svc.price_rule_value):Number(rules.single_finger.config.pct||10)
    tierUnit=Math.round(mainTierCents*pct/100)
    listUnit=Math.round((mainRow?priceOf(mainRow,'list').priceCents:0)*pct/100)
    ruleApplied='single_finger'
  }
  return {tierUnit,listUnit,ruleApplied}
}
