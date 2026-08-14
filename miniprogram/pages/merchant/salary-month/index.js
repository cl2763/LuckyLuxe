const api = require('../../../utils/api')
const { storeMonth, refreshStoreClock, storeMoney } = require('../../../utils/storeclock')

function money(c) { return storeMoney(c, 0) } // 门店币种,不写死 $
function fmtDur(min) { if (!min) return '0m'; const h = Math.floor(min / 60), m = min % 60; return h ? `${h}h${m ? m + 'm' : ''}` : `${m}m` }
function pad(n) { return `${n}`.padStart(2, '0') }

Page({
  data: { month: '', monthText: '', rows: [], total: '', locked: false, keyMissing: false, lockedAt: '', locking: false, loading: true, paid: false, paidAt: '', paying: false },

  async onShow() {
    if (!(await api.guardOwner())) return
    await refreshStoreClock().catch(() => {})
    // 「本月」按门店时区算(跨时区时设备月份可能已经翻页)
    if (!this.data.month) this.setData({ month: storeMonth() })
    this.load()
  },

  async load() {
    const m = this.data.month
    this.setData({ monthText: `${Number(m.slice(0, 4))}年${Number(m.slice(5, 7))}月`, loading: true })
    if (!api.getFinanceKey()) {
      /* D29(D27 同族补漏):没开财务门禁的店不需要钥匙 —— 原来不问门禁直接判 keyMissing,
         工资入口就一直提示「去财务页解锁」。先问门禁;门禁开+钥匙过期由下面 FINANCE_LOCKED 兜底。 */
      let lockEnabled = false
      try { lockEnabled = Boolean((await api.adminGet('/admin/finance/lock-status')).enabled) } catch (e) { lockEnabled = false }
      if (lockEnabled) { this.setData({ keyMissing: true, loading: false }); return }
    }
    try {
      const [r, closeInfo] = await Promise.all([
        api.adminGet(`/admin/salary/estimate?month=${m}`),
        api.adminGet(`/admin/daily-close/month?month=${m}`).catch(() => ({ days: [], openDays: [], allClosed: true }))
      ])
      const rows = (r.rows || []).map((x) => ({
        ...x, av: (x.name || '技')[0],
        totalText: x.noPlan ? '未配方案' : money(x.totalCents),
        baseText: money(x.baseSalaryCents), handworkText: money(x.handworkCents),
        perfText: money(x.perfCents), commText: money(x.commissionCents),
        otText: x.overtimeMin ? `${fmtDur(x.overtimeMin)} → ${x.overtimeSegs} 段` : '无',
        otPayText: money(x.overtimePayCents),
        pctText: `${x.pct || 0}%${x.tierIndex >= 0 ? `(第${x.tierIndex + 1}档)` : ''}`,
        srcText: x.planSource === 'custom' ? '专属方案' : (x.planSource === 'default' ? '默认方案' : ''),
        cardText: money(x.cardCents), cardUseText: money(x.cardUseCents),
        rechText: money(x.rechargePayCents), rechUseText: money(x.rechargeCents),
        adjText: (x.adjustCents > 0 ? '+' : x.adjustCents < 0 ? '-' : '') + money(Math.abs(x.adjustCents)) // 正负号自己拼,不做 '$-'→'-$' 的币符搬运(写死了美元符)
      }))
      this.setData({
        rows, total: money(r.totalCents), keyMissing: false, loading: false,
        locked: Boolean(r.locked),
        lockedAt: r.lockedAt ? String(r.lockedAt).slice(0, 16).replace('T', ' ') : '',
        paid: Boolean(r.paid),
        paidAt: r.paidAt ? String(r.paidAt).slice(0, 16).replace('T', ' ') : '',
        /* 屏 2:归属备注区已整体退役(代付不涉技师业绩归属,且日结已逐日确认过),
           改成日结业绩模块 —— 业绩口径就是「已确认日结累加」,没日结的天在这里一目了然。 */
        closeDays: (closeInfo.days || []).map((d) => ({
          date: d.date,
          confirmed: d.confirmed,
          line: `${d.orderCount} 单 · ${money(d.revenueCents)}${d.pendingAllocation ? ` · ${d.pendingAllocation} 单待分配` : (d.confirmed ? '' : ' · 未确认')}`
        })),
        openDays: (closeInfo.openDays || []).length,
        zeroHint: !(closeInfo.days || []).length
      })
    } catch (err) {
      if (err && err.code === 'FINANCE_LOCKED') { this.setData({ keyMissing: true, loading: false }); return }
      this.setData({ loading: false })
      wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' })
    }
  },

  goDailyClose(e) {
    wx.navigateTo({ url: `/pages/merchant/daily-close/index?date=${encodeURIComponent(e.currentTarget.dataset.date)}` })
  },

  // 确认并锁定当月工资表:快照存档,防事后改数;锁定后 estimate 一律回快照
  lockMonth() {
    if (this.data.locking) return
    // 设计图:「确认并锁定 X月 工资表(需全部日结完成)」—— 与网页端同一门槛
    if (this.data.openDays) {
      wx.showModal({ title: '还不能锁定', showCancel: false, confirmText: '知道了',
        content: `本月还有 ${this.data.openDays} 天没日结,锁定后这几天的业绩就永远算不进来了。先去日结。`,
        fail: (e) => console.warn('[showModal fail]', e) // S组卫生批:fail=开发者域错误,console 留痕不弹 UI(toast 会撞转场,D27 家族)
      })
      return
    }
    wx.showModal({
      title: `锁定 ${this.data.monthText} 工资表`,
      content: '按当前数字生成工资表存档;锁定后业绩/考勤再变动也不影响本月工资。确认?',
      confirmText: '确认锁定',
      success: async (r) => {
        if (!r.confirm) return
        this.setData({ locking: true })
        try {
          await api.adminPost('/admin/salary/lock', { month: this.data.month })
          wx.showToast({ title: '已锁定存档', icon: 'success' })
          this.load()
        } catch (err) { wx.showToast({ title: (err && err.message) || '锁定失败', icon: 'none', duration: 2500 }) }
        this.setData({ locking: false })
      },
      fail: (e) => console.warn('[showModal fail]', e) // S组卫生批:fail=开发者域错误,console 留痕不弹 UI(toast 会撞转场,D27 家族)
    })
  },
  unlockMonth() {
    wx.showModal({
      title: '解锁重算',
      content: `删除 ${this.data.monthText} 的锁定存档,回到实时试算(可重新锁定)。确认?`,
      confirmText: '解锁',
      success: async (r) => {
        if (!r.confirm) return
        try {
          await api.adminPost('/admin/salary/unlock', { month: this.data.month })
          wx.showToast({ title: '已解锁', icon: 'none' })
          this.load()
        } catch (err) { wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none', duration: 2600 }) }
      },
      fail: (e) => console.warn('[showModal fail]', e) // S组卫生批:fail=开发者域错误,console 留痕不弹 UI(toast 会撞转场,D27 家族)
    })
  },
  // 发放入账:逐人写入账本支出(category=工资);账本只追加,发错走红字冲销
  payout() {
    if (this.data.paying) return
    wx.showModal({
      title: `发放 ${this.data.monthText} 工资`,
      content: `将按锁定的工资表,把每人应发金额写入财务账本(支出·工资),合计 ${this.data.total}。入账后不可解锁,发错需红字冲销。确认发放?`,
      confirmText: '确认发放',
      success: async (r) => {
        if (!r.confirm) return
        this.setData({ paying: true })
        try {
          const res = await api.adminPost('/admin/salary/payout', { month: this.data.month })
          wx.showToast({ title: `已入账 ${res.count} 人`, icon: 'success' })
          this.load()
        } catch (err) { wx.showToast({ title: (err && err.message) || '发放失败', icon: 'none', duration: 2600 }) }
        this.setData({ paying: false })
      },
      fail: (e) => console.warn('[showModal fail]', e) // S组卫生批:fail=开发者域错误,console 留痕不弹 UI(toast 会撞转场,D27 家族)
    })
  },

  prevMonth() { this.shift(-1) },
  nextMonth() { this.shift(1) },
  shift(n) {
    const [y, m] = this.data.month.split('-').map(Number)
    const d = new Date(y, m - 1 + n, 1)
    this.setData({ month: `${d.getFullYear()}-${pad(d.getMonth() + 1)}` })
    this.load()
  },

  goUnlock() { wx.navigateTo({ url: '/pages/merchant/finance/index' }) },

  // 手动调整(锁定前):补贴填正数,扣款填负数,必须写备注
  adjust(e) {
    if (this.data.locked) { wx.showToast({ title: '已锁定,先解锁再调整', icon: 'none' }); return }
    const { tid, name } = e.currentTarget.dataset
    wx.showModal({
      title: `调整 ${name} 的工资`, editable: true,
      placeholderText: '金额$,可负,如 50 或 -20',
      success: (r) => {
        if (!r.confirm) return
        const v = Number(String(r.content).replace(/[^\d.-]/g, ''))
        if (!Number.isFinite(v) || v === 0) { wx.showToast({ title: '金额无效(填 0 以外的数)', icon: 'none' }); return }
        wx.showModal({
          title: '调整备注(必填)', editable: true, placeholderText: '如:代班补贴 / 迟到扣款',
          success: async (m) => {
            if (!m.confirm) return
            const note = (m.content || '').trim()
            if (!note) { wx.showToast({ title: '备注必填', icon: 'none' }); return }
            try {
              await api.adminRequest('/admin/salary/adjust', 'PUT', { month: this.data.month, technicianId: tid, adjustCents: Math.round(v * 100), note })
              wx.showToast({ title: '已调整', icon: 'success' })
              this.load()
            } catch (err) { wx.showToast({ title: (err && err.message) || '调整失败', icon: 'none', duration: 2500 }) }
          },
          fail: (e) => console.warn('[showModal fail]', e) // S组卫生批补账①:嵌套内层弹窗,codemod 整块吞跳过,补挂
        })
      },
      fail: (e) => console.warn('[showModal fail]', e) // S组卫生批:fail=开发者域错误,console 留痕不弹 UI(toast 会撞转场,D27 家族)
    })
  },
  goPlan(e) {
    const { tid, name } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/merchant/salary-plan/index?technicianId=${encodeURIComponent(tid)}&name=${encodeURIComponent(name)}` })
  }
})
