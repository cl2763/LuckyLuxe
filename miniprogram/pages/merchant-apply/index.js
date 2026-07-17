const api = require('../../utils/api')

const TYPES = ['美甲', '美睫', '美甲美睫综合', '美容/皮肤管理', '其他美业']

Page({
  data: {
    types: TYPES, typeIdx: 0,
    shopName: '', contactName: '', phone: '', wechatId: '', city: '', note: '',
    submitting: false, done: false
  },

  onShop(e) { this.setData({ shopName: e.detail.value }) },
  onContact(e) { this.setData({ contactName: e.detail.value }) },
  onPhone(e) { this.setData({ phone: e.detail.value }) },
  onWechat(e) { this.setData({ wechatId: e.detail.value }) },
  onCity(e) { this.setData({ city: e.detail.value }) },
  onNote(e) { this.setData({ note: e.detail.value }) },
  onType(e) { this.setData({ typeIdx: Number(e.detail.value) }) },

  async submit() {
    if (this.data.submitting) return
    const { shopName, phone, wechatId } = this.data
    if (!shopName.trim()) { wx.showToast({ title: '请填店铺名称', icon: 'none' }); return }
    if (!phone.trim() && !wechatId.trim()) { wx.showToast({ title: '手机号/微信号至少留一个', icon: 'none' }); return }
    this.setData({ submitting: true })
    try {
      await api.submitMerchantLead({
        shopName: shopName.trim(),
        contactName: this.data.contactName.trim(),
        phone: phone.trim(),
        wechatId: wechatId.trim(),
        shopType: this.data.types[this.data.typeIdx],
        city: this.data.city.trim(),
        note: this.data.note.trim()
      })
      this.setData({ done: true })
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '提交失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  back() { wx.navigateBack() }
})
