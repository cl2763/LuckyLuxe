const api = require('../../../utils/api')
function money(c) { return '$' + Math.round((c || 0) / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') }
function fmtDur(min) { if (!min) return '0m'; const h = Math.floor(min / 60), m = min % 60; return h ? `${h}h${m ? m + 'm' : ''}` : `${m}m` }

Page({
  data: { loading: true, mode: 'none', e: null, old: null, monthText: '', doneCount: 0 },

  onShow() { this.load() },

  async load() {
    const now = new Date()
    this.setData({ monthText: `${now.getFullYear()}年${now.getMonth() + 1}月` })
    // 新薪资方案估算优先(底薪+手工费+阶梯+加班费,与老板配置实时同步);没配方案再退回旧口径
    try {
      const r = await api.adminGet('/admin/salary/my-estimate')
      const est = r.estimate
      if (est && !est.noPlan) {
        this.setData({
          loading: false, mode: 'plan', doneCount: est.orderCount || 0,
          e: {
            total: money(est.totalCents),
            base: money(est.baseSalaryCents), hasBase: est.baseSalaryCents > 0,
            handwork: money(est.handworkCents), hasHandwork: est.handworkCents > 0,
            orderCount: est.orderCount || 0,
            perf: money(est.perfCents), pct: est.pct || 0,
            tierText: est.tierIndex >= 0 ? `第${est.tierIndex + 1}档` : '固定',
            commission: money(est.commissionCents),
            otText: est.overtimeMin ? `${fmtDur(est.overtimeMin)} → ${est.overtimeSegs} 段` : '',
            otPay: money(est.overtimePayCents), hasOt: est.overtimeMin > 0,
            next: est.nextTier ? `再做 ${money(est.nextTier.needCents)} 业绩 → 提点升到 ${est.nextTier.pct}%` : ''
          }
        })
        return
      }
      this.setData({ doneCount: (est && est.orderCount) || 0 })
    } catch (err) { /* 落回旧口径 */ }
    try {
      const r = await api.adminGet('/admin/my-compensation-estimate')
      const est = r.estimate
      if (!est) { this.setData({ loading: false, mode: 'none' }); return }
      this.setData({
        loading: false, mode: 'old',
        old: {
          revenue: money(est.monthRevenueCents),
          base: money(est.baseSalaryCents),
          rate: Math.round((est.commissionRate || 0) * 100),
          commission: money(est.commissionCents),
          total: money(est.totalCents)
        }
      })
    } catch (err) { this.setData({ loading: false, mode: 'none' }) }
  }
})
