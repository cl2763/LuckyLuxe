const api = require('../../../utils/api')

const PLATFORMS = [{ k: 'xiaohongshu', label: '小红书' }, { k: 'douyin', label: '抖音' }]

Page({
  data: {
    id: '', images: [], curImg: '', title: '', service: '',
    platforms: PLATFORMS, pIdx: 0,
    result: null, avoid: [], loading: false
  },

  onLoad(opt) { this.id = decodeURIComponent((opt && opt.id) || ''); this.load() },

  async load() {
    try {
      // 优先从"全部已发布作品"取(任意角色都能看别人的展示作品)
      const pub = await api.adminGet('/admin/published-works').catch(() => ({ works: [] }))
      const w = (pub.works || []).find((x) => x.bookingId === this.id)
      if (w) {
        this.setData({
          id: w.bookingId, images: w.images || [], curImg: (w.images || [])[0] || '',
          service: w.service || '作品',
          title: `${w.service || '作品'}${w.technicianName ? ' · ' + w.technicianName : ''}`
        })
        return
      }
      // 回退:未发布的(自己的)作品从 bookings 取
      const r = await api.adminGet('/admin/bookings')
      const b = (r.bookings || []).find((x) => x.id === this.id)
      if (!b) { wx.showToast({ title: '未找到作品', icon: 'none' }); return }
      const imgs = (b.approvedWorkImages && b.approvedWorkImages.length) ? b.approvedWorkImages : (b.workImages || [])
      this.setData({
        id: b.id, images: imgs, curImg: imgs[0] || '',
        service: (b.service && b.service.name) || '服务',
        title: `${(b.user && b.user.display_name) || '顾客'} · ${(b.service && b.service.name) || '服务'}`
      })
    } catch (e) { wx.showToast({ title: '加载失败', icon: 'none' }) }
  },

  pickImg(e) { this.setData({ curImg: e.currentTarget.dataset.img }) },
  previewCur() { if (this.data.curImg) wx.previewImage({ current: this.data.curImg, urls: this.data.images }) },
  onPlatform(e) { this.setData({ pIdx: Number(e.currentTarget.dataset.i), result: null, avoid: [] }) },

  async generate() {
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const resp = await api.adminPost('/admin/ai/social-copy', {
        lang: 'zh', bookingId: this.data.id, image: this.data.curImg,
        platform: this.data.platforms[this.data.pIdx].k, audience: 'customer',
        avoidCaptions: this.data.avoid.slice(-12), variantSeed: String(Date.now())
      })
      const c = (resp.copy && resp.copy.data) || resp.copy || {}
      const result = {
        title: c.titleZh || '', caption: c.captionZh || '',
        hashtags: (c.hashtags || []).join(' '), styleTags: (c.styleTags || []).join(' · ')
      }
      this.setData({ result, avoid: this.data.avoid.concat(result.title).filter(Boolean) })
    } catch (err) {
      const msg = (err && (err.code === 'FORBIDDEN' || /permission|forbidden|access/i.test(err.message || ''))) ? '仅本人作品可生成文案' : ((err && err.message) || '生成失败')
      wx.showToast({ title: msg, icon: 'none' })
    } finally { this.setData({ loading: false }) }
  },

  copyAll() {
    const r = this.data.result
    if (!r) return
    wx.setClipboardData({ data: `${r.title}\n\n${r.caption}\n\n${r.hashtags}`, success: () => wx.showToast({ title: '文案已复制,发给顾客即可', icon: 'none' }) })
  },

  saveImage() {
    const img = this.data.curImg
    if (!img) return
    const doSave = (filePath) => wx.saveImageToPhotosAlbum({
      filePath,
      success: () => wx.showToast({ title: '图片已存相册', icon: 'none' }),
      fail: (e) => {
        if (String(e.errMsg || '').includes('auth')) {
          wx.showModal({ title: '需要相册权限', content: '请在设置里允许保存到相册后重试。', confirmText: '去设置', success: (r) => { if (r.confirm) wx.openSetting() } })
        } else wx.showToast({ title: '保存失败', icon: 'none' })
      }
    })
    if (img.startsWith('data:image')) {
      const b64 = img.replace(/^data:image\/\w+;base64,/, '')
      const fp = `${wx.env.USER_DATA_PATH}/work_${Date.now()}.jpg`
      wx.getFileSystemManager().writeFile({ filePath: fp, data: b64, encoding: 'base64', success: () => doSave(fp), fail: () => wx.showToast({ title: '保存失败', icon: 'none' }) })
    } else {
      wx.getImageInfo({ src: img, success: (res) => doSave(res.path), fail: () => wx.showToast({ title: '保存失败', icon: 'none' }) })
    }
  }
})
