const api = require('../../../utils/api')
Page({
  data: { userId: '', customerName: '', profile: null, notes: [], loading: true },
  onLoad(q) {
    this.setData({ userId: q.userId || '', customerName: q.name ? decodeURIComponent(q.name) : '顾客' })
  },
  onShow() { if (this.data.userId) this.load() },
  async load() {
    try {
      const r = await api.getCustomerNotes(this.data.userId)
      const p = r.profile || {}
      this.setData({
        loading: false,
        customerName: r.customerName || this.data.customerName,
        profile: {
          visitCount: p.visitCount || 0,
          avgIntervalDays: p.avgIntervalDays,
          topService: p.topService || '—',
          styles: p.styles || [], personality: p.personality || [], preferences: p.preferences || [],
          companions: p.companions || [], safetyFlags: p.safetyFlags || []
        },
        notes: r.notes || []
      })
    } catch (e) { this.setData({ loading: false }); wx.showToast({ title: '加载失败', icon: 'none' }) }
  },
  addNote() {
    wx.navigateTo({ url: `/pages/merchant/service-note/index?userId=${this.data.userId}&name=${encodeURIComponent(this.data.customerName)}` })
  }
})
