const api = require('../../utils/api')

Page({
  data: {
    oldPassword: '',
    newPassword: '',
    confirmPassword: '',
    loading: false
  },

  onOld(e) { this.setData({ oldPassword: e.detail.value }) },
  onNew(e) { this.setData({ newPassword: e.detail.value }) },
  onConfirm(e) { this.setData({ confirmPassword: e.detail.value }) },

  async submit() {
    if (this.data.loading) return
    const { oldPassword, newPassword, confirmPassword } = this.data
    if (!oldPassword) { wx.showToast({ title: '请输入当前密码', icon: 'none' }); return }
    if (newPassword.length < 6) { wx.showToast({ title: '新密码至少 6 位', icon: 'none' }); return }
    if (newPassword !== confirmPassword) { wx.showToast({ title: '两次新密码不一致', icon: 'none' }); return }
    this.setData({ loading: true })
    try {
      await api.adminChangePassword(oldPassword, newPassword, confirmPassword)
      wx.showToast({ title: '已设置新密码', icon: 'success' })
      setTimeout(() => wx.reLaunch({ url: '/pages/merchant/home/index' }), 600)
    } catch (error) {
      wx.showToast({ title: (error && error.message) || '改密失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  }
})
