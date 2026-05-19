const storage = require('../../utils/storage')
const mock = require('../../utils/mock-data')
const i18n = require('../../utils/i18n')

Page({
  data: {
    order: null,
    lang: 'zh',
    t: i18n.pageCopy('orderDetail', 'zh')
  },

  onLoad(options) {
    this.load(options.id)
  },

  load(id) {
    const order = storage.getOrder(id)
    const lang = i18n.getLang()
    const t = i18n.pageCopy('orderDetail', lang)
    i18n.applyTabBar(lang)
    i18n.setTitle(t.title)
    if (order) {
      const service = mock.findService(order.serviceInfo.serviceId) || {}
      const localizedService = i18n.localizeService(service, lang)
      order.statusText = i18n.statusText(order.status, lang)
      order.serviceImage = service.image || '/assets/images/store-cover.png'
      order.serviceInfo.serviceName = localizedService.name || order.serviceInfo.serviceName
      order.serviceInfo.technicianName = order.serviceInfo.technicianName || this.defaultTechnician(order.serviceInfo.serviceType)
    }
    this.setData({ order, lang, t })
  },

  defaultTechnician(type) {
    return type === 'lash' ? 'Ava Lin' : 'Mia Chen'
  },

  cancelOrder() {
    wx.showModal({
      title: this.data.t.cancelTitle,
      content: this.data.t.cancelContent,
      confirmColor: '#C6A27E',
      success: (res) => {
        if (res.confirm) {
          const order = storage.updateOrder(this.data.order._id, {
            status: 'cancelled'
          })
          order.statusText = i18n.statusText(order.status, i18n.getLang())
          this.setData({ order })
          wx.showToast({ title: this.data.t.cancelled, icon: 'success' })
        }
      }
    })
  },

  callStore() {
    wx.showToast({ title: this.data.t.phoneMissing, icon: 'none' })
  },

  openLocation() {
    wx.showToast({ title: this.data.t.addressMissing, icon: 'none' })
  }
})
