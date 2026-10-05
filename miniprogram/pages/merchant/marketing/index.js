const api = require('../../../utils/api')
const nav = require('../../../utils/nav')
const { storeMoney } = require('../../../utils/storeclock')

const SLEEP_DAYS = 30 // 与财务页“沉睡卡”口径一致:有余额且 30 天未动

Page({
  data: { sleepN: 0, sleepers: [], revisitN: 0, revisits: [], panel: '', loading: true, loadError: '' },

  async onShow() { if (!(await api.guardOwner())) return; this.load() },

  async load() {
    this.setData({ loading: true, loadError: '' })
    try {
      const [stored, queue] = await Promise.all([
        api.adminGet('/admin/stored-value'),
        api.adminGet('/admin/notify/queue?status=PENDING')
      ])
      const sleepers = ((stored.storedValue || {}).accounts || []).filter((a) => a.balanceCents > 0 && a.dormantDays >= SLEEP_DAYS)
      const revisits = (queue.tasks || []).filter((t) => t.type === 'revisit')
      this.setData({
        sleepN: sleepers.length,
        sleepers: sleepers.map((a) => ({ id: a.userId, name: a.displayName, detail: `余额 ${storeMoney(a.balanceCents)} · ${a.dormantDays} 天未动` })),
        revisitN: revisits.length,
        revisits: revisits.map((t) => ({ id: t.id, userId: t.userId || '', name: t.customerName || '顾客', detail: `${t.whenText || ''} · ${t.text || '待回访'}` })),
        loading: false
      })
    } catch (e) { this.setData({ loading: false, loadError: (e && e.message) || '加载失败' }) }
  },

  wakeSleep() { this.setData({ panel: this.data.panel === 'sleep' ? '' : 'sleep' }) },
  revisit() { this.setData({ panel: this.data.panel === 'revisit' ? '' : 'revisit' }) },
  openCustomer(e) {
    const id = e.currentTarget.dataset.id
    if (!id) { wx.showToast({ title: '这条任务没有关联顾客档案', icon: 'none' }); return }
    nav.to(`/pages/merchant/customer-profile/index?userId=${encodeURIComponent(id)}&name=${encodeURIComponent(e.currentTarget.dataset.name || '')}`)
  },

  content() { wx.navigateTo({ url: '/pages/merchant/content/index' }) },
  coupon() { wx.navigateTo({ url: '/pages/merchant/member/index?seg=2' }) }
})
