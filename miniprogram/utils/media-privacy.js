// Shared by every published media entry. Consent is separate from OS album permission.
module.exports = Behavior({
  data: { mediaPrivacyVisible: false },
  lifetimes: {
    detached() { this.cancelMediaPrivacy() }
  },
  methods: {
    mediaPrivacyFailure(error) {
      const message = String(error && error.errMsg || '')
      if (/cancel/i.test(message)) return
      console.warn('[media failed]', { errno: error && error.errno, errMsg: message })
      const declarationMissing = Number(error && error.errno) === 112 || /scope is not declared/i.test(message)
      wx.showModal({
        title: declarationMissing ? '照片功能暂不可用' : '无法打开照片功能',
        content: declarationMissing
          ? '微信未放行此版本的照片接口（112）。这是小程序隐私配置问题，不是你的手机相册权限问题。请联系平台处理。'
          : /auth deny|authorize|permission/i.test(message)
            ? '照片权限未获允许，请检查微信及手机的照片权限后重试。'
            : '微信未能打开照片功能，请稍后重试。若仍失败，请将此提示反馈给平台。',
        showCancel: false,
        fail: () => wx.showToast({ title: '照片功能暂不可用，请稍后重试', icon: 'none' })
      })
    },
    withMediaPrivacy(action) {
      if (this._mediaPrivacyChecking || this.data.mediaPrivacyVisible) return
      this._mediaPrivacyChecking = true
      const proceed = () => { this._mediaPrivacyChecking = false; action() }
      if (!wx.getPrivacySetting) { proceed(); return }
      wx.getPrivacySetting({
        success: (res) => {
          this._mediaPrivacyChecking = false
          if (res.needAuthorization) {
            this._mediaPrivacyAction = action
            this.setData({ mediaPrivacyVisible: true })
          } else action()
        },
        fail: () => {
          this._mediaPrivacyChecking = false
          wx.showToast({ title: '隐私授权状态读取失败，请重试', icon: 'none' })
        }
      })
    },
    showMediaPrivacy() { this.setData({ mediaPrivacyVisible: true }) },
    agreeMediaPrivacy() {
      const action = this._mediaPrivacyAction
      this._mediaPrivacyAction = null
      this.setData({ mediaPrivacyVisible: false })
      getApp().resolvePrivacyAuthorization('media-privacy-agree')
      if (action) action()
    },
    cancelMediaPrivacy() {
      this._mediaPrivacyAction = null
      this._mediaPrivacyChecking = false
      this.setData({ mediaPrivacyVisible: false })
      const app = getApp()
      if (app.globalData.privacyResolve) {
        app.globalData.privacyResolve({ event: 'disagree' })
        app.globalData.privacyResolve = null
      }
    },
    openMediaPrivacyPolicy() {
      wx.openPrivacyContract({ fail: () => wx.showToast({ title: '隐私指引暂时无法打开，请重试', icon: 'none' }) })
    }
  }
})
