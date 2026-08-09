const api = require('../../../utils/api')

// 金额显示用「元」,存储用分;输入框里全是可编辑数字
function c2y(c) { return c ? String(Math.round(c) / 100) : '' }
function y2c(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0 }

const DEFAULT_LADDER = [
  { min: '0', max: '8000', pct: '15' },
  { min: '8000', max: '15000', pct: '20' },
  { min: '15000', max: '', pct: '25' }
]

Page({
  data: {
    techId: '', techName: '', isDefault: false,
    source: 'none', // custom 本人专属 | default 跟随全店默认 | none 未配置
    template: 'base_ladder', // commission 纯提成 | base_ladder 底薪+阶梯 | base_flat 底薪+固定提成
    base: '', handwork: '', flatPct: '',
    ladder: [], // [{min,max,pct}] 全部字符串,input 直接编辑
    // v2(P2①-2 后端已支持):阶段=落档整月按该档;阶梯=分段累进。存量方案默认阶段,不会被悄悄改
    ladderMode: 'whole',
    firstRechargePct: '', renewRechargePct: '',
    customCommissions: [], // [{name,pct}] 卡提成自定义行,屏 3b 的「＋加一行」
    otRate: '', otUnit: 30,
    cardPct: '', rechargePct: '',
    saving: false
  },

  async onLoad(q) {
    if (!(await api.guardOwner())) return
    const techId = q.technicianId || ''
    this.setData({
      techId,
      techName: q.name ? decodeURIComponent(q.name) : '',
      isDefault: !techId
    })
    wx.setNavigationBarTitle({ title: techId ? `薪资方案 · ${this.data.techName}` : '全店默认薪资方案' })
    this.load()
  },

  async load() {
    try {
      const r = await api.adminGet(`/admin/salary-plans/effective?technicianId=${encodeURIComponent(this.data.techId)}`)
      const p = r.plan
      if (!p) { this.setData({ source: 'none', ladder: DEFAULT_LADDER.slice() }); return }
      this.setData({
        source: this.data.isDefault ? 'default' : r.source,
        template: p.template,
        base: c2y(p.baseSalaryCents), handwork: c2y(p.handworkFeeCents),
        flatPct: p.flatPct ? String(p.flatPct) : '',
        cardPct: p.cardPct ? String(p.cardPct) : '',
        rechargePct: p.rechargePct ? String(p.rechargePct) : '',
        otRate: c2y(p.overtimeRateCents), otUnit: p.overtimeUnitMin === 60 ? 60 : 30,
        ladderMode: p.ladderMode === 'progressive' ? 'progressive' : 'whole',
        firstRechargePct: p.firstRechargePct ? String(p.firstRechargePct) : '',
        renewRechargePct: p.renewRechargePct ? String(p.renewRechargePct) : '',
        customCommissions: (p.customCommissions || []).map((c) => ({ name: c.name || '', pct: String(c.pct || 0) })),
        ladder: (p.ladder && p.ladder.length ? p.ladder : []).map((t) => ({
          min: c2y(t.minCents) || '0', max: t.maxCents == null ? '' : c2y(t.maxCents), pct: String(t.pct || 0)
        }))
      })
      if (!this.data.ladder.length) this.setData({ ladder: DEFAULT_LADDER.slice() })
    } catch (e) { this.setData({ ladder: DEFAULT_LADDER.slice() }) }
  },

  pickTpl(e) { this.setData({ template: e.currentTarget.dataset.t }) },
  pickLadderMode(e) { this.setData({ ladderMode: e.currentTarget.dataset.m }) },
  onFirstPct(e) { this.setData({ firstRechargePct: e.detail.value }) },
  onRenewPct(e) { this.setData({ renewRechargePct: e.detail.value }) },
  // 屏 3b:卡提成自定义行「＋加一行」(名称 + 比例)
  addCustomRow() {
    const rows = this.data.customCommissions.slice()
    if (rows.length >= 10) { wx.showToast({ title: '最多 10 行', icon: 'none' }); return }
    rows.push({ name: '', pct: '' })
    this.setData({ customCommissions: rows })
  },
  removeCustomRow(e) {
    const rows = this.data.customCommissions.slice()
    rows.splice(Number(e.currentTarget.dataset.i), 1)
    this.setData({ customCommissions: rows })
  },
  onCustomRow(e) {
    const { i, f } = e.currentTarget.dataset
    const rows = this.data.customCommissions.slice()
    rows[i] = Object.assign({}, rows[i], { [f]: e.detail.value })
    this.setData({ customCommissions: rows })
  },
  onBase(e) { this.setData({ base: e.detail.value }) },
  onHandwork(e) { this.setData({ handwork: e.detail.value }) },
  onFlatPct(e) { this.setData({ flatPct: e.detail.value }) },
  onCardPct(e) { this.setData({ cardPct: e.detail.value }) },
  onRechargePct(e) { this.setData({ rechargePct: e.detail.value }) },
  onOtRate(e) { this.setData({ otRate: e.detail.value }) },
  setOtUnit(e) { this.setData({ otUnit: Number(e.currentTarget.dataset.u) }) },

  // 阶梯:每档 min/max/pct 都是 input,可增删
  onLadder(e) {
    const { i, f } = e.currentTarget.dataset
    const ladder = this.data.ladder.slice()
    ladder[i] = Object.assign({}, ladder[i], { [f]: e.detail.value })
    this.setData({ ladder })
  },
  addTier() {
    const ladder = this.data.ladder.slice()
    const last = ladder[ladder.length - 1] || { max: '0' }
    ladder.push({ min: last.max || '', max: '', pct: '' })
    this.setData({ ladder })
  },
  delTier(e) {
    const i = e.currentTarget.dataset.i
    const ladder = this.data.ladder.slice()
    ladder.splice(i, 1)
    this.setData({ ladder })
  },

  async save() {
    if (this.data.saving) return
    const d = this.data
    if (d.template === 'base_ladder') {
      for (const t of d.ladder) {
        if (t.pct === '' || Number(t.pct) < 0) { wx.showToast({ title: '每档都要填提成 %', icon: 'none' }); return }
      }
      if (!d.ladder.length) { wx.showToast({ title: '至少留一档', icon: 'none' }); return }
    }
    this.setData({ saving: true })
    try {
      await api.adminRequest('/admin/salary-plans', 'PUT', {
        technicianId: d.techId,
        template: d.template,
        baseSalaryCents: d.template === 'commission' ? 0 : y2c(d.base),
        handworkFeeCents: y2c(d.handwork),
        ladder: d.template === 'base_ladder' ? d.ladder.map((t) => ({
          minCents: y2c(t.min), maxCents: t.max === '' ? null : y2c(t.max), pct: Number(t.pct) || 0
        })) : [],
        flatPct: d.template === 'base_ladder' ? 0 : (Number(d.flatPct) || 0),
        ladderMode: d.ladderMode,
        cardPct: Number(d.cardPct) || 0,
        rechargePct: Number(d.rechargePct) || 0,
        firstRechargePct: Number(d.firstRechargePct) || 0,
        renewRechargePct: Number(d.renewRechargePct) || 0,
        customCommissions: d.customCommissions
          .filter((c) => Number(c.pct) > 0)
          .map((c) => ({ name: (c.name || '').trim() || '自定义提成', pct: Number(c.pct) || 0 })),
        overtimeRateCents: y2c(d.otRate),
        overtimeUnitMin: d.otUnit
      })
      wx.showToast({ title: '已保存,立即生效', icon: 'success' })
      this.setData({ saving: false, source: this.data.isDefault ? 'default' : 'custom' })
    } catch (err) {
      this.setData({ saving: false })
      wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
    }
  },

  // 员工专属方案 → 恢复跟随全店默认
  resetToDefault() {
    if (this.data.isDefault) return
    wx.showModal({
      title: '恢复跟随默认', content: `删除 ${this.data.techName} 的专属方案,改为跟随全店默认?`,
      success: async (r) => {
        if (!r.confirm) return
        try {
          await api.adminRequest(`/admin/salary-plans/${encodeURIComponent(this.data.techId)}`, 'DELETE')
          wx.showToast({ title: '已恢复跟随默认', icon: 'success' })
          this.load()
        } catch (err) { wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' }) }
      }
    })
  }
})
