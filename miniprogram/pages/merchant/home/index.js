const api = require('../../../utils/api')
const { storeMoney } = require('../../../utils/storeclock')
const { buildOwnerHome, clockGate, clockFailText, staffSmalls, STAFF_PERIODS } = require('../../../utils/dashboard-view')
const { loadNumberFont } = require('../../../utils/numfont')   // D168 段 4:数字大字字体,拿不到就如实说
const { currentTheme, themeClass } = require('../../../utils/theme')   // D183:明暗双模式

/* 🔴 D180(店主 2026-09-09):轮播间隔 6 秒 → **4 秒**。
   图 §一 **没写间隔**(6 秒只写在 §五 全屏态),所以原来那个 6 秒是自己定的;
   手机上第一屏 4 秒一换,既看得清又能感到它在动。**全屏态维持 6 秒不动**(那是图上写死的)。 */
const ROTATE_MS = 4000
const HINT_KEY = 'll-dh-carousel-hint'   // 「自动轮播中」那句提示,每台设备只出一次

Page({
  data: {
    greeting: '嗨,老板 👋',
    roleLabel: '老板',
    isOwner: true,
    myTechId: '',
    dateText: '',
    brief: '',
    briefActions: [],
    briefLoading: false,
    nudges: [], // 员工:老板发来的站内提醒(未读)
    remindingAll: false,
    // 手风琴:同时只展开一条('' | today | cs | notes | sched)
    expand: '',
    // 今日台面(老板:全店汇总;员工:本人)
    board: { total: 0, active: 0, waiting: 0, done: 0, techs: 0 },
    // 客服工作台(待人工+待报价 合并)
    cs: { human: 0, quote: 0, total: 0 },
    // 服务小记(按单判断:完成未写=待写)
    notes: { count: 0, items: [], groups: [] }, // groups 仅老板:按技师分组
    // 排班申请(老板)
    sched: { count: 0, items: [] },
    // 沉睡召回周报(老板;每周自动生成,有沉睡客才显示这一条)
    digest: { count: 0, items: [] },
    /* ── 老板视角业绩大屏(图 v3.2 §一,段 9)。三态:loading / failed / ready ── */
    storeLine: '',
    /* ── 员工视角 · 打卡门(图 v3.2 §二,段 10)── */
    gate: { state: 'gate', showButton: true, showBoard: false, badge: '', note: '' },
    shiftLine: '',
    clockErr: '',
    staffPeriod: 'today',
    staffPeriods: STAFF_PERIODS.map((p) => ({ ...p, on: p.key === 'today' })),
    staffPerf: '—',
    staffStats: [],
    dhState: 'loading',
    dhPeriod: 'today',
    dhClosed: false,
    themeClass: '',
    dh: null,
    /* 轮播:大数字现在放大的是哪一个指标(dots 与它一一对应) */
    dhMetric: 'revenue',
    dhPaused: false,
    dhHint: false
  },

  onLoad() {
    /* 数字大字的字体:能加载就加载,加载不成**把原因说出来**(不假装)。见 utils/numfont.js 抬头。 */
    loadNumberFont().then((r) => { this._numFont = r })
  },

  onShow() {
    /* D183:每次回到首页都按当下的偏好挂 class(在「我的」里改完回来就该是新的) */
    this.setData({ themeClass: themeClass(currentTheme()) })
    if (!api.guardMerchant()) return
    if (this.data.isOwner) this.loadPulse(); else this.loadStaff()
    this.setData({ aiEnabled: api.merchantHasAi() })
    // 刷一次权限:没开通 AI 智能包就不显示 AI 每日总结 / 召回周报
    api.refreshMerchantAi().then((on) => this.setData({ aiEnabled: on }))
    this.load()
  },

  /* 业绩大屏:三条接口与网页端**同一份数据**(一份数据两端渲染律)。
     句子全由 `utils/dashboard-view.js` 出 —— 这一页零计算、零拼串、不碰币符。 */
  async loadPulse() {
    const period = this.data.dhPeriod
    this.setData({ dhState: this.data.dh ? this.data.dhState : 'loading' })
    try {
      /* 🔴 双端同病(店主《双端同病检查律》):网页端那边查出 AI 今日一句从来没落过库、
         页面读的是一个没人赋值的变量。小程序这边是**同一个病的另一种长法** ——
         它读的是 `pulse.aiLine`,而 pulse 响应里**从来就没有这个字段**。
         两端一起修:后端新增只读口 `/admin/dashboard/ai-line`,两端都读它。 */
      const [pulse, now, todo, ai] = await Promise.all([
        api.adminGet(`/admin/dashboard/pulse?period=${period}`),
        api.adminGet('/admin/dashboard/now'),
        api.adminGet('/admin/dashboard/todo'),
        api.adminGet('/admin/dashboard/ai-line').catch(() => null),
      ])
      const d = new Date()
      const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      /* 币种红线:钱怎么写全由 `dashboard-view` 按**本次下发的** currencyDisplay 决定,
         这一页一个格式化动作都不做(storeMoney 只作它拿不到下发时的兜底)。 */
      const dh = buildOwnerHome({ pulse, now, todo, period, nowHM: hm, storeMoney, headKey: this.data.dhMetric })
      /* 折线在小程序里画成一排小竖条(没有 svg):把值归一到 0–100 的高度。
         全 0 的那一支上面已经把 spark 清空了,所以这里不会出现「一排贴地的条」。 */
      const max = Math.max(1, ...(dh.spark || []).map((x) => Math.abs(Number(x) || 0)))
      /* 🔴 05t 段 6(店主 05s §段9 之二):**0 的那一根高度就是 0**,不许给它一个 4% 的底。
         原来 `Math.max(4, …)` 让每一根都至少 4% —— 七天全 0 时看上去是七根矮实心柱,
         「像有数」比「没有数」更坏(全 0 那一支上游已经把 spark 清空了,
         但只要有一天是 0,那一天照样不许长出一根柱子来)。 */
      dh.sparkBars = (dh.spark || []).map((x) => {
        const v = Math.abs(Number(x) || 0)
        return v === 0 ? 0 : Math.max(4, Math.round((v / max) * 100))
      })
      /* 🔴 字段名照接口来:`/admin/dashboard/now` 给的是 customer / service / tech
         (第一版我按 customerName/serviceName 取,截图里那一行成了「02:00 ·」——
         名字和项目全空。**接口给什么就取什么**,不许照着自己记的字段名写。) */
      dh.next3 = ((now && now.next3) || (now && now.next ? [now.next] : [])).slice(0, 3).map((b, i) => ({
        id: b.id || `n${i}`, time: b.time || '',
        text: [b.customer, b.service, b.tech].filter(Boolean).join(' · '),
        status: b.statusText || '待到店',
      }))
      dh.nextHint = dh.next3.length ? '此刻之后的前 3 条' : ''
      dh.aiLine = (ai && ai.line && ai.line.text) || ''
      dh.aiAt = (ai && ai.line && ai.line.at) || ''
      this._pulse = pulse; this._now = now; this._todo = todo
      this.setData({ dh, dhState: 'ready', dhClosed: Boolean(now && now.closed) })
      this.scheduleRotate()
    } catch (e) {
      /* 取数失败:**整块换一句话,不显示旧数、不显示 0**(图 §六) */
      this.clearRotate()
      this.setData({ dh: null, dhState: 'failed' })
    }
  },

  /* 打卡门:**走现有考勤接口**(不另做一套)。三态由 `clockGate` 判,页面不自己想。 */
  async loadStaff() {
    const period = this.data.staffPeriod
    try {
      const [att, now, perf] = await Promise.all([
        api.adminGet('/admin/attendance/today').catch(() => null),
        api.adminGet('/admin/dashboard/now').catch(() => null),
        api.adminGet('/admin/my-performance').catch(() => null),
      ])
      const scheduled = Boolean(att && att.scheduledEnd)
      const gate = clockGate(att, { scheduled, closed: Boolean(now && now.closed) })
      const p = (perf && perf.performance) || null
      const money = p && p.currencyDisplay ? null : null
      this.setData({
        gate,
        shiftLine: scheduled ? `今天的班 · 到 ${att.scheduledEnd}` : '今天没有你的班',
        staffPeriods: STAFF_PERIODS.map((x) => ({ ...x, on: x.key === period })),
        /* 业绩数字走现有「我的业绩」口径(与薪资方案同源);拿不到出「—」,不编 0 */
        staffPerf: p && p.perfText ? p.perfText : (p && p.perfCents !== undefined && p.perfCents !== null ? storeMoney(p.perfCents) : '—'),
        staffStats: staffSmalls({ perf: p, now, week: (att && att.week ? { hours: att.weekHours } : null) }),
      })
    } catch (e) {
      this.setData({ gate: { state: 'gate', showButton: true, showBoard: false, badge: '', note: '' } })
    }
  },

  async clockIn() { await this.doClock('in') },
  async clockOut() { await this.doClock('out') },
  async doClock(action) {
    this.setData({ clockErr: '' })
    try {
      const wifi = await new Promise((resolve) => wx.getConnectedWifi({
        success: (r) => resolve(r && r.wifi ? { ssid: r.wifi.SSID, bssid: r.wifi.BSSID } : {}),
        fail: () => resolve({}),   // wx.* 一律有 fail 处理(波及面回归律四之八⑤)
      }))
      await api.adminPost('/admin/attendance/clock', { action, wifi })
      await this.loadStaff()      // 成功才让大屏浮现 —— 不成功不许假装打了
    } catch (e) {
      /* 打卡失败:钮不收起、说清原因、**不进大屏** */
      this.setData({ clockErr: clockFailText(e) })
    }
  },

  switchStaffPeriod(e) {
    const p = e.currentTarget.dataset.p
    if (!p || p === this.data.staffPeriod) return
    this.setData({ staffPeriod: p })
    this.loadStaff()
  },

  switchPeriod(e) {
    const p = e.currentTarget.dataset.p
    if (!p || p === this.data.dhPeriod) return
    this.setData({ dhPeriod: p })
    this.loadPulse()
  },

  /* ══ D179 · 图 §六「动作 → 结果」那张表(店主 2026-09-09:「你需要去增加一些交互」)══
     她要的东西图上早就写了,只是一条都没做。这里落三条(其余四条本来就有):
       · 点大数字 / 左右滑 → **暂停轮播并切指标**;再点继续;
       · 长按大数字 / 点小牌 → 跳这个指标对应的那一页;
       · 点「今日预约」那格 → 跳今日台面。
     🔴 「暂停/继续」与「切指标」**只有一处实现**(`switchMetric` + `paused`),
     滑动与点击都走它 —— 不许为手势另写一套。 */
  tapBig() {
    const paused = !this.data.dhPaused
    this.setData({ dhPaused: paused })
    if (paused) {
      this.clearRotate()
      wx.showToast({ title: '轮播已暂停,再点一下继续', icon: 'none', duration: 1400, fail: () => {} })
      /* 下一个指标先切过去(店主那句「点大数字**并切指标**」) */
      this.nextMetric()
    } else {
      this.scheduleRotate()
      wx.showToast({ title: '轮播继续', icon: 'none', duration: 1000, fail: () => {} })
    }
  },
  nextMetric() {
    const KEYS = ['revenue', 'cash', 'cardUse', 'newCard', 'visits']
    const i = KEYS.indexOf(this.data.dhMetric)
    this.setData({ dhMetric: KEYS[(i + 1) % KEYS.length] })
    this.repaintMetric()
  },
  swipeStart(e) { this._sx = (e.touches && e.touches[0] && e.touches[0].clientX) || 0 },
  swipeEnd(e) {
    const x = (e.changedTouches && e.changedTouches[0] && e.changedTouches[0].clientX) || 0
    if (Math.abs(x - (this._sx || 0)) < 40) return       // 没滑动,当点击处理(bindtap 会接)
    this.setData({ dhPaused: true })
    this.clearRotate()
    this.nextMetric()
  },
  /* 长按大数字 / 点小牌 → 各指标各去各的地方(图 §六 第 4 行原文) */
  jumpMetric(e) {
    const k = (e.currentTarget.dataset || {}).k || this.data.dhMetric
    const to = {
      revenue: '/pages/merchant/finance/index',
      cash: '/pages/merchant/finance/index',
      cardUse: '/pages/merchant/finance-txns/index',
      newCard: '/pages/merchant/customers/index',
      visits: '/pages/merchant/schedule-day/index',
      bookings: '/pages/merchant/schedule-day/index',   // 今日预约那格 → 今日台面(第 5 行)
    }[k]
    if (!to) return
    wx.navigateTo({ url: to, fail: () => wx.switchTab({ url: to, fail: () => wx.showToast({ title: '这一项暂时打不开', icon: 'none' }) }) })
  },

  /* 轮播换指标:**只重画手上的数,一个请求都不发**(与网页端同一条规矩)。
     `buildOwnerHome` 是纯函数,换个 headKey 重跑一遍就行。 */
  switchMetric(e) {
    const k = e.currentTarget.dataset.k
    if (!k || k === this.data.dhMetric) return
    this.setData({ dhMetric: k })
    this.repaintMetric()
  },
  repaintMetric() {
    if (!this.data.dh) return
    const dh = buildOwnerHome({ pulse: this._pulse, now: this._now, todo: this._todo,
      period: this.data.dhPeriod, nowHM: this.data.dh.asOfHM || '', storeMoney, headKey: this.data.dhMetric })
    /* 折线、下一位、AI 一句这几段不随轮播变,原样带过来(重算一遍等于再拼一次串) */
    this.setData({ dh: { ...this.data.dh, ...dh, sparkBars: this.data.dh.sparkBars,
      next3: this.data.dh.next3, nextHint: this.data.dh.nextHint,
      aiLine: this.data.dh.aiLine, aiAt: this.data.dh.aiAt } })
  },
  /* 6 秒自己走一格。用 `setTimeout` 一次一排:页面隐藏/卸载时清掉,
     不留一条永远在跑的线(小程序里挂着的 interval 是最常见的耗电来源)。 */
  scheduleRotate() {
    this.clearRotate()
    if (this.data.dhState !== 'ready' || !this.data.isOwner || this.data.dhPaused) return   // 暂停了就不排下一次
    const KEYS = ['revenue', 'cash', 'cardUse', 'newCard', 'visits']
    this._rotate = setTimeout(() => {
      const i = KEYS.indexOf(this.data.dhMetric)
      this.setData({ dhMetric: KEYS[(i + 1) % KEYS.length] })
      this.repaintMetric()
      this.firstHint()
      this.scheduleRotate()
    }, ROTATE_MS)
  },
  clearRotate() { if (this._rotate) { clearTimeout(this._rotate); this._rotate = null } },
  /* 第一次轮播换指标时淡入一句提示,2 秒后消失,**每台设备只出一次**(存 storage)。
     为什么只出一次:它是「告诉你这里会自动转」,不是每次都要念一遍的通知。 */
  firstHint() {
    try { if (wx.getStorageSync(HINT_KEY)) return } catch (e) { return }
    this.setData({ dhHint: true })
    try { wx.setStorageSync(HINT_KEY, 1) } catch (e) { /* 存不上就下次再提示一次,不影响功能 */ }
    setTimeout(() => this.setData({ dhHint: false }), 2200)
  },
  onHide() { this.clearRotate() },
  onUnload() { this.clearRotate() },

  goTodo(e) {
    const k = e.currentTarget.dataset.k
    const to = { aiHandoff: '/pages/merchant/conversation/index', quotePending: '/pages/merchant/quote-calc/index',
      notePending: '/pages/merchant/orders/index', shiftApproval: '/pages/merchant/schedule-day/index',
      dailyClose: '/pages/merchant/daily-close/index' }[k]
    if (to) wx.navigateTo({ url: to, fail: () => wx.showToast({ title: '这一项暂时打不开', icon: 'none' }) })
  },

  async load() {
    const d = new Date()
    const wk = '日一二三四五六'[d.getDay()]
    this.setData({ dateText: `${d.getMonth() + 1} 月 ${d.getDate()} 日 周${wk}` })   // 图 §一:日期就是日期,不带口号

    let isOwner = true
    try {
      const me = await api.adminMe()
      isOwner = me && me.role === 'owner'
      if (isOwner) this.loadPulse(); else this.loadStaff()   // 角色拿到才知道该拉哪一份
      this.setData({
        isOwner,
        myTechId: (me && me.technicianId) || '',
        roleLabel: isOwner ? '老板' : '员工',
        // 昵称(店主 2026-08-10):老板位原来写死「嗨,老板」,昵称改了也不动 —— 现在两端都跟昵称走
        greeting: `嗨,${(me && me.displayName) || (isOwner ? '老板' : '伙伴')} 👋`,
        /* 图 §一 顶栏那一行:**店名 · 问候**。店名走 D156 定的 `storeName`(门店名,商家自己看的那个),
           取不到就只显示问候 —— 不回落到商户名,也不编一个店名(零回落)。 */
        storeLine: [(me && me.storeName) || '', `${(me && me.displayName) || (isOwner ? '店主' : '伙伴')},${new Date().getHours() < 12 ? '早上好' : (new Date().getHours() < 18 ? '下午好' : '晚上好')}`].filter(Boolean).join(' · ')
      })
    } catch (e) { /* 未登录/超时:保持默认 */ }

    // 今日台面 + 待写小记 + 客服 + 排班申请 并行拉
    try {
      const reqs = [
        api.adminGet('/admin/schedule-day').catch(() => null),
        // 回看 7 天:补结束的旧单(如昨天忘点完成、今天补点)也会进待写提醒,不会漏
        api.adminGet('/admin/service-notes/pending?days=7').catch(() => ({ count: 0, items: [] })),
        api.adminGet('/admin/wechat/conversations').catch(() => ({ conversations: [] })),
        api.adminGet('/admin/quote-requests').catch(() => ({ quoteRequests: [] }))
      ]
      if (isOwner) reqs.push(api.adminGet('/admin/schedule-requests').catch(() => ({ requests: [] })))
      const [day, pend, conv, quote, schedR] = await Promise.all(reqs)

      // 台面汇总
      const board = { total: 0, active: 0, waiting: 0, done: 0, techs: 0 }
      if (day && !day.isClosed) {
        const mine = this.data.myTechId
        const list = (day.bookings || []).filter((b) => isOwner || b.technicianId === mine)
        board.total = list.length
        list.forEach((b) => {
          if (b.arrivalState === 'active') board.active += 1
          else if (b.arrivalState === 'done') board.done += 1
          else board.waiting += 1
        })
        board.techs = (day.technicians || []).length
      }

      // 服务小记:员工=本人列表;老板=按技师分组
      const anchor = pend.date || ''
      const items = (pend.items || []).map((it) => ({
        bookingId: it.bookingId, userId: it.userId,
        customerName: it.customerName, serviceName: it.serviceName,
        technicianId: it.technicianId, technicianName: it.technicianName,
        // 非今天的单标上日期(如「7/29 10:00」),一眼看出是前几天补的
        time: (it.date && anchor && it.date !== anchor) ? `${Number(it.date.slice(5, 7))}/${Number(it.date.slice(8, 10))} ${it.time}` : it.time,
        av: (it.customerName || '客')[0]
      }))
      const gmap = {}
      items.forEach((it) => { (gmap[it.technicianName] = gmap[it.technicianName] || []).push(it) })
      const groups = Object.keys(gmap).map((name) => ({
        name, av: name.slice(0, 2), count: gmap[name].length,
        techId: gmap[name][0].technicianId || '',
        meta: gmap[name].map((x) => `${x.customerName}(${x.serviceName})`).join('、'),
        reminded: false, sending: false
      }))

      const human = (conv.conversations || []).filter((c) => c.status === 'needs_human').length
      const quoteN = (quote.quoteRequests || []).filter((q) => q.status === 'PENDING_STAFF').length
      const schedList = ((schedR && schedR.requests) || []).map((r) => ({
        id: r.id, line: `${r.technicianName || '员工'} 申请 ${r.date || ''} 调整`, note: r.note || ''
      }))

      this.setData({
        board,
        notes: { count: items.length, items, groups },
        cs: { human, quote: quoteN, total: human + quoteN },
        sched: { count: schedList.length, items: schedList }
      })
    } catch (e) { /* 忽略,展示 0 */ }

    // 员工:拉老板发来的站内提醒(未读横幅)
    if (!isOwner) {
      try {
        const r = await api.adminGet('/admin/staff-nudges/mine')
        this.setData({ nudges: r.nudges || [] })
      } catch (e) { /* 忽略 */ }
    }

    // 沉睡召回周报(老板;后端按周懒生成,可能含 AI 耗时,异步不阻塞主页)
    if (isOwner) {
      api.adminGet('/admin/recall-digest').then((r) => {
        const d = (r && r.digest) || {}
        this.setData({
          digest: {
            count: d.count || 0,
            items: (d.items || []).map((x) => ({ ...x, av: (x.name || '客')[0], spendText: storeMoney(x.spendCents, 0) }))
          }
        })
      }).catch(() => { /* 静默 */ })
    }

    // AI 总结(老板:一句摘要 + 行动建议;慢/失败时卡片仍在,用本地数据兜底)
    if (isOwner) {
      this.setData({ briefLoading: true })
      try {
        const r = await api.adminPost('/admin/ai/daily-brief', {})
        const data = (r && r.brief && r.brief.data) || {}
        this.setData({ brief: data.headlineZh || '', briefActions: (data.actionsZh || []).slice(0, 3), briefLoading: false })
      } catch (e) { this.setData({ briefLoading: false }) }
    }
  },

  // 员工:点掉提醒横幅(标已读)
  async dismissNudge(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ nudges: this.data.nudges.filter((n) => n.id !== id) })
    try { await api.adminPost(`/admin/staff-nudges/${encodeURIComponent(id)}/read`, {}) } catch (err) { /* 忽略 */ }
  },

  // 手风琴展开/收起
  toggle(e) {
    const k = e.currentTarget.dataset.k
    this.setData({ expand: this.data.expand === k ? '' : k })
  },

  // 服务小记:员工点「写小记」
  writeNote(e) {
    const { bid, uid, name, service, tech } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/merchant/service-note/index?userId=${encodeURIComponent(uid)}&name=${encodeURIComponent(name)}&service=${encodeURIComponent(service || '')}&tech=${encodeURIComponent(tech || '')}&bookingId=${encodeURIComponent(bid || '')}` })
  },
  // 服务小记:老板点「提醒」→ 站内提醒(员工打开小程序即见横幅)+ 话术进剪贴板(可再发微信)
  // 按钮三态:提醒 › → 发送中… → 已提醒 ✓(变灰,防重复点);后端同技师未读同类提醒只保留一条,重复点也不轰炸员工
  setGroup(name, patch) {
    const groups = this.data.notes.groups.map((g) => (g.name === name ? Object.assign({}, g, patch) : g))
    this.setData({ 'notes.groups': groups })
  },
  async remindTech(e) {
    const name = e.currentTarget.dataset.name
    const g = this.data.notes.groups.find((x) => x.name === name)
    if (!g || g.reminded || g.sending) return
    this.setGroup(name, { sending: true })
    const text = `${g.name}:今天还有 ${g.count} 单没写服务小记(${g.meta}),抽空补一下哈~`
    let sent = false
    if (g.techId) {
      try { await api.adminPost('/admin/staff-nudges', { technicianId: g.techId, type: 'service-note', message: text }); sent = true } catch (err) { /* 站内失败仍走复制 */ }
    }
    this.setGroup(name, { sending: false, reminded: sent })
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: sent ? `已提醒 ${g.name},话术也已复制` : '站内发送失败,话术已复制可发微信', icon: 'none', duration: 2200 })
    ,
      fail: () => wx.showToast({ title: '复制调用失败,请重试', icon: 'none' })
    })
  },
  async remindAll() {
    const gs = this.data.notes.groups
    if (!gs.length || this.data.remindingAll) return
    if (gs.every((g) => g.reminded)) { wx.showToast({ title: '都已提醒过啦', icon: 'none' }); return }
    this.setData({ remindingAll: true })
    let ok = 0
    for (const g of gs) {
      if (!g.techId || g.reminded) continue
      const msg = `${g.name}:今天还有 ${g.count} 单没写服务小记(${g.meta}),抽空补一下哈~`
      try { await api.adminPost('/admin/staff-nudges', { technicianId: g.techId, type: 'service-note', message: msg }); ok += 1; this.setGroup(g.name, { reminded: true }) } catch (err) { /* 继续下一个 */ }
    }
    this.setData({ remindingAll: false })
    const text = `今日服务小记待写:${gs.map((g) => `${g.name} 欠 ${g.count} 单(${g.meta})`).join(';')}。大家抽空补一下哈~`
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: ok ? `已提醒 ${ok} 位员工,群话术已复制` : '群话术已复制', icon: 'none', duration: 2200 })
    ,
      fail: () => wx.showToast({ title: '复制调用失败,请重试', icon: 'none' })
    })
  },

  // 召回周报:复制全部话术 / 去客户库
  copyDigest() {
    const items = this.data.digest.items
    if (!items.length) return
    const text = items.map((x) => `【${x.name}】${x.message}`).join('\n\n')
    wx.setClipboardData({ data: text, success: () => wx.showToast({ title: `已复制 ${items.length} 条话术,粘微信逐个发`, icon: 'none', duration: 2200 }) ,
      fail: () => wx.showToast({ title: '复制调用失败,请重试', icon: 'none' })
    })
  },
  goCustomersS() { wx.navigateTo({ url: '/pages/merchant/customers/index' }) },

  goOrders() { wx.redirectTo({ url: '/pages/merchant/orders/index' }) },
  goWorkbench() { wx.redirectTo({ url: '/pages/merchant/workbench/index' }) },
  goSchedule() { wx.navigateTo({ url: '/pages/merchant/schedule-day/index' }) },
  goAttendance() { wx.navigateTo({ url: '/pages/merchant/attendance/index' }) },
  goFinance() { wx.navigateTo({ url: '/pages/merchant/finance/index' }) },
  goPerformance() { wx.navigateTo({ url: '/pages/merchant/my-performance/index' }) },
  goCustomers() { wx.navigateTo({ url: '/pages/merchant/customers/index' }) },
  goGallery() { wx.redirectTo({ url: '/pages/merchant/gallery/index' }) }
})
