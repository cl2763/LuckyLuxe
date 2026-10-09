const policy = require('../../utils/privacy-policy')

Page({
  data: { policy },
  onLoad() { wx.setNavigationBarTitle({ title: policy.title, fail: () => {} }) },
  callPrivacy() {
    wx.makePhoneCall({ phoneNumber: policy.phone.replace(/[^+\d]/g, ''),
      fail: () => wx.showToast({ title: '可按页面电话联系平台', icon: 'none' }) })
  },
  openWechatPolicy() {
    if (!wx.openPrivacyContract) {
      wx.showToast({ title: '请在微信小程序设置中查看隐私指引', icon: 'none' }); return
    }
    wx.openPrivacyContract({ fail: () => wx.showToast({ title: '微信指引暂时无法打开，请稍后重试', icon: 'none' }) })
  }
})
