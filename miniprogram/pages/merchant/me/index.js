const api = require('../../../utils/api')

Page({
  data: { shopName: '', displayName: '', role: '', account: '', financeOn: false, financeLockEnabled: false, isOwnerRole: false, subText: '', subWarn: false },

  onShow() { if (!api.guardMerchant()) return; this.load() },

  async load() {
    this.setData({ financeOn: !!(api.getFinanceKey && api.getFinanceKey()) })
    api.adminGet('/admin/finance/lock-settings')
      .then((st) => this.setData({ financeLockEnabled: !!st.enabled }))
      .catch(() => {})
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

  /* 屏 V4 对齐(2026-08-08 口径:财务密码**默认关闭、商家自助**)。
     这里是小程序侧的开关:未启用 → 设一个新密码开启;已启用 → 改密或关闭,两者都要验当前密码。
     忘记密码走平台重置(与网页 V4 卡文案一致)。 */
  async finance() {
    if (!this.data.isOwnerRole) { wx.navigateTo({ url: '/pages/merchant/finance/index' }); return }
    let st = { enabled: false, configured: false }
    try { st = await api.adminGet('/admin/finance/lock-settings') } catch (e) { /* 读不到按未启用处理 */ }
    const items = st.enabled ? ['修改财务密码', '关闭财务密码', '进入财务页'] : ['启用财务密码', '进入财务页']
    wx.showActionSheet({
      itemList: items,
      success: (r) => {
        const label = items[r.tapIndex]
        if (label === '进入财务页') { wx.navigateTo({ url: '/pages/merchant/finance/index' }); return }
        if (label === '启用财务密码') return this.setFinanceLock(true, false)
        if (label === '修改财务密码') return this.setFinanceLock(true, true)
        if (label === '关闭财务密码') return this.setFinanceLock(false, true)
      }
    })
  },
  setFinanceLock(enabled, needCurrent) {
    const ask = (title, placeholder) => new Promise((resolve) => {
      wx.showModal({
        title, editable: true, placeholderText: placeholder, content: '',
        success: (r) => resolve(r.confirm ? (r.content || '').trim() : null)
      })
    })
    ;(async () => {
      let currentPassword
      if (needCurrent) {
        currentPassword = await ask('验证当前财务密码', '关闭或修改都要先验当前密码')
        if (currentPassword === null) return
        if (!currentPassword) { wx.showToast({ title: '请输入当前密码', icon: 'none' }); return }
      }
      let newPassword
      if (enabled) {
        newPassword = await ask(needCurrent ? '设置新的财务密码' : '设置财务密码', '至少 4 位')
        if (newPassword === null) return
        if (!newPassword || newPassword.length < 4) { wx.showToast({ title: '财务密码至少 4 位', icon: 'none' }); return }
        const again = await ask('再输一次确认', '两次要一致')
        if (again === null) return
        if (again !== newPassword) { wx.showToast({ title: '两次密码不一致', icon: 'none' }); return }
      }
      try {
        await api.adminPut('/admin/finance/lock-settings', { enabled, currentPassword, newPassword })
        if (api.clearFinanceKey) api.clearFinanceKey()
        this.setData({ financeOn: false, financeLockEnabled: enabled })
        wx.showToast({ title: enabled ? (needCurrent ? '密码已修改' : '已启用财务密码') : '已关闭财务密码', icon: 'none' })
      } catch (e) {
        wx.showToast({ title: (e && e.message) || '操作失败', icon: 'none' })
      }
    })()
  },

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
