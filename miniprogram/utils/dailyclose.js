






const api = require('./api')
const { storeToday } = require('./storeclock')
const { formatMoney, displayOf } = require('./money')

function shiftDate(d, n) {
  const x = new Date(`${d}T12:00:00Z`)
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}


const dailyCloseData = {

  snapViewer: { open: false, items: [], index: 0 },
  date: '', loading: true, isToday: true, v: null, open: {}, shares: {},
  correcting: null, newTotal: '', reason: '',

  noteKind: '', noteKindIndex: 0, noteSignIndex: 0, noteAmount: '', noteText: ''
}

const dailyCloseMixin = {


  async loadClose(date) {

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
        v: {personDocuments:dc.personDocuments||[],
          date: dc.date,
          confirmed: dc.status === 'confirmed',
          confirmedAt: String(dc.confirmedAt || '').slice(0, 16).replace('T', ' '),
          reopenCount: dc.reopenCount,
          orderCount: dc.orderCount,
          revenue: m(dc.revenueCents),
          canConfirm: dc.canConfirm,
          blockers: (dc.blockers || []).map((b) => b.message),


          unsigned: (dc.unsignedList || []).map((u) => ({
            id: u.settlementId, code: u.code,

            label: `${u.timeText} ${u.customerName} · ${u.code} · 到店支付 ${m(u.cashDueCents)}`
          })),


          crossDayCount: dc.crossDayCount || 0,
          lateSignNotice: dc.lateSignNotice || '',
          staleClose: Boolean(dc.staleClose),
          confirmedSnapshot: dc.confirmedSnapshot || null,
          pending: (dc.pendingAllocation || []).map((p) => ({

            id: p.settlementId, code: p.code, timeText: p.timeText || '', crossDayNote: p.crossDayNote || '', total: m(p.perfBaseCents === undefined ? p.totalCents : p.perfBaseCents),
            couponNote: p.couponDiscountCents ? '业绩基数(不含券)' : '',

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


          deductTitle: dc.deductListTitle || '',
          deducts: (dc.afterSalesDeductions || []).map((d) => ({
            time: d.timeText || '', tech: d.technicianName, label: d.label, amt: d.amountText || `−${m(d.deductCents)}`
          })),




          drawer: dc.cashDrawer ? {
            title: dc.cashDrawer.title || dc.cashDrawer.label,
            should: dc.cashDrawer.shouldHaveText,
            totalLabel: dc.cashDrawer.totalLabel || '',
            rows: (dc.cashDrawer.rows || []).map((r) => ({ label: r.label, amt: `${r.sign} ${r.amountText}`, neg: Boolean(r.negative), note: r.note || '' })),   // 裁定B:负行点名注随行
            footnote: dc.cashDrawer.footnote || '',
            amendNote: dc.cashDrawer.amendNote || '',  // 更正后「营业额 ≠ 抽屉数」的那句解释(后端出句,双端同句)
            splitNote: dc.cashDrawer.splitNote || ''   // 「记一笔」与「现金手记」的分工(店主 08-28 六问的那件,后端出句)
          } : null,


          notes: dc.cashNotes ? {
            label: dc.cashNotes.label || '现金手记',
            hint: dc.cashNotes.hint || '',
            kinds: dc.cashNotes.kinds || [],
            items: (dc.cashNotes.items || []).map((it) => ({
              id: it.id, kindLabel: it.kindLabel, note: it.note, amt: it.amountText, isReversal: it.isReversal
            }))
          } : null,

          depositAlert: dc.depositAlert ? dc.depositAlert.text : '',
          headline: (dc.headline || []).map((h) => ({ label: h.label, value: h.value })),
          refundLine: (dc.refunds && dc.refunds.totalCents)
            ? `${dc.refunds.label} · ${dc.refunds.storedCount ? `储值 ${dc.refunds.storedCount} 笔` : ''}${dc.refunds.timecardCount ? ` 次卡 ${dc.refunds.timecardCount} 笔` : ''} 合计 ${m(dc.refunds.totalCents)}`
            : '',

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





  async viewSnapshot(e) {
    const code = e.currentTarget.dataset.code
    if (!code) { wx.showToast({ title: '这单没有签署快照', icon: 'none' }); return }
    try {
      const r = await api.adminGet(`/admin/settlements/${encodeURIComponent(code)}/snapshots`)
      if(r.memberDocumentGroupId){require('./nav').to('/pages/sign/index?memberGroup='+encodeURIComponent(r.memberDocumentGroupId)+'&merchant=1&archive=1');return}
      const items = (r.sheets || []).filter((sh) => sh.snapshotUrl)
        .map((sh) => ({ code: sh.code, label: sh.label, url: `${api.API_BASE}${sh.snapshotUrl}` }))
      if (!items.length) { wx.showToast({ title: '这单还没有签署快照', icon: 'none' }); return }
      const start = Math.max(0, items.findIndex((it) => it.code === String(code)))
      this.setData({ snapViewer: { open: true, items, index: start } })
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '打开签署单失败', icon: 'none' })
    }
  },
  closeSnapViewer() { this.setData({ snapViewer: { open: false, items: [], index: 0 } }) }, // D94:设回 null=组件又收 undefined,警告复发

  onPreviewViewSnapshot(e) {
    const code = (e.detail && e.detail.code) || ''
    if (!code) return
    this.viewSnapshot({ currentTarget: { dataset: { code } } })
  },

  goUnsigned(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({
      url: `/pages/merchant/settlement/index?qrFor=${encodeURIComponent(id)}`,
      fail: (err) => { console.warn('[goUnsigned fail]', err); wx.showToast({ title: '打开签署码失败,请从订单页该单操作', icon: 'none' }) }
    })
  },
  closePreview() { this.setData({ previewSheet: '' }) },


  async startCorrect(e) {
    const code = e.currentTarget.dataset.code
    try {
      const r = await api.adminGet(`/settlements/${encodeURIComponent(code)}`)
      let s = r.settlement
      if(s.serviceDocument){const d=await api.adminGet('/admin/member-pricing/documents/'+encodeURIComponent(s.serviceDocument.id));s={...s,id:d.id,signedAtText:d.signedAtText,memberDocument:true,discountText:d.quote.display?.discountText,totalCents:d.correction.serviceTotalCents,items:d.quote.components.flatMap(c=>c.lines)}}
      const d = displayOf(s)
      const m = (c) => formatMoney(c, d, d.trimZeroDecimals ? 0 : 2)
      this.setData({
        newTotal: String(s.totalCents / 100),
        reason: '',
        correcting: {
          memberDocument:s.memberDocument,discountText:s.discountText,id: s.id, code: s.code,
          who: s.servedPersonName || '',
          proxy: s.isProxyPaid,
          signedAt: s.signedAtText||String(s.signedAt || '').slice(0, 16).replace('T', ' '),
          techs: (s.technicians || []).map((t) => `${t.name}(${t.role === 'main' ? '主' : '副'})`).join('/'),
          items: (s.items || []).map((l,i) => `${String(l.itemNo||i+1).padStart(2, '0')} ${l.name} ${l.isFree ? '免收' : m(l.amountCents)}`),
          deposit: s.depositDeductCents ? `−${m(s.depositDeductCents)}` : '',
          total: m(s.totalCents)
        }
      });if(s.memberDocument)this.previewCorrection()
    } catch (err) { wx.showToast({ title: (err && err.message) || '读不到这张单', icon: 'none' }) }
  },
  cancelCorrect() { this.setData({ correcting: null }) },
  onNewTotal(e) { this.setData({ newTotal: e.detail.value });if(this.data.correcting?.memberDocument)this.previewCorrection() },
  previewCorrection(){clearTimeout(this._amendTimer);const seq=this._amendSeq=(this._amendSeq||0)+1,id=this.data.correcting?.id;this.setData({amendPreview:null,amendPreviewText:'正在核对更正后的储值变化…'});this._amendTimer=setTimeout(async()=>{const raw=String(this.data.newTotal??'').trim();if(!/^\d+(?:\.\d{1,2})?$/.test(raw)||Number(raw)>1000000){this.setData({amendPreviewText:'请输入有效金额，最多两位小数'});return}const serviceTotalCents=Math.round(Number(raw)*100);try{const r=await api.adminPost('/admin/member-pricing/documents/'+encodeURIComponent(id)+'/amend-preview',{serviceTotalCents});if(seq!==this._amendSeq||id!==this.data.correcting?.id)return;if(!r.reviewHash)throw Error('未取得更正确认信息');this.setData({amendPreview:{...r,serviceTotalCents},amendPreviewText:r.balanceEffectText})}catch(e){if(seq===this._amendSeq&&id===this.data.correcting?.id)this.setData({amendPreviewText:(e.message||'预览失败')+'；请重新核对后再提交'})}},300)},
  onReason(e) { this.setData({ reason: e.detail.value }) },
  async submitCorrect() {
    const reason = (this.data.reason || '').trim()
    if (!reason) { wx.showToast({ title: '原因必填', icon: 'none' }); return }
    const raw=String(this.data.newTotal??'').trim();if(!/^\d+(?:\.\d{1,2})?$/.test(raw)||Number(raw)>1000000){wx.showToast({title:'请输入有效金额，最多两位小数',icon:'none'});return}const cents=Math.round(Number(raw)*100)
    if(this.data.correcting.memberDocument&&(!this.data.amendPreview||this.data.amendPreview.serviceTotalCents!==cents)){wx.showToast({title:'请先核对储值变化预览',icon:'none'});return}
    try {
      const r = await api.adminPost(this.data.correcting.memberDocument?'/admin/member-pricing/documents/'+encodeURIComponent(this.data.correcting.id)+'/amend':`/admin/settlements/${encodeURIComponent(this.data.correcting.id)}/amend`, { [this.data.correcting.memberDocument?'serviceTotalCents':'totalCents']: cents, reason,...(this.data.correcting.memberDocument?{reviewHash:this.data.amendPreview.reviewHash}:{}) })
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


      const r = await new Promise((ok) => wx.showModal({
        title: '冲销事由(必填)', editable: true, placeholderText: '写明为什么冲销,会进账本备注',
        success: (m) => ok(m.confirm ? String(m.content || '').trim() : null), fail: () => ok(null)
      }))
      if (!r) { wx.showToast({ title: '事由必填,已取消', icon: 'none' }); return }
      await api.adminPost(`/admin/cash-notes/${encodeURIComponent(id)}/reverse`, { reason: r })
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
