const { curOf, ensureCurrencyCached } = require('../../utils/storecurrency')
const storage = require('../../utils/storage')
const i18n = require('../../utils/i18n')
const api = require('../../utils/api')

Page({
  onShow() {
    ensureCurrencyCached()
    this.setData({ cur: curOf() })   // 币种跟门店走,不写死币符
  },
  data: {
    items: [],
    lang: 'zh',
    t: i18n.pageCopy('checkout', 'zh'),
    store: {},          // D17:初始不摆 mock 门店占位
    serviceDeposit: 0,
    depositRequired: 0,
    depositWaived: false,
    depositWaivedAmount: 0,
    couponDiscount: 0,
    useBalance: false,
    balanceDeduction: 0,
    memberBalance: 0,
    payableAmount: 0,
    remark: '',
    policy: null,        // GET /deposit-policy 原样下发,前端不加工
    payActionText: ''    // 线上支付未接通时按钮说「到店支付定金」,接通后自动变「支付定金」
  },

  onLoad(options) {
    const lang = i18n.getLang()
    i18n.applyTabBar(lang)
    i18n.setTitle(i18n.pageCopy('checkout', lang).title)
    const ids = options.ids ? options.ids.split(',') : []
    const items = storage.getCart()
      .filter((item) => ids.indexOf(item._id) >= 0)
      .map((item) => {
        /* 🔴 D17 同类(2026-08-11 L2 补扫):原来是 mock.findService(...) || item.service ——
           **假数据排在真数据前面**,serviceId 一旦撞上 mock 表里的 id,结账页显示的
           就是编造的项目名与价格。购物车项自己带着加购时的真服务,直接用它。 */
        const service = i18n.localizeService(item.service, lang)
        return Object.assign({}, item, {
          service: Object.assign({}, item.service, service)
        })
      })
    this.setData({ items, lang, t: i18n.pageCopy('checkout', lang) })
    this.calculate()
    this.loadDepositPolicy(items[0] && items[0].serviceId)
    this.loadStore(lang)   // D17 同类:结账页的门店也要取真的,不摆 mock.store
  },

  /* D17 同类:结账页门店信息取真门店。取不到**留空**而不是回 mock ——
     结账是掏钱的一步,写错门店名比写不出门店名严重得多;这里不拦下单(与定金规则同策)。 */
  async loadStore(lang) {
    try {
      const stores = await api.getStores()
      this.setData({ store: i18n.localizeStore(stores[0] || {}, lang) })
    } catch (e) {
      this.setData({ store: {} })
    }
  },

  /* 屏 3 定金规则:金额/三要点/原文都由后端按本店 deposit_config 生成。
     不在这里拼文案 —— 后台屏 4 的预览读的是同一份,拼两版早晚对不上。
     取不到就静默退回原来的静态文案,不拦顾客下单。 */
  async loadDepositPolicy(serviceId) {
    try {
      const zh = this.data.lang !== 'en'
      const raw = await api.getDepositPolicy(serviceId ? `serviceId=${encodeURIComponent(serviceId)}` : '')
      // 端点是 zh/en 一起下发的,这里按当前语言各取一份
      const policy = Object.assign({}, raw, {
        text: (zh ? raw.text.zh : raw.text.en) || raw.text.zh,
        keyFacts: (zh ? raw.keyFacts.zh : raw.keyFacts.en) || raw.keyFacts.zh
      })
      const payActionText = policy.enabled
        ? (policy.onlinePaymentReady
          ? (zh ? `支付定金 ${policy.amountText}` : `Pay deposit ${policy.amountText}`)
          : (zh ? `确认预约 · 到店支付定金 ${policy.amountText}` : `Confirm · pay ${policy.amountText} in store`))
        : (zh ? '确认预约' : 'Confirm booking')
      this.setData({ policy, payActionText })
    } catch (e) { /* 静默:退回页面自带的静态文案 */ }
  },

  calculate() {
    const member = wx.getStorageSync('lucky_member') || {}
    const depositWaived = Boolean(member.depositWaived)
    const depositRequired = this.data.items.reduce((sum, item) => sum + item.service.depositAmount * item.quantity, 0)
    const serviceDeposit = depositWaived ? 0 : depositRequired
    const memberBalance = Number(member.balance) || 0
    // 储值余额抵扣定金:开关打开时,从余额里扣(最多扣到定金金额);余额充足则无需微信支付
    const balanceDeduction = this.data.useBalance ? Math.min(memberBalance, serviceDeposit) : 0
    const payableAmount = Math.max(0, serviceDeposit - balanceDeduction)
    this.setData({
      serviceDeposit,
      depositRequired,
      depositWaived,
      depositWaivedAmount: depositWaived ? depositRequired : 0,
      memberBalance,
      balanceDeduction,
      payableAmount
    })
  },

  toggleBalance(event) {
    this.setData({ useBalance: event.detail.value })
    this.calculate()
  },

  inputRemark(event) {
    this.setData({ remark: event.detail.value })
  },

  promptLogin() {
    wx.showModal({
      title: this.data.lang === 'en' ? 'Sign in required' : '需要登录',
      content: this.data.lang === 'en'
        ? 'Please sign in with WeChat before submitting this booking.'
        : '提交预约和支付定金前需要先完成微信登录。',
      confirmText: this.data.lang === 'en' ? 'Go sign in' : '去登录',
      cancelText: this.data.lang === 'en' ? 'Cancel' : '取消',
      confirmColor: '#C6A27E',
      success: (res) => {
        if (res.confirm) wx.switchTab({ url: '/pages/me/index' })
      }
    })
  },

  async submitOrder() {
    if (!this.data.items.length) {
      wx.showToast({ title: this.data.t.noItems, icon: 'none' })
      return
    }
    if (!api.isLoggedIn()) {
      this.promptLogin()
      return
    }
    /* 🔴 D20(店主 2026-08-11 拍板,《财务总逻辑》v1.5.1 §十-2):失败=失败。
       以前这里 catch 完**没有 return**,后端一单都没建成也照样:写一张
       paymentStatus:'paid' 的本地假订单 → 清空购物车 → 跳成功页(当时文案还是支付类措辞)。
       顾客以为约成功且付过款,实际什么都没发生 —— 本轮红条里最重的一处。
       现在:任何一单失败就停在结账页,如实报错,购物车原样保留。 */
    const now = Date.now()
    const first = this.data.items[0]
    const backendBookings = []
    try {
      for (let index = 0; index < this.data.items.length; index += 1) {
        const created = await api.createBooking(this.data.items[index], this.data.remark)
        // 沙盘联调:线上支付未接通,后端 mock 支付口只在本地生效;生产接微信支付后替换
        const paid = created && created.id && created.status === 'PENDING_PAYMENT' && created.depositCents > 0
          ? await api.confirmMockPayment(created.id)
          : created
        backendBookings.push(paid)
      }
    } catch (error) {
      if (error.code === 'AUTH_REQUIRED') {
        this.promptLogin()
        return
      }
      wx.showToast({ title: error.message || '预约提交失败，请稍后重试', icon: 'none' })
      return
    }
    const firstBackendBooking = backendBookings[0]
    if (!firstBackendBooking || !firstBackendBooking.id) {
      wx.showToast({ title: '预约提交失败，请稍后重试', icon: 'none' })
      return
    }
    /* D21:技师名只取后端返回,不再兜底写死的 Mia Chen。
       D20:本地只存一份**展示用**回执(成功页要显示单号/项目/时间),
       不造 paymentStatus / transactionId —— 支付与订单状态以后端为唯一真相,
       订单列表页每次加载都从后端取,这份本地回执只是离线兜底展示。 */
    const technicianName = firstBackendBooking.technician ? firstBackendBooking.technician.name : (first.appointmentInfo.technicianName || '')
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
      backendBookingId: firstBackendBooking.id,
      backendBookingIds: backendBookings.map((item) => item && item.id).filter(Boolean),
      appointment: first.appointmentInfo,
      store: this.data.store,
      couponId: '',
      couponDiscount: this.data.couponDiscount,
      balanceDeduction: this.data.balanceDeduction,
      payableAmount: this.data.payableAmount,
      remark: this.data.remark,
      status: firstBackendBooking.status || 'CONFIRMED',
      createdAt: now,
      updatedAt: now
    }
    storage.addOrder(order)
    storage.removeCartItems(this.data.items.map((item) => item._id))
    wx.navigateTo({ url: `/pages/payment-success/index?orderNo=${order.orderNo}` })
  }
})
