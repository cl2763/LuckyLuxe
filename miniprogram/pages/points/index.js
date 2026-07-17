const api = require('../../utils/api')

Page({
  data: { points: 0, records: [] },
  async onShow() {
    const m = wx.getStorageSync('lucky_member') || {}
    let records = []
    try {
      const bks = await api.getBookings('zh')
      // 积分明细由真实"已完成"订单推导:消费 $1 得 1 分,与会员积分同源一致
      records = (bks || []).filter((b) => b.status === 'completed').map((b) => ({
        id: b._id,
        title: '消费获得 · ' + ((b.serviceInfo && b.serviceInfo.serviceName) || '服务'),
        date: (b.appointment && b.appointment.date) || '',
        delta: '+' + Math.floor(Number(b.servicePrice) || 0),
        up: true
      }))
    } catch (e) { /* 未登录/无单则为空 */ }
    this.setData({ points: m.points || 0, records })
  },
  soon() { wx.showToast({ title: '积分商城即将上线', icon: 'none' }) }
})
