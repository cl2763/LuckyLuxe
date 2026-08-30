/* 营业时间强制设置(《营业时间强制设置图 v1.0》· D84 · 2026-08-30)。
   合同一:未设置态老板号在任何管理页之前必见本页(api.js enforceHoursGate 用 nav.relaunch 清栈送进来,
   无返回栈=不可跳过);合同四:员工号同页见墙,无表单。
   文案=后端 hoursGateText(adminMe 时缓存);合同三:初始七天全不勾、时间空,零预填。 */
const api = require('../../../utils/api')
const nav = require('../../../utils/nav')

const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

Page({
  data: { days: [], isOwner: true, txt: {}, anyOpen: false, saving: false },

  onShow() {
    if (!api.guardMerchant()) return
    /* 已设置的店误入本页(直链)→ 送回首页,本页只服务未设置态 */
    if (wx.getStorageSync('lucky_hours_unset') !== '1') { nav.relaunch('/pages/merchant/home/index'); return }
    if (!this.data.days.length) {
      this.setData({
        days: DAY_ORDER.map((w) => ({ weekday: w, name: DAY_NAMES[w], open: false, openTime: '', closeTime: '' })),
        isOwner: api.isOwner(),
        txt: api.hoursGateText()
      })
    }
  },

  toggleDay(e) {
    const i = Number(e.currentTarget.dataset.i)
    const days = this.data.days.slice()
    days[i] = Object.assign({}, days[i], { open: !days[i].open })
    this.setData({ days, anyOpen: days.some((d) => d.open) })
  },
  pickOpen(e) {
    const i = Number(e.currentTarget.dataset.i)
    const days = this.data.days.slice()
    days[i] = Object.assign({}, days[i], { openTime: e.detail.value })
    this.setData({ days })
  },
  pickClose(e) {
    const i = Number(e.currentTarget.dataset.i)
    const days = this.data.days.slice()
    days[i] = Object.assign({}, days[i], { closeTime: e.detail.value })
    this.setData({ days })
  },

  async save() {
    const { days, anyOpen, saving } = this.data
    if (!anyOpen || saving) return
    for (const d of days) {
      if (d.open && (!d.openTime || !d.closeTime)) { wx.showToast({ title: `${d.name}还没选时间`, icon: 'none' }); return }
      if (d.open && d.openTime >= d.closeTime) { wx.showToast({ title: `${d.name}的开始时间要早于结束时间`, icon: 'none' }); return }
    }
    this.setData({ saving: true })
    try {
      /* 七天整份提交;A2「至少一天营业」的最终闸在后端 PUT 里 */
      await api.adminPut('/admin/business-hours', {
        hours: days.map((d) => (d.open
          ? { weekday: d.weekday, openTime: d.openTime, closeTime: d.closeTime, isClosed: false }
          : { weekday: d.weekday, isClosed: true }))
      })
      await api.adminMe().catch(() => {})   // 刷新旗标缓存(A5:设完立即生效)
      wx.setStorageSync('lucky_hours_unset', '')
      nav.relaunch('/pages/merchant/orders/index')
    } catch (e) {
      this.setData({ saving: false })
      wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' })
    }
  }
})
