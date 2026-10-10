const api=require('../../utils/api')
const i18n=require('../../utils/i18n')
Page({
 data:{list:[],loading:true,error:'',loginRequired:false,en:false},
 onShow(){this.load()},
 onHide(){this._request=(this._request||0)+1},
 async load(){
  const id=this._request=(this._request||0)+1,en=i18n.getLang()==='en'
  this.setData({en,loading:true,error:'',list:[],loginRequired:!api.isLoggedIn()})
  if(!api.isLoggedIn()){this.setData({loading:false});return}
  const tenant=api.currentTenantId(),auth=api.getAuth()
  const current=()=>id===this._request&&tenant===api.currentTenantId()&&api.getAuth()?.accessToken===auth?.accessToken
  try{const r=await api.getMessages();if(current())this.setData({list:r.messages||[]})}
  catch(e){if(current())this.setData({error:en?'Could not load messages. Please retry.':'消息加载失败，请重试。'})}
  finally{if(current())this.setData({loading:false})}
 },
 login(){require('../../utils/nav').tab('/pages/me/index')}
})
