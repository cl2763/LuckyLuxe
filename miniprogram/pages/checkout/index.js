const mock = require('../../utils/mock-data')
const storage = require('../../utils/storage')
const i18n = require('../../utils/i18n')
const api = require('../../utils/api')

Page({
  data: {
    items: [],
    lang: 'zh',
    t: i18n.pageCopy('checkout', 'zh'),
    store: mock.store,
    serviceDeposit: 0,
    couponDiscount: 0,
    useBalance: false,
    balanceDeduction: 0,
    payableAmount: 0,
    remark: ''
  },

  onLoad(options) {
    const lang = i18n.getLang()
    i18n.applyTabBar(lang)
    i18n.setTitle(i18n.pageCopy('checkout', lang).title)
    const ids = options.ids ? options.ids.split(',') : []
    const items = storage.getCart()
      .filter((item) => ids.indexOf(item._id) >= 0)
      .map((item) => {
        const service = i18n.localizeService(mock.findService(item.serviceId) || item.service, lang)
        return Object.assign({}, item, {
          service: Object.assign({}, item.service, service)
        })
      })
    this.setData({ items, lang, t: i18n.pageCopy('checkout', lang), store: i18n.localizeStore(mock.store, lang) })
    this.calculate()
  },

  calculate() {
    const serviceDeposit = this.data.items.reduce((sum, item) => sum + item.service.depositAmount * item.quantity, 0)
    const balanceDeduction = 0
    const payableAmount = serviceDeposit
    this.setData({ serviceDeposit, balanceDeduction, payableAmount })
  },

  toggleBalance(event) {
    this.setData({ useBalance: event.detail.value })
    this.calculate()
  },

  inputRemark(event) {
    this.setData({ remark: event.detail.value })
  },

  async submitOrder() {
    if (!this.data.items.length) {
      wx.showToast({ title: this.data.t.noItems, icon: 'none' })
      return
    }
    const now = Date.now()
    const first = this.data.items[0]
    const backendBookings = []
    try {
      for (let index = 0; index < this.data.items.length; index += 1) {
        const created = await api.createBooking(this.data.items[index], this.data.remark)
        const paid = created && created.id ? await api.confirmMockPayment(created.id) : created
        backendBookings.push(paid)
      }
    } catch (error) {
      wx.showToast({ title: error.message || '后端暂不可用，已使用演示订单', icon: 'none' })
    }
    const firstBackendBooking = backendBookings[0]
    const technicianName = firstBackendBooking && firstBackendBooking.technician ? firstBackendBooking.technician.name : (first.appointmentInfo.technicianName || 'Mia Chen')
    const order = {
      _id: `order_${now}`,
      orderNo: `LL${now}`,
      items: this.data.items.map((item) => ({
        type: item.type,
        serviceId: item.serviceId,
        name: item.service.name,
        price: item.service.price,
        quantity: item.quantity
      })),
      serviceInfo: {
        serviceId: first.serviceId,
        serviceName: first.service.name,
        serviceType: first.service.type,
        duration: first.service.duration,
        depositAmount: first.service.depositAmount,
        technicianName
      },
      backendBookingId: firstBackendBooking ? firstBackendBooking.id : '',
      backendBookingIds: backendBookings.map((item) => item.id),
      appointment: first.appointmentInfo,
      store: this.data.store,
      couponId: '',
      couponDiscount: this.data.couponDiscount,
      balanceDeduction: this.data.balanceDeduction,
      payableAmount: this.data.payableAmount,
      remark: this.data.remark,
      status: 'pending_service',
      paymentStatus: 'paid',
      transactionId: `mock_${now}`,
      createdAt: now,
      updatedAt: now
    }
    storage.addOrder(order)
    storage.removeCartItems(this.data.items.map((item) => item._id))
    wx.navigateTo({ url: `/pages/payment-success/index?orderNo=${order.orderNo}` })
  }
})
