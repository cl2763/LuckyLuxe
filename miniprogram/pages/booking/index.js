const mock = require('../../utils/mock-data')
const storage = require('../../utils/storage')
const i18n = require('../../utils/i18n')
const api = require('../../utils/api')

Page({
  data: {
    service: null,
    lang: 'zh',
    t: i18n.pageCopy('booking', 'zh'),
    cartId: '',
    minDate: '',
    appointmentDate: '',
    appointmentTime: '',
    timeSlots: mock.timeSlots,
    addOns: mock.addOns,
    selectedAddOns: [],
    referenceImages: [],
    remark: ''
  },

  onLoad(options) {
    this.serviceId = options.id
    this.cartId = options.cartId || ''
    this.refresh(options)
  },

  onShow() {
    if (this.serviceId) this.refresh({ id: this.serviceId, cartId: this.cartId })
  },

  async refresh(options) {
    const lang = i18n.getLang()
    i18n.applyTabBar(lang)
    i18n.setTitle(i18n.pageCopy('booking', lang).title)
    const service = i18n.localizeService(await api.getService(options.id, lang), lang)
    if (!service) {
      wx.showToast({ title: i18n.pageCopy('booking', lang).missing, icon: 'none' })
      setTimeout(() => wx.navigateBack(), 600)
      return
    }
    const cartItem = options.cartId
      ? storage.getCart().find((item) => item._id === options.cartId)
      : null
    const appointment = cartItem ? cartItem.appointmentInfo : null
    const selectedAddOns = appointment ? appointment.addOns : []
    this.setData({
      service,
      lang,
      t: i18n.pageCopy('booking', lang),
      cartId: options.cartId || '',
      minDate: storage.today(),
      appointmentDate: appointment ? appointment.date : storage.tomorrow(),
      appointmentTime: appointment ? appointment.time : mock.timeSlots[0],
      selectedAddOns,
      referenceImages: appointment ? appointment.referenceImages : [],
      remark: appointment ? appointment.remark : '',
      addOns: i18n.localizeAddOns(mock.addOns, lang).map((item) => Object.assign({}, item, {
        checked: selectedAddOns.indexOf(item.id) >= 0
      }))
    })
    this.refreshAvailability()
  },

  bindDateChange(event) {
    this.setData({ appointmentDate: event.detail.value })
    this.refreshAvailability()
  },

  chooseTime(event) {
    this.setData({ appointmentTime: event.currentTarget.dataset.time })
  },

  toggleAddon(event) {
    const id = event.currentTarget.dataset.id
    const selected = this.data.selectedAddOns.slice()
    const index = selected.indexOf(id)
    if (index >= 0) selected.splice(index, 1)
    else selected.push(id)
    this.setData({
      selectedAddOns: selected,
      addOns: this.data.addOns.map((item) => Object.assign({}, item, {
        checked: selected.indexOf(item.id) >= 0
      }))
    })
    this.refreshAvailability()
  },

  async refreshAvailability() {
    if (!this.data.service || !this.data.appointmentDate) return
    const availability = await api.getAvailability(this.data.service._id, this.data.appointmentDate, this.data.selectedAddOns)
    const slots = availability.slots.length ? availability.slots : mock.timeSlots
    const nextTime = slots.indexOf(this.data.appointmentTime) >= 0 ? this.data.appointmentTime : slots[0]
    this.setData({
      timeSlots: slots,
      appointmentTime: nextTime,
      service: Object.assign({}, this.data.service, { duration: availability.durationMin || this.data.service.duration }),
      technician: availability.technician
    })
  },

  chooseImage() {
    const left = 3 - this.data.referenceImages.length
    if (left <= 0) {
      wx.showToast({ title: this.data.t.imageLimit, icon: 'none' })
      return
    }
    wx.chooseImage({
      count: left,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        this.setData({
          referenceImages: this.data.referenceImages.concat(res.tempFilePaths).slice(0, 3)
        })
      }
    })
  },

  removeImage(event) {
    const index = event.currentTarget.dataset.index
    const images = this.data.referenceImages.slice()
    images.splice(index, 1)
    this.setData({ referenceImages: images })
  },

  inputRemark(event) {
    this.setData({ remark: event.detail.value })
  },

  buildCartItem() {
    const service = this.data.service
    return {
      type: 'service',
      serviceId: service._id,
      service,
      appointmentInfo: {
        date: this.data.appointmentDate,
        time: this.data.appointmentTime,
        duration: service.duration,
        technicianId: this.data.technician ? this.data.technician.id : 'tech-mia',
        technicianName: this.data.technician ? this.data.technician.name : 'Mia Chen',
        addOns: this.data.selectedAddOns,
        referenceImages: this.data.referenceImages,
        remark: this.data.remark
      }
    }
  },

  validate() {
    if (!this.data.appointmentDate) {
      wx.showToast({ title: this.data.t.chooseDate, icon: 'none' })
      return false
    }
    if (!this.data.appointmentTime) {
      wx.showToast({ title: this.data.t.chooseTime, icon: 'none' })
      return false
    }
    if (this.data.remark.length > 100) {
      wx.showToast({ title: this.data.t.remarkLimit, icon: 'none' })
      return false
    }
    return true
  },

  addToCart() {
    if (!this.validate()) return
    if (this.data.cartId) {
      storage.updateCartItem(this.data.cartId, this.buildCartItem())
      wx.showToast({ title: this.data.t.saved, icon: 'success' })
      setTimeout(() => wx.navigateBack(), 600)
      return
    }
    storage.addCartItem(this.buildCartItem())
    wx.showToast({ title: this.data.t.added, icon: 'success' })
  },

  checkoutNow() {
    if (!this.validate()) return
    const item = this.data.cartId
      ? Object.assign({ _id: this.data.cartId }, this.buildCartItem())
      : storage.addCartItem(this.buildCartItem())
    if (this.data.cartId) storage.updateCartItem(this.data.cartId, this.buildCartItem())
    wx.navigateTo({ url: `/pages/checkout/index?ids=${item._id}` })
  }
})
