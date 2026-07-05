const storage = require('../../utils/storage')
const mock = require('../../utils/mock-data')
const i18n = require('../../utils/i18n')
const tabbar = require('../../utils/tabbar')
const api = require('../../utils/api')

Page({
  data: {
    cart: [],
    lang: 'zh',
    t: i18n.pageCopy('cart', 'zh'),
    allSelected: false,
    totalDeposit: 0
  },

  onShow() {
    tabbar.update(this, 2)
    this.refresh()
  },

  refresh() {
    const lang = i18n.getLang()
    const member = wx.getStorageSync('lucky_member') || {}
    const depositWaived = Boolean(member.depositWaived)
    i18n.applyTabBar(lang)
    storage.syncCartBadge()
    tabbar.update(this, 2)
    i18n.setTitle(i18n.pageCopy('cart', lang).title)
    const cart = storage.getCart().map((item) => {
      const service = i18n.localizeService(mock.findService(item.serviceId) || item.service, lang)
      return Object.assign({}, item, {
        service: Object.assign({}, item.service, service)
      })
    })
    const totalDeposit = cart
      .filter((item) => item.selected)
      .reduce((sum, item) => sum + (depositWaived ? 0 : item.service.depositAmount * item.quantity), 0)
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
    if (!api.isLoggedIn()) {
      wx.showModal({
        title: this.data.lang === 'en' ? 'Sign in required' : '需要登录',
        content: this.data.lang === 'en'
          ? 'Please sign in with WeChat before checkout and deposit payment.'
          : '结算和支付定金前需要先完成微信登录。',
        confirmText: this.data.lang === 'en' ? 'Go sign in' : '去登录',
        cancelText: this.data.lang === 'en' ? 'Cancel' : '取消',
        confirmColor: '#C6A27E',
        success: (res) => {
          if (res.confirm) wx.switchTab({ url: '/pages/me/index' })
        }
      })
      return
    }
    wx.navigateTo({ url: `/pages/checkout/index?ids=${ids.join(',')}` })
  }
})
