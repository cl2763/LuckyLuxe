const mock = require('../../utils/mock-data')
const i18n = require('../../utils/i18n')

Page({
  data: {
    store: mock.store,
    lang: 'zh',
    t: i18n.pageCopy('store', 'zh')
  },

  onShow() {
    const lang = i18n.getLang()
    const t = i18n.pageCopy('store', lang)
    i18n.applyTabBar(lang)
    i18n.setTitle(t.title)
    this.setData({ lang, t, store: i18n.localizeStore(mock.store, lang) })
  },

  copyAddress() {
    wx.setClipboardData({
      data: this.data.store.address,
      success: () => wx.showToast({ title: this.data.t.copied, icon: 'success' })
    })
  },

  callStore() {
    wx.showToast({ title: this.data.t.phoneMissing, icon: 'none' })
  },

  openLocation() {
    wx.showToast({ title: this.data.t.addressMissing, icon: 'none' })
  }
})
