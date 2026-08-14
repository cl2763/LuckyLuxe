/* 🔴 D17 失败态(店主 2026-08-11 书面标准,代 UI 图):
   主体区居中「加载失败,请检查网络后重试」+ 重试按钮,复用现有空态样式,
   **不做任何局部假数据** —— 接口挂了就如实说挂了,不许拿 mock 糊住顾客。 */
const { curOf, ensureCurrencyCached } = require('../../utils/storecurrency')
const i18n = require('../../utils/i18n')
const api = require('../../utils/api')
const tabbar = require('../../utils/tabbar')

Page({
  data: {
    activeType: 'nail',
    activeCategory: '热门推荐',
    lang: 'zh',
    t: i18n.pageCopy('services', 'zh'),
    categories: [],
    serviceList: [],
    loadFailed: false
  },

  onShow() {
    ensureCurrencyCached()
    this.setData({ cur: curOf() })   // 币种跟门店走,不写死币符

    tabbar.update(this, 1)
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
    const isCare = this.data.activeType === 'care'
    // mock-data 退场:这两组是**展示分组顺序常量**(非动态假数据),就地内联
    const NAIL_CATS = ['热门推荐', '法式系列', '轻奢设计', '日式款', '基础护理', '加项服务']
    const LASH_CATS = ['热门推荐', '自然款', '浓密款', '下睫毛', '卸除护理', '加项服务']
    const categoryKeys = this.data.activeType === 'nail' ? NAIL_CATS : LASH_CATS
    const categories = isCare ? [] : i18n.categories(categoryKeys, lang)
    let source
    try {
      source = await api.getServices(this.data.activeType, lang)
    } catch (e) {
      // D17:接口挂了如实报,不回 mock
      this.setData({ lang, t: i18n.pageCopy('services', lang), categories, serviceList: [], loadFailed: true })
      return
    }
    this.setData({ loadFailed: false })
    // 护理·其他:数量少,不分类,全部平铺
    const filtered = isCare ? source
      : source.filter((item) => this.data.activeCategory === '热门推荐' ? item.isRecommended : item.category === this.data.activeCategory)
    const serviceList = i18n.localizeServices(filtered.slice().sort((a, b) => a.sort - b.sort), lang)
    this.setData({ lang, t: i18n.pageCopy('services', lang), categories, serviceList })
  },

  goDetail(event) {
    wx.navigateTo({
      url: `/pages/service-detail/index?id=${event.currentTarget.dataset.id}`
    })
  }
})
