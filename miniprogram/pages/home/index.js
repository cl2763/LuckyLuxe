const { share } = require('../../utils/public-share')
const storeNameFit = require('../../utils/store-name-fit')
const { curOf, ensureCurrencyCached } = require('../../utils/storecurrency')
const { isPlaceholderValue } = require('../../utils/placeholder-words.js')   // 11k:占位词表唯一出口
const i18n = require('../../utils/i18n')
const api = require('../../utils/api')
const storage = require('../../utils/storage')
const tabbar = require('../../utils/tabbar')

Page({
  onShareAppMessage() { return share('home', this.data.shopName, {}) },
  onShareTimeline() { return this.onShareAppMessage() },
  data: {
    loading: true,
    loadFailed: false,
    loadError: '',
    diagnostic: '',
    lang: 'zh',
    t: i18n.pageCopy('home', 'zh'),
    store: {},   // D17:初始不塞 mock 门店,接口没回来就是空,不拿假门店占位
    heroSlides: [],
    activeHero: 0,
    portfolioIntro: '',
    technicianWorks: '',
    recommendedNail: [],
    recommendedLash: [],
    fallbackServices: [],
    shopName: '',
    todayHoursText: '',
    openNow: false,
    hasHours: false
  },

  onShow() {
    ensureCurrencyCached()
    this.setData({ cur: curOf() })   // 币种跟门店走,不写死币符

    // 多租户兜底:既没扫店码、也没进过任何店 → 引导选择门店
    if (!api.hasTenant() || (api.EXPERIENCE && !api.EXPERIENCE_TENANTS.includes(api.currentTenantId()))) {
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

      const zh = (hit && (hit.name || hit.storeName)) || ''
      const en = (hit && (hit.name_en || hit.storeNameEn)) || ''
      this.setData({ shopName: (this.data.lang === 'en' && en) ? en : zh })
    } catch (e) { this.setData({ shopName: '' }) }
  },

  switchShop() { wx.navigateTo({ url: '/pages/shop-select/index' }) },

  // AI 在线客服入口已下线(2026-08-04),页面保留备用;此处留空避免有残留调用导致跳转报错
  goAiChat() {  },


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
    // 11k 出口普查抓到的第 13 处:原来手写 `/待补充|TBD/i`,是这条规则的第三份拷贝
    if (isPlaceholderValue(phone)) {
      wx.showToast({ title: this.data.lang === 'en' ? 'Phone not set yet' : '门店电话待补充', icon: 'none' })
      return
    }
    wx.makePhoneCall({ phoneNumber: phone.replace(/[^\d+]/g, '') })
  },

  async refreshLanguage() {
    const serial = this._refreshSerial = (this._refreshSerial || 0) + 1
    const lang = i18n.getLang()
    i18n.applyTabBar(lang)
    storage.syncCartBadge()
    tabbar.update(this, 0)
    i18n.setTitle('有迹')

    this.setData({ loading: true, loadFailed: false, loadError: '' })
    let nailServices, lashServices, stores, heroSlides
    try {
      ;[nailServices, stores, heroSlides] = await Promise.all([
        api.getServiceCatalog(lang), api.getStores(), api.getHeroSlides(lang)
      ])
      if (!stores || !stores.length) throw { code: 'STORE_EMPTY', requestPath: '/stores' }
      const catalog = nailServices.services
      nailServices = catalog.filter(item => item.type === 'nail')
      lashServices = catalog.filter(item => item.type === 'lash')
      this._catalog = catalog
    } catch (e) {
      if (serial !== this._refreshSerial) return
      this.setData({ diagnostic: [e.code || 'LOAD_ERROR', e.statusCode || '', e.requestPath || ''].filter(Boolean).join(' · ') })
      this.setData({ lang, t: i18n.pageCopy('home', lang), loading: false, loadFailed: true, loadError: e.code === 'STORE_CHANGED' ? (lang === 'en' ? 'Store changed. Please retry.' : '门店已切换，请重试') : (e.code === 'TENANT_REQUIRED' || e.code === 'STORE_EMPTY' ? (lang === 'en' ? 'This store is unavailable. Please choose a store again.' : '当前门店不可用，请重新选择门店') : (lang === 'en' ? 'Could not load store. Please retry.' : '门店加载失败，请重试')) })
      return
    }
    if (serial !== this._refreshSerial) return
    this.setData({ loading: false, loadFailed: false })
    const storeRaw = stores[0] || {}
    const hoursInfo = this.todayHoursOf(storeRaw, lang)
    this.setData(Object.assign({}, hoursInfo, {
      lang,
      t: i18n.pageCopy('home', lang),
      store: i18n.localizeStore(storeRaw, lang),

      heroSlides: heroSlides,
      technicianWorks: lang === 'en' ? 'Artist Work' : '技师作品',
      portfolioIntro: lang === 'en' ? 'View real work from this store' : '查看本店真实客作',
      recommendedNail: i18n.localizeServices(nailServices.filter((item) => item.isRecommended), lang),
      recommendedLash: i18n.localizeServices(lashServices.filter((item) => item.isRecommended), lang)
    }))

    const allSvc = i18n.localizeServices(this._catalog || [...nailServices, ...lashServices], lang)
    this.setData({ fallbackServices: allSvc.slice(0, 4) }, () => storeNameFit.fit(this))
  },

  showFullStoreName() { storeNameFit.show(this) },
  onResize() { storeNameFit.fit(this) },

  switchLanguage(event) {
    const lang = event.currentTarget.dataset.lang
    i18n.setLang(lang)
    this.refreshLanguage()
  },

  goServices(event) {
    const type = event.currentTarget.dataset.type || 'all'
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
