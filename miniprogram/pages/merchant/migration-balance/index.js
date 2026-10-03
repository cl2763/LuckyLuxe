const api = require('../../../utils/api')
const { storeMoney } = require('../../../utils/storeclock')
const tenant = () => wx.getStorageSync('lucky_tenant') || ''
const cents = raw => /^\d+(?:\.\d{1,2})?$/.test(String(raw).trim()) ? Math.round(Number(raw)*100) : NaN
Page({
 data:{info:null,loading:true,saving:false,error:'',paid:'',bonus:'',evidence:'',differenceReason:'',confirmed:[],agreements:{}},
 onLoad(q){this.userId=q.userId||'';this.pendingId=q.pendingId||'';this.tenantId=tenant();this.sequence=0},
 async onShow(){this.visible=true;if(await api.guardOwner())this.load()},
 onHide(){this.visible=false;this.sequence++},onUnload(){this.visible=false;this.sequence++},
 valid(seq){return this.visible&&seq===this.sequence&&tenant()===this.tenantId},
 base(){return '/admin/customers/'+encodeURIComponent(this.userId)+'/migration-balances/'+encodeURIComponent(this.pendingId)},
 async load(){
  if(!this.userId||!this.pendingId||tenant()!==this.tenantId){this.setData({info:null,loading:false,error:'顾客或门店已变化，请返回客户档案重新进入。'});return}
  const seq=++this.sequence;this.setData({loading:true,saving:false,error:''})
  try{const info=await api.adminGet(this.base());if(!this.valid(seq))return
   this.setData({info:{...info,snapshotText:storeMoney(info.snapshotAmountCents,2),paidText:info.confirmation?storeMoney(info.confirmation.paidCents,2):'',bonusText:info.confirmation?storeMoney(info.confirmation.bonusCents,2):''}})
  }catch(e){if(this.valid(seq))this.setData({error:e.message||'读取失败，请重试'})}finally{if(this.valid(seq))this.setData({loading:false})}
 },
 input(e){const key=e.currentTarget.dataset.key;if(['paid','bonus','evidence','differenceReason'].includes(key))this.setData({[key]:e.detail.value})},
 toggleCheck(e){if(this.data.saving)return;const key=e.currentTarget.dataset.key;if(!['noReliableCardBreakdown','unrestricted','noExpiry','sourceUseStopped'].includes(key))return;const agreements={...this.data.agreements,[key]:!this.data.agreements[key]};this.setData({agreements,confirmed:Object.keys(agreements).filter(k=>agreements[k])})},
 async save(){
  if(this.data.saving||this.data.loading||!this.data.info||this.data.info.confirmation||tenant()!==this.tenantId)return
  const paidCents=cents(this.data.paid),bonusCents=cents(this.data.bonus),flags=this.data.confirmed
  if(!Number.isSafeInteger(paidCents)||!Number.isSafeInteger(bonusCents)){this.setData({error:'请分别填写本金和赠送金，最多两位小数；无则填 0，未知不能按零启用。'});return}
  const payload={paidCents,bonusCents,evidence:this.data.evidence,differenceReason:this.data.differenceReason,mode:'unrestricted_aggregate',currency:this.data.info.currency,confirmVersion:this.data.info.version}
  for(const k of ['noReliableCardBreakdown','unrestricted','noExpiry','sourceUseStopped'])payload[k]=flags.includes(k)
  if(!payload.evidence.trim()||flags.length!==4){this.setData({error:'请填写核对依据并逐项确认规则；不符合的旧卡保持待核对。'});return}
  const fingerprint=JSON.stringify(payload)
  if(!this.attempt||this.attempt.fingerprint!==fingerprint)this.attempt={fingerprint,body:{...payload,cutoverAt:new Date().toISOString(),requestId:'mig_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)}}
  const seq=this.sequence;this.setData({saving:true,error:''})
  try{
   const answer=await new Promise((resolve,reject)=>wx.showModal({title:'确认启用旧余额',content:'本金 '+storeMoney(paidCents,2)+'，赠送金 '+storeMoney(bonusCents,2)+'。启用不立即核销，也不产生新的营业收入。',confirmText:'确认启用',success:resolve,fail:reject}))
   if(!answer.confirm||!this.valid(seq))return
   const result=await api.adminPost(this.base()+'/activate',this.attempt.body)
   if(!this.valid(seq))return
   wx.showToast({title:result.status==='exhausted'?'已核对为耗尽':'旧余额已启用',icon:'success'})
   await this.load()
  }catch(e){if(this.valid(seq))this.setData({error:e.message||'未能确认结果，请保留本页重试；相同请求不会重复入账。'})}finally{if(this.valid(seq))this.setData({saving:false})}
 }
})
