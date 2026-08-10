const api = require('../../../utils/api')
const { storeMoney, storeCurrencyPrefix, ensureCurrencyCached } = require('../../../utils/storeclock')

Page({
  data: {
    seg: 0,
    segs: ['充值套餐', '会员次卡', '优惠券'],
    recharges: [], timesCards: [], coupons: [],
    customers: [],
    // 屏 C3 自定义发放(小程序老板版)
    grantQuery: '', grantResults: [], grantPicked: null, grants: [],
    // F4 给会员加储值(平铺块,与自定义发放同层)
    rvQuery: '', rvResults: [], rvPicked: null, rvAmount: '', rvAmountText: '',
    rvCurrency: '', rvTechs: [], rvTechNames: ['店里直收(不计提成)'], rvTechIndex: 0
  },

  onLoad(opt) {
    const seg = Number(opt && opt.seg)
    if (seg === 1 || seg === 2) this.setData({ seg })
  },

  async onShow() {
    if (!(await api.guardOwner())) return
    await ensureCurrencyCached().catch(() => {})
    // R4:要的是**币符**(¥/CAD $),不是币种代码(CNY)——以前显示成「CNY 如 1000」
    this.setData({ rvCurrency: storeCurrencyPrefix() })
    this.loadAll()
  },

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
        const reason = await this.ask('发放原因(必填)', '例:充值 1000 档赠送')
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

  /* ===== F4 给会员加储值(平铺块)=====
     金额红线:本块一处金额运算都没有 —— 只把店主输入的数字换算成分发给后端,
     余额与到账结果全部由 /admin/stored-value/* 返回。 */
  onRvSearch(e) {
    const q = String(e.detail.value || '').trim()
    const hit = q ? (this.data.customers || []).filter((c) =>
      String(c.displayName || '').includes(q) || String(c.phone || '').includes(q)).slice(0, 6) : []
    this.setData({ rvQuery: q, rvResults: hit.map((c) => this.rvShape(c)) })
  },
  rvShape(c) {
    return { id: c.id, displayName: c.displayName || '会员', balanceText: storeMoney(c.storedValueBalanceCents || 0, 0) }
  },
  pickRv(e) {
    const c = (this.data.customers || []).find((x) => x.id === e.currentTarget.dataset.id)
    if (!c) return
    this.setData({ rvPicked: this.rvShape(c), rvResults: [] })
    this.loadRvTechs()
  },
  unpickRv() { this.setData({ rvPicked: null, rvQuery: '', rvResults: [], rvAmount: '', rvAmountText: '', rvTechIndex: 0 }) },
  async loadRvTechs() {
    if (this.data.rvTechs.length) return
    try {
      const t = await api.adminGet('/admin/technicians')
      const techs = (t.technicians || []).filter((x) => x.is_active !== 0 && x.isActive !== false)
      this.setData({ rvTechs: techs, rvTechNames: ['店里直收(不计提成)'].concat(techs.map((x) => `${x.name} 促成`)) })
    } catch (e) { /* 拉不到技师不挡充值 */ }
  },
  onRvTech(e) { this.setData({ rvTechIndex: Number(e.detail.value) || 0 }) },
  onRvAmount(e) {
    const raw = String(e.detail.value || '').replace(/[^\d.]/g, '')
    const v = Number(raw)
    this.setData({ rvAmount: raw, rvAmountText: v > 0 ? ` ${storeMoney(Math.round(v * 100), 0)}` : '' })
  },

  async doRecharge() {
    const cust = this.data.rvPicked
    const amount = Number(this.data.rvAmount)
    if (!cust) { wx.showToast({ title: '先选一位会员', icon: 'none' }); return }
    if (!(amount > 0)) { wx.showToast({ title: '金额无效', icon: 'none' }); return }
    // 加储值是资金操作:本次会话没解锁财务的,先去财务页输密码(与网页同一道门)
    if (!(api.getFinanceKey && api.getFinanceKey())) {
      wx.showModal({
        title: '需先解锁财务', content: '加储值属于资金操作,请先到财务页输入财务密码解锁本次会话。',
        confirmText: '去财务页', success: (r) => { if (r.confirm) wx.navigateTo({ url: '/pages/merchant/finance/index' }) }
      })
      return
    }
    const tech = this.data.rvTechs[this.data.rvTechIndex - 1]
    try {
      const body = { userId: cust.id, amountCents: Math.round(amount * 100), payChannel: 'manual', note: '线下手动补录' }
      if (tech) body.technicianId = tech.id
      const resp = await api.adminPost('/admin/stored-value/recharge', body)
      const bal = resp && resp.balanceCents != null ? storeMoney(resp.balanceCents, 0) : ''
      wx.showToast({ title: '已到账,余额 ' + bal, icon: 'none' })
      this.unpickRv()
      this.loadAll()
    } catch (err) { wx.showToast({ title: (err && err.message) || '充值失败', icon: 'none' }) }
  }
})
