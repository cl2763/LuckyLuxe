const api = require('../../utils/api')
const i18n = require('../../utils/i18n')

Page({
  data: {
    lang: 'zh',
    email: '',
    password: '',
    loading: false
  },

  onShow() {
    const lang = i18n.getLang()
    this.setData({ lang })
    wx.setNavigationBarTitle({ title: lang === 'en' ? 'Admin Login' : '后台登录' })
  },

  inputEmail(event) {
    this.setData({ email: event.detail.value })
  },

  inputPassword(event) {
    this.setData({ password: event.detail.value })
  },

  async login() {
    if (!this.data.email || !this.data.password || this.data.loading) return
    this.setData({ loading: true })
    try {
      await api.adminLogin(this.data.email.trim(), this.data.password)
      wx.redirectTo({ url: '/pages/admin/index' })
    } catch (error) {
      wx.showToast({ title: error.message || '后台登录失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  }
})
