// Template identifiers/field keys confirmed from the owner's WeChat console, 2026-10-12.
export const SUBSCRIBE_TEMPLATES = Object.freeze({
 arrival_reminder:{id:'JoWvz9_dqGf8dULAgRHJUz8JxsBwKkJF_A5dmfkiTwE',fields:{store:'thing8',service:'thing7',time:'time2',address:'thing4',notice:'thing9'}},
 booking_status:{id:'eEbhsKqygu_7iCx2_jz9bcQrHQ5McJybT-skDL1TopU',fields:{store:'thing66',service:'thing13',time:'date3',status:'phrase14',notice:'thing8'}}
})
export function subscriptionPayload({kind,event,openid,tenantId,bookingId,store,service,date,time,address}) {
 const spec=SUBSCRIBE_TEMPLATES[kind]
 if(!spec || !openid || !tenantId || !bookingId)throw Error('SUBSCRIBE_INVALID_TARGET')
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}/.test(time))throw Error('SUBSCRIBE_INVALID_TIME')
 const thing=v=>{const s=String(v||'').trim();if(!s)throw Error('SUBSCRIBE_MISSING_FIELD');return Array.from(s).slice(0,20).join('')}
 const status={booking_created:'已确认',booking_rescheduled:'已改期',booking_cancelled:'已取消'}[event]
 if(kind==='booking_status'&&!status)throw Error('SUBSCRIBE_INVALID_EVENT')
 // date3 carries the date; the separate note preserves the appointment's local time.
 const values={store:thing(store),service:thing(service),time:kind==='arrival_reminder'?date+' '+time.slice(0,5):date,
  address:kind==='arrival_reminder'?thing(address):undefined,status,
  notice:kind==='arrival_reminder'?'请按预约时间到店，详情见订单':thing('预约时间 '+time.slice(0,5)+'，详情见订单')}
 return {touser:openid,template_id:spec.id,page:'pages/order-detail/index?tenantId='+encodeURIComponent(tenantId)+'&id='+encodeURIComponent(bookingId),
  miniprogram_state:'formal',lang:'zh_CN',data:Object.fromEntries(Object.entries(spec.fields).map(([key,field])=>[field,{value:values[key]}]))}
}
export function createSubscribeSender({appid,secret,miniprogramState='formal',fetcher=fetch}) {
 if(!['formal','trial','developer'].includes(miniprogramState))throw Error('SUBSCRIBE_INVALID_ENVIRONMENT')
 let cached=null
 return async payload=>{
  if(!appid||!secret)throw Error('SUBSCRIBE_NOT_CONFIGURED')
  if(!cached||cached.expires<Date.now()){
   const q=new URLSearchParams({grant_type:'client_credential',appid,secret})
   const r=await fetcher('https://api.weixin.qq.com/cgi-bin/token?'+q,{signal:AbortSignal.timeout(8000)})
   const b=await r.json()
   if(!r.ok||b.errcode||!b.access_token||!Number.isFinite(b.expires_in))throw Error('SUBSCRIBE_TOKEN_FAILED_'+(b.errcode||r.status))
   cached={value:b.access_token,expires:Date.now()+Math.max(0,b.expires_in-120)*1000}
  }
  // Do not auto-retry a timed-out send: the remote side may already have delivered it.
  const r=await fetcher('https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token='+encodeURIComponent(cached.value),{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...payload,miniprogram_state:miniprogramState}),signal:AbortSignal.timeout(10000)})
  const b=await r.json()
  if(!r.ok||b.errcode!==0)throw Error('SUBSCRIBE_SEND_FAILED_'+(b.errcode||r.status))
  return {ok:true}
 }
}
