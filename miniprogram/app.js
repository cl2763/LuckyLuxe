const i18n = require('./utils/i18n')

App({
  globalData: {
    appName: 'Lucky Luxe',
    version: '0.1.0-demo',
    privacyResolve: null,
    privacyReady: false
  },

  onLaunch(options) {
    this.resolveTenant(options)
    i18n.applyTabBar()
    this.initPrivacyBridge()
  },

  onShow(options) {
    // 从别家店的码/分享再次进入时,更新"当前进的店"
    this.resolveTenant(options)
  },

  // 多租户:从进入参数解析"当前进的店"(query.tenantId / query.merchant / scene),存 storage 供 api 带上;
  // 没带就沿用上次进的店,再没有则默认 lucky-luxe。
  resolveTenant(options) {
    try {
      const q = (options && options.query) || {}
      let tid = String(q.tenantId || q.merchant || '').trim()
      if (!tid && q.scene) { const s = decodeURIComponent(q.scene); const m = /(?:^|&)t=([^&]+)/.exec(s); if (m) tid = m[1] }
      if (tid) {
        wx.setStorageSync('lucky_tenant', tid)
        this.globalData.tenantId = tid
      } else {
        this.globalData.tenantId = wx.getStorageSync('lucky_tenant') || 'lucky-luxe'
      }
    } catch (e) { this.globalData.tenantId = 'lucky-luxe' }
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
