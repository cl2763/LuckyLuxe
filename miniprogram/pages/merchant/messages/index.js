const api=require('../../../utils/api')
Page({
 data:{loading:true,error:'',messages:[],unreadCount:0,scopeText:'',detail:null},
 onShow(){if(api.guardMerchant())this.load()},
 onHide(){this._load=(this._load||0)+1},
 onUnload(){this._load=(this._load||0)+1},
 async load(){
  const id=this._load=(this._load||0)+1
  this.setData({loading:true,error:'',detail:null})
  try{const r=await api.adminGet('/admin/messages');if(id===this._load)this.setData(r)}
  catch(e){if(id===this._load)this.setData({error:e.message||'消息加载失败，请重试。'})}
  finally{if(id===this._load)this.setData({loading:false})}
 },
 async open(e){
  if(this._opening)return
  const item=this.data.messages.find(m=>m.id===e.currentTarget.dataset.id)
  if(!item)return
  this._opening=true
  const generation=this._load
  try{
   await api.adminPost('/admin/messages/'+encodeURIComponent(item.id)+'/read',{})
   if(generation!==this._load)return
   const result=await api.adminGet('/admin/messages')
   if(generation===this._load)this.setData({...result,detail:result.messages.find(m=>m.id===item.id)||item})
  }catch(e){if(generation===this._load)this.setData({error:e.message||'读取消息失败，请重试。'})}
  finally{this._opening=false}
 },
 booking(){const id=this.data.detail?.bookingId;if(id)require('../../../utils/nav').to('/pages/merchant/orders/index?bookingId='+encodeURIComponent(id))},
 close(){this.setData({detail:null})}
})
