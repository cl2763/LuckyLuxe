const mock = require('../../utils/mock-data')
const { curOf, ensureCurrencyCached } = require('../../utils/storecurrency')
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
    recommendedLash: [],
    shopName: '',
    todayHoursText: '',
    openNow: false,
    hasHours: false
  },

  onLoad() {
    this.refreshLanguage()
  },

  onShow() {
    ensureCurrencyCached()
    this.setData({ cur: curOf() })   // 币种跟门店走,不写死币符

    // 多租户兜底:既没扫店码、也没进过任何店 → 引导选择门店
    if (!wx.getStorageSync('lucky_tenant')) {
      wx.navigateTo({ url: '/pages/shop-select/index' })
      return
    }
    tabbar.update(this, 0)
    // 门店没开通 AI 智能包就不显示「AI 在线客服」入口(值由 /stores 下发并缓存)
    this.setData({ aiEnabled: api.getStoreAiEnabled() })
    this.refreshLanguage()
    this.loadShopName()
  },

  // 当前门店名(顶部门店条)
  async loadShopName() {
    try {
      const tid = wx.getStorageSync('lucky_tenant') || 'lucky-luxe'
      const r = await api.getShops()
      const hit = (r.shops || []).find((s) => s.tenantId === tid)
      this.setData({ shopName: (hit && hit.name) || 'Lucky Luxe' })
    } catch (e) { this.setData({ shopName: 'Lucky Luxe' }) }
  },

  switchShop() { wx.navigateTo({ url: '/pages/shop-select/index' }) },

  // AI 在线客服入口已下线(2026-08-04),页面保留备用;此处留空避免有残留调用导致跳转报错
  goAiChat() { /* 入口已下线,改走企业微信外部客服 */ },

  // ===== 店卡:今日营业时间/营业状态(按门店时区算,不用手机本地时区) =====
  computeTodayHours(store) {
    const lang = i18n.getLang()
    const hours = (store && store.hours) || []
    if (!hours.length) return { todayHoursText: '', openNow: false, hasHours: false }
    let now = new Date()
    try {
      // 部分低版本基础库不支持 timeZone,失败则退回手机本地时间
      now = new Date(now.toLocaleString('en-US', { timeZone: store.timezone || 'America/Toronto' }))
      if (isNaN(now.getTime())) now = new Date()
    } catch (e) { now = new Date() }
    const row = hours.find((h) => Number(h.weekday) === now.getDay())
    if (!row || row.is_closed) {
      return { todayHoursText: lang === 'en' ? 'Closed today' : '今日休息', openNow: false, hasHours: true }
    }
    const minutes = now.getHours() * 60 + now.getMinutes()
    const toMin = (t) => { const p = String(t || '').split(':'); return Number(p[0]) * 60 + Number(p[1] || 0) }
    const openNow = minutes >= toMin(row.open_time) && minutes < toMin(row.close_time)
    return {
      todayHoursText: (lang === 'en' ? 'Today ' : '今日 ') + row.open_time + ' – ' + row.close_time,
      openNow,
      hasHours: true
    }
  },

  copyAddress() {
    const store = this.data.store || {}
    const itemList = this.data.lang === 'en' ? ['Open in Maps', 'Copy address'] : ['地图导航', '复制地址']
    wx.showActionSheet({
      itemList,
      success: (res) => {
        if (res.tapIndex === 0 && store.latitude && store.longitude) {
          wx.openLocation({ latitude: Number(store.latitude), longitude: Number(store.longitude), name: store.storeName, address: store.address })
        } else {
          wx.setClipboardData({ data: store.address || '' })
        }
      }
    })
  },

  callStore() {
    const phone = String((this.data.store || {}).phone || '')
    if (!phone || /待补充|TBD/i.test(phone)) {
      wx.showToast({ title: this.data.lang === 'en' ? 'Phone not set yet' : '门店电话待补充', icon: 'none' })
      return
    }
    wx.makePhoneCall({ phoneNumber: phone.replace(/[^\d+]/g, '') })
  },

  async refreshLanguage() {
    const lang = i18n.getLang()
    i18n.applyTabBar(lang)
    storage.syncCartBadge()
    tabbar.update(this, 0)
    i18n.setTitle('有迹')
    const nailServices = await api.getServices('nail', lang)
    const lashServices = await api.getServices('lash', lang)
    const stores = await api.getStores()
    const storeRaw = stores[0] || mock.store
    const hoursInfo = this.computeTodayHours(storeRaw)
    this.setData(Object.assign({}, hoursInfo, {
      lang,
      t: i18n.pageCopy('home', lang),
      store: i18n.localizeStore(storeRaw, lang),
      heroSlides: [
        { image: '/assets/images/hero-carousel-interior.jpg', label: lang === 'en' ? 'Lucky Luxe studio mood' : 'Lucky Luxe 店内氛围' },
        { image: '/assets/images/hero-carousel-nail.jpg', label: lang === 'en' ? 'Premium nail detail' : '精致美甲细节' },
        { image: '/assets/images/hero-carousel-lash.jpg', label: lang === 'en' ? 'Lash service detail' : '美睫服务细节' }
      ],
      technicianWorks: lang === 'en' ? 'Artist Work' : '技师作品',
      portfolioIntro: lang === 'en' ? 'Browse approved finished work by each artist.' : '浏览每位技师已确认入库的真实作品。',
      recommendedNail: i18n.localizeServices(nailServices.filter((item) => item.isRecommended), lang),
      recommendedLash: i18n.localizeServices(lashServices.filter((item) => item.isRecommended), lang)
    }))
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
