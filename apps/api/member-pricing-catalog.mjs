import {PRICING_CONTEXT} from './member-pricing-policy.mjs'
export function memberPricingCatalog({db,policy,calculation,tenantId,body,admin}){
 const input={...body,settlements:(body.settlements||[{}]).map(s=>({...s,tierKey:undefined,items:[],customItems:[],timecardId:undefined,purchasePackageId:undefined}))},prepared=calculation.prepare(tenantId,body.userId,input,admin),ctx=prepared.sheets[0][PRICING_CONTEXT],config=policy.config(tenantId);
 const items=db.prepare('SELECT * FROM services WHERE tenant_id=? AND is_active=1').all(tenantId).map(s=>{
  const prices={};for(const tier of config.settlementTypes){if(tier==='member'&&!ctx.eligible)continue;if(s.price_mode==='quote'){prices[tier]=null;continue}const priceContext={...ctx,applyPersonal:tier==='member'&&ctx.rateBps!==null};try{const price=calculation.priceOf(s,tier,priceContext),list=policy.prices(tenantId,s.id,'settlement').prices.list.priceCents,lines=[{kind:s.item_kind,qty:1,listUnitCents:list,listAmountCents:list,unitPriceCents:price.priceCents,amountCents:price.priceCents}];calculation.apply(lines,[],priceContext);prices[tier]=lines[0].amountCents}catch(e){if(e.code!=='PRICE_NOT_CONFIGURED')throw e}}
  return {id:s.id,prices,requiresQuote:s.price_mode==='quote'}
 });return {items,eligible:ctx.eligible,rateBps:ctx.rateBps}
}

export function memberPriceSummary(policy,row,formatMoneyCents){
 const config=policy.config(row.tenant_id),prices=policy.prices(row.tenant_id,row.id,'settlement').prices
 return config.settlementTypes.filter(key=>key==='member'||prices[key]).map(key=>({key,label:key==='member'?'会员价 · 按本人有效折扣':({list:'原价',share:'分享价',course:'疗程价'}[key]),amountText:prices[key]?formatMoneyCents(prices[key].priceCents,row.tenant_id,2):''}))
}
