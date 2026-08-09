const api = require('../../../utils/api')

Page({
  data: {
    seg: 0,
    segs: ['充值套餐', '会员次卡', '优惠券'],
    recharges: [], timesCards: [], coupons: [],
    customers: [],
    // 屏 C3 自定义发放(小程序老板版)
    grantQuery: '', grantResults: [], grantPicked: null, grants: []
  },

  onLoad(opt) {
    const seg = Number(opt && opt.seg)
    if (seg === 1 || seg === 2) this.setData({ seg })
  },

  async onShow() { if (!(await api.guardOwner())) return; this.loadAll() },

  async loadAll() {
    try {
      const [pkg, cpn, cust] = await Promise.all([
        api.adminGet('/admin/packages').catch(() => ({ packages: [] })),
        api.adminGet('/admin/coupons').catch(() => ({ coupons: [] })),
        api.adminGet('/admin/customers').catch(() => ({ customers: [] }))
      ])
      const pkgs = pkg.packages || []
      const recharges = pkgs.filter((p) => p.kind === 'recharge').map((p) => ({
        id: p.id, name: p.name, active: p.isActive !== false,
        sub: `售价 $${(p.priceCents || 0) / 100}` + (p.bonusCents ? ` · 送 $${p.bonusCents / 100}` : '') + (p.benefits ? ` · ${p.benefits}` : '')
      }))
      const timesCards = pkgs.filter((p) => p.kind === 'times').map((p) => ({
        id: p.id, name: p.name, active: p.isActive !== false,
        sub: `售价 $${(p.priceCents || 0) / 100}` + (p.timesCount ? ` · ${p.timesCount} 次` : '') + (p.scope ? ` · ${p.scope}` : '')
      }))
      const coupons = (cpn.coupons || []).map((c) => ({
        id: c.id, name: c.name, active: c.isActive !== false,
        sub: (c.discountType === 'percent' ? `立减 ${c.percentOff}%` : `减 $${(c.amountCents || 0) / 100}`)
          + (c.minSpendCents ? ` · 满 $${c.minSpendCents / 100}` : ' · 无门槛')
          + ` · ${c.validDays}天`
          + (c.totalQty ? ` · 限 ${c.totalQty} 张` : '')
      }))
      const list = (cust.customers || []).slice().sort((a, b) => new Date(b.lastVisitAt || 0) - new Date(a.lastVisitAt || 0))
      this.setData({ recharges, timesCards, coupons, customers: list })
      this.loadGrants()
    } catch (e) { /* ignore */ }
  },

  /* ===== 屏 C3 自定义发放(仅老板;员工端后端一律 403)===== */
  async loadGrants() {
    try {
      const r = await api.adminGet('/admin/coupon-grants')
      const st = { active: '未使用', used: '已核销', revoked: '已作废', expired: '已过期' }
      this.setData({
        grants: (r.grants || []).slice(0, 30).map((g) => Object.assign({}, g, { statusText: st[g.status] || g.status }))
      })
    } catch (e) { this.setData({ grants: [] }) }
  },
  onGrantSearch(e) {
    const q = e.detail.value
    this.setData({ grantQuery: q })
    clearTimeout(this._gt)
    this._gt = setTimeout(async () => {
      if (!q.trim()) { this.setData({ grantResults: [] }); return }
      try {
        const r = await api.adminGet(`/admin/customers?q=${encodeURIComponent(q.trim())}`)
        this.setData({ grantResults: (r.customers || []).slice(0, 8) })
      } catch (err) { this.setData({ grantResults: [] }) }
    }, 250)
  },
  pickGrant(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ grantPicked: this.data.grantResults.find((c) => c.id === id) || null })
  },
  unpickGrant() { this.setData({ grantPicked: null, grantQuery: '', grantResults: [] }) },

  ask(title, placeholder) {
    return new Promise((resolve) => {
      wx.showModal({
        title, editable: true, placeholderText: placeholder, content: '',
        success: (r) => resolve(r.confirm ? (r.content || '').trim() : null)
      })
    })
  },
  async grantCustom() {
    const amount = await this.ask('券面额', '例:50')
    if (amount === null) return
    const cents = Math.round(Number(String(amount).replace(/[^\d.]/g, '')) * 100)
    if (!Number.isFinite(cents) || cents <= 0) { wx.showToast({ title: '金额不对', icon: 'none' }); return }
    const min = await this.ask('使用门槛(留空=无门槛)', '例:300')
    if (min === null) return
    const reason = await this.ask('发放原因(必填)', '例:上次服务补偿')
    if (reason === null) return
    if (!reason) { wx.showToast({ title: '发放原因必填', icon: 'none' }); return }
    this.doGrant({
      userId: this.data.grantPicked.id, amountCents: cents,
      minSpendCents: Math.max(0, Math.round(Number(String(min).replace(/[^\d.]/g, '')) * 100) || 0),
      validDays: 30, reason
    })
  },
  async grantTemplate() {
    const actives = this.data.coupons.filter((c) => c.active)
    if (!actives.length) { wx.showToast({ title: '还没有可用的券模板', icon: 'none' }); return }
    wx.showActionSheet({
      itemList: actives.map((c) => c.name).slice(0, 6),
      success: async (r) => {
        const tpl = actives[r.tapIndex]
        if (!tpl) return
        const reason = await this.ask('发放原因(必填)', '例:充值¥1000档赠送')
        if (reason === null) return
        if (!reason) { wx.showToast({ title: '发放原因必填', icon: 'none' }); return }
        this.doGrant({ userId: this.data.grantPicked.id, mode: 'template', couponId: tpl.id, validDays: 90, reason })
      }
    })
  },
  async doGrant(body) {
    try {
      const r = await api.adminPost('/admin/coupon-grants/custom', body)
      wx.showToast({ title: `已发给 ${r.granted.userName}`, icon: 'none' })
      this.unpickGrant()
      this.loadGrants()
    } catch (e) { wx.showToast({ title: (e && e.message) || '发放失败', icon: 'none' }) }
  },

  onSeg(e) { this.setData({ seg: Number(e.currentTarget.dataset.i) }) },

  add() {
    const seg = this.data.seg
    if (seg === 0) wx.navigateTo({ url: '/pages/merchant/package-edit/index?kind=recharge' })
    else if (seg === 1) wx.navigateTo({ url: '/pages/merchant/package-edit/index?kind=times' })
    else wx.navigateTo({ url: '/pages/merchant/coupon-edit/index' })
  },

  edit(e) {
    const { id, type } = e.currentTarget.dataset
    if (type === 'coupon') wx.navigateTo({ url: '/pages/merchant/coupon-edit/index?id=' + encodeURIComponent(id) })
    else wx.navigateTo({ url: `/pages/merchant/package-edit/index?kind=${type}&id=${encodeURIComponent(id)}` })
  },

  async toggle(e) {
    const { id, type, active } = e.currentTarget.dataset
    const next = !active
    const path = type === 'coupon' ? '/admin/coupons/' : '/admin/packages/'
    try {
      await api.adminPatch(path + encodeURIComponent(id), { isActive: next })
      this.loadAll()
    } catch (err) { wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' }) }
  },

  // 核销顾客的券:扫码或手输核销码,一次性防重复
  redeemCode() {
    wx.showActionSheet({
      itemList: ['扫顾客的核销码', '手动输入券码'],
      success: (r) => {
        if (r.tapIndex === 0) {
          wx.scanCode({
            success: (res) => this.doRedeem(String(res.result || '').trim()),
            fail: () => {}
          })
        } else {
          wx.showModal({
            title: '核销券码', editable: true, placeholderText: '如 LL-XXXX-XXXX',
            success: (m) => { if (m.confirm) this.doRedeem(String(m.content || '').trim()) }
          })
        }
      }
    })
  },

  async doRedeem(code) {
    if (!code) return
    try {
      const r = await api.adminPost('/admin/coupons/redeem', { code })
      wx.showModal({ title: '核销成功 ✓', content: `${r.redeemed.couponName}\n${r.redeemed.discountText} · ${r.redeemed.minSpendText}\n请在结账时抵扣`, showCancel: false })
    } catch (err) {
      wx.showModal({ title: '核销失败', content: (err && err.message) || '券码无效', showCancel: false })
    }
  },

  async manualRecharge() {
    if (!(api.getFinanceKey && api.getFinanceKey())) {
      wx.showModal({
        title: '需先解锁财务', content: '加储值属于资金操作,请先到财务页输入财务密码解锁本次会话。',
        confirmText: '去财务页', success: (r) => { if (r.confirm) wx.navigateTo({ url: '/pages/merchant/finance/index' }) }
      })
      return
    }
    const list = this.data.customers.slice(0, 6)
    if (!list.length) { wx.showToast({ title: '暂无会员', icon: 'none' }); return }
    wx.showActionSheet({
      itemList: list.map((c) => `${c.displayName || '会员'} · 余额$${((c.storedValueBalanceCents || 0) / 100).toFixed(0)}`),
      success: (r) => this.askAmount(list[r.tapIndex])
    })
  },

  askAmount(cust) {
    wx.showModal({
      title: `给 ${cust.displayName || '会员'} 加储值`, editable: true, placeholderText: '输入到账金额(加元),如 1000',
      success: (r) => {
        if (!r.confirm) return
        const v = Number(String(r.content).replace(/[^\d.]/g, ''))
        if (!v || v <= 0) { wx.showToast({ title: '金额无效', icon: 'none' }); return }
        this.askRechargeTech(cust, v)
      }
    })
  },

  // 经手技师(可选):这笔充值算谁促成 → 计入该技师的「充值提成」
  async askRechargeTech(cust, amount) {
    let techs = []
    try { const t = await api.adminGet('/admin/technicians'); techs = (t.technicians || []).filter((x) => x.is_active !== 0 && x.isActive !== false) } catch (e) { /* 忽略 */ }
    const items = ['店里直收(不计提成)'].concat(techs.map((x) => `${x.name} 促成`))
    wx.showActionSheet({
      itemList: items.slice(0, 6),
      success: (r) => this.doRecharge(cust, amount, r.tapIndex === 0 ? '' : techs[r.tapIndex - 1].id),
      fail: () => this.doRecharge(cust, amount, '') // 点取消也照常入账,不挡钱
    })
  },
  async doRecharge(cust, amount, technicianId) {
    try {
      const body = { userId: cust.id, amountCents: Math.round(amount * 100), payChannel: 'manual', note: '线下手动补录' }
      if (technicianId) body.technicianId = technicianId
      const resp = await api.adminPost('/admin/stored-value/recharge', body)
      const bal = resp && resp.balanceCents != null ? '$' + (resp.balanceCents / 100).toFixed(0) : ''
      wx.showToast({ title: '已到账 ' + bal, icon: 'none' })
      this.loadAll()
    } catch (err) { wx.showToast({ title: (err && err.message) || '充值失败', icon: 'none' }) }
  }
})
