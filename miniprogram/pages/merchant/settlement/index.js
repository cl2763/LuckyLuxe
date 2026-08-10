/* 屏 1｜技师端 · 结算开单
   金额红线:本页一处运算都没有。所有金额(小计/优惠/定金抵扣/应收/支付腿)
   都来自 POST /admin/settlements/preview,与正式开单走同一个 computeSettlement。
   本页只负责:勾了什么 → 发给后端 → 把后端算好的数显示出来。 */
const api = require('../../../utils/api')
const { formatMoney, displayOf } = require('../../../utils/money')
const { storeMoney } = require('../../../utils/storeclock')

const TIERS = [
  { key: 'list', label: '原价' },
  { key: 'share', label: '分享价' },
  { key: 'member', label: '会员价' },
  { key: 'course', label: '疗程价' }
]
const TIER_PRICE_FIELD = { list: 'listPriceCents', share: 'sharePriceCents', member: 'memberPriceCents', course: 'coursePriceCents' }
const PAY_PLANS = [
  { key: 'balance_plus_offline', label: '差额线下收' },
  { key: 'recharge_then_balance', label: '现场充值' },
  { key: 'offline_full', label: '全额线下付' }
]

Page({
  // 门禁:未登录/会话失效不渲染空壳,直接回登录页(店主 2026-08-09 红线)
  onShow() { api.guardMerchant() },
  data: {
    ready: false,
    bookingId: '', userId: '', customerName: '', servedPersonName: '', isProxy: false,
    display: null,
    tiers: TIERS, tierKey: 'member', tierDefault: 'member', tierChanged: false,
    cats: [], catId: '',
    mainItems: [],      // 当前大类下的主项目(带本档价 + 原价)
    addonGroups: [],    // 加项目录,按大类分组
    picked: {},         // serviceId -> qty(指数/次数)
    customItems: [], customName: '', customAmount: '',
    applyFootSurcharge: false, applyTipReuse: false,
    depositApplied: true, depositDeductible: true,
    roster: [], selectedTechs: [], techRows: [],
    payIntent: 'balance_plus_offline', payPlans: PAY_PLANS,
    // 屏 C1 优惠券:选中的券、券包面板、后端算好的抵扣额与不可用原因
    couponGrantId: '', couponPanel: false, couponOptions: [], couponUsableCount: 0, couponPicked: null,
    preview: null, view: null,
    // 屏 S2:绑定状态徽标 —— 文案全部后端下发,前端一个字都不拼(规则③)
    bind: { bound: true, badgeText: '', hintText: '', phoneMasked: '', memberCode: '' },
    qr: null,   // 屏 S3 二维码弹层
    ctaText: '推送签署',
    submitting: false
  },

  onLoad(q) {
    this.setData({
      bookingId: q.bookingId || '',
      userId: q.userId || '',
      customerName: decodeURIComponent(q.name || '') || '顾客',
      servedPersonName: ''
    })
    this.boot(q.serviceId || '')
  },

  async boot(preselectServiceId) {
    try {
      const [cats, items, techs, dep] = await Promise.all([
        api.adminGet('/admin/pricing/categories'),
        api.adminGet('/admin/pricing/items'),
        api.adminGet('/admin/technicians?roster=1'),
        api.adminGet('/admin/deposit-config').catch(() => null)
      ])
      const categories = (cats.categories || []).filter((c) => c.isBookable !== false)
      const all = (items.items || []).filter((i) => i.isActive !== false)
      this.allItems = all
      // 会员判定决定默认价格档:是会员就默认会员价,不是就默认原价(改档会留痕)
      let tierDefault = 'list'
      if (this.data.userId) {
        const m = await api.adminGet(`/admin/membership/members?userId=${encodeURIComponent(this.data.userId)}`).catch(() => null)
        const one = m && (m.members || [])[0]
        if (one && one.isMember) tierDefault = 'member'
      }
      const picked = {}
      if (preselectServiceId && all.some((i) => i.id === preselectServiceId)) picked[preselectServiceId] = 1
      const firstCat = (categories[0] || {}).id || ''
      this.setData({
        ready: true,
        cats: categories.map((c) => ({ id: c.id, name: c.name })),
        catId: this.catOf(preselectServiceId) || firstCat,
        roster: (techs.technicians || []).map((t) => ({ id: t.id, name: t.name, title: t.title || '' })),
        tierKey: tierDefault, tierDefault,
        depositDeductible: dep && dep.config ? dep.config.deductible !== false : true,
        depositApplied: Boolean(this.data.bookingId),
        picked
      })
      this.loadBindState()
      this.renderCatalogue()
      this.refresh()
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载价目表失败', icon: 'none' })
    }
  },

  /* 屏 S2:这份档案绑没绑微信。只看绑定状态,不看新老客;文案后端给,绑定后是空串。
     用 lookup 拿(与 S1「手机号命中带出」同一个口子),避免为一个徽标再开一个接口。 */
  async loadBindState() {
    if (!this.data.userId) return
    try {
      const r = await api.adminGet(`/admin/customers/lookup?userId=${encodeURIComponent(this.data.userId)}`)
      const hit = r && r.hit
      if (!hit) return
      this.setData({
        bind: {
          bound: hit.bound,
          badgeText: hit.badgeText || '',
          hintText: hit.hintText || '',
          phoneMasked: hit.phoneMasked || '',
          memberCode: hit.memberCode || ''
        }
      })
    } catch (e) { /* 拉不到就不显示徽标,不挡开单 */ }
  },

  catOf(serviceId) {
    const it = (this.allItems || []).find((x) => x.id === serviceId)
    return it ? (it.categoryId || '') : ''
  },

  // 目录只做「挑出该显示哪些行 + 挑哪个价格字段」,不做任何金额运算
  renderCatalogue() {
    const tier = this.data.tierKey
    const field = TIER_PRICE_FIELD[tier] || 'listPriceCents'
    const d = this.data.display
    const priceOf = (it) => {
      const cents = it[field] === null || it[field] === undefined ? it.listPriceCents : it[field]
      return { cents, text: formatMoney(cents, d, d && d.trimZeroDecimals ? 0 : 2) }
    }
    const listOf = (it) => formatMoney(it.listPriceCents, d, d && d.trimZeroDecimals ? 0 : 2)
    const decorate = (it) => {
      const p = priceOf(it)
      return {
        id: it.id, name: it.nameZh, unit: it.unit, itemKind: it.itemKind,
        priceText: p.cents === 0 ? '免收' : p.text,
        isFree: p.cents === 0,
        listText: it.listPriceCents !== p.cents ? listOf(it) : '',
        perFinger: it.unit === 'per_finger',
        qty: this.data.picked[it.id] || 0,
        on: Object.prototype.hasOwnProperty.call(this.data.picked, it.id)
      }
    }
    const all = this.allItems || []
    const mainItems = all.filter((i) => (i.itemKind || 'main') === 'main' && (i.categoryId || '') === this.data.catId).map(decorate)
    const addons = all.filter((i) => i.itemKind === 'addon')
    /* 裁决④(2026-08-09):加项按**商家自填的组名**分组(如 延长类 / 补甲类 / 卸甲类),
       不再按价目表大类分 —— 图上那三个组名是这家店的说法,不该写死在代码里。
       没填组名的归「其他加项」,永远排在最后。 */
    const groupMap = {}
    const order = []
    addons.forEach((i) => {
      const key = (i.addonGroup || '').trim() || '其他加项'
      if (!groupMap[key]) { groupMap[key] = { title: key, items: [] }; order.push(key) }
      groupMap[key].items.push(decorate(i))
    })
    const sorted = order.filter((k) => k !== '其他加项').concat(order.includes('其他加项') ? ['其他加项'] : [])
    this.setData({ mainItems, addonGroups: sorted.map((k) => groupMap[k]) })
  },

  pickTier(e) {
    const key = e.currentTarget.dataset.k
    this.setData({ tierKey: key, tierChanged: key !== this.data.tierDefault })
    this.renderCatalogue()
    this.refresh()
  },
  pickCat(e) {
    this.setData({ catId: e.currentTarget.dataset.id })
    this.renderCatalogue()
  },
  toggleItem(e) {
    const id = e.currentTarget.dataset.id
    const picked = Object.assign({}, this.data.picked)
    if (Object.prototype.hasOwnProperty.call(picked, id)) delete picked[id]
    else picked[id] = 1
    this.setData({ picked })
    this.renderCatalogue()
    this.refresh()
  },
  stepQty(e) {
    const { id, d } = e.currentTarget.dataset
    const picked = Object.assign({}, this.data.picked)
    const next = Math.max(0, (picked[id] || 0) + Number(d))
    if (next === 0) delete picked[id]
    else picked[id] = next
    this.setData({ picked })
    this.renderCatalogue()
    this.refresh()
  },
  toggleFoot() { this.setData({ applyFootSurcharge: !this.data.applyFootSurcharge }); this.refresh() },
  toggleTipReuse() { this.setData({ applyTipReuse: !this.data.applyTipReuse }); this.refresh() },
  setDeposit(e) { this.setData({ depositApplied: e.currentTarget.dataset.v === '1' }); this.refresh() },
  onCustomName(e) { this.setData({ customName: e.detail.value }) },
  onCustomAmount(e) { this.setData({ customAmount: e.detail.value }) },
  addCustom() {
    const name = (this.data.customName || '').trim()
    const amount = (this.data.customAmount || '').trim()
    if (!name || !amount) { wx.showToast({ title: '填项目名称和金额', icon: 'none' }); return }
    // 元 → 分只在这里做一次单位换算(不是计价),之后金额一律由后端算
    const cents = Math.round(Number(amount.replace(/[^\d.]/g, '')) * 100)
    if (!Number.isFinite(cents) || cents <= 0) { wx.showToast({ title: '金额不对', icon: 'none' }); return }
    this.setData({ customItems: this.data.customItems.concat([{ name, amountCents: cents }]), customName: '', customAmount: '' })
    this.refresh()
  },
  removeCustom(e) {
    const i = Number(e.currentTarget.dataset.i)
    const next = this.data.customItems.slice()
    next.splice(i, 1)
    this.setData({ customItems: next })
    this.refresh()
  },
  onServedName(e) {
    const v = (e.detail.value || '').trim()
    this.setData({ servedPersonName: v, isProxy: Boolean(v) })
  },
  toggleTech(e) {
    const id = e.currentTarget.dataset.id
    const sel = this.data.selectedTechs.slice()
    const at = sel.indexOf(id)
    if (at >= 0) sel.splice(at, 1)
    else { if (sel.length >= 2) { wx.showToast({ title: '最多两位技师', icon: 'none' }); return } sel.push(id) }
    this.setData({ selectedTechs: sel })
    this.buildTechRows()
  },
  swapMain() {
    if (this.data.selectedTechs.length < 2) return
    this.setData({ selectedTechs: [this.data.selectedTechs[1], this.data.selectedTechs[0]] })
    this.buildTechRows()
  },
  // 技师各自勾自己做的项目编号;编号来自后端 preview 的 lines[].itemNo,不自己编号
  toggleTechItem(e) {
    const { tech, no } = e.currentTarget.dataset
    const map = Object.assign({}, this.techItems || {})
    const cur = (map[tech] || []).slice()
    const at = cur.indexOf(Number(no))
    if (at >= 0) cur.splice(at, 1)
    else cur.push(Number(no))
    map[tech] = cur
    this.techItems = map
    this.buildTechRows()
  },
  buildTechRows() {
    const lines = ((this.data.preview || {}).lines) || []
    const map = this.techItems || {}
    const rows = this.data.selectedTechs.map((id, index) => {
      const t = this.data.roster.find((x) => x.id === id) || { name: '' }
      return {
        id, name: t.name, role: index === 0 ? '主' : '副', isMain: index === 0,
        chips: lines.map((l) => ({ no: l.itemNo, on: (map[id] || []).indexOf(l.itemNo) >= 0 }))
      }
    })
    this.setData({ techRows: rows })
  },
  pickPayPlan(e) {
    this.setData({ payIntent: e.currentTarget.dataset.k })
    this.refresh()
  },

  formBody() {
    const items = Object.keys(this.data.picked).map((id) => {
      const it = (this.allItems || []).find((x) => x.id === id) || {}
      return it.unit === 'per_finger' ? { serviceId: id, fingers: this.data.picked[id] } : { serviceId: id, qty: this.data.picked[id] }
    })
    return {
      bookingId: this.data.bookingId || undefined,
      userId: this.data.userId || undefined,
      payerUserId: this.data.userId || undefined,
      tierKey: this.data.tierKey,
      items,
      customItems: this.data.customItems,
      applyFootSurcharge: this.data.applyFootSurcharge,
      applyTipReuse: this.data.applyTipReuse,
      depositApplied: this.data.depositApplied,
      payIntent: this.data.payIntent,
      couponGrantId: this.data.couponGrantId || undefined
    }
  },

  /* 选券面板(设计图 C1 右图):可用在上、不可用置灰在下并写原因。
     能不能用、能抵多少、原因文案全是后端给的,这里只负责显示和把选择回传。 */
  openCouponPanel() {
    if (!this.data.couponOptions.length) { wx.showToast({ title: '顾客券包里没有券', icon: 'none' }); return }
    this.setData({ couponPanel: true })
  },
  closeCouponPanel() { this.setData({ couponPanel: false }) },
  noop() { /* 面板内点击不穿透到遮罩 */ },
  pickCoupon(e) {
    const id = e.currentTarget.dataset.id || ''
    const picked = this.data.couponOptions.find((o) => o.grantId === id)
    if (id && picked && !picked.usable) { wx.showToast({ title: picked.reason || '这张券本单用不了', icon: 'none' }); return }
    this.setData({ couponGrantId: id, couponPanel: false })
    this.refresh()
  },

  // 每次改动都问一次后端要金额。节流 250ms,避免连点 ＋ 时打一串请求。
  refresh() {
    clearTimeout(this._t)
    this._t = setTimeout(() => this.doPreview(), 250)
  },
  async doPreview() {
    try {
      const r = await api.adminPost('/admin/settlements/preview', this.formBody())
      const s = r.settlement || {}
      const d = displayOf(s)
      const m = (cents) => formatMoney(cents, d, d.trimZeroDecimals ? 0 : 2)
      const pay = s.payment || {}
      const view = {
        listTotal: m(s.listTotalCents), subtotal: m(s.subtotalCents),
        depositDeduct: m(s.depositDeductCents), discountTotal: m(s.discountTotalCents),
        total: m(s.totalCents),
        hasDeposit: s.depositDeductCents > 0,
        // 券:抵扣额与「共优惠(含券)」都由后端算好,这里只换个显示格式
        couponDeduct: m(s.couponDiscountCents || 0),
        hasCoupon: (s.couponDiscountCents || 0) > 0,
        couponName: s.coupon ? s.coupon.name : '',
        discountLabel: (s.couponDiscountCents || 0) > 0 ? '共优惠（含券）' : '较原价共优惠',
        lines: (s.lines || []).map((l) => ({
          no: l.itemNo, name: l.name, qty: l.qty, unit: l.unit,
          amount: l.amountCents === 0 ? '免收' : m(l.amountCents),
          list: l.listAmountCents !== l.amountCents ? m(l.listAmountCents) : ''
        })),
        // R6①:腿文案后端下发(「迁移余额」这种内部说法不再露给店员/顾客)
        legs: (pay.legs || []).map((l) => ({ label: l.label || l.leg, amount: m(l.amountCents) })),
        // R6②:没有定金收取记录就不出那个开关,改成一行说明
        depositReceiptCents: s.depositReceiptCents || 0,
        hasDepositReceipt: (s.depositReceiptCents || 0) > 0,
        depositHint: s.depositHint || '',
        balance: m(pay.balanceAvailableCents || 0),
        shortfall: m(pay.shortfallCents || 0),
        hasShortfall: (pay.shortfallCents || 0) > 0,
        warnings: (s.softWarnings || []).map((w) => w.message)
      }
      // 券包:后端已按可用/不可用排好序,前端只把金额换成显示格式
      const options = (s.couponOptions || []).map((o) => Object.assign({}, o, {
        deductText: o.usable ? `−${m(o.discountCents)}` : ''
      }))
      const prev = this.data.display
      this.setData({
        preview: s, view, display: d,
        couponOptions: options,
        couponUsableCount: s.couponUsableCount || 0,
        couponPicked: s.coupon ? Object.assign({}, s.coupon, { deductText: `−${m(s.coupon.discountCents)}` }) : null,
        // 后端没认这张券(过期/被别处占用等)时,把本地选择也清掉,不留一个假的已选态
        couponGrantId: s.coupon ? s.coupon.grantId : ''
      })
      this.buildTechRows()
      // 币种格式是第一次试算才拿到的,拿到后要把目录里的价格重新格式化一遍
      if (!prev || prev.symbol !== d.symbol || prev.prefix !== d.prefix) this.renderCatalogue()
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '试算失败', icon: 'none' })
    }
  },

  /* ===== 屏 S3 出示二维码(2026-08-09 图 S3 + 规则④⑧)=====
     码 = 这张单的一次性签署链接。沙盒态按店主 08-09 拍板(b)走:
     **占位图 + 链接文字 + 复制链接 + 状态行**;真码等接微信官方 wxacode.getUnlimited
     再补(不自研 QR 编码器 —— 本地无法自验的东西不进仓)。
     状态行三态:等待顾客进入 → 顾客核对中 → 已签署(自动关闭回今日台面)。 */
  async openQr(sheet) {
    if (!sheet) { wx.navigateBack(); return }
    try {
      const r = await api.adminPost(`/admin/settlements/${encodeURIComponent(sheet.id)}/sign-token`, {})
      const s = r.settlement || {}
      const m = (c) => storeMoney(c, 2)
      this.setData({
        qr: {
          settlementId: sheet.id,
          code: s.code || sheet.code,
          url: r.url,
          pushedText: r.pushedText || '',
          amountText: `应收 ${m(s.totalCents)}`,
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
      wx.navigateBack()
    }
  },
  // 状态行实时刷新(规则④)。签署完成 → 自动关闭并回今日台面。
  pollQr() {
    clearTimeout(this._qrTimer)
    this._qrTimer = setTimeout(async () => {
      const q = this.data.qr
      if (!q) return
      try {
        const st = await api.adminGet(`/admin/settlements/${encodeURIComponent(q.settlementId)}/sign-state`)
        this.setData({ 'qr.state': st.state, 'qr.stateText': st.text })
        if (st.state === 'signed') {
          wx.showToast({ title: '顾客已签署', icon: 'success' })
          setTimeout(() => { this.setData({ qr: null }); wx.navigateBack() }, 900)
          return
        }
      } catch (e) { /* 网络抖一下不打断,下一轮再问 */ }
      this.pollQr()
    }, 2500)
  },
  closeQr() { clearTimeout(this._qrTimer); this.setData({ qr: null }); wx.navigateBack() },
  copyQrLink() {
    wx.setClipboardData({ data: this.data.qr.url, success: () => wx.showToast({ title: '链接已复制', icon: 'none' }) })
  },
  // 兜底:顾客不扫码 —— 店员设备当面手签(档案保持未绑定)
  handSign() {
    clearTimeout(this._qrTimer)
    const code = this.data.qr.code
    this.setData({ qr: null })
    wx.navigateTo({ url: `/pages/sign/index?code=${encodeURIComponent(code)}` })
  },
  onUnload() { clearTimeout(this._qrTimer) },

  async submit() {
    if (this.data.submitting) return
    if (!this.data.userId) { wx.showToast({ title: '这单没有绑定顾客,无法结算', icon: 'none' }); return }
    if (!Object.keys(this.data.picked).length && !this.data.customItems.length) { wx.showToast({ title: '先勾项目', icon: 'none' }); return }
    if (!this.data.selectedTechs.length) { wx.showToast({ title: '先勾本单技师', icon: 'none' }); return }
    const map = this.techItems || {}
    const body = Object.assign(this.formBody(), {
      cardOwnerUserId: this.data.userId,
      servedPersonName: this.data.servedPersonName || '',
      tierChangedFrom: this.data.tierChanged ? this.data.tierDefault : undefined,
      technicians: this.data.selectedTechs.map((id, index) => ({
        technicianId: id, role: index === 0 ? 'main' : 'assist', itemNos: map[id] || []
      }))
    })
    this.setData({ submitting: true })
    try {
      const r = await api.adminPost('/admin/settlements', body)
      // 屏 S3:推送签署后**所有单都弹**二维码层(不分绑没绑定)
      await this.openQr((r.settlements || [])[0])
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '开单失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
