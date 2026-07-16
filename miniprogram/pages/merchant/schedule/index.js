const api = require('../../../utils/api')

function pad(n) { return `${n}`.padStart(2, '0') }
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
function todayStr() { return ymd(new Date()) }
function addDays(dateStr, n) { const d = new Date(`${dateStr}T00:00:00`); d.setDate(d.getDate() + n); return ymd(d) }
function mondayOf(d) { const x = new Date(d); const wd = x.getDay(); const off = wd === 0 ? -6 : 1 - wd; x.setDate(x.getDate() + off); return x }
const WK = ['日', '一', '二', '三', '四', '五', '六']

Page({
  data: {
    role: 'owner',
    calYear: 0, calMonth: 0, monthText: '',
    weekHead: ['一', '二', '三', '四', '五', '六', '日'],
    cells: [],
    selDate: '', selText: '',
    rows: [],
    dayBookings: [],
    requests: [],
    schedMap: {}, dayInfo: {}, techs: [], allBookings: [],
    sheet: false, sheetMode: 'work', sheetStart: '10:00', sheetEnd: '19:00', sheetSel: {}
  },

  onShow() {
    if (this.data.calYear) { this.loadMonth(this.data.calYear, this.data.calMonth) }
    else { const d = new Date(); this.loadMonth(d.getFullYear(), d.getMonth()) }
  },

  async loadMonth(year, month) {
    try {
      const me = await api.adminMe().catch(() => ({ role: 'owner' }))
      // 覆盖本月的所有周一
      const first = new Date(year, month, 1)
      const last = new Date(year, month + 1, 0)
      const mondays = []
      for (let m = mondayOf(first); m <= last; m.setDate(m.getDate() + 7)) mondays.push(ymd(m))
      const weeks = await Promise.all(mondays.map((mo) => api.adminGet(`/admin/schedule-week?from=${mo}`).catch(() => ({}))))
      const schedMap = {}
      const countMap = {}
      const closedMap = {}
      let techs = this.data.techs
      weeks.forEach((r) => {
        ;(r.schedules || []).forEach((s) => { schedMap[`${s.technicianId}|${s.date}`] = s })
        ;(r.bookingCounts || []).forEach((c) => { countMap[c.date] = (countMap[c.date] || 0) + c.count })
        ;(r.days || []).forEach((d) => { closedMap[d.date] = d.isClosed })
        if (r.technicians && r.technicians.length) techs = r.technicians
      })
      // 每日上班人数
      const dayInfo = {}
      Object.keys(schedMap).forEach((k) => {
        const s = schedMap[k]
        if (!dayInfo[s.date]) dayInfo[s.date] = { working: 0 }
        if (s.isWorking) dayInfo[s.date].working += 1
      })
      Object.keys(closedMap).forEach((d) => { dayInfo[d] = Object.assign({ working: 0 }, dayInfo[d], { closed: closedMap[d] }) })

      let selDate = this.data.selDate
      const inMonth = selDate && selDate.slice(0, 7) === `${year}-${pad(month + 1)}`
      if (!inMonth) { const t = todayStr(); selDate = (t.slice(0, 7) === `${year}-${pad(month + 1)}`) ? t : `${year}-${pad(month + 1)}-01` }

      const bk = await api.adminGet('/admin/bookings').catch(() => ({ bookings: [] }))
      this.setData({ role: me.role || 'owner', techs, schedMap, dayInfo, selDate, allBookings: bk.bookings || [] })
      this.buildCalendar(year, month)
      this.buildRows()
      this.buildDayBookings()
      this.loadRequests()
    } catch (e) { wx.showToast({ title: '加载排班失败', icon: 'none' }) }
  },

  buildCalendar(year, month) {
    const dayInfo = this.data.dayInfo
    const first = new Date(year, month, 1)
    let offset = first.getDay() - 1; if (offset < 0) offset = 6
    const dim = new Date(year, month + 1, 0).getDate()
    const cells = []
    for (let i = 0; i < offset; i += 1) cells.push({ blank: true, key: `b${i}` })
    for (let day = 1; day <= dim; day += 1) {
      const ds = `${year}-${pad(month + 1)}-${pad(day)}`
      const info = dayInfo[ds] || {}
      cells.push({ blank: false, key: ds, day, date: ds, working: info.working || 0, closed: !!info.closed, sel: ds === this.data.selDate })
    }
    this.setData({ calYear: year, calMonth: month, monthText: `${year}年${month + 1}月`, cells })
  },

  buildRows() {
    const { techs, schedMap, selDate } = this.data
    const rows = techs.map((t) => {
      const s = schedMap[`${t.id}|${selDate}`]
      return {
        techId: t.id, name: t.name, av: (t.name || '?').slice(0, 1),
        noRecord: !s, isWorking: s ? s.isWorking : false,
        startTime: (s && s.startTime) || '10:00', endTime: (s && s.endTime) || '19:00'
      }
    })
    const d = new Date(`${selDate}T00:00:00`)
    this.setData({ rows, selText: `${d.getMonth() + 1}月${d.getDate()}日 周${WK[d.getDay()]} 排班` })
  },

  buildDayBookings() {
    const ST = { PENDING_PAYMENT: '待付定金', CONFIRMED: '待到店', COMPLETED: '已完成', CANCELLED: '已取消', EXPIRED: '已过期', AFTER_SALES: '售后' }
    const list = (this.data.allBookings || [])
      .filter((b) => b.appointmentDate === this.data.selDate && !['CANCELLED', 'EXPIRED'].includes(b.status))
      .map((b) => ({
        id: b.id,
        time: b.appointmentTime || '',
        customer: (b.user && b.user.display_name) || '顾客',
        service: (b.service && b.service.name) || '服务',
        tech: (b.technician && b.technician.name) || b.technicianName || '',
        status: ST[b.status] || b.status,
        care: (b.customerCare && (b.customerCare.tags || [])[0]) || ''
      }))
      .sort((a, b) => a.time.localeCompare(b.time))
    this.setData({ dayBookings: list })
  },

  async loadRequests() {
    try {
      const r = await api.adminGet('/admin/schedule-requests')
      this.setData({ requests: (r.requests || []).filter((x) => x.status === 'pending') })
    } catch (e) { /* 忽略 */ }
  },

  prevMonth() { let y = this.data.calYear; let m = this.data.calMonth - 1; if (m < 0) { m = 11; y -= 1 } this.loadMonth(y, m) },
  nextMonth() { let y = this.data.calYear; let m = this.data.calMonth + 1; if (m > 11) { m = 0; y += 1 } this.loadMonth(y, m) },

  pickDay(e) {
    const ds = e.currentTarget.dataset.d
    if (!ds) return
    const cells = this.data.cells.map((c) => Object.assign({}, c, { sel: c.date === ds }))
    this.setData({ cells, selDate: ds })
    this.buildRows()
    this.buildDayBookings()
  },

  async saveOne(techId, isWorking, startTime, endTime) {
    if (this.data.role !== 'owner') { wx.showToast({ title: '仅老板可改排班', icon: 'none' }); return false }
    try {
      await api.adminPost('/admin/schedule-batch', { entries: [{ technicianId: techId, date: this.data.selDate, startTime, endTime, isWorking }] })
      const key = `${techId}|${this.data.selDate}`
      const schedMap = Object.assign({}, this.data.schedMap, { [key]: { technicianId: techId, date: this.data.selDate, startTime, endTime, isWorking } })
      this.setData({ schedMap })
      this.recomputeDay(this.data.selDate)
      this.buildRows()
      return true
    } catch (err) { wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' }); return false }
  },

  recomputeDay(date) {
    let working = 0
    this.data.techs.forEach((t) => { const s = this.data.schedMap[`${t.id}|${date}`]; if (s && s.isWorking) working += 1 })
    const dayInfo = Object.assign({}, this.data.dayInfo, { [date]: Object.assign({}, this.data.dayInfo[date], { working }) })
    const cells = this.data.cells.map((c) => c.date === date ? Object.assign({}, c, { working }) : c)
    this.setData({ dayInfo, cells })
  },

  toggleWork(e) { const row = this.data.rows[e.currentTarget.dataset.i]; this.saveOne(row.techId, !row.isWorking, row.startTime, row.endTime) },
  onStart(e) { const row = this.data.rows[e.currentTarget.dataset.i]; this.saveOne(row.techId, true, e.detail.value, row.endTime) },
  onEnd(e) { const row = this.data.rows[e.currentTarget.dataset.i]; this.saveOne(row.techId, true, row.startTime, e.detail.value) },

  openSheet() { if (this.data.role !== 'owner') { wx.showToast({ title: '仅老板可改排班', icon: 'none' }); return } this.setData({ sheet: true, sheetSel: {} }) },
  closeSheet() { this.setData({ sheet: false }) },
  sheetToggleTech(e) { const id = e.currentTarget.dataset.id; const sel = Object.assign({}, this.data.sheetSel); if (sel[id]) delete sel[id]; else sel[id] = true; this.setData({ sheetSel: sel }) },
  sheetMode(e) { this.setData({ sheetMode: e.currentTarget.dataset.m }) },
  sheetStartChange(e) { this.setData({ sheetStart: e.detail.value }) },
  sheetEndChange(e) { this.setData({ sheetEnd: e.detail.value }) },
  async sheetApply() {
    const ids = Object.keys(this.data.sheetSel)
    if (!ids.length) { wx.showToast({ title: '请选择员工', icon: 'none' }); return }
    const working = this.data.sheetMode === 'work'
    const entries = ids.map((id) => ({ technicianId: id, date: this.data.selDate, startTime: this.data.sheetStart, endTime: this.data.sheetEnd, isWorking: working }))
    try {
      await api.adminPost('/admin/schedule-batch', { entries })
      wx.showToast({ title: `已应用 ${ids.length} 人`, icon: 'none' })
      this.setData({ sheet: false })
      this.loadMonth(this.data.calYear, this.data.calMonth)
    } catch (err) { wx.showToast({ title: (err && err.message) || '应用失败', icon: 'none' }) }
  },

  applyFuture() {
    wx.showModal({
      title: '套用本周模式', content: '把选中日所在周每位技师的上/休与时段,复制到未来 4 周。已有安排会被覆盖。', confirmText: '套用',
      success: async (res) => {
        if (!res.confirm) return
        const wkStart = ymd(mondayOf(new Date(`${this.data.selDate}T00:00:00`)))
        const entries = []
        this.data.techs.forEach((t) => {
          for (let i = 0; i < 7; i += 1) {
            const d = addDays(wkStart, i)
            const s = this.data.schedMap[`${t.id}|${d}`]
            if (!s) continue
            for (let w = 1; w <= 4; w += 1) entries.push({ technicianId: t.id, date: addDays(d, 7 * w), startTime: s.startTime, endTime: s.endTime, isWorking: s.isWorking })
          }
        })
        if (!entries.length) { wx.showToast({ title: '这周还没有排班', icon: 'none' }); return }
        try {
          await api.adminPost('/admin/schedule-batch', { entries })
          wx.showToast({ title: `已套用 ${entries.length} 条`, icon: 'none' })
          this.loadMonth(this.data.calYear, this.data.calMonth)
        } catch (err) { wx.showToast({ title: (err && err.message) || '套用失败', icon: 'none' }) }
      }
    })
  },

  async resolveReq(e) {
    const { id, action } = e.currentTarget.dataset
    try {
      await api.adminPost(`/admin/schedule-requests/${encodeURIComponent(id)}/${action}`, {})
      wx.showToast({ title: '已处理', icon: 'none' })
      this.loadMonth(this.data.calYear, this.data.calMonth)
    } catch (err) { wx.showToast({ title: (err && err.message) || '处理失败', icon: 'none' }) }
  }
})
