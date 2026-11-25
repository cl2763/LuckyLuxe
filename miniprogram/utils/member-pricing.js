/* Shared client input contract. No settlement arithmetic: amounts come from the server. */
;(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MemberPricingInput=api})(typeof window!=='undefined'?window:this,function(){
  const types=[{key:'list',label:'原价'},{key:'member',label:'会员价'},{key:'share',label:'分享价'},{key:'course',label:'疗程价'}]
  const label=rate=>rate===null?'按门店默认会员价':rate===10000?'无折扣':Math.trunc(rate/1000)+'.'+Math.trunc(rate%1000/100)+'折'
  const options=[{rateBps:null,label:label(null)},...Array.from({length:100},(_,i)=>({rateBps:10000-i*100,label:label(10000-i*100)}))]
  function operation(){return 'mp-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,14)}
  function retryKey(holder,body){const payload=JSON.stringify(body);if(holder.payload!==payload){holder.payload=payload;holder.operationId=operation()}return holder.operationId}
  function people(groups){const people=[];for(let i=0;i<groups.length;i++){const g=groups[i],key=g.beneficiaryKey||'self';let p=people.find(p=>p.key===key);if(!p){p={key,name:g.servedPersonName||'',self:key==='self',groups:[]};people.push(p)}p.groups.push({...g,index:i})}return people}
  function enrich(st,sheets){if(!st.pricingConfig?.active)return sheets;if(st.pricingConfig.giftEntitlementsEnabled&&!st.giftDraftKey)st.giftDraftKey=operation();return sheets.map((s,i)=>({...s,...(st.pricingConfig.giftEntitlementsEnabled&&(s.rechargePackageId||s.rechargeAmountCents!==undefined)?{giftDraftKey:st.giftDraftKey}:{}),...(st.pricingConfig.giftEntitlementsEnabled?{couponGrantId:st.groups.findIndex(g=>(g.beneficiaryKey||'self')===(st.groups[i].beneficiaryKey||'self'))===i?(st.personCoupons?.[st.groups[i].beneficiaryKey||'self']||undefined):undefined}:{}),beneficiaryKey:st.groups[i].beneficiaryKey||'self',items:s.items.map(item=>({...item,...(st.groups[i].quotedPrices?.[item.serviceId]!==undefined?{quotedListCents:st.groups[i].quotedPrices[item.serviceId]}:{})})),personalRateBps:(s.rechargePackageId||s.rechargeAmountCents!==undefined)?st.rvDraft.rateBps:undefined}))}
  function chosenRate(pkg,member){return pkg&&pkg.defaultPersonalDiscount&&pkg.defaultPersonalDiscount.rateBps!==null?pkg.defaultPersonalDiscount.rateBps:member.rateBps}
  function availableTypes(config,catalog,member){return types.filter(t=>!config?.active||config.settlementTypes.includes(t.key)&&(t.key!=='member'||(catalog?.eligible??member?.eligible)===true))}
  function syncTier(groups,catalog){const next=catalog.eligible?'member':'list';for(const g of groups){if(!g.tierChanged||g.tierKey==='member'&&!catalog.eligible)g.tierKey=next;g.tierDefault=next;g.tierChanged=g.tierKey!==next}}
  // Persist the exact business request until its outcome is known. Retrying never creates a second operation.
  const pendingKey=id=>'member-pricing-pending:'+id
  function pending(id){try{return typeof wx!=='undefined'?wx.getStorageSync(pendingKey(id))||null:JSON.parse(localStorage.getItem(pendingKey(id))||'null')}catch(e){return null}}
  function savePending(id,value){if(typeof wx!=='undefined'){if(value)wx.setStorageSync(pendingKey(id),value);else wx.removeStorageSync(pendingKey(id))}else if(value)localStorage.setItem(pendingKey(id),JSON.stringify(value));else localStorage.removeItem(pendingKey(id))}
  async function mutation(id,path,body,send,retry=false){
    const old=pending(id);if(old&&!retry)throw Error('上次提交结果尚未核实，请先查询或重试原操作。');
    const attempt=old||{path,body:{...body,operationId:body.operationId||operation()},createdAt:Date.now()};savePending(id,attempt)
    try{const result=await send(attempt.path,attempt.body);savePending(id,null);return result}catch(e){const status=Number(e.statusCode||e.status);if(old&&retry&&[401,403].includes(status))e.keepPending=true;if(status>=400&&status<500&&!e.keepPending)savePending(id,null);else e.message='提交结果待核实，请查询或重试原操作。'+(e.message||'');throw e}
  }
  // An expired login cannot establish the outcome of an earlier unknown booking write.
  function bookingMutation(id,path,body,send,retry=false){return mutation(id,path,body,async(u,b)=>{try{return await send(u,b)}catch(e){if(retry&&[401,403].includes(Number(e.statusCode||e.status)))e.keepPending=true;throw e}},retry)}
  return {pending,mutation,bookingMutation,syncTier,availableTypes,types,options,label,operation,retryKey,people,enrich,chosenRate}
})
