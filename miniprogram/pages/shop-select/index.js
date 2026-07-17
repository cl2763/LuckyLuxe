const api = require('../../utils/api')

Page({
  data: { shops: [], loading: true },

  onShow() { this.load() },

  async load() {
    try {
      const r = await api.getShops()
      this.setData({ shops: r.shops || [], loading: false })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: '加载门店失败', icon: 'none' })
    }
  },

  applyTenant(tid, name) {
    if (!tid) return
    wx.setStorageSync('lucky_tenant', tid)
    const app = getApp()
    if (app && app.globalData) app.globalData.tenantId = tid
    wx.showToast({ title: '已进入 ' + (name || tid), icon: 'none' })
    setTimeout(() => wx.reLaunch({ url: '/pages/home/index' }), 400)
  },

  pick(e) {
    this.applyTenant(e.currentTarget.dataset.id, e.currentTarget.dataset.name)
  },

  // 扫店内小程序码进店:识别 t= / tenantId= / merchant=
  scan() {
    wx.scanCode({
      onlyFromCamera: false,
      success: (res) => {
        const raw = decodeURIComponent(res.result || res.path || '')
        const m = /(?:^|[?&#])(?:t|tenantId|merchant)=([A-Za-z0-9_-]+)/.exec(raw)
        if (m) {
          const hit = (this.data.shops || []).find((s) => s.tenantId === m[1])
          this.applyTenant(m[1], hit && hit.name)
        } else {
          wx.showToast({ title: '未识别到门店码', icon: 'none' })
        }
      }
    })
  }
})
