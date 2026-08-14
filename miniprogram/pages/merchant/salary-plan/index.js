/* 屏 3b/3c｜薪资方案 · 小程序版(2026-08-09 按设计图重做)
   与图的对应关系:
     顶部三段选「阶段 | 阶梯 | 自定义」 → 后端 (template, ladderMode) 两个字段的组合:
       阶段   = base_ladder + whole        阶梯 = base_ladder + progressive
       自定义 = base_flat(固定提点);「纯提成」不再是独立模板 —— 把基础项里的底薪开关关掉就是纯提成
     基础项(底薪 / 手工费 / 加班费)全部开关化;关闭或 0 = 不启用
     卡提成只有 首充 / 续卡 / 自定义行 —— **耗卡不设提成,卡耗计入业绩**(图上原话)
     底部常驻三模式对比试算,金额全部由 /admin/salary-plans/preview 算,本页零金额运算 */
const api = require('../../../utils/api')
const { formatMoney, displayOf } = require('../../../utils/money')

// 「元 → 分」只在提交时换算一次,不是计价
function c2y(c) { return c ? String(Math.round(c) / 100) : '' }
function y2c(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0 }

const DEFAULT_LADDER = [
  { min: '0', max: '8000', pct: '10' },
  { min: '8000', max: '15000', pct: '12' },
  { min: '15000', max: '', pct: '15' }
]
const MODES = [
  { key: 'whole', label: '阶段' },
  { key: 'progressive', label: '阶梯' },
  { key: 'flat', label: '自定义' }
]
const PREVIEW_PERF_CENTS = 1200000 // 图上的算例:业绩 ¥12,000

Page({
  data: {
    techId: '', techName: '', isDefault: false,
    source: 'none',            // custom 本人专属 | default 跟随全店默认 | none 未配置
    modes: MODES, mode: 'progressive',
    base: '', handwork: '', flatPct: '',
    ladder: [],
    enableBase: true, enableHandwork: true, enableOvertime: true,
    firstRechargePct: '', renewRechargePct: '',
    customCommissions: [],
    otRate: '', otUnit: 30,
    display: null,
    preview: null,             // { whole, progressive, flat, diff, perf } 全是显示串
    saving: false
  },

  async onLoad(q) {
    if (!(await api.guardOwner())) return
    const techId = q.technicianId || ''
    this.setData({ techId, techName: q.name ? decodeURIComponent(q.name) : '', isDefault: !techId })
    wx.setNavigationBarTitle({ title: techId ? `薪资方案 · ${this.data.techName}` : '全店默认薪资方案' })
    this.load()
  },

  async load() {
    try {
      const r = await api.adminGet(`/admin/salary-plans/effective?technicianId=${encodeURIComponent(this.data.techId)}`)
      const p = r.plan
      if (!p) { this.setData({ source: 'none', ladder: DEFAULT_LADDER.slice() }); this.refreshPreview(); return }
      // 三段选是 (template, ladderMode) 的投影
      const mode = p.template === 'base_ladder'
        ? (p.ladderMode === 'progressive' ? 'progressive' : 'whole')
        : 'flat'
      this.setData({
        source: this.data.isDefault ? 'default' : r.source,
        mode,
        base: c2y(p.baseSalaryCents), handwork: c2y(p.handworkFeeCents),
        flatPct: p.flatPct ? String(p.flatPct) : '',
        otRate: c2y(p.overtimeRateCents), otUnit: p.overtimeUnitMin === 60 ? 60 : 30,
        // 老方案是 commission(纯提成)时:自定义态 + 底薪开关关掉,语义等价
        enableBase: p.template === 'commission' ? false : p.enableBase !== false,
        enableHandwork: p.enableHandwork !== false,
        enableOvertime: p.enableOvertime !== false,
        firstRechargePct: p.firstRechargePct ? String(p.firstRechargePct) : '',
        renewRechargePct: p.renewRechargePct ? String(p.renewRechargePct) : '',
        customCommissions: (p.customCommissions || []).map((c) => ({ name: c.name || '', pct: String(c.pct || 0) })),
        ladder: (p.ladder && p.ladder.length ? p.ladder : []).map((t) => ({
          min: c2y(t.minCents) || '0', max: t.maxCents == null ? '' : c2y(t.maxCents), pct: String(t.pct || 0)
        }))
      })
      if (!this.data.ladder.length) this.setData({ ladder: DEFAULT_LADDER.slice() })
    } catch (e) {
      this.setData({ ladder: DEFAULT_LADDER.slice() })
    }
    this.refreshPreview()
  },

  /* 常驻三模式对比(图:「试算 12,000:阶梯 1,280 · 阶段 1,440 · 自定义 960」,币符跟门店走)。
     三个数都由后端同一个引擎算,本页只负责显示 —— 金额红线。 */
  refreshPreview() {
    clearTimeout(this._pv)
    this._pv = setTimeout(() => this.doPreview(), 250)
  },
  async doPreview() {
    try {
      const r = await api.adminPost('/admin/salary-plans/preview', {
        perfCents: PREVIEW_PERF_CENTS,
        ladder: this.data.ladder.map((t) => ({ minCents: y2c(t.min), maxCents: t.max === '' ? null : y2c(t.max), pct: Number(t.pct) || 0 })),
        flatPct: Number(this.data.flatPct) || 0
      })
      const d = displayOf(r)
      const m = (cents) => formatMoney(cents, d, d.trimZeroDecimals ? 0 : 2)
      this.setData({
        display: d,
        preview: {
          perf: m(r.perfCents),
          whole: m(r.whole.cents),
          progressive: m(r.progressive.cents),
          flat: m(r.flat.cents),
          diff: m(Math.abs(r.diffCents)),
          hasDiff: r.diffCents !== 0
        }
      })
    } catch (e) { /* 试算拿不到不拦保存 */ }
  },

  pickMode(e) { this.setData({ mode: e.currentTarget.dataset.m }); this.refreshPreview() },
  toggleBase() { this.setData({ enableBase: !this.data.enableBase }) },
  toggleHandwork() { this.setData({ enableHandwork: !this.data.enableHandwork }) },
  toggleOvertime() { this.setData({ enableOvertime: !this.data.enableOvertime }) },

  onBase(e) { this.setData({ base: e.detail.value }) },
  onHandwork(e) { this.setData({ handwork: e.detail.value }) },
  onFlatPct(e) { this.setData({ flatPct: e.detail.value }); this.refreshPreview() },
  onOtRate(e) { this.setData({ otRate: e.detail.value }) },
  setOtUnit(e) { this.setData({ otUnit: Number(e.currentTarget.dataset.u) }) },
  onFirstPct(e) { this.setData({ firstRechargePct: e.detail.value }) },
  onRenewPct(e) { this.setData({ renewRechargePct: e.detail.value }) },

  // 卡提成自定义行「＋加一行(名称 + 比例 + 可选关联卡种)」
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

  onLadder(e) {
    const { i, f } = e.currentTarget.dataset
    const ladder = this.data.ladder.slice()
    ladder[i] = Object.assign({}, ladder[i], { [f]: e.detail.value })
    this.setData({ ladder })
    this.refreshPreview()
  },
  addTier() {
    const ladder = this.data.ladder.slice()
    const last = ladder[ladder.length - 1] || { max: '0' }
    ladder.push({ min: last.max || '', max: '', pct: '' })
    this.setData({ ladder })
    this.refreshPreview()
  },
  delTier(e) {
    const ladder = this.data.ladder.slice()
    ladder.splice(Number(e.currentTarget.dataset.i), 1)
    this.setData({ ladder })
    this.refreshPreview()
  },

  async save() {
    if (this.data.saving) return
    const d = this.data
    const isLadder = d.mode === 'whole' || d.mode === 'progressive'
    if (isLadder) {
      if (!d.ladder.length) { wx.showToast({ title: '至少留一档', icon: 'none' }); return }
      for (const t of d.ladder) {
        if (t.pct === '' || Number(t.pct) < 0) { wx.showToast({ title: '每档都要填提成 %', icon: 'none' }); return }
      }
    }
    this.setData({ saving: true })
    try {
      await api.adminRequest('/admin/salary-plans', 'PUT', {
        technicianId: d.techId,
        template: isLadder ? 'base_ladder' : 'base_flat',
        ladderMode: isLadder ? d.mode : 'whole',
        baseSalaryCents: d.enableBase ? y2c(d.base) : 0,
        handworkFeeCents: d.enableHandwork ? y2c(d.handwork) : 0,
        ladder: isLadder ? d.ladder.map((t) => ({
          minCents: y2c(t.min), maxCents: t.max === '' ? null : y2c(t.max), pct: Number(t.pct) || 0
        })) : [],
        flatPct: isLadder ? 0 : (Number(d.flatPct) || 0),
        firstRechargePct: Number(d.firstRechargePct) || 0,
        renewRechargePct: Number(d.renewRechargePct) || 0,
        customCommissions: d.customCommissions
          .filter((c) => Number(c.pct) > 0)
          .map((c) => ({ name: (c.name || '').trim() || '自定义提成', pct: Number(c.pct) || 0 })),
        enableBase: d.enableBase,
        enableHandwork: d.enableHandwork,
        enableOvertime: d.enableOvertime,
        overtimeRateCents: d.enableOvertime ? y2c(d.otRate) : 0,
        overtimeUnitMin: d.otUnit
      })
      wx.showToast({ title: '已保存,立即生效', icon: 'success' })
      this.setData({ saving: false, source: this.data.isDefault ? 'default' : 'custom' })
    } catch (err) {
      this.setData({ saving: false })
      wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
    }
  },

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
      },
      fail: (e) => console.warn('[showModal fail]', e) // S组卫生批:fail=开发者域错误,console 留痕不弹 UI(toast 会撞转场,D27 家族)
    })
  }
})
