const mock = require('../../utils/mock-data')
const i18n = require('../../utils/i18n')
const api = require('../../utils/api')

Page({
  data: {
    lang: 'zh',
    t: i18n.pageCopy('home', 'zh'),
    store: mock.store,
    recommendedNail: [],
    recommendedLash: []
  },

  onLoad() {
    this.refreshLanguage()
  },

  onShow() {
    this.refreshLanguage()
  },

  async refreshLanguage() {
    const lang = i18n.getLang()
    i18n.applyTabBar(lang)
    i18n.setTitle('Lucky Luxe')
    const nailServices = await api.getServices('nail', lang)
    const lashServices = await api.getServices('lash', lang)
    this.setData({
      lang,
      t: i18n.pageCopy('home', lang),
      store: i18n.localizeStore(mock.store, lang),
      recommendedNail: i18n.localizeServices(nailServices.filter((item) => item.isRecommended), lang),
      recommendedLash: i18n.localizeServices(lashServices.filter((item) => item.isRecommended), lang)
    })
  },

  switchLanguage(event) {
    const lang = event.currentTarget.dataset.lang
    i18n.setLang(lang)
    this.refreshLanguage()
  },

  goServices(event) {
    const type = event.currentTarget.dataset.type || 'nail'
    wx.setStorageSync('lucky_service_type', type)
    wx.switchTab({ url: '/pages/services/index' })
  },

  goDetail(event) {
    wx.navigateTo({
      url: `/pages/service-detail/index?id=${event.currentTarget.dataset.id}`
    })
  },

  goStore() {
    wx.navigateTo({ url: '/pages/store-location/index' })
  },

  goMe() {
    wx.switchTab({ url: '/pages/me/index' })
  }
})
