const { curOf, ensureCurrencyCached } = require('../../utils/storecurrency')
const storage = require('../../utils/storage')
const i18n = require('../../utils/i18n')
const api = require('../../utils/api')

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
    ensureCurrencyCached()
    this.setData({ cur: curOf() })   // 币种跟门店走,不写死 ${curOf().p}${curOf().s}

    if (this.serviceId) this.refresh()
  },

  async refresh() {
    const lang = i18n.getLang()
    i18n.applyTabBar(lang)
    const service = i18n.localizeService(await api.getService(this.serviceId, lang), lang)
    if (!service) {
      wx.showToast({ title: i18n.pageCopy('booking', lang).missing, icon: 'none' })
      setTimeout(() => wx.navigateBack(), 600)
      return
    }
    const isNail = service.type === 'nail'
    // D49:详情价格与列表同源(priceDetailLabel:多档=起+档说明;单档才是固定价/基础价);旧 label 兜底老后端
    service.priceLabel = lang === 'en'
      ? (service.priceDetailLabelEn || service.priceLabelEn || `${isNail ? 'Base price' : 'Fixed price'} ${curOf().p}${curOf().s}${service.price}`)
      : (service.priceDetailLabelZh || service.priceLabelZh || `${isNail ? '基础价' : '固定价'} ${curOf().p}${curOf().s}${service.price}`)
    service.quoteHint = lang === 'en'
      ? (service.quoteHintEn || (isNail ? 'Contact us for a detailed quote' : 'Confirmed add-ons make the final quote'))
      : (service.quoteHintZh || (isNail ? '详细价格请联系客服获取报价' : '加项确认后即为最终报价'))
    service.priceExplanation = lang === 'en'
      ? (service.priceExplanationEn || (isNail ? 'Displayed price is the base service price. Complex designs, extensions, removal, special materials, 3D charms, or heavy rhinestones require manual quotation.' : 'Lash services use fixed pricing. Selected add-ons will be shown before checkout and become the final quote.'))
      : (service.priceExplanationZh || (isNail ? '显示价格为基础服务价。复杂手绘、延长、卸甲、特殊材料、3D 装饰或大面积钻饰需要人工报价。' : '美睫款式为固定报价。加项会在结算前明确显示，确认后即为最终报价。'))
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
        // D21:快捷加购不指派假技师;去 booking 页(购物车「修改」)真选后才能下单
        technicianId: '',
        technicianName: '',
        addOns: [],
        referenceImages: [],
        remark: ''
      }
    })
    wx.showToast({ title: i18n.pageCopy('booking', i18n.getLang()).added, icon: 'success' })
  }
})
