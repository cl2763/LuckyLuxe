/* 🔴 D17 同类(2026-08-11 L2 补扫发现):这一页**从来没调过接口** ——
   data 里摆 mock.store,onShow 又把 mock.store 重新 localize 一遍塞回去,
   顾客点「门店信息」看到的永远是编造的那家店。实测:真门店是「Jie's Nail 小婕」,
   这一页却显示「Lucky Luxe」+「演示版暂用占位门店信息」的简介。
   改法与三页失败态同一套标准:取真门店,取不到就如实说加载失败,不拿假门店占位。 */
const i18n = require('../../utils/i18n')
const api = require('../../utils/api')

Page({
  data: {
    store: {},          // 不摆 mock 门店占位
    loadFailed: false,
    lang: 'zh',
    t: i18n.pageCopy('store', 'zh')
  },

  onShow() {
    this.load()
  },

  async load() {
    const lang = i18n.getLang()
    const t = i18n.pageCopy('store', lang)
    i18n.applyTabBar(lang)
    i18n.setTitle(t.title)
    let stores
    try {
      stores = await api.getStores()
    } catch (e) {
      this.setData({ lang, t, store: {}, loadFailed: true })
      return
    }
    const storeRaw = stores[0] || {}
    this.setData({ lang, t, loadFailed: false, store: i18n.localizeStore(storeRaw, lang) })
  },

  copyAddress() {
    if (!this.data.store.address) return
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
