const { share } = require('../../utils/public-share')

const { curOf, ensureCurrencyCached } = require('../../utils/storecurrency')
const i18n = require('../../utils/i18n')
const api = require('../../utils/api')
const tabbar = require('../../utils/tabbar')

Page({
  onShareAppMessage() { return share('services', this.data.lang === 'en' ? 'Our services' : '本店服务', {}) },
  onShareTimeline() { return this.onShareAppMessage() },
  data: {
    lang: 'zh',
    t: i18n.pageCopy('services', 'zh'),
    cats: [],          // 左栏=平台大类(空类不显示)
    activeCat: 'all',     // 当前大类 key
    serviceList: [],
    loading: true,
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
      this.setData({ activeCat: cachedType })  // 首页入口带的大类 key(nail/lash/care)
    }
    this.setData({ lang, t: i18n.pageCopy('services', lang) })
    this.refresh()
  },

  switchCat(event) {
    this.setData({ activeCat: event.currentTarget.dataset.cat })
    this.render()
  },

  async refresh() {
    if (this._loading) return
    this._loading = true
    this.setData({ loading: true, loadFailed: false })
    const lang = i18n.getLang()
    let catalog
    try {
      catalog = await api.getServiceCatalog(lang)
    } catch (e) {
      // D17:接口挂了如实报,不回 mock
      this.setData({ loading: false, loadFailed: true, serviceList: [], cats: [] })
      this._loading = false
      return
    }
    this._services = catalog.services
    const keyOf = (svc) => svc.platformCategory || (svc.type === 'nail' || svc.type === 'lash' ? svc.type : 'care')
    this._keyOf = keyOf
    // 空大类不显示(v1.4);标签随语言取字典 nameZh/nameEn
    const cats = (catalog.platformCategories || [])
      .filter((cat) => catalog.services.some((svc) => keyOf(svc) === cat.key))
      .map((cat) => ({ key: cat.key, label: lang === 'en' ? cat.nameEn : cat.nameZh }))
    cats.unshift({ key: 'all', label: lang === 'en' ? 'All services' : '全部服务' })
    let activeCat = this.data.activeCat
    if (!cats.some((c) => c.key === activeCat)) activeCat = (cats[0] || {}).key || ''
    this.setData({ loading: false, loadFailed: false, cats, activeCat, lang, t: i18n.pageCopy('services', lang) })
    this.render()
    this._loading = false
  },

  render() {
    const lang = this.data.lang
    const filtered = (this._services || []).filter((svc) => this.data.activeCat === 'all' || this._keyOf(svc) === this.data.activeCat)
    const serviceList = i18n.localizeServices(filtered.slice().sort((a, b) => a.sort - b.sort), lang)
    this.setData({ serviceList })
  },

  goDetail(event) {
    wx.navigateTo({
      url: `/pages/service-detail/index?id=${event.currentTarget.dataset.id}`,
      fail: (e) => console.warn('[nav] service-detail fail', e)
    })
  }
})
