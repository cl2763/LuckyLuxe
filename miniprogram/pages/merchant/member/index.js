const api = require('../../../utils/api')

Page({
  data: {
    seg: 0,
    segs: ['充值套餐', '会员次卡', '优惠券'],
    recharges: [], timesCards: [], coupons: [],
    customers: []
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
    } catch (e) { /* ignore */ }
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
      success: async (r) => {
        if (!r.confirm) return
        const v = Number(String(r.content).replace(/[^\d.]/g, ''))
        if (!v || v <= 0) { wx.showToast({ title: '金额无效', icon: 'none' }); return }
        try {
          const resp = await api.adminPost('/admin/stored-value/recharge', {
            userId: cust.id, amountCents: Math.round(v * 100), payChannel: 'manual', note: '线下手动补录'
          })
          const bal = resp && resp.balanceCents != null ? '$' + (resp.balanceCents / 100).toFixed(0) : ''
          wx.showToast({ title: '已到账 ' + bal, icon: 'none' })
          this.loadAll()
        } catch (err) { wx.showToast({ title: (err && err.message) || '充值失败', icon: 'none' }) }
      }
    })
  }
})
