const storage = require('../../utils/storage')
const mock = require('../../utils/mock-data')
const i18n = require('../../utils/i18n')

Page({
  data: {
    member: {},
    lang: 'zh',
    t: i18n.pageCopy('me', 'zh'),
    growthPercent: 0,
    recentOrders: [],
    counts: {
      pending_service: 0,
      completed: 0,
      cancelled: 0,
      after_sales: 0
    }
  },

  onShow() {
    const member = wx.getStorageSync('lucky_member') || {}
    const lang = i18n.getLang()
    i18n.applyTabBar(lang)
    i18n.setTitle(i18n.pageCopy('me', lang).title)
    const orders = storage.getOrders().map((item) => {
      const service = mock.findService(item.serviceInfo.serviceId) || {}
      return Object.assign({}, item, {
        statusText: i18n.statusText(item.status, lang),
        serviceName: i18n.localizeService(service, lang).name || item.serviceInfo.serviceName,
        serviceImage: service.image || '/assets/images/store-cover.png'
      })
    })
    const growthPercent = member.nextLevelValue
      ? Math.min(100, Math.round((member.growthValue || 0) / member.nextLevelValue * 100))
      : 0
    this.setData({
      member,
      lang,
      t: i18n.pageCopy('me', lang),
      growthPercent,
      recentOrders: orders.slice(0, 2),
      counts: {
        pending_service: orders.filter((item) => item.status === 'pending_service').length,
        completed: orders.filter((item) => item.status === 'completed').length,
        cancelled: orders.filter((item) => item.status === 'cancelled').length,
        after_sales: orders.filter((item) => item.status === 'after_sales').length
      }
    })
  },

  goOrders(event) {
    const status = event.currentTarget.dataset.status || 'all'
    wx.navigateTo({ url: `/pages/orders/index?status=${status}` })
  },

  goAssets() {
    wx.navigateTo({ url: '/pages/assets/index' })
  },

  goOrderDetail(event) {
    wx.navigateTo({ url: `/pages/order-detail/index?id=${event.currentTarget.dataset.id}` })
  },

  goStore() {
    wx.navigateTo({ url: '/pages/store-location/index' })
  }
})
