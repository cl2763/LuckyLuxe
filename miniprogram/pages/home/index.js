const { curOf, ensureCurrencyCached } = require('../../utils/storecurrency')
const i18n = require('../../utils/i18n')
const api = require('../../utils/api')
const storage = require('../../utils/storage')
const tabbar = require('../../utils/tabbar')

Page({
  data: {
    lang: 'zh',
    t: i18n.pageCopy('home', 'zh'),
    store: {},   // D17:初始不塞 mock 门店,接口没回来就是空,不拿假门店占位
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
    if (!api.hasTenant()) {
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
      // 店名唯一出口=当前租户在 /shops 里的那一行;拿不到就空(店卡另有 store.storeName),
      // 绝不回落成旗舰店品牌名(店主 08-23 裁定:不许显示别人家的店)
      const tid = api.currentTenantId()
      const r = await api.getShops()
      const hit = (r.shops || []).find((s) => s.tenantId === tid)
      this.setData({ shopName: (hit && hit.name) || '' })
    } catch (e) { this.setData({ shopName: '' }) }
  },

  switchShop() { wx.navigateTo({ url: '/pages/shop-select/index' }) },

  // AI 在线客服入口已下线(2026-08-04),页面保留备用;此处留空避免有残留调用导致跳转报错
  goAiChat() { /* 入口已下线,改走企业微信外部客服 */ },

  /* 🔴 永久律(店主 08-23):今日营业句/营业中状态**后端唯一出口**(/stores 的 todayHours)。
     原来这里前端自己算:①只看每周固定营业时间,不看特殊营业日 —— 今天特殊休息也照样显示
     「今日 10:00–19:00 · 营业中」;②算不出就回落到常规营业时间那句;③用手机时区推"今天"。
     现在前端零计算:后端给什么显示什么,没给就不显示这一行(不拿常规时间顶今天)。 */
  todayHoursOf(store, lang) {
    const th = (store && store.todayHours && (store.todayHours[lang] || store.todayHours.zh)) || null
    if (!th) return { todayHoursText: '', openNow: false, hasHours: false }
    return { todayHoursText: th.text || '', openNow: Boolean(th.openNow), hasHours: Boolean(th.hasHours) }
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
          wx.setClipboardData({ data: store.address || '' ,
      fail: () => wx.showToast({ title: '复制调用失败,请重试', icon: 'none' })
    })
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
    /* 🔴 D17:接口挂了如实报失败态,不回 mock。以前这三条任何一条挂了都会
       悄悄回写死的演示服务/门店,顾客看到的是一整套不存在的东西。 */
    let nailServices, lashServices, stores
    try {
      nailServices = await api.getServices('nail', lang)
      lashServices = await api.getServices('lash', lang)
      stores = await api.getStores()
    } catch (e) {
      this.setData({ lang, t: i18n.pageCopy('home', lang), loadFailed: true })
      return
    }
    this.setData({ loadFailed: false })
    const storeRaw = stores[0] || {}
    const hoursInfo = this.todayHoursOf(storeRaw, lang)
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
