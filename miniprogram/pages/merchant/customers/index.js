const api = require('../../../utils/api')
const { storeMoney } = require('../../../utils/storeclock')

function money(c) { return storeMoney(c, 0) } // 门店币种,不写死 $
function daysSince(iso) { if (!iso) return 9999; return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) }
function lastText(iso) {
  if (!iso) return '未到店'
  const d = daysSince(iso)
  if (d <= 0) return '今天'
  if (d < 365) return `${d}天前`
  return iso.slice(0, 10)
}

// RFM 阈值默认;真实值从服务端 /admin/segment-rules 拉,老板可在「规则」里改每个数字
const DEFAULT_TH = { aDays: 45, aVisits: 3, aSpendCents: 50000, nDays: 30, sDays: 60 }

// 分层优先级:S 沉睡 > A 高价值 > N 新客 > B 回头客;没到过店 none
function tierOf(u, TH) {
  const visits = u.completedCount || 0
  if (!visits) return 'none'
  const lastD = daysSince(u.lastCompletedAt)
  const firstD = daysSince(u.firstVisitAt)
  if (lastD > TH.sDays) return 's'
  if (lastD <= TH.aDays && visits >= TH.aVisits && (u.totalSpentCents || 0) >= TH.aSpendCents) return 'a'
  if (firstD <= TH.nDays) return 'n'
  return 'b'
}
const TIER_LABEL = { a: '高价值A', b: '回头客B', n: '新客N', s: '沉睡S' }

function vm(u, TH) {
  const tier = tierOf(u, TH)
  return {
    id: u.id,
    name: u.displayName || '顾客',
    av: (u.displayName || '?').slice(0, 1),
    phone: u.phone || '',
    tier, tierLabel: TIER_LABEL[tier] || '',
    visits: u.completedCount || 0,
    last: lastText(u.lastCompletedAt),
    lastDays: daysSince(u.lastCompletedAt),
    spend: money(u.totalSpentCents),
    spendCents: u.totalSpentCents || 0,
    stored: money(u.storedValueBalanceCents),
    storedCents: u.storedValueBalanceCents || 0,
    lastAt: u.lastCompletedAt || '',
    tags: (u.tags || []).slice(0, 3),
    // 图 A①-2:爽约留存定金随档案显示(长期有效则后端文案里不带期限)
    depositRetained: u.depositRetainedText || ''
  }
}

Page({
  data: {
    all: [], list: [], kw: '', filter: 'all', sort: 'spend',
    filters: ['all', 'a', 'b', 'n', 's'],
    filterLabels: { all: '全部', a: '高价值A', b: '回头客B', n: '新客N', s: '沉睡S' },
    sorts: ['spend', 'last', 'stored'],
    sortLabels: { spend: '累计消费', last: '最近到店', stored: '储值余额' },
    counts: { a: 0, b: 0, n: 0, s: 0, total: 0 },
    aiBusy: false,
    // 分层规则(服务端持久化,老板可改每个数字)
    rules: Object.assign({}, DEFAULT_TH),
    ruleSheet: false,
    rAdays: '', rAvisits: '', rAspend: '', rNdays: '', rSdays: '',
    // 群发券
    couponSheet: false, coupons: [], granting: false,
    isOwner: true, staffView: false, scopeNote: ''
  },

  /* 拍板②(店主 2026-08-10)前端收尾:员工首页有「我的客户」入口,却指向这页的 guardOwner(),
     点进去直接被弹走 —— 与 D11 同一类(owner-only 误伤员工)。后端已按口径裁好:
     员工拿到的是**受限视图**(只有 8 个字段,财务字段连键都没有,手机号脱敏)。
     这里只负责:①放员工进来 ②按后端**实际给的字段**渲染,不去猜没有的字段。 */
  async onShow() {
    if (!(await api.guardMerchant())) return
    let isOwner = true
    try { const me = await api.adminMe(); isOwner = !me || me.role === 'owner' } catch (e) { return }
    this.setData({ isOwner, staffView: !isOwner })
    this.setData({ aiEnabled: api.merchantHasAi() })
    api.refreshMerchantAi().then((on) => this.setData({ aiEnabled: on }))
    this.load()
  },

  async load() {
    try {
      // 先拉分层规则(失败用默认),再按规则分层
      try {
        const rr = await api.adminGet('/admin/segment-rules')
        if (rr && rr.rules) this.setData({ rules: rr.rules })
      } catch (e) { /* 默认规则 */ }
      const TH = this.data.rules
      const r = await api.adminGet('/admin/customers')
      /* 员工受限视图:后端明确回了 scope='mine' —— 只按**它给的字段**渲染。
         分层(RFM)、消费额、储值全靠金额算,员工既拿不到也不该看,整块不出。 */
      if (r.scope === 'mine' || this.data.staffView) {
        const mine = (r.customers || []).map((u) => ({
          id: u.id, name: u.displayName || '顾客', av: (u.displayName || '客')[0],
          phone: u.phoneMasked || '', visits: u.visitCount || 0,
          last: u.lastVisitAt ? String(u.lastVisitAt).slice(0, 10) : '—',
          tags: u.tags || [], memberCode: u.memberCode || ''
        }))
        this.setData({
          staffView: true, all: mine, list: mine,
          scopeNote: r.scopeNote || '只显示你服务过的顾客',
          counts: { a: 0, b: 0, n: 0, s: 0, total: mine.length }
        })
        return
      }
      const all = (r.customers || r.data || r || []).map((u) => vm(u, TH))
      this.setData({
        all,
        counts: {
          a: all.filter((x) => x.tier === 'a').length,
          b: all.filter((x) => x.tier === 'b').length,
          n: all.filter((x) => x.tier === 'n').length,
          s: all.filter((x) => x.tier === 's').length,
          total: all.length
        }
      })
      this.apply()
    } catch (e) { wx.showToast({ title: '加载客户失败', icon: 'none' }) }
  },

  apply() {
    const { all, kw, filter, sort } = this.data
    let list = all.slice()
    const k = (kw || '').trim()
    if (k) list = list.filter((x) => x.name.indexOf(k) >= 0 || (x.phone || '').indexOf(k) >= 0)
    if (filter !== 'all') list = list.filter((x) => x.tier === filter)
    // 沉睡客默认按「以前多能花」排,先救最值钱的
    if (filter === 's') list.sort((a, b) => b.spendCents - a.spendCents)
    else if (sort === 'spend') list.sort((a, b) => b.spendCents - a.spendCents)
    else if (sort === 'stored') list.sort((a, b) => b.storedCents - a.storedCents)
    else if (sort === 'last') list.sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || ''))
    this.setData({ list })
  },

  onKw(e) { this.setData({ kw: e.detail.value }, () => this.apply()) },
  setFilter(e) { this.setData({ filter: e.currentTarget.dataset.f }, () => this.apply()) },
  pickTier(e) { this.setData({ filter: e.currentTarget.dataset.t }, () => this.apply()) },
  setSort(e) { this.setData({ sort: e.currentTarget.dataset.s }, () => this.apply()) },
  open(e) { wx.navigateTo({ url: `/pages/merchant/customer/index?id=${encodeURIComponent(e.currentTarget.dataset.id)}` }) },

  // 复制当前筛选的名单(姓名+电话+概况)
  copyList() {
    const list = this.data.list
    if (!list.length) { wx.showToast({ title: '当前没有客人', icon: 'none' }); return }
    const text = list.map((x) => `${x.name}${x.phone ? ' ' + x.phone : ''}(${x.visits}次·${x.spend}·${x.last})`).join('\n')
    wx.setClipboardData({ data: text, success: () => wx.showToast({ title: `已复制 ${list.length} 人名单`, icon: 'none' }) })
  },

  // ===== 分层规则微调(每个数字可改,存服务端) =====
  openRules() {
    const r = this.data.rules
    this.setData({
      ruleSheet: true,
      rAdays: String(r.aDays), rAvisits: String(r.aVisits), rAspend: String(Math.round(r.aSpendCents / 100)),
      rNdays: String(r.nDays), rSdays: String(r.sDays)
    })
  },
  closeRules() { this.setData({ ruleSheet: false }) },
  onRule(e) { this.setData({ [e.currentTarget.dataset.f]: e.detail.value }) },
  async saveRules() {
    try {
      const r = await api.adminRequest('/admin/segment-rules', 'PUT', {
        aDays: Number(this.data.rAdays), aVisits: Number(this.data.rAvisits),
        aSpendCents: Math.round(Number(this.data.rAspend) * 100),
        nDays: Number(this.data.rNdays), sDays: Number(this.data.rSdays)
      })
      this.setData({ rules: r.rules, ruleSheet: false })
      wx.showToast({ title: '规则已保存,重新分层', icon: 'none' })
      this.load()
    } catch (err) { wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' }) }
  },

  // ===== 群发券:给当前筛选层每人自动发一张(已持有未用的自动跳过) =====
  async openCoupons() {
    if (!this.data.list.length) { wx.showToast({ title: '当前没有客人', icon: 'none' }); return }
    try {
      const r = await api.adminGet('/admin/coupons')
      const coupons = (r.coupons || []).filter((c) => c.isActive !== false && c.is_active !== 0)
      if (!coupons.length) { wx.showToast({ title: '还没有可用的券,先到 会员套餐/券 里建一张', icon: 'none', duration: 2500 }); return }
      this.setData({ couponSheet: true, coupons })
    } catch (e) { wx.showToast({ title: '加载券失败', icon: 'none' }) }
  },
  closeCoupons() { this.setData({ couponSheet: false }) },
  async grantCoupon(e) {
    if (this.data.granting) return
    const id = e.currentTarget.dataset.id
    const c = this.data.coupons.find((x) => x.id === id)
    const n = this.data.list.length
    const dftDays = (c && c.validDays) || 30
    // 发放时可单独设本批有效期(不改券模板);留空=按券默认
    wx.showModal({
      title: `群发「${(c && c.name) || '券'}」给 ${n} 人`,
      editable: true, placeholderText: `本批有效期(天),默认 ${dftDays}`,
      content: '',
      confirmText: '确认发放',
      success: async (m) => {
        if (!m.confirm) return
        const days = Number(m.content)
        this.setData({ granting: true })
        try {
          const body = { userIds: this.data.list.map((x) => x.id) }
          if (Number.isFinite(days) && days > 0) body.validDays = Math.round(days)
          const r = await api.adminPost(`/admin/coupons/${encodeURIComponent(id)}/grant-batch`, body)
          this.setData({ couponSheet: false })
          wx.showModal({ title: '发放完成', content: `已发 ${r.granted} 张,有效期 ${body.validDays || dftDays} 天${r.skipped ? `;跳过 ${r.skipped} 人(已持有/超量)` : ''}。顾客打开小程序「券包」即可见。`, showCancel: false, confirmText: '好' })
        } catch (err) { wx.showToast({ title: (err && err.message) || '发放失败', icon: 'none' }) }
        this.setData({ granting: false })
      }
    })
  },

  // AI 一人一句召回话术(当前列表前5人,结合服务小记画像),复制后逐个粘微信
  async aiRecall() {
    if (this.data.aiBusy) return
    const targets = this.data.list.slice(0, 5)
    if (!targets.length) { wx.showToast({ title: '当前没有客人', icon: 'none' }); return }
    this.setData({ aiBusy: true })
    wx.showLoading({ title: 'AI 写话术中…' })
    try {
      const r = await api.adminPost('/admin/ai/recall-copy', { userIds: targets.map((x) => x.id) })
      const msgs = r.messages || []
      const text = msgs.map((m) => `【${m.name}】${m.message}`).join('\n\n')
      wx.hideLoading()
      wx.setClipboardData({
        data: text,
        success: () => wx.showModal({ title: `已生成 ${msgs.length} 条召回话术`, content: `已复制到剪贴板,粘到微信逐个发送。\n\n${text.slice(0, 100)}…`, showCancel: false, confirmText: '好' })
      })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: (err && err.message) || '生成失败', icon: 'none' })
    }
    this.setData({ aiBusy: false })
  }
})
