const api=require('../../utils/api')
Component({
 properties:{userId:{type:String,value:'',observer(){if(this._ready)this.refresh()}}},
 data:{state:'loading',error:'',busy:false,ticket:null,codeError:false},
 lifetimes:{attached(){this._ready=true;this.refresh()},detached(){this._ready=false;clearTimeout(this._timer)}},
 pageLifetimes:{show(){this._visible=true;if(this._ready)this.refresh()},hide(){this._visible=false;clearTimeout(this._timer)}},
 methods:{
  schedule(){clearTimeout(this._timer);if(this._ready&&this._visible!==false&&this.data.ticket)this._timer=setTimeout(()=>this.refresh(),4000)},
  async refresh(){
   const id=this.data.userId;if(!id)return
   try{const r=await api.adminGet('/admin/customers/lookup?userId='+encodeURIComponent(id));if(!this._ready||id!==this.data.userId)return;if(!r.hit)throw Error(r.reason||'无法读取绑定状态');const bound=r.hit.bound;this.setData({state:bound?'bound':'unbound',error:''});if(bound){this.setData({ticket:null});clearTimeout(this._timer)}else if(this.data.ticket&&Date.parse(this.data.ticket.expiresAt)<=Date.now())this.setData({ticket:null,error:'绑定码已过期，请重新出示。'})}
   catch(e){if(this._ready)this.setData({state:'error',error:e.message||'读取失败，请重试。'})}finally{this.schedule()}
  },
  async generate(){
   if(this.data.busy||this.data.state!=='unbound')return
   this.setData({busy:true,error:''});clearTimeout(this._timer)
   try{const r=await api.adminPost('/admin/customers/'+encodeURIComponent(this.data.userId)+'/bind-token',{});if(!this._ready)return;this.setData({ticket:{expiresAt:r.expiresAt,miniCodeUrl:r.miniCodePath?api.miniCodeUrl(r.miniCodePath):''},codeError:false})}
   catch(e){if(this._ready)this.setData({error:e.message||'生成失败，请重试。'});if(e.code==='ALREADY_BOUND')await this.refresh()}
   finally{if(this._ready)this.setData({busy:false});this.schedule()}
  },
  imageError(){this.setData({codeError:true,error:'小程序码加载失败，请重新出示或联系平台。'})}
 }
})
