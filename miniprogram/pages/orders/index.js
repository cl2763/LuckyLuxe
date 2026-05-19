const storage = require('../../utils/storage')
const mock = require('../../utils/mock-data')
const i18n = require('../../utils/i18n')

const tabs = [
  { key: 'all', labelKey: 'all' },
  { key: 'pending_service', labelKey: 'statusPendingService' },
  { key: 'completed', labelKey: 'statusCompleted' },
  { key: 'cancelled', labelKey: 'statusCancelled' },
  { key: 'after_sales', labelKey: 'statusAfterSales' }
]

Page({
  data: {
    tabs,
    lang: 'zh',
    t: i18n.pageCopy('orders', 'zh'),
    activeStatus: 'all',
    orders: []
  },

  onLoad(options) {
    this.setData({ activeStatus: options.status || 'all' })
  },

  onShow() {
    this.refresh()
  },

  switchStatus(event) {
    this.setData({ activeStatus: event.currentTarget.dataset.status })
    this.refresh()
  },

  refresh() {
    const lang = i18n.getLang()
    const t = i18n.pageCopy('orders', lang)
    i18n.applyTabBar(lang)
    i18n.setTitle(t.title)
    const orders = storage.getOrders().map((item) => {
      const service = mock.findService(item.serviceInfo.serviceId) || {}
      const localizedService = i18n.localizeService(service, lang)
      return Object.assign({}, item, {
        statusText: i18n.statusText(item.status, lang),
        serviceName: localizedService.name || item.serviceInfo.serviceName,
        serviceImage: service.image || '/assets/images/store-cover.png'
      })
    })
    this.setData({
      lang,
      t,
      tabs: tabs.map((item) => Object.assign({}, item, { label: t[item.labelKey] })),
      orders: this.data.activeStatus === 'all'
        ? orders
        : orders.filter((item) => item.status === this.data.activeStatus)
    })
  },

  goDetail(event) {
    wx.navigateTo({ url: `/pages/order-detail/index?id=${event.currentTarget.dataset.id}` })
  },

  goServices() {
    wx.switchTab({ url: '/pages/services/index' })
  }
})
