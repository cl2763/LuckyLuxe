const api = require('../../../utils/api')
const { storeMoney } = require('../../../utils/storeclock')
/* 🔴 03r:原来键是**首字母大写**(Silver/Gold/…),而 `memberTier` 来自 AI 抽取的记忆,
   大小写随来源 —— `TIER['gold']` 取不到就兜底到 `u.memberTier`,**把原始枚举当中文名显示**。
   等级中文名的唯一出口在后端 conversation-card.mjs 的 tierText;这个列表页不走那个接口,
   所以这里做同样的**大小写不敏感 + 兜到「会员」**,绝不漏枚举。
   (两处小程序页原本字面完全相同 = 同一份东西抄了两遍;会话页已改读后端下发的 tierText。) */
const TIER = { silver: '银卡', gold: '金卡', platinum: '铂金', diamond: '钻石', member: '会员', guest: '顾客' }
const tierCn = (raw) => (raw ? (TIER[String(raw).toLowerCase()] || '会员') : '') // D41:不分级店两态
const STATUS = { PENDING_PAYMENT: '待付定金', CONFIRMED: '已确认', COMPLETED: '已完成', CANCELLED: '已取消', EXPIRED: '已过期', AFTER_SALES: '售后' }
function money(c) { return storeMoney(c, 0) } // 门店币种,不写死 $
function lastText(iso) { if (!iso) return '—'; const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); if (d <= 0) return '今天'; if (d < 365) return `${d}天前`; return iso.slice(0, 10) }

Page({
  data: { c: null, orders: [], ordersLoaded: false },
  onLoad(q) { this.id = decodeURIComponent((q && q.id) || '') },
  writeNote() {
    const nm = (this.data.c && this.data.c.name) || '顾客'
    wx.navigateTo({ url: `/pages/merchant/service-note/index?userId=${encodeURIComponent(this.id)}&name=${encodeURIComponent(nm)}` })
  },
  accountAdjust() {
    const nm = (this.data.c && this.data.c.name) || '顾客'
    wx.navigateTo({ url: `/pages/merchant/account-adjust/index?userId=${encodeURIComponent(this.id)}&name=${encodeURIComponent(nm)}` })
  },
  viewProfile() {
    const nm = (this.data.c && this.data.c.name) || '顾客'
    wx.navigateTo({ url: `/pages/merchant/customer-profile/index?userId=${encodeURIComponent(this.id)}&name=${encodeURIComponent(nm)}` })
  },
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
          tier: tierCn(u.memberTier) || '会员',
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
  // 发券给该会员:选一张在售券 → 生成核销码
  async sendCoupon() {
    try {
      const r = await api.adminGet('/admin/coupons')
      const list = (r.coupons || []).filter((c) => c.isActive)
      if (!list.length) { wx.showToast({ title: '还没有可发的券,先到会员套餐里新增', icon: 'none' }); return }
      wx.showActionSheet({
        itemList: list.slice(0, 6).map((c) => c.name),
        success: async (res) => {
          const c = list[res.tapIndex]
          try {
            const g = await api.adminPost(`/admin/coupons/${encodeURIComponent(c.id)}/grant`, { userId: this.id })
            wx.showModal({ title: '已发券', content: `「${g.grant.couponName}」已发给 ${g.grant.userName}\n核销码 ${g.grant.code}\n有效期至 ${String(g.grant.expiresAt).slice(0, 10)}\n顾客券包里也能看到`, showCancel: false,
  fail: (e) => console.warn('[showModal fail]', e) // S组卫生批:fail=开发者域错误,console 留痕不弹 UI(toast 会撞转场,D27 家族)
})
          } catch (err) { wx.showToast({ title: (err && err.message) || '发券失败', icon: 'none' }) }
        }
      })
    } catch (e) { wx.showToast({ title: '加载券失败', icon: 'none' }) }
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
