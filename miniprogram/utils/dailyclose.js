/* 日结(屏 1 下半)+ 金额更正(屏 1b)的**唯一一份实现**。
   设计图把日结画在「订单页 · 今日台面」网格下方,同时工资试算的「去日结」还要能直达 ——
   两处渲染同一套逻辑,所以抽成 mixin:两边 Object.assign 进 Page 选项即可,
   不会出现「改了一边忘了另一边」。

   金额红线:这里不算钱。分成比例是店长填的输入,金额一律由后端算好回传;
   进度/差额/合计全部照 /admin/daily-close 的返回值显示。 */
const api = require('./api')
const { storeToday } = require('./storeclock')
const { formatMoney, displayOf } = require('./money')

function shiftDate(d, n) {
  const x = new Date(`${d}T12:00:00Z`)
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}

// 两处共用的初始 data(展开进各自 Page 的 data)
const dailyCloseData = {
  date: '', loading: true, isToday: true, v: null, open: {}, shares: {},
  correcting: null, newTotal: '', reason: '',
  // D79 现金手记的表单态(金额/备注只进 data,不回写输入框 —— 敲的过程中不许重画)
  noteKind: '', noteKindIndex: 0, noteSignIndex: 0, noteAmount: '', noteText: ''
}

const dailyCloseMixin = {


  async loadClose(date) {
    // D3:当期才叫「今天」,翻到别的日子要叫「返回今天」(两个落点共用这一份 mixin,一处改两处生效)
    this.setData({ date, loading: true, isToday: date === storeToday() })
    try {
      const r = await api.adminGet(`/admin/daily-close?date=${encodeURIComponent(date)}`)
      const d = displayOf(r.dailyClose)
      const m = (c) => formatMoney(c, d, d.trimZeroDecimals ? 0 : 2)
      const dc = r.dailyClose
      const open = {}
      const shares = {}
      ;(dc.pendingAllocation || []).forEach((p, i) => {
        open[p.settlementId] = i === 0 // 第一张默认展开,其余收起(设计图:一开一收)
        p.technicians.forEach((t, j) => {
          shares[`${p.settlementId}|${t.technicianId}`] = p.technicians.length === 1
            ? 100
            : (j === 0 ? p.defaultSplit.mainPct : p.defaultSplit.assistPct)
        })
      })
      this.raw = dc
      this.setData({
        loading: false, open, shares,
        v: {
          date: dc.date,
          confirmed: dc.status === 'confirmed',
          confirmedAt: String(dc.confirmedAt || '').slice(0, 16).replace('T', ' '),
          reopenCount: dc.reopenCount,
          orderCount: dc.orderCount,
          revenue: m(dc.revenueCents),
          canConfirm: dc.canConfirm,
          blockers: (dc.blockers || []).map((b) => b.message),
          /* D57/D58(店主 08-21):未签单=独立可点行(不再是锁确认钮的死文本)——
             点行进结算页出码重推;确认钮不被未签单阻塞(未签单只影响它自己)。 */
          unsigned: (dc.unsignedList || []).map((u) => ({
            id: u.settlementId, code: u.code,
            // D65-b:金额=头条「本单到店支付」(cashDueCents),价值总额不再裸出
            label: `${u.timeText} ${u.customerName} · ${u.code} · 到店支付 ${m(u.cashDueCents)}`
          })),
          /* D2:跨零点自解释 —— 台面「本日休息」空态要用同一句话(两处自洽);
             R1:已确认但账目对不上时,这天要自己说出来,不许只显示「已确认」。 */
          crossDayCount: dc.crossDayCount || 0,
          lateSignNotice: dc.lateSignNotice || '',
          staleClose: Boolean(dc.staleClose),
          confirmedSnapshot: dc.confirmedSnapshot || null,
          pending: (dc.pendingAllocation || []).map((p) => ({
            // 分成基数=业绩基数(券不扣技师);无券时与应收相等
            id: p.settlementId, code: p.code, timeText: p.timeText || '', crossDayNote: p.crossDayNote || '', total: m(p.perfBaseCents === undefined ? p.totalCents : p.perfBaseCents),
            couponNote: p.couponDiscountCents ? '业绩基数(不含券)' : '',
            // D59 案二提示句(店主 08-22):待分配单含未归属充值=行上明说(句后端唯一)
            rechargeNote: p.rechargeUnassignedText || '',
            who: p.servedPersonName || p.customerName || '',
            techLabel: p.technicians.length > 1 ? '双技师' : '单技师',
            techs: p.technicians.map((t, j) => ({
              id: t.technicianId, name: t.name,
              role: t.role === 'main' ? '主' : '副',
              nos: t.itemNos.join('、'),
              pct: p.technicians.length === 1 ? 100 : (j === 0 ? p.defaultSplit.mainPct : p.defaultSplit.assistPct)
            })),
            hasSnapshot: (dc.settlements.find((s) => s.settlementId === p.settlementId) || {}).hasSnapshot
          })),
          // 不需要分配、但同样要店长点确认的单(店主 08-09 口径:确认覆盖当日全部单)
          awaiting: (dc.awaitingConfirm || []).map((p) => ({
            id: p.settlementId, code: p.code, timeText: p.timeText || '', crossDayNote: p.crossDayNote || '',
            who: p.servedPersonName || p.customerName || '',
            amount: m(p.perfBaseCents),
            reason: p.reason,
            techs: p.technicians.map((t) => `${t.name}${t.sharePct !== null && t.sharePct !== undefined ? ` ${t.sharePct}%` : ''}`).join(' / '),
            hasSnapshot: p.hasSnapshot
          })),
          techs: (dc.technicians || []).map((t) => ({
            name: t.name, orderCount: t.orderCount,
            perf: t.pendingCount ? '待分配' : m(t.perfCents),
            deduct: t.releaseDeductCents ? `含售后扣回 −${m(t.releaseDeductCents)}` : '',
            card: m(t.cardUsedCents),
            recharge: t.rechargeTotalCents ? m(t.rechargeTotalCents) : '—',
            target: !t.target || !t.target.perfTargetCents ? '—'
              : (t.perfCents >= t.target.perfTargetCents ? '达标' : `差 ${m(t.target.perfTargetCents - t.perfCents)}`),
            hit: Boolean(t.target && t.target.perfTargetCents && t.perfCents >= t.target.perfTargetCents)
          })),
          tierChanges: (dc.anomalies?.tierChanges || []).map((a) => `${a.code} ${a.from}→${a.to}`),
          freeRemoval: (dc.anomalies?.freeRemoval || {}).count || 0,
          /* 业绩调整显式行(裁③:负数+关联单号,与网页日结同源同句)。
             08-27 起这一族还包含**金额更正**的扣回/补记 —— 标题与正负号都后端给,这里零判断。 */
          deductTitle: dc.deductListTitle || '',
          deducts: (dc.afterSalesDeductions || []).map((d) => ({
            time: d.timeText || '', tech: d.technicianName, label: d.label, amt: d.amountText || `−${m(d.deductCents)}`
          })),
          /* 🔴 N-5(店主 08-25 复核):退卡不进损益,但**现金必须扣** ——
             不扣的话「今天收现 2000、退顾客 400 → 抽屉实际 1600、日结报 2000」,
             店主晚上数钱对不上,而她不会怀疑退卡,会怀疑店员。句子后端给,这里零计算。 */
          /* v1.2 ②:收据式 —— 抬头句 + 大数 + 算式 + 脚注,全部后端给(与网页同句) */
          drawer: dc.cashDrawer ? {
            title: dc.cashDrawer.title || dc.cashDrawer.label,
            should: dc.cashDrawer.shouldHaveText,
            totalLabel: dc.cashDrawer.totalLabel || '',
            rows: (dc.cashDrawer.rows || []).map((r) => ({ label: r.label, amt: `${r.sign} ${r.amountText}`, neg: Boolean(r.negative) })),
            footnote: dc.cashDrawer.footnote || '',
            amendNote: dc.cashDrawer.amendNote || ''   // 更正后「营业额 ≠ 抽屉数」的那句解释(后端出句,双端同句)
          } : null,
          /* 🔴 D79(店主 2026-08-28)线下现金腿:买材料的现金、备用金、找零、更正后的现金找补。
             列表与金额句**全部后端给**(kindLabel / amountText),这里零拼串、零计算 —— 与网页端同源同句。 */
          notes: dc.cashNotes ? {
            label: dc.cashNotes.label || '现金手记',
            hint: dc.cashNotes.hint || '',
            kinds: dc.cashNotes.kinds || [],
            items: (dc.cashNotes.items || []).map((it) => ({
              id: it.id, kindLabel: it.kindLabel, note: it.note, amt: it.amountText, isReversal: it.isReversal
            }))
          } : null,
          headline: (dc.headline || []).map((h) => ({ label: h.label, value: h.value })),
          refundLine: (dc.refunds && dc.refunds.totalCents)
            ? `${dc.refunds.label} · ${dc.refunds.storedCount ? `储值 ${dc.refunds.storedCount} 笔` : ''}${dc.refunds.timecardCount ? ` 次卡 ${dc.refunds.timecardCount} 笔` : ''} 合计 ${m(dc.refunds.totalCents)}`
            : '',
          // 裁①+§十-7:次卡两条汇总单列(售卡=预收负债/核销=折算计业绩积分)
          tcSummary: (() => {
            const t = dc.timecardSummary || {}
            const bits = []
            if (t.soldCount) bits.push(`次卡售卡 ${t.soldCount} 张 +${m(t.soldCents)}(预收)`)
            if (t.redeemCount) bits.push(`次卡核销 ${t.redeemCount} 次(折算 ${m(t.redeemCents)})`)
            return bits.join(' · ')
          })()
        }
      })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: (e && e.message) || '加载日结失败', icon: 'none' })
    }
  },

  prevDay() { this.loadClose(shiftDate(this.data.date, -1)) },
  nextDay() { this.loadClose(shiftDate(this.data.date, 1)) },
  closeToday() { this.loadClose(storeToday()) },
  toggleOpen(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ [`open.${id}`]: !this.data.open[id] })
  },
  onShare(e) {
    const { sid, tid } = e.currentTarget.dataset
    this.setData({ [`shares.${sid}|${tid}`]: e.detail.value })
  },
  async saveAlloc(e) {
    const sid = e.currentTarget.dataset.id
    const row = this.raw.pendingAllocation.find((p) => p.settlementId === sid)
    const shares = row.technicians.map((t) => ({
      technicianId: t.technicianId,
      pct: Number(this.data.shares[`${sid}|${t.technicianId}`]) || 0
    }))
    try {
      await api.adminPost(`/admin/settlements/${encodeURIComponent(sid)}/allocate`, { shares })
      wx.showToast({ title: '业绩已分配', icon: 'none' })
      this.loadClose(this.data.date)
    } catch (err) { wx.showToast({ title: (err && err.message) || '分配失败', icon: 'none' }) }
  },
  /* D68③(店主 08-23 裁):商家端「查看签署单」= 与顾客端**一模一样**的浮层查看器 ——
     以前点开只出这一张(拿 code 塞排版弹层),多份组的其余份看不到。
     现在走 GET /admin/settlements/:key/snapshots(与顾客端 payment.sheets 同一出口),
     整组逐份全列 + 页码 n/N + 左右箭头 + 滑动,组件=components/snapshot-viewer(全仓一份)。
     mixin 仍是唯一实现点:订单页日结区与日结落地页四个入口同时生效。 */
  async viewSnapshot(e) {
    const code = e.currentTarget.dataset.code
    if (!code) { wx.showToast({ title: '这单没有签署快照', icon: 'none' }); return }
    try {
      const r = await api.adminGet(`/admin/settlements/${encodeURIComponent(code)}/snapshots`)
      const items = (r.sheets || []).filter((sh) => sh.snapshotUrl)
        .map((sh) => ({ code: sh.code, label: sh.label, url: `${api.API_BASE}${sh.snapshotUrl}` }))
      if (!items.length) { wx.showToast({ title: '这单还没有签署快照', icon: 'none' }); return }
      const start = Math.max(0, items.findIndex((it) => it.code === String(code)))
      this.setData({ snapViewer: { open: true, items, index: start } })
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '打开签署单失败', icon: 'none' })
    }
  },
  closeSnapViewer() { this.setData({ snapViewer: null }) },
  // 单据预览卡里的「查看签署原图」冒泡到这里 —— 与日结行同一入口实现(不另开一份)
  onPreviewViewSnapshot(e) {
    const code = (e.detail && e.detail.code) || ''
    if (!code) return
    this.viewSnapshot({ currentTarget: { dataset: { code } } })
  },
  // D57:未签行点开=结算页纯出码模式(递给顾客签/重推签署;mixin 唯一实现,两个日结落点同时生效)
  goUnsigned(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({
      url: `/pages/merchant/settlement/index?qrFor=${encodeURIComponent(id)}`,
      fail: (err) => { console.warn('[goUnsigned fail]', err); wx.showToast({ title: '打开签署码失败,请从订单页该单操作', icon: 'none' }) }
    })
  },
  closePreview() { this.setData({ previewSheet: '' }) },

  // ===== 屏 1b 金额更正 =====
  async startCorrect(e) {
    const code = e.currentTarget.dataset.code
    try {
      const r = await api.adminGet(`/settlements/${encodeURIComponent(code)}`)
      const s = r.settlement
      const d = displayOf(s)
      const m = (c) => formatMoney(c, d, d.trimZeroDecimals ? 0 : 2)
      this.setData({
        newTotal: String(s.totalCents / 100),
        reason: '',
        correcting: {
          id: s.id, code: s.code,
          who: s.servedPersonName || '',
          proxy: s.isProxyPaid,
          signedAt: String(s.signedAt || '').slice(0, 16).replace('T', ' '),
          techs: (s.technicians || []).map((t) => `${t.name}(${t.role === 'main' ? '主' : '副'})`).join('/'),
          items: (s.items || []).map((l) => `${String(l.itemNo).padStart(2, '0')} ${l.name} ${l.isFree ? '免收' : m(l.amountCents)}`),
          deposit: s.depositDeductCents ? `−${m(s.depositDeductCents)}` : '',
          total: m(s.totalCents)
        }
      })
    } catch (err) { wx.showToast({ title: (err && err.message) || '读不到这张单', icon: 'none' }) }
  },
  cancelCorrect() { this.setData({ correcting: null }) },
  onNewTotal(e) { this.setData({ newTotal: e.detail.value }) },
  onReason(e) { this.setData({ reason: e.detail.value }) },
  async submitCorrect() {
    const reason = (this.data.reason || '').trim()
    if (!reason) { wx.showToast({ title: '原因必填', icon: 'none' }); return }
    const cents = Math.max(0, Math.round(Number(String(this.data.newTotal).replace(/[^\d.]/g, '')) * 100) || 0)
    try {
      const r = await api.adminPost(`/admin/settlements/${encodeURIComponent(this.data.correcting.id)}/amend`, { totalCents: cents, reason })
      wx.showToast({ title: r.autoBalanceAdjustCents ? '已更正,储值差额已自动补配' : '已更正,原签署单未改动', icon: 'none', duration: 2400 })
      this.setData({ correcting: null })
      this.loadClose(this.data.date)
    } catch (err) { wx.showToast({ title: (err && err.message) || '更正失败', icon: 'none' }) }
  },

  async confirmClose() {
    try {
      await api.adminPost('/admin/daily-close', { date: this.data.date })
      wx.showToast({ title: '日结已确认,业绩定格', icon: 'none' })
      this.loadClose(this.data.date)
    } catch (e) { wx.showToast({ title: (e && e.message) || '确认失败', icon: 'none' }) }
  },
  /* D79 手记入口(商家端)。金额框在 wxml 里是 type=digit,**敲的过程中不重画**
     (只把值收进 data,不回写、不格式化)—— 店主 08-27 立的那条同族。
     备注前端提示、**后端才是最终闸**:接口直调同样会被 NOTE_REQUIRED 拦。 */
  onNoteKind(e) { this.setData({ noteKind: (this.data.v.notes.kinds[e.detail.value] || {}).kind || '', noteKindIndex: Number(e.detail.value) }) },
  onNoteSign(e) { this.setData({ noteSignIndex: Number(e.detail.value) }) },
  onNoteAmount(e) { this.data.noteAmount = e.detail.value },
  onNoteText(e) { this.data.noteText = e.detail.value },
  async addCashNote() {
    const kinds = ((this.data.v || {}).notes || {}).kinds || []
    const kind = this.data.noteKind || (kinds[0] || {}).kind || ''
    const sign = this.data.noteSignIndex === 1 ? 1 : -1
    const cents = Math.round(Number(this.data.noteAmount || 0) * 100)
    const note = String(this.data.noteText || '').trim()
    if (!cents) { wx.showToast({ title: '先填金额', icon: 'none' }); return }
    if (!note) { wx.showToast({ title: '写一句这笔钱是干什么的', icon: 'none' }); return }
    try {
      await api.adminPost('/admin/cash-notes', { date: this.data.date, kind, amountCents: sign * Math.abs(cents), note })
      this.setData({ noteAmount: '', noteText: '' })
      wx.showToast({ title: '已记一笔', icon: 'none' })
      this.loadClose(this.data.date)
    } catch (e) { wx.showToast({ title: (e && e.message) || '记账失败', icon: 'none' }) }
  },
  async reverseCashNote(e) {
    const id = e.currentTarget.dataset.id
    try {
      await api.adminPost(`/admin/cash-notes/${encodeURIComponent(id)}/reverse`, {})
      wx.showToast({ title: '已冲销(原记录留痕)', icon: 'none' })
      this.loadClose(this.data.date)
    } catch (err) { wx.showToast({ title: (err && err.message) || '冲销失败', icon: 'none' }) }
  },
  reopen() {
    wx.showModal({
      title: '重开日结', editable: true, placeholderText: '必须写原因(会留痕)',
      success: async (r) => {
        if (!r.confirm || !r.content || !r.content.trim()) return
        try {
          await api.adminPost('/admin/daily-close/reopen', { date: this.data.date, reason: r.content.trim() })
          wx.showToast({ title: '已重开,可以改分成了', icon: 'none' })
          this.loadClose(this.data.date)
        } catch (e) { wx.showToast({ title: (e && e.message) || '重开失败', icon: 'none' }) }
      },
      fail: (e) => console.warn('[showModal fail]', e) // S组卫生批:fail=开发者域错误,console 留痕不弹 UI(toast 会撞转场,D27 家族)
    })
  }
}

module.exports = { dailyCloseData, dailyCloseMixin, shiftDate }
