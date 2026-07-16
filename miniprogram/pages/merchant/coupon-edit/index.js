const api = require('../../../utils/api')

Page({
  data: {
    id: '', isNew: true,
    typeIdx: 0, types: [{ k: 'amount', label: '满减券' }, { k: 'percent', label: '折扣券' }],
    name: '', amount: '', percent: '', minSpend: '', validDays: '30', totalQty: '', active: true,
    saving: false
  },

  onLoad(opt) {
    if (opt && opt.id) {
      this.setData({ id: opt.id, isNew: false })
      wx.setNavigationBarTitle({ title: '编辑优惠券' })
      this.load(opt.id)
    }
  },

  async load(id) {
    try {
      const r = await api.adminGet('/admin/coupons')
      const c = (r.coupons || []).find((x) => x.id === id)
      if (!c) { wx.showToast({ title: '未找到', icon: 'none' }); return }
      this.setData({
        typeIdx: c.discountType === 'percent' ? 1 : 0,
        name: c.name,
        amount: c.amountCents ? String(c.amountCents / 100) : '',
        percent: c.percentOff ? String(c.percentOff) : '',
        minSpend: c.minSpendCents ? String(c.minSpendCents / 100) : '',
        validDays: String(c.validDays || 30),
        totalQty: c.totalQty ? String(c.totalQty) : '',
        active: c.isActive !== false
      })
    } catch (e) { wx.showToast({ title: '加载失败', icon: 'none' }) }
  },

  onType(e) { this.setData({ typeIdx: Number(e.detail.value) }) },
  onName(e) { this.setData({ name: e.detail.value }) },
  onAmount(e) { this.setData({ amount: e.detail.value }) },
  onPercent(e) { this.setData({ percent: e.detail.value }) },
  onMin(e) { this.setData({ minSpend: e.detail.value }) },
  onDays(e) { this.setData({ validDays: e.detail.value }) },
  onQty(e) { this.setData({ totalQty: e.detail.value }) },
  onActive(e) { this.setData({ active: e.detail.value }) },

  async save() {
    if (this.data.saving) return
    const { id, isNew, typeIdx, types, name, amount, percent, minSpend, validDays, totalQty, active } = this.data
    if (!name.trim()) { wx.showToast({ title: '请输入券名', icon: 'none' }); return }
    const type = types[typeIdx].k
    if (type === 'amount' && !(Number(amount) > 0)) { wx.showToast({ title: '请输入面额', icon: 'none' }); return }
    if (type === 'percent' && !(Number(percent) > 0)) { wx.showToast({ title: '请输入折扣', icon: 'none' }); return }
    const body = {
      name: name.trim(), discountType: type,
      amountCents: type === 'amount' ? Math.round((Number(amount) || 0) * 100) : 0,
      percentOff: type === 'percent' ? Math.round(Number(percent) || 0) : 0,
      minSpendCents: Math.round((Number(minSpend) || 0) * 100),
      validDays: Math.round(Number(validDays) || 30),
      totalQty: Math.round(Number(totalQty) || 0),
      isActive: active
    }
    this.setData({ saving: true })
    try {
      if (isNew) await api.adminPost('/admin/coupons', body)
      else await api.adminPatch(`/admin/coupons/${encodeURIComponent(id)}`, body)
      wx.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    } catch (err) { wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' }) }
    finally { this.setData({ saving: false }) }
  }
})
