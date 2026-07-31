const api = require('../../../utils/api')

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
    sched: { count: 0, items: [] }
  },

  onShow() { this.load() },

  async load() {
    const d = new Date()
    const wk = '日一二三四五六'[d.getDay()]
    this.setData({ dateText: `周${wk} ${d.getMonth() + 1}月${d.getDate()}日 · 今天该干什么` })

    let isOwner = true
    try {
      const me = await api.adminMe()
      isOwner = me && me.role === 'owner'
      this.setData({
        isOwner,
        myTechId: (me && me.technicianId) || '',
        roleLabel: isOwner ? '老板' : '员工',
        greeting: isOwner ? '嗨,老板 👋' : `嗨,${(me && me.displayName) || '伙伴'} 👋`
      })
    } catch (e) { /* 未登录/超时:保持默认 */ }

    // 今日台面 + 待写小记 + 客服 + 排班申请 并行拉
    try {
      const reqs = [
        api.adminGet('/admin/schedule-day').catch(() => null),
        api.adminGet('/admin/service-notes/pending').catch(() => ({ count: 0, items: [] })),
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
      const items = (pend.items || []).map((it) => ({
        bookingId: it.bookingId, userId: it.userId,
        customerName: it.customerName, serviceName: it.serviceName,
        technicianId: it.technicianId, technicianName: it.technicianName, time: it.time,
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
    })
  },

  goOrders() { wx.redirectTo({ url: '/pages/merchant/orders/index' }) },
  goWorkbench() { wx.redirectTo({ url: '/pages/merchant/workbench/index' }) },
  goSchedule() { wx.navigateTo({ url: '/pages/merchant/schedule/index' }) },
  goAttendance() { wx.navigateTo({ url: '/pages/merchant/attendance/index' }) },
  goFinance() { wx.navigateTo({ url: '/pages/merchant/finance/index' }) },
  goPerformance() { wx.navigateTo({ url: '/pages/merchant/my-performance/index' }) },
  goCustomers() { wx.navigateTo({ url: '/pages/merchant/customers/index' }) },
  goGallery() { wx.redirectTo({ url: '/pages/merchant/gallery/index' }) }
})
