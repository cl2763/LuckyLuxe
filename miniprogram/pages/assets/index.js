const i18n = require('../../utils/i18n')

Page({
  data: {
    member: {},
    lang: 'zh',
    t: i18n.pageCopy('assets', 'zh')
  },

  onShow() {
    const lang = i18n.getLang()
    i18n.applyTabBar(lang)
    i18n.setTitle(i18n.pageCopy('assets', lang).title)
    this.setData({ member: wx.getStorageSync('lucky_member') || {}, lang, t: i18n.pageCopy('assets', lang) })
  }
})
