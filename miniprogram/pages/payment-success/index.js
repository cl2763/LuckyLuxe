const storage = require('../../utils/storage')
const mock = require('../../utils/mock-data')
const i18n = require('../../utils/i18n')

Page({
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
      const service = i18n.localizeService(mock.findService(order.serviceInfo.serviceId), lang)
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
