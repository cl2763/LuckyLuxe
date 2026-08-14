const storage = require('../../utils/storage')
const { curOf, ensureCurrencyCached } = require('../../utils/storecurrency')
const i18n = require('../../utils/i18n')

Page({
  onShow() {
    ensureCurrencyCached()
    this.setData({ cur: curOf() })   // 币种跟门店走,不写死币符
  },
  data: {
    order: null,
    lang: 'zh',
    t: i18n.pageCopy('success', 'zh')
  },

  onLoad(options) {
    const lang = i18n.getLang()
    i18n.applyTabBar(lang)
    i18n.setTitle(i18n.pageCopy('success', lang).title)
    const order = storage.getOrder(options.orderNo)
    if (order) {
      const service = i18n.localizeService(order.service || (order.serviceInfo && { name: order.serviceInfo.serviceName, type: order.serviceInfo.serviceType }) || {}, lang) // mock 清除:订单落库时已带 service
      order.serviceInfo.serviceName = service ? service.name : order.serviceInfo.serviceName
      order.store = i18n.localizeStore(order.store, lang)
    }
    this.setData({ order, lang, t: i18n.pageCopy('success', lang) })
  },

  goOrders() {
    wx.redirectTo({ url: '/pages/orders/index' })
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/index' })
  }
})
