/* v1.4 服务 Tab 重构(店主 08-16 实拍判词,图=合同):
   ①顶部段选撤除(大类多了会越来越宽,形态不许要);②左栏=平台大类(字典驱动,空类不显示,与网页同构);
   ③右侧=项目卡(二级分类并入卡片眉标);④「加项服务」永不出现在顾客分类(规则①,数据层公开接口已滤,
   本页不再有任何静态分类数组);⑤价格=「¥xxx 起」(priceFromLabel,后端算好)。
   D17 失败态保留:接口挂了如实说,不回 mock。 */
const { curOf, ensureCurrencyCached } = require('../../utils/storecurrency')
const i18n = require('../../utils/i18n')
const api = require('../../utils/api')
const tabbar = require('../../utils/tabbar')

Page({
  data: {
    lang: 'zh',
    t: i18n.pageCopy('services', 'zh'),
    cats: [],          // 左栏=平台大类(空类不显示)
    activeCat: '',     // 当前大类 key
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
    const lang = i18n.getLang()
    let catalog
    try {
      catalog = await api.getServiceCatalog(lang)
    } catch (e) {
      // D17:接口挂了如实报,不回 mock
      this.setData({ loadFailed: true, serviceList: [], cats: [] })
      return
    }
    this._services = catalog.services
    const keyOf = (svc) => svc.platformCategory || (svc.type === 'nail' || svc.type === 'lash' ? svc.type : 'care')
    this._keyOf = keyOf
    // 空大类不显示(v1.4);标签随语言取字典 nameZh/nameEn
    const cats = (catalog.platformCategories || [])
      .filter((cat) => catalog.services.some((svc) => keyOf(svc) === cat.key))
      .map((cat) => ({ key: cat.key, label: lang === 'en' ? cat.nameEn : cat.nameZh }))
    let activeCat = this.data.activeCat
    if (!cats.some((c) => c.key === activeCat)) activeCat = (cats[0] || {}).key || ''
    this.setData({ loadFailed: false, cats, activeCat, lang, t: i18n.pageCopy('services', lang) })
    this.render()
  },

  render() {
    const lang = this.data.lang
    const filtered = (this._services || []).filter((svc) => this._keyOf(svc) === this.data.activeCat)
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
