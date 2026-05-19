const mock = require('../../utils/mock-data')
const storage = require('../../utils/storage')
const i18n = require('../../utils/i18n')

Page({
  data: {
    service: null,
    lang: 'zh',
    t: i18n.pageCopy('detail', 'zh')
  },

  onLoad(options) {
    this.serviceId = options.id
    this.refresh()
  },

  onShow() {
    if (this.serviceId) this.refresh()
  },

  refresh() {
    const lang = i18n.getLang()
    i18n.applyTabBar(lang)
    const service = i18n.localizeService(mock.findService(this.serviceId), lang)
    if (!service) {
      wx.showToast({ title: i18n.pageCopy('booking', lang).missing, icon: 'none' })
      setTimeout(() => wx.navigateBack(), 600)
      return
    }
    wx.setNavigationBarTitle({ title: service.name })
    this.setData({ service, lang, t: i18n.pageCopy('detail', lang) })
  },

  goBooking() {
    wx.navigateTo({
      url: `/pages/booking/index?id=${this.data.service._id}`
    })
  },

  addDraftToCart() {
    const service = this.data.service
    storage.addCartItem({
      type: 'service',
      serviceId: service._id,
      service,
      appointmentInfo: {
        date: storage.tomorrow(),
        time: '10:00',
        duration: service.duration,
        addOns: [],
        referenceImages: [],
        remark: ''
      }
    })
    wx.showToast({ title: i18n.pageCopy('booking', i18n.getLang()).added, icon: 'success' })
  }
})
