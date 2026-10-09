const api = require('../../utils/api')
const nav = require('../../utils/nav')
const requestLoading = require('../../utils/request-loading')

function scanRequest(path, method, data) {
  const auth = api.getAuth()
  return new Promise((resolve, reject) => wx.request({
    url: `${api.API_BASE}${path}`, method: method || 'GET', data, timeout:15000,
    header: auth?._realWechat && auth.accessToken ? {authorization:`Bearer ${auth.accessToken}`} : {},
    complete: requestLoading.begin(),
    success: r => r.statusCode >= 200 && r.statusCode < 300 ? resolve(r.data) : reject(r.data?.error || new Error('扫码请求失败')),
    fail: reject
  }))
}

Page({
  data: { state:'loading', scene:'', card:null, message:'' },
  onLoad(q) {
    const scene = decodeURIComponent(q.scene || '')
    if (!/^(?:[sbpd][0-9a-f]{24}|m[A-Z0-9]{8})$/.test(scene)) { this.setData({state:'error',message:'这个码无效，请让店员重新出示。'}); return }
    this.setData({scene})
    this.load()
  },
  async load() {
    try {
      const card = await scanRequest(`/scan/${this.data.scene}`)
      if(card.kind==='bookingDraft') {
        if(api.currentTenantId()!==card.tenantId) {api.onStoreSwitched();wx.setStorageSync('lucky_tenant',card.tenantId)}
        nav.redirect(`/pages/booking-draft/index?id=${encodeURIComponent(card.draftId)}&tenant=${encodeURIComponent(card.tenantId)}`); return
      }
      if (card.kind === 'store') {
        if (api.currentTenantId() !== card.tenantId) { api.onStoreSwitched(); wx.setStorageSync('lucky_tenant',card.tenantId) }
        wx.switchTab({url:'/pages/home/index',fail:()=>this.setData({state:'error',message:'门店页面未打开，请重试。'})})
        return
      }
      if (card.kind === 'bind') {
        nav.redirect(`/pages/bind/index?token=${encodeURIComponent(card.token)}`)
        return
      }
      if (card.kind === 'member') { this.setData({state:'member',card}); return }
      if (card.alreadyBound) { nav.redirect(`/pages/sign/index?token=${encodeURIComponent(card.token)}`); return }
      this.setData({state:'confirm',card})
    } catch (e) { this.setData({state:'error',message:e.message || '扫码失败，请重新出示二维码。'}) }
  },
  async confirm() {
    if (this._busy) return
    this._busy = true
    this.setData({state:'working'})
    try {
      const code = await new Promise((resolve,reject) => wx.login({success:r => r.code ? resolve(r.code) : reject(new Error('微信登录失败')),fail:reject}))
      const out = await scanRequest(`/scan/${this.data.scene}/claim`,'POST',{code})
      if (out.conflict) {
        if (this.data.card.kind === 'member') { this.setData({state:'member-conflict',message:'这个微信已绑定本店另一份档案。系统没有覆盖或合并，请让店员核对。'}); return }
        this.setData({state:'conflict',message:'这个微信已绑定本店另一份档案。系统没有合并记录；请店员核对。你仍可核对并签署本单。'})
        return
      }
      api.acceptCustomerSession(out)
      if (this.data.card.kind === 'member') { wx.switchTab({url:'/pages/me/index'}); return }
      nav.redirect(`/pages/sign/index?token=${encodeURIComponent(this.data.card.token)}`)
    } catch (e) {
      const blocked = e.code === 'PROFILE_ALREADY_BOUND'
      const state = blocked ? (this.data.card?.kind === 'member' ? 'member-conflict' : 'conflict')
        : (this.data.card?.kind === 'member' ? 'member' : 'confirm')
      const message = e.message || '身份确认失败，请重试。'
      this.setData({state,message})
      wx.showModal({title:blocked?'档案身份需核对':'确认未完成',content:message,showCancel:false,fail:(err)=>console.warn('[showModal fail]',err)})
    }
    finally { this._busy = false }
  },
  signOnly() {
    if (!this.data.card?.token) return
    nav.redirect(`/pages/sign/index?token=${encodeURIComponent(this.data.card.token)}`)
  }
})
