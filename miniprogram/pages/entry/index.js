const api = require('../../utils/api')

Page({
  enterStore() {
    wx.switchTab({ url: '/pages/home/index' })
  },
  toMerchantLogin() {
    // 已登录(保持登录有效)直接进首页,避免"登录页→onShow 再跳"两次路由打架导致白屏
    if (api.isAdminLoggedIn()) {
      wx.reLaunch({ url: '/pages/merchant/home/index' })
    } else {
      wx.navigateTo({ url: '/pages/merchant-login/index' })
    }
  }
})
