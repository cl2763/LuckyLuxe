const api = require('../../utils/api')

Page({
  data: {
    username: '',
    password: '',
    remember: true,
    loading: false,
    hidePwd: true
  },

  onUser(e) { this.setData({ username: e.detail.value }) },
  onPass(e) { this.setData({ password: e.detail.value }) },
  toggleRemember() { this.setData({ remember: !this.data.remember }) },
  togglePwd() { this.setData({ hidePwd: !this.data.hidePwd }) },
  toForgot() { wx.navigateTo({ url: '/pages/merchant-forgot/index' }) },

  async login() {
    if (this.data.loading) return
    const username = this.data.username.trim()
    const password = this.data.password
    if (!username || !password) {
      wx.showToast({ title: '请输入账号和密码', icon: 'none' })
      return
    }
    this.setData({ loading: true })
    try {
      const auth = await api.adminLogin(username, password, this.data.remember)
      const admin = (auth && auth.admin) || {}
      if (admin.mustChangePassword) {
        wx.redirectTo({ url: '/pages/merchant-change-password/index' })
      } else {
        wx.reLaunch({ url: '/pages/merchant/home/index' })
      }
    } catch (error) {
      wx.showToast({ title: (error && error.message) || '登录失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  }
})
