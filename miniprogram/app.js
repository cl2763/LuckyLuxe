const i18n = require('./utils/i18n')

App({
  globalData: {
    appName: 'Lucky Luxe',
    version: '0.1.0-demo',
    privacyResolve: null,
    privacyReady: false
  },

  onLaunch() {
    i18n.applyTabBar()
    this.initPrivacyBridge()
  },

  initPrivacyBridge() {
    if (wx.getPrivacySetting) {
      wx.getPrivacySetting({
        success: (res) => {
          console.log('[LuckyLuxe][privacy] getPrivacySetting', res)
          this.globalData.privacyReady = !res.needAuthorization
        },
        fail: (error) => {
          console.warn('[LuckyLuxe][privacy] getPrivacySetting failed', error)
        }
      })
    }

    if (wx.onNeedPrivacyAuthorization) {
      wx.onNeedPrivacyAuthorization((resolve, eventInfo) => {
        console.log('[LuckyLuxe][privacy] onNeedPrivacyAuthorization', eventInfo)
        this.globalData.privacyResolve = resolve
      })
    }
  },

  resolvePrivacyAuthorization() {
    if (this.globalData.privacyResolve) {
      this.globalData.privacyResolve({ event: 'agree', buttonId: 'lucky-luxe-login' })
      this.globalData.privacyResolve = null
    }
    this.globalData.privacyReady = true
  }
})
