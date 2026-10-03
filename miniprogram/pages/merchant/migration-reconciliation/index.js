const api=require('../../../utils/api')
const {storeMoney}=require('../../../utils/storeclock')
const tenant=()=>wx.getStorageSync('lucky_tenant')||''
const cents=v=>/^\d+(?:\.\d{1,2})?$/.test(String(v).trim())?Math.round(Number(v)*100):NaN
Page({
 data:{loading:true,saving:false,error:'',info:null,cards:[],services:[],kinds:['待核对','付费次数卡','储值卡'],result:null,evidence:'',agreements:{},receipt:null},
 onLoad(q){this.userId=q.userId||'';this.pendingId=q.pendingId||'';this.tenantId=tenant();this.sequence=0},
 async onShow(){this.visible=true;if(await api.guardOwner())this.load()},
 onHide(){this.visible=false;this.sequence++},onUnload(){this.visible=false;this.sequence++},
 valid(seq){return this.visible&&seq===this.sequence&&tenant()===this.tenantId},
 base(){return '/admin/customers/'+encodeURIComponent(this.userId)+'/migration-balances/'+encodeURIComponent(this.pendingId)+'/reconciliation'},
 async load(){
  if(tenant()!==this.tenantId||!this.userId||!this.pendingId){this.setData({info:null,cards:[],result:null,loading:false,error:'门店或顾客已变化，请返回重新进入。'});return}
  this.reviewed=null;this.setData({receipt:null,agreements:{},evidence:''});const seq=++this.sequence;this.setData({loading:true,saving:false,error:''})
  try{const [info,catalog]=await Promise.all([api.adminGet(this.base()),api.adminGet('/admin/pricing/items')]);if(!this.valid(seq))return
   this.setData({info,amountText:storeMoney(info.snapshotAmountCents,2),cards:info.cards.map(c=>({...c,kindIndex:0,paid:'',bonus:'',times:'',serviceIndex:0,expiresOn:'',noExpiry:false})),services:[{id:'',nameZh:'请选择服务'},...(catalog.items||[]).filter(s=>s.isActive!==false&&(s.itemKind||'main')==='main')],result:null})
  }catch(e){if(this.valid(seq))this.setData({error:e.message||'读取失败'})}finally{if(this.valid(seq))this.setData({loading:false})}
 },
 input(e){if(this.data.saving)return;const i=Number(e.currentTarget.dataset.index),key=e.currentTarget.dataset.key;if(!this.data.cards[i]||!['kindIndex','serviceIndex','paid','bonus','times','expiresOn'].includes(key))return;const cards=this.data.cards.map((c,j)=>j===i?{...c,[key]:key.endsWith('Index')?Number(e.detail.value):e.detail.value}:c);this.setData({cards,result:null})},
 expiry(e){if(this.data.saving)return;const i=Number(e.currentTarget.dataset.index);this.setData({cards:this.data.cards.map((c,j)=>j===i?{...c,noExpiry:!c.noExpiry}:c),result:null})},
 clearDate(e){if(this.data.saving)return;const i=Number(e.currentTarget.dataset.index);this.setData({cards:this.data.cards.map((c,j)=>j===i?{...c,expiresOn:''}:c),result:null})},
 async calculate(){
  if(this.data.loading||this.data.saving||!this.data.info||tenant()!==this.tenantId)return
  const seq=this.sequence;this.setData({saving:true,error:'',result:null})
  try{const cards=this.data.cards.map(c=>{const kind=['unresolved','paid_timecard','stored_value'][c.kindIndex];if(kind==='unresolved')return{assetId:c.id,kind}
    const paidCents=cents(c.paid),bonusCents=cents(c.bonus);if(!Number.isSafeInteger(paidCents)||!Number.isSafeInteger(bonusCents))throw Error('本金和赠送金请明确填写，未知保持待核对。')
    if(kind==='paid_timecard'&&!/^\d+$/.test(c.times))throw Error('剩余次数须为非负整数。')
    return{assetId:c.id,kind,paidCents,bonusCents,remainingTimes:Number(c.times),serviceId:this.data.services[c.serviceIndex]?.id||'',expiresOn:c.expiresOn,noExpiry:c.noExpiry}
   })
   const result=await api.adminPost(this.base(),{cards,currency:this.data.info.currency,confirmVersion:this.data.info.version})
   if(this.valid(seq)){
    this.reviewed={cards,currency:this.data.info.currency,confirmVersion:this.data.info.version}
    const eligible=result.balanced&&!this.data.info.alreadyPosted&&cards.length>0&&cards.every(c=>c.kind==='paid_timecard'&&c.bonusCents===0&&c.remainingTimes>0&&c.paidCents>0&&c.paidCents%c.remainingTimes===0)
    this.setData({agreements:{},result:{...result,eligible,paidText:storeMoney(result.paidCents,2),bonusText:storeMoney(result.bonusCents,2),differenceText:storeMoney(result.differenceCents,2)}})}
  }catch(e){if(this.valid(seq))this.setData({error:e.message||'计算失败'})}finally{if(this.valid(seq))this.setData({saving:false})}
 },
 evidenceInput(e){if(!this.data.saving)this.setData({evidence:e.detail.value})},
 agree(e){if(this.data.saving)return;const key=e.currentTarget.dataset.key;if(!['sourceUseStopped','allBalanceAllocated','equalPerUsePrincipal'].includes(key))return;this.setData({agreements:{...this.data.agreements,[key]:!this.data.agreements[key]}})},
 async activate(){
  if(this.data.saving||this.data.loading||this.data.receipt||!this.data.result?.eligible||!this.reviewed||!this.valid(this.sequence))return
  const flags=this.data.agreements,evidence=this.data.evidence.trim()
  if(!evidence||!flags.sourceUseStopped||!flags.allBalanceAllocated||!flags.equalPerUsePrincipal){this.setData({error:'请填写核对依据并逐项确认。'});return}
  const payload={...this.reviewed,...flags,evidence},fingerprint=JSON.stringify(payload)
  if(!this.attempt||this.attempt.fingerprint!==fingerprint)this.attempt={fingerprint,body:{...payload,requestId:'migt_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2),cutoverAt:new Date().toISOString()}}
  const seq=this.sequence;this.setData({saving:true,error:''})
  try{
   const answer=await new Promise((resolve,reject)=>wx.showModal({title:'确认启用次数卡',content:'共 '+payload.cards.length+' 张。启用不增加储值余额，不立即核销或产生营业收入。',confirmText:'确认启用',success:resolve,fail:reject}))
   if(!answer.confirm||!this.valid(seq))return
   const receipt=await api.adminPost(this.base().replace(/reconciliation$/,'activate-timecards'),this.attempt.body)
   if(!this.valid(seq))return
   this.setData({receipt,result:null});wx.showToast({title:'次数卡已启用',icon:'success'})
  }catch(e){if(this.valid(seq))this.setData({error:e.message||'未能确认结果，请保留本页重试；相同请求不会重复启用。'})}finally{if(this.valid(seq))this.setData({saving:false})}
 }
})
