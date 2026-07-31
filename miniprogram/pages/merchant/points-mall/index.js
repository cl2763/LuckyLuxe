const api = require('../../../utils/api')

Page({
  data: {
    prizes: [], coupons: [],
    // 新增/编辑弹层:每个数字都是 input
    sheet: false, editId: '', couponIdx: 0,
    cost: '', stock: '', limit: '', validDays: '', active: true,
    // 券来源:new 当场新建(默认,像添加服务项目一样自己起名)| pick 用已有券
    couponMode: 'new',
    ncName: '', ncTypeIdx: 0, ncTypes: [{ k: 'amount', label: '减免金额' }, { k: 'percent', label: '打折' }, { k: 'free', label: '免费项目/礼品' }],
    ncAmount: '', ncPercent: '', ncMinSpend: '',
    saving: false
  },

  async onShow() { if (!(await api.guardOwner())) return; this.load() },

  async load() {
    try {
      const [p, c] = await Promise.all([
        api.adminGet('/admin/points-prizes'),
        api.adminGet('/admin/coupons')
      ])
      const coupons = (c.coupons || []).filter((x) => x.isActive !== false && x.is_active !== 0)
      this.setData({
        coupons,
        prizes: (p.prizes || []).map((x) => ({
          ...x,
          desc: `${x.discountType === 'percent' ? x.percentOff + '% off' : '减 $' + Math.round((x.amountCents || 0) / 100)} · 库存 ${x.stock} · 已兑 ${x.redeemedQty}${x.perUserLimit ? ' · 每人限 ' + x.perUserLimit : ''}`
        }))
      })
    } catch (e) { wx.showToast({ title: '加载失败', icon: 'none' }) }
  },

  openAdd() {
    this.setData({
      sheet: true, editId: '', couponIdx: 0, cost: '', stock: '10', limit: '0', validDays: '', active: true,
      couponMode: 'new', ncName: '', ncTypeIdx: 0, ncAmount: '', ncPercent: '', ncMinSpend: ''
    })
  },
  setCouponMode(e) {
    const m = e.currentTarget.dataset.m
    if (m === 'pick' && !this.data.coupons.length) { wx.showToast({ title: '还没有已建的券,直接新建吧', icon: 'none' }); return }
    this.setData({ couponMode: m })
  },
  onNcName(e) { this.setData({ ncName: e.detail.value }) },
  onNcType(e) { this.setData({ ncTypeIdx: Number(e.detail.value) }) },
  onNcTypeTap(e) { this.setData({ ncTypeIdx: Number(e.currentTarget.dataset.i) }) },
  onNcAmount(e) { this.setData({ ncAmount: e.detail.value }) },
  onNcPercent(e) { this.setData({ ncPercent: e.detail.value }) },
  onNcMinSpend(e) { this.setData({ ncMinSpend: e.detail.value }) },
  openEdit(e) {
    const p = this.data.prizes.find((x) => x.id === e.currentTarget.dataset.id)
    if (!p) return
    const ci = this.data.coupons.findIndex((c) => c.id === p.couponId)
    this.setData({
      sheet: true, editId: p.id, couponIdx: ci >= 0 ? ci : 0, prizeName: p.name,
      cost: String(p.costPoints), stock: String(p.stock), limit: String(p.perUserLimit || 0),
      validDays: p.validDays ? String(p.validDays) : '', active: p.isActive
    })
  },
  closeSheet() { this.setData({ sheet: false }) },
  onCoupon(e) { this.setData({ couponIdx: Number(e.detail.value) }) },
  onCost(e) { this.setData({ cost: e.detail.value }) },
  onStock(e) { this.setData({ stock: e.detail.value }) },
  onLimit(e) { this.setData({ limit: e.detail.value }) },
  onDays(e) { this.setData({ validDays: e.detail.value }) },
  toggleActive() { this.setData({ active: !this.data.active }) },

  async save() {
    if (this.data.saving) return
    const d = this.data
    if (!Number(d.cost) || Number(d.cost) <= 0) { wx.showToast({ title: '填一下所需积分', icon: 'none' }); return }
    this.setData({ saving: true })
    try {
      const body = {
        costPoints: Number(d.cost), stock: Number(d.stock) || 0,
        perUserLimit: Number(d.limit) || 0,
        validDays: d.validDays === '' ? 0 : Number(d.validDays),
        isActive: d.active
      }
      if (d.editId) {
        await api.adminRequest(`/admin/points-prizes/${encodeURIComponent(d.editId)}`, 'PATCH', body)
      } else if (d.couponMode === 'new') {
        // 当场新建券(名称/类型自定,像添加服务项目一样)→ 再上架为奖品
        const name = (d.ncName || '').trim()
        if (!name) { wx.showToast({ title: '给奖品起个名字', icon: 'none' }); this.setData({ saving: false }); return }
        const t = d.ncTypes[d.ncTypeIdx].k
        if (t === 'amount' && !(Number(d.ncAmount) > 0)) { wx.showToast({ title: '填一下减免金额', icon: 'none' }); this.setData({ saving: false }); return }
        if (t === 'percent' && !(Number(d.ncPercent) > 0)) { wx.showToast({ title: '填一下折扣(如 80=8折)', icon: 'none' }); this.setData({ saving: false }); return }
        const c = await api.adminPost('/admin/coupons', {
          name,
          discountType: t === 'percent' ? 'percent' : 'amount',
          // 免费项目/礼品:面额记 0,凭券名到店核销即可
          amountCents: t === 'amount' ? Math.round(Number(d.ncAmount) * 100) : 0,
          percentOff: t === 'percent' ? Math.round(Number(d.ncPercent)) : 0,
          minSpendCents: Number(d.ncMinSpend) > 0 ? Math.round(Number(d.ncMinSpend) * 100) : 0,
          validDays: Number(d.validDays) > 0 ? Number(d.validDays) : 30
        })
        body.couponId = c.coupon.id
        await api.adminPost('/admin/points-prizes', body)
      } else {
        body.couponId = d.coupons[d.couponIdx].id
        await api.adminPost('/admin/points-prizes', body)
      }
      wx.showToast({ title: '已保存', icon: 'success' })
      this.setData({ sheet: false })
      this.load()
    } catch (err) { wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' }) }
    this.setData({ saving: false })
  },

  async quickToggle(e) {
    const p = this.data.prizes.find((x) => x.id === e.currentTarget.dataset.id)
    if (!p) return
    try {
      await api.adminRequest(`/admin/points-prizes/${encodeURIComponent(p.id)}`, 'PATCH', { isActive: !p.isActive })
      this.load()
    } catch (err) { wx.showToast({ title: '操作失败', icon: 'none' }) }
  },

  // 撤销兑换(误兑):输券码,券未核销则作废+积分退回
  revoke() {
    wx.showModal({
      title: '撤销兑换', editable: true, placeholderText: '输入顾客的券码(如 LL-XXXX-XXXX)',
      confirmText: '撤销并退积分',
      success: async (m) => {
        if (!m.confirm || !m.content) return
        try {
          const r = await api.adminPost('/admin/points-mall/revoke', { code: m.content.trim() })
          wx.showToast({ title: `已撤销,退回 ${r.refundedPoints} 积分`, icon: 'none', duration: 2500 })
          this.load()
        } catch (err) { wx.showToast({ title: (err && err.message) || '撤销失败', icon: 'none', duration: 2500 }) }
      }
    })
  }
})
