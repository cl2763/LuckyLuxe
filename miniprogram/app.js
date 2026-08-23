const i18n = require('./utils/i18n')

App({
  globalData: {
    /* appName 已删(店主 08-23 收口件):全仓零使用方,却写死着旗舰店名 ——
       留着就是下次误用的种子。真要显示店名一律走当前租户的 /shops 那一行;
       平台名在 utils/i18n.js 的 appName(「有迹」)。 */
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
        const prev = wx.getStorageSync('lucky_tenant') || ''
        wx.setStorageSync('lucky_tenant', tid)
        this.globalData.tenantId = tid
        // D39:扫码/深链换店与选店页同一套清场;租户没变(常规重进)不清
        if (prev && prev !== tid) { try { require('./utils/api').onStoreSwitched() } catch (e) { /* 清场失败不阻塞启动 */ } }
      } else {
        // 租户唯一出口(店主 08-23 裁定):记忆 → 部署配置 → 空。空=去选店,不顶别人家的店
        this.globalData.tenantId = require('./utils/api').currentTenantId()
      }
    } catch (e) { this.globalData.tenantId = '' }
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
