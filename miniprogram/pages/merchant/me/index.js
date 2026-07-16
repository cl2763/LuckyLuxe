const api = require('../../../utils/api')

Page({
  data: { name: '', role: '', account: '', financeOn: false },

  onShow() { this.load() },

  async load() {
    this.setData({ financeOn: !!(api.getFinanceKey && api.getFinanceKey()) })
    try {
      const m = await api.adminMe()
      const isOwner = m.role === 'owner' || m.role === 'boss'
      this.setData({
        name: m.displayName || m.name || (isOwner ? '店主' : '员工'),
        role: isOwner ? '老板 · 主账号' : '员工账号',
        account: m.username || m.email || ''
      })
    } catch (e) { /* keep defaults */ }
  },

  changePwd() { wx.navigateTo({ url: '/pages/merchant-change-password/index?mode=change' }) },

  finance() { wx.navigateTo({ url: '/pages/merchant/finance/index' }) },

  lang() { wx.showToast({ title: '多语言切换即将上线', icon: 'none' }) },

  logout() {
    wx.showModal({
      title: '退出登录', content: '确认退出商家管理?',
      success: (r) => {
        if (!r.confirm) return
        if (api.clearAdminAuth) api.clearAdminAuth()
        if (api.clearFinanceKey) api.clearFinanceKey()
        wx.reLaunch({ url: '/pages/entry/index' })
      }
    })
  }
})
