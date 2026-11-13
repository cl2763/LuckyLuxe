/** Restrict discounts and minimum spend to the services included in a coupon's scope. */
export function scopedCouponAmounts(scope,lines) {
  const byComponent=new Map()
  for(const line of lines) {
    const entry=byComponent.get(line.componentIndex)||{componentIndex:line.componentIndex,eligibleCents:0,availableCents:line.componentAvailableCents}
    if(!scope.length||line.categoryIds.some(id=>scope.includes(id)))entry.eligibleCents+=line.amountCents
    byComponent.set(line.componentIndex,entry)
  }
  return [...byComponent.values()].map(e=>({...e,maxDeductCents:Math.min(e.eligibleCents,e.availableCents)}))
}
export function scopedCouponContext(scope,context,lines) {
  const amounts=scopedCouponAmounts(scope,lines)
  return {...context,subtotalCents:amounts.reduce((n,e)=>n+e.eligibleCents,0),
    maxDeductCents:amounts.reduce((n,e)=>n+e.maxDeductCents,0)}
}
