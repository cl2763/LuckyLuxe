const api=require('../../utils/api')
const i18n=require('../../utils/i18n')
Page({
 data:{list:[],loading:true,error:'',loginRequired:false,en:false,unreadCount:0,detail:null},
 onShow(){this.load()},
 onHide(){this._request=(this._request||0)+1},
 async load(){
  const id=this._request=(this._request||0)+1,en=i18n.getLang()==='en'
  this.setData({en,loading:true,error:'',list:[],detail:null,loginRequired:!api.isLoggedIn()})
  if(!api.isLoggedIn()){this.setData({loading:false});return}
  const tenant=api.currentTenantId(),auth=api.getAuth()
  const current=()=>id===this._request&&tenant===api.currentTenantId()&&api.getAuth()?.accessToken===auth?.accessToken
  try{const r=await api.getMessages();if(current())this.setData({list:r.messages||[],unreadCount:r.unreadCount||0})}
  catch(e){if(current())this.setData({error:en?'Could not load messages. Please retry.':'消息加载失败，请重试。'})}
  finally{if(current())this.setData({loading:false})}
 },
 async open(e){
  const item=this.data.list.find(m=>m.id===e.currentTarget.dataset.id)
  if(!item||this._opening)return
  this._opening=true;const generation=this._request
  try{await api.readMessage(item.id);if(generation!==this._request)return
   const list=this.data.list.map(m=>m.id===item.id?{...m,readAt:m.readAt||new Date().toISOString()}:m)
   this.setData({list,detail:item,unreadCount:list.filter(m=>!m.readAt).length})
  }catch(e){if(generation===this._request)wx.showToast({title:this.data.en?'Please retry':'读取失败，请重试',icon:'none'})}
  finally{this._opening=false}
 },
 close(){this.setData({detail:null})},
 login(){require('../../utils/nav').tab('/pages/me/index')}
})
