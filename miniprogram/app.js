const i18n = require('./utils/i18n')
const theme = require('./utils/theme')

/* ══ 裁 #25 之一(店主 05x §二)· 主题**挂在一处公共入口**,不许 67 个页面各写一遍 ══
 *
 * 上一批量出来:全仓 67 个页面**只有 2 个**挂了主题类,其余切档纹丝不动。
 * 店主裁:「逐页挂 = 必漏,这就是现在 2/67 的由来 —— 要挂在一处公共入口。」
 *
 * 小程序没有「页面基类」这种东西,但 `Page` 就是一个全局函数 —— 在 app.js 里**把它包一层**,
 * 之后每个页面注册时自动获得:
 *   ① `data.themeClass` 初值(页面第一帧就是对的档,不闪)
 *   ② `onShow` 时重新取一次(从「我的」改完档位返回,立刻跟着变)
 *   ③ 顺手把**原生导航栏**也设成这一档(WXSS 管不到它,见 utils/theme.js 抬头)
 * 页面自己一行都不用写。已经自己写了的那两页(商家首页 / 商家「我的」)也不冲突:
 * 它们 setData 的是同一个字段、同一个出口算出来的值。
 *
 * ⚠️ 必须在 `App({})` 之前包好:小程序先跑 app.js,再跑各页面的 js(注册 Page 就发生在那时)。
 */
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
    } catch (e) { console.warn('[theme] 套档位失败', e && e.message) }
    return userOnShow ? userOnShow.apply(this, args) : undefined
  }
  return rawPage(opts)
}

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
