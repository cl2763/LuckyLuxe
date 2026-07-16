const api = require('../../../utils/api')

Page({
  data: {
    id: '',
    isNew: true,
    typeIdx: 0,
    types: [{ k: 'NAIL', label: '美甲' }, { k: 'LASH', label: '美睫' }],
    nameZh: '', nameEn: '', category: '',
    price: '', duration: '', active: true,
    saving: false
  },

  onLoad(opt) {
    if (opt && opt.id) {
      this.setData({ id: opt.id, isNew: false })
      wx.setNavigationBarTitle({ title: '编辑服务' })
      this.load(opt.id)
    } else {
      wx.setNavigationBarTitle({ title: '新增服务' })
    }
  },

  async load(id) {
    try {
      const r = await api.adminGet('/admin/services')
      const s = (r.services || []).find((x) => x.id === id)
      if (!s) { wx.showToast({ title: '未找到', icon: 'none' }); return }
      this.setData({
        typeIdx: s.type === 'lash' ? 1 : 0,
        nameZh: s.nameZh || '', nameEn: s.nameEn || '', category: s.category || '',
        price: String((s.priceCents || 0) / 100),
        duration: String(s.durationMin || ''),
        active: s.isActive !== false
      })
    } catch (e) { wx.showToast({ title: '加载失败', icon: 'none' }) }
  },

  onType(e) { this.setData({ typeIdx: Number(e.detail.value) }) },
  onZh(e) { this.setData({ nameZh: e.detail.value }) },
  onEn(e) { this.setData({ nameEn: e.detail.value }) },
  onCat(e) { this.setData({ category: e.detail.value }) },
  onPrice(e) { this.setData({ price: e.detail.value }) },
  onDur(e) { this.setData({ duration: e.detail.value }) },
  onActive(e) { this.setData({ active: e.detail.value }) },

  async save() {
    if (this.data.saving) return
    const { id, isNew, typeIdx, types, nameZh, nameEn, category, price, duration, active } = this.data
    if (!nameZh.trim()) { wx.showToast({ title: '请输入中文名', icon: 'none' }); return }
    const p = Number(String(price).replace(/[^\d.]/g, ''))
    if (!p || p <= 0) { wx.showToast({ title: '请输入有效价格', icon: 'none' }); return }
    const body = {
      type: types[typeIdx].k,
      nameZh: nameZh.trim(),
      nameEn: (nameEn.trim() || nameZh.trim()),
      category: category.trim() || '未分类',
      priceCents: Math.round(p * 100),
      baseDurationMin: Number(duration) || 120,
      isActive: active
    }
    this.setData({ saving: true })
    try {
      if (isNew) await api.adminPost('/admin/services', body)
      else await api.adminPatch(`/admin/services/${encodeURIComponent(id)}`, body)
      wx.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  }
})
