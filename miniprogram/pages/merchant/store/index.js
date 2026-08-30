const api = require('../../../utils/api')

Page({
  data: {
    storeId: '', name: '', address: '', phone: '',
    hours: [], // [{weekday,label,isClosed,openTime,closeTime}]
    specials: [],
    onlineDeposit: true,
    depositRows: [],
    depositEditHint: '',
    loading: true
  },

  async onShow() { if (!(await api.guardOwner())) return; this.setData({ hoursTxt: api.hoursGateText() }); this.load(); this.loadRules() },

  async loadRules() {
    try {
      const r = await api.adminGet('/admin/booking-rules')
      this.setData({ onlineDeposit: r.rules ? r.rules.onlineDeposit !== false : true })
      /* 批④ S7(店主 08-24):摘要做全 —— 7 项关键值逐行显示,全部读后端 summaryRows
         (与顾客端 keyFacts/政策全文同一份 config 推导,商家看到的与顾客体验到的同源,不各查各的)。
         前端零拼串:label/value 与「去哪改」的引导句都由后端给。 */
      api.adminGet('/admin/deposit-config').then((d) => {
        this.setData({
          depositRows: (d && d.summaryRows && d.summaryRows.zh) || [],
          depositEditHint: (d && d.editHint && d.editHint.zh) || ''
        })
      }).catch(() => {})
    } catch (e) { /* 默认开 */ }
  },

  async load() {
    try {
      const r = await api.adminGet('/admin/business-hours')
      const s = (r.stores || [])[0]
      if (!s) { this.setData({ loading: false }); return }
      /* 裁定2 收敛(08-30c):表单=components/hours-form;缺行/时间不再前端编数
         (原来缺行预填 周一休+10:00-19:00 —— 与后端 A3 同族的前端回落,随收敛处死) */
      const hours = s.hours || []
      const specials = (s.specialDates || []).map((d) => ({
        date: d.date,
        text: d.isClosed ? '休息' : `${d.openTime}-${d.closeTime}`,
        note: d.note || ''
      }))
      this.setData({ storeId: s.id, name: s.name || '', address: s.address || '', phone: s.phone || '', hours, specials, loading: false })
    } catch (e) { this.setData({ loading: false }); wx.showToast({ title: '加载失败', icon: 'none' }) }
  },

  editField(e) {
    const key = e.currentTarget.dataset.key
    const labelMap = { name: '门店名称', address: '门店地址', phone: '联系电话' }
    wx.showModal({
      title: '修改' + labelMap[key], editable: true, content: this.data[key] || '',
      placeholderText: '输入' + labelMap[key],
      success: async (r) => {
        if (!r.confirm) return
        const v = (r.content || '').trim()
        try {
          await api.adminRequest('/admin/store-info', 'PUT', { storeId: this.data.storeId, [key]: v })
          this.setData({ [key]: v }); wx.showToast({ title: '已保存', icon: 'none' })
        } catch (err) { wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' }) }
      },
      fail: (e) => console.warn('[showModal fail]', e) // S组卫生批:fail=开发者域错误,console 留痕不弹 UI(toast 会撞转场,D27 家族)
    })
  },

  /* 裁定2:营业时间保存走组件 save 事件(七天整份;A2 后端终闸兜底) */
  async onHoursSave(e) {
    if (this.data.hoursSaving) return
    this.setData({ hoursSaving: true })
    try {
      await api.adminRequest('/admin/business-hours', 'PUT', { storeId: this.data.storeId, hours: e.detail.hours })
      wx.showToast({ title: '营业时间已保存', icon: 'none' })
      this.setData({ hoursSaving: false }); this.load()
    } catch (err) {
      this.setData({ hoursSaving: false })
      wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
    }
  },

  addSpecial() {
    wx.showModal({
      title: '新增特殊日期(休息)', editable: true, placeholderText: '格式 2026-12-25',
      success: async (r) => {
        if (!r.confirm) return
        const date = (r.content || '').trim()
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { wx.showToast({ title: '日期格式不对', icon: 'none' }); return }
        try {
          await api.adminPost('/admin/special-dates', { storeId: this.data.storeId, date, isClosed: true })
          wx.showToast({ title: '已添加', icon: 'none' }); this.load()
        } catch (err) { wx.showToast({ title: (err && err.message) || '添加失败', icon: 'none' }) }
      },
      fail: (e) => console.warn('[showModal fail]', e) // S组卫生批:fail=开发者域错误,console 留痕不弹 UI(toast 会撞转场,D27 家族)
    })
  },

  delSpecial(e) {
    const date = e.currentTarget.dataset.date
    wx.showModal({
      title: '删除', content: `删除 ${date} 的特殊安排,恢复每周固定?`,
      success: async (r) => {
        if (!r.confirm) return
        try {
          await api.adminRequest(`/admin/special-dates/${date}?storeId=${encodeURIComponent(this.data.storeId)}`, 'DELETE')
          wx.showToast({ title: '已删除', icon: 'none' }); this.load()
        } catch (err) { wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' }) }
      },
      fail: (e) => console.warn('[showModal fail]', e) // S组卫生批:fail=开发者域错误,console 留痕不弹 UI(toast 会撞转场,D27 家族)
    })
  }
})
