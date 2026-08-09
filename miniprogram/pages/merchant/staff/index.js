/* P2③ 员工管理板块化(设计图屏 4b/4c + P2.5 屏 V2)
   四页签:排班 | 业绩目标 | 薪资方案 | 账号管理,按使用频率排。
   业绩目标板块顶部是**新增**的本月排行卡,下面是原有的逐人目标设置区 ——
   位置与交互不变,只是每行左侧多了一条进度(店主 v2 设计图明确要求原设置区不动)。
   金额红线:本页不算钱。排行/进度/差额都来自 /admin/perf-ranking,条宽用后端给的 barPct。 */
const api = require('../../../utils/api')
const { formatMoney, displayOf } = require('../../../utils/money')

const TABS = [
  { key: 'schedule', label: '排班' },
  { key: 'targets', label: '业绩目标' },
  { key: 'salary', label: '薪资方案' },
  { key: 'accounts', label: '账号管理' }
]
const RANK_METRICS = [
  { key: 'perf', label: '业绩' },
  { key: 'orders', label: '单数' },
  { key: 'recharge', label: '冲卡' }
]

function monthKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

Page({
  data: {
    tab: 'targets',
    tabs: TABS,
    metrics: RANK_METRICS,
    metric: 'perf',
    month: '',
    list: [],          // 技师 + 账号(账号管理板块用)
    ranking: [],       // 本月排行(V2 新增卡)
    targets: [],       // 逐人目标 + 进度(原设置区 + 左侧进度)
    plans: [],         // 薪资方案每人一行
    defaultPlanLabel: '',
    sheet: null        // 目标设置面板(= v6 屏 4b 那套,一字未改)
  },

  async onShow() {
    if (!(await api.guardOwner())) return
    this.setData({ month: monthKey() })
    this.load()
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.k })
    this.load()
  },
  pickMetric(e) {
    this.setData({ metric: e.currentTarget.dataset.k })
    this.loadRanking()
  },

  async load() {
    const tab = this.data.tab
    try {
      if (tab === 'targets') { await this.loadRanking(); await this.loadTargets() }
      else if (tab === 'salary') await this.loadPlans()
      else if (tab === 'accounts') await this.loadAccounts()
    } catch (e) { wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' }) }
  },

  // ===== 业绩目标板块 =====
  async loadRanking() {
    const r = await api.adminGet(`/admin/perf-ranking?metric=${this.data.metric}&period=month`)
    const d = displayOf(r.ranking)
    const m = (c) => formatMoney(c, d, d.trimZeroDecimals ? 0 : 2)
    this.setData({
      ranking: (r.ranking.ranking || []).map((x) => ({
        rank: x.rank, name: x.name, barPct: x.barPct,
        value: this.data.metric === 'orders' ? `${x.orderCount} 单` : m(this.data.metric === 'recharge' ? x.rechargeCents : x.perfCents)
      })),
      // 进度也从这份取,免得排行和目标两处各问一次、还可能不一致
      targets: (r.ranking.targets || []).map((t) => ({
        technicianId: t.technicianId,
        name: t.name,
        hasTarget: Boolean(t.target),
        pct: t.target ? Math.min(100, t.target.pct) : 0,
        pctText: t.target ? (t.target.hit ? '达标' : `${t.target.pct}%`) : '',
        hit: Boolean(t.target && t.target.hit)
      }))
    })
  },
  // 目标的原始设置值(设置面板要回填),与进度分开取
  async loadTargets() {
    const r = await api.adminGet(`/admin/perf-targets?month=${this.data.month}`)
    this.rawTargets = r.technicians || []
  },
  openTargetSheet(e) {
    const id = e.currentTarget.dataset.id
    const raw = (this.rawTargets || []).find((x) => x.technicianId === id)
    if (!raw) { wx.showToast({ title: '读不到该技师的目标', icon: 'none' }); return }
    this.setData({
      sheet: {
        technicianId: raw.technicianId,
        name: raw.name,
        mode: raw.mode,
        displayMode: raw.displayMode,
        perf: raw.perfTargetCents / 100,
        card: raw.cardTargetCents / 100,
        orders: raw.orderTarget
      }
    })
  },
  closeSheet() { this.setData({ sheet: null }) },
  sheetPick(e) {
    const { field, v } = e.currentTarget.dataset
    this.setData({ [`sheet.${field}`]: v })
  },
  sheetInput(e) {
    this.setData({ [`sheet.${e.currentTarget.dataset.field}`]: e.detail.value })
  },
  async saveTarget() {
    const s = this.data.sheet
    if (!s) return
    // 元 → 分是单位换算,不是计价;目标金额本来就是老板手输的
    const cents = (v) => Math.max(0, Math.round(Number(String(v ?? '').replace(/[^\d.]/g, '')) * 100) || 0)
    try {
      await api.adminPut('/admin/perf-targets', {
        month: this.data.month,
        targets: [{
          technicianId: s.technicianId,
          mode: s.mode,
          displayMode: s.displayMode,
          perfTargetCents: cents(s.perf),
          cardTargetCents: cents(s.card),
          orderTarget: Number(s.orders) || 0
        }]
      })
      this.setData({ sheet: null })
      wx.showToast({ title: '已保存,员工端立即生效', icon: 'none' })
      await this.loadRanking()
      await this.loadTargets()
    } catch (e) { wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' }) }
  },

  // ===== 薪资方案板块 =====
  async loadPlans() {
    const [t, p] = await Promise.all([
      api.adminGet('/admin/technicians'),
      api.adminGet('/admin/salary-plans')
    ])
    const byTech = {}
    ;(p.plans || []).forEach((x) => { byTech[x.technicianId] = x })
    const label = (plan) => {
      if (!plan) return '按全店默认'
      const mode = plan.mode || 'ladder'
      if (mode === 'fixed') return '底薪+固定提成'
      if (mode === 'custom') return '自定义'
      return `底薪+阶梯(${plan.ladderMode === 'progressive' ? '阶梯' : '阶段'})`
    }
    this.setData({
      defaultPlanLabel: label(p.defaultPlan),
      plans: (t.technicians || [])
        .filter((x) => x.is_active !== 0)
        .map((x) => ({ id: x.id, name: x.name, label: label(byTech[x.id]) }))
    })
  },

  // ===== 账号管理板块 =====
  async loadAccounts() {
    const [t, a] = await Promise.all([
      api.adminGet('/admin/technicians'),
      api.adminGet('/admin/staff-accounts').catch(() => ({ accounts: [] }))
    ])
    const byTech = {}
    ;(a.accounts || []).forEach((x) => { byTech[x.technicianId] = x })
    this.setData({
      list: (t.technicians || []).map((tech) => {
        const ac = byTech[tech.id]
        return {
          id: tech.id,
          name: tech.name,
          title: tech.title || '',
          av: (tech.name || '?').slice(0, 1),
          active: tech.is_active !== 0 && tech.isActive !== false,
          acct: ac ? { id: ac.id, username: ac.username, disabled: ac.status !== 'active' } : null
        }
      })
    })
  },

  goSchedule() { wx.navigateTo({ url: '/pages/merchant/schedule-day/index' }) },
  goDetail(e) {
    // 点技师行 → 该技师逐日明细(已有页)
    const { id, name } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/merchant/my-performance/index?technicianId=${encodeURIComponent(id)}&name=${encodeURIComponent(name || '')}` })
  },

  addTech() {
    wx.showModal({
      title: '新增员工', editable: true, placeholderText: '输入技师姓名',
      success: async (r) => {
        if (!r.confirm || !r.content || !r.content.trim()) return
        try { await api.adminPost('/admin/technicians', { name: r.content.trim() }); wx.showToast({ title: '已添加', icon: 'none' }); this.load() }
        catch (err) { wx.showToast({ title: (err && err.message) || '添加失败', icon: 'none' }) }
      }
    })
  },

  async genAccount(e) {
    const id = e.currentTarget.dataset.id
    try {
      const r = await api.adminPost('/admin/staff-accounts', { technicianId: id })
      const text = `用户名:${r.username}\n初始密码:${r.initialPassword}`
      wx.showModal({
        title: '账号已生成', content: `${text}\n(只显示这一次,点「复制」发给员工)`,
        confirmText: '复制账号密码', cancelText: '知道了',
        success: (m) => { if (m.confirm) wx.setClipboardData({ data: text, success: () => wx.showToast({ title: '已复制,去粘贴给员工', icon: 'none' }) }) }
      })
      this.load()
    } catch (err) { wx.showToast({ title: (err && err.message) || '生成失败', icon: 'none' }) }
  },

  async resetPwd(e) {
    const id = e.currentTarget.dataset.acctid
    try {
      const r = await api.adminPost(`/admin/staff-accounts/${encodeURIComponent(id)}/reset-password`, {})
      wx.showModal({
        title: '密码已重置', content: `新初始密码:${r.initialPassword}\n员工下次登录需改密`,
        confirmText: '复制密码', cancelText: '知道了',
        success: (m) => { if (m.confirm) wx.setClipboardData({ data: r.initialPassword, success: () => wx.showToast({ title: '已复制,去粘贴给员工', icon: 'none' }) }) }
      })
    } catch (err) { wx.showToast({ title: (err && err.message) || '重置失败', icon: 'none' }) }
  },

  goDefaultPlan() { wx.navigateTo({ url: '/pages/merchant/salary-plan/index' }) },
  goPlan(e) {
    const { id, name } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/merchant/salary-plan/index?technicianId=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}` })
  },

  async toggleAcct(e) {
    const id = e.currentTarget.dataset.acctid
    try { await api.adminPost(`/admin/staff-accounts/${encodeURIComponent(id)}/toggle`, {}); wx.showToast({ title: '已切换', icon: 'none' }); this.load() }
    catch (err) { wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' }) }
  }
})
