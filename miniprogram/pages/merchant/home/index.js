const api = require('../../../utils/api')

function todayStr() {
  const d = new Date()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

Page({
  data: {
    greeting: '嗨,老板 👋',
    roleLabel: '老板',
    isOwner: true,
    dateText: '',
    brief: '',
    actions: [],
    todo: { human: 0, quote: 0, today: 0, schedule: 0 }
  },

  onShow() {
    this.load()
  },

  async load() {
    const d = new Date()
    const wk = '日一二三四五六'[d.getDay()]
    this.setData({ dateText: `周${wk} ${d.getMonth() + 1}月${d.getDate()}日 · 今天该干什么` })

    try {
      const me = await api.adminMe()
      const isOwner = me && me.role === 'owner'
      this.setData({
        isOwner,
        roleLabel: isOwner ? '老板' : '员工',
        greeting: isOwner ? '嗨,老板 👋' : `嗨,${(me && me.displayName) || '伙伴'} 👋`
      })
    } catch (e) { /* 未登录/超时:保持默认 */ }

    try {
      const [bk, conv, quote, sched] = await Promise.all([
        api.adminGet('/admin/bookings').catch(() => ({ bookings: [] })),
        api.adminGet('/admin/wechat/conversations').catch(() => ({ conversations: [] })),
        api.adminGet('/admin/quote-requests').catch(() => ({ quoteRequests: [] })),
        api.adminGet('/admin/schedule-requests').catch(() => ({ requests: [] }))
      ])
      const t = todayStr()
      this.setData({
        todo: {
          human: (conv.conversations || []).filter((c) => c.status === 'needs_human').length,
          quote: (quote.quoteRequests || []).filter((q) => q.status === 'PENDING_STAFF').length,
          today: (bk.bookings || []).filter((b) => b.appointmentDate === t).length,
          schedule: (sched.requests || []).length
        }
      })
    } catch (e) { /* 忽略,展示 0 */ }

    try {
      const r = await api.adminPost('/admin/ai/daily-brief', {})
      const data = (r && r.brief && r.brief.data) || {}
      this.setData({ brief: data.headlineZh || '', actions: (data.actionsZh || []).slice(0, 3) })
    } catch (e) { /* AI 总结失败静默 */ }
  },

  goOrders() { wx.redirectTo({ url: '/pages/merchant/orders/index' }) },
  goWorkbench() { wx.redirectTo({ url: '/pages/merchant/workbench/index' }) },
  goSchedule() { wx.navigateTo({ url: '/pages/merchant/schedule/index' }) },
  goFinance() { wx.navigateTo({ url: '/pages/merchant/finance/index' }) }
})
