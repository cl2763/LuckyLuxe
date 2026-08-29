/* 客户档案 →「账户调整」(二.1,店主 08-27 裁「账户调整=双端」—— 欠最久的一笔,2026-08-30 上小程序)。

   骨与网页 apps/web/account-adjust.js **同一套后端出口**,前端零第二实现:
     · 四个参考数 + 界限句 + 黄条 → GET /admin/account-adjust/facts(句子全部后端给)
     · 退储值 → POST /admin/stored-value/refund(幂等 requestId;后端硬拦超余额)
     · 退次卡 → POST /admin/timecards/:id/refund(退完剩 0 = 卡作废)
     · 充值 / 赠送 / 冲销:**指路不再造写口**(与网页同策略 —— 同一件事两处写口 = 迟早分叉):
       充值与赠送走会员页充值那条正式入口;冲销在财务页对那笔流水做。
   权限同网页:页面 guardOwner(店员连入口都看不到);接口层 requireRefundRight
   (仅老板 + **财务密码门**)再兜一道 —— 前端拦只算体验。 */
const api = require('../../../utils/api')
const { storeMoney } = require('../../../utils/storeclock')

Page({
  data: {
    userId: '', name: '', facts: null, tab: 'refund',
    cards: [], cardId: '', card: null,
    amount: '', times: '', cardAmount: '', reason: '',
    channelIdx: 0, channels: [
      { id: 'cash', label: '现金' }, { id: 'transfer', label: '转账' },
      { id: 'original', label: '原路退回' }, { id: 'other', label: '其它' }
    ],
    warning: '', afterText: '', refundText: '', leftText: '', busy: false,
    elsewhere: {
      recharge: '充值走「会员」页充值那条正式入口(含套餐、赠送、经手技师)。',
      bonus: '赠送跟着充值一起记(充 X 赠 Y),在「会员」页充值里填赠送额。',
      reversal: '冲销是「我们记错了」的红字改正,不是退钱给顾客;在财务页对那笔流水做冲销。'
    }
  },

  onLoad(q) {
    this.setData({ userId: q.userId || '', name: q.name ? decodeURIComponent(q.name) : '顾客' })
  },

  async onShow() {
    if (!(await api.guardOwner())) return
    /* 财务门禁(D27 先例):启用了门禁而没解锁 → 指去财务页,等转场走完再退 */
    let lockEnabled = false
    try { lockEnabled = Boolean((await api.adminGet('/admin/finance/lock-status')).enabled) } catch (e) { lockEnabled = false }
    if (lockEnabled && !api.getFinanceKey()) {
      wx.showToast({ title: '退卡是财务动作 —— 请先在财务页解锁', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 900)
      return
    }
    this.load()
  },

  async load() {
    try {
      const [f, pack] = await Promise.all([
        api.adminGet(`/admin/account-adjust/facts?userId=${encodeURIComponent(this.data.userId)}`),
        api.adminGet(`/admin/customers/${encodeURIComponent(this.data.userId)}/timecards`).catch(() => ({ timecards: [] }))
      ])
      this.setData({ facts: f.facts, cards: (pack.timecards || []).filter((c) => c.remaining > 0) })
      this.recalc()
    } catch (e) { wx.showToast({ title: (e && e.message) || '读取失败', icon: 'none' }) }
  },

  pickTab(e) { this.setData({ tab: e.currentTarget.dataset.k }) },
  pickCard(e) {
    const id = e.currentTarget.dataset.id || ''
    this.setData({ cardId: id, card: this.data.cards.find((c) => c.id === id) || null })
    this.recalc()
  },
  onChannel(e) { this.setData({ channelIdx: Number(e.detail.value) }) },
  /* 输入值只进 data,不回写不重画(钱输入框族规;黄条防抖问后端,句子后端给) */
  onAmount(e) { this.data.amount = e.detail.value; this.recalcSoon() },
  onTimes(e) { this.data.times = e.detail.value; this.recalcSoon() },
  onCardAmount(e) { this.data.cardAmount = e.detail.value },
  onReason(e) { this.data.reason = e.detail.value },
  fillAll() {
    const f = this.data.facts
    if (!f) return
    this.setData({ amount: (f.balanceCents / 100).toFixed(2) })
    this.recalc()
  },

  recalcSoon() { clearTimeout(this._t); this._t = setTimeout(() => this.recalc(), 300) },
  recalc() {
    const f = this.data.facts
    if (!f) return
    if (this.data.cardId) {
      const c = this.data.card
      const times = Math.round(Number(this.data.times || 0))
      const left = c ? Math.max(0, c.remaining - (Number.isFinite(times) ? times : 0)) : 0
      this.setData({ leftText: `${left} 次${left === 0 ? '(卡作废)' : ''}` })
      return
    }
    const cents = Math.round(Number(String(this.data.amount || '').replace(/[^\d.]/g, '')) * 100) || 0
    this.setData({
      refundText: `−${storeMoney(cents, 2)}`,
      afterText: storeMoney(Math.max(0, f.balanceCents - cents), 2)
    })
    /* 黄条:越过「顾客实付可退」只提醒不拦 —— 句子由后端给,前端不自己算赠送 */
    api.adminGet(`/admin/account-adjust/facts?userId=${encodeURIComponent(this.data.userId)}&amountCents=${cents}`)
      .then((r) => this.setData({ warning: r.bonusWarning || '' }))
      .catch(() => {})
  },

  async submitRefund() {
    const cents = Math.round(Number(String(this.data.amount || '').replace(/[^\d.]/g, '')) * 100) || 0
    const reason = String(this.data.reason || '').trim()
    if (!reason) { wx.showToast({ title: '退款原因必填', icon: 'none' }); return }
    if (this.data.busy) return
    this.setData({ busy: true })
    try {
      this._rid = this._rid || `rf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const r = await api.adminPost('/admin/stored-value/refund', {
        userId: this.data.userId, amountCents: cents,
        payChannel: this.data.channels[this.data.channelIdx].id, reason, requestId: this._rid
      })
      wx.showToast({ title: `已退款 ${storeMoney(r.refundedCents, 2)}`, icon: 'none' })
      setTimeout(() => wx.navigateBack(), 900)
    } catch (e) {
      this.setData({ busy: false })
      wx.showToast({ title: (e && e.message) || '退款失败', icon: 'none' })
    }
  },

  async submitCardRefund() {
    const times = Math.round(Number(this.data.times || 0))
    const cents = Math.round(Number(String(this.data.cardAmount || '').replace(/[^\d.]/g, '')) * 100) || 0
    const reason = String(this.data.reason || '').trim()
    if (!reason) { wx.showToast({ title: '退卡原因必填', icon: 'none' }); return }
    if (this.data.busy) return
    this.setData({ busy: true })
    try {
      const r = await api.adminPost(`/admin/timecards/${encodeURIComponent(this.data.cardId)}/refund`, {
        times, amountCents: cents, reason, payChannel: 'cash'
      })
      wx.showToast({ title: `已退 ${r.refundedTimes} 次${r.voided ? '(卡作废)' : ''}`, icon: 'none' })
      setTimeout(() => wx.navigateBack(), 900)
    } catch (e) {
      this.setData({ busy: false })
      wx.showToast({ title: (e && e.message) || '退卡失败', icon: 'none' })
    }
  },

  goElsewhere() {
    const t = this.data.tab
    if (t === 'recharge' || t === 'bonus') wx.navigateTo({ url: '/pages/merchant/member/index' })
    else wx.navigateTo({ url: '/pages/merchant/finance-txns/index' })
  }
})
