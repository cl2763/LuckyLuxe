module.exports={
  ...require('./booking-subscription'),
  async offerSubscription() {
    await this.loadSubscription('')
    if(this.data.subscription?.enabled)this.setData({subscriptionWelcome:true})
  },
  onHide() { this._subscriptionHidden=true; this.setData({subscriptionWelcome:false}) },
  closeSubscriptionWelcome() { this.setData({subscriptionWelcome:false}) },
}
