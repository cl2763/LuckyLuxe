const api=require('./api')
function key(){const a=api.getAuth(),id=a?.user?.id||a?.userId;return id?'subscription-welcome:'+api.currentTenantId()+':'+id:''}
module.exports={
  ...require('./booking-subscription'),
  async offerSubscription() {
    const k=key();if(!k||wx.getStorageSync(k))return
    await this.openSubscriptionSettings()
    if(this.data.subscriptionWelcome&&key()===k)wx.setStorageSync(k,true)
  },
  async openSubscriptionSettings() {
    await this.loadSubscription('')
    if(this.data.subscription?.enabled)this.setData({subscriptionWelcome:true})
  },
  onHide() { this._subscriptionHidden=true; this.setData({subscriptionWelcome:false}) },
  closeSubscriptionWelcome() { this.setData({subscriptionWelcome:false}) },
}
