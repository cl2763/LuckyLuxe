/* P2③ 员工管理板块化(设计图屏 4b/4c + P2.5 屏 V2)
   四页签:排班 | 业绩目标 | 薪资方案 | 账号管理,按使用频率排。
   业绩目标板块顶部是**新增**的本月排行卡,下面是原有的逐人目标设置区 ——
   位置与交互不变,只是每行左侧多了一条进度(店主 v2 设计图明确要求原设置区不动)。
   金额红线:本页不算钱。排行/进度/差额都来自 /admin/perf-ranking,条宽用后端给的 barPct。 */
const api = require('../../../utils/api')
const { formatMoney, displayOf } = require('../../../utils/money')
const { storeToday, refreshStoreClock } = require('../../../utils/storeclock')

// 排班周视图用(屏 4a):日期加减与星期,一律按门店时区口径
const WK = ['日', '一', '二', '三', '四', '五', '六']
function shiftDate(d, n) {
  const x = new Date(`${d}T12:00:00Z`)
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}
function wdOf(d) { return WK[new Date(`${d}T12:00:00Z`).getUTCDay()] }

const TABS = [
  { key: 'schedule', label: '排班' },
  { key: 'targets', label: '业绩目标' },
  { key: 'salary', label: '薪资方案' },
  { key: 'accounts', label: '账号管理' }
]
const RANK_METRICS = [
  { key: 'perf', label: '业绩' },
  { key: 'orders', label: '单数' },
  { key: 'recharge', label: '冲卡' }
]

function monthKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

Page({
  data: {
    // 图注:点进员工管理默认落在排班页签,和以前点「排班」一样快
    tab: 'schedule',
    tabs: TABS,
    metrics: RANK_METRICS,
    metric: 'perf',
    month: '',
    list: [],          // 技师 + 账号(账号管理板块用)
    ranking: [],       // 本月排行(V2 新增卡)
    targets: [],       // 逐人目标 + 进度(原设置区 + 左侧进度)
    plans: [],         // 薪资方案每人一行
    defaultPlanLabel: '',
    sheet: null,       // 目标设置面板(= v6 屏 4b 那套,一字未改)
    // 屏 4a 排班周视图(2026-08-09 从独立页内嵌进来,去掉中间那层)
    sc: { from: '', weekStart: '', days: [], afternoonStart: '14:30', loading: true, rangeText: '' },
    shiftSheet: null,  // 屏 4a-2 时段编辑弹层
    scConflicts: []
  },

  async onShow() {
    if (!(await api.guardOwner())) return
    await refreshStoreClock().catch(() => {})
    this.setData({ month: monthKey() })
    this.load()
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.k })
    this.load()
  },
  pickMetric(e) {
    this.setData({ metric: e.currentTarget.dataset.k })
    this.loadRanking()
  },

  async load() {
    const tab = this.data.tab
    try {
      if (tab === 'schedule') await this.loadWeek(this.data.sc.from || storeToday())
      else if (tab === 'targets') { await this.loadRanking(); await this.loadTargets() }
      else if (tab === 'salary') await this.loadPlans()
      else if (tab === 'accounts') await this.loadAccounts()
    } catch (e) { wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' }) }
  },

  // ===== 业绩目标板块 =====
  async loadRanking() {
    const r = await api.adminGet(`/admin/perf-ranking?metric=${this.data.metric}&period=month`)
    const d = displayOf(r.ranking)
    const m = (c) => formatMoney(c, d, d.trimZeroDecimals ? 0 : 2)
    this.setData({
      ranking: (r.ranking.ranking || []).map((x) => ({
        rank: x.rank, name: x.name, barPct: x.barPct,
        value: this.data.metric === 'orders' ? `${x.orderCount} 单` : m(this.data.metric === 'recharge' ? x.rechargeCents : x.perfCents)
      })),
      // 进度也从这份取,免得排行和目标两处各问一次、还可能不一致
      targets: (r.ranking.targets || []).map((t) => ({
        technicianId: t.technicianId,
        name: t.name,
        hasTarget: Boolean(t.target),
        pct: t.target ? Math.min(100, t.target.pct) : 0,
        pctText: t.target ? (t.target.hit ? '达标' : `${t.target.pct}%`) : '',
        hit: Boolean(t.target && t.target.hit)
      }))
    })
  },
  // 目标的原始设置值(设置面板要回填),与进度分开取
  async loadTargets() {
    const r = await api.adminGet(`/admin/perf-targets?month=${this.data.month}`)
    this.rawTargets = r.technicians || []
  },
  openTargetSheet(e) {
    const id = e.currentTarget.dataset.id
    const raw = (this.rawTargets || []).find((x) => x.technicianId === id)
    if (!raw) { wx.showToast({ title: '读不到该技师的目标', icon: 'none' }); return }
    this.setData({
      sheet: {
        technicianId: raw.technicianId,
        name: raw.name,
        mode: raw.mode,
        displayMode: raw.displayMode,
        perf: raw.perfTargetCents / 100,
        card: raw.cardTargetCents / 100,
        orders: raw.orderTarget
      }
    })
  },
  closeSheet() { this.setData({ sheet: null }) },
  sheetPick(e) {
    const { field, v } = e.currentTarget.dataset
    this.setData({ [`sheet.${field}`]: v })
  },
  sheetInput(e) {
    this.setData({ [`sheet.${e.currentTarget.dataset.field}`]: e.detail.value })
  },
  async saveTarget() {
    const s = this.data.sheet
    if (!s) return
    // 元 → 分是单位换算,不是计价;目标金额本来就是老板手输的
    const cents = (v) => Math.max(0, Math.round(Number(String(v ?? '').replace(/[^\d.]/g, '')) * 100) || 0)
    try {
      await api.adminPut('/admin/perf-targets', {
        month: this.data.month,
        targets: [{
          technicianId: s.technicianId,
          mode: s.mode,
          displayMode: s.displayMode,
          perfTargetCents: cents(s.perf),
          cardTargetCents: cents(s.card),
          orderTarget: Number(s.orders) || 0
        }]
      })
      this.setData({ sheet: null })
      wx.showToast({ title: '已保存,员工端立即生效', icon: 'none' })
      await this.loadRanking()
      await this.loadTargets()
    } catch (e) { wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' }) }
  },

  // ===== 薪资方案板块 =====
  async loadPlans() {
    const [t, p] = await Promise.all([
      api.adminGet('/admin/technicians'),
      api.adminGet('/admin/salary-plans')
    ])
    const byTech = {}
    ;(p.plans || []).forEach((x) => { byTech[x.technicianId] = x })
    const label = (plan) => {
      if (!plan) return '按全店默认'
      const mode = plan.mode || 'ladder'
      if (mode === 'fixed') return '底薪+固定提成'
      if (mode === 'custom') return '自定义'
      return `底薪+阶梯(${plan.ladderMode === 'progressive' ? '阶梯' : '阶段'})`
    }
    this.setData({
      defaultPlanLabel: label(p.defaultPlan),
      plans: (t.technicians || [])
        .filter((x) => x.is_active !== 0)
        .map((x) => ({ id: x.id, name: x.name, label: label(byTech[x.id]) }))
    })
  },

  // ===== 账号管理板块 =====
  async loadAccounts() {
    const [t, a] = await Promise.all([
      api.adminGet('/admin/technicians'),
      api.adminGet('/admin/staff-accounts').catch(() => ({ accounts: [] }))
    ])
    const byTech = {}
    ;(a.accounts || []).forEach((x) => { byTech[x.technicianId] = x })
    this.setData({
      list: (t.technicians || []).map((tech) => {
        const ac = byTech[tech.id]
        return {
          id: tech.id,
          name: tech.name,
          title: tech.title || '',
          av: (tech.name || '?').slice(0, 1),
          active: tech.is_active !== 0 && tech.isActive !== false,
          acct: ac ? { id: ac.id, username: ac.username, disabled: ac.status !== 'active' } : null
        }
      })
    })
  },

  /* ===== 屏 4a/4a-2 排班(内嵌,不再跳页)=====
     按「天」做行,每行列出全部技师的时段胶囊(全天实色/半天半填色/休虚线),行尾在岗数。
     时段与冲突判定都在后端:撞上已有预约只回冲突单列表提醒,不硬拦。 */
  async loadWeek(from) {
    this.setData({ 'sc.from': from, 'sc.loading': true })
    try {
      const [week, settings] = await Promise.all([
        api.adminGet(`/admin/schedule-week?from=${encodeURIComponent(from)}`),
        api.adminGet('/admin/schedule-settings').catch(() => ({ afternoonStart: '14:30' }))
      ])
      const techs = (week.technicians || []).filter((t) => t.isActive !== false)
      const byKey = {}
      ;(week.schedules || []).forEach((x) => { byKey[`${x.date}|${x.technicianId}`] = x })
      const counts = {}
      ;(week.bookingCounts || []).forEach((c) => { counts[`${c.date}|${c.technicianId}`] = c.count })
      const split = settings.afternoonStart || '14:30'
      const today = storeToday()
      const days = (week.days || []).map((d) => {
        const caps = techs.map((t) => {
          const x = byKey[`${d.date}|${t.id}`]
          // 没排过班 = 跟随门店营业时间(视作全天),与后端 assertBookable 的兜底一致
          if (!x) return { techId: t.id, name: t.name, kind: 'full', label: `${d.openTime}–${d.closeTime}`, working: true, count: counts[`${d.date}|${t.id}`] || 0 }
          if (!x.isWorking) return { techId: t.id, name: t.name, kind: 'off', label: '休', working: false, count: 0 }
          const isAm = x.endTime === split
          const isPm = x.startTime === split
          const isFull = x.startTime === d.openTime && x.endTime === d.closeTime
          return {
            techId: t.id, name: t.name, working: true,
            kind: isFull ? 'full' : (isAm ? 'am' : (isPm ? 'pm' : 'custom')),
            label: isFull ? `${x.startTime}–${x.endTime}`
              : (isAm ? `上午 ${x.startTime}–${x.endTime}` : (isPm ? `下午 ${x.startTime}–${x.endTime}` : `${x.startTime}–${x.endTime}`)),
            count: counts[`${d.date}|${t.id}`] || 0
          }
        })
        return {
          date: d.date,
          title: `周${wdOf(d.date)} ${Number(d.date.slice(5, 7))}.${Number(d.date.slice(8))}`,
          isToday: d.date === today,
          isClosed: d.isClosed,
          openTime: d.openTime,
          closeTime: d.closeTime,
          onDuty: caps.filter((c) => c.working).length,
          caps
        }
      })
      /* 周范围写的是这一周的头尾,不是传进来的那一天 ——
         后端按「包含该日的整周」返回(周一起),用 from 当起点会显示成「8月9日 – 8月9日」。 */
      const first = days.length ? days[0].date : from
      const last = days.length ? days[days.length - 1].date : from
      const rangeText = `${Number(first.slice(5, 7))}月${Number(first.slice(8))}日 – ${Number(last.slice(5, 7))}月${Number(last.slice(8))}日`
      this.setData({ 'sc.loading': false, 'sc.days': days, 'sc.afternoonStart': split, 'sc.rangeText': rangeText, 'sc.weekStart': first })
    } catch (e) {
      this.setData({ 'sc.loading': false })
      wx.showToast({ title: (e && e.message) || '加载排班失败', icon: 'none' })
    }
  },
  prevWeek() { this.loadWeek(shiftDate(this.data.sc.weekStart || this.data.sc.from, -7)) },
  nextWeek() { this.loadWeek(shiftDate(this.data.sc.weekStart || this.data.sc.from, 7)) },
  thisWeek() { this.loadWeek(storeToday()) },

  openSheet(e) {
    const { date, tech, name, kind } = e.currentTarget.dataset
    const day = this.data.sc.days.find((d) => d.date === date)
    this.setData({
      scConflicts: [],
      shiftSheet: {
        date, tech, name, kind,
        weekday: wdOf(date),
        start: day ? day.openTime : '10:00',
        end: day ? day.closeTime : '19:00',
        repeat: false
      }
    })
  },
  closeSheet() { this.setData({ shiftSheet: null, scConflicts: [] }) },
  pickKind(e) { this.setData({ 'shiftSheet.kind': e.currentTarget.dataset.k }) },
  onStart(e) { this.setData({ 'shiftSheet.start': e.detail.value }) },
  onEnd(e) { this.setData({ 'shiftSheet.end': e.detail.value }) },
  toggleRepeat() { this.setData({ 'shiftSheet.repeat': !this.data.shiftSheet.repeat }) },

  async saveShift() {
    const x = this.data.shiftSheet
    const body = { date: x.date, applyToFollowingWeeks: x.repeat ? 8 : 0 }
    if (x.kind === 'custom') { body.startTime = x.start; body.endTime = x.end; body.isWorking = true }
    else body.shift = x.kind
    try {
      const r = await api.adminPatch(`/admin/technicians/${encodeURIComponent(x.tech)}/schedule`, body)
      const conflicts = r.conflicts || []
      if (conflicts.length) {
        // 只报不拦(后端已经写进去了),把撞上的单列出来让老板自己判断
        this.setData({ scConflicts: conflicts })
        wx.showToast({ title: `已保存,但有 ${conflicts.length} 单落在时段外`, icon: 'none', duration: 2600 })
      } else {
        this.setData({ shiftSheet: null })
        wx.showToast({ title: x.repeat ? `已应用到之后每个周${x.weekday}` : '已保存', icon: 'none' })
      }
      this.loadWeek(this.data.sc.from)
    } catch (e) { wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' }) }
  },

  editSplit() {
    wx.showModal({
      title: '上下午分界', editable: true, placeholderText: '如 14:30', content: '',
      success: async (r) => {
        if (!r.confirm || !/^\d{2}:\d{2}$/.test((r.content || '').trim())) return
        try {
          await api.adminPut('/admin/schedule-settings', { afternoonStart: r.content.trim() })
          wx.showToast({ title: '已保存,半天班边界跟着走', icon: 'none' })
          this.loadWeek(this.data.sc.from)
        } catch (e) { wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' }) }
      }
    })
  },

  // 图上底部那颗按钮:把本周每个人的排法复制到之后 4 周
  applyWeekAhead() {
    wx.showModal({
      title: '应用到未来 4 周',
      content: '把本周每位技师的排法复制到接下来 4 周(已有排班会被覆盖)。',
      success: async (r) => {
        if (!r.confirm) return
        try {
          // 复用既有的 /admin/schedule-batch:把本周每人每天的排法逐条复制到之后 4 周
          const entries = []
          for (const d of this.data.sc.days) {
            for (const c of d.caps) {
              const isOff = c.kind === 'off'
              const range = isOff ? null : String(c.label).replace(/^[上下]午\s*/, '')
              const parts = range ? range.split('–') : []
              const startTime = parts[0] || d.openTime
              const endTime = parts[1] || d.closeTime
              for (let w = 1; w <= 4; w += 1) {
                entries.push({ technicianId: c.techId, date: shiftDate(d.date, 7 * w), startTime, endTime, isWorking: !isOff })
              }
            }
          }
          if (!entries.length) { wx.showToast({ title: '这周还没有排班', icon: 'none' }); return }
          await api.adminPost('/admin/schedule-batch', { entries })
          wx.showToast({ title: `已应用到未来 4 周(${entries.length} 条)`, icon: 'none' })
          this.loadWeek(this.data.sc.from)
        } catch (e) { wx.showToast({ title: (e && e.message) || '应用失败', icon: 'none' }) }
      }
    })
  },
  goDetail(e) {
    // 点技师行 → 该技师逐日明细(已有页)
    const { id, name } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/merchant/my-performance/index?technicianId=${encodeURIComponent(id)}&name=${encodeURIComponent(name || '')}` })
  },

  addTech() {
    wx.showModal({
      title: '新增员工', editable: true, placeholderText: '输入技师姓名',
      success: async (r) => {
        if (!r.confirm || !r.content || !r.content.trim()) return
        try { await api.adminPost('/admin/technicians', { name: r.content.trim() }); wx.showToast({ title: '已添加', icon: 'none' }); this.load() }
        catch (err) { wx.showToast({ title: (err && err.message) || '添加失败', icon: 'none' }) }
      }
    })
  },

  /* 用户名(店主 2026-08-09 拍板):拼音自动生成(小婕 → xiaojie),重名加数字后缀;
     弹窗里可以直接改,仍限英数并查重。拼音表只在服务端一份,这里先问一下预填值。 */
  async genAccount(e) {
    const id = e.currentTarget.dataset.id
    let username
    try {
      const sug = await api.adminGet(`/admin/staff-accounts/suggest?technicianId=${encodeURIComponent(id)}`)
      const typed = await new Promise((resolve) => {
        wx.showModal({
          title: `给「${sug.name}」建账号 · 用户名`,
          content: '',
          editable: true,
          placeholderText: `${sug.username}(直接确定就用这个)`,
          success: (m) => resolve(m.confirm ? (m.content || '').trim().toLowerCase() : null)
        })
      })
      if (typed === null) return
      if (typed && !/^[a-z0-9]{3,20}$/.test(typed)) { wx.showToast({ title: '用户名只能用英数,3–20 位', icon: 'none' }); return }
      username = typed || sug.username
    } catch (err) { /* 建议拿不到就让后端自己按拼音生成 */ }
    try {
      const r = await api.adminPost('/admin/staff-accounts', { technicianId: id, username })
      const text = `用户名:${r.username}\n初始密码:${r.initialPassword}`
      wx.showModal({
        title: '账号已生成', content: `${text}\n(只显示这一次,点「复制」发给员工)`,
        confirmText: '复制账号密码', cancelText: '知道了',
        success: (m) => { if (m.confirm) wx.setClipboardData({ data: text, success: () => wx.showToast({ title: '已复制,去粘贴给员工', icon: 'none' }) }) }
      })
      this.load()
    } catch (err) { wx.showToast({ title: (err && err.message) || '生成失败', icon: 'none' }) }
  },

  async resetPwd(e) {
    const id = e.currentTarget.dataset.acctid
    try {
      const r = await api.adminPost(`/admin/staff-accounts/${encodeURIComponent(id)}/reset-password`, {})
      wx.showModal({
        title: '密码已重置', content: `新初始密码:${r.initialPassword}\n员工下次登录需改密`,
        confirmText: '复制密码', cancelText: '知道了',
        success: (m) => { if (m.confirm) wx.setClipboardData({ data: r.initialPassword, success: () => wx.showToast({ title: '已复制,去粘贴给员工', icon: 'none' }) }) }
      })
    } catch (err) { wx.showToast({ title: (err && err.message) || '重置失败', icon: 'none' }) }
  },

  goDefaultPlan() { wx.navigateTo({ url: '/pages/merchant/salary-plan/index' }) },
  goPlan(e) {
    const { id, name } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/merchant/salary-plan/index?technicianId=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}` })
  },

  async toggleAcct(e) {
    const id = e.currentTarget.dataset.acctid
    try { await api.adminPost(`/admin/staff-accounts/${encodeURIComponent(id)}/toggle`, {}); wx.showToast({ title: '已切换', icon: 'none' }); this.load() }
    catch (err) { wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' }) }
  }
})
