// 2026-08-02 本月流水(店主设计稿定稿):月份切换 + 收支净汇总 + 逐笔明细 + 红字冲销。
// 与网页「流水」同口径:GET /admin/finance/transactions?month=、POST /admin/finance/transactions/:id/reverse;
// 冲销单和被冲销单都保留可见,账本只追加;CSV 导出留在网页端。
const api = require('../../../utils/api')

const CHANNEL_NAMES = { wechat: '微信', alipay: '支付宝', cash: '现金', card: '刷卡', stored_value: '储值卡', unknown: '其他' }

function money(c) {
  const v = (c || 0) / 100
  const abs = Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${v < 0 ? '-' : ''}$${abs}`
}
function curMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number)
  const total = y * 12 + (m - 1) + delta
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

Page({
  data: {
    month: '',
    monthText: '',
    sum: { income: '—', expense: '—', net: '—' },   // 占位不带币符:数据到位后由 storeMoney() 填
    rows: [],
    loading: true,
    isCurrent: true
  },

  async onShow() {
    if (!(await api.guardOwner())) return
    if (!api.getFinanceKey()) {
      /* D27(店主 2026-08-12 实测,🔴):没开财务门禁的店**不需要钥匙** —— 原来这里不问门禁
         直接 toast+400ms 回退,回退撞上还没走完的进场转场动画,导航栈卡死、
         转场透明层残留顶层吃掉全 App 点击(含返回键)。先问门禁再拦;要拦也等转场走完(700ms)。 */
      let lockEnabled = false
      try { lockEnabled = Boolean((await api.adminGet('/admin/finance/lock-status')).enabled) } catch (e) { lockEnabled = false }
      if (lockEnabled) {
        wx.showToast({ title: '请先在财务页解锁', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 700)
        return
      }
    }
    if (!this.data.month) this.setData({ month: curMonth() })
    this.load()
  },

  prev() { this.setData({ month: shiftMonth(this.data.month, -1) }); this.load() },
  next() {
    if (this.data.isCurrent) return
    this.setData({ month: shiftMonth(this.data.month, 1) })
    this.load()
  },

  async load() {
    const month = this.data.month
    this.setData({ loading: true, monthText: `${month.slice(0, 4)} 年 ${Number(month.slice(5, 7))} 月`, isCurrent: month >= curMonth() })
    try {
      const data = await api.adminGet(`/admin/finance/transactions?month=${month}`)
      const s = data.summary || {}
      const txns = data.transactions || []
      const reversedIds = {}
      txns.forEach((t) => { if (t.reversalOf) reversedIds[t.reversalOf] = true })
      const rows = txns.map((t) => ({
        id: t.id,
        date: `${Number(String(t.occurredOn || '').slice(5, 7))}月${Number(String(t.occurredOn || '').slice(8, 10))}日`,
        cat: t.category,
        desc: [t.note, t.tags].filter(Boolean).join(' · ') || (t.source === 'auto' ? '自动入账' : ''),
        channel: CHANNEL_NAMES[t.payChannel] || '',
        amountText: `${t.amountCents >= 0 ? '+' : '−'}${money(Math.abs(t.amountCents))}`,
        neg: t.amountCents < 0,
        isReversal: Boolean(t.reversalOf),
        isReversed: Boolean(reversedIds[t.id]),
        canReverse: !t.reversalOf && !reversedIds[t.id]
      }))
      this.setData({
        sum: { income: money(s.incomeCents), expense: money(s.expenseCents), net: money(s.netCents) },
        rows,
        loading: false
      })
    } catch (err) {
      this.setData({ loading: false })
      if (err && err.code === 'FINANCE_LOCKED') {
        api.clearFinanceKey()
        wx.showToast({ title: '财务会话过期,请回财务页解锁', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 600)
      } else {
        wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' })
      }
    }
  },

  reverse(e) {
    const { id, cat, amount } = e.currentTarget.dataset
    wx.showModal({
      title: '红字冲销',
      content: `冲销「${cat} ${amount}」?将生成一笔等额红字更正,原单保留可查,不可撤销。`,
      confirmText: '冲销',
      confirmColor: '#c0392b',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await api.adminPost(`/admin/finance/transactions/${id}/reverse`, {})
          wx.showToast({ title: '已生成冲销单', icon: 'success' })
          this.load()
        } catch (err) {
          wx.showToast({ title: (err && err.message) || '冲销失败', icon: 'none' })
        }
      }
    })
  },

  toEntry() { wx.redirectTo({ url: '/pages/merchant/finance-entry/index' }) }
})
