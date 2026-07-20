const api = require('../../utils/api')

Page({
  data: { points: 0, records: [] },
  async onShow() {
    await api.refreshMember()
    const m = wx.getStorageSync('lucky_member') || {}
    let records = []
    try {
      const r = await api.getMyPointsHistory()
      records = (r.records || []).map((x) => ({ id: x.id, title: x.title, date: x.date, delta: '+' + x.delta, up: true }))
    } catch (e) { /* 未登录/无记录 */ }
    this.setData({ points: m.points || 0, records })
  },
  soon() { wx.showToast({ title: '积分商城即将上线', icon: 'none' }) }
})
