const api = require('../../../utils/api')
const { storeToday, refreshStoreClock, storeMoney } = require('../../../utils/storeclock')
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
// 快捷选人列表的手机号脱敏(图 D9 v1.1 样式「138****0000」);短号原样
function maskPhoneLocal(p) {
  const s = String(p || '')
  return s.length >= 7 ? `${s.slice(0, 3)}****${s.slice(-4)}` : s
}
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
  // 爽约定金处置徽标(图 A-1/A-3):待处置红 / 已留存绿 / 已没收灰;无收取记录不出(A⓪)
  const dd = b.depositDisposal || null
  const ddBadge = dd
    ? (dd.state === 'pending' ? `定金 ${dd.outstandingText} 待处置`
      : (dd.state === 'retain' ? '定金已留存 → 客户档案'
        : (dd.state === 'forfeit' || dd.state === 'auto_forfeit' ? `已没收入账 ${dd.amountText}` : '')))
    : ''
  return {
    id: b.id, status: b.status, date: b.appointmentDate || '', time: b.appointmentTime || '',
    statusLabel: b.noShowAt ? '已爽约' : s.label, statusCls: b.noShowAt ? 'n' : s.cls, customer, tech,
    userId: b.userId || (b.user && (b.user.id || b.user.sub)) || '',
    serviceId: b.serviceId || (b.service && b.service.id) || '', serviceName: service,
    technicianId: b.technicianId || (b.technician && b.technician.id) || '',
    thumb: hasImg ? b.referenceImages[0] : '',
    line: [service, dur].filter(Boolean).join(' · '),
    noShow: Boolean(b.noShowAt),
    ddState: dd ? dd.state : '',
    ddBadge,
    ddCls: dd && dd.state === 'pending' ? 'd' : (dd && dd.state === 'retain' ? 'g' : 'n'),
    asStatusText: b.afterSales ? b.afterSales.statusText : ''
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
    asPanel: null,        // D12 售后详情(只读)弹层
    // 今日台面(技师维度日视图)
    selDate: '',
    dv: null,
    // 直接排单
    directSheet: false, directTech: '', directTechName: '', directTime: '', directEndTime: '', directDurH: 0, directServices: [], directServiceId: '', directDurationMin: 120, directDeposit: false,
    directCats: [], directCatId: '',   // D24:排单选择器两级(大类→小类),同源结算主项目目录
    // 顾客区 · D9 根治(图 v1.1):一框即搜 + 无匹配一键建档 + 扫会员码。
    // 「新客·输手机号」页签连同 dsTab/dsName/dsPhone/dsHitText/dsHitId 整体删除(不是隐藏)。
    directCustomers: [], custQuery: '', custMatches: [], selectedCustId: '', selectedCustName: '',
    pendingNewName: '', pendingNewPhone: '',   // 点了「＋建档并排单」待建的轻档案(建档发生在建单那一刻,既有闭环)
    depositCfg: { enabled: false, amountText: '' },
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
        /* D28 规则①:待结算 →「继续结算」直接回结算页续办(不弹层);数据从后端恢复,
           结算页 boot 会检测本预约的待签单自动回到出码态(绑定/充值入口都在)。 */
        opts.push({ label: `继续结算（待签 ${pending.length} 张）`, settle: true })
        opts.push({ label: '撤回改单', voidSheets: pending })
      } else if (sheets.some((s) => s.status === 'signed' || s.status === 'amended')) {
        opts.push({ label: '查看结算单', preview: sheets.find((s) => s.status === 'signed' || s.status === 'amended').id })
        opts.push({ label: '去结算', settle: true })
      } else opts.push({ label: '去结算', settle: true })
      opts.push({ label: '取消预约', s: 'CANCELLED' })
    } else if (status === 'COMPLETED') {
      // D28 规则①②:已结算/已签署 → 同一预览弹层(不再是 showModal 清单)
      const live = sheets.filter((s) => s.status !== 'voided')
      if (live.length) opts.push({ label: '查看结算单', preview: live[0].id })
      /* 拍板③(店主 08-20,双端统一):未签署结算单的单不能发起售后——未签单不显示「转售后」。
         老数据红线:已存在的无签署单售后原样保留(只收紧新发起,不回溯)。 */
      if (sheets.some((s) => s.status === 'signed' || s.status === 'amended')) opts.push({ label: '转售后', s: 'AFTER_SALES' })
    } else if (status === 'AFTER_SALES') {
      // 图 B 部:售后详情可看可写(权限在面板里按角色收)
      opts.push({ label: '查看/处理售后', asOpen: true })
    }
    const rawB = (this.data.raw || []).find((x) => x.id === id) || {}
    /* ⬜ 图上没画「标记爽约」入口(A 部流程的前提),按最合理方式放进操作面板,已记假设清单:
       仅老板;待到店/进行中的单可标(后端 /no-show 路由本来就是仅老板)。 */
    if (this.data.isOwner && ['CONFIRMED', 'IN_PROGRESS', 'SERVING'].includes(status)) {
      opts.push({ label: '标记爽约', noShow: true })
    }
    // 图 A-1:已爽约 + 定金待处置 → 老板出「处置定金」;无收取记录不出(A⓪)
    if (this.data.isOwner && rawB.depositDisposal && rawB.depositDisposal.state === 'pending') {
      opts.push({ label: `处置定金(${rawB.depositDisposal.outstandingText} 待处置)`, disposal: true })
    }
    if (rawB.depositDisposal && ['retain', 'forfeit', 'auto_forfeit'].includes(rawB.depositDisposal.state)) {
      opts.push({ label: '查看定金处置记录', dispView: true })
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
    if (o.act) return this.tapGridAct(o) // 网格那条路径给的是 act 串
    if (o.note) this.goNote(ctx)
    else if (o.settle) this.goSettle(ctx)
    else if (o.voidSheets) this.voidSheets(o.voidSheets, ctx)
    else if (o.preview) this.openPreview(o.preview)
    else if (o.sheets) this.showSheets(this._panelSheets)
    else if (o.noShow) this.markNoShow(ctx)
    else if (o.disposal) this.openDisposal(ctx.id)
    else if (o.dispView) this.viewDisposal(ctx.id)
    else if (o.asOpen) this.openAfterSales({ currentTarget: { dataset: { id: ctx.id } } })
    else this.applyStatus(ctx.id, o.s)
  },

  /* ===== 爽约与定金处置(图 A 部)===== */
  // ⬜ 标记爽约(A 部前提;图未画入口,记假设):仅老板,后端落 no_show_at
  markNoShow(ctx) {
    wx.showModal({
      title: '标记爽约',
      content: `确认 ${ctx.customerName || '顾客'} 爽约?预约将取消;有已收定金的,之后在本单上二选一处置(留存/没收)。`,
      confirmText: '确认爽约',
      success: async (r) => {
        if (!r.confirm) return
        try {
          await api.adminPost(`/admin/bookings/${encodeURIComponent(ctx.id)}/no-show`, {})
          wx.showToast({ title: '已标记爽约', icon: 'none' })
          this.loadList(); this.loadDayView(this.data.selDate)
        } catch (err) { wx.showToast({ title: (err && err.message) || '标记失败', icon: 'none' }) }
      },
      fail: (e) => console.warn('[showModal fail]', e) // S组卫生批:fail=开发者域错误,console 留痕不弹 UI(toast 会撞转场,D27 家族)
    })
  },
  // 图 A-2 处置弹层:老板二选一,备注选填,经手人=当前登录老板(后端自动记)
  openDisposal(id) {
    const b = (this.data.raw || []).find((x) => x.id === id)
    if (!b || !b.depositDisposal) { wx.showToast({ title: '读不到这单的定金信息', icon: 'none' }); return }
    const row = { customer: (b.user && (b.user.displayName || b.user.display_name)) || b.customerName || '顾客' }
    this.setData({
      dispPanel: {
        bookingId: id,
        customer: row.customer,
        amountText: b.depositDisposal.outstandingText,
        receiptText: b.depositDisposal.receiptText || '',
        action: 'retain',   // 图 A-2 默认选①留存
        note: ''
      }
    })
  },
  dispPick(e) { this.setData({ 'dispPanel.action': e.currentTarget.dataset.a }) },
  onDispNote(e) { this.setData({ 'dispPanel.note': String((e.detail && e.detail.value) || '') }) },
  closeDisposal() { this.setData({ dispPanel: null }) },
  async submitDisposal() {
    const p = this.data.dispPanel
    if (!p) return
    try {
      const r = await api.adminPost(`/admin/bookings/${encodeURIComponent(p.bookingId)}/deposit-disposal`, { action: p.action, note: p.note })
      wx.showToast({ title: r.note || '已处置', icon: 'none' })
      this.setData({ dispPanel: null })
      this.loadList()
    } catch (err) { wx.showToast({ title: (err && err.message) || '处置失败', icon: 'none' }) }
  },
  viewDisposal(id) {
    const b = (this.data.raw || []).find((x) => x.id === id)
    const d = b && b.depositDisposal
    if (!d) return
    const act = { retain: '留存到客户档案', forfeit: '没收入账', auto_forfeit: '留存到期自动没收' }[d.state] || d.state
    wx.showModal({
      title: '定金处置记录',
      content: `${act} · ${d.amountText}\n处置:${String(d.at).slice(0, 16).replace('T', ' ')} · ${d.actor}${d.note ? `\n备注:${d.note}` : ''}`,
      showCancel: false, confirmText: '知道了',
      fail: (e) => console.warn('[showModal fail]', e) // S组卫生批:fail=开发者域错误,console 留痕不弹 UI(toast 会撞转场,D27 家族)
    })
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
      },
      fail: (e) => console.warn('[showModal fail]', e) // S组卫生批:fail=开发者域错误,console 留痕不弹 UI(toast 会撞转场,D27 家族)
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
  /* 顾客签署页。D9 规则⑤(店主 08-11 补拍):归属**未绑定轻档案**的单,
     只有扫码一条签署路(扫码即自动建立绑定)—— 跳结算页的 QR 层(同一份实现),
     不走店员设备手签的 webview。绑定客照旧手签兜底。 */
  openSign(sheet) {
    if (sheet && sheet.customerBound === false) {
      wx.navigateTo({ url: `/pages/merchant/settlement/index?qrFor=${encodeURIComponent(sheet.id)}` })
      return
    }
    const code = typeof sheet === 'string' ? sheet : (sheet && sheet.code)
    wx.navigateTo({ url: `/pages/sign/index?code=${encodeURIComponent(code)}` })
  },
  /* 🔴 D10 修复(店主 2026-08-10 开检):这里原来写着
       `if (pending.length === 1) { this.openSign(pending[0].code); return }`
     —— 只要恰好有一张待签单,商家点「查看结算单」就**直接跳进顾客端的签署页**
     (`/pages/sign/index?code=`,顾客看到的「确认本人并绑定」那一屏)。
     店主想「看单」,拿到的是顾客的身份绑定界面,这就是她报的入口串页。

     改法:**「查看」永远只是看**,列清有哪几张、各是什么状态(顺带满足 D7「点名到单」);
     要把手机递给顾客签是另一个动作,必须商家在这张弹层上**明确点**「递给顾客签」才走。
     不再有"恰好一张就自己跳走"这种隐式行为。 */
  /* D28 定案:老 showSheets 用 wx.showModal 且 confirmText「递给顾客签」5 个汉字 ——
     微信限 4 字,整个弹窗静默 fail(没挂 fail 回调),这就是「查看结算单」全状态死链的根因。
     现换成单据预览弹层组件(图 v1);待签路不再进这里(面板层已分流到「继续结算」)。 */
  showSheets(sheets) {
    const live = (sheets || []).filter((s) => s.status !== 'voided')
    if (!live.length) { wx.showToast({ title: '这单还没有结算单', icon: 'none' }); return }
    this.openPreview(live[0].id)
  },
  openPreview(idOrCode) {
    if (!idOrCode) { wx.showToast({ title: '找不到这张结算单', icon: 'none' }); return }
    this.setData({ previewSheet: String(idOrCode) })
  },
  /* 售后详情(图 B-1 写入版 = D12 只读版 + 写入按钮)。
     状态/时间线/结果全由后端状态机下发(B⓪ 三端同一份);
     权限(B①):写进展/标已解决 = 当单技师+老板;关闭 = 仅老板。 */
  openAfterSales(e) {
    const id = e.currentTarget.dataset.id
    const b = (this.data.raw || []).find((x) => x.id === id)
    if (!b) { wx.showToast({ title: '读不到这张售后单', icon: 'none' }); return }
    const row = (this.data.aftersalesList || []).find((x) => x.id === id) || vm(b)
    const as = b.afterSales || {}
    const techId = b.technicianId || (b.technician && b.technician.id) || ''
    const canWrite = this.data.isOwner || (this.data.myTechId && this.data.myTechId === techId)
    const terminal = as.status === 'resolved' || as.status === 'closed'
    this.setData({
      asPanel: {
        bookingId: id,
        customer: row.customer || '顾客',
        line: row.line || '',
        tech: row.tech || '',
        date: row.date || '',
        time: row.time || '',
        status: as.status || 'pending',
        statusText: as.statusText || '待处理',
        reason: as.reason || '',
        timeline: as.timeline || [],
        resultText: as.resultText || '',
        footnote: as.footnote || '',
        canWrite: canWrite && !terminal,
        canClose: this.data.isOwner && !terminal
      }
    })
  },
  closeAfterSales() { this.setData({ asPanel: null }) },
  // B①:写进展(当单技师+老板);editable 弹窗,时间线 append-only
  asWriteProgress() {
    const p = this.data.asPanel
    if (!p) return
    wx.showModal({
      title: '写处理进展',
      editable: true,
      placeholderText: '如:已联系顾客,约 8/13 到店补钻',
      success: async (r) => {
        if (!r.confirm || !String(r.content || '').trim()) return
        try {
          await api.adminPost(`/admin/bookings/${encodeURIComponent(p.bookingId)}/after-sales/progress`, { text: r.content.trim() })
          wx.showToast({ title: '进展已记录', icon: 'none' })
          this.setData({ asPanel: null }); this.loadList()
        } catch (err) { wx.showToast({ title: (err && err.message) || '写入失败', icon: 'none' }) }
      },
      fail: (e) => console.warn('[showModal fail]', e) // S组卫生批:fail=开发者域错误,console 留痕不弹 UI(toast 会撞转场,D27 家族)
    })
  },
  // B①/B④:标记已解决 —— 处理结果必填,顾客端展示的就是这段文案
  asResolve() {
    const p = this.data.asPanel
    if (!p) return
    wx.showModal({
      title: '标记已解决(结果将展示给顾客)',
      editable: true,
      placeholderText: '处理结果(必填),如:8/13 到店免费补钻 2 颗,顾客确认满意',
      success: async (r) => {
        if (!r.confirm) return
        const text = String(r.content || '').trim()
        if (!text) { wx.showToast({ title: '处理结果必填', icon: 'none' }); return }
        try {
          await api.adminPost(`/admin/bookings/${encodeURIComponent(p.bookingId)}/after-sales/resolve`, { resultText: text })
          wx.showToast({ title: '已标记解决', icon: 'none' })
          this.setData({ asPanel: null }); this.loadList()
        } catch (err) { wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' }) }
      },
      fail: (e) => console.warn('[showModal fail]', e) // S组卫生批:fail=开发者域错误,console 留痕不弹 UI(toast 会撞转场,D27 家族)
    })
  },
  // B①:关闭 = 仅老板,必填原因(无需处理/顾客撤回等)
  asClose() {
    const p = this.data.asPanel
    if (!p) return
    wx.showModal({
      title: '关闭售后(仅老板)',
      editable: true,
      placeholderText: '关闭原因(必填),如:顾客撤回反馈',
      success: async (r) => {
        if (!r.confirm) return
        const reason = String(r.content || '').trim()
        if (!reason) { wx.showToast({ title: '关闭必须填一句原因', icon: 'none' }); return }
        try {
          await api.adminPost(`/admin/bookings/${encodeURIComponent(p.bookingId)}/after-sales/close`, { reason })
          wx.showToast({ title: '已关闭', icon: 'none' })
          this.setData({ asPanel: null }); this.loadList()
        } catch (err) { wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' }) }
      },
      fail: (e) => console.warn('[showModal fail]', e) // S组卫生批:fail=开发者域错误,console 留痕不弹 UI(toast 会撞转场,D27 家族)
    })
  },

  applyStatus(id, s) {
    const doIt = async () => {
      try { await api.adminPatch(`/admin/bookings/${encodeURIComponent(id)}/status`, { status: s }); wx.showToast({ title: '已更新', icon: 'none' }); this.loadList() }
      catch (err) { wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' }) }
    }
    if (s === 'CANCELLED') { wx.showModal({ title: '取消预约', content: '确认取消?将释放该时段;若已入账会自动冲销。', success: (r) => { if (r.confirm) doIt() },
  fail: (e) => console.warn('[showModal fail]', e) // S组卫生批:fail=开发者域错误,console 留痕不弹 UI(toast 会撞转场,D27 家族)
}); return }
    doIt()
  },

  // ===== 今日台面:技师维度日视图(自排班原样搬来) =====
  async loadDayView(date) {
    try {
      const me = await api.adminMe().catch(() => ({ role: 'owner' }))
      const r = await api.adminGet(`/admin/schedule-day?date=${date}`)
      /* 今日台面必须显示**当天全部预约**,含营业时段外的(店主 2026-08-09 拍板)。
         原来网格只画 开门→打烊 这一段,于是提早到店、加钟做到打烊后的单
         整块落在网格外看不见 —— 而这些单照样进日结、照样算业绩,台面上看不见
         等于店主对不上账。改成:网格范围 = 营业时段 ∪ 当天所有预约的时间跨度,
         营业时段外的整点行用淡色标出(沿用现有网格语言,不引入新设计)。 */
      const bizOpen = toMin(r.openTime || '10:00'); const bizClose = toMin(r.closeTime || '19:00')
      let openMin = bizOpen; let closeMin = bizClose
      for (const b of (r.bookings || [])) {
        openMin = Math.min(openMin, toMin(b.startTime))
        closeMin = Math.max(closeMin, toMin(b.endTime))
      }
      openMin = Math.floor(openMin / 60) * 60            // 往下取整到整点,块不会贴着上沿
      closeMin = Math.ceil(closeMin / 60) * 60
      const gridH = Math.round(Math.max(60, closeMin - openMin) / 60 * PX_PER_HOUR)
      const hours = []
      for (let m = openMin; m < closeMin; m += 60) {
        hours.push({ label: `${pad(Math.floor(m / 60))}:00`, off: m < bizOpen || m >= bizClose })
      }
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
          // D3:当期才叫「今天」,翻走了要叫「返回今天」;D5:日期上直接标出今天
          isToday: date === todayStr(),
          todayTag: date === todayStr() ? '今天' : '',
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
  shareSchedule() { wx.showModal({ title: '分享台面', showCancel: false, confirmText: '知道了', content: '把当前排满的台面截屏,发朋友圈/群做宣传——满屏预约=火爆。\niPhone:侧边键+音量上;安卓:电源+音量下。',
  fail: (e) => console.warn('[showModal fail]', e) // S组卫生批:fail=开发者域错误,console 留痕不弹 UI(toast 会撞转场,D27 家族)
}) },

  tapBlock(e) {
    const id = e.currentTarget.dataset.id
    let b = null
    ;(this.data.dv.cols || []).forEach((c) => { const hit = (c.blocks || []).find((x) => x.id === id); if (hit) b = Object.assign({}, hit, { tech: c.name, techId: c.id }) })
    if (!b) return
    // 员工:仅本人那列可操作(到店/完成/写小记);别人的单只读
    if (this.data.role !== 'owner' && b.techId !== this.data.myTechId) {
      wx.showModal({ title: b.customerName, content: `${b.startTime}–${b.endTime} · ${b.serviceName} · ${b.tech}`, showCancel: false, confirmText: '知道了',
  fail: (e) => console.warn('[showModal fail]', e) // S组卫生批:fail=开发者域错误,console 留痕不弹 UI(toast 会撞转场,D27 家族)
}); return
    }
    // 屏 0:纯文字按钮,不带 emoji;完成由顾客签署驱动,面板里不再有「标记完成」
    this.settlementsOf(b.id).then((sheets) => {
      const pending = sheets.filter((x) => x.status === 'pending_sign')
      const items = []; const actions = []
      if (b.state !== 'active') { items.push('确认到店(开始服务)'); actions.push('arrive') }
      if (b.state === 'active') { items.push('改回未到店'); actions.push('unarrive') }
      if (b.state !== 'done') {
        if (pending.length) { items.push(`继续结算(待签 ${pending.length} 张)`); actions.push('settle') }
        else { items.push('去结算'); actions.push('settle') }
      } else if (sheets.filter((x) => x.status !== 'voided').length) { items.push('查看结算单'); actions.push('preview') }
      // 待签状态可撤回改单(与列表那条路径同一套语义:全撤未签的、券回券包、回到去结算)
      if (pending.length) { items.push('撤回改单'); actions.push('void') }
      if (b.depositUnpaid) { items.push('标记已收定金'); actions.push('paid') }
      items.push('写服务小记'); actions.push('note')
      /* 「归属备注」已随 v6 定稿退役(代付不涉技师业绩归属,且日结已逐日确认过)——
         2026-08-09 集中核验时发现网格这条路径还留着,清掉。 */
      const ctx = { id: b.id, userId: b.userId, customerName: b.customerName, serviceId: b.serviceId, serviceName: b.serviceName, tech: b.tech }
      // 屏 0:图上是自建面板(顶部订单摘要 + 按钮 + 关闭),不是系统 ActionSheet
      this._panelOpts = actions.map((act, i) => ({ act, label: items[i] }))
      this._panelCtx = ctx
      this._panelSheets = sheets
      this.setData({
        actPanel: {
          title: `${b.customerName || '顾客'} · ${b.serviceName || ''} · ${b.state === 'done' ? '已完成' : (b.state === 'active' ? '进行中' : '待到店')}`,
          opts: items.map((label, i) => ({ i, label }))
        }
      })
    })
  },
  // 网格面板的按钮走这里(与列表面板共用同一张弹层)
  tapGridAct(o) {
    const b = this._panelCtx
    const sheets = this._panelSheets || []
    if (o.act === 'arrive') this.setArrival(b.id, true)
    else if (o.act === 'unarrive') this.setArrival(b.id, false)
    else if (o.act === 'settle') this.goSettle(b)
    else if (o.act === 'preview') this.openPreview((sheets.find((x) => x.status !== 'voided') || {}).id)
    else if (o.act === 'sheets') this.showSheets(sheets)
    else if (o.act === 'note') this.goNote(b)
    else if (o.act === 'void') this.voidSheets(sheets.filter((x) => x.status === 'pending_sign'), b)
    else if (o.act === 'paid') this.markDepositPaid(b)
  },

  /* 标记已收定金(拍板 A · 《财务记账总逻辑》v1.1 §五)。
     金额由后端按本店 deposit_config 算,这里只显示;标记那一刻只记定金预收(负债),
     不进收入账本 —— 签字时才兑现。重复标记后端幂等,不会记两笔。 */
  async markDepositPaid(b) {
    let amountText = ''
    try {
      const dep = await api.adminGet('/admin/deposit-config')
      const c = (dep && dep.config) || {}
      if (c.enabled === false) { wx.showToast({ title: '本店没开定金,先去门店设置配规则', icon: 'none' }); return }
      if (c.mode === 'fixed' && c.fixedAmountCents) amountText = storeMoney(c.fixedAmountCents, 0)
    } catch (e) { /* 拉不到配置也照常让后端算 */ }
    wx.showModal({
      title: '标记已收定金',
      content: `确认已经收到 ${b.customerName || '顾客'} 的定金${amountText ? ` ${amountText}` : ''}?\n记为定金预收(负债),不进收入;签字时才兑现。`,
      confirmText: '已收到',
      success: async (r) => {
        if (!r.confirm) return
        try {
          const resp = await api.adminPost(`/admin/bookings/${encodeURIComponent(b.id)}/deposit-receipt`, {})
          wx.showToast({ title: resp && resp.created === false ? '之前已标过,没重复记账' : '已记定金预收', icon: 'none' })
          this.loadDayView(this.data.selDate)
        } catch (err) { wx.showToast({ title: (err && err.message) || '标记失败', icon: 'none' }) }
      },
      fail: (e) => console.warn('[showModal fail]', e) // S组卫生批:fail=开发者域错误,console 留痕不弹 UI(toast 会撞转场,D27 家族)
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
    /* D24(店主 2026-08-12):排单选择器与结算单「服务项目」同一数据源同一粒度 ——
       同源 /admin/pricing/categories + items(大类→小类两级,只列主项目;
       员工也读得到,不再走 owner-only 的旧 /admin/services 平铺口径)。
       预约存的 serviceId 与结算主项目目录同表同 id,带入结算即精确对上。 */
    let cats = this.data.directCats
    let byCat = this._directByCat || {}
    if (!cats.length) {
      try {
        const [rc, ri] = await Promise.all([api.adminGet('/admin/pricing/categories'), api.adminGet('/admin/pricing/items')])
        const mains = (ri.items || []).filter((i) => i.isActive !== false && i.itemKind === 'main')
          .map((i) => ({ id: i.id, name: i.nameZh, dur: i.baseDurationMin || 120, catId: i.categoryId || '' }))
        const catList = (rc.categories || []).filter((c) => c.isBookable !== false).map((c) => ({ id: c.id, name: c.name }))
        byCat = {}
        for (const m of mains) { (byCat[m.catId] = byCat[m.catId] || []).push(m) }
        cats = catList.filter((c) => (byCat[c.id] || []).length)
        if ((byCat[''] || []).length) cats = cats.concat([{ id: '', name: '未分类' }])
        this._directByCat = byCat
      } catch (e) { cats = []; byCat = {} }
    }
    const firstCat = cats[0] || { id: '' }
    const services = (byCat[firstCat.id] || [])
    let customers = this.data.directCustomers
    if (!customers.length) {
      const rc = await api.adminGet('/admin/customers').catch(() => ({ customers: [] }))
      // 快捷选人列表按图脱敏显示手机号(搜索仍用全号匹配);到店次数帮店员认人
      customers = (rc.customers || []).map((c) => ({
        id: c.id,
        name: c.display_name || c.displayName || c.name || '顾客',
        phone: c.phone || '',
        phoneMasked: c.phoneMasked || maskPhoneLocal(c.phone || ''),
        visits: c.visitCount || c.visit_count || 0
      }))
    }
    const first = services[0] || {}
    const dur0 = first.dur || 120
    this.setData({
      directSheet: true, directTech: tech, directTechName: (col && col.name) || '', directTime: time,
      directCats: cats, directCatId: firstCat.id || '',
      directServices: services, directServiceId: first.id || '', directDurationMin: dur0,
      directEndTime: this.calcDirectEnd(time, dur0), directDurH: Math.round(dur0 / 6) / 10,
      directCustomers: customers, custQuery: '', custMatches: [], selectedCustId: '', selectedCustName: '', directDeposit: false,
      pendingNewName: '', pendingNewPhone: ''
    })
    this.loadDepositCfg()
  },
  closeDirect() { this.setData({ directSheet: false }) },

  /* ===== 屏 S1 现场/电话排单(2026-08-09 图 + 规则①②)=====
     不是新页面 —— 就是这张既有面板的增强。手机号只用来**找档案**,
     身份绑定靠签署码/会员码(规则⓪),所以手机号留空照样能建单。 */
  // 定金块:未配定金规则的店整块不出现(规则②)
  async loadDepositCfg() {
    if (this.data.depositCfg.enabled) return
    try {
      const r = await api.adminGet('/admin/deposit-config')
      const c = (r && r.config) || {}
      const cents = c.mode === 'fixed' ? (c.fixedAmountCents || 0) : 0
      this.setData({ depositCfg: { enabled: c.enabled !== false, amountText: cents ? storeMoney(cents, 0) : '' } })
    } catch (e) { this.setData({ depositCfg: { enabled: false, amountText: '' } }) }
  },
  /* D9 根治:dsSwitchTab / onDsName / onDsPhone 随「新客·输手机号」页签整体删除。
     手机号找档案的能力没丢 —— 合并后的单框本来就按姓名/手机号双字段模糊匹配。 */
  // 商家侧扫顾客专属会员码 → 直接带出档案(规则⑥ 的商家这一向)
  scanMemberCode() {
    wx.scanCode({
      onlyFromCamera: false,
      success: (r) => this.applyMemberCode(String((r && r.result) || '').trim()),
      fail: () => { /* 顾客端没开摄像头 / 取消,不提示 */ }
    })
  },
  // 扫码 success 的唯一处理器(拆出来是为了可测:wx.scanCode 本体自动化驱动不了)
  async applyMemberCode(raw) {
    const mc = (String(raw || '').match(/LL-[A-Za-z0-9]{8}/) || [])[0] || String(raw || '')
    try {
      const hit = (await api.adminGet(`/admin/customers/lookup?memberCode=${encodeURIComponent(mc)}`)).hit
      if (!hit) { wx.showToast({ title: '这个会员码查不到本店档案', icon: 'none' }); return }
      this.setData({ selectedCustId: hit.id, selectedCustName: hit.displayName, custQuery: hit.displayName, custMatches: [], pendingNewName: '', pendingNewPhone: '' })
      wx.showToast({ title: `已带出 ${hit.displayName}`, icon: 'none' })
    } catch (e) { wx.showToast({ title: '会员码解析失败', icon: 'none' }) }
  },
  // 「现在开始」:即时单,时间取门店当下(店主定的产品原则:散客也先建一条即时预约)
  dsNow() {
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const t = `${hh}:${mm}`
    this.setData({ directTime: t, directEndTime: this.calcDirectEnd(t, this.data.directDurationMin) })
  },

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
  // D24:大类切换 → 小类列表跟着换,默认选该类第一项(时长联动)
  pickDirectCat(e) {
    const catId = e.currentTarget.dataset.id
    const services = (this._directByCat || {})[catId] || []
    const first = services[0] || {}
    const dur = first.dur || 120
    this.setData({
      directCatId: catId, directServices: services, directServiceId: first.id || '',
      directDurationMin: dur, directEndTime: this.calcDirectEnd(this.data.directTime, dur), directDurH: Math.round(dur / 6) / 10
    })
  },
  // 顾客搜索(D9 根治后的唯一入口):姓名/手机号模糊匹配,命中最多 5 条(图规则①)
  onCustSearch(e) {
    const q = (e.detail.value || '').trim()
    const matches = q ? this.data.directCustomers.filter((c) => (c.name || '').indexOf(q) >= 0 || (c.phone || '').indexOf(q) >= 0).slice(0, 5) : []
    this.setData({ custQuery: q, custMatches: matches, selectedCustId: '', selectedCustName: '', pendingNewName: '', pendingNewPhone: '' })
  },
  pickCust(e) {
    const id = e.currentTarget.dataset.id
    const c = this.data.directCustomers.find((x) => x.id === id)
    if (c) this.setData({ selectedCustId: c.id, selectedCustName: c.name, custQuery: c.name, custMatches: [], pendingNewName: '', pendingNewPhone: '' })
  },
  /* 「＋建档并排单」(图规则②,店主拍板一步到位不弹确认):
     ≥7 位纯数字 → 当手机号存(姓名记「未命名」);否则当姓名存(手机号空);
     空输入 → 「未命名顾客」。都可在档案里后补;真正的建档发生在建单那一刻(既有闭环零新口径)。 */
  pickNewCust() {
    const q = (this.data.custQuery || '').trim()
    const digits = q.replace(/\D/g, '')
    const isPhone = /^\d{7,}$/.test(digits) && digits.length === q.replace(/\s/g, '').length
    const name = isPhone ? '未命名' : (q || '未命名顾客')
    this.setData({
      pendingNewName: name,
      pendingNewPhone: isPhone ? digits : '',
      selectedCustId: '',
      selectedCustName: `${name}${isPhone ? `(${digits})` : ''} · 新建轻档案`,
      custMatches: []
    })
  },
  clearCust() { this.setData({ selectedCustId: '', selectedCustName: '', custQuery: '', custMatches: [], pendingNewName: '', pendingNewPhone: '' }) },
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
    const body = { serviceId: d.directServiceId, technicianId: d.directTech, date: d.selDate, time: d.directTime, durationMin: d.directDurationMin, depositPaid: false }
    // 顾客三种来法(D9 根治后):库里选中 / 点了「＋建档并排单」/ 输了字没点建档(按同一套规则②映射)
    if (d.selectedCustId) body.userId = d.selectedCustId
    else if (d.pendingNewName) { body.newCustomerName = d.pendingNewName; if (d.pendingNewPhone) body.phone = d.pendingNewPhone }
    else if (d.custQuery.trim()) {
      const q = d.custQuery.trim()
      if (/^\d{7,}$/.test(q.replace(/\s/g, ''))) { body.newCustomerName = '未命名'; body.phone = q.replace(/\D/g, '') }
      else body.newCustomerName = q
    }
    else { wx.showToast({ title: '选择或输入顾客', icon: 'none' }); return }
    if (!d.directServiceId) { wx.showToast({ title: '选个服务', icon: 'none' }); return }
    if (!/^\d{2}:\d{2}$/.test(d.directTime)) { wx.showToast({ title: '选个时段', icon: 'none' }); return }
    try {
      const made = await api.adminPost('/admin/bookings/direct', body)
      /* 勾了「已收定金」= 走**标记已收定金同一个后端动作**(规则②),
         不是另开一条路 —— 同一张 deposit_receipts、同一套幂等/留痕/越权/守恒。 */
      if (d.directDeposit && made && made.booking) {
        try { await api.adminPost(`/admin/bookings/${encodeURIComponent(made.booking.id)}/deposit-receipt`, {}) }
        catch (err) { wx.showToast({ title: `单已建,定金没标上:${(err && err.message) || ''}`, icon: 'none' }) }
      }
      wx.showToast({ title: '已排单', icon: 'success' })
      this.setData({ directSheet: false })
      this.loadDayView(this.data.selDate)
    } catch (err) { wx.showToast({ title: (err && err.message) || '排单失败', icon: 'none' }) }
  }
}, dailyCloseMixin))
