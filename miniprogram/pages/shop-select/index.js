const api = require('../../utils/api')
const { clearStoreCurrency } = require('../../utils/storecurrency')

const DEMO_KEY = 'lucky_demo_mode'

Page({
  data: { shops: [], loading: true, demoMode: false },

  onShow() {
    this.setData({ demoMode: Boolean(wx.getStorageSync(DEMO_KEY)) })
    this.load()
  },

  async load() {
    try {
      const r = await api.getShops(this.data.demoMode)
      this.setData({ shops: r.shops || [], loading: false })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: '加载门店失败', icon: 'none' })
    }
  },

  // 隐藏入口:连点标题 5 次开/关「演示模式」。开启后列表里才出现演示门店(顾客看不到)。
  tapTitle() {
    const now = Date.now()
    if (!this._taps || now - this._lastTap > 1200) this._taps = 0
    this._taps += 1
    this._lastTap = now
    if (this._taps < 5) return
    this._taps = 0
    const next = !this.data.demoMode
    wx.setStorageSync(DEMO_KEY, next ? 1 : '')
    this.setData({ demoMode: next })
    wx.showToast({ title: next ? '演示模式已开启' : '演示模式已关闭', icon: 'none' })
    this.load()
  },

  applyTenant(tid, name) {
    if (!tid) return
    wx.setStorageSync('lucky_tenant', tid)
    // D39:换店清场统一走 api.onStoreSwitched(member/币种/定金/AI/购物车/本地订单/款式预设);
    // auth 带租户戳,下次取数自动静默重登为本店身份 —— 数据随店走
    api.onStoreSwitched()
    clearStoreCurrency()
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
    ,
      fail: () => wx.showToast({ title: '扫码调用失败,请重试', icon: 'none' })
    })
  }
})
