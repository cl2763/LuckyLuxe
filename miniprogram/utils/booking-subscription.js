const api=require('./api')
function current(page,tenant,token){return !page._subscriptionHidden&&tenant===api.currentTenantId()&&token===api.getAuth()?.accessToken}
module.exports={
 async loadSubscription(id){
  this._subscriptionHidden=false
  const generation=this._subscriptionLoad=(this._subscriptionLoad||0)+1
  const tenant=api.currentTenantId(),token=api.getAuth()?.accessToken
  this.setData({subscription:null,subscriptionFeedback:''})
  if(!api.isLoggedIn())return
  try{const c=await api.subscriptionConfig(id);if(generation===this._subscriptionLoad&&current(this,tenant,token))this.setData({subscription:c})}
  catch(e){if(current(this,tenant,token))this.setData({subscriptionFeedback:'提醒设置暂不可用，预约不受影响。'})}
 },
 subscribeBooking(){
  const c=this.data.subscription
  if(!c?.enabled||this._subscribing)return
  this._subscribing=true
  const tenant=api.currentTenantId(),token=api.getAuth()?.accessToken
  // Directly invoked by the user's tap; no automatic permission prompt on page load.
  try{wx.requestSubscribeMessage({
   tmplIds:c.templates.map(t=>t.id),
   success:async result=>{
    if(!current(this,tenant,token)){this._subscribing=false;return}
    const results=Object.fromEntries(c.templates.filter(t=>['accept','reject','ban','filter'].includes(result[t.id])).map(t=>[t.id,result[t.id]]))
    try{
     await api.subscriptionConsent({requestId:c.requestId,results})
     if(current(this,tenant,token))this.setData({subscription:null,subscriptionFeedback:Object.values(results).includes('accept')?'已记录本次订阅选择。微信发送仍以可用订阅次数为准。':'未开启微信提醒，预约不受影响，可在订单中查看。'})
    }catch(e){if(current(this,tenant,token))this.setData({subscriptionFeedback:'订阅选择未保存，请刷新后重试；预约不受影响。'})}
    finally{this._subscribing=false}
   },
   fail:()=>{this._subscribing=false;if(current(this,tenant,token))this.setData({subscriptionFeedback:'未能打开微信订阅设置，预约不受影响，请稍后重试。'})}
  })}catch(e){this._subscribing=false;this.setData({subscriptionFeedback:'当前微信暂不支持订阅，请更新微信后重试。预约不受影响。'})}
 }
}
