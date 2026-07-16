const api = require('../../../utils/api')

Page({
  data: { groups: [], loading: true },

  async onShow() { if (!(await api.guardOwner())) return; this.load() },

  async load() {
    try {
      const r = await api.adminGet('/admin/services')
      const list = (r.services || [])
      const label = { nail: '美甲', lash: '美睫' }
      const mk = (t) => list.filter((s) => s.type === t).map((s) => ({
        id: s.id,
        name: s.nameZh || s.name || '未命名',
        price: (s.priceCents || 0) / 100,
        dur: s.durationMin || 0,
        active: s.isActive !== false,
        meta: `${label[s.type] || s.type} · $${(s.priceCents || 0) / 100}${s.durationMin ? ' · ' + s.durationMin + 'min' : ''}${s.isActive === false ? ' · 已下架' : ''}`
      }))
      const groups = [
        { key: 'nail', title: '美甲', items: mk('nail') },
        { key: 'lash', title: '美睫', items: mk('lash') }
      ].filter((g) => g.items.length)
      this.setData({ groups, loading: false })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  edit(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/merchant/service-edit/index?id=' + encodeURIComponent(id) })
  },

  add() {
    wx.navigateTo({ url: '/pages/merchant/service-edit/index' })
  },

  async toggle(e) {
    const { id, active } = e.currentTarget.dataset
    const next = !active
    try {
      await api.adminPatch(`/admin/services/${encodeURIComponent(id)}`, { isActive: next })
      wx.showToast({ title: next ? '已上架' : '已下架', icon: 'none' })
      this.load()
    } catch (err) { wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' }) }
  }
})
