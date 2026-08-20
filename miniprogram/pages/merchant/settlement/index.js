/* 屏 1｜技师端 · 结算开单 —— 服务分组完整版(图 v2.2 = 合同,2026-08-12)
   金额红线:本页一处运算都没有。所有金额(各组行/合计/优惠/抵扣/应收/支付腿)
   都来自 POST /admin/settlements/preview 的**组级预览**,与正式开单同一个 computeSettlement;
   组级加总与储值顺序抵扣也在后端做 —— 前端只负责:每组勾了什么 → 发给后端 → 显示。
   结构:组内六件套(价格体系/服务项目/加项/自选/技师/被服务者)× N 组 + 单级四件
   (定金/支付菜单/分组明细合计/推送签署)。 */
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
const TIER_LABEL = { list: '原价', share: '分享价', member: '会员价', course: '疗程价' }

/* 加项按主项目类别过滤(合同规则①③):正式映射日后在 S1 可配,眼下用「甲/睫」域启发式 ——
   类别名含「睫」=lash,含「甲」=nail,其余=other;未归类(无类别)的加项各组都显示。 */
function domainOfName(name) {
  const n = String(name || '')
  if (n.includes('睫')) return 'lash'
  if (n.includes('甲')) return 'nail'
  return 'other'
}

function newGroup(tierDefault, firstCat) {
  return {
    key: '', label: '',        // renderAll 按位置补(①②…);wxml 不做字符串下标运算
    tierKey: tierDefault, tierDefault, tierChanged: false,
    catId: firstCat || '',
    mainId: '',                 // 组内单选(替换=换掉它)
    timecardId: '', timecardServiceId: '',  // B1 次卡核销组(与 mainId 互斥;金额=折算单价,后端算)
    addonIds: {},               // serviceId -> qty(按指用数量,其余恒 1)
    customItems: [], customName: '', customAmount: '',
    selectedTechs: [],
    servedPersonName: '',
    collapsed: false,
    // 规则⑧(v2.3 原样恢复):双技师时各自点选自己做的条目编号;{techId: [itemNo,...]}
    // 考据结论:原实现按**数字位**保留(条目重排后不跟随也不清空,与重构前一致)
    techItems: {},
    // 渲染缓存(renderGroup / doPreview 填)
    mainItems: [], addonGroups: [], mainName: '', summary: '', techRows: null, numbered: null
  }
}

// 条目编号显示位(规则⑧):后端 itemNo 从 1 起;超过 10 直接显示数字
const NO_MARKS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']
const noMark = (n) => NO_MARKS[n - 1] || String(n)

Page({
  // 门禁:未登录/会话失效不渲染空壳,直接回登录页(店主 2026-08-09 红线)
  onShow() { api.guardMerchant() },
  data: {
    ready: false,
    bookingId: '', userId: '', customerName: '',
    display: null,
    tiers: TIERS,
    cats: [], roster: [],
    groups: [],
    depositApplied: true, depositDeductible: true,
    /* 单级支付菜单(合同规则③):勾"路",钱后端算。
       useBalance=储值卡抵扣;useDeposit=已收定金抵扣(=depositApplied);
       recharge=现场充值再抵扣;线下收款行 = 差额去处,由后端 offlineDue 回显。 */
    payMenu: { useBalance: true, recharge: false },
    // 整单规则(足部加收/甲片重复利用):图 v2.2 未画,按现状保留为单级,发给组①(记假设)
    applyFootSurcharge: false, applyTipReuse: false,
    couponGrantId: '', couponPanel: false, couponOptions: [], couponUsableCount: 0, couponPicked: null,
    preview: null, view: null,
    bind: { bound: true, badgeText: '', hintText: '', phoneMasked: '', memberCode: '' },
    qr: null,
    bindQr: null,      // 出示绑定码弹层(规则⑦)
    rvPanel: null,      // 内嵌充值面板(合同规则③-2)
    ctaText: '推送签署',
    submitting: false
  },

  onLoad(q) {
    /* D9 规则⑤:?qrFor=<settlementId> = 纯出码模式(台面「递给顾客签」的未绑定客通道) */
    if (q.qrFor) {
      this._qrOnly = true
      this.setData({ qrOnly: true })
      this.openQr({ id: decodeURIComponent(q.qrFor) })
      return
    }
    this.setData({
      bookingId: q.bookingId || '',
      userId: q.userId || '',
      customerName: decodeURIComponent(q.name || '') || '顾客'
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
      /* B1(图 §四 屏1):次卡大类——该顾客有可用卡才亮起,角标=可核销数;
         数据源=三端同一持卡接口(剩0接口层已隐,过期带位置灰)。 */
      let timecards = []
      if (this.data.userId) {
        const tc = await api.adminGet(`/admin/customers/${encodeURIComponent(this.data.userId)}/timecards`).catch(() => null)
        timecards = (tc && tc.timecards) || []
      }
      // 组内价格体系:默认按系统会员判定自动选档(现有口径,落到每一组;可手动改,改档留痕)
      let tierDefault = 'list'
      if (this.data.userId) {
        const m = await api.adminGet(`/admin/membership/members?userId=${encodeURIComponent(this.data.userId)}`).catch(() => null)
        const one = m && (m.members || [])[0]
        if (one && one.isMember) tierDefault = 'member'
      }
      const firstCat = (categories[0] || {}).id || ''
      const g0 = newGroup(tierDefault, firstCat)
      // 预约带入的主项目 = 组① 的单选位
      if (preselectServiceId && all.some((i) => i.id === preselectServiceId)) {
        g0.mainId = preselectServiceId
        g0.catId = this.catOf(preselectServiceId) || firstCat
      }
      this.setData({
        ready: true,
        cats: categories.map((c) => ({ id: c.id, name: c.name }))
          .concat(timecards.length ? [{ id: '__timecard', name: '次卡', badge: timecards.filter((c) => c.redeemable).length }] : []),
        timecards,
        roster: (techs.technicians || []).map((t) => ({ id: t.id, name: t.name, title: t.title || '' })),
        depositDeductible: dep && dep.config ? dep.config.deductible !== false : true,
        depositApplied: Boolean(this.data.bookingId),
        groups: [g0]
      })
      this.loadBindState()
      this.renderAll()
      this.refresh()
      /* D28 规则①「继续结算」:本预约已有待签单 → 自动回到出码态续办。
         非 qrOnly:整页都在,关掉码还能操作绑定/充值;重复开单后端 409 挡着(双单口径)。 */
      if (this.data.bookingId) {
        try {
          const r = await api.adminGet(`/admin/settlements?bookingId=${encodeURIComponent(this.data.bookingId)}`)
          const pending = ((r && r.settlements) || []).filter((s) => s.status === 'pending_sign')
          if (pending.length) {
            wx.showToast({ title: `该预约已有待签单 ${pending.length} 张,继续办理`, icon: 'none', duration: 2200 })
            this.openQr(pending[0])
          }
        } catch (e) { /* 拉不到不挡页面 */ }
      }
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载价目表失败', icon: 'none' })
    }
  },

  async loadBindState() {
    if (!this.data.userId) return
    try {
      const r = await api.adminGet(`/admin/customers/lookup?userId=${encodeURIComponent(this.data.userId)}`)
      const hit = r && r.hit
      if (!hit) return
      this.setData({
        bind: { bound: hit.bound, badgeText: hit.badgeText || '', hintText: hit.hintText || '', phoneMasked: hit.phoneMasked || '', memberCode: hit.memberCode || '' }
      })
    } catch (e) { /* 拉不到不挡开单 */ }
  },

  catOf(serviceId) {
    const it = (this.allItems || []).find((x) => x.id === serviceId)
    return it ? (it.categoryId || '') : ''
  },
  catNameOf(catId) {
    return ((this.data.cats || []).find((c) => c.id === catId) || {}).name || ''
  },

  /* ===== 组渲染(目录挑行,零金额运算) ===== */
  renderGroup(g) {
    const field = TIER_PRICE_FIELD[g.tierKey] || 'listPriceCents'
    const d = this.data.display
    const priceOf = (it) => {
      const cents = it[field] === null || it[field] === undefined ? it.listPriceCents : it[field]
      return { cents, text: formatMoney(cents, d, d && d.trimZeroDecimals ? 0 : 2) }
    }
    const listOf = (it) => formatMoney(it.listPriceCents, d, d && d.trimZeroDecimals ? 0 : 2)
    const decorate = (it) => {
      const p = priceOf(it)
      return {
        id: it.id, name: it.nameZh, unit: it.unit,
        priceText: p.cents === 0 ? '免收' : p.text,
        isFree: p.cents === 0,
        listText: it.listPriceCents !== p.cents ? listOf(it) : '',
        perFinger: it.unit === 'per_finger',
        qty: it.itemKind === 'addon' ? (g.addonIds[it.id] || 0) : (g.mainId === it.id ? 1 : 0),
        on: it.itemKind === 'addon'
          ? Object.prototype.hasOwnProperty.call(g.addonIds, it.id)
          : g.mainId === it.id
      }
    }
    const all = this.allItems || []
    g.mainItems = all.filter((i) => (i.itemKind || 'main') === 'main' && (i.categoryId || '') === g.catId).map(decorate)
    // B1 次卡核销组:卡列表(label 后端句/过期灰)+组内项目 chips(project_group→同名二级分类,空组=全部主项目)
    if (g.catId === '__timecard') {
      g.tcCards = (this.data.timecards || []).map((c) => Object.assign({}, c, { on: g.timecardId === c.id }))
      const card = (this.data.timecards || []).find((c) => c.id === g.timecardId)
      g.tcServices = card
        ? all.filter((i) => (i.itemKind || 'main') === 'main')
          .filter((i) => !card.projectGroup || this.catNameOf(i.categoryId) === card.projectGroup)
          .map((i) => ({ id: i.id, name: i.nameZh, on: g.timecardServiceId === i.id }))
        : []
      g.tcName = card ? card.name : ''
    } else { g.tcCards = []; g.tcServices = []; g.tcName = '' }
    // 加项按本组主项目类别过滤(甲/睫域启发式;未归类各组都显示;S1 可配映射落地前的代行)
    const main = all.find((x) => x.id === g.mainId)
    const groupDomain = main ? domainOfName(this.catNameOf(main.categoryId)) : null
    const addons = all.filter((i) => i.itemKind === 'addon').filter((i) => {
      if (!i.categoryId) return true
      if (!groupDomain) return true            // 未选主项目时先全量显示(记假设)
      return domainOfName(this.catNameOf(i.categoryId)) === groupDomain
    })
    const groupMap = {}
    const order = []
    addons.forEach((i) => {
      const key = (i.addonGroup || '').trim() || '其他加项'
      if (!groupMap[key]) { groupMap[key] = { title: key, items: [] }; order.push(key) }
      groupMap[key].items.push(decorate(i))
    })
    const sorted = order.filter((k) => k !== '其他加项').concat(order.includes('其他加项') ? ['其他加项'] : [])
    g.addonGroups = sorted.map((k) => groupMap[k])
    g.mainName = main ? main.nameZh : (g.timecardId ? `次卡核销 · ${g.tcName}` : '')
    // 收起态摘要(图 屏2 上半):主项 · 技师;下一行 档位 · 加项 · 自选 · 被服务者
    const techNames = g.selectedTechs.map((id) => ((this.data.roster.find((t) => t.id === id) || {}).name)).filter(Boolean)
    const addonNames = Object.keys(g.addonIds).map((id) => ((all.find((x) => x.id === id) || {}).nameZh)).filter(Boolean)
    g.summary = [
      TIER_LABEL[g.tierKey] || g.tierKey,
      addonNames.length ? `加项:${addonNames.join('/')}` : '',
      g.customItems.length ? `自选:${g.customItems.map((c) => c.name).join('/')}` : '',
      `被服务者:${g.servedPersonName || '本人'}`
    ].filter(Boolean).join(' · ')
    g.techLine = techNames.join('/')
    return g
  },
  renderAll() {
    const marks = ['①', '②', '③', '④', '⑤']
    const groups = this.data.groups.map((g, i) => {
      g.key = 'g' + i
      g.label = marks[i] || String(i + 1)
      return this.renderGroup(g)
    })
    this.setData({ groups })
  },

  /* ===== 组内六件套操作(全部带 data-g) ===== */
  gPickTier(e) {
    const { g, k } = e.currentTarget.dataset
    const groups = this.data.groups.slice()
    groups[g].tierKey = k
    groups[g].tierChanged = k !== groups[g].tierDefault
    this.setData({ groups })
    this.renderAll(); this.refresh()
  },
  gPickCat(e) {
    const { g, id } = e.currentTarget.dataset
    const groups = this.data.groups.slice()
    groups[g].catId = id
    this.setData({ groups })
    this.renderAll()
  },
  // 服务项目:组内单选自动替换(e8ea109 逻辑,作用域=本组);再点已选=取消
  gToggleMain(e) {
    const { g, id } = e.currentTarget.dataset
    const groups = this.data.groups.slice()
    const grp = groups[g]
    grp.mainId = grp.mainId === id ? '' : id
    if (grp.mainId && grp.timecardId) { grp.timecardId = ''; grp.timecardServiceId = ''; wx.showToast({ title: '本组切回普通开单,已取消次卡核销', icon: 'none' }) }
    // 合同规则④:换主项目后,类别不符的加项自动清除并提示
    const dropped = this.dropMismatchedAddons(grp)
    this.setData({ groups })
    this.renderAll(); this.refresh()
    if (dropped.length) wx.showToast({ title: `已清除类别不符的加项:${dropped.join('、')}`, icon: 'none', duration: 2500 })
  },
  // B1:选卡(过期/用完点击拦;与主项目互斥=一组要么核销要么普通;再点已选=取消)
  gPickTimecard(e) {
    const { g, id } = e.currentTarget.dataset
    const groups = this.data.groups.slice()
    const grp = groups[g]
    const card = (this.data.timecards || []).find((c) => c.id === id)
    if (!card) return
    if (!card.redeemable) { wx.showToast({ title: card.expired ? '这张卡已过期,不能核销' : '这张卡已用完', icon: 'none' }); return }
    if (grp.timecardId === id) { grp.timecardId = ''; grp.timecardServiceId = '' }
    else {
      grp.timecardId = id
      grp.timecardServiceId = ''
      if (grp.mainId) { grp.mainId = ''; wx.showToast({ title: '本组切为次卡核销,已清除主项目', icon: 'none' }) }
    }
    this.setData({ groups }); this.renderAll(); this.refresh()
  },
  gPickTcService(e) {
    const { g, id } = e.currentTarget.dataset
    const groups = this.data.groups.slice()
    const grp = groups[g]
    grp.timecardServiceId = grp.timecardServiceId === id ? '' : id
    this.setData({ groups }); this.renderAll(); this.refresh()
  },
  dropMismatchedAddons(grp) {
    const all = this.allItems || []
    const main = all.find((x) => x.id === grp.mainId)
    if (!main) return []
    const groupDomain = domainOfName(this.catNameOf(main.categoryId))
    const dropped = []
    for (const id of Object.keys(grp.addonIds)) {
      const a = all.find((x) => x.id === id)
      if (a && a.categoryId && domainOfName(this.catNameOf(a.categoryId)) !== groupDomain) {
        dropped.push(a.nameZh)
        delete grp.addonIds[id]
      }
    }
    return dropped
  },
  gToggleAddon(e) {
    const { g, id } = e.currentTarget.dataset
    const groups = this.data.groups.slice()
    const grp = groups[g]
    if (Object.prototype.hasOwnProperty.call(grp.addonIds, id)) delete grp.addonIds[id]
    else grp.addonIds[id] = 1
    this.setData({ groups })
    this.renderAll(); this.refresh()
  },
  gStepQty(e) {
    const { g, id, d } = e.currentTarget.dataset
    const groups = this.data.groups.slice()
    const grp = groups[g]
    const next = Math.max(0, (grp.addonIds[id] || 0) + Number(d))
    if (next === 0) delete grp.addonIds[id]
    else grp.addonIds[id] = next
    this.setData({ groups })
    this.renderAll(); this.refresh()
  },
  gCustomName(e) {
    const groups = this.data.groups.slice()
    groups[e.currentTarget.dataset.g].customName = e.detail.value
    this.setData({ groups })
  },
  gCustomAmount(e) {
    const groups = this.data.groups.slice()
    groups[e.currentTarget.dataset.g].customAmount = e.detail.value
    this.setData({ groups })
  },
  gAddCustom(e) {
    const gi = e.currentTarget.dataset.g
    const groups = this.data.groups.slice()
    const grp = groups[gi]
    const name = (grp.customName || '').trim()
    const amount = (grp.customAmount || '').trim()
    if (!name || !amount) { wx.showToast({ title: '填项目名称和金额', icon: 'none' }); return }
    const cents = Math.round(Number(amount.replace(/[^\d.]/g, '')) * 100)
    if (!Number.isFinite(cents) || cents <= 0) { wx.showToast({ title: '金额不对', icon: 'none' }); return }
    grp.customItems = grp.customItems.concat([{ name, amountCents: cents, amountText: storeMoney(cents, cents % 100 ? 2 : 0) }])
    grp.customName = ''; grp.customAmount = ''
    this.setData({ groups })
    this.renderAll(); this.refresh()
  },
  gRemoveCustom(e) {
    const { g, i } = e.currentTarget.dataset
    const groups = this.data.groups.slice()
    groups[g].customItems = groups[g].customItems.slice()
    groups[g].customItems.splice(Number(i), 1)
    this.setData({ groups })
    this.renderAll(); this.refresh()
  },
  gToggleTech(e) {
    const { g, id } = e.currentTarget.dataset
    const groups = this.data.groups.slice()
    const sel = groups[g].selectedTechs.slice()
    const at = sel.indexOf(id)
    if (at >= 0) sel.splice(at, 1)
    else { if (sel.length >= 2) { wx.showToast({ title: '每组最多两位技师', icon: 'none' }); return } sel.push(id) }
    groups[g].selectedTechs = sel
    this.setData({ groups })
    // 技师不改钱,但明细区组标题里有技师行 —— 不刷新会显示旧技师(两处说两句话)
    this.renderAll(); this.refresh()
  },
  /* 规则⑧:技师点选自己做的条目编号(一个编号可两人都点=共做;单技师不出数字排)。
     无拦截无新校验 —— 分配只随单记录进日结分成参考,钱仍店长日结核定。 */
  gToggleTechItem(e) {
    const { g, tech, no } = e.currentTarget.dataset
    const groups = this.data.groups.slice()
    const grp = groups[g]
    grp.techItems = Object.assign({}, grp.techItems)
    const cur = (grp.techItems[tech] || []).slice()
    const at = cur.indexOf(Number(no))
    if (at >= 0) cur.splice(at, 1)
    else cur.push(Number(no))
    grp.techItems[tech] = cur
    this.setData({ groups })
    this.buildTechRows()
  },
  // 数字排与编号清单都从**后端预览行的 itemNo** 来(金额红线同源,不自己编号)
  buildTechRows() {
    const sheets = ((this.data.preview || {}).sheets) || []
    const groups = this.data.groups.map((g, i) => {
      const lines = ((sheets[i] || {}).lines || []).filter((l) => l.kind !== 'rule')
      if (g.selectedTechs.length === 2 && lines.length) {
        g.numbered = lines.map((l) => ({ no: l.itemNo, label: noMark(l.itemNo), name: l.name }))
        g.techRows = g.selectedTechs.map((id) => {
          const t = (this.data.roster || []).find((x) => x.id === id) || { name: '' }
          return {
            id, name: t.name,
            chips: lines.map((l) => ({ no: l.itemNo, label: noMark(l.itemNo), on: (g.techItems[id] || []).indexOf(l.itemNo) >= 0 }))
          }
        })
      } else {
        g.numbered = null
        g.techRows = null
      }
      return g
    })
    this.setData({ groups })
  },
  gServedName(e) {
    const groups = this.data.groups.slice()
    groups[e.currentTarget.dataset.g].servedPersonName = (e.detail.value || '').trim()
    this.setData({ groups })
    this.renderAll(); this.refresh()
  },
  // 「＋添加第二个服务项目」:新组同构六件套;组①收起成摘要行(图 屏2)
  addGroup() {
    const groups = this.data.groups.map((g) => Object.assign({}, g, { collapsed: true }))
    const proto = this.data.groups[0]
    groups.push(newGroup(proto.tierDefault, (this.data.cats[0] || {}).id))
    this.setData({ groups })
    this.renderAll(); this.refresh()
  },
  // 组② 整组 ✕;组① 只可替换不可移除(合同规则④)
  removeGroup(e) {
    const gi = Number(e.currentTarget.dataset.g)
    if (gi === 0) { wx.showToast({ title: '第一组只可替换,不可移除', icon: 'none' }); return }
    const groups = this.data.groups.slice()
    groups.splice(gi, 1)
    if (groups.length === 1) groups[0].collapsed = false
    this.setData({ groups })
    this.renderAll(); this.refresh()
  },
  gToggleCollapse(e) {
    const gi = Number(e.currentTarget.dataset.g)
    const groups = this.data.groups.slice()
    groups[gi].collapsed = !groups[gi].collapsed
    this.setData({ groups })
  },

  /* ===== 单级四件 ===== */
  setDeposit(e) { this.setData({ depositApplied: e.currentTarget.dataset.v === '1' }); this.refresh() },
  toggleFoot() { this.setData({ applyFootSurcharge: !this.data.applyFootSurcharge }); this.refresh() },
  toggleTipReuse() { this.setData({ applyTipReuse: !this.data.applyTipReuse }); this.refresh() },
  // 支付菜单(合同规则③):勾选只选"路",金额全部后端重算回显
  payToggleBalance() {
    const m = this.data.payMenu
    this.setData({ payMenu: { useBalance: !m.useBalance, recharge: m.useBalance ? false : m.recharge } })
    this.refresh()
  },
  payToggleDeposit() { this.setData({ depositApplied: !this.data.depositApplied }); this.refresh() },
  payToggleOffline() {
    // 线下收款 = 差额的去处;差额>0 时不能取消勾(钱得有地方收),提示后维持原状
    const v = this.data.view
    if (v && v.hasOffline) { wx.showToast({ title: '还有差额要到店收;想不走线下就先充值抵扣', icon: 'none' }); return }
  },
  payToggleRecharge() {
    const m = this.data.payMenu
    const next = !m.recharge
    this.setData({ payMenu: { useBalance: next ? true : m.useBalance, recharge: next } })
    this.refresh()
  },
  payIntentOf() {
    const m = this.data.payMenu
    if (m.recharge) return 'recharge_then_balance'
    return m.useBalance ? 'balance_plus_offline' : 'offline_full'
  },

  /* ===== 内嵌充值面板(合同规则③-2:复用既有代充流程,技师不离开结算单) =====
     权限口径(店主 2026-08-12 拍板):面板对技师开放 —— 充值=预收轻动作,金额只能选套餐/手输、
     赠额按套餐自动、后端强制经手人=当前技师留痕;耗卡与财务页门禁不变。
     D25(《财务总逻辑》3-1b):未绑定轻档案不可充值 —— 链接禁用态,点了给提示;后端同拦。 */
  async openRecharge() {
    if (!this.data.userId || !this.data.bind.bound) {
      wx.showToast({ title: '请先让顾客扫码绑定(会员码/签署码)再充值', icon: 'none', duration: 2500 })
      return
    }
    let tiers = []
    try { tiers = ((await api.adminGet('/admin/recharge-tiers')).tiers || []).filter((t) => t.isActive) } catch (e) { /* 无档位也能手输 */ }
    const d = this.data.display
    const m = (c) => formatMoney(c, d, d && d.trimZeroDecimals ? 0 : 2)
    this.setData({
      rvPanel: {
        amount: '', amountText: '',
        tierId: '',
        tiers: tiers.map((t) => ({
          id: t.id, amountCents: t.amountCents, amountText: m(t.amountCents),
          // 赠额只按档位规则自动算(涉钱轻动作口径);券/项目类赠送随 S2,先只显示说明
          bonusCents: t.gift && t.gift.type === 'amount' ? Math.round(Number(t.gift.value) || 0)
            : (t.gift && t.gift.type === 'percent' ? Math.round(t.amountCents * (Number(t.gift.value) || 0) / 100) : 0),
          giftText: t.gift && t.gift.type === 'percent' ? `赠 ${t.gift.value}%`
            : (t.gift && t.gift.type === 'amount' ? `赠 ${m(Math.round(Number(t.gift.value) || 0))}`
              : (t.gift && t.gift.type ? '含赠送(券/项目,S2 支持)' : '无赠送'))
        }))
      }
    })
  },
  closeRecharge() { this.setData({ rvPanel: null }) },
  rvPickTier(e) {
    const id = e.currentTarget.dataset.id
    const p = this.data.rvPanel
    const t = p.tiers.find((x) => x.id === id)
    if (!t) return
    this.setData({ rvPanel: Object.assign({}, p, { tierId: id, amount: String(t.amountCents / 100), amountText: '' }) })
  },
  rvAmountInput(e) {
    const p = this.data.rvPanel
    this.setData({ rvPanel: Object.assign({}, p, { amount: e.detail.value, tierId: '' }) })
  },
  async rvConfirm() {
    const p = this.data.rvPanel
    if (!p) return
    const tier = p.tiers.find((x) => x.id === p.tierId)
    const payCents = Math.round(Number(String(p.amount || '').replace(/[^\d.]/g, '')) * 100)
    if (!Number.isFinite(payCents) || payCents <= 0) { wx.showToast({ title: '金额不对', icon: 'none' }); return }
    const bonus = tier ? tier.bonusCents : 0
    try {
      /* ⬜ 假设(记清单):档位充值按「实收+赠额」一笔入储值(充值=预收不进收入,口径不变),
         note 拆明实收与赠额;实收/赠送分笔的正式账目口径随 S2。 */
      await api.adminPost('/admin/stored-value/recharge', {
        userId: this.data.userId,
        amountCents: payCents + bonus,
        payChannel: 'manual',
        note: tier ? `结算单内代充·档位 实收${payCents / 100} + 赠${bonus / 100}` : '结算单内代充·手输金额'
      })
      wx.showToast({ title: '已到账,余额已刷新', icon: 'none' })
      // 充完自动回本单:关面板 → 余额随组级预览刷新 → 储值选项变可勾
      this.setData({ rvPanel: null, payMenu: { useBalance: true, recharge: false } })
      this.refresh()
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '充值失败,请重试或找老板处理', icon: 'none' })
    }
  },

  /* ===== 券(单级,挂组①的单;一单一张口径不变;图 v2.2 未画券区,按现状保留 —— 记假设) ===== */
  openCouponPanel() {
    if (!this.data.couponOptions.length) { wx.showToast({ title: '顾客券包里没有券', icon: 'none' }); return }
    this.setData({ couponPanel: true })
  },
  closeCouponPanel() { this.setData({ couponPanel: false }) },
  noop() { /* 面板内点击不穿透 */ },
  pickCoupon(e) {
    const id = e.currentTarget.dataset.id || ''
    const picked = this.data.couponOptions.find((o) => o.grantId === id)
    if (id && picked && !picked.usable) { wx.showToast({ title: picked.reason || '这张券本单用不了', icon: 'none' }); return }
    this.setData({ couponGrantId: id, couponPanel: false })
    this.refresh()
  },

  /* ===== 组级预览 ===== */
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
      return {
        bookingId: i === 0 ? (this.data.bookingId || undefined) : undefined,
        tierKey: g.tierKey,
        tierChangedFrom: g.tierChanged ? g.tierDefault : undefined,
        items,
        timecardId: g.timecardId || undefined,
        timecardServiceId: g.timecardId ? (g.timecardServiceId || undefined) : undefined,
        customItems: g.customItems.map((c) => ({ name: c.name, amountCents: c.amountCents })),
        servedPersonName: g.servedPersonName || '',
        // 规则⑧:分配随单记录(原样恢复=按数字位提交,不做过滤校验——别加戏)
        technicians: g.selectedTechs.map((id, index) => ({ technicianId: id, role: index === 0 ? 'main' : 'assist', itemNos: (g.techItems && g.techItems[id]) || [] })),
        payIntent: this.payIntentOf(),
        depositApplied: i === 0 ? this.data.depositApplied : false,
        couponGrantId: i === 0 ? (this.data.couponGrantId || undefined) : undefined,
        applyFootSurcharge: i === 0 ? this.data.applyFootSurcharge : false,
        applyTipReuse: i === 0 ? this.data.applyTipReuse : false
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
      settlements: this.groupSheets()
    }
  },
  refresh() {
    clearTimeout(this._t)
    this._t = setTimeout(() => this.doPreview(), 250)
  },
  async doPreview() {
    /* 响应次序护栏(2026-08-12 随机矩阵抓出):快速连点时,先发的预览响应可能后到,
       会把后点的状态(比如刚选的券)静默覆盖掉 —— 过期响应一律整包丢弃,只认最新一发。 */
    const seq = (this._pvSeq = (this._pvSeq || 0) + 1)
    const body = this.formBody()
    try {
      const r = await api.adminPost('/admin/settlements/preview', body)
      if (seq !== this._pvSeq) return
      const sheets = r.sheets || []
      const grp = r.group || {}
      const d = displayOf(sheets[0] || {})
      const m = (cents) => formatMoney(cents, d, d.trimZeroDecimals ? 0 : 2)
      const pay = grp.payment || {}
      const groupsState = this.data.groups
      // 分组明细:各组标题(项目N 主项·技师[·被服务者])+ 子行逐行原价划线(合同 单级③)
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
        // B1 自证行:次卡抵扣合计(组级 preview 回传;0=无核销组不渲染)
        hasTimecard: (pay.timecardCoverCents || 0) > 0,
        timecardCover: m(pay.timecardCoverCents || 0),
        // 到店应收 = 后端 offlineDue(组合计 − 储值抵扣;定金已在各单 total 内扣)
        total: m(pay.offlineDueCents != null ? pay.offlineDueCents : (grp.totalCents || 0)),
        balanceCents: pay.balanceAvailableCents || 0,
        balance: m(pay.balanceAvailableCents || 0),
        hasBalance: (pay.balanceAvailableCents || 0) > 0,
        depositReceiptCents: grp.depositReceiptCents || 0,
        hasDepositReceipt: (grp.depositReceiptCents || 0) > 0,
        hasOffline: (pay.offlineDueCents || 0) > 0,
        offlineDue: m(pay.offlineDueCents || 0),
        warnings: sheets.reduce((acc, s) => acc.concat((s.softWarnings || []).map((w) => w.message)), [])
      }
      // 券(组①):选项与已选照单级显示
      const s0 = sheets[0] || {}
      const options = (s0.couponOptions || []).map((o) => Object.assign({}, o, { deductText: o.usable ? `−${m(o.discountCents)}` : '' }))
      const prev = this.data.display
      /* 券回显护栏(2026-08-12 随机矩阵抓出的"点了券被吞"):
         响应说"没券"只有两种合法含义 —— ①这次请求带了券而后端没认(门槛没到等,落券);
         ②请求本来就没带券。②的响应可能发自用户点券**之前**,不许拿它清掉刚点的券:
         保持现选,点券时 refresh() 已排了下一发预览,马上会带着券重算。 */
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
      /* 🔴 D22 护栏(分组版):每组预览行必须与该组勾选一一对应,多/少都当场报警。 */
      const bodySheets = this.groupSheets()
      for (let i = 0; i < sheets.length; i += 1) {
        const wanted = (bodySheets[i].items || []).map((x) => x.serviceId).sort()
        const got = (sheets[i].lines || []).filter((l) => l.serviceId && l.kind !== 'rule').map((l) => l.serviceId).sort()
        if (JSON.stringify(wanted) !== JSON.stringify(got)) {
          wx.showToast({ title: `组${i + 1} 金额行与勾选不一致,请截图报给店主`, icon: 'none', duration: 4000 })
          break
        }
      }
      if (!prev || prev.symbol !== d.symbol || prev.prefix !== d.prefix) this.renderAll()
      // 规则⑧:预览行(itemNo)到位后重建各组数字排(编号=后端行号,不自己编)
      this.buildTechRows()
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '试算失败', icon: 'none' })
    }
  },

  /* ===== 出码 / 签署(现有闭环全保留;多组=同组多张单,顾客按 1/N 顺序签) ===== */
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
          unbound: r.customerBound === false,
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
      /* D27 家族(扫雷批⑥类):qrFor 模式 onLoad 即出码,失败若立刻 back 会撞进场转场 → 冻死。
         等转场走完再退;非纯出码模式留在页面即可。 */
      if (this._qrOnly) setTimeout(() => wx.navigateBack(), 700)
    }
  },
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
      } catch (e) { /* 网络抖动下一轮再问 */ }
      this.pollQr()
    }, 2500)
  },
  closeQr() {
    clearTimeout(this._qrTimer)
    this.setData({ qr: null })
    // D28:纯出码模式(qrFor)关码=离开;正常/续办模式关码留在结算页(还要绑定/充值)
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
      wx.showToast({ title: '新客需扫码签署(扫码即自动建立绑定)', icon: 'none' })
      return
    }
    clearTimeout(this._qrTimer)
    const code = this.data.qr.code
    this.setData({ qr: null })
    wx.navigateTo({ url: `/pages/sign/index?code=${encodeURIComponent(code)}` })
  },
  onUnload() { clearTimeout(this._qrTimer); clearTimeout(this._bindTimer) },

  /* ===== 出示绑定码(图 v2.3 规则⑦):指向档案的码,扫了只做绑定 =====
     入口:充值拦截提示条按钮 + 顾客区未绑定小字。沙盒=链接占位+复制(同签署码做法)。 */
  async openBindCode() {
    if (!this.data.userId) { wx.showToast({ title: '先选择顾客档案', icon: 'none' }); return }
    if (this.data.bind.bound) { wx.showToast({ title: '该档案已绑定,无需绑定码', icon: 'none' }); return }
    try {
      const r = await api.adminPost(`/admin/customers/${encodeURIComponent(this.data.userId)}/bind-token`, {})
      this.setData({ bindQr: { url: r.url, pagePath: r.pagePath, displayName: r.displayName, hint: r.hint, state: 'waiting', stateText: '等待顾客扫码绑定…' } })
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
          // 绑定事件到达:关弹层、刷徽标、充值解锁(重算让储值/推送状态跟上)
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
  /* D30:签署码「打开链接」—— 沙盒直落签署页(与真码扫后同一落点);
     真码上线后打开/复制两钮随占位一起撤(发版清单)。 */
  openQrLink() {
    if (!this.data.qr) return
    wx.navigateTo({ url: `/pages/sign/index?code=${encodeURIComponent(this.data.qr.code)}` })
  },
  // D26:绑定码「打开链接」 —— 沙盒直落本人确认卡(与真码扫后同一落点)
  openBindLink() {
    if (!this.data.bindQr) return
    wx.navigateTo({ url: this.data.bindQr.pagePath })
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
    // 每组:必须有内容(主项或自选)+ 1–2 位技师
    for (let i = 0; i < this.data.groups.length; i += 1) {
      const g = this.data.groups[i]
      if (!g.mainId && !Object.keys(g.addonIds).length && !g.customItems.length) {
        wx.showToast({ title: `项目${i + 1} 还没选内容`, icon: 'none' }); return
      }
      if (!g.selectedTechs.length) { wx.showToast({ title: `项目${i + 1} 先勾本组技师`, icon: 'none' }); return }
    }
    this.setData({ submitting: true })
    try {
      const r = await api.adminPost('/admin/settlements', this.formBody())
      // 多组=同组多张单;QR 出第一张,顾客按 待签 1/N 顺序签(既有闭环)
      await this.openQr((r.settlements || [])[0])
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '开单失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
