const storage = require('../../utils/storage')
const mock = require('../../utils/mock-data')
const i18n = require('../../utils/i18n')
const api = require('../../utils/api')
const tabbar = require('../../utils/tabbar')
const DEFAULT_AVATAR = '/assets/images/member-profile.jpg'

Page({
  data: {
    member: {},
    lang: 'zh',
    t: i18n.pageCopy('me', 'zh'),
    isLoggedIn: false,
    growthPercent: 0,
    recentOrders: [],
    authModalVisible: false,
    authModalMode: 'login',
    canFinishLogin: false,
    authProfile: {
      avatarUrl: '',
      nickname: '',
      phoneAuthorized: false,
      phoneAuthFailed: false,
      phoneMode: 'manual',
      phoneMessage: '',
      phoneCode: '',
      manualPhone: '',
      smsCode: '',
      smsSent: false,
      smsCountdown: 0,
      manualPhoneVerified: false,
      privacyChecked: false,
      privacyAuthorized: false
    },
    counts: {
      pending_service: 0,
      completed: 0,
      cancelled: 0,
      after_sales: 0
    }
  },

  guestMember(lang = 'zh') {
    return {
      nickname: lang === 'en' ? 'Guest' : '未登录',
      memberLevel: lang === 'en' ? 'Guest Member' : '游客会员',
      memberTier: 'guest',
      nextMemberLevel: '',
      growthValue: 0,
      nextLevelValue: 500,
      amountToNextLevel: 0,
      growthNote: lang === 'en' ? 'Sign in to view member progress.' : '登录后查看会员成长值。',
      points: 0,
      couponCount: 0,
      balance: 0,
      totalSpent: 0,
      visits: 0,
      memberCode: lang === 'en' ? 'Sign in' : '登录后生成',
      referralCode: '',
      referralUrl: '',
      avatarUrl: DEFAULT_AVATAR
    }
  },

  emptyAuthProfile() {
    return {
      avatarUrl: '',
      nickname: '',
      phoneAuthorized: false,
      phoneAuthFailed: false,
      phoneMode: 'manual',
      phoneMessage: '',
      phoneCode: '',
      manualPhone: '',
      smsCode: '',
      smsSent: false,
      smsCountdown: 0,
      manualPhoneVerified: false,
      privacyChecked: false,
      privacyAuthorized: false
    }
  },

  debugAuth(label, payload) {
    if (payload === undefined) {
      console.log(`[LuckyLuxe][auth] ${label}`)
      return
    }
    console.log(`[LuckyLuxe][auth] ${label}`, payload)
  },

  async onShow() {
    tabbar.update(this, 3)
    let member = wx.getStorageSync('lucky_member') || {}
    const lang = i18n.getLang()
    i18n.applyTabBar(lang)
    storage.syncCartBadge()
    i18n.setTitle(i18n.pageCopy('me', lang).title)
    let sourceOrders = []
    const isLoggedIn = api.isLoggedIn()
    try {
      if (isLoggedIn) {
        member = wx.getStorageSync('lucky_member') || member
        sourceOrders = await api.getBookings(lang)
        if (sourceOrders.length) storage.setOrders(sourceOrders)
      }
    } catch (error) {
      sourceOrders = isLoggedIn ? storage.getOrders() : []
    }
    const orders = sourceOrders.map((item) => {
      const service = item.service || mock.findService(item.serviceInfo.serviceId) || {}
      const localizedService = i18n.localizeService(service, lang)
      return Object.assign({}, item, {
        statusText: i18n.statusText(item.status, lang),
        serviceName: localizedService.name || item.serviceInfo.serviceName,
        serviceImage: service.image || item.serviceImage || '/assets/images/store-cover.jpg'
      })
    })
    member = isLoggedIn
      ? Object.assign(api.miniMember({}), member, {
        avatarUrl: member.avatarUrl || DEFAULT_AVATAR
      })
      : this.guestMember(lang)
    if (isLoggedIn && !member.profileComplete) {
      member = Object.assign({}, member, {
        nickname: member.nickname || member.id || member.memberCode || (lang === 'en' ? 'WeChat User' : '微信用户'),
        avatarUrl: member.avatarUrl || DEFAULT_AVATAR
      })
    }
    const growthPercent = member.nextLevelValue
      ? Math.min(100, Math.round((member.growthValue || 0) / member.nextLevelValue * 100))
      : 100
    const growthNote = this.memberGrowthNote(member, lang)
    this.setData({
      member: Object.assign({}, member, { growthNote }),
      lang,
      t: i18n.pageCopy('me', lang),
      isLoggedIn,
      growthPercent,
      recentOrders: orders.slice(0, 2),
      counts: {
        pending_service: orders.filter((item) => item.status === 'pending_service').length,
        completed: orders.filter((item) => item.status === 'completed').length,
        cancelled: orders.filter((item) => item.status === 'cancelled').length,
        after_sales: orders.filter((item) => item.status === 'after_sales').length
      }
    })
  },

  memberGrowthNote(member, lang = 'zh') {
    if (!member) return lang === 'en' ? 'Sign in to view member progress.' : '登录后查看会员成长值。'
    if (!member.nextMemberLevel) {
      return lang === 'en' ? 'Highest tier reached. Deposit waiver is active.' : '已达到最高等级，预约定金减免已生效。'
    }
    const amount = Math.max(0, member.amountToNextLevel === undefined
      ? (member.nextLevelValue || 0) - (member.growthValue || 0)
      : member.amountToNextLevel)
    return lang === 'en'
      ? `CAD $${amount} to ${member.nextMemberLevel}`
      : `距离 ${member.nextMemberLevel} 还差 CAD $${amount}`
  },

  openLoginPanel() {
    this.debugAuth('open login panel')
    this.setData({
      authModalVisible: true,
      authModalMode: 'login',
      authProfile: Object.assign({}, this.data.authProfile, {
        avatarUrl: this.data.authProfile.avatarUrl || '',
        nickname: this.data.authProfile.nickname || ''
      })
    })
    this.syncAuthReady()
  },

  openProfilePanel() {
    this.debugAuth('open profile panel')
    this.setData({
      authModalVisible: true,
      authModalMode: 'profile',
      authProfile: Object.assign({}, this.data.authProfile, {
        avatarUrl: this.data.member.avatarUrl && this.data.member.avatarUrl !== DEFAULT_AVATAR ? this.data.member.avatarUrl : '',
        nickname: this.data.member.profileComplete ? this.data.member.nickname : '',
        privacyChecked: true,
        privacyAuthorized: true
      })
    })
    this.syncAuthReady()
  },

  closeLoginPanel() {
    this.setData({ authModalVisible: false })
  },

  noop() {},

  preparePrivacyForNativeAuth() {
    if (!wx.requirePrivacyAuthorize) {
      this.debugAuth('privacy API unavailable, skip preflight')
      this.setData({ 'authProfile.privacyAuthorized': true })
      return
    }
    wx.requirePrivacyAuthorize({
      success: () => {
        this.debugAuth('privacy preflight success')
        const app = typeof getApp === 'function' ? getApp() : null
        if (app && app.resolvePrivacyAuthorization) app.resolvePrivacyAuthorization()
        this.setData({ 'authProfile.privacyAuthorized': true })
      },
      fail: (error) => {
        this.debugAuth('privacy preflight failed', error)
      }
    })
  },

  onAvatarTap(event) {
    this.debugAuth('avatar button tap', event && event.detail)
    if (!this.data.authProfile.privacyAuthorized) this.preparePrivacyForNativeAuth()
  },

  chooseAvatar(event) {
    this.debugAuth('chooseAvatar legacy handler', event && event.detail)
    const avatarUrl = event.detail && event.detail.avatarUrl
    if (!avatarUrl) {
      this.debugAuth('chooseAvatar missing avatarUrl', event && event.detail)
      return
    }
    this.debugAuth('chooseAvatar avatar temp path', avatarUrl)
    this.setData({ 'authProfile.avatarUrl': avatarUrl })
    this.syncAuthReady()
  },

  onChooseAvatar(event) {
    this.debugAuth('onChooseAvatar result', event && event.detail)
    this.chooseAvatar(event)
  },

  inputNickname(event) {
    this.debugAuth('nickname input', event && event.detail ? event.detail.value : '')
    this.setData({ 'authProfile.nickname': event.detail.value || '' })
    this.syncAuthReady()
  },

  inputManualPhone(event) {
    this.debugAuth('manual phone input', event && event.detail)
    this.setData({
      'authProfile.manualPhone': event.detail.value || '',
      'authProfile.manualPhoneVerified': false
    })
    this.syncAuthReady()
  },

  inputSmsCode(event) {
    this.debugAuth('sms code input', event && event.detail)
    this.setData({
      'authProfile.smsCode': event.detail.value || '',
      'authProfile.manualPhoneVerified': false
    })
    this.syncAuthReady()
  },

  togglePrivacy() {
    this.debugAuth('privacy checkbox toggle', { next: !this.data.authProfile.privacyChecked })
    this.setData({ 'authProfile.privacyChecked': !this.data.authProfile.privacyChecked })
    this.syncAuthReady()
  },

  onPrivacyTap(event) {
    this.debugAuth('privacy agreement tap', event && event.detail)
    if (!wx.requirePrivacyAuthorize) {
      this.setData({
        'authProfile.privacyChecked': !this.data.authProfile.privacyChecked,
        'authProfile.privacyAuthorized': true
      })
      this.syncAuthReady()
    }
  },

  onAgreePrivacyAuthorization(event) {
    this.debugAuth('agreePrivacyAuthorization result', event && event.detail)
    const app = typeof getApp === 'function' ? getApp() : null
    if (app && app.resolvePrivacyAuthorization) app.resolvePrivacyAuthorization()
    this.setData({
      'authProfile.privacyChecked': true,
      'authProfile.privacyAuthorized': true
    })
    this.syncAuthReady()
  },

  isAuthReady(profile = this.data.authProfile) {
    if (this.data.authModalMode === 'profile') return Boolean((profile.nickname || '').trim() || profile.avatarUrl)
    return Boolean(profile.privacyChecked)
  },

  syncAuthReady() {
    const canFinishLogin = this.isAuthReady()
    this.setData({ canFinishLogin })
  },

  requestPrivacyAuthorization() {
    if (this.data.authProfile.privacyAuthorized) return Promise.resolve(true)
    if (!wx.requirePrivacyAuthorize) {
      this.debugAuth('requestPrivacyAuthorization skipped: API unavailable')
      this.setData({ 'authProfile.privacyAuthorized': true })
      return Promise.resolve(true)
    }
    return new Promise((resolve) => {
      wx.requirePrivacyAuthorize({
        success: () => {
          this.debugAuth('requestPrivacyAuthorization success')
          const app = typeof getApp === 'function' ? getApp() : null
          if (app && app.resolvePrivacyAuthorization) app.resolvePrivacyAuthorization()
          this.setData({ 'authProfile.privacyAuthorized': true })
          resolve(true)
        },
        fail: (error) => {
          this.debugAuth('requestPrivacyAuthorization failed', error)
          wx.showToast({
            title: this.data.lang === 'en' ? 'Please agree to continue' : '请同意隐私协议后继续',
            icon: 'none'
          })
          resolve(false)
        }
      })
    })
  },

  async finishLogin() {
    this.debugAuth('final login click', this.data.authProfile)
    this.syncAuthReady()
    if (!this.isAuthReady()) {
      wx.showToast({
        title: this.data.authModalMode === 'profile'
          ? (this.data.lang === 'en' ? 'Choose an avatar or enter a nickname first' : '请先选择头像或填写昵称')
          : (this.data.lang === 'en' ? 'Please agree to the privacy policy first' : '请先同意隐私协议'),
        icon: 'none'
      })
      return
    }
    const profile = this.data.authProfile
    if (this.data.authModalMode === 'profile') {
      this.debugAuth('save profile click', {
        hasAvatar: Boolean(profile.avatarUrl),
        nickname: profile.nickname
      })
      try {
        if (profile.nickname) {
          await api.loginWithWechat({
            nickname: profile.nickname,
            avatarUrl: '',
            phoneCode: '',
            phone: ''
          })
        }
        const currentMember = wx.getStorageSync('lucky_member') || {}
        wx.setStorageSync('lucky_member', Object.assign({}, currentMember, {
          nickname: profile.nickname || currentMember.nickname || (this.data.lang === 'en' ? 'WeChat User' : '微信用户'),
          avatarUrl: profile.avatarUrl || currentMember.avatarUrl || DEFAULT_AVATAR,
          profileComplete: true,
          memberLevel: currentMember.memberLevel || 'Silver Member'
        }))
        this.debugAuth('profile save success')
        wx.showToast({ title: this.data.lang === 'en' ? 'Profile saved' : '资料已保存', icon: 'success' })
        this.setData({ authModalVisible: false })
        this.onShow()
      } catch (error) {
        this.debugAuth('profile save failed', {
          message: error && error.message,
          code: error && error.code
        })
        wx.showToast({ title: error.message || '保存失败', icon: 'none' })
      }
      return
    }
    const privacyOk = await this.requestPrivacyAuthorization()
    if (!privacyOk) return
    try {
      const loginResult = await api.loginWithWechat({
        nickname: profile.nickname || '',
        avatarUrl: profile.avatarUrl || '',
        phoneCode: '',
        phone: ''
      })
      this.debugAuth('wx mini login success', {
        id: loginResult && loginResult.id,
        displayName: loginResult && loginResult.displayName,
        provider: loginResult && loginResult.provider
      })
      const currentMember = wx.getStorageSync('lucky_member') || {}
      const hasProfile = Boolean(profile.nickname || profile.avatarUrl)
      wx.setStorageSync('lucky_member', Object.assign({}, currentMember, {
        nickname: profile.nickname || currentMember.nickname || loginResult.id || loginResult.displayName || currentMember.memberCode || (this.data.lang === 'en' ? 'WeChat User' : '微信用户'),
        avatarUrl: profile.avatarUrl || currentMember.avatarUrl || DEFAULT_AVATAR,
        profileComplete: hasProfile || Boolean(currentMember.profileComplete),
        memberLevel: currentMember.memberLevel || 'Silver Member',
        phoneAuthorized: false,
        phoneCode: '',
        phone: ''
      }))
      wx.showToast({ title: this.data.lang === 'en' ? 'Saved' : '已保存', icon: 'success' })
      this.setData({ authModalVisible: false })
      this.onShow()
    } catch (error) {
      this.debugAuth('wx mini login failed', {
        message: error && error.message,
        code: error && error.code
      })
      wx.showToast({ title: error.message || '登录失败', icon: 'none' })
    }
  },

  login() {
    this.openLoginPanel()
  },

  loginWithPhone(event) {
    this.debugAuth('loginWithPhone legacy handler', event && event.detail)
    const detail = event && event.detail ? event.detail : {}
    const errMsg = detail.errMsg || ''
    const isPrivacyScopeMissing = detail.errno === 112 || errMsg.indexOf('api scope is not declared in the privacy agreement') >= 0
    if (isPrivacyScopeMissing) {
      this.debugAuth('phone authorization blocked by privacy scope declaration', detail)
      this.setData({
        'authProfile.phoneAuthorized': false,
        'authProfile.phoneAuthFailed': true,
        'authProfile.phoneMode': 'manual',
        'authProfile.phoneMessage': this.data.lang === 'en'
          ? 'WeChat phone authorization is blocked because the phone API is not declared in the Mini Program privacy agreement. Please use manual verification for now.'
          : '微信后台隐私协议暂未声明手机号接口，请先使用手动手机号验证。后台配置完成后可使用微信一键授权。'
      })
      this.syncAuthReady()
      return
    }
    if (errMsg && errMsg.indexOf('ok') < 0) {
      this.setData({
        'authProfile.phoneAuthorized': false,
        'authProfile.phoneAuthFailed': true,
        'authProfile.phoneMode': 'manual',
        'authProfile.phoneMessage': this.data.lang === 'en'
          ? 'WeChat phone authorization was cancelled. Please verify manually.'
          : '微信手机号授权未完成，请使用手动验证。'
      })
      this.syncAuthReady()
      return
    }
    const phoneCode = detail.code || ''
    this.debugAuth('phone authorization returned code/encrypted data', {
      code: phoneCode,
      hasEncryptedData: Boolean(detail.encryptedData),
      hasIv: Boolean(detail.iv)
    })
    this.setData({
      'authProfile.phoneAuthorized': true,
      'authProfile.phoneAuthFailed': false,
      'authProfile.phoneMode': 'wechat',
      'authProfile.phoneMessage': this.data.lang === 'en'
        ? 'WeChat phone authorization returned a code. Backend binding is required before production.'
        : '微信手机号授权已返回 code，正式上线前需要后端换取并绑定手机号。',
      'authProfile.phoneCode': phoneCode,
      'authProfile.manualPhoneVerified': false
    })
    this.syncAuthReady()
    wx.showToast({ title: this.data.lang === 'en' ? 'Phone authorized' : '手机号已授权', icon: 'success' })
  },

  onPhoneAuthTap(event) {
    this.debugAuth('phone authorization button tap', event && event.detail)
    if (!this.data.authProfile.privacyAuthorized) this.preparePrivacyForNativeAuth()
  },

  onGetPhoneNumber(event) {
    this.debugAuth('onGetPhoneNumber result', event && event.detail)
    this.loginWithPhone(event)
  },

  sendSmsCode() {
    this.debugAuth('send code click', {
      phone: this.data.authProfile.manualPhone,
      countdown: this.data.authProfile.smsCountdown
    })
    const phone = (this.data.authProfile.manualPhone || '').trim()
    if (!/^(\+?\d[\d -]{7,18})$/.test(phone)) {
      wx.showToast({ title: this.data.lang === 'en' ? 'Enter a valid phone number' : '请输入有效手机号', icon: 'none' })
      return
    }
    if (this.data.authProfile.smsCountdown > 0) return
    // TODO: Replace this placeholder with a real backend SMS provider before production.
    this.setData({
      'authProfile.smsSent': true,
      'authProfile.smsCountdown': 60,
      'authProfile.phoneMessage': this.data.lang === 'en'
        ? 'Verification code sent. Demo code: 0312.'
        : '验证码已发送。测试验证码：0312。'
    })
    if (this.smsTimer) clearInterval(this.smsTimer)
    this.smsTimer = setInterval(() => {
      const next = Math.max(0, this.data.authProfile.smsCountdown - 1)
      this.setData({ 'authProfile.smsCountdown': next })
      if (next <= 0 && this.smsTimer) {
        clearInterval(this.smsTimer)
        this.smsTimer = null
      }
    }, 1000)
  },

  verifySmsCode() {
    this.debugAuth('verify code click', {
      phone: this.data.authProfile.manualPhone,
      code: this.data.authProfile.smsCode
    })
    const code = (this.data.authProfile.smsCode || '').trim()
    // TODO: Replace local demo validation with backend SMS verification.
    if (code !== '0312') {
      this.setData({
        'authProfile.manualPhoneVerified': false,
        'authProfile.phoneMessage': this.data.lang === 'en' ? 'Invalid code. Demo code is 0312.' : '验证码不正确，测试验证码为 0312。'
      })
      this.syncAuthReady()
      this.debugAuth('verify code result', { ok: false })
      return
    }
    this.setData({
      'authProfile.manualPhoneVerified': true,
      'authProfile.phoneAuthorized': false,
      'authProfile.phoneMessage': this.data.lang === 'en' ? 'Phone number verified.' : '手机号验证完成。'
    })
    this.syncAuthReady()
    this.debugAuth('verify code result', { ok: true })
  },

  logout() {
    api.clearAuth()
    wx.removeStorageSync('lucky_member')
    wx.removeStorageSync('lucky_orders')
    this.setData({
      authModalVisible: false,
      authProfile: this.emptyAuthProfile(),
      canFinishLogin: false
    })
    wx.showToast({ title: this.data.lang === 'en' ? 'Signed out' : '已退出', icon: 'none' })
    this.onShow()
  },

  goOrders(event) {
    this.requireLogin(() => {
      const status = event.currentTarget.dataset.status || 'all'
      wx.navigateTo({ url: `/pages/orders/index?status=${status}` })
    })
  },

  requireLogin(callback) {
    if (this.data.isLoggedIn && api.isLoggedIn()) {
      if (typeof callback === 'function') callback()
      return true
    }
    this.openLoginPanel()
    return false
  },

  goAssets() {
    this.requireLogin(() => wx.navigateTo({ url: '/pages/assets/index' }))
  },

  goOrderDetail(event) {
    this.requireLogin(() => wx.navigateTo({ url: `/pages/order-detail/index?id=${event.currentTarget.dataset.id}` }))
  },

  showMemberCode() {
    if (!this.requireLogin()) return
    wx.showModal({
      title: this.data.lang === 'en' ? 'Member code' : '会员码',
      content: `${this.data.member.memberCode || 'LL-F4ZY'}\n${this.data.lang === 'en' ? 'Show this code in store or share it as your referral code.' : '到店可出示此码，后续也可作为分享推荐码使用。'}`,
      confirmText: this.data.lang === 'en' ? 'OK' : '知道了',
      showCancel: false
    })
  },

  goMemberBenefits() {
    this.requireLogin(() => wx.navigateTo({ url: '/pages/member-benefits/index' }))
  },

  goStore() {
    this.requireLogin(() => wx.navigateTo({ url: '/pages/store-location/index' }))
  },

  openProtectedFeature() {
    this.requireLogin()
  },

  onUnload() {
    if (this.smsTimer) clearInterval(this.smsTimer)
  }
})
