/* 营业时间强制设置(《营业时间强制设置图 v1.1》· D84 · 2026-08-30)。
   合同一:未设置态老板号在任何管理页之前必见本页(api.js enforceHoursGate 用 nav.relaunch 清栈送进来,
   无返回栈=不可跳过);合同四:员工号同页见墙,无表单。
   裁定2(08-30c):表单收敛进 components/hours-form,一份组件两处挂载(本页 + 门店设置)。
   文案=后端 hoursGateText(adminMe 时缓存);合同三:强制页 initial=null = 七天全不勾零预填。 */
const api = require('../../../utils/api')
const nav = require('../../../utils/nav')

Page({
  data: { isOwner: true, txt: {}, saving: false, saveError: '' },

  onShow() {
    if (!api.guardMerchant()) return
    /* 已设置的店误入本页(直链)→ 送回首页,本页只服务未设置态 */
    if (wx.getStorageSync('lucky_hours_unset') !== '1') { nav.relaunch('/pages/merchant/home/index'); return }
    this.setData({ isOwner: api.isOwner(), txt: (wx.getStorageSync('lucky_lang') === 'en' ? api.hoursGateText().en : api.hoursGateText()) || api.hoursGateText() })
  },

  async onSave(e) {
    if (this.data.saving) return
    this.setData({ saving: true, saveError: '' })
    try {
      /* 七天整份提交;A2「至少一天营业」的最终闸在后端 PUT 里 */
      await api.adminPut('/admin/business-hours', { hours: e.detail.hours })
      await api.adminMe()   // 刷新旗标缓存(A5:设完立即生效)
      wx.setStorageSync('lucky_hours_unset', '')
      nav.relaunch('/pages/merchant/orders/index')
    } catch (err) {
      this.setData({ saving: false, saveError: this.data.txt.failed || '保存失败' })
      wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' })
    }
  }
})
