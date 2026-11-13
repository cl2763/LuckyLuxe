/** Public reference prices never contain a customer's private discount. */
export function createMemberPricingPresentation({db,policy}) {
  const names={list:['普通','List'],member:['会员','Member'],share:['分享','Share'],course:['疗程','Course']}
  function of(id) {
    const service=db.prepare('SELECT * FROM services WHERE id=?').get(id)
    if(!service||!policy.config(service.tenant_id).active)return null
    return policy.publicPrices(service.tenant_id,id).prices
  }
  function serviceRow(row,tid=row?.tenant_id) {
    if(!row||!tid||!policy.config(tid).active)return row
    const prices=policy.publicPrices(tid,row.id).prices
    return {...row,price_cents:prices.list.priceCents,display_pricing:prices}
  }
  function tiers(id) {
    const values=of(id)
    return values?Object.entries(values).map(([key,v])=>({key,nameZh:names[key][0],nameEn:names[key][1],cents:v.priceCents})):null
  }
  return {of,serviceRow,tiers}
}
