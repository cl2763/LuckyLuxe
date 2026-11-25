const api = require('../../utils/api')
const nav = require('../../utils/nav')

Page({
  data: { loading: true, pack: null, error: '', filter: 'all', showHistory: false, filters:[{key:'all',name:'全部'},{key:'coupon',name:'优惠券'},{key:'service',name:'服务权益'},{key:'physical',name:'实物'}] },

  onShow() { this.load() },

  async load() {
    if (!api.isLoggedIn()) { this.setData({ loading: false, pack: null, error: '登录后查看卡包' }); return }
    try {
      const r = await api.getCardPack()
      this.setData({ loading: false, pack: r.cardPack, error: '' })
    } catch (e) {
      this.setData({ loading: false, pack: null, error: (e && e.message) || '卡包加载失败' })
    }
  },

  filterChange(e) { this.setData({filter:e.currentTarget.dataset.key}) },
  toggleHistory() { this.setData({showHistory:!this.data.showHistory}) },
  goMall() { nav.to('/pages/mall/index') },
  goMallTimecards() { nav.to('/pages/mall/index?focus=timecard') },
  toggleCard(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [`open.${key}`]: !((this.data.open || {})[key]) })
  }
})
