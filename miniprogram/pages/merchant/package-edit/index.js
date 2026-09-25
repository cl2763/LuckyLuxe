const api = require('../../../utils/api')
const { refreshStoreClock, storeCurrencyPrefix } = require('../../../utils/storeclock')

Page({
  // 门禁:未登录/会话失效不渲染空壳,直接回登录页(店主 2026-08-09 红线)
  async onShow() { if (!(await api.guardOwner())) return; await refreshStoreClock().catch(() => {}); this.setData({ currency: storeCurrencyPrefix() }) },
  data: {
    id: '', isNew: true, kind: 'recharge',
    name: '', price: '', bonus: '', times: '', scope: '', benefits: '', active: true,
    giftItems: [], currency: '', saving: false
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
        giftItems: (p.giftItems || []).map((g) => ({ name: g.name, quantity: String(g.quantity), value: String(g.unitValueCents / 100) })),
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

  addGift() { if (this.data.giftItems.length < 20) this.setData({ giftItems: this.data.giftItems.concat({ name: '', quantity: '1', value: '' }) }) },
  removeGift(e) { this.setData({ giftItems: this.data.giftItems.filter((_, i) => i !== Number(e.currentTarget.dataset.i)) }) },
  onGift(e) { const { i, field } = e.currentTarget.dataset; if (!['name', 'quantity', 'value'].includes(field)) return; this.setData({ [`giftItems[${i}].${field}`]: e.detail.value }) },

  async save() {
    if (this.data.saving) return
    const { id, isNew, kind, name, price, bonus, times, scope, benefits, active } = this.data
    if (!name.trim()) { wx.showToast({ title: '请输入名称', icon: 'none' }); return }
    const p = /^\d+(\.\d{1,2})?$/.test(String(price).trim()) ? Number(price) : NaN
    if (!p || p <= 0) { wx.showToast({ title: '请输入售价', icon: 'none' }); return }
    if (kind === 'times' && !(Number(times) > 0)) { wx.showToast({ title: '请输入次数', icon: 'none' }); return }
    let giftItems = []
    if (kind === 'recharge') {
      if (bonus && (!/^\d+(\.\d{1,2})?$/.test(String(bonus)) || !Number.isFinite(Number(bonus)))) { wx.showToast({ title: '赠送金额须为非负金额', icon: 'none' }); return }
      for (let i = 0; i < this.data.giftItems.length; i++) {
        const g = this.data.giftItems[i], n = g.name.trim(), q = String(g.quantity), v = String(g.value)
        if (!n || n.length > 80 || !/^\d+$/.test(q) || +q < 1 || +q > 999 || !/^\d+(\.\d{1,2})?$/.test(v) || +v > 1000000) {
          wx.showToast({ title: `请检查第${i + 1}行名称、整数数量和非负价值`, icon: 'none' }); return
        }
        giftItems.push({ name: n, quantity: Number(q), unitValueCents: Math.round(Number(v) * 100) })
      }
    }
    const body = {
      kind, giftItems, name: name.trim(),
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
