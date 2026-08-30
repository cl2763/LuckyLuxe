/* 客户档案 →「账户调整」(店主 08-30c 裁定·入口总收敛:凡针对特定顾客、改其账户余额的动作
   —— 充值 / 赠送 / 退卡 / 冲销 —— 唯一 UI 入口就是本页,两端同此)。

   四 tab 全部**内嵌表单**,不再指路(08-30 店主原话返工件):
     · 充值/赠送 → POST /admin/stored-value/recharge(充X赠Y 同一条;赠送=营销让利独立 bonus 行,
       不算实收/业绩/积分;未绑定档案后端 400 UNBOUND_NO_RECHARGE 终闸,前端只做提示)
     · 退卡 → POST /admin/stored-value/refund · /admin/timecards/:id/refund(原样)
     · 冲销 → POST /admin/finance/transactions/:id/reverse(既有唯一冲销口;列表=本月与这位顾客
       订单关联的账本流水,冲销=红字反向记录,原始记录保留)
   **后端路由一个不加一个不改** —— 本页只是把既有写口的表单搬到唯一入口。
   权限:页面 guardOwner;退卡/冲销另有财务钥匙门(接口层终闸)。 */
const api = require('../../../utils/api')
const { storeMoney } = require('../../../utils/storeclock')

const RV_CHANNELS = [
  { id: 'cash', label: '现金' }, { id: 'card', label: '刷卡' },
  { id: 'transfer', label: '转账' }, { id: 'unknown', label: '其他' }
]

Page({
  data: {
    userId: '', name: '', facts: null, tab: 'recharge',
    /* 退卡(原样) */
    cards: [], cardId: '', card: null,
    amount: '', times: '', cardAmount: '', reason: '',
    channelIdx: 0, channels: [
      { id: 'cash', label: '现金' }, { id: 'transfer', label: '转账' },
      { id: 'original', label: '原路退回' }, { id: 'other', label: '其它' }
    ],
    warning: '', afterText: '', refundText: '', leftText: '', busy: false,
    /* 充值/赠送(内嵌) */
    bound: true, rvPkgs: [], rvPkgId: '', rvAmount: '', rvBonus: '', rvAmountText: '',
    rvChannels: RV_CHANNELS, rvChannelIdx: 0,
    techNames: ['店里直收'], techIds: [''], techIdx: 0,
    /* 冲销(内嵌) */
    month: '', txns: [], txnsLoading: false
  },

  onLoad(q) {
    this.setData({ userId: q.userId || '', name: q.name ? decodeURIComponent(q.name) : '顾客' })
  },

  async onShow() {
    if (!(await api.guardOwner())) return
    /* 财务门禁(D27 先例):退卡/冲销是财务动作;启用了门禁而没解锁 → 指去财务页 */
    let lockEnabled = false
    try { lockEnabled = Boolean((await api.adminGet('/admin/finance/lock-status')).enabled) } catch (e) { lockEnabled = false }
    if (lockEnabled && !api.getFinanceKey()) {
      wx.showToast({ title: '账户调整是财务动作 —— 请先在财务页解锁', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 900)
      return
    }
    this.load()
  },

  async load() {
    try {
      const [f, pack, lk, pkgs, techs] = await Promise.all([
        api.adminGet(`/admin/account-adjust/facts?userId=${encodeURIComponent(this.data.userId)}`),
        api.adminGet(`/admin/customers/${encodeURIComponent(this.data.userId)}/timecards`).catch(() => ({ timecards: [] })),
        api.adminGet(`/admin/customers/lookup?userId=${encodeURIComponent(this.data.userId)}`).catch(() => null),
        api.adminGet('/admin/recharge-packages').catch(() => ({ packages: [] })),
        api.adminGet('/admin/technicians?roster=1').catch(() => ({ technicians: [] }))
      ])
      const roster = (techs.technicians || [])
      this.setData({
        facts: f.facts,
        cards: (pack.timecards || []).filter((c) => c.remaining > 0),
        bound: lk && lk.hit ? lk.hit.bound !== false : true,
        rvPkgs: pkgs.packages || [],
        techNames: ['店里直收'].concat(roster.map((t) => t.name)),
        techIds: [''].concat(roster.map((t) => t.id))
      })
      this.recalc()
    } catch (e) { wx.showToast({ title: (e && e.message) || '读取失败', icon: 'none' }) }
  },

  pickTab(e) {
    const tab = e.currentTarget.dataset.k
    this.setData({ tab })
    if (tab === 'reversal' && !this.data.month) this.loadTxns(this.curMonth())
  },

  /* ===== 充值 / 赠送(内嵌) ===== */
  pickPkg(e) {
    const id = e.currentTarget.dataset.id
    if (this.data.rvPkgId === id) { this.setData({ rvPkgId: '' }); return }
    const p = this.data.rvPkgs.find((x) => x.id === id)
    if (!p) return
    /* 套餐快捷=自动填金额+赠送(可再改)—— 与网页原「按套餐」同口径 */
    this.setData({
      rvPkgId: id,
      rvAmount: (p.priceCents / 100).toFixed(2),
      rvBonus: p.bonusCents ? (p.bonusCents / 100).toFixed(2) : ''
    })
    this.rvText()
  },
  onRvAmount(e) { this.data.rvAmount = e.detail.value; this.data.rvPkgId = ''; this.rvTextSoon() },
  onRvBonus(e) { this.data.rvBonus = e.detail.value; this.data.rvPkgId = ''; this.rvTextSoon() },
  onRvChannel(e) { this.setData({ rvChannelIdx: Number(e.detail.value) || 0 }) },
  onTech(e) { this.setData({ techIdx: Number(e.detail.value) || 0 }) },
  rvTextSoon() { clearTimeout(this._rt); this._rt = setTimeout(() => this.rvText(), 250) },
  rvText() {
    const cents = Math.round(Number(String(this.data.rvAmount || '').replace(/[^\d.]/g, '')) * 100) || 0
    this.setData({ rvAmountText: cents > 0 ? ` ${storeMoney(cents, 2)}` : '' })
  },

  async submitRecharge() {
    const cents = Math.round(Number(String(this.data.rvAmount || '').replace(/[^\d.]/g, '')) * 100) || 0
    const bonus = Math.round(Number(String(this.data.rvBonus || '').replace(/[^\d.]/g, '')) * 100) || 0
    if (cents <= 0) { wx.showToast({ title: '充值金额要大于 0(赠送随充值一起记)', icon: 'none' }); return }
    if (this.data.busy) return
    this.setData({ busy: true })
    try {
      await api.adminPost('/admin/stored-value/recharge', {
        userId: this.data.userId, amountCents: cents, bonusCents: bonus,
        payChannel: this.data.rvChannels[this.data.rvChannelIdx].id,
        technicianId: this.data.techIds[this.data.techIdx] || undefined
      })
      wx.showToast({ title: `已到账 ${storeMoney(cents, 2)}${bonus ? ` 赠 ${storeMoney(bonus, 2)}` : ''}`, icon: 'none' })
      this.setData({ busy: false, rvAmount: '', rvBonus: '', rvPkgId: '', rvAmountText: '' })
      this.load()   // 余额等四数=真值重拉,不前端加减
    } catch (e) {
      this.setData({ busy: false })
      wx.showToast({ title: (e && e.message) || '充值失败', icon: 'none' })
    }
  },

  /* ===== 冲销(内嵌):本月与这位顾客订单关联的账本流水 ===== */
  curMonth() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  },
  prevMonth() { this.loadTxns(this.shiftMonth(this.data.month, -1)) },
  nextMonth() { this.loadTxns(this.shiftMonth(this.data.month, 1)) },
  shiftMonth(m, d) {
    const [y, mo] = m.split('-').map(Number)
    const t = new Date(y, mo - 1 + d, 1)
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`
  },
  async loadTxns(month) {
    this.setData({ txnsLoading: true, month })
    try {
      /* 裁定2(08-30d):储值行与账本行同列一表,两读口合流(与网页同刀) */
      const [tx, sv, bks] = await Promise.all([
        api.adminGet(`/admin/finance/transactions?month=${month}`),
        api.adminGet(`/admin/stored-value/txns?month=${month}`).catch(() => ({ txns: [] })),
        this._bookingIds ? Promise.resolve(null) : api.adminGet('/admin/bookings')
      ])
      if (bks) this._bookingIds = new Set((bks.bookings || []).filter((b) => b.user && b.user.id === this.data.userId).map((b) => b.id))
      const all = tx.transactions || []
      const reversedSet = new Set(all.filter((t) => t.reversalOf).map((t) => t.reversalOf))
      const finRows = all
        .filter((t) => t.bookingId && this._bookingIds.has(t.bookingId))
        .map((t) => ({
          id: t.id, kind: 'fin', occurredOn: t.occurredOn, note: t.note || t.category || t.source,
          amountText: storeMoney(Math.abs(t.amountCents), 2),
          negative: t.amountCents < 0,
          isReversal: t.source === 'reversal',
          reversed: reversedSet.has(t.id),
          canReverse: t.source !== 'reversal' && !reversedSet.has(t.id)
        }))
      const SV_LABEL = { recharge: '储值充值', bonus: '充值赠送', reversal: '储值冲销单' }
      const svRows = (sv.txns || [])
        .filter((t) => t.userId === this.data.userId && t.type !== 'consume')
        .map((t) => ({
          id: t.id, kind: 'sv', occurredOn: t.occurredOn,
          note: `${SV_LABEL[t.type] || t.type}${t.note ? ' · ' + t.note : ''}`,
          amountText: storeMoney(Math.abs(t.amountCents), 2),
          negative: t.amountCents < 0,
          isReversal: t.type === 'reversal',
          reversed: Boolean(t.reversed),
          canReverse: t.type === 'recharge' && !t.reversed
        }))
      const rows = finRows.concat(svRows).sort((a, b) => String(b.occurredOn).localeCompare(String(a.occurredOn)))
      this.setData({ txns: rows, txnsLoading: false })
    } catch (e) {
      this.setData({ txnsLoading: false })
      wx.showToast({ title: (e && e.message) || '读取流水失败', icon: 'none' })
    }
  },
  reverseTxn(e) {
    const { id, note, kind } = e.currentTarget.dataset
    if (this.data.busy) return
    wx.showModal({
      title: '确认冲销?',
      content: `将生成一条等额红字反向记录纠错,原始记录保留:${note || id}`,
      success: async (r) => {
        if (!r.confirm) return
        this.setData({ busy: true })
        try {
          const url = kind === 'sv'
            ? `/admin/stored-value/txns/${encodeURIComponent(id)}/reverse`
            : `/admin/finance/transactions/${encodeURIComponent(id)}/reverse`
          await api.adminPost(url, {})
          wx.showToast({ title: '已冲销(红字反向记录已生成)', icon: 'none' })
          this.setData({ busy: false })
          const f = await api.adminGet(`/admin/account-adjust/facts?userId=${encodeURIComponent(this.data.userId)}`).catch(() => null)
          if (f) this.setData({ facts: f.facts })   // 判据⑤:四参考数联动=真值重拉
          this.loadTxns(this.data.month)
        } catch (err) {
          this.setData({ busy: false })
          wx.showToast({ title: (err && err.message) || '冲销失败', icon: 'none' })
        }
      },
      fail: (err) => console.warn('[showModal fail]', err)
    })
  },

  /* ===== 退卡(原样) ===== */
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
  }
})
