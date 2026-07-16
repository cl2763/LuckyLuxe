const api = require('../../../utils/api')

const SHADES = ['#c8a47e', '#b8926a', '#a67f56', '#9b7655', '#7d5e43']
const CHANNEL_LABEL = {
  xiaohongshu: '小红书', red: '小红书', douyin: '抖音', wechat: '微信',
  referral: '转介绍', walkin: '到店', walk_in: '到店', instagram: 'Instagram', google: 'Google',
  'demo-seed': '未标注来源', demo_seed: '未标注来源'
}

Page({
  data: {
    funnel: [], quoteToDeal: '—', repurchase: '—', avgTicket: '—',
    techLine: '', hotItems: [], channels: [],
    loading: true, empty: false
  },

  async onShow() { if (!(await api.guardOwner())) return; this.load() },

  async load() {
    try {
      const [conv, quotes, bookings, customers] = await Promise.all([
        api.adminGet('/admin/wechat/conversations').catch(() => ({ conversations: [] })),
        api.adminGet('/admin/quote-requests').catch(() => ({ quoteRequests: [] })),
        api.adminGet('/admin/bookings').catch(() => ({ bookings: [] })),
        api.adminGet('/admin/customers').catch(() => ({ customers: [] }))
      ])
      const convN = (conv.conversations || conv.list || []).length
      const quoteN = (quotes.quoteRequests || quotes.requests || quotes.list || []).length
      const bks = bookings.bookings || []
      const done = bks.filter((b) => b.status === 'COMPLETED')
      const dealN = bks.filter((b) => ['CONFIRMED', 'COMPLETED'].includes(b.status)).length
      const doneN = done.length
      const stages = [
        { label: '咨询会话', n: convN },
        { label: '进入报价', n: quoteN },
        { label: '付定金 / 成交', n: dealN },
        { label: '到店完成', n: doneN }
      ]
      const top = Math.max(convN, quoteN, dealN, doneN, 1)
      const funnel = stages.map((s, i) => ({ ...s, w: Math.max(18, Math.round((s.n / top) * 100)), c: SHADES[i] }))
      const q2d = quoteN ? Math.round((dealN / quoteN) * 100) + '%' : '—'
      const custs = customers.customers || []
      const repeat = custs.filter((c) => (c.visitCount || 0) >= 2).length
      const rep = custs.length ? Math.round((repeat / custs.length) * 100) + '%' : '—'
      // 客单价(已完成单均价)
      const revenue = done.reduce((s, b) => s + (b.servicePriceCents || 0), 0)
      const avgTicket = doneN ? '$' + Math.round(revenue / doneN / 100) : '—'
      // 按技师完成量
      const byTech = {}
      done.forEach((b) => { const t = (b.technician && b.technician.name) || b.technicianName || '未指定'; byTech[t] = (byTech[t] || 0) + 1 })
      const techLine = Object.entries(byTech).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, n]) => `${t} ${n}单`).join(' · ') || '暂无完成单'
      // 爆款(按服务)
      const bySvc = {}
      done.forEach((b) => { const n = (b.service && b.service.name) || '其他'; bySvc[n] = (bySvc[n] || 0) + 1 })
      const hotItems = Object.entries(bySvc).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, n]) => ({ name, n }))
      // 渠道来源(全部单)
      const byCh = {}
      bks.forEach((b) => { const raw = (b.sourceChannel || '').toLowerCase(); const key = raw || 'unknown'; byCh[key] = (byCh[key] || 0) + 1 })
      const channels = Object.entries(byCh).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({
        label: k === 'unknown' ? '未标注来源' : (CHANNEL_LABEL[k] || k), n
      }))
      this.setData({
        funnel, quoteToDeal: q2d, repurchase: rep, avgTicket, techLine, hotItems, channels,
        loading: false, empty: convN + quoteN + dealN + doneN === 0
      })
    } catch (e) { this.setData({ loading: false }); wx.showToast({ title: '加载失败', icon: 'none' }) }
  }
})
