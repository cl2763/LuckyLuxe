const api = require('../../../utils/api')

const STATUS_MAP = {
  CONFIRMED: { label: '待到店', cls: 'g' },
  PENDING_PAYMENT: { label: '待付定金', cls: 'n' },
  PENDING_DEPOSIT: { label: '待付定金', cls: 'n' },
  IN_PROGRESS: { label: '进行中', cls: 's' },
  SERVING: { label: '进行中', cls: 's' },
  COMPLETED: { label: '已完成', cls: 's' },
  DONE: { label: '已完成', cls: 's' },
  CANCELLED: { label: '已取消', cls: 'n' },
  CANCELED: { label: '已取消', cls: 'n' },
  PENDING_QUOTE: { label: '待报价', cls: 'd' },
  PENDING_STAFF: { label: '待报价', cls: 'd' }
}

function pad(n) { return `${n}`.padStart(2, '0') }
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
function weekday(dateStr) { const d = new Date(`${dateStr}T00:00:00`); return '日一二三四五六'[d.getDay()] }

function vm(b) {
  const s = STATUS_MAP[b.status] || { label: b.status || '-', cls: 'n' }
  const service = (b.service && b.service.name) || b.serviceName || '服务'
  const customer = b.customerName || b.userName || (b.customer && b.customer.name) || (b.user && b.user.displayName) || '顾客'
  const tech = b.technicianName || (b.technician && b.technician.name) || ''
  const dur = b.totalDurationMin ? `${(b.totalDurationMin / 60).toFixed(1).replace('.0', '')}h` : ''
  const hasImg = Array.isArray(b.referenceImages) && b.referenceImages.length > 0
  return {
    id: b.id,
    status: b.status,
    date: b.appointmentDate || '',
    time: b.appointmentTime || '',
    statusLabel: s.label,
    statusCls: s.cls,
    customer,
    tech,
    thumb: hasImg ? b.referenceImages[0] : '',
    line: [service, dur].filter(Boolean).join(' · ')
  }
}

Page({
  data: {
    mode: 'today',
    raw: [],
    todayText: '',
    todayList: [],
    filter: 'all',
    filters: ['all', 'PENDING_STAFF', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
    filterLabels: { all: '全部', PENDING_STAFF: '待报价', CONFIRMED: '待到店', IN_PROGRESS: '进行中', COMPLETED: '已完成', CANCELLED: '已取消' },
    groups: [],
    calYear: 0,
    calMonth: 0,
    monthText: '',
    weekHead: ['一', '二', '三', '四', '五', '六', '日'],
    cells: [],
    selectedDate: '',
    selectedText: '',
    selectedList: []
  },

  onShow() { this.load() },

  async load() {
    try {
      const r = await api.adminGet('/admin/bookings')
      const raw = (r.bookings || [])
      const t = todayStr()
      this.setData({ raw, selectedDate: t })
      this.buildToday(raw)
      this.buildAll(raw)
      const d = new Date()
      this.buildCalendar(d.getFullYear(), d.getMonth())
      this.buildSelected(t)
    } catch (e) {
      wx.showToast({ title: '加载订单失败', icon: 'none' })
    }
  },

  buildToday(raw) {
    const t = todayStr()
    const list = raw.filter((b) => b.appointmentDate === t).map(vm).sort((a, b) => a.time.localeCompare(b.time))
    const d = new Date()
    this.setData({ todayText: `${d.getMonth() + 1}月${d.getDate()}日 周${weekday(t)} · ${list.length} 单`, todayList: list })
  },

  buildAll(raw) {
    const f = this.data.filter
    const target = (STATUS_MAP[f] || {}).label
    const filtered = f === 'all' ? raw : raw.filter((b) => (STATUS_MAP[b.status] || {}).label === target)
    const map = {}
    filtered.map(vm).forEach((v) => { (map[v.date] = map[v.date] || []).push(v) })
    const groups = Object.keys(map).sort((a, b) => b.localeCompare(a)).map((date) => ({
      date, title: `${date.slice(5).replace('-', '月')}日 周${weekday(date)}`, items: map[date].sort((a, b) => a.time.localeCompare(b.time))
    }))
    this.setData({ groups })
  },

  buildCalendar(year, month) {
    const raw = this.data.raw
    const counts = {}
    raw.forEach((b) => { if (b.appointmentDate) counts[b.appointmentDate] = (counts[b.appointmentDate] || 0) + 1 })
    const first = new Date(year, month, 1)
    let offset = first.getDay() - 1; if (offset < 0) offset = 6
    const dim = new Date(year, month + 1, 0).getDate()
    const cells = []
    for (let i = 0; i < offset; i += 1) cells.push({ blank: true, key: `b${i}` })
    for (let day = 1; day <= dim; day += 1) {
      const ds = `${year}-${pad(month + 1)}-${pad(day)}`
      cells.push({ blank: false, key: ds, day, date: ds, count: counts[ds] || 0, sel: ds === this.data.selectedDate })
    }
    this.setData({ calYear: year, calMonth: month, monthText: `${year}年${month + 1}月`, cells })
  },

  prevMonth() { let y = this.data.calYear; let m = this.data.calMonth - 1; if (m < 0) { m = 11; y -= 1 } this.buildCalendar(y, m) },
  nextMonth() { let y = this.data.calYear; let m = this.data.calMonth + 1; if (m > 11) { m = 0; y += 1 } this.buildCalendar(y, m) },

  buildSelected(ds) {
    const list = this.data.raw.filter((b) => b.appointmentDate === ds).map(vm).sort((a, b) => a.time.localeCompare(b.time))
    this.setData({ selectedList: list, selectedText: ds ? `${ds} 周${weekday(ds)} · ${list.length} 单` : '' })
  },

  statusActions(status) {
    if (status === 'PENDING_PAYMENT') return [{ label: '确认到店', s: 'CONFIRMED' }, { label: '取消预约', s: 'CANCELLED' }]
    if (status === 'CONFIRMED') return [{ label: '标记完成', s: 'COMPLETED' }, { label: '取消预约', s: 'CANCELLED' }]
    if (status === 'COMPLETED') return [{ label: '转售后', s: 'AFTER_SALES' }]
    return []
  },

  orderActions(e) {
    const { id, status } = e.currentTarget.dataset
    const opts = this.statusActions(status)
    if (!opts.length) { wx.showToast({ title: '该状态暂无可改操作', icon: 'none' }); return }
    wx.showActionSheet({
      itemList: opts.map((o) => o.label),
      success: (r) => { if (r.tapIndex >= 0) this.applyStatus(id, opts[r.tapIndex]) }
    })
  },

  applyStatus(id, o) {
    const doIt = async () => {
      try {
        await api.adminPatch(`/admin/bookings/${encodeURIComponent(id)}/status`, { status: o.s })
        wx.showToast({ title: '已更新', icon: 'none' })
        this.load()
      } catch (err) { wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' }) }
    }
    if (o.s === 'COMPLETED') { wx.showModal({ title: '标记完成', content: '确认该单已完成?完成后自动确认收入入账。', success: (r) => { if (r.confirm) doIt() } }); return }
    if (o.s === 'CANCELLED') { wx.showModal({ title: '取消预约', content: '确认取消?将释放该时段;若已入账会自动冲销。', success: (r) => { if (r.confirm) doIt() } }); return }
    doIt()
  },

  switchMode(e) { this.setData({ mode: e.currentTarget.dataset.m }) },
  setFilter(e) { this.setData({ filter: e.currentTarget.dataset.f }, () => this.buildAll(this.data.raw)) },
  pickDay(e) {
    const ds = e.currentTarget.dataset.d
    if (!ds) return
    const cells = this.data.cells.map((c) => Object.assign({}, c, { sel: c.date === ds }))
    this.setData({ cells, selectedDate: ds })
    this.buildSelected(ds)
  }
})
