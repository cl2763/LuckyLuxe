
const i18n = require('../../utils/i18n')
const api = require('../../utils/api')

Page({
  behaviors: [require('../../utils/media-privacy')],
  data: {
    mediaPrivacyCopy: '复制门店地址或地图链接前，请阅读并同意隐私保护指引。仅复制你选择的内容。',
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
    let stores, slides
    try {
      stores = await api.getStores()

      slides = await api.getHeroSlides(lang)
    } catch (e) {
      this.setData({ lang, t, store: {}, loadFailed: true })
      return
    }
    const storeRaw = stores[0] || {}
    this.setData({
      lang, t, loadFailed: false,
      store: i18n.localizeStore(storeRaw, lang),
      storeCover: (slides[0] && slides[0].image) || ''
    })
  },

  previewGuide(e) { require('../../utils/guide-preview')(e.currentTarget.dataset.src) },
  copyAddress() {
    if (!this.data.store.address) return
    wx.setClipboardData({
      data: this.data.store.address,
      success: () => wx.showToast({ title: this.data.t.copied, icon: 'success' })
    ,
      fail: () => wx.showToast({ title: '复制调用失败,请重试', icon: 'none' })
    })
  },

  callStore() {
    require('../../utils/store-navigation').call(this.data.store, this.data.lang === 'en')
  },

  openLocation() {
    require('../../utils/store-navigation').navigate(this.data.store, this.data.lang === 'en')
  }
})
