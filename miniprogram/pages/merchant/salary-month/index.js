const api = require('../../../utils/api')

function money(c) { return '$' + (Math.round((c || 0)) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 }) }
function fmtDur(min) { if (!min) return '0m'; const h = Math.floor(min / 60), m = min % 60; return h ? `${h}h${m ? m + 'm' : ''}` : `${m}m` }
function pad(n) { return `${n}`.padStart(2, '0') }

Page({
  data: { month: '', monthText: '', rows: [], total: '', locked: false, keyMissing: false, lockedAt: '', locking: false, loading: true, paid: false, paidAt: '', paying: false },

  async onShow() {
    if (!(await api.guardOwner())) return
    if (!this.data.month) {
      const d = new Date()
      this.setData({ month: `${d.getFullYear()}-${pad(d.getMonth() + 1)}` })
    }
    this.load()
  },

  async load() {
    const m = this.data.month
    this.setData({ monthText: `${Number(m.slice(0, 4))}年${Number(m.slice(5, 7))}月`, loading: true })
    if (!api.getFinanceKey()) { this.setData({ keyMissing: true, loading: false }); return }
    try {
      const r = await api.adminGet(`/admin/salary/estimate?month=${m}`)
      const rows = (r.rows || []).map((x) => ({
        ...x, av: (x.name || '技')[0],
        totalText: x.noPlan ? '未配方案' : money(x.totalCents),
        baseText: money(x.baseSalaryCents), handworkText: money(x.handworkCents),
        perfText: money(x.perfCents), commText: money(x.commissionCents),
        otText: x.overtimeMin ? `${fmtDur(x.overtimeMin)} → ${x.overtimeSegs} 段` : '无',
        otPayText: money(x.overtimePayCents),
        pctText: `${x.pct || 0}%${x.tierIndex >= 0 ? `(第${x.tierIndex + 1}档)` : ''}`,
        srcText: x.planSource === 'custom' ? '专属方案' : (x.planSource === 'default' ? '默认方案' : ''),
        cardText: money(x.cardCents), cardUseText: money(x.cardUseCents),
        rechText: money(x.rechargePayCents), rechUseText: money(x.rechargeCents),
        adjText: (x.adjustCents > 0 ? '+' : '') + money(x.adjustCents).replace('$-', '-$')
      }))
      this.setData({
        rows, total: money(r.totalCents), keyMissing: false, loading: false,
        locked: Boolean(r.locked),
        lockedAt: r.lockedAt ? String(r.lockedAt).slice(0, 16).replace('T', ' ') : '',
        paid: Boolean(r.paid),
        paidAt: r.paidAt ? String(r.paidAt).slice(0, 16).replace('T', ' ') : '',
        attrNotes: (r.attributionNotes || []).map((n) => ({ ...n, amountText: money(n.amountCents) }))
      })
    } catch (err) {
      if (err && err.code === 'FINANCE_LOCKED') { this.setData({ keyMissing: true, loading: false }); return }
      this.setData({ loading: false })
      wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' })
    }
  },

  // 确认并锁定当月工资表:快照存档,防事后改数;锁定后 estimate 一律回快照
  lockMonth() {
    if (this.data.locking) return
    wx.showModal({
      title: `锁定 ${this.data.monthText} 工资表`,
      content: '按当前数字生成工资表存档;锁定后业绩/考勤再变动也不影响本月工资。确认?',
      confirmText: '确认锁定',
      success: async (r) => {
        if (!r.confirm) return
        this.setData({ locking: true })
        try {
          await api.adminPost('/admin/salary/lock', { month: this.data.month })
          wx.showToast({ title: '已锁定存档', icon: 'success' })
          this.load()
        } catch (err) { wx.showToast({ title: (err && err.message) || '锁定失败', icon: 'none', duration: 2500 }) }
        this.setData({ locking: false })
      }
    })
  },
  unlockMonth() {
    wx.showModal({
      title: '解锁重算',
      content: `删除 ${this.data.monthText} 的锁定存档,回到实时试算(可重新锁定)。确认?`,
      confirmText: '解锁',
      success: async (r) => {
        if (!r.confirm) return
        try {
          await api.adminPost('/admin/salary/unlock', { month: this.data.month })
          wx.showToast({ title: '已解锁', icon: 'none' })
          this.load()
        } catch (err) { wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none', duration: 2600 }) }
      }
    })
  },
  // 发放入账:逐人写入账本支出(category=工资);账本只追加,发错走红字冲销
  payout() {
    if (this.data.paying) return
    wx.showModal({
      title: `发放 ${this.data.monthText} 工资`,
      content: `将按锁定的工资表,把每人应发金额写入财务账本(支出·工资),合计 ${this.data.total}。入账后不可解锁,发错需红字冲销。确认发放?`,
      confirmText: '确认发放入账',
      success: async (r) => {
        if (!r.confirm) return
        this.setData({ paying: true })
        try {
          const res = await api.adminPost('/admin/salary/payout', { month: this.data.month })
          wx.showToast({ title: `已入账 ${res.count} 人`, icon: 'success' })
          this.load()
        } catch (err) { wx.showToast({ title: (err && err.message) || '发放失败', icon: 'none', duration: 2600 }) }
        this.setData({ paying: false })
      }
    })
  },

  prevMonth() { this.shift(-1) },
  nextMonth() { this.shift(1) },
  shift(n) {
    const [y, m] = this.data.month.split('-').map(Number)
    const d = new Date(y, m - 1 + n, 1)
    this.setData({ month: `${d.getFullYear()}-${pad(d.getMonth() + 1)}` })
    this.load()
  },

  goUnlock() { wx.navigateTo({ url: '/pages/merchant/finance/index' }) },

  // 手动调整(锁定前):补贴填正数,扣款填负数,必须写备注
  adjust(e) {
    if (this.data.locked) { wx.showToast({ title: '已锁定,先解锁再调整', icon: 'none' }); return }
    const { tid, name } = e.currentTarget.dataset
    wx.showModal({
      title: `调整 ${name} 的工资`, editable: true,
      placeholderText: '金额$,可负,如 50 或 -20',
      success: (r) => {
        if (!r.confirm) return
        const v = Number(String(r.content).replace(/[^\d.-]/g, ''))
        if (!Number.isFinite(v) || v === 0) { wx.showToast({ title: '金额无效(填 0 以外的数)', icon: 'none' }); return }
        wx.showModal({
          title: '调整备注(必填)', editable: true, placeholderText: '如:代班补贴 / 迟到扣款',
          success: async (m) => {
            if (!m.confirm) return
            const note = (m.content || '').trim()
            if (!note) { wx.showToast({ title: '备注必填', icon: 'none' }); return }
            try {
              await api.adminRequest('/admin/salary/adjust', 'PUT', { month: this.data.month, technicianId: tid, adjustCents: Math.round(v * 100), note })
              wx.showToast({ title: '已调整', icon: 'success' })
              this.load()
            } catch (err) { wx.showToast({ title: (err && err.message) || '调整失败', icon: 'none', duration: 2500 }) }
          }
        })
      }
    })
  },
  goPlan(e) {
    const { tid, name } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/merchant/salary-plan/index?technicianId=${encodeURIComponent(tid)}&name=${encodeURIComponent(name)}` })
  }
})
