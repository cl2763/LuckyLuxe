const storage = require('../../utils/storage')
const nav = require('../../utils/nav')
const { curOf, ensureCurrencyCached } = require('../../utils/storecurrency')
const i18n = require('../../utils/i18n')
const api = require('../../utils/api')

Page({
  onShow() {
    ensureCurrencyCached()
    this.setData({ cur: curOf() })   // 币种跟门店走,不写死币符
  },
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
      const service = order.service || (order.serviceInfo && { name: order.serviceInfo.serviceName, type: order.serviceInfo.serviceType, duration: order.serviceInfo.duration }) || {} // mock 清除
      const localizedService = i18n.localizeService(service, lang)
      order.statusText = i18n.statusText(order.status, lang)
      order.serviceImage = service.image || order.serviceImage || '/assets/images/store-cover.jpg'
      order.serviceInfo.serviceName = localizedService.name || order.serviceInfo.serviceName
      // D21:不再用写死的假技师名(Mia Chen/Ava Lin)填空 —— 没有就不显示
      order.visibleWorkImages = order.status === 'completed' || order.status === 'after_sales' ? (order.workImages || []).slice(0, 6) : []
      /* 批③首件 A2/A6(§二重做):签署单卡=后端 flow 一条五步账直贴(与签署页/快照同源,零拼装);
         旧「实付」行随 flow 消亡(480 表达错误销案)。y() 仅格式化,无运算。 */
      if (order.payment) {
        const y = (c) => (c % 100 ? (c / 100).toFixed(2) : String(Math.round(c / 100)))
        order.pay = {
          code: order.payment.code,
          signedAt: String(order.payment.signedAt || '').slice(0, 16).replace('T', ' '),
          flowLines: (order.payment.flow && order.payment.flow.lines) || [],
          heroLabel: (order.payment.flow && order.payment.flow.heroLabel) || '本单到店支付',
          heroText: (order.payment.flow && order.payment.flow.cashDueText) || '',
          listTotal: y(order.payment.listTotalCents),
          // D67③:组内逐张原件行(映射层零裁剪——toMiniBooking 裁字段教训同族,挑字段处必须点名带上)
          sheetLinks: order.payment.sheetLinks || [],
          /* L3 裁(店主 08-22):多张单详情=逐张签署单卡+顶部组汇总行(=Σ各张头条,与组卡同构) */
          sheets: (order.payment.sheets || []).map((sh, i) => ({
            ...sh,
            idx: i,
            flowLines: (sh.flow && sh.flow.lines) || [],
            heroLabel: (sh.flow && sh.flow.heroLabel) || '本单到店支付',
            heroText: (sh.flow && sh.flow.cashDueText) || '',
            signedAtText: sh.signedAt ? String(sh.signedAt).slice(0, 16).replace('T', ' ') : '',
            // D68②:原件=悬浮图片查看器(快照 SVG 绝对地址;未签署单没有快照,点了走签署页)
            snapUrl: sh.snapshotUrl ? `${api.API_BASE}${sh.snapshotUrl}` : ''
          })),
          groupCashLabel: order.payment.groupCashLabel || '',
          groupCashText: order.payment.groupCashDueText || ''
        }
      }
      // 价格拆解:总价 / 定金 / 到店应付(不同来源字段不一,统一补算)
      const price = order.servicePrice || (order.items || []).reduce((s, it) => s + (Number(it.price) || 0) * (it.quantity || 1), 0) || (service.price || 0)
      const deposit = Number(order.payableAmount) || (order.serviceInfo && order.serviceInfo.depositAmount) || 0
      order.servicePrice = price
      order.payableAmount = deposit
      order.finalDue = order.finalDue != null && order.finalDue !== '' ? order.finalDue : Math.max(0, price - deposit - (Number(order.balanceDeduction) || 0))
    }
    this.setData({ order, lang, t })
  },

  /* ===== 批③首件 屏B:售后发起(同屏展开,拍板①②③)+签署单原件入口 ===== */
  /* D68②(店主 08-23):原件=**悬浮图片查看器**(浮层 + 多张左右滑动切换),
     不再跳整页——跳页会压栈(D68① 同族),看三张原件要按三次返回。
     未签署的单没有快照,点了才走签署页(那是去签字,不是看原件)。 */
  openViewer(e) {
    const o = this.data.order
    if (!o || !o.pay) return
    const sheets = (o.pay.sheets && o.pay.sheets.length ? o.pay.sheets : [{ idx: 0, code: o.pay.code, label: '服务确认单', snapUrl: o.pay.code ? `${api.API_BASE}/settlements/${encodeURIComponent(o.pay.code)}/snapshot` : '', status: 'signed' }])
    const items = sheets.filter((sh) => sh.snapUrl).map((sh) => ({ code: sh.code, label: sh.label || '服务确认单', url: sh.snapUrl }))
    const wantCode = e && e.currentTarget && e.currentTarget.dataset.code
    const target = sheets.find((sh) => sh.code === wantCode) || sheets[0]
    if (!items.length || (wantCode && target && !target.snapUrl)) {
      // 待签署单:没有原件可看,直接去签(这一步是签字动线,不是看图)
      if (target && target.code) nav.to(`/pages/sign/index?code=${encodeURIComponent(target.code)}`)
      return
    }
    const index = Math.max(0, items.findIndex((it) => it.code === (target ? target.code : items[0].code)))
    this.setData({ viewer: { open: true, index, items } })
  },
  // D68③:切页/滑动/箭头全在共用组件里(components/snapshot-viewer),页面只负责开关与喂数据
  closeViewer() { this.setData({ viewer: null }) },
  asAction() {
    const o = this.data.order
    if (!o) return
    if (o.afterSalesAction === 'progress') {
      // 进行中=滚到进度卡(卡就在本页);同屏,无跳转
      this.setData({ asPanelOpen: false })
      wx.pageScrollTo({ selector: '.as-progress-card', duration: 200, fail: () => {} })
      return
    }
    if (o.afterSalesAction === 'start') this.setData({ asPanelOpen: !this.data.asPanelOpen })
  },
  onAsDesc(e) { this.setData({ asDesc: e.detail.value }) },
  async submitAfterSales() {
    const desc = String(this.data.asDesc || '').trim()
    if (!desc) { wx.showToast({ title: '问题描述必填', icon: 'none' }); return }
    if (this.data.asSubmitting) return
    this.setData({ asSubmitting: true })
    try {
      await api.startAfterSales(this.data.order._id, desc)
      wx.showToast({ title: '已发起售后,门店会尽快跟进', icon: 'none', duration: 2200 })
      this.setData({ asPanelOpen: false, asDesc: '' })
      storage.setOrders([])   // 缓存失效,强制回源刷新徽标/进度
      this.load(this.data.order._id)
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '发起失败,请稍后再试', icon: 'none' })
    } finally { this.setData({ asSubmitting: false }) }
  },
  async withdrawAfterSales() {
    if (this.data.asSubmitting) return
    this.setData({ asSubmitting: true })
    try {
      await api.withdrawAfterSales(this.data.order._id)
      wx.showToast({ title: '已撤回(记录保留)', icon: 'none' })
      storage.setOrders([])
      this.load(this.data.order._id)
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '撤回失败', icon: 'none' })
    } finally { this.setData({ asSubmitting: false }) }
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
      },
      fail: (e) => console.warn('[showModal fail]', e) // S组卫生批:fail=开发者域错误,console 留痕不弹 UI(toast 会撞转场,D27 家族)
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
