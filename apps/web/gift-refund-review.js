/* One review joins refund terms and gift decisions; the existing refund route remains the only writer. */
window.GiftRefundReview={async ask({request,userId,sourceTxnId,escapeHtml:e,toast,refund}){
 const review=await request('/admin/account-adjust/gift-review?userId='+encodeURIComponent(userId)+(sourceTxnId?'&sourceTxnId='+encodeURIComponent(sourceTxnId):''))
 if(!review.required)return {}
 const pricing=refund?await window.MemberPricingMember.read(request,userId):null
 return new Promise(resolve=>{
  let overlay,wheel
  const fields=review.items.flatMap((g,i)=>[{key:'action'+i,label:g.kindLabel+' · '+g.name,type:'select',value:'',options:[['','请选择处理方式'],['keep','保留权益'],['void','作废未使用权益']]},...(g.kind==='physical'&&g.claimed>0?[{key:'return'+i,label:g.name+' · 本次实际退回件数',type:'number',value:0,hint:'填写0表示顾客保留已领实物；最多 '+g.claimed+' 件。选择作废时可退回。'}]:[])])
  fields.push({key:'reviewConfirmed',label:'已核对退款金额、折扣及关联赠送权益',type:'checkbox',value:false})
  window.FormModal.open({title:'核对本次充值的赠送权益',hint:'逐项选择保留或作废未使用权益；已使用记录保留。实物只有已收回时才填写退回件数。参考价值不自动抵扣退款。',fields,saveText:refund?'确认退款与权益处理':'确认权益并继续',mountContent:root=>{
   overlay=root
   const panel=root.querySelector('.form-modal-panel');panel.classList.add('gift-refund-panel')
   const grid=panel.querySelector('.kb-facts-grid'),layout=document.createElement('div');layout.className='gift-refund-layout'
   const summary=document.createElement('section');summary.className='gift-refund-summary';summary.innerHTML='<h3>关联权益</h3>'+review.items.map(g=>'<article><strong>'+e(g.kindLabel+' · '+g.name)+'</strong><p>剩余 '+g.remaining+' / '+g.quantity+' · 已'+(g.kind==='physical'?'领':'用')+' '+g.claimed+' · 已作废 '+g.voided+'</p><p class="subtle">'+e(g.expiresOn?'有效期至 '+g.expiresOn:'长期有效')+'</p></article>').join('')+'<p class="gift-review-notice">已核销或已领取的权益不会自动折算扣款。请按本店约定核对实际退款金额；历史单据和使用记录保留。</p>'
   const right=document.createElement('section');right.className='gift-refund-confirm';right.innerHTML='<h3>老板确认</h3>'
   if(refund){right.innerHTML+='<label>实际退还金额 *'+window.MoneyInput.field({id:'giftRefundAmount',value:String(refund.amountCents/100)})+'</label><p class="subtle">退款方式：'+e(({cash:'现金',transfer:'转账',original:'原路退回',other:'其他'})[refund.payChannel]||refund.payChannel)+'</p>'+(pricing.active?'<label>退款后个人折扣 *<div data-refund-wheel></div></label>':'')+'<label>处理说明 *<textarea data-refund-reason rows="3" maxlength="200">'+e(refund.reason)+'</textarea></label>';if(pricing.active)wheel=window.DiscountWheel.mount(right.querySelector('[data-refund-wheel]'),{value:pricing.member.rateBps})}
   grid.before(layout);layout.append(summary,right);right.append(grid)
   const error=document.createElement('p');error.setAttribute('role','alert');right.append(error)
   const actions=panel.querySelector(':scope > .action-row');right.append(actions)
  },onCancel:()=>resolve(null),onSave:async v=>{
   const fail=message=>{overlay.querySelector('[role=alert]').textContent=message;return false}
   const items=review.items.map((g,i)=>({id:g.id,action:v['action'+i],returnQuantity:Number(v['return'+i]||0)}))
   if(items.some(i=>!['keep','void'].includes(i.action)))return fail('请逐项选择权益处理方式')
   if(items.some((i,n)=>!Number.isSafeInteger(i.returnQuantity)||i.returnQuantity<0||i.returnQuantity>review.items[n].claimed||(i.returnQuantity&&i.action!=='void')))return fail('请核对退回件数，并选择作废未使用权益')
   if(!v.reviewConfirmed)return fail('请确认已核对退款金额、折扣及关联赠送权益')
   const result={giftReview:{reviewHash:review.reviewHash,items}}
   if(refund){const amountCents=window.MoneyInput.centsOf(overlay.querySelector('#giftRefundAmount').value),reason=overlay.querySelector('[data-refund-reason]').value.trim();if(!Number.isSafeInteger(amountCents)||amountCents<=0)return fail('请输入大于零的退款金额');if(!reason)return fail('请填写处理说明');result.refundForm={amountCents,reason};if(pricing.active)result.discountConfirmation=window.MemberPricingMember.confirmation(pricing.member,wheel.read(),reason)}
   resolve(result)
  }},{escapeHtml:e,toast})
 })
}}
