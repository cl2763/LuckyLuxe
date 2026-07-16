const api = require('../../../utils/api')

Page({
  data: { seg: 0, showcase: [], items: [], pendingUpload: 0, pendingPublish: 0, loading: true },

  onShow() { this.load() },

  onSeg(e) { this.setData({ seg: Number(e.currentTarget.dataset.i) }) },

  async load() {
    try {
      // 展示图库(对外):所有技师的已发布作品;作品管理:按角色(员工只见自己)
      const [pub, r] = await Promise.all([
        api.adminGet('/admin/published-works').catch(() => ({ works: [] })),
        api.adminGet('/admin/bookings').catch(() => ({ bookings: [] }))
      ])
      const showcase = (pub.works || []).map((w) => ({
        id: w.bookingId, cover: w.cover, count: w.count,
        service: w.service || '作品', tech: w.technicianName || ''
      }))
      const done = (r.bookings || []).filter((b) => b.status === 'COMPLETED')
      let pu = 0, pp = 0
      const items = []
      done.forEach((b) => {
        const approved = b.galleryStatus === 'approved'
        const work = b.workImages || []
        const imgs = approved ? (b.approvedWorkImages || []) : work
        let state = 'toupload'
        if (approved) state = 'published'
        else if (work.length) { state = 'topublish'; pp += 1 }
        else pu += 1
        items.push({
          id: b.id,
          customer: (b.user && b.user.display_name) || '顾客',
          service: (b.service && b.service.name) || '服务',
          date: b.appointmentDate || '',
          images: imgs, count: imgs.length, state
        })
      })
      const order = { topublish: 0, toupload: 1, published: 2 }
      items.sort((a, b) => order[a.state] - order[b.state])
      this.setData({ items, showcase, pendingUpload: pu, pendingPublish: pp, loading: false })
    } catch (e) { this.setData({ loading: false }); wx.showToast({ title: '加载失败', icon: 'none' }) }
  },

  openWork(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/merchant/work-detail/index?id=' + encodeURIComponent(id) })
  },

  preview(e) {
    const { urls, cur } = e.currentTarget.dataset
    if (urls && urls.length) wx.previewImage({ current: cur, urls })
  },

  upload(e) {
    const id = e.currentTarget.dataset.id
    wx.chooseMedia({
      count: 6, mediaType: ['image'], sizeType: ['compressed'],
      success: (res) => {
        const paths = (res.tempFiles || []).map((f) => f.tempFilePath).filter(Boolean)
        if (!paths.length) return
        wx.showLoading({ title: '处理中…' })
        const fs = wx.getFileSystemManager()
        const toDataUrl = (p) => new Promise((resolve) => {
          fs.readFile({ filePath: p, encoding: 'base64', success: (r) => resolve('data:image/jpeg;base64,' + r.data), fail: () => resolve('') })
        })
        Promise.all(paths.map(toDataUrl)).then(async (urls) => {
          const imgs = urls.filter(Boolean)
          const item = this.data.items.find((x) => x.id === id)
          const merged = (item && item.state !== 'published' ? item.images : []).concat(imgs).slice(0, 6)
          try {
            await api.adminPatch(`/admin/bookings/${encodeURIComponent(id)}/work-images`, { workImages: merged })
            wx.hideLoading(); wx.showToast({ title: '已添加作品图', icon: 'none' })
            this.load()
          } catch (err) { wx.hideLoading(); wx.showToast({ title: (err && err.message) || '上传失败', icon: 'none' }) }
        })
      }
    })
  },

  publish(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.items.find((x) => x.id === id)
    if (!item || !item.images.length) { wx.showToast({ title: '先上传作品图', icon: 'none' }); return }
    wx.showModal({
      title: '审核发布', content: `将这 ${item.images.length} 张作品图发布到对外图库?发布后锁定不可再改。`,
      success: async (r) => {
        if (!r.confirm) return
        try {
          await api.adminPatch(`/admin/bookings/${encodeURIComponent(id)}/gallery-approval`, { images: item.images })
          wx.showToast({ title: '已发布', icon: 'success' })
          this.load()
        } catch (err) { wx.showToast({ title: (err && err.message) || '发布失败', icon: 'none' }) }
      }
    })
  }
})
