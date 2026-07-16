const api = require('../../../utils/api')

Page({
  data: {
    id: '', isNew: true, kind: 'recharge',
    name: '', price: '', bonus: '', times: '', scope: '', benefits: '', active: true,
    saving: false
  },

  onLoad(opt) {
    const kind = opt && opt.kind === 'times' ? 'times' : 'recharge'
    if (opt && opt.id) {
      this.setData({ id: opt.id, isNew: false, kind })
      wx.setNavigationBarTitle({ title: kind === 'times' ? '编辑次卡' : '编辑充值套餐' })
      this.load(opt.id)
    } else {
      this.setData({ kind })
      wx.setNavigationBarTitle({ title: kind === 'times' ? '新增次卡' : '新增充值套餐' })
    }
  },

  async load(id) {
    try {
      const r = await api.adminGet('/admin/packages')
      const p = (r.packages || []).find((x) => x.id === id)
      if (!p) { wx.showToast({ title: '未找到', icon: 'none' }); return }
      this.setData({
        kind: p.kind, name: p.name,
        price: String((p.priceCents || 0) / 100),
        bonus: p.bonusCents ? String(p.bonusCents / 100) : '',
        times: p.timesCount ? String(p.timesCount) : '',
        scope: p.scope || '', benefits: p.benefits || '', active: p.isActive !== false
      })
    } catch (e) { wx.showToast({ title: '加载失败', icon: 'none' }) }
  },

  onName(e) { this.setData({ name: e.detail.value }) },
  onPrice(e) { this.setData({ price: e.detail.value }) },
  onBonus(e) { this.setData({ bonus: e.detail.value }) },
  onTimes(e) { this.setData({ times: e.detail.value }) },
  onScope(e) { this.setData({ scope: e.detail.value }) },
  onBenefits(e) { this.setData({ benefits: e.detail.value }) },
  onActive(e) { this.setData({ active: e.detail.value }) },

  async save() {
    if (this.data.saving) return
    const { id, isNew, kind, name, price, bonus, times, scope, benefits, active } = this.data
    if (!name.trim()) { wx.showToast({ title: '请输入名称', icon: 'none' }); return }
    const p = Number(String(price).replace(/[^\d.]/g, ''))
    if (!p || p <= 0) { wx.showToast({ title: '请输入售价', icon: 'none' }); return }
    if (kind === 'times' && !(Number(times) > 0)) { wx.showToast({ title: '请输入次数', icon: 'none' }); return }
    const body = {
      kind, name: name.trim(),
      priceCents: Math.round(p * 100),
      bonusCents: kind === 'recharge' ? Math.round((Number(bonus) || 0) * 100) : 0,
      timesCount: kind === 'times' ? Math.round(Number(times) || 0) : 0,
      scope: scope.trim(), benefits: benefits.trim(), isActive: active
    }
    this.setData({ saving: true })
    try {
      if (isNew) await api.adminPost('/admin/packages', body)
      else await api.adminPatch(`/admin/packages/${encodeURIComponent(id)}`, body)
      wx.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    } catch (err) { wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' }) }
    finally { this.setData({ saving: false }) }
  }
})
