const storage = require('../../utils/storage')
const { curOf, ensureCurrencyCached } = require('../../utils/storecurrency')
const i18n = require('../../utils/i18n')
const api = require('../../utils/api')

const tabs = [
  { key: 'all', labelKey: 'all' },
  { key: 'pending_service', labelKey: 'statusPendingService' },
  { key: 'completed', labelKey: 'statusCompleted' },
  { key: 'cancelled', labelKey: 'statusCancelled' },
  { key: 'after_sales', labelKey: 'statusAfterSales' }
]

Page({
  data: {
    tabs,
    lang: 'zh',
    t: i18n.pageCopy('orders', 'zh'),
    activeStatus: 'all',
    showTabs: true,
    orders: [],
    pendingSign: []   // D57 待签署置顶卡
  },

  onLoad(options) {
    /* D14(店主 2026-08-10 开检):「我的订单」四个板块点进去,顶部还有一条横滑筛选。
       从「全部」进来才需要筛选条;带着状态进来(待服务/已完成/已取消/售后)时,
       这一条既多余又容易让人以为自己点错了 —— 右上角「全部」已经能看全部。 */
    const st = options.status || 'all'
    this.setData({ activeStatus: st, showTabs: st === 'all' })
  },

  noop() {},
  /* 规则③ 单据页只有一张、处处可达:售后卡「查看服务确认单」进的是**同一张**页面
     (web-view 包的网页 /sign),与消费记录点开完全同一实现。 */
  goSettlementDoc(e) {
    const code = e.currentTarget.dataset.code
    if (!code) return
    wx.navigateTo({ url: `/pages/sign/index?code=${encodeURIComponent(code)}` })
  },

  onShow() {
    ensureCurrencyCached()
    this.setData({ cur: curOf() })   // 币种跟门店走,不写死币符

    this.refresh()
  },

  switchStatus(event) {
    this.setData({ activeStatus: event.currentTarget.dataset.status })
    this.refresh()
  },

  async refresh() {
    const lang = i18n.getLang()
    const t = i18n.pageCopy('orders', lang)
    i18n.applyTabBar(lang)
    i18n.setTitle(t.title)
    if (!api.isLoggedIn()) {
      this.setData({
        lang,
        t,
        tabs: tabs.map((item) => Object.assign({}, item, { label: t[item.labelKey] })),
        orders: []
      })
      return
    }
    let sourceOrders = []
    try {
      sourceOrders = await api.getBookings(lang)
      if (sourceOrders.length) storage.setOrders(sourceOrders)
    } catch (error) {
      sourceOrders = storage.getOrders()
    }
    /* D57(店主 08-21 批②尾清):待签单置顶卡——列出**全部**未签单(不止最新一张,
       即时开单没挂预约的也在);点卡直达签署页;签完/撤回自然消失。拉不到不挡订单列表。 */
    let pendingSign = []
    try { pendingSign = (await api.getMyPendingSign()).pendingSign || [] } catch (e) { /* 未登录/网络失败不挡列表 */ }
    const orders = sourceOrders.map((item) => {
      const service = item.service || (item.serviceInfo && { name: item.serviceInfo.serviceName, type: item.serviceInfo.serviceType, duration: item.serviceInfo.duration }) || {} // mock 清除:同 me 页
      const localizedService = i18n.localizeService(service, lang)
      return Object.assign({}, item, {
        statusText: i18n.statusText(item.status, lang),
        serviceName: localizedService.name || item.serviceInfo.serviceName,
        serviceImage: service.image || item.serviceImage || '/assets/images/store-cover.jpg'
      })
    })
    this.setData({
      lang,
      t,
      pendingSign,
      tabs: tabs.map((item) => Object.assign({}, item, { label: t[item.labelKey] })),
      orders: this.data.activeStatus === 'all'
        ? orders
        : orders.filter((item) => item.status === this.data.activeStatus)
    })
  },

  goDetail(event) {
    wx.navigateTo({ url: `/pages/order-detail/index?id=${event.currentTarget.dataset.id}` })
  },

  goServices() {
    wx.switchTab({ url: '/pages/services/index' })
  }
})
