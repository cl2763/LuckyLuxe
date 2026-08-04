const api = require('../../../utils/api')

Page({
  data: { shopName: '', displayName: '', role: '', account: '', financeOn: false, isOwnerRole: false, subText: '', subWarn: false },

  onShow() { if (!api.guardMerchant()) return; this.load() },

  async load() {
    this.setData({ financeOn: !!(api.getFinanceKey && api.getFinanceKey()) })
    try {
      const m = await api.adminMe()
      const isOwner = m.role === 'owner' || m.role === 'boss'
      this.setData({
        // 顶部大字=店铺名(商家注册时提供的名字),不写"某某老板"这类通用词
        shopName: m.tenantName || m.displayName || '我的店铺',
        displayName: m.displayName || '',
        role: isOwner ? '老板 · 主账号' : '员工账号',
        account: m.username || m.email || '',
        isOwnerRole: isOwner
      })
      // 套餐状态角标:临期/宽限醒目提示,长期有效不打扰
      if (isOwner) {
        try {
          const s = await api.adminGet('/admin/subscription')
          if (s.status === 'expiring') this.setData({ subText: `${s.daysLeft} 天后到期`, subWarn: true })
          else if (s.status === 'grace' || s.status === 'suspended') this.setData({ subText: '已到期,去续费', subWarn: true })
          else if (s.status === 'active') this.setData({ subText: `有效期至 ${String(s.expiresAt).slice(0, 10)}`, subWarn: false })
        } catch (e) { /* 忽略 */ }
      }
    } catch (e) { /* keep defaults */ }
  },

  subscription() { wx.navigateTo({ url: '/pages/merchant/subscription/index' }) },

  // 显示名自助修改:管理页顶部那行黑字,老板/员工都可自己起名
  editName() {
    const that = this
    wx.showModal({
      title: '显示名称',
      editable: true,
      placeholderText: '例如:悦容老板 / 小美',
      content: this.data.displayName || '',
      success: async (res) => {
        if (!res.confirm) return
        const v = String(res.content || '').trim()
        if (!v) { wx.showToast({ title: '不能为空', icon: 'none' }); return }
        try {
          await api.adminRequest('/admin/auth/display-name', 'PATCH', { displayName: v })
          wx.showToast({ title: '已更新', icon: 'success' })
          that.load()
        } catch (err) {
          wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
        }
      }
    })
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
