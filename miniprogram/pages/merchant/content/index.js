const api = require('../../../utils/api')

const PLATFORMS = [
  { k: 'xiaohongshu', label: '小红书' },
  { k: 'douyin', label: '抖音' }
]

Page({
  data: {
    platforms: PLATFORMS,
    pIdx: 0,
    works: [],       // 可选的完工作品
    picked: null,    // {bookingId, label, image}
    result: null,    // {title, caption, hashtags, styleTags}
    avoid: [],
    loading: false
  },

  onLoad() { this.loadWorks() },

  async loadWorks() {
    try {
      const r = await api.adminGet('/admin/bookings')
      const bks = (r.bookings || []).filter((b) => b.status === 'COMPLETED')
      // 优先有已审核作品图的
      bks.sort((a, b) => (b.approvedWorkImages || []).length - (a.approvedWorkImages || []).length)
      const works = bks.slice(0, 8).map((b) => ({
        bookingId: b.id,
        label: `${(b.user && b.user.display_name) || '顾客'} · ${(b.service && b.service.name) || '服务'} · ${b.appointmentDate || ''}`,
        image: (b.approvedWorkImages || [])[0] || (b.workImages || [])[0] || ''
      }))
      this.setData({ works })
    } catch (e) { /* ignore */ }
  },

  onPlatform(e) { this.setData({ pIdx: Number(e.currentTarget.dataset.i), result: null, avoid: [] }) },

  pickWork() {
    const works = this.data.works
    if (!works.length) { wx.showToast({ title: '暂无完工作品', icon: 'none' }); return }
    wx.showActionSheet({
      itemList: works.map((w) => w.label.slice(0, 30)),
      success: (r) => this.setData({ picked: works[r.tapIndex], result: null, avoid: [] })
    })
  },

  async generate() {
    if (this.data.loading) return
    if (!this.data.picked) { wx.showToast({ title: '先选一组作品', icon: 'none' }); return }
    this.setData({ loading: true })
    try {
      const resp = await api.adminPost('/admin/ai/social-copy', {
        lang: 'zh',
        bookingId: this.data.picked.bookingId,
        image: this.data.picked.image,
        platform: this.data.platforms[this.data.pIdx].k,
        audience: 'staff',
        avoidCaptions: this.data.avoid.slice(-12),
        variantSeed: String(Date.now())
      })
      const c = (resp.copy && resp.copy.data) || resp.copy || {}
      const result = {
        title: c.titleZh || '',
        caption: c.captionZh || '',
        hashtags: (c.hashtags || []).join(' '),
        styleTags: (c.styleTags || []).join(' · ')
      }
      this.setData({ result, avoid: this.data.avoid.concat(result.title).filter(Boolean) })
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '生成失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  copyAll() {
    const r = this.data.result
    if (!r) return
    const text = `${r.title}\n\n${r.caption}\n\n${r.hashtags}`
    wx.setClipboardData({ data: text, success: () => wx.showToast({ title: '文案已复制,去粘贴发布', icon: 'none' }) })
  },

  copyTags() {
    const r = this.data.result
    if (!r || !r.hashtags) return
    wx.setClipboardData({ data: r.hashtags, success: () => wx.showToast({ title: '标签已复制', icon: 'none' }) })
  }
})
