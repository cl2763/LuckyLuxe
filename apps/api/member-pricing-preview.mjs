import {composerPreview} from './member-pricing-view.mjs'
import {scopedCouponAmounts} from './member-pricing-coupons.mjs'
import {PRICING_CONTEXT} from './member-pricing-policy.mjs'
/** One server calculation for the two clients and for persisted person documents. */
export function createMemberPricingPreview({db,policy,calculation,computeSettlement,buildPaymentLegs,couponOptionsFor,apiError}) {
  function prepare(tenantId,body,admin) {
    const userId=String(body.cardOwnerUserId||body.userId||'').trim()
    const prepared=calculation.prepare(tenantId,userId,body,admin),{context}=prepared
    // Recharge comes first, then all components for that person, then the other people.
    const key=s=>s.beneficiaryKey||(!String(s.servedPersonName||'').trim()?'self':'')
    const original=prepared.sheets,rs=original.find(s=>s.rechargePackageId||s.rechargeAmountCents!==undefined)
    if(rs&&key(rs)!=='self') throw apiError(400,'RECHARGE_OWNER_DOCUMENT','请把随单充值放在卡主本人的服务单中。')
    const personOrder=[...new Set([...(rs?['self']:[]),...original.map(key)])]
    const sheets=personOrder.flatMap(k=>original.filter(s=>key(s)===k).sort((a,b)=>Number(b===rs)-Number(a===rs)))
    const deposits=new Set(),coupons=new Set(),cards=new Set(),people=new Map(),roundingBases=new Map()
    const calculated=sheets.map((sheet,index)=>{
      const bookingId=String(sheet.bookingId||body.bookingId||'').trim()
      if(bookingId) {
        const booking=db.prepare('SELECT user_id FROM bookings WHERE tenant_id=? AND id=?').get(tenantId,bookingId)
        if(!booking||booking.user_id!==userId) throw apiError(400,'BOOKING_OWNER_MISMATCH','预约与卡主不一致。')
        if(sheet.depositApplied&&deposits.has(bookingId)) throw apiError(400,'DUPLICATE_DEPOSIT','同一笔定金不能重复抵扣。')
        if(sheet.depositApplied) deposits.add(bookingId)
      }
      for(const [value,set,code] of [[sheet.couponGrantId,coupons,'DUPLICATE_COUPON'],[sheet.timecardId,cards,'DUPLICATE_TIMECARD']]) {
        if(value&&set.has(value)) throw apiError(400,code,'同一张券或次卡不能重复选择。')
        if(value)set.add(value)
      }
      const name=String(sheet.servedPersonName||'').trim(),personKey=String(key(sheet)).trim()
      if(!/^[\w-]{1,64}$/.test(personKey)||(personKey==='self'&&name)||(personKey!=='self'&&!name)||name.length>40) throw apiError(400,'BENEFICIARY_REQUIRED','请为其他被服务者选择独立身份标记并填写姓名。')
      if(people.has(personKey)&&people.get(personKey).name!==name) throw apiError(400,'BENEFICIARY_MISMATCH','同一个被服务者的姓名不一致。')
      if(!people.has(personKey)) people.set(personKey,{beneficiaryKey:personKey,name,componentIndexes:[],selectedGrantId:''})
      const person=people.get(personKey)
      if(sheet.couponGrantId) {
        if(person.selectedGrantId) throw apiError(400,'ONE_COUPON_PER_DOCUMENT','一张服务单只能使用一张优惠券。')
        person.selectedGrantId=String(sheet.couponGrantId)
      }
      person.componentIndexes.push(index)
      sheet[PRICING_CONTEXT].roundingBaseCents=roundingBases.get(personKey)||0
      const computed=computeSettlement({...sheet,tenantId,userId,payerUserId:userId,bookingId:bookingId||null,
        couponGrantId:'',strictCoupon:false,payIntent:sheet.payIntent||body.payIntent,
        rechargeTechnicianId:admin.role==='staff'?admin.technicianId:(sheet.rechargeTechnicianId||admin.technicianId||(sheet.technicians?.length===1?sheet.technicians[0].technicianId:null))})
      if(sheet[PRICING_CONTEXT].applyPersonal) roundingBases.set(personKey,(roundingBases.get(personKey)||0)+computed.lines.filter(l=>l.kind!=='timecard').reduce((n,l)=>n+l.listAmountCents,0))
      const {personalPricing,...publicComputed}=computed
      return {...publicComputed,beneficiaryKey:personKey,technicians:(sheet.technicians||[]).map(t=>({technicianId:t.technicianId,role:t.role||'main',itemNos:t.itemNos||[],name:db.prepare('SELECT name FROM technicians WHERE id=? AND tenant_id=?').get(t.technicianId,tenantId)?.name||''}))}
    })
    const sum=(items,key)=>items.reduce((n,c)=>n+(c[key]||0),0)
    for(const person of people.values()) {
      const components=person.componentIndexes.map(i=>calculated[i]),lines=components.flatMap(c=>c.lines).filter(l=>l.kind!=='timecard')
      const eligible=lines.reduce((n,l)=>n+l.amountCents,0),deposit=sum(components,'depositDeductCents')
      const categoryIds=[...new Set(lines.filter(l=>l.serviceId).map(l=>db.prepare('SELECT category_id FROM services WHERE id=? AND tenant_id=?').get(l.serviceId,tenantId)?.category_id).filter(Boolean))]
      const categoryOf=l=>l.serviceId?[db.prepare('SELECT category_id FROM services WHERE id=? AND tenant_id=?').get(l.serviceId,tenantId)?.category_id].filter(Boolean):[]
      const scopedLines=person.componentIndexes.flatMap(i=>{
        const c=calculated[i],chargeLines=c.lines.filter(l=>l.kind!=='timecard'),mainCategories=[...new Set(chargeLines.filter(l=>l.kind==='main').flatMap(categoryOf))]
        const available=Math.max(0,chargeLines.reduce((n,l)=>n+l.amountCents,0)-c.depositDeductCents)
        return chargeLines.map(l=>({componentIndex:i,componentAvailableCents:available,amountCents:l.amountCents,categoryIds:l.serviceId?categoryOf(l):mainCategories}))
      })
      const coupons=couponOptionsFor({tenantId,userId,readOnly:true,scopedLines,subtotalCents:eligible,maxDeductCents:Math.max(0,eligible-deposit),categoryIds,selectedGrantId:person.selectedGrantId,noEligibleReason:'没有可优惠的收费服务'})
      if(person.selectedGrantId&&!coupons.selectedGrantId) throw apiError(400,'COUPON_UNUSABLE',coupons.options.find(c=>c.grantId===person.selectedGrantId)?.reason||'这张券不可用于本单。')
      person.couponOptions=coupons.options.map(o=>({...o,deductText:o.discountText}));person.coupon=coupons.selected?{grantId:coupons.selected.grantId,couponId:coupons.selected.couponId,name:coupons.selected.name,discountCents:coupons.discountCents,grantKind:coupons.selected.grantKind}:null
      const scopedAmounts=scopedCouponAmounts(coupons.selected?.scopeCategoryIds||[],scopedLines)
      let remaining=coupons.discountCents,linked=false
      for(const c of components) {
        const max=scopedAmounts.find(a=>a.componentIndex===calculated.indexOf(c))?.maxDeductCents||0
        const amount=Math.min(max,remaining);remaining-=amount
        c.couponDiscountCents=amount;c.discountTotalCents=c.tierDiscountCents+amount;c.totalCents-=amount
        c.couponOptions=[];c.couponUsableCount=0
        c.coupon=person.coupon&&!linked&&max>0?{...person.coupon,discountCents:amount}:null
        if(c.coupon)linked=true
      }
    }
    let plannedStoredCents=0,pendingAvailableInCents=0
    for(const c of calculated) {
      const tcLine=c.lines.find(l=>l.kind==='timecard'),cover=tcLine?Math.min(tcLine.amountCents,c.totalCents):0
      const pendingRechargeCents=c.recharge?(c.recharge.amountCents+c.recharge.bonusCents):0
      const pay=buildPaymentLegs({tenantId,payerId:userId,totalCents:c.totalCents-cover,payIntent:c.payment.plan,
        storedExcludeCents:c.purchaseCashOnlyCents+c.rechargeCents,pendingRechargeCents,plannedStoredCents,pendingAvailableInCents,
        excludeNote:'到店支付（含充值或购卡款）'})
      if(tcLine)pay.legs.unshift({leg:'times_card',amountCents:cover,payerUserId:userId,note:'次卡核销',label:'次卡抵扣'})
      c.payment={...c.payment,timecardCoverCents:cover,legs:pay.legs,storedUsedCents:pay.storedUsedCents,sharedStoredUsedCents:pay.sharedStoredUsedCents,pendingRechargeUnusedCents:pay.pendingRechargeUnusedCents,
        offlineCents:pay.remaining,afterRechargeBalanceCents:c.recharge?pay.balance.totalCents+pendingRechargeCents-pay.storedUsedCents:null}
      plannedStoredCents+=pay.sharedStoredUsedCents;pendingAvailableInCents=pay.pendingRechargeUnusedCents
    }
    const totals=items=>Object.fromEntries(['listTotalCents','subtotalCents','tierDiscountCents','couponDiscountCents','discountTotalCents','totalCents','depositDeductCents','purchaseCents','rechargeCents'].map(k=>[k,sum(items,k)]))
    const view={components:calculated,documents:[...people.values()].map(p=>({...p,...totals(p.componentIndexes.map(i=>calculated[i]))})),
      totals:totals(calculated),personalDiscount:{current:policy.discount(tenantId,userId),proposedRateBps:context.proposedRateBps,
        effectiveRateBps:context.rateBps,suggestedRateBps:context.suggestedRateBps,suggestionSource:context.suggestionSource,manuallySelected:context.manuallySelected,eligible:context.eligible,pendingRecharge:Boolean(context.recharge),configRevision:context.configRevision},readOnly:true}
    return {view,sheets,context,userId}
  }
  return {prepare,preview:(...args)=>composerPreview(prepare(...args).view)}
}
