const api = require('../../../utils/api')

Page({
  data: { list: [] },

  async onShow() { if (!(await api.guardOwner())) return; this.load() },

  async load() {
    try {
      const [t, a] = await Promise.all([
        api.adminGet('/admin/technicians'),
        api.adminGet('/admin/staff-accounts').catch(() => ({ accounts: [] }))
      ])
      const byTech = {}
      ;(a.accounts || []).forEach((x) => { byTech[x.technicianId] = x })
      const list = (t.technicians || []).map((tech) => {
        const ac = byTech[tech.id]
        return {
          id: tech.id,
          name: tech.name,
          title: tech.title || '',
          av: (tech.name || '?').slice(0, 1),
          active: tech.is_active !== 0 && tech.isActive !== false,
          acct: ac ? { id: ac.id, username: ac.username, disabled: ac.status !== 'active' } : null
        }
      })
      this.setData({ list })
    } catch (e) { wx.showToast({ title: '加载失败', icon: 'none' }) }
  },

  addTech() {
    wx.showModal({
      title: '新增员工', editable: true, placeholderText: '输入技师姓名',
      success: async (r) => {
        if (!r.confirm || !r.content || !r.content.trim()) return
        try { await api.adminPost('/admin/technicians', { name: r.content.trim() }); wx.showToast({ title: '已添加', icon: 'none' }); this.load() }
        catch (err) { wx.showToast({ title: (err && err.message) || '添加失败', icon: 'none' }) }
      }
    })
  },

  async genAccount(e) {
    const id = e.currentTarget.dataset.id
    try {
      const r = await api.adminPost('/admin/staff-accounts', { technicianId: id })
      wx.showModal({ title: '账号已生成', content: `用户名:${r.username}\n初始密码:${r.initialPassword}\n(只显示这一次,请发给员工)`, showCancel: false })
      this.load()
    } catch (err) { wx.showToast({ title: (err && err.message) || '生成失败', icon: 'none' }) }
  },

  async resetPwd(e) {
    const id = e.currentTarget.dataset.acctid
    try {
      const r = await api.adminPost(`/admin/staff-accounts/${encodeURIComponent(id)}/reset-password`, {})
      wx.showModal({ title: '密码已重置', content: `新初始密码:${r.initialPassword}\n员工下次登录需改密`, showCancel: false })
    } catch (err) { wx.showToast({ title: (err && err.message) || '重置失败', icon: 'none' }) }
  },

  async toggleAcct(e) {
    const id = e.currentTarget.dataset.acctid
    try { await api.adminPost(`/admin/staff-accounts/${encodeURIComponent(id)}/toggle`, {}); wx.showToast({ title: '已切换', icon: 'none' }); this.load() }
    catch (err) { wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' }) }
  }
})
