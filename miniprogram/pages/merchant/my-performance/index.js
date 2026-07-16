const api = require('../../../utils/api')
function money(c) { return '$' + Math.round((c || 0) / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') }

Page({
  data: { loading: true, hasComp: false, e: null, monthText: '', doneCount: 0 },

  onShow() { this.load() },

  async load() {
    const now = new Date()
    this.setData({ monthText: `${now.getFullYear()}年${now.getMonth() + 1}月` })
    try {
      const [r, bk] = await Promise.all([
        api.adminGet('/admin/my-compensation-estimate'),
        api.adminGet('/admin/bookings').catch(() => ({ bookings: [] }))
      ])
      const mStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
      const doneCount = (bk.bookings || []).filter((b) => b.status === 'COMPLETED' && (b.appointmentDate || '') >= mStart).length
      const est = r.estimate
      if (!est) { this.setData({ loading: false, hasComp: false, doneCount }); return }
      this.setData({
        loading: false, hasComp: true, doneCount,
        e: {
          revenue: money(est.monthRevenueCents),
          base: money(est.baseSalaryCents),
          rate: Math.round((est.commissionRate || 0) * 100),
          commission: money(est.commissionCents),
          total: money(est.totalCents)
        }
      })
    } catch (err) { this.setData({ loading: false, hasComp: false }); wx.showToast({ title: '加载失败', icon: 'none' }) }
  }
})
