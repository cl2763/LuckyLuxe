const api = require('../../../utils/api')
const TIER = { Silver: '银卡', Gold: '金卡', Platinum: '铂金', Diamond: '钻石' }
const STATUS = { PENDING_PAYMENT: '待付定金', CONFIRMED: '已确认', COMPLETED: '已完成', CANCELLED: '已取消', EXPIRED: '已过期', AFTER_SALES: '售后' }
function money(c) { const n = Math.round((c || 0) / 100); return '$' + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') }
function lastText(iso) { if (!iso) return '—'; const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); if (d <= 0) return '今天'; if (d < 365) return `${d}天前`; return iso.slice(0, 10) }

Page({
  data: { c: null, orders: [], ordersLoaded: false },
  onLoad(q) { this.id = decodeURIComponent((q && q.id) || '') },
  async onShow() { if (!(await api.guardOwner())) return; this.load() },
  async load() {
    try {
      const r = await api.adminGet('/admin/customers')
      const u = (r.customers || r.data || r || []).find((x) => x.id === this.id)
      if (!u) { wx.showToast({ title: '客户不存在', icon: 'none' }); return }
      this.setData({
        c: {
          name: u.displayName || '顾客',
          av: (u.displayName || '?').slice(0, 1),
          tier: TIER[u.memberTier] || u.memberTier || '会员',
          memberCode: u.memberCode || '',
          phone: u.phone || '',
          visits: u.visitCount || 0,
          last: lastText(u.lastVisitAt),
          spend: money(u.totalSpentCents),
          stored: money(u.storedValueBalanceCents),
          birthday: u.birthday || '',
          tags: u.tags || [],
          notes: u.notes || ''
        }
      })
      wx.setNavigationBarTitle({ title: u.displayName || '客户档案' })
      this.loadOrders()
    } catch (e) { wx.showToast({ title: '加载失败', icon: 'none' }) }
  },
  async loadOrders() {
    try {
      const r = await api.adminGet('/admin/bookings')
      const orders = (r.bookings || [])
        .filter((b) => b.user && b.user.id === this.id)
        .map((b) => ({
          id: b.id,
          service: (b.service && b.service.name) || '服务',
          date: b.appointmentDate || '',
          time: b.appointmentTime || '',
          price: money(b.servicePriceCents),
          statusLabel: STATUS[b.status] || b.status,
          done: b.status === 'COMPLETED'
        }))
      this.setData({ orders, ordersLoaded: true })
    } catch (e) { this.setData({ ordersLoaded: true }) }
  }
})
