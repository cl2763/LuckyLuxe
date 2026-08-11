/* 本人确认卡 · 绑定页(图 v2.3 规则⑦,顾客侧)。
   两把钥匙各司其职:绑定码=会员码(指向档案,扫了只做绑定);签署码(指向单,扫了进签署)。
   本页**看不到结算单与任何金额** —— 后端 /bind-tokens/:token 也只下发称呼/店名。
   沙盒期:开发者工具「带参编译」token 参数模拟扫码;真机扫真码那一下在发版清单里。 */
const api = require('../../utils/api')

function pub(path, method, data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${api.API_BASE}${path}`,
      method: method || 'GET',
      data,
      header: { 'content-type': 'application/json' },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data)
        else reject((res.data && res.data.error) || new Error('请求失败'))
      },
      fail: reject
    })
  })
}

Page({
  data: {
    state: 'loading',        // loading | confirm | done | already | error
    token: '',
    card: null,              // { displayName, phoneMasked, storeName, note }
    errText: '',
    memberCode: ''
  },

  onLoad(q) {
    const token = decodeURIComponent(q.token || q.t || '')
    if (!token) { this.setData({ state: 'error', errText: '缺少绑定码参数,请让店员重新出示。' }); return }
    this.setData({ token })
    this.load()
  },

  async load() {
    try {
      const card = await pub(`/bind-tokens/${encodeURIComponent(this.data.token)}`)
      if (card.alreadyBound) { this.setData({ state: 'already', card }); return }
      this.setData({ state: 'confirm', card })
    } catch (e) {
      this.setData({ state: 'error', errText: (e && e.message) || '这枚绑定码已失效,请店员重新出示。' })
    }
  },

  async confirm() {
    if (this._busy) return
    this._busy = true
    try {
      /* 真机:wx.login 换 code,后端配了微信凭证时应传 openid 链路(与签署 claim 同法);
         沙盒:后端旁路会用该档案的恒定假 openid,幂等。 */
      const out = await pub(`/bind-tokens/${encodeURIComponent(this.data.token)}/confirm`, 'POST', {})
      if (out.conflict) {
        this.setData({ state: 'error', errText: '这个微信已绑定本店另一份档案 —— 已记录待店员处理,请将手机交还技师。' })
        return
      }
      this.setData({ state: 'done', memberCode: out.memberCode || '' })
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '绑定失败,请重试', icon: 'none' })
    } finally {
      this._busy = false
    }
  }
})
