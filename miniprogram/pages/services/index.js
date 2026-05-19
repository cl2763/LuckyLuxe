const mock = require('../../utils/mock-data')
const i18n = require('../../utils/i18n')
const api = require('../../utils/api')

Page({
  data: {
    activeType: 'nail',
    activeCategory: '热门推荐',
    lang: 'zh',
    t: i18n.pageCopy('services', 'zh'),
    categories: [],
    serviceList: []
  },

  onShow() {
    const lang = i18n.getLang()
    i18n.applyTabBar(lang)
    i18n.setTitle(i18n.pageCopy('services', lang).title)
    const cachedType = wx.getStorageSync('lucky_service_type')
    if (cachedType) {
      wx.removeStorageSync('lucky_service_type')
      this.setData({ activeType: cachedType, activeCategory: '热门推荐' })
    }
    this.setData({ lang, t: i18n.pageCopy('services', lang) })
    this.refresh()
  },

  switchType(event) {
    this.setData({
      activeType: event.currentTarget.dataset.type,
      activeCategory: '热门推荐'
    })
    this.refresh()
  },

  switchCategory(event) {
    this.setData({ activeCategory: event.currentTarget.dataset.category })
    this.refresh()
  },

  async refresh() {
    const lang = i18n.getLang()
    const categoryKeys = this.data.activeType === 'nail' ? mock.nailCategories : mock.lashCategories
    const categories = i18n.categories(categoryKeys, lang)
    const source = await api.getServices(this.data.activeType, lang)
    const serviceList = i18n.localizeServices(source
      .filter((item) => this.data.activeCategory === '热门推荐' ? item.isRecommended : item.category === this.data.activeCategory)
      .sort((a, b) => a.sort - b.sort), lang)
    this.setData({ lang, t: i18n.pageCopy('services', lang), categories, serviceList })
  },

  goDetail(event) {
    wx.navigateTo({
      url: `/pages/service-detail/index?id=${event.currentTarget.dataset.id}`
    })
  }
})
