const storage = require('../../utils/storage')
const mock = require('../../utils/mock-data')
const i18n = require('../../utils/i18n')

Page({
  data: {
    cart: [],
    lang: 'zh',
    t: i18n.pageCopy('cart', 'zh'),
    allSelected: false,
    totalDeposit: 0
  },

  onShow() {
    this.refresh()
  },

  refresh() {
    const lang = i18n.getLang()
    i18n.applyTabBar(lang)
    i18n.setTitle(i18n.pageCopy('cart', lang).title)
    const cart = storage.getCart().map((item) => {
      const service = i18n.localizeService(mock.findService(item.serviceId) || item.service, lang)
      return Object.assign({}, item, {
        service: Object.assign({}, item.service, service)
      })
    })
    const totalDeposit = cart
      .filter((item) => item.selected)
      .reduce((sum, item) => sum + item.service.depositAmount * item.quantity, 0)
    this.setData({
      cart,
      lang,
      t: i18n.pageCopy('cart', lang),
      allSelected: cart.length > 0 && cart.every((item) => item.selected),
      totalDeposit
    })
  },

  toggleItem(event) {
    const id = event.currentTarget.dataset.id
    const item = this.data.cart.find((cartItem) => cartItem._id === id)
    storage.updateCartItem(id, { selected: !item.selected })
    this.refresh()
  },

  toggleAll() {
    const next = !this.data.allSelected
    storage.setCart(this.data.cart.map((item) => Object.assign({}, item, { selected: next })))
    this.refresh()
  },

  removeItem(event) {
    const id = event.currentTarget.dataset.id
    wx.showModal({
      title: this.data.t.deleteTitle,
      content: this.data.t.deleteContent,
      confirmColor: '#C6A27E',
      success: (res) => {
        if (res.confirm) {
          storage.removeCartItem(id)
          this.refresh()
        }
      }
    })
  },

  editBooking(event) {
    wx.navigateTo({
      url: `/pages/booking/index?id=${event.currentTarget.dataset.serviceId}&cartId=${event.currentTarget.dataset.id}`
    })
  },

  goServices() {
    wx.switchTab({ url: '/pages/services/index' })
  },

  goCheckout() {
    const ids = this.data.cart.filter((item) => item.selected).map((item) => item._id)
    if (!ids.length) {
      wx.showToast({ title: this.data.t.chooseCheckout, icon: 'none' })
      return
    }
    wx.navigateTo({ url: `/pages/checkout/index?ids=${ids.join(',')}` })
  }
})
