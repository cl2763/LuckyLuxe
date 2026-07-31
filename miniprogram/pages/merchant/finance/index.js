// 2026-08-02 财务页改版(店主 v4 设计稿):hero 三真数+扣待发工资预估(一实一虚)、
// ✦AI智能总结(模板即时生成)、目标圆环(设了才显示,没设只留引导)、记一笔/本月流水入口、设个目标弹窗(智能建议率)。
// 口径与网页端完全一致,同一套 /admin/finance/* 接口。
const api = require('../../../utils/api')

function money(c) {
  const n = Math.round((c || 0) / 100)
  return '$' + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
function localToday() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

Page({
  data: {
    unlocked: false,
    configured: true,
    pwd: '',
    pwd2: '',
    setting: false,
    m: { today: '$0', revenue: '$0', net: '$0' },
    estNote: '',
    ai: [],
    goal: { has: false, rings: [], daily: '' },
    sv: { total: '$0', recharge: '$0', consume: '$0', dormant: '' },
    payroll: { totalCents: 0, total: '$0', monthsText: '' },
    insight: '',
    gm: { show: false, mode: 'net_profit', monthVal: '', rateVal: '25', yearVal: '', suggest: null }
  },

  async onShow() { if (!(await api.guardOwner())) return; this.init() },
  onUnload() { clearInterval(this._rollT) },
  onHide() { clearInterval(this._rollT) },

  async init() {
    if (api.getFinanceKey()) { this.setData({ unlocked: true }); this.loadData(); return }
    try {
      const s = await api.adminGet('/admin/finance/lock-status')
      this.setData({ configured: !!s.configured })
    } catch (e) { /* 忽略 */ }
  },

  onPwd(e) { this.setData({ pwd: e.detail.value }) },
  onPwd2(e) { this.setData({ pwd2: e.detail.value }) },

  async unlock() {
    if (this.data.setting) return
    const pw = this.data.pwd
    if (!pw) { wx.showToast({ title: '请输入财务密码', icon: 'none' }); return }
    if (!this.data.configured && pw !== this.data.pwd2) { wx.showToast({ title: '两次密码不一致', icon: 'none' }); return }
    if (!this.data.configured && pw.length < 4) { wx.showToast({ title: '财务密码至少 4 位', icon: 'none' }); return }
    this.setData({ setting: true })
    try {
      await api.financeUnlock(pw, this.data.configured ? undefined : this.data.pwd2)
      this.setData({ unlocked: true, pwd: '', pwd2: '' })
      this.loadData()
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '解锁失败', icon: 'none' })
    } finally {
      this.setData({ setting: false })
    }
  },

  async loadData() {
    try {
      const [p, sv] = await Promise.all([
        api.adminGet('/admin/finance/progress'),
        api.adminGet('/admin/stored-value')
      ])
      const pr = p.progress || {}
      this._pr = pr
      const rev = pr.revenueCents || 0
      const net = pr.netCents || 0
      // 一实一虚:净赚(已入账)为主数;工资未发放时给"扣待发工资后约"预估(新工资引擎实时值)
      let wagesPending = 0
      let estNote = ''
      try {
        const est = await api.adminGet(`/admin/salary/estimate?month=${pr.month || ''}`)
        if (est && !est.paid && (est.totalCents || 0) > 0) {
          wagesPending = est.totalCents
          estNote = `扣待发工资后约 ${money(net - wagesPending)}(预估)`
        }
      } catch (e) { /* 员工功能未开通等,忽略 */ }
      // ✦ AI 智能总结:有什么数据说什么话(模板即时生成,零等待;外观与将来接真 AI 一致)
      const targets = pr.targets || {}
      const hasTarget = (targets.monthTargetCents || 0) > 0
      const hasFixed = (pr.fixedCents || 0) > 0
      const days = pr.businessDays || {}
      const ai = []
      if ((days.elapsed || 0) > 0 && (pr.paceProjectionCents || 0) > 0) {
        ai.push({ tone: '', text: `照这个节奏,月底预计收入 ${money(pr.paceProjectionCents)}(按已过营业天数推算)` })
      }
      if (hasTarget && hasFixed) {
        if (rev >= pr.breakEvenRevenueCents) ai.push({ tone: 'good', text: `已越过收支平衡线 ${money(pr.breakEvenRevenueCents)}(估算),本月进入盈利区间` })
        else ai.push({ tone: '', text: `距收支平衡线 ${money(pr.breakEvenRevenueCents)}(估算)还差 ${money(pr.breakEvenRevenueCents - rev)}` })
      }
      if (hasTarget) {
        if (rev >= pr.monthRevenueTargetCents) ai.push({ tone: 'good', text: `本月目标 ${money(pr.monthRevenueTargetCents)} 已达成` })
        else if ((days.elapsed || 0) >= 3 && pr.paceProjectionCents > 0 && pr.paceProjectionCents < pr.monthRevenueTargetCents) {
          const gap = pr.monthRevenueTargetCents - pr.paceProjectionCents
          const remain = Math.max(1, (days.total || 1) - (days.elapsed || 0))
          ai.push({ tone: 'warn', text: `按当前节奏月底约 ${money(pr.paceProjectionCents)},距目标差 ${money(gap)},日均再多收 ${money(Math.ceil(gap / remain))} 可追上` })
        }
      }
      if (wagesPending) ai.push({ tone: '', text: `本月工资试算 ${money(wagesPending)} 待发,扣除后净赚约 ${money(net - wagesPending)}` })
      // 目标圆环(设了才显示):月目标 / 收支平衡(配了固定支出) / 年度(单独设了年目标)
      const rings = []
      if (hasTarget) {
        const pct = pr.monthRevenueTargetCents ? Math.min(100, Math.round((rev / pr.monthRevenueTargetCents) * 100)) : 0
        rings.push({ label: '月目标', sub: money(pr.monthRevenueTargetCents), pct, pctText: `${pct}%`, done: pct >= 100, animPct: 0 })
        if (hasFixed && pr.breakEvenRevenueCents > 0) {
          const bePct = Math.min(100, Math.round((rev / pr.breakEvenRevenueCents) * 100))
          rings.push({ label: '收支平衡', sub: `${money(pr.breakEvenRevenueCents)} 估算`, pct: bePct, pctText: rev >= pr.breakEvenRevenueCents ? '已过' : `${bePct}%`, done: rev >= pr.breakEvenRevenueCents, animPct: 0 })
        }
        if (targets.yearTargetCents) {
          const yPct = pr.yearTargetCents ? Math.min(100, Math.round(((pr.yearRevenueCents || 0) / pr.yearTargetCents) * 100)) : 0
          rings.push({ label: '年度', sub: money(pr.yearTargetCents), pct: yPct, pctText: `${yPct}%`, done: yPct >= 100, animPct: 0 })
        }
      }
      this.setData({
        estNote,
        ai,
        goal: {
          has: hasTarget,
          rings,
          daily: hasTarget ? `日均需收 ${money(pr.dailyTargetCents)} · 今日已收 ${money(pr.todayRevenueCents)}` : ''
        }
      })
      this.roll({ todayCents: pr.todayRevenueCents || 0, revCents: rev, netCents: net })
      const s = sv.storedValue || {}
      const accts = (s.accounts || []).slice().sort((a, b) => (b.dormantDays || 0) - (a.dormantDays || 0))
      const d = accts[0]
      this.setData({
        sv: {
          total: money(s.totalBalanceCents),
          recharge: money(s.monthRechargeCents),
          consume: money(s.monthConsumeCents),
          dormant: d ? `${d.displayName} ${money(d.balanceCents)}(${d.dormantDays || 0}天未动)` : ''
        }
      })
      // 待结工资(已锁定未发放)
      try {
        const pp = await api.adminGet('/admin/salary/pending-payout')
        this.setData({
          payroll: {
            totalCents: pp.totalCents || 0, total: money(pp.totalCents),
            monthsText: (pp.months || []).map((x) => `${Number(x.month.slice(5, 7))}月${x.people}人`).join(' · ')
          }
        })
      } catch (e) { /* 忽略 */ }
    } catch (err) {
      if (err && err.code === 'FINANCE_LOCKED') {
        api.clearFinanceKey()
        this.setData({ unlocked: false })
        wx.showToast({ title: '财务会话已过期,请重新解锁', icon: 'none' })
      }
    }
  },

  // 数字滚动 + 圆环生长:进页播一次(约0.7秒),不循环
  roll(t) {
    clearInterval(this._rollT)
    const steps = 14
    let i = 0
    const rings = this.data.goal.rings || []
    this._rollT = setInterval(() => {
      i += 1
      const ease = 1 - Math.pow(1 - i / steps, 3)
      const patch = {
        'm.today': money(Math.round(t.todayCents * ease)),
        'm.revenue': money(Math.round(t.revCents * ease)),
        'm.net': money(Math.round(t.netCents * ease))
      }
      rings.forEach((r, idx) => { patch[`goal.rings[${idx}].animPct`] = Math.round(r.pct * ease) })
      this.setData(patch)
      if (i >= steps) clearInterval(this._rollT)
    }, 50)
  },

  toEntry() { wx.navigateTo({ url: '/pages/merchant/finance-entry/index' }) },
  toTxns() { wx.navigateTo({ url: '/pages/merchant/finance-txns/index' }) },
  toSalary() { wx.navigateTo({ url: '/pages/merchant/salary-month/index' }) },
  wakeSleep() { wx.navigateTo({ url: '/pages/merchant/marketing/index' }) },

  async aiInsight() {
    wx.showLoading({ title: 'AI 解读中' })
    try {
      const r = await api.adminPost('/admin/finance/insights', {})
      const ins = (r && r.insight) || r || {}
      const t = ins.text || ins.summaryZh || ins.textZh || (ins.data && (ins.data.summaryZh || ins.data.headlineZh)) || (typeof ins === 'string' ? ins : '') || '(暂无解读)'
      this.setData({ insight: t })
    } catch (err) {
      wx.showToast({ title: '解读失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  // ===== 「设个目标」弹窗:仅 4 项;变动成本率带智能建议值 =====
  async openGoal() {
    const pr = this._pr || {}
    const t = pr.targets || {}
    // 智能建议率 =(上月总支出 − 固定支出)÷ 上月收入;上月没收入不出建议
    let suggest = null
    try {
      const cur = pr.month || localToday().slice(0, 7)
      const [y, m] = cur.split('-').map(Number)
      const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
      const prevData = await api.adminGet(`/admin/finance/transactions?month=${prev}`)
      const inc = (prevData.summary && prevData.summary.incomeCents) || 0
      const exp = (prevData.summary && prevData.summary.expenseCents) || 0
      const fixed = pr.fixedCents || 0
      if (inc > 0 && exp > fixed) suggest = Math.min(95, Math.max(1, Math.round(((exp - fixed) / inc) * 100)))
    } catch (e) { /* 忽略 */ }
    this.setData({
      gm: {
        show: true,
        mode: t.targetMode === 'revenue' ? 'revenue' : 'net_profit',
        monthVal: t.monthTargetCents ? String(Math.round(t.monthTargetCents / 100)) : '',
        rateVal: String(Math.round((t.variableCostRate || 0.25) * 100)),
        yearVal: t.yearTargetCents ? String(Math.round(t.yearTargetCents / 100)) : '',
        suggest
      }
    })
  },
  closeGoal() { this.setData({ 'gm.show': false }) },
  noop() {},
  gmMode(e) { this.setData({ 'gm.mode': e.currentTarget.dataset.mode }) },
  gmMonth(e) { this.setData({ 'gm.monthVal': e.detail.value }) },
  gmRate(e) { this.setData({ 'gm.rateVal': e.detail.value }) },
  gmYear(e) { this.setData({ 'gm.yearVal': e.detail.value }) },
  gmUseSuggest() { if (this.data.gm.suggest != null) this.setData({ 'gm.rateVal': String(this.data.gm.suggest) }) },
  async gmSave() {
    const g = this.data.gm
    const monthTarget = Number(g.monthVal)
    if (!monthTarget || monthTarget <= 0) { wx.showToast({ title: '先填目标金额', icon: 'none' }); return }
    try {
      await api.adminRequest('/admin/finance/targets', 'PUT', {
        targetMode: g.mode,
        monthTarget,
        variableCostRate: Math.min(0.95, Math.max(0, Number(g.rateVal || 25) / 100)),
        yearTarget: g.yearVal ? Number(g.yearVal) : null
      })
      this.setData({ 'gm.show': false })
      wx.showToast({ title: '目标已保存', icon: 'success' })
      this.loadData() // 重新拉数据,圆环"点亮"
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
    }
  }
})
