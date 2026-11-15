import {discountLabel} from './member-discount-input.mjs'
export function memberDocumentDisplay(quote,{money,customerName,storeName}) {
 const sum=(xs,key)=>xs.reduce((n,x)=>n+(x[key]??0),0),components=quote.components,rows=[];
 const tiers=[...new Set(components.filter(c=>c.lines.some(l=>l.kind!=='timecard')).map(c=>c.tierKey||'member'))],memberOnly=tiers.length===1&&tiers[0]==='member';
 const appliedDiscountText=memberOnly?(quote.personalDiscount.eligible?discountLabel(quote.personalDiscount.effectiveRateBps):'当前无会员折扣资格'):tiers.length>1?'按各项目所选价档':({list:'原价',share:'分享价',course:'疗程价'}[tiers[0]]||'次卡核销');
 const row=(label,cents)=>({label,value:money(cents)}),payments=components.map(c=>c.payment);
 rows.push(row('服务原价',quote.listTotalCents),row(memberOnly&&quote.personalDiscount.eligible?'个人会员优惠 · '+discountLabel(quote.personalDiscount.effectiveRateBps):'价格优惠',-quote.tierDiscountCents),row('服务折后小计',quote.subtotalCents),row('优惠券',-quote.couponDiscountCents),row('已付定金',-quote.depositDeductCents),row('服务应付',quote.totalCents-quote.rechargeCents-quote.purchaseCents));
 for(const c of components)if(c.depositDeductCents&&c.depositDetail?.sourceText)rows.splice(rows.length-1,0,{label:'定金来源',value:c.depositDetail.sourceText});
 const recharges=components.filter(c=>c.recharge),paymentRows=[row('次卡抵扣',sum(payments,'timecardCoverCents')),row('储值余额扣款',sum(payments,'storedUsedCents')),row('到店收款 · 服务差额',sum(payments,'offlineCents')-quote.rechargeCents-quote.purchaseCents)];
 if(quote.purchaseCents)paymentRows.push(row('线下收款 · 购卡款',quote.purchaseCents));
 if(Number.isSafeInteger(quote.expectedBalanceBeforeCents))paymentRows.push(row('签署前账户余额（预计）',quote.expectedBalanceBeforeCents));
 for(const c of recharges){paymentRows.push(row('线下收款 · 充值本金',c.recharge.amountCents),row('充值赠金（不另收款）',c.recharge.bonusCents));}
 paymentRows.push(row('本单扣款后余额（预计）',quote.expectedBalanceAfterCents??(quote.personalDiscount.current.balanceCents+sum(recharges.map(c=>c.recharge),'amountCents')+sum(recharges.map(c=>c.recharge),'bonusCents')-sum(payments,'storedUsedCents'))));
 return {discountChangeText:recharges.length?discountLabel(quote.personalDiscount.current.rateBps)+' → '+discountLabel(quote.personalDiscount.proposedRateBps):'',storeName,customerName,beneficiaryName:quote.beneficiaryKey==='self'?customerName:quote.name,discountText:appliedDiscountText,
 lines:components.flatMap(c=>c.lines.map(l=>({name:l.name,technicians:c.technicians.map(t=>t.name).join(' / '),amountText:money(l.amountCents),listText:money(l.listAmountCents)}))),rows,paymentRows,
 gifts:recharges.flatMap(c=>(c.recharge.giftItems||[]).map(g=>({...g,valueText:money(g.unitValueCents)}))),note:recharges.length?'充值、赠送、新折扣及扣款将在本张签署成功后一起生效。':'请核对所有服务和支付明细。'}
}
