const api = require('../../../utils/api')
Page({
  // 门禁:未登录/会话失效不渲染空壳,直接回登录页(店主 2026-08-09 红线)
  onShow() { api.guardMerchant() },
  data: {
    userId: '', customerName: '', bookingId: '', serviceName: '', techName: '',
    text: '', saving: false, result: null,
    images: []   // 小记图片(08-30f):≤9 张,base64 data:(图库同款通道);保存后随小记只追加
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
  /* 添加图片:拍照/相册(与图库上传同一通道:本地读 base64 → data: 直传) */
  addImages() {
    const left = 9 - this.data.images.length
    if (left <= 0) { wx.showToast({ title: '最多 9 张', icon: 'none' }); return }
    wx.chooseMedia({
      count: left, mediaType: ['image'], sourceType: ['album', 'camera'],
      success: async (res) => {
        const fs = wx.getFileSystemManager()
        const datas = await Promise.all(res.tempFiles.map((f) => new Promise((resolve) => {
          fs.readFile({ filePath: f.tempFilePath, encoding: 'base64', success: (r) => resolve('data:image/jpeg;base64,' + r.data), fail: () => resolve('') })
        })))
        this.setData({ images: this.data.images.concat(datas.filter(Boolean)).slice(0, 9) })
      },
      fail: (e) => { if (!/cancel/.test(String(e && e.errMsg))) wx.showToast({ title: '选图失败', icon: 'none' }) }
    })
  },
  removeImage(e) {
    const i = Number(e.currentTarget.dataset.i)
    const images = this.data.images.slice(); images.splice(i, 1)
    this.setData({ images })   // 草稿阶段可移;已保存的小记只追加不可删改(审计口径)
  },
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
        serviceName: this.data.serviceName, rawText: text,
        images: this.data.images
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
  again() { this.setData({ text: '', result: null, images: [] }) }
})
