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
    technicians: [],
    technicianIndex: 0,
    technician: null,
    selectedAddOns: [],
    referenceImages: [],
    referenceDataImages: [],
    referenceAnalysis: null,
    referencePriceText: '',
    referenceMessage: '',
    isAnalyzingReference: false,
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
    const [addOns, technicians] = await Promise.all([
      api.getAddOns(),
      api.getTechnicians(service._id)
    ])
    let technicianIndex = Math.max(0, technicians.findIndex((tech) => appointment && tech.id === appointment.technicianId))
    // 预约同款:作品页带来的预设(参考图+指定技师)。
    // 注意:onLoad 后 onShow 会再次 refresh,消费后的预设存页面实例,防止第二次刷新把横幅/参考图清掉。
    let stylePreset = this._stylePreset || null
    if (!appointment && !stylePreset) {
      const preset = wx.getStorageSync('lucky_style_preset') || null
      if (preset && preset.image) {
        wx.removeStorageSync('lucky_style_preset')
        const pi = technicians.findIndex((tech) => tech.id === preset.technicianId)
        stylePreset = { image: preset.image, techName: preset.technicianName || '', techMatched: pi >= 0, techIndex: pi }
        this._stylePreset = stylePreset
      }
    }
    if (stylePreset && !appointment && stylePreset.techIndex >= 0) technicianIndex = stylePreset.techIndex
    this.setData({
      service,
      lang,
      t: i18n.pageCopy('booking', lang),
      cartId: options.cartId || '',
      minDate: storage.today(),
      appointmentDate: appointment ? appointment.date : storage.tomorrow(),
      appointmentTime: appointment ? appointment.time : mock.timeSlots[0],
      technicians,
      technicianIndex,
      technician: technicians[technicianIndex] || technicians[0] || null,
      selectedAddOns,
      stylePreset,
      referenceImages: appointment
        ? appointment.referenceImages
        : ((this.data.referenceImages && this.data.referenceImages.length) ? this.data.referenceImages : (stylePreset ? [stylePreset.image] : [])),
      referenceDataImages: appointment ? (appointment.referenceDataImages || []) : [],
      referenceAnalysis: appointment ? appointment.referenceAnalysis : null,
      referencePriceText: appointment && appointment.referenceAnalysis && appointment.referenceAnalysis.estimatedPriceCents
        ? `CAD $${Math.round(appointment.referenceAnalysis.estimatedPriceCents / 100)}`
        : '',
      referenceMessage: appointment && appointment.referenceAnalysis
        ? (lang === 'en' ? appointment.referenceAnalysis.clientMessageEn : appointment.referenceAnalysis.clientMessageZh)
        : '',
      remark: appointment ? appointment.remark : '',
      addOns: i18n.localizeAddOns(addOns, lang).map((item) => Object.assign({}, item, {
        checked: selectedAddOns.indexOf(item.id) >= 0
      }))
    })
    this.refreshAvailability()
  },

  bindTechnicianChange(event) {
    const index = Number(event.detail.value || 0)
    this.setData({
      technicianIndex: index,
      technician: this.data.technicians[index] || this.data.technicians[0] || null
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
    const availability = await api.getAvailability(
      this.data.service._id,
      this.data.appointmentDate,
      this.data.selectedAddOns,
      this.data.technician ? this.data.technician.id : ''
    )
    const tech = this.data.technician || availability.technician
    const techEntry = availability.slotsByTech
      ? availability.slotsByTech.find((item) => item.technician.id === tech.id)
      : null
    const slots = (techEntry && techEntry.slots && techEntry.slots.length)
      ? techEntry.slots
      : availability.slots && availability.slots.length ? availability.slots : mock.timeSlots
    const nextTime = slots.indexOf(this.data.appointmentTime) >= 0 ? this.data.appointmentTime : slots[0]
    this.setData({
      timeSlots: slots,
      appointmentTime: nextTime,
      service: Object.assign({}, this.data.service, { duration: availability.durationMin || this.data.service.duration }),
      technician: tech || availability.technician
    })
  },

  chooseImage() {
    const left = 3 - this.data.referenceImages.length
    if (left <= 0) {
      wx.showToast({ title: this.data.t.imageLimit, icon: 'none' })
      return
    }
    const handlePaths = (paths) => {
        const fileSystem = wx.getFileSystemManager()
        const dataImages = []
      paths.forEach((filePath) => {
          try {
            const base64 = fileSystem.readFileSync(filePath, 'base64')
            dataImages.push(`data:image/jpeg;base64,${base64}`)
          } catch (error) {
            dataImages.push(filePath)
          }
        })
        this.setData({
        referenceImages: this.data.referenceImages.concat(paths).slice(0, 3),
          referenceDataImages: this.data.referenceDataImages.concat(dataImages).slice(0, 3)
        })
      }
    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: left,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
        success: (res) => handlePaths((res.tempFiles || []).map((item) => item.tempFilePath))
      })
      return
    }
    wx.chooseImage({
      count: left,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => handlePaths(res.tempFilePaths || [])
    })
  },

  removeImage(event) {
    const index = event.currentTarget.dataset.index
    const images = this.data.referenceImages.slice()
    images.splice(index, 1)
    const dataImages = this.data.referenceDataImages.slice()
    dataImages.splice(index, 1)
    this.setData({ referenceImages: images, referenceDataImages: dataImages, referenceAnalysis: null })
  },

  async analyzeReference() {
    if (!this.data.referenceDataImages.length || this.data.isAnalyzingReference) return
    this.setData({ isAnalyzingReference: true })
    try {
      const result = await api.analyzeReference({
        lang: this.data.lang,
        serviceId: this.data.service._id,
        image: this.data.referenceDataImages[0],
        images: this.data.referenceDataImages
      })
      const analysis = result.data || result
      this.setData({
        referenceAnalysis: analysis,
        referencePriceText: analysis.estimatedPriceCents ? `CAD $${Math.round(analysis.estimatedPriceCents / 100)}` : (this.data.lang === 'en' ? 'Manual quote' : '需人工报价'),
        referenceMessage: this.data.lang === 'en' ? (analysis.clientMessageEn || analysis.priceMessageEn || '') : (analysis.clientMessageZh || analysis.priceMessageZh || '')
      })
    } catch (error) {
      wx.showToast({ title: error.message || 'AI 分析暂不可用', icon: 'none' })
    } finally {
      this.setData({ isAnalyzingReference: false })
    }
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
        referenceDataImages: this.data.referenceDataImages,
        referenceAnalysis: this.data.referenceAnalysis,
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
