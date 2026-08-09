const api = require('../../../utils/api')
const { storeToday, refreshStoreClock } = require('../../../utils/storeclock')
// 屏 1:日结就长在今日台面下面(设计图把它画在技师网格正下方),渲染与逻辑走同一份 mixin
const { dailyCloseData, dailyCloseMixin } = require('../../../utils/dailyclose')

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
  AFTER_SALES: { label: '售后', cls: 'd' },
  PENDING_QUOTE: { label: '待报价', cls: 'd' },
  PENDING_STAFF: { label: '待报价', cls: 'd' }
}

function pad(n) { return `${n}`.padStart(2, '0') }
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
// 「今天」按门店时区算,不用设备时钟(店在多伦多、人在国内时两者会差一天)
function todayStr() { return storeToday() }
function addDays(dateStr, n) { const d = new Date(`${dateStr}T00:00:00`); d.setDate(d.getDate() + n); return ymd(d) }
function weekday(dateStr) { const d = new Date(`${dateStr}T00:00:00`); return '日一二三四五六'[d.getDay()] }
const WK = ['日', '一', '二', '三', '四', '五', '六']
const PX_PER_HOUR = 120
function toMin(t) { const p = String(t || '0:0').split(':'); return Number(p[0]) * 60 + Number(p[1] || 0) }
function m2t(m) { return `${pad(Math.floor(m / 60))}:${pad(m % 60)}` }
function typeCls(t) { const u = String(t || '').toUpperCase(); return u === 'NAIL' ? 'hand' : u === 'LASH' ? 'lash' : 'care' }

function vm(b) {
  const s = STATUS_MAP[b.status] || { label: b.status || '-', cls: 'n' }
  const service = (b.service && b.service.name) || b.serviceName || '服务'
  const customer = b.customerName || b.userName || (b.customer && b.customer.name) || (b.user && b.user.displayName) || (b.user && b.user.display_name) || '顾客'
  const tech = b.technicianName || (b.technician && b.technician.name) || ''
  const dur = b.totalDurationMin ? `${(b.totalDurationMin / 60).toFixed(1).replace('.0', '')}h` : ''
  const hasImg = Array.isArray(b.referenceImages) && b.referenceImages.length > 0
  return {
    id: b.id, status: b.status, date: b.appointmentDate || '', time: b.appointmentTime || '',
    statusLabel: s.label, statusCls: s.cls, customer, tech,
    userId: b.userId || (b.user && (b.user.id || b.user.sub)) || '',
    serviceId: b.serviceId || (b.service && b.service.id) || '', serviceName: service,
    thumb: hasImg ? b.referenceImages[0] : '',
    line: [service, dur].filter(Boolean).join(' · ')
  }
}

Page(Object.assign({
  data: {
    mode: 'today', // today 今日台面 | all 全部订单 | aftersales 售后订单
    role: 'owner',
    raw: [],
    // 全部
    filter: 'all',
    filters: ['all', 'PENDING_STAFF', 'CONFIRMED', 'COMPLETED', 'CANCELLED'],
    filterLabels: { all: '全部', PENDING_STAFF: '待报价', CONFIRMED: '待到店', COMPLETED: '已完成', CANCELLED: '已取消' },
    groups: [],
    aftersalesList: [],
    // 今日台面(技师维度日视图)
    selDate: '',
    dv: null,
    // 直接排单
    directSheet: false, directTech: '', directTechName: '', directTime: '', directEndTime: '', directDurH: 0, directServices: [], directServiceId: '', directDurationMin: 120, directDeposit: false,
    // 顾客搜索选择
    directCustomers: [], custQuery: '', custMatches: [], selectedCustId: '', selectedCustName: '',
    myTechId: '', // 员工登录时高亮自己那列
    isOwner: false,
    actPanel: null, // 屏 0 操作面板(自建弹层)
    ...dailyCloseData // 日结板块的状态(date/v/open/shares/correcting…)
  },

  onShow() {
    if (!api.guardMerchant()) return
    refreshStoreClock().catch(() => {})
    this.setData({ isOwner: api.isOwner() })
    if (this.data.mode === 'today') this.loadDayView(this.data.selDate || todayStr())
    else this.loadList()
  },

  switchMode(e) {
    const m = e.currentTarget.dataset.m
    this.setData({ mode: m })
    if (m === 'today') this.loadDayView(this.data.selDate || todayStr())
    else this.loadList()
  },

  // ===== 全部订单 / 售后订单 =====
  async loadList() {
    try {
      const r = await api.adminGet('/admin/bookings')
      const raw = r.bookings || []
      this.setData({ raw })
      this.buildAll(raw)
      this.setData({ aftersalesList: raw.filter((b) => b.status === 'AFTER_SALES').map(vm).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)) })
    } catch (e) { wx.showToast({ title: '加载订单失败', icon: 'none' }) }
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
  setFilter(e) { this.setData({ filter: e.currentTarget.dataset.f }, () => this.buildAll(this.data.raw)) },
  /* 屏 0｜结算入口。按订单状态给按钮,按钮一律纯文字(无 emoji)。
     「标记完成」已退役 —— COMPLETED 由顾客签署驱动,不再手动标。 */
  async orderActions(e) {
    const { id, status, userid, customer, service, tech } = e.currentTarget.dataset
    const ctx = { id, userId: userid, customerName: customer, serviceId: e.currentTarget.dataset.serviceid || '', serviceName: service, tech }
    const sheets = await this.settlementsOf(id)
    const pending = sheets.filter((s) => s.status === 'pending_sign')
    const opts = []
    if (status === 'PENDING_PAYMENT' || status === 'PENDING_DEPOSIT') {
      opts.push({ label: '确认到店', s: 'CONFIRMED' }, { label: '取消预约', s: 'CANCELLED' })
    } else if (status === 'CONFIRMED' || status === 'IN_PROGRESS' || status === 'SERVING') {
      if (pending.length) {
        opts.push({ label: `查看结算单（待签 ${pending.length} 张）`, sheets: true })
        // 屏 0:待签状态可撤回改单(只撤未签的;已签一律走金额更正)
        opts.push({ label: '撤回改单', voidSheets: pending })
      } else opts.push({ label: '去结算', settle: true })
      opts.push({ label: '取消预约', s: 'CANCELLED' })
    } else if (status === 'COMPLETED') {
      if (sheets.length) opts.push({ label: '查看电子票据', sheets: true })
      opts.push({ label: '转售后', s: 'AFTER_SALES' })
    }
    // 任何有顾客的订单都可补写服务小记
    if (userid) opts.push({ label: '写/补服务小记', note: true })
    if (!opts.length) { wx.showToast({ title: '该状态暂无可改操作', icon: 'none' }); return }
    // 屏 0:图上是一张自定义面板 —— 顶部一行订单摘要,下面按钮,底部「关闭」;不是系统 ActionSheet
    this._panelOpts = opts
    this._panelCtx = ctx
    this._panelSheets = sheets
    this.setData({
      actPanel: {
        title: `${ctx.customerName || '顾客'} · ${ctx.serviceName || ''} · ${(STATUS_MAP[status] || {}).label || ''}`,
        opts: opts.map((o, i) => ({ i, label: o.label }))
      }
    })
  },
  closeActPanel() { this.setData({ actPanel: null }) },
  tapAct(e) {
    const o = (this._panelOpts || [])[Number(e.currentTarget.dataset.i)]
    if (!o) return
    this.setData({ actPanel: null })
    const ctx = this._panelCtx
    if (o.note) this.goNote(ctx)
    else if (o.settle) this.goSettle(ctx)
    else if (o.voidSheets) this.voidSheets(o.voidSheets, ctx)
    else if (o.sheets) this.showSheets(this._panelSheets)
    else this.applyStatus(ctx.id, o.s)
  },
  /* 撤回改单:把这单还没签的结算单全撤掉,回到「去结算」状态重新开。
     已签的一张都不动 —— 已签不可改是硬规则,要改走金额更正链。 */
  voidSheets(pending, ctx) {
    wx.showModal({
      title: '撤回改单',
      content: `撤回 ${pending.length} 张待签结算单,回到未结算状态重新开单。已签的单不受影响;单上用掉的券会放回顾客券包。`,
      confirmText: '撤回',
      success: async (r) => {
        if (!r.confirm) return
        try {
          for (const sheet of pending) {
            await api.adminPost(`/admin/settlements/${encodeURIComponent(sheet.id)}/void`, {})
          }
          wx.showToast({ title: '已撤回,可以重新开单', icon: 'none' })
          this.goSettle(ctx)
        } catch (e) { wx.showToast({ title: (e && e.message) || '撤回失败', icon: 'none' }) }
      }
    })
  },

  // 这单已经推过几张结算单?待签几张?按钮文案照它渲染
  async settlementsOf(bookingId) {
    if (!bookingId) return []
    const r = await api.adminGet(`/admin/settlements?bookingId=${encodeURIComponent(bookingId)}`).catch(() => null)
    return (r && r.settlements) || []
  },
  goSettle(b) {
    if (!b.userId) { wx.showToast({ title: '这单没绑顾客,先补档案再结算', icon: 'none' }); return }
    wx.navigateTo({
      url: `/pages/merchant/settlement/index?bookingId=${encodeURIComponent(b.id)}&userId=${encodeURIComponent(b.userId)}&name=${encodeURIComponent(b.customerName || '')}&serviceId=${encodeURIComponent(b.serviceId || '')}`
    })
  },
  showSheets(sheets) {
    const zh = { pending_sign: '待签', signed: '已签', amended: '已更正' }
    wx.showModal({
      title: `结算单 ${sheets.length} 张`, showCancel: false, confirmText: '知道了',
      content: sheets.map((s) => `${s.code} · ${zh[s.status] || s.status}${s.servedPersonName ? ` · ${s.servedPersonName}` : ''}`).join('\n')
    })
  },
  applyStatus(id, s) {
    const doIt = async () => {
      try { await api.adminPatch(`/admin/bookings/${encodeURIComponent(id)}/status`, { status: s }); wx.showToast({ title: '已更新', icon: 'none' }); this.loadList() }
      catch (err) { wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' }) }
    }
    if (s === 'CANCELLED') { wx.showModal({ title: '取消预约', content: '确认取消?将释放该时段;若已入账会自动冲销。', success: (r) => { if (r.confirm) doIt() } }); return }
    doIt()
  },

  // ===== 今日台面:技师维度日视图(自排班原样搬来) =====
  async loadDayView(date) {
    try {
      const me = await api.adminMe().catch(() => ({ role: 'owner' }))
      const r = await api.adminGet(`/admin/schedule-day?date=${date}`)
      const openMin = toMin(r.openTime || '10:00'); const closeMin = toMin(r.closeTime || '19:00')
      const gridH = Math.round(Math.max(60, closeMin - openMin) / 60 * PX_PER_HOUR)
      const hours = []
      for (let m = Math.floor(openMin / 60) * 60; m < closeMin; m += 60) hours.push(`${pad(Math.floor(m / 60))}:00`)
      const byTech = {}
      ;(r.bookings || []).forEach((b) => { (byTech[b.technicianId] = byTech[b.technicianId] || []).push(b) })
      let freeTotal = 0
      const cols = (r.technicians || []).map((t) => {
        const list = (byTech[t.id] || []).slice().sort((a, b) => toMin(a.startTime) - toMin(b.startTime))
        const blocks = list.map((b) => {
          const s = toMin(b.startTime); const e = Math.max(s + 20, toMin(b.endTime))
          const group = b.group || typeCls(b.serviceType); const state = b.arrivalState || 'pending'
          return {
            id: b.id, userId: b.userId || '', cls: `${group} ${state}`, state,
            stateGlyph: state === 'active' ? '●' : (state === 'done' ? '✓' : ''),
            top: Math.round((s - openMin) / 60 * PX_PER_HOUR), height: Math.max(34, Math.round((e - s) / 60 * PX_PER_HOUR)),
            startTime: b.startTime, endTime: b.endTime, customerName: b.customerName,
            serviceId: b.serviceId || '', serviceName: b.serviceName,
            isNewCustomer: b.isNewCustomer, isDesignated: b.isDesignated, ownerDirect: b.ownerDirect, depositUnpaid: b.depositUnpaid
          }
        })
        const frees = []; let cursor = openMin
        list.forEach((b) => { const s = toMin(b.startTime); if (s - cursor >= 30) { frees.push({ startTime: m2t(cursor), top: Math.round((cursor - openMin) / 60 * PX_PER_HOUR), height: Math.round((s - cursor) / 60 * PX_PER_HOUR) }); freeTotal += (s - cursor) } cursor = Math.max(cursor, toMin(b.endTime)) })
        if (closeMin - cursor >= 30) { frees.push({ startTime: m2t(cursor), top: Math.round((cursor - openMin) / 60 * PX_PER_HOUR), height: Math.round((closeMin - cursor) / 60 * PX_PER_HOUR) }); freeTotal += (closeMin - cursor) }
        return { id: t.id, name: t.name, role: t.title || '', busy: t.bookingCount > 0, count: t.bookingCount, blocks, frees }
      })
      const d = new Date(`${date}T00:00:00`)
      this.setData({
        role: me.role || 'owner', selDate: date, myTechId: me.technicianId || '',
        dv: {
          date, dateText: `${d.getMonth() + 1}月${d.getDate()}日 周${WK[d.getDay()]}`,
          isClosed: r.isClosed, specialNote: r.specialNote || '', openTime: r.openTime, closeTime: r.closeTime,
          gridH, colW: 190, hours, total: (r.bookings || []).length, working: cols.length,
          freeHours: Math.round(freeTotal / 60 * 10) / 10, activeCount: r.activeCount || 0, cols
        }
      })
      this.syncClose(date) // 网格下方那块日结跟着看同一天
    } catch (e) { wx.showToast({ title: '加载今日台面失败', icon: 'none' }) }
  },
  // 日结板块跟着台面看同一天;只有老板看得到(员工端接口就是 403)
  syncClose(date) {
    if (!this.data.isOwner) return
    this.loadClose(date)
  },
  scrollToClose() { wx.pageScrollTo({ selector: '#dcBlock', duration: 260 }) },
  dvPrev() { this.loadDayView(addDays(this.data.selDate || todayStr(), -1)) },
  dvNext() { this.loadDayView(addDays(this.data.selDate || todayStr(), 1)) },
  dvToday() { this.loadDayView(todayStr()) },
  shareSchedule() { wx.showModal({ title: '分享台面', showCancel: false, confirmText: '知道了', content: '把当前排满的台面截屏,发朋友圈/群做宣传——满屏预约=火爆。\niPhone:侧边键+音量上;安卓:电源+音量下。' }) },

  tapBlock(e) {
    const id = e.currentTarget.dataset.id
    let b = null
    ;(this.data.dv.cols || []).forEach((c) => { const hit = (c.blocks || []).find((x) => x.id === id); if (hit) b = Object.assign({}, hit, { tech: c.name, techId: c.id }) })
    if (!b) return
    // 员工:仅本人那列可操作(到店/完成/写小记);别人的单只读
    if (this.data.role !== 'owner' && b.techId !== this.data.myTechId) {
      wx.showModal({ title: b.customerName, content: `${b.startTime}–${b.endTime} · ${b.serviceName} · ${b.tech}`, showCancel: false, confirmText: '知道了' }); return
    }
    // 屏 0:纯文字按钮,不带 emoji;完成由顾客签署驱动,面板里不再有「标记完成」
    this.settlementsOf(b.id).then((sheets) => {
      const pending = sheets.filter((x) => x.status === 'pending_sign')
      const items = []; const actions = []
      if (b.state !== 'active') { items.push('确认到店(开始服务)'); actions.push('arrive') }
      if (b.state === 'active') { items.push('改回未到店'); actions.push('unarrive') }
      if (b.state !== 'done') {
        if (pending.length) { items.push(`查看结算单(待签 ${pending.length} 张)`); actions.push('sheets') }
        else { items.push('去结算'); actions.push('settle') }
      } else if (sheets.length) { items.push('查看电子票据'); actions.push('sheets') }
      if (b.depositUnpaid) { items.push('标记已收定金'); actions.push('paid') }
      items.push('写服务小记'); actions.push('note')
      items.push('归属备注(实际谁做)'); actions.push('attr')
      wx.showActionSheet({
        itemList: items,
        success: (res) => {
          const act = actions[res.tapIndex]
          if (act === 'arrive') this.setArrival(b.id, true)
          else if (act === 'unarrive') this.setArrival(b.id, false)
          else if (act === 'settle') this.goSettle({ id: b.id, userId: b.userId, customerName: b.customerName, serviceId: b.serviceId })
          else if (act === 'sheets') this.showSheets(sheets)
          else if (act === 'note') this.goNote(b)
          else if (act === 'attr') this.attrNote(b)
          else if (act === 'paid') wx.showToast({ title: '已标记已收(演示)', icon: 'none' })
        }
      })
    })
  },
  // 归属备注:这单实际谁做/怎么分,月底工资试算集中显示,配合±调整用
  attrNote(b) {
    wx.showModal({
      title: `归属备注 · ${b.customerName}`, editable: true,
      placeholderText: '如:实际 Coco 做 / 我和Mia各半',
      success: async (r) => {
        if (!r.confirm || !r.content || !r.content.trim()) return
        try {
          await api.adminPost(`/admin/bookings/${encodeURIComponent(b.id)}/attribution-note`, { note: r.content.trim() })
          wx.showToast({ title: '已记录,月底工资试算可见', icon: 'none', duration: 2200 })
        } catch (err) { wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' }) }
      }
    })
  },
  async setArrival(id, arrived) {
    try { await api.adminPatch(`/admin/bookings/${encodeURIComponent(id)}/arrival`, { arrived }); wx.showToast({ title: arrived ? '已到店' : '已改回未到', icon: 'none' }); this.loadDayView(this.data.selDate) }
    catch (err) { wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' }) }
  },
  goNote(b) {
    if (!b.userId) { wx.showToast({ title: '该单缺顾客,无法写小记', icon: 'none' }); return }
    wx.navigateTo({ url: `/pages/merchant/service-note/index?userId=${encodeURIComponent(b.userId)}&name=${encodeURIComponent(b.customerName)}&service=${encodeURIComponent(b.serviceName || '')}&tech=${encodeURIComponent(b.tech || '')}&bookingId=${encodeURIComponent(b.id || '')}` })
  },

  // ===== 直接排单 =====
  async tapFree(e) {
    if (this.data.role !== 'owner') { wx.showToast({ title: '仅老板可直接排单', icon: 'none' }); return }
    const { tech, time } = e.currentTarget.dataset
    const col = (this.data.dv.cols || []).find((c) => c.id === tech)
    let services = this.data.directServices
    if (!services.length) {
      const r = await api.adminGet('/admin/services').catch(() => ({ services: [] }))
      services = (r.services || []).filter((s) => s.status !== 'hidden').map((s) => ({ id: s.id, name: s.nameZh || s.name_zh || s.name, dur: s.baseDurationMin || s.base_duration_min || 120 }))
    }
    let customers = this.data.directCustomers
    if (!customers.length) {
      const rc = await api.adminGet('/admin/customers').catch(() => ({ customers: [] }))
      customers = (rc.customers || []).map((c) => ({ id: c.id, name: c.display_name || c.displayName || c.name || '顾客', phone: c.phone || '' }))
    }
    const first = services[0] || {}
    const dur0 = first.dur || 120
    this.setData({
      directSheet: true, directTech: tech, directTechName: (col && col.name) || '', directTime: time,
      directServices: services, directServiceId: first.id || '', directDurationMin: dur0,
      directEndTime: this.calcDirectEnd(time, dur0), directDurH: Math.round(dur0 / 6) / 10,
      directCustomers: customers, custQuery: '', custMatches: [], selectedCustId: '', selectedCustName: '', directDeposit: false
    })
  },
  closeDirect() { this.setData({ directSheet: false }) },
  // 预计结束 = 起始 + 所选服务时长(结束时间由服务时长自动定,无需手选)
  calcDirectEnd(time, dur) {
    if (!/^\d{1,2}:\d{2}$/.test(time || '')) return ''
    return m2t(toMin(time) + (dur || 120))
  },
  pickDirectSvc(e) {
    const id = e.currentTarget.dataset.id
    const s = this.data.directServices.find((x) => x.id === id)
    const dur = (s && s.dur) || 120
    this.setData({ directServiceId: id, directDurationMin: dur, directEndTime: this.calcDirectEnd(this.data.directTime, dur), directDurH: Math.round(dur / 6) / 10 })
  },
  // 顾客搜索:从客户库匹配,或新建
  onCustSearch(e) {
    const q = (e.detail.value || '').trim()
    const matches = q ? this.data.directCustomers.filter((c) => (c.name || '').indexOf(q) >= 0 || (c.phone || '').indexOf(q) >= 0).slice(0, 8) : []
    this.setData({ custQuery: q, custMatches: matches, selectedCustId: '', selectedCustName: '' })
  },
  pickCust(e) {
    const id = e.currentTarget.dataset.id
    const c = this.data.directCustomers.find((x) => x.id === id)
    if (c) this.setData({ selectedCustId: c.id, selectedCustName: c.name, custQuery: c.name, custMatches: [] })
  },
  clearCust() { this.setData({ selectedCustId: '', selectedCustName: '', custQuery: '', custMatches: [] }) },
  onDirectTime(e) { const t = e.detail.value; this.setData({ directTime: t, directEndTime: this.calcDirectEnd(t, this.data.directDurationMin) }) },
  // 时长微调(这次多做/少做):±30 分钟,30–360;「标准」恢复所选服务默认时长
  adjustDur(delta) {
    const d = Math.min(360, Math.max(30, this.data.directDurationMin + delta))
    this.setData({ directDurationMin: d, directDurH: Math.round(d / 6) / 10, directEndTime: this.calcDirectEnd(this.data.directTime, d) })
  },
  durMinus() { this.adjustDur(-30) },
  durPlus() { this.adjustDur(30) },
  durReset() {
    const s = this.data.directServices.find((x) => x.id === this.data.directServiceId)
    const d = (s && s.dur) || 120
    this.setData({ directDurationMin: d, directDurH: Math.round(d / 6) / 10, directEndTime: this.calcDirectEnd(this.data.directTime, d) })
  },
  setDeposit(e) { this.setData({ directDeposit: e.currentTarget.dataset.v === 'paid' }) },
  async submitDirect() {
    const d = this.data
    const body = { serviceId: d.directServiceId, technicianId: d.directTech, date: d.selDate, time: d.directTime, durationMin: d.directDurationMin, depositPaid: d.directDeposit }
    if (d.selectedCustId) body.userId = d.selectedCustId
    else if (d.custQuery.trim()) body.newCustomerName = d.custQuery.trim()
    else { wx.showToast({ title: '选择或输入顾客', icon: 'none' }); return }
    if (!d.directServiceId) { wx.showToast({ title: '选个服务', icon: 'none' }); return }
    if (!/^\d{2}:\d{2}$/.test(d.directTime)) { wx.showToast({ title: '选个时段', icon: 'none' }); return }
    try {
      await api.adminPost('/admin/bookings/direct', body)
      wx.showToast({ title: '已排单', icon: 'success' })
      this.setData({ directSheet: false })
      this.loadDayView(this.data.selDate)
    } catch (err) { wx.showToast({ title: (err && err.message) || '排单失败', icon: 'none' }) }
  }
}, dailyCloseMixin))
