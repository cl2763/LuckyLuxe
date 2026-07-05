const storage = require('../../utils/storage')
const mock = require('../../utils/mock-data')
const i18n = require('../../utils/i18n')
const api = require('../../utils/api')

Page({
  data: {
    order: null,
    lang: 'zh',
    t: i18n.pageCopy('orderDetail', 'zh')
  },

  onLoad(options) {
    this.load(options.id)
  },

  async load(id) {
    const lang = i18n.getLang()
    const t = i18n.pageCopy('orderDetail', lang)
    i18n.applyTabBar(lang)
    i18n.setTitle(t.title)
    if (!api.isLoggedIn()) {
      this.setData({ order: null, lang, t })
      return
    }
    let order = storage.getOrder(id)
    if (!order) {
      try {
        const bookings = await api.getBookings(lang)
        storage.setOrders(bookings)
        order = bookings.find((item) => item._id === id || item.orderNo === id)
      } catch (error) {
        order = null
      }
    }
    if (order) {
      const service = order.service || mock.findService(order.serviceInfo.serviceId) || {}
      const localizedService = i18n.localizeService(service, lang)
      order.statusText = i18n.statusText(order.status, lang)
      order.serviceImage = service.image || order.serviceImage || '/assets/images/store-cover.jpg'
      order.serviceInfo.serviceName = localizedService.name || order.serviceInfo.serviceName
      order.serviceInfo.technicianName = order.serviceInfo.technicianName || this.defaultTechnician(order.serviceInfo.serviceType)
      order.visibleWorkImages = order.status === 'completed' ? (order.workImages || []).slice(0, 6) : []
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
  },

  previewWork(event) {
    const url = event.currentTarget.dataset.url
    wx.previewImage({ current: url, urls: this.data.order.visibleWorkImages })
  }
})
