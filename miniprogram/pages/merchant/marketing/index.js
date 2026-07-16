const api = require('../../../utils/api')

const SLEEP_DAYS = 60

Page({
  data: { sleepN: 0, sleepNames: [], revisitN: 0, loading: true },

  async onShow() { if (!(await api.guardOwner())) return; this.load() },

  async load() {
    try {
      const [custRes, remRes] = await Promise.all([
        api.adminGet('/admin/customers').catch(() => ({ customers: [] })),
        api.adminGet('/admin/reminder-tasks').catch(() => ({ reminderTasks: [] }))
      ])
      const now = Date.now()
      const sleepers = (custRes.customers || []).filter((c) => {
        if (!(c.storedValueBalanceCents > 0)) return false
        if (!c.lastVisitAt) return true
        const days = (now - new Date(c.lastVisitAt).getTime()) / 86400000
        return days >= SLEEP_DAYS
      })
      const revisitN = (remRes.reminderTasks || []).filter((t) => ['pending', 'scheduled', 'queued'].includes(String(t.status || '').toLowerCase())).length
      this.setData({
        sleepN: sleepers.length,
        sleepNames: sleepers.map((c) => `${c.displayName || '会员'}(余额 $${((c.storedValueBalanceCents || 0) / 100).toFixed(0)})`),
        revisitN,
        loading: false
      })
    } catch (e) { this.setData({ loading: false }); wx.showToast({ title: '加载失败', icon: 'none' }) }
  },

  wakeSleep() {
    if (!this.data.sleepN) { wx.showToast({ title: '暂无沉睡储值卡', icon: 'none' }); return }
    wx.showModal({
      title: `沉睡储值卡 · ${this.data.sleepN} 人`,
      content: this.data.sleepNames.slice(0, 8).join('\n') + (this.data.sleepN > 8 ? '\n…' : ''),
      confirmText: '生成名单', cancelText: '关闭',
      success: (r) => { if (r.confirm) wx.showToast({ title: '名单已生成,推送即将上线', icon: 'none' }) }
    })
  },

  revisit() {
    wx.showToast({ title: this.data.revisitN ? `${this.data.revisitN} 条待回访,名单即将可推送` : '暂无待回访', icon: 'none' })
  },

  content() { wx.navigateTo({ url: '/pages/merchant/content/index' }) },
  coupon() { wx.navigateTo({ url: '/pages/merchant/member/index?seg=2' }) }
})
