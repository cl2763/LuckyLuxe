const api = require('../../../utils/api')
const { storeMoney } = require('../../../utils/storeclock')

Page({
  data: { booking: null, loading: true, error: '', snapViewer: { open: false, items: [], index: 0 } },
  onLoad(q) { this.bookingId = decodeURIComponent(q.id || '') },
  onShow() { this.load() },
  async load() {
    if (!api.guardMerchant()) return
    this.setData({ loading: true, error: '' })
    try {
      const r = await api.adminGet(`/admin/bookings/${encodeURIComponent(this.bookingId)}`)
      const b = r.booking
      if (!b) throw new Error('找不到这张订单，或当前账号无权查看')
      const signed = Boolean(b.payment)
      this.setData({
        booking: {
          id: b.id,
          code: b.publicCode || '',
          customer: (b.user && b.user.display_name) || '顾客',
          service: (b.service && b.service.name) || '服务',
          date: b.appointmentDate || '',
          time: b.appointmentTime || '',
          end: b.appointmentEndTime || '',
          technician: b.technicianName || (b.technician && b.technician.name) || '',
          status: b.status === 'COMPLETED' && !signed ? '服务结束 · 待结算' : (b.statusText || b.status || ''),
          signed,
          amountLabel: signed ? '签署单到店支付' : '预约标价（未结算）',
          amount: signed ? (b.payment.groupCashDueText || b.payment.flow?.cashDueText || '—') : storeMoney(b.servicePriceCents, 2),
          signedAt: signed ? (b.payment.signedAt || '') : '',
          settlementCode: signed ? (b.payment.code || '') : '',
          source: b.sourceText || '',
          notes: b.notes || ''
        },
        loading: false
      })
    } catch (e) { this.setData({ loading: false, error: e.message || '订单加载失败' }) }
  },
  async openDocument() {
    const code = this.data.booking?.settlementCode
    if (!code) return
    try {
      const r = await api.adminGet(`/admin/settlements/${encodeURIComponent(code)}/snapshots`)
      const items = (r.sheets || []).filter((s) => s.snapshotUrl)
        .map((s) => ({ code: s.code, label: s.label, url: `${api.API_BASE}${s.snapshotUrl}` }))
      if (!items.length) throw new Error('这单还没有签署原件')
      this.setData({ snapViewer: { open: true, items, index: Math.max(0, items.findIndex((s) => s.code === code)) } })
    } catch (e) { wx.showToast({ title: e.message || '打开原件失败', icon: 'none' }) }
  },
  closeSnapViewer() {
    this.setData({ snapViewer: { open: false, items: [], index: 0 } })
  }
})
