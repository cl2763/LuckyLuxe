const api=require('../../../utils/api')
const {formatMoney,displayOf}=require('../../../utils/money')
const {storeMoney}=require('../../../utils/storeclock')
const MemberPricingInput=require('../../../utils/member-pricing')
module.exports={

  groupSheets() {
    const all = this.allItems || []
    return this.data.groups.map((g, i) => {
      const items = []
      if (g.mainId) {
        const it = all.find((x) => x.id === g.mainId) || {}
        items.push(it.unit === 'per_finger' ? { serviceId: g.mainId, fingers: 1 } : { serviceId: g.mainId, qty: 1 })
      }
      for (const id of Object.keys(g.addonIds)) {
        const it = all.find((x) => x.id === id) || {}
        items.push(it.unit === 'per_finger' ? { serviceId: id, fingers: g.addonIds[id] } : { serviceId: id, qty: g.addonIds[id] })
      }


      const isTcGroup = Boolean(g.timecardId || g.purchasePackageId)
      return {
        bookingId: i === 0 ? (this.data.bookingId || undefined) : undefined,
        tierKey: isTcGroup ? 'list' : g.tierKey,
        tierChangedFrom: !isTcGroup && g.tierChanged ? g.tierDefault : undefined,
        items,
        timecardId: g.timecardId || undefined,
        purchasePackageId: g.purchasePackageId || undefined,
        timecardServiceId: (g.timecardId || g.purchasePackageId) ? (g.timecardServiceId || undefined) : undefined,
        customItems: g.customItems.map((c) => ({ name: c.name, amountCents: c.amountCents })),
        servedPersonName: String(g.servedPersonName || '').trim(),   // trim 移到提交这一刻(输入过程中不许改写)

        technicians: g.selectedTechs.map((id, index) => ({ technicianId: id, role: index === 0 ? 'main' : 'assist', itemNos: (g.techItems && g.techItems[id]) || [] })),
        payIntent: this.payIntentOf(),

        rechargePackageId: i === 0 && this.data.rvDraft && this.data.rvDraft.packageId ? this.data.rvDraft.packageId : undefined,
        rechargeAmountCents: i === 0 && this.data.rvDraft && !this.data.rvDraft.packageId ? this.data.rvDraft.amountCents : undefined,
        depositApplied: i === 0 ? this.data.depositApplied : false,
        couponGrantId: i === 0 ? (this.data.couponGrantId || undefined) : undefined,
        applyFootSurcharge: i === 0 && !isTcGroup ? this.data.applyFootSurcharge : false,
        applyTipReuse: i === 0 && !isTcGroup ? this.data.applyTipReuse : false
      }
    })
  },
  formBody() {
    return {
      bookingId: this.data.bookingId || undefined,
      userId: this.data.userId || undefined,
      payerUserId: this.data.userId || undefined,
      cardOwnerUserId: this.data.userId || undefined,
      payIntent: this.payIntentOf(),
      settlements: this.data.pricingConfig?.active?MemberPricingInput.enrich(this.data,this.groupSheets()):this.groupSheets()
    }
  },
  refresh() {
    this._pvSeq=(this._pvSeq||0)+1
    clearTimeout(this._t)
    this._t = setTimeout(() => this.doPreview(), 250)
  },
  async doPreview() {


    const seq = (this._pvSeq = (this._pvSeq || 0) + 1)
    let body = this.formBody()
    try {
      if(this.data.pricingConfig?.active){const catalog=await api.adminPost('/admin/member-pricing/catalog',body);if(seq!==this._pvSeq)return;this.catalogPrices=catalog;this.setData({tiers:MemberPricingInput.availableTypes(this.data.pricingConfig,catalog,this.data.memberPricing)});MemberPricingInput.syncTier(this.data.groups,catalog);body=this.formBody();this.renderAll()}
      const r = await api.adminPost(this.data.pricingConfig?.active?'/admin/member-pricing/preview':'/admin/settlements/preview', body)
      if (seq !== this._pvSeq) return
      const sheets = r.sheets || []
      const grp = r.group || {}
      const d = displayOf(sheets[0] || {})
      const m = (cents) => formatMoney(cents, d, d.trimZeroDecimals ? 0 : 2)
      const pay = grp.payment || {}
      const groupsState = this.data.groups

      const detailGroups = sheets.map((s, i) => {
        const g = groupsState[i] || {}
        const who = g.servedPersonName ? ` · 被服务者:${g.servedPersonName}` : ''
        return {
          title: `项目${'①②③④⑤'[i] || i + 1} ${g.mainName || '(未选主项目)'}${g.techLine ? ' · ' + g.techLine : ''}${who}`,
          lines: (s.lines || []).map((l) => ({
            no: l.itemNo, name: l.name, qty: l.qty,
            serviceId: l.serviceId || '', kind: l.kind || '',
            amount: l.amountCents === 0 ? '免收' : m(l.amountCents),
            list: l.listAmountCents !== l.amountCents ? m(l.listAmountCents) : ''
          }))
        }
      })
      const storedUsed = pay.storedUsedCents || 0
      const view = {
        groups: detailGroups,
        listTotal: m(grp.listTotalCents || 0),
        subtotal: m(grp.subtotalCents || 0),
        discountTotal: m(grp.discountTotalCents || 0),
        discountLabel: (grp.couponDiscountCents || 0) > 0 ? '共优惠（含券）' : '较原价共优惠',
        hasDeposit: (grp.depositDeductCents || 0) > 0,
        depositDeduct: m(grp.depositDeductCents || 0),
        hasStored: storedUsed > 0,
        storedDeduct: m(storedUsed),

        hasTimecard: (pay.timecardCoverCents || 0) > 0,
        timecardCover: m(pay.timecardCoverCents || 0),

        total: m(pay.offlineDueCents != null ? pay.offlineDueCents : (grp.totalCents || 0)),
        balanceCents: pay.balanceAvailableCents || 0,
        balance: m(pay.balanceAvailableCents || 0),
        hasBalance: (pay.balanceAvailableCents || 0) > 0,
        depositReceiptCents: grp.depositReceiptCents || 0,
        hasDepositReceipt: (grp.depositReceiptCents || 0) > 0,
        hasOffline: (pay.offlineDueCents || 0) > 0,
        offlineDue: m(pay.offlineDueCents || 0),

        hasPurchase: (pay.purchaseCents || 0) > 0,
        purchaseAmount: m(pay.purchaseCents || 0),
        purchaseName: (sheets.find((s) => s.purchase) || {}).purchase ? (sheets.find((s) => s.purchase) || {}).purchase.name : '',

        hasRecharge: (pay.rechargeCents || 0) > 0,
        rechargeAmount: m(pay.rechargeCents || 0),
        rechargeBonus: (() => {
          const r = (sheets.find((s) => s.recharge) || {}).recharge
          return r && r.bonusCents > 0 ? m(r.bonusCents) : ''
        })(),
        afterBalance: pay.afterRechargeBalanceCents != null ? m(pay.afterRechargeBalanceCents) : '',

        rvNote: (pay.pendingRechargeCents || 0) > 0 ? `(含本单随签充值 +${m(pay.pendingRechargeCents)},签字生效)` : '',
        warnings: sheets.reduce((acc, s) => acc.concat((s.softWarnings || []).map((w) => w.message)), [])
      }

      const s0 = sheets[0] || {}
      const options = (s0.couponOptions || []).map((o) => Object.assign({}, o, { deductText: o.usable ? `−${m(o.discountCents)}` : '' }))
      const prev = this.data.display




      const sentGrant = ((body.settlements || [])[0] || {}).couponGrantId || ''
      const curGrant = this.data.couponGrantId || ''
      const nextGrant = s0.coupon ? s0.coupon.grantId : (curGrant && curGrant !== sentGrant ? curGrant : '')
      this.setData({
        preview: r, view, display: d,
        couponOptions: options,
        couponUsableCount: s0.couponUsableCount || 0,
        couponPicked: s0.coupon
          ? Object.assign({}, s0.coupon, { deductText: `−${m(s0.coupon.discountCents)}` })
          : (nextGrant ? this.data.couponPicked : null),
        couponGrantId: nextGrant
      })



      const bodySheets = this.groupSheets()
      for (let i = 0; i < sheets.length; i += 1) {
        const wanted = (bodySheets[i].items || []).map((x) => x.serviceId)
          .concat(bodySheets[i].timecardServiceId ? [bodySheets[i].timecardServiceId] : [])
          .sort()
        const got = (sheets[i].lines || []).filter((l) => l.serviceId && l.kind !== 'rule').map((l) => l.serviceId).sort()
        if (JSON.stringify(wanted) !== JSON.stringify(got)) {
          wx.showToast({ title: `组${i + 1} 金额行与勾选不一致,请截图报给店主`, icon: 'none', duration: 4000 })
          break
        }
      }
      if (!prev || prev.symbol !== d.symbol || prev.prefix !== d.prefix) this.renderAll()

      this.buildTechRows()
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '试算失败', icon: 'none' })
    }
  },


  async openQr(sheet) {
    const key = sheet && (sheet.id || sheet.settlementId || sheet.code)
    if (!key) { wx.showModal({title:'无法出示签署码',content:'没有取得结算单编号，请返回订单重试。',showCancel:false,fail:(e)=>console.warn('[showModal fail]',e)}); return }
    try {
      const r = await api.adminPost(`/admin/settlements/${encodeURIComponent(key)}/sign-token`, {})
      const s = r.settlement || {}
      if (!s.id) throw new Error('结算单编号缺失，请重新打开订单。')
      const m = (c) => storeMoney(c, 2)
      this.setData({
        qr: {
          settlementId: s.id,
          code: s.code || sheet.code,
          operatorText: s.operatorText || '历史未记录',
          url: r.url,
          miniCodeUrl: r.miniCodePath ? api.miniCodeUrl(r.miniCodePath) : '',
          codeError: false,
          pushedText: r.pushedText || '',
          unbound: r.customerBound === false,

          amountText: `${(s.groupTotal || 1) > 1 ? `服务确认单 ${s.groupIndex}/${s.groupTotal} · ` : ''}本单到店支付 ${s.flow ? s.flow.cashDueText : m(s.totalCents)}`,
          breakdownText: s.depositDeductCents
            ? `档位小计 ${m(s.subtotalCents)} − 已付定金 ${m(s.depositDeductCents)}`
            : `档位小计 ${m(s.subtotalCents)}`,
          stateText: r.text || '等待顾客进入签署页…',
          state: r.state || 'waiting'
        }
      })
      this.pollQr()
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '出码失败', icon: 'none' })

      if (this._qrOnly) setTimeout(() => wx.navigateBack(), 700)
    }
  },
  pollQr() {
    clearTimeout(this._qrTimer)
    this._qrTimer = setTimeout(async () => {
      const q = this.data.qr
      if (!q || !q.settlementId) return
      try {
        const st = await api.adminGet(`/admin/settlements/${encodeURIComponent(q.settlementId)}/sign-state`)
        this.setData({ 'qr.state': st.state, 'qr.stateText': st.text })
        if (st.state === 'signed') {

          if (st.nextPendingId) {
            wx.showToast({ title: '这张已签,接下一张', icon: 'success' })
            setTimeout(() => this.openQr({ id: st.nextPendingId }), 900)
            return
          }
          wx.showToast({ title: '顾客已签署,全部完成', icon: 'success' })

          setTimeout(() => {
            this.setData({ qr: null })
            require('../../../utils/nav').relaunch('/pages/merchant/orders/index')
          }, 900)
          return
        }
      } catch (e) { /* 网络抖动下一轮再问 */ }
      this.pollQr()
    }, 2500)
  },
  closeQr() {
    clearTimeout(this._qrTimer)
    this.setData({ qr: null })

    if (this._qrOnly) wx.navigateBack()
  },
  copyQrLink() {
    wx.setClipboardData({
      data: this.data.qr.url,
      success: () => wx.showToast({ title: '已复制 ✓', icon: 'none' }),
      fail: () => wx.showToast({ title: '复制失败,请长按链接手动复制', icon: 'none' })
    })
  },
  handSign() {
    if (this.data.qr && this.data.qr.unbound) {
      wx.showToast({ title: '请出示签署链接供顾客核对签字', icon: 'none' })
      return
    }
    clearTimeout(this._qrTimer)
    const code = this.data.qr.code
    this.setData({ qr: null })
    require('../../../utils/nav').to(`/pages/sign/index?merchant=1&code=${encodeURIComponent(code)}`)
  },
  onUnload() { clearTimeout(this._memberPoll);clearTimeout(this._t);clearTimeout(this._qrTimer); clearTimeout(this._bindTimer) },



  async openBindCode() {
    if (!this.data.userId) { wx.showToast({ title: '先选择顾客档案', icon: 'none' }); return }
    if (this.data.bind.bound) { wx.showToast({ title: '该档案已绑定,无需绑定码', icon: 'none' }); return }
    try {
      const r = await api.adminPost(`/admin/customers/${encodeURIComponent(this.data.userId)}/bind-token`, {})
      this.setData({ bindQr: { url: r.url, pagePath: r.pagePath, miniCodeUrl: r.miniCodePath ? api.miniCodeUrl(r.miniCodePath) : '', codeError: false, displayName: r.displayName, hint: r.hint, state: 'waiting', stateText: '等待顾客扫码绑定…' } })
      this.pollBind()
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '绑定码生成失败', icon: 'none' })
    }
  },
  pollBind() {
    clearTimeout(this._bindTimer)
    this._bindTimer = setTimeout(async () => {
      if (!this.data.bindQr) return
      try {
        const r = await api.adminGet(`/admin/customers/lookup?userId=${encodeURIComponent(this.data.userId)}`)
        const hit = r && r.hit
        if (hit && hit.bound) {

          this.setData({
            bindQr: null,
            bind: { bound: true, badgeText: hit.badgeText || '', hintText: hit.hintText || '', phoneMasked: hit.phoneMasked || '', memberCode: hit.memberCode || '' }
          })
          wx.showToast({ title: '已绑定,充值已解锁', icon: 'none', duration: 2500 })
          this.refresh()
          return
        }
      } catch (e) { /* 拉不到就下轮再试 */ }
      this.pollBind()
    }, 2000)
  },
  closeBindCode() { clearTimeout(this._bindTimer); this.setData({ bindQr: null }) },
  qrImageError() { this.setData({ 'qr.codeError': true }) },
  bindQrImageError() { this.setData({ 'bindQr.codeError': true }) },

  openQrLink() {
    if (!this.data.qr) return
    require('../../../utils/nav').to(`/pages/sign/index?merchant=1&code=${encodeURIComponent(this.data.qr.code)}`)
  },

  openBindLink() {
    if (!this.data.bindQr) return
    require('../../../utils/nav').to(this.data.bindQr.pagePath)
  },
  copyBindLink() {
    if (!this.data.bindQr) return
    wx.setClipboardData({
      data: this.data.bindQr.url,
      success: () => wx.showToast({ title: '已复制 ✓', icon: 'none' }),
      fail: () => wx.showToast({ title: '复制失败,请长按链接手动复制', icon: 'none' })
    })
  },

  async submit() {
    if (this.data.submitting) return
    if (!this.data.userId) { wx.showToast({ title: '这单没有绑定顾客,无法结算', icon: 'none' }); return }



    for (let i = 0; i < this.data.groups.length; i += 1) {
      const g = this.data.groups[i]
      const hasTc = Boolean(g.timecardId || g.purchasePackageId)
      if (!g.mainId && !Object.keys(g.addonIds).length && !g.customItems.length && !hasTc) {
        wx.showToast({ title: `项目${i + 1} 还没选内容`, icon: 'none' }); return
      }
      if (hasTc && !g.timecardServiceId) {
        wx.showToast({ title: `项目${i + 1} 请选本次核销项目(卡关联组内)`, icon: 'none' }); return
      }
      if (!g.selectedTechs.length) { wx.showToast({ title: `项目${i + 1} 先勾本组技师`, icon: 'none' }); return }
    }
    this.setData({ submitting: true })
    try {
      const body=this.formBody();if(this.data.pricingConfig?.active)body.operationId=MemberPricingInput.retryKey(this._createRetry,body)
      const r = this.data.pricingConfig?.active?await this.mpCreate(body):await api.adminPost('/admin/settlements',body)
      if(this.data.pricingConfig?.active){await this.mpLoadBatch(r.documents[0].visitGroupId||r.groupId);return}

      await this.openQr((r.settlements || [])[0])
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '开单失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  }
}
