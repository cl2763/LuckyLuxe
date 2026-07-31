const api = require('../../../utils/api')
Page({
  data: {
    userId: '', customerName: '', bookingId: '', serviceName: '', techName: '',
    text: '', saving: false, result: null
  },
  onLoad(q) {
    this.setData({
      userId: q.userId || '',
      customerName: q.name ? decodeURIComponent(q.name) : '顾客',
      bookingId: q.bookingId || '',
      serviceName: q.service ? decodeURIComponent(q.service) : '',
      techName: q.tech ? decodeURIComponent(q.tech) : ''
    })
  },
  onInput(e) { this.setData({ text: e.detail.value }) },
  // 语音输入:聚焦文本框,用系统键盘的语音键(最稳、零依赖);后续可接同声传译插件
  voiceHint() {
    wx.showToast({ title: '点输入框,用键盘上的🎙语音输入', icon: 'none', duration: 2200 })
  },
  async save() {
    const text = (this.data.text || '').trim()
    if (!text) { wx.showToast({ title: '先说/写一句吧', icon: 'none' }); return }
    if (!this.data.userId) { wx.showToast({ title: '缺少顾客', icon: 'none' }); return }
    this.setData({ saving: true })
    try {
      const r = await api.saveServiceNote({
        userId: this.data.userId, bookingId: this.data.bookingId,
        serviceName: this.data.serviceName, rawText: text
      })
      const s = (r.note && r.note.structured) || {}
      this.setData({ saving: false, result: {
        styles: s.styles || [], personality: s.personality || [], preferences: s.preferences || [],
        companions: s.companions || [], safetyFlags: s.safetyFlags || [], other: s.other || [],
        summary: s.summary || ''
      } })
      wx.showToast({ title: '已保存到顾客画像', icon: 'success' })
    } catch (err) {
      this.setData({ saving: false })
      wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
    }
  },
  goProfile() {
    wx.navigateTo({ url: `/pages/merchant/customer-profile/index?userId=${this.data.userId}&name=${encodeURIComponent(this.data.customerName)}` })
  },
  again() { this.setData({ text: '', result: null }) }
})
