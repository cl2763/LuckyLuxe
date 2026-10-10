const i18n = require('./utils/i18n')
const theme = require('./utils/theme')


const rawPage = Page
Page = function (options) {
  const opts = options || {}
  const userOnShow = opts.onShow
  opts.data = Object.assign({ themeClass: theme.themeClass() }, opts.data || {})
  opts.onShow = function pageOnShowWithTheme(...args) {
    try {
      const cls = theme.themeClass()
      if (this.data.themeClass !== cls) this.setData({ themeClass: cls })
      theme.applyChrome()
      if (opts.onShareAppMessage && wx.showShareMenu) wx.showShareMenu({ menus: opts.onShareTimeline ? ['shareAppMessage', 'shareTimeline'] : ['shareAppMessage'] })
    } catch (e) { console.warn('[theme] 套档位失败', e && e.message) }
    return userOnShow ? userOnShow.apply(this, args) : undefined
  }
  return rawPage(opts)
}

App({
  globalData: {

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
        if (prev && prev !== tid) { try { require('./utils/api').onStoreSwitched() } catch (e) {  } }
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
        const pages = getCurrentPages()
        const page = pages[pages.length - 1]
        if (page && page.showMediaPrivacy) page.showMediaPrivacy()
      })
    }
  },

  resolvePrivacyAuthorization(buttonId = 'lucky-luxe-login') {
    if (this.globalData.privacyResolve) {
      this.globalData.privacyResolve({ event: 'agree', buttonId })
      this.globalData.privacyResolve = null
    }
    this.globalData.privacyReady = true
  }
})
