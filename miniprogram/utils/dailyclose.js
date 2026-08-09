/* 日结(屏 1 下半)+ 金额更正(屏 1b)的**唯一一份实现**。
   设计图把日结画在「订单页 · 今日台面」网格下方,同时工资试算的「去日结」还要能直达 ——
   两处渲染同一套逻辑,所以抽成 mixin:两边 Object.assign 进 Page 选项即可,
   不会出现「改了一边忘了另一边」。

   金额红线:这里不算钱。分成比例是店长填的输入,金额一律由后端算好回传;
   进度/差额/合计全部照 /admin/daily-close 的返回值显示。 */
const api = require('./api')
const { storeToday } = require('./storeclock')
const { formatMoney, displayOf } = require('./money')

function shiftDate(d, n) {
  const x = new Date(`${d}T12:00:00Z`)
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}

// 两处共用的初始 data(展开进各自 Page 的 data)
const dailyCloseData = {
  date: '', loading: true, v: null, open: {}, shares: {},
  correcting: null, newTotal: '', reason: ''
}

const dailyCloseMixin = {


  async loadClose(date) {
    this.setData({ date, loading: true })
    try {
      const r = await api.adminGet(`/admin/daily-close?date=${encodeURIComponent(date)}`)
      const d = displayOf(r.dailyClose)
      const m = (c) => formatMoney(c, d, d.trimZeroDecimals ? 0 : 2)
      const dc = r.dailyClose
      const open = {}
      const shares = {}
      ;(dc.pendingAllocation || []).forEach((p, i) => {
        open[p.settlementId] = i === 0 // 第一张默认展开,其余收起(设计图:一开一收)
        p.technicians.forEach((t, j) => {
          shares[`${p.settlementId}|${t.technicianId}`] = p.technicians.length === 1
            ? 100
            : (j === 0 ? p.defaultSplit.mainPct : p.defaultSplit.assistPct)
        })
      })
      this.raw = dc
      this.setData({
        loading: false, open, shares,
        v: {
          date: dc.date,
          confirmed: dc.status === 'confirmed',
          confirmedAt: String(dc.confirmedAt || '').slice(0, 16).replace('T', ' '),
          reopenCount: dc.reopenCount,
          orderCount: dc.orderCount,
          revenue: m(dc.revenueCents),
          canConfirm: dc.canConfirm,
          blockers: (dc.blockers || []).map((b) => b.message),
          pending: (dc.pendingAllocation || []).map((p) => ({
            // 分成基数=业绩基数(券不扣技师);无券时与应收相等
            id: p.settlementId, code: p.code, timeText: p.timeText || '', crossDayNote: p.crossDayNote || '', total: m(p.perfBaseCents === undefined ? p.totalCents : p.perfBaseCents),
            couponNote: p.couponDiscountCents ? '业绩基数(不含券)' : '',
            who: p.servedPersonName || p.customerName || '',
            techLabel: p.technicians.length > 1 ? '双技师' : '单技师',
            techs: p.technicians.map((t, j) => ({
              id: t.technicianId, name: t.name,
              role: t.role === 'main' ? '主' : '副',
              nos: t.itemNos.join('、'),
              pct: p.technicians.length === 1 ? 100 : (j === 0 ? p.defaultSplit.mainPct : p.defaultSplit.assistPct)
            })),
            hasSnapshot: (dc.settlements.find((s) => s.settlementId === p.settlementId) || {}).hasSnapshot
          })),
          // 不需要分配、但同样要店长点确认的单(店主 08-09 口径:确认覆盖当日全部单)
          awaiting: (dc.awaitingConfirm || []).map((p) => ({
            id: p.settlementId, code: p.code, timeText: p.timeText || '', crossDayNote: p.crossDayNote || '',
            who: p.servedPersonName || p.customerName || '',
            amount: m(p.perfBaseCents),
            reason: p.reason,
            techs: p.technicians.map((t) => `${t.name}${t.sharePct !== null && t.sharePct !== undefined ? ` ${t.sharePct}%` : ''}`).join(' / '),
            hasSnapshot: p.hasSnapshot
          })),
          techs: (dc.technicians || []).map((t) => ({
            name: t.name, orderCount: t.orderCount,
            perf: t.pendingCount ? '待分配' : m(t.perfCents),
            card: m(t.cardUsedCents),
            recharge: t.rechargeTotalCents ? m(t.rechargeTotalCents) : '—',
            target: !t.target || !t.target.perfTargetCents ? '—'
              : (t.perfCents >= t.target.perfTargetCents ? '达标' : `差 ${m(t.target.perfTargetCents - t.perfCents)}`),
            hit: Boolean(t.target && t.target.perfTargetCents && t.perfCents >= t.target.perfTargetCents)
          })),
          tierChanges: (dc.anomalies?.tierChanges || []).map((a) => `${a.code} ${a.from}→${a.to}`),
          freeRemoval: (dc.anomalies?.freeRemoval || {}).count || 0
        }
      })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: (e && e.message) || '加载日结失败', icon: 'none' })
    }
  },

  prevDay() { this.loadClose(shiftDate(this.data.date, -1)) },
  nextDay() { this.loadClose(shiftDate(this.data.date, 1)) },
  closeToday() { this.loadClose(storeToday()) },
  toggleOpen(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ [`open.${id}`]: !this.data.open[id] })
  },
  onShare(e) {
    const { sid, tid } = e.currentTarget.dataset
    this.setData({ [`shares.${sid}|${tid}`]: e.detail.value })
  },
  async saveAlloc(e) {
    const sid = e.currentTarget.dataset.id
    const row = this.raw.pendingAllocation.find((p) => p.settlementId === sid)
    const shares = row.technicians.map((t) => ({
      technicianId: t.technicianId,
      pct: Number(this.data.shares[`${sid}|${t.technicianId}`]) || 0
    }))
    try {
      await api.adminPost(`/admin/settlements/${encodeURIComponent(sid)}/allocate`, { shares })
      wx.showToast({ title: '业绩已分配', icon: 'none' })
      this.loadClose(this.data.date)
    } catch (err) { wx.showToast({ title: (err && err.message) || '分配失败', icon: 'none' }) }
  },
  viewSnapshot(e) {
    const code = e.currentTarget.dataset.code
    wx.showModal({
      title: '签署单', showCancel: false, confirmText: '知道了',
      content: `单号 ${code}\n签署快照是顾客签字那一刻生成的凭证,不可修改。\n在网页后台「财务 → 日结」可直接打开查看。`
    })
  },

  // ===== 屏 1b 金额更正 =====
  async startCorrect(e) {
    const code = e.currentTarget.dataset.code
    try {
      const r = await api.adminGet(`/settlements/${encodeURIComponent(code)}`)
      const s = r.settlement
      const d = displayOf(s)
      const m = (c) => formatMoney(c, d, d.trimZeroDecimals ? 0 : 2)
      this.setData({
        newTotal: String(s.totalCents / 100),
        reason: '',
        correcting: {
          id: s.id, code: s.code,
          who: s.servedPersonName || '',
          proxy: s.isProxyPaid,
          signedAt: String(s.signedAt || '').slice(0, 16).replace('T', ' '),
          techs: (s.technicians || []).map((t) => `${t.name}(${t.role === 'main' ? '主' : '副'})`).join('/'),
          items: (s.items || []).map((l) => `${String(l.itemNo).padStart(2, '0')} ${l.name} ${l.isFree ? '免收' : m(l.amountCents)}`),
          deposit: s.depositDeductCents ? `−${m(s.depositDeductCents)}` : '',
          total: m(s.totalCents)
        }
      })
    } catch (err) { wx.showToast({ title: (err && err.message) || '读不到这张单', icon: 'none' }) }
  },
  cancelCorrect() { this.setData({ correcting: null }) },
  onNewTotal(e) { this.setData({ newTotal: e.detail.value }) },
  onReason(e) { this.setData({ reason: e.detail.value }) },
  async submitCorrect() {
    const reason = (this.data.reason || '').trim()
    if (!reason) { wx.showToast({ title: '原因必填', icon: 'none' }); return }
    const cents = Math.max(0, Math.round(Number(String(this.data.newTotal).replace(/[^\d.]/g, '')) * 100) || 0)
    try {
      const r = await api.adminPost(`/admin/settlements/${encodeURIComponent(this.data.correcting.id)}/amend`, { totalCents: cents, reason })
      wx.showToast({ title: r.autoBalanceAdjustCents ? '已更正,储值差额已自动补配' : '已更正,原签署单未改动', icon: 'none', duration: 2400 })
      this.setData({ correcting: null })
      this.loadClose(this.data.date)
    } catch (err) { wx.showToast({ title: (err && err.message) || '更正失败', icon: 'none' }) }
  },

  async confirmClose() {
    try {
      await api.adminPost('/admin/daily-close', { date: this.data.date })
      wx.showToast({ title: '日结已确认,业绩定格', icon: 'none' })
      this.loadClose(this.data.date)
    } catch (e) { wx.showToast({ title: (e && e.message) || '确认失败', icon: 'none' }) }
  },
  reopen() {
    wx.showModal({
      title: '重开日结', editable: true, placeholderText: '必须写原因(会留痕)',
      success: async (r) => {
        if (!r.confirm || !r.content || !r.content.trim()) return
        try {
          await api.adminPost('/admin/daily-close/reopen', { date: this.data.date, reason: r.content.trim() })
          wx.showToast({ title: '已重开,可以改分成了', icon: 'none' })
          this.loadClose(this.data.date)
        } catch (e) { wx.showToast({ title: (e && e.message) || '重开失败', icon: 'none' }) }
      }
    })
  }
}

module.exports = { dailyCloseData, dailyCloseMixin, shiftDate }
