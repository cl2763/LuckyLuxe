const mock = require('../../utils/mock-data')
const i18n = require('../../utils/i18n')
const api = require('../../utils/api')
const storage = require('../../utils/storage')
const tabbar = require('../../utils/tabbar')

Page({
  data: {
    lang: 'zh',
    t: i18n.pageCopy('home', 'zh'),
    store: mock.store,
    heroSlides: [],
    activeHero: 0,
    portfolioIntro: '',
    technicianWorks: '',
    recommendedNail: [],
    recommendedLash: []
  },

  onLoad() {
    this.refreshLanguage()
  },

  onShow() {
    tabbar.update(this, 0)
    this.refreshLanguage()
  },

  async refreshLanguage() {
    const lang = i18n.getLang()
    i18n.applyTabBar(lang)
    storage.syncCartBadge()
    tabbar.update(this, 0)
    i18n.setTitle('Lucky Luxe')
    const nailServices = await api.getServices('nail', lang)
    const lashServices = await api.getServices('lash', lang)
    const stores = await api.getStores()
    this.setData({
      lang,
      t: i18n.pageCopy('home', lang),
      store: i18n.localizeStore(stores[0] || mock.store, lang),
      heroSlides: [
        { image: '/assets/images/hero-carousel-interior.jpg', label: lang === 'en' ? 'Lucky Luxe studio mood' : 'Lucky Luxe 店内氛围' },
        { image: '/assets/images/hero-carousel-nail.jpg', label: lang === 'en' ? 'Premium nail detail' : '精致美甲细节' },
        { image: '/assets/images/hero-carousel-lash.jpg', label: lang === 'en' ? 'Lash service detail' : '美睫服务细节' }
      ],
      technicianWorks: lang === 'en' ? 'Artist Work' : '技师作品',
      portfolioIntro: lang === 'en' ? 'Browse approved finished work by each artist.' : '浏览每位技师已确认入库的真实作品。',
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

  goPortfolio() {
    wx.navigateTo({ url: '/pages/portfolio/index' })
  },

  onHeroChange(event) {
    this.setData({ activeHero: event.detail.current })
  },

  goMe() {
    wx.switchTab({ url: '/pages/me/index' })
  }
})
