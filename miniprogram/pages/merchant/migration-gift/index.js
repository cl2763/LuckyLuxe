const api = require('../../../utils/api')
const { storeMoney } = require('../../../utils/storeclock')
const tenant = () => wx.getStorageSync('lucky_tenant') || ''
Page({
 data:{info:null,loading:true,saving:false,error:'',title:'',specification:'',quantity:'',unitValue:'',expiresOn:'',reason:'',agreements:{},operation:'claim',claimIndex:0,claims:[]},
 onLoad(q){this.userId=q.userId||'';this.assetId=q.assetId||'';this.tenantId=tenant();this.sequence=0},
 async onShow(){this.visible=true;if(await api.guardOwner())this.load()},
 onHide(){this.visible=false;this.sequence++},onUnload(){this.visible=false;this.sequence++},
 valid(seq){return this.visible&&seq===this.sequence&&tenant()===this.tenantId},
 base(){return '/admin/customers/'+encodeURIComponent(this.userId)+'/migration-gifts/'+encodeURIComponent(this.assetId)},
 async load(){
  if(!this.userId||!this.assetId||tenant()!==this.tenantId){this.setData({info:null,claims:[],loading:false,error:'顾客或门店已变化，请返回客户档案重新进入。'});return}
  const seq=++this.sequence;this.setData({loading:true,saving:false,error:''})
  try{const info=await api.adminGet(this.base());if(!this.valid(seq))return
   const claims=info.events.filter(e=>e.kind==='claim'&&e.returnable>0).map(e=>({...e,label:e.created_at+' · 可退 '+e.returnable+' 件'}))
   this.setData({info,claims,claimIndex:0,sourceText:JSON.stringify(info.sourceDetails,null,2),title:this.data.title||info.sourceTitle||'',operation:info.grant&&info.grant.status!=='available'?'return':'claim',valueText:info.grant?storeMoney(info.grant.unitValueCents,2):''})
  }catch(e){if(this.valid(seq))this.setData({error:e.message||'读取失败，请重试'})}finally{if(this.valid(seq))this.setData({loading:false})}
 },
 clearExpiry(){if(!this.data.saving)this.setData({expiresOn:''})},
 input(e){if(this.data.saving)return;const key=e.currentTarget.dataset.key;if(['title','specification','quantity','unitValue','expiresOn','reason'].includes(key))this.setData({[key]:e.detail.value})},
 check(e){if(this.data.saving)return;const key=e.currentTarget.dataset.key;if(!['noExpiry','physicalGoodsConfirmed','rulesConfirmed','sourceUseStopped'].includes(key))return;this.setData({agreements:{...this.data.agreements,[key]:!this.data.agreements[key]}})},
 operation(e){if(!this.data.saving)this.setData({operation:e.currentTarget.dataset.kind})},
 claim(e){if(!this.data.saving)this.setData({claimIndex:Number(e.detail.value)})},
 async save(){
  if(this.data.saving||this.data.loading||!this.data.info||tenant()!==this.tenantId)return
  const d=this.data,kind=d.info.grant?d.operation:'activate',quantity=/^\d+$/.test(d.quantity.trim())?Number(d.quantity):NaN
  if(!Number.isSafeInteger(quantity)||quantity<0||quantity>100000||(kind!=='activate'&&!quantity)||!d.reason.trim()){this.setData({error:'请填写整数件数及核对、收货或退回依据。领取和退回须大于零。'});return}
  const payload={quantity,reason:d.reason.trim()}
  if(kind==='activate'){
   const unitValueCents=/^\d+(?:\.\d{1,2})?$/.test(d.unitValue.trim())?Math.round(Number(d.unitValue)*100):NaN
   if(!d.title.trim()||!Number.isSafeInteger(unitValueCents)||!d.agreements.physicalGoodsConfirmed||!d.agreements.rulesConfirmed||!d.agreements.sourceUseStopped){this.setData({error:'请填写赠品名称、单件价值并确认三项规则。服务赠卡不能按实物领取。'});return}
   Object.assign(payload,{title:d.title.trim(),specification:d.specification,unitValueCents,expiresOn:d.expiresOn,...d.agreements,confirmVersion:d.info.version})
  }else if(kind==='return'){
   const claim=d.claims[d.claimIndex];if(!claim){this.setData({error:'没有可退回的原领取记录。'});return}payload.claimId=claim.id
  }
  const fingerprint=kind+JSON.stringify(payload)
  if(!this.attempt||this.attempt.fingerprint!==fingerprint)this.attempt={fingerprint,body:{...payload,requestId:'gift_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)}}
  const seq=this.sequence;this.setData({saving:true,error:''})
  try{
   const verb=kind==='activate'?'启用':kind==='claim'?'领取':'退回'
   const answer=await new Promise((resolve,reject)=>wx.showModal({title:'确认'+verb+'赠品',content:verb+' '+quantity+' 件。此操作只记录实物件数，不增加现金余额或营业收入。',confirmText:'确认'+verb,success:resolve,fail:reject}))
   if(!answer.confirm||!this.valid(seq))return
   const result=await api.adminPost(this.base()+'/'+kind,this.attempt.body)
   if(!this.valid(seq))return
   this.setData({receipt:'已'+verb+'，剩余 '+result.remaining+' 件。',quantity:'',reason:''});this.attempt=null
   wx.showToast({title:'已'+verb,icon:'success'});await this.load()
  }catch(e){if(this.valid(seq))this.setData({error:e.message||'结果未确认，请保留本页重试；相同请求不会重复扣减。'})}finally{if(this.valid(seq))this.setData({saving:false})}
 }
})
