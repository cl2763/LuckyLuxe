/* Additive presentation for both existing composers. All aggregation remains server-side. */
export function composerPreview(view) {
 const sum=(rows,key)=>rows.reduce((n,r)=>n+(r[key]??0),0),components=view.components;
 const pay=components.map(c=>c.payment),first=pay[0]||{},recharge=components.find(c=>c.recharge);
 const group={...view.totals,depositReceiptCents:sum(components,'depositReceiptCents'),payment:{
  timecardCoverCents:sum(pay,'timecardCoverCents'),storedUsedCents:sum(pay,'storedUsedCents'),
  balanceAvailableCents:(first.balanceAvailableCents??first.balance?.totalCents??0)+(recharge?recharge.recharge.amountCents+recharge.recharge.bonusCents:0),
  offlineDueCents:sum(pay,'offlineCents'),purchaseCents:view.totals.purchaseCents,rechargeCents:view.totals.rechargeCents,
  afterRechargeBalanceCents:recharge?(first.balance?.totalCents??first.balanceAvailableCents??0)+recharge.recharge.amountCents+recharge.recharge.bonusCents-sum(pay,'storedUsedCents'):null,
  pendingRechargeCents:recharge?recharge.recharge.amountCents+recharge.recharge.bonusCents:0}}
 return {...view,sheets:components.map((c,i)=>{const person=view.documents.find(p=>p.componentIndexes.includes(i)),first=person?.componentIndexes[0]===i;return {...c,couponOptions:first?person.couponOptions:[],couponUsableCount:first?person.couponOptions.filter(o=>o.usable).length:0}}),group}
}
