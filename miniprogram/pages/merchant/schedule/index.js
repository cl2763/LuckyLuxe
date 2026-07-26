const api = require('../../../utils/api')

function pad(n) { return `${n}`.padStart(2, '0') }
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
function todayStr() { return ymd(new Date()) }
function addDays(dateStr, n) { const d = new Date(`${dateStr}T00:00:00`); d.setDate(d.getDate() + n); return ymd(d) }
function mondayOf(d) { const x = new Date(d); const wd = x.getDay(); const off = wd === 0 ? -6 : 1 - wd; x.setDate(x.getDate() + off); return x }
const WK = ['日', '一', '二', '三', '四', '五', '六']

const PX_PER_HOUR = 120 // 单位 rpx:与 wxss 中 .dv-hr / .dv-line 的 120rpx 对齐
function toMin(t) { const p = String(t || '0:0').split(':'); return Number(p[0]) * 60 + Number(p[1] || 0) }
function typeCls(t) { const u = String(t || '').toUpperCase(); return u === 'NAIL' ? 'nail' : u === 'LASH' ? 'lash' : 'care' }

Page({
  data: {
    role: 'owner',
    viewMode: 'tech', // 'tech' 技师维度日视图(默认) | 'month' 月历排班
    calYear: 0, calMonth: 0, monthText: '',
    weekHead: ['一', '二', '三', '四', '五', '六', '日'],
    cells: [],
    selDate: '', selText: '',
    rows: [],
    dayBookings: [],
    requests: [],
    schedMap: {}, dayInfo: {}, techs: [], allBookings: [],
    sheet: false, sheetMode: 'work', sheetStart: '10:00', sheetEnd: '19:00', sheetSel: {},
    dv: null // 技师维度日视图数据
  },

  onShow() {
    if (this.data.viewMode === 'tech') {
      this.loadDayView(this.data.selDate || todayStr())
    } else if (this.data.calYear) {
      this.loadMonth(this.data.calYear, this.data.calMonth)
    } else {
      const d = new Date(); this.loadMonth(d.getFullYear(), d.getMonth())
    }
  },

  switchView(e) {
    const mode = e.currentTarget.dataset.m
    if (mode === this.data.viewMode) return
    this.setData({ viewMode: mode })
    if (mode === 'tech') this.loadDayView(this.data.selDate || todayStr())
    else { const d = this.data.selDate ? new Date(`${this.data.selDate}T00:00:00`) : new Date(); this.loadMonth(d.getFullYear(), d.getMonth()) }
  },

  // ===== 技师维度·日视图 =====
  async loadDayView(date) {
    try {
      const me = await api.adminMe().catch(() => ({ role: 'owner' }))
      const r = await api.adminGet(`/admin/schedule-day?date=${date}`)
      const openMin = toMin(r.openTime || '10:00')
      const closeMin = toMin(r.closeTime || '19:00')
      const span = Math.max(60, closeMin - openMin)
      const gridH = Math.round(span / 60 * PX_PER_HOUR)
      // 时间刻度
      const hours = []
      for (let m = Math.floor(openMin / 60) * 60; m < closeMin; m += 60) {
        hours.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:00`)
      }
      const byTech = {}
      ;(r.bookings || []).forEach((b) => { (byTech[b.technicianId] = byTech[b.technicianId] || []).push(b) })
      let freeTotal = 0
      const cols = (r.technicians || []).map((t) => {
        const list = (byTech[t.id] || []).slice().sort((a, b) => toMin(a.startTime) - toMin(b.startTime))
        const blocks = list.map((b) => {
          const s = toMin(b.startTime); const e = Math.max(s + 20, toMin(b.endTime))
          const group = b.group || typeCls(b.serviceType) // 色相:hand/foot/lash/care
          const state = b.arrivalState || 'pending'         // 到店态:pending/active/done
          return {
            id: b.id,
            cls: `${group} ${state}`, // 色相 + 到店态一起给 class
            state,
            stateGlyph: state === 'active' ? '●' : (state === 'done' ? '✓' : ''),
            top: Math.round((s - openMin) / 60 * PX_PER_HOUR),
            height: Math.max(34, Math.round((e - s) / 60 * PX_PER_HOUR)),
            startTime: b.startTime, endTime: b.endTime,
            customerName: b.customerName, serviceName: b.serviceName,
            isNewCustomer: b.isNewCustomer, isDesignated: b.isDesignated
          }
        })
        // 空档:营业时段内、预约之间的空隙(>=30min)
        const frees = []
        let cursor = openMin
        list.forEach((b) => {
          const s = toMin(b.startTime)
          if (s - cursor >= 30) { frees.push({ startTime: `${String(Math.floor(cursor / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`, top: Math.round((cursor - openMin) / 60 * PX_PER_HOUR), height: Math.round((s - cursor) / 60 * PX_PER_HOUR) }); freeTotal += (s - cursor) }
          cursor = Math.max(cursor, toMin(b.endTime))
        })
        if (closeMin - cursor >= 30) { frees.push({ startTime: `${String(Math.floor(cursor / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`, top: Math.round((cursor - openMin) / 60 * PX_PER_HOUR), height: Math.round((closeMin - cursor) / 60 * PX_PER_HOUR) }); freeTotal += (closeMin - cursor) }
        return { id: t.id, name: t.name, role: t.title || '', busy: t.bookingCount > 0, count: t.bookingCount, blocks, frees }
      })
      const d = new Date(`${date}T00:00:00`)
      this.setData({
        role: me.role || 'owner', selDate: date,
        dv: {
          date, dateText: `${d.getMonth() + 1}月${d.getDate()}日 周${WK[d.getDay()]}`,
          isClosed: r.isClosed, specialNote: r.specialNote || '',
          openTime: r.openTime, closeTime: r.closeTime,
          gridH, colW: 190, hours,
          total: (r.bookings || []).length,
          working: cols.length,
          freeHours: Math.round(freeTotal / 60 * 10) / 10,
          activeCount: r.activeCount || 0, // 在做人数(到店进行中)
          cols
        }
      })
    } catch (e) { wx.showToast({ title: '加载排班失败', icon: 'none' }) }
  },

  dvPrev() { this.loadDayView(addDays(this.data.selDate || todayStr(), -1)) },
  dvNext() { this.loadDayView(addDays(this.data.selDate || todayStr(), 1)) },
  dvToday() { this.loadDayView(todayStr()) },

  tapBlock(e) {
    const id = e.currentTarget.dataset.id
    let b = null
    ;(this.data.dv.cols || []).forEach((c) => { const hit = (c.blocks || []).find((x) => x.id === id); if (hit) b = Object.assign({}, hit, { tech: c.name }) })
    if (!b) return
    if (this.data.role !== 'owner') {
      // 员工只看详情
      wx.showModal({ title: b.customerName, content: `${b.startTime}–${b.endTime} · ${b.serviceName} · ${b.tech}`, showCancel: false, confirmText: '知道了' })
      return
    }
    // 到店态动作单:随状态给不同选项
    const items = []
    const actions = []
    if (b.state !== 'active') { items.push('✔ 标记到店(开始服务)'); actions.push('arrive') }
    if (b.state !== 'done') { items.push('✓ 标记完成'); actions.push('complete') }
    if (b.state === 'active') { items.push('↩ 改回未到店'); actions.push('unarrive') }
    items.push('📄 查看订单详情'); actions.push('detail')
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const act = actions[res.tapIndex]
        if (act === 'arrive') this.setArrival(b.id, true)
        else if (act === 'unarrive') this.setArrival(b.id, false)
        else if (act === 'complete') this.setCompleted(b.id)
        else if (act === 'detail') wx.switchTab({ url: '/pages/merchant/home/index' })
      }
    })
  },

  async setArrival(id, arrived) {
    try {
      await api.adminPatch(`/admin/bookings/${encodeURIComponent(id)}/arrival`, { arrived })
      wx.showToast({ title: arrived ? '已到店' : '已改回未到', icon: 'none' })
      this.loadDayView(this.data.selDate)
    } catch (err) { wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' }) }
  },

  async setCompleted(id) {
    try {
      await api.adminPatch(`/admin/bookings/${encodeURIComponent(id)}/status`, { status: 'COMPLETED' })
      wx.showToast({ title: '已完成', icon: 'none' })
      this.loadDayView(this.data.selDate)
    } catch (err) { wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' }) }
  },

  tapFree(e) {
    const { tech, time } = e.currentTarget.dataset
    wx.showToast({ title: `${time} 可约(建单开发中)`, icon: 'none' })
  },

  shareSchedule() {
    wx.showModal({
      title: '分享排班表', showCancel: false, confirmText: '知道了',
      content: '把当前排满的排班表截屏,发朋友圈/群做宣传——满屏预约=火爆。\niPhone:侧边键+音量上;安卓:电源+音量下。'
    })
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
