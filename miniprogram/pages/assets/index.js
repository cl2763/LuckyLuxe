const i18n = require('../../utils/i18n')
const { curOf, ensureCurrencyCached } = require('../../utils/storecurrency')

Page({
  data: {
    member: {},
    lang: 'zh',
    t: i18n.pageCopy('assets', 'zh')
  },

  onShow() {
    const api = require('../../utils/api')
    if (api.isLoggedIn && api.isLoggedIn()) {
      api.myBalance().then((b) => this.setData({ liveBalance: b.yuan })).catch(() => {})
    }
    ensureCurrencyCached()
    this.setData({ cur: curOf() })   // 币种跟门店走,不写死币符

    const lang = i18n.getLang()
    i18n.applyTabBar(lang)
    i18n.setTitle(i18n.pageCopy('assets', lang).title)
    this.setData({ member: wx.getStorageSync('lucky_member') || {}, lang, t: i18n.pageCopy('assets', lang) })
  }
})
