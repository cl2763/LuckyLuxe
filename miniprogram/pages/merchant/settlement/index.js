





const api = require('../../../utils/api')
const { formatMoney, displayOf } = require('../../../utils/money')
const { storeMoney } = require('../../../utils/storeclock')
const MemberPricingInput=require('../../../utils/member-pricing')
const TIERS = [
  { key: 'list', label: '原价' },
  { key: 'share', label: '分享价' },
  { key: 'member', label: '会员价' },
  { key: 'course', label: '疗程价' }
]
const TIER_PRICE_FIELD = { list: 'listPriceCents', share: 'sharePriceCents', member: 'memberPriceCents', course: 'coursePriceCents' }
const TIER_LABEL = { list: '原价', share: '分享价', member: '会员价', course: '疗程价' }


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
    purchasePackageId: '',                  // B1-6 现场购卡组(三态互斥:主项目/已有卡/购卡)
    addonIds: {},               // serviceId -> qty(按指用数量,其余恒 1)
    customItems: [], customName: '', customAmount: '',
    selectedTechs: [],
    servedPersonName: '', beneficiaryKey:'self',
    collapsed: false,


    techItems: {},

    mainItems: [], addonGroups: [], mainName: '', summary: '', techRows: null, numbered: null
  }
}

const NO_MARKS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']
const noMark = (n) => NO_MARKS[n - 1] || String(n)
const definition={

  onShow() { api.guardMerchant() },
  data: {
    ready: false,
    bootError: '',
    bookingId: '', userId: '', customerName: '',
    display: null,
    tiers: TIERS,
    cats: [], roster: [],
    groups: [],
    depositApplied: true, depositDeductible: true,



    payMenu: { useBalance: true, recharge: false },

    applyFootSurcharge: false, applyTipReuse: false,
    personCoupons:{},couponPersonKey:'self',personCouponSelected:'',couponDocumentNames:{},
    couponGrantId: '', couponPanel: false, couponOptions: [], couponUsableCount: 0, couponPicked: null,
    preview: null, view: null,
    bind: { bound: true, badgeText: '', hintText: '', phoneMasked: '', memberCode: '' },
    qr: null,
    bindQr: null,      // 出示绑定码弹层(规则⑦)
    rvPanel: null,      // 内嵌充值面板(合同规则③-2)


    rvDraft: null,
    ctaText: '核对并生成本次服务单',
    submitting: false
  },
  onLoad(q) {

    if (q.qrFor) {
      this._qrOnly = true
      this.setData({ qrOnly: true })
      this.openQr({ id: decodeURIComponent(q.qrFor) })
      return
    }
    this.setData({
      bookingId: q.bookingId || '',
      userId: q.userId || '',
      preselectServiceId: q.serviceId || '',
      customerName: decodeURIComponent(q.name || '') || '顾客'
    })
    this.boot(q.serviceId || '')
  },
  async boot(preselectServiceId) {
    this.setData({bootError:''})
    try {
      await this.bootMemberPricing()



      const [cats, items, techs, dep, tc, tp, m, existing] = await Promise.all([
        api.adminGet('/admin/pricing/categories'),
        api.adminGet('/admin/pricing/items'),
        api.adminGet('/admin/technicians?roster=1'),
        api.adminGet('/admin/deposit-config').catch(() => null),
        this.data.userId ? api.adminGet(`/admin/customers/${encodeURIComponent(this.data.userId)}/timecards`).catch(() => null) : null,
        api.adminGet('/admin/timecard-packages').catch(() => null),
        this.data.userId ? api.adminGet(`/admin/membership/members?userId=${encodeURIComponent(this.data.userId)}`).catch(() => null) : null,
        this.data.bookingId ? api.adminGet(`/admin/settlements?bookingId=${encodeURIComponent(this.data.bookingId)}`) : null
      ])
      const categories = (cats.categories || []).filter((c) => c.isBookable !== false)
      const all = (items.items || []).filter((i) => i.isActive !== false)
      this.allItems = all


      const timecards = (tc && tc.timecards) || []

      const timecardPackages = (tp && tp.packages) || []

      let tierDefault = 'list'
      if (this.data.userId) {
        const one = m && (m.members || [])[0]
        if (one && one.isMember) tierDefault = 'member'
      }
      const firstCat = (categories[0] || {}).id || ''
      const g0 = newGroup(tierDefault, firstCat)

      if (preselectServiceId && all.some((i) => i.id === preselectServiceId)) {
        g0.mainId = preselectServiceId
        g0.catId = this.catOf(preselectServiceId) || firstCat
      }
      for(const a of existing?.bookingItems||[])if(all.some(i=>i.id===a.serviceId))g0.addonIds[a.serviceId]=(g0.addonIds[a.serviceId]||0)+a.qty
      this.setData({
        bookingItemWarnings:existing?.bookingItemWarnings||[],
        ready: true,
        cats: categories.map((c) => ({ id: c.id, name: c.name }))
          .concat((timecards.length || timecardPackages.length) ? [{ id: '__timecard', name: '次卡', badge: timecards.filter((c) => c.redeemable).length }] : []),
        timecards,
        timecardPackages,
        roster: (techs.technicians || []).map((t) => ({ id: t.id, name: t.name, title: t.title || '' })),
        depositDeductible: dep && dep.config ? dep.config.deductible !== false : true,
        depositApplied: Boolean(this.data.bookingId),
        groups: [g0]
      })
      this.loadBindState()
      this.renderAll()
      this.refresh()


      if (this.data.bookingId) {
        try {
          const pending = ((existing && existing.settlements) || []).filter((s) => s.status === 'pending_sign')
          if (pending.length) {
            wx.showToast({ title: `该预约已有待签单 ${pending.length} 张,继续办理`, icon: 'none', duration: 2200 })
            if(this.data.pricingConfig.active&&pending[0].serviceDocument){const d=await api.adminGet('/admin/member-pricing/documents/'+encodeURIComponent(pending[0].serviceDocument.id));await this.mpLoadBatch(d.visitGroupId||d.groupId)}else this.openQr(pending[0])
          }
        } catch (e) { /* 拉不到不挡页面 */ }
      }
    } catch (e) {
      this.setData({bootError:(e && e.message) || '加载价目表失败'})
    }
  },

  retryBoot() { this.boot(this.data.preselectServiceId || '') },

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


  renderGroup(g) {
    const field = TIER_PRICE_FIELD[g.tierKey] || 'listPriceCents'
    const d = this.data.display
    const priceOf = (it) => {
      if(this.data.pricingConfig?.active){const p=this.catalogPrices?.items.find(p=>p.id===it.id),n=p?.prices[g.tierKey];return {cents:n,text:!p?'读取中…':p.requiresQuote?'需报价':n===undefined?'未配置':formatMoney(n,d,d&&d.trimZeroDecimals?0:2)}}
      const cents = it[field] === null || it[field] === undefined ? it.listPriceCents : it[field]
      return { cents, text: formatMoney(cents, d, d && d.trimZeroDecimals ? 0 : 2) }
    }
    const listOf = (it,p) => {const n=this.data.pricingConfig?.active?this.catalogPrices?.items.find(x=>x.id===it.id)?.prices.list:it.listPriceCents;return n==null||n===p.cents?'':formatMoney(n,d,d&&d.trimZeroDecimals?0:2)}
    const decorate = (it) => {
      const p = priceOf(it)
      return {
        id: it.id, name: it.nameZh, unit: it.unit,
        priceText: p.cents === 0 ? '免收' : p.text,
        isFree: p.cents === 0,
        listText: listOf(it,p),
        perFinger: it.unit === 'per_finger',
        qty: it.itemKind === 'addon' ? (g.addonIds[it.id] || 0) : (g.mainId === it.id ? 1 : 0),
        on: it.itemKind === 'addon'
          ? Object.prototype.hasOwnProperty.call(g.addonIds, it.id)
          : g.mainId === it.id
      }
    }
    const all = this.allItems || []
    g.quoteInputs=all.filter(it=>(it.id===g.mainId||Object.prototype.hasOwnProperty.call(g.addonIds,it.id))&&this.catalogPrices?.items.find(x=>x.id===it.id)?.requiresQuote).map(it=>({id:it.id,name:it.nameZh,value:g.quotedPrices?.[it.id]==null?'':String(g.quotedPrices[it.id]/100)}))
    g.mainItems = all.filter((i) => (i.itemKind || 'main') === 'main' && (i.categoryId || '') === g.catId).map(decorate)

    if (g.catId === '__timecard') {
      g.tcCards = (this.data.timecards || []).map((c) => Object.assign({}, c, { on: g.timecardId === c.id }))
      g.tcPkgs = (this.data.timecardPackages || []).map((p) => Object.assign({}, p, { on: g.purchasePackageId === p.id }))
      const card = (this.data.timecards || []).find((c) => c.id === g.timecardId)
      const pkg = (this.data.timecardPackages || []).find((p) => p.id === g.purchasePackageId)
      const groupName = card ? card.projectGroup : (pkg ? pkg.projectGroup : null)
      g.tcServices = (card || pkg)
        ? all.filter((i) => (i.itemKind || 'main') === 'main')
          .filter((i) => (!groupName || this.catNameOf(i.categoryId) === groupName) && (!card || !card.allowedServiceIds || card.allowedServiceIds.includes(i.id)))
          .map((i) => ({ id: i.id, name: i.nameZh, on: g.timecardServiceId === i.id }))
        : []
      g.tcName = card ? card.name : (pkg ? pkg.name : '')
      g.tcMode = card ? 'redeem' : (pkg ? 'purchase' : '')
    } else { g.tcCards = []; g.tcPkgs = []; g.tcServices = []; g.tcName = ''; g.tcMode = '' }

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
    g.mainName = main ? main.nameZh : (g.timecardId ? `次卡核销 · ${g.tcName}` : (g.purchasePackageId ? `现场购卡 · ${g.tcName}(当场核销第 1 次)` : ''))

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
    this.setData({ groups,people:this.data.pricingConfig?.active?MemberPricingInput.people(groups):groups.map((g,i)=>({key:String(i),groups:[{...g,index:i}]})) })
  },


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

  gToggleMain(e) {
    const { g, id } = e.currentTarget.dataset
    const groups = this.data.groups.slice()
    const grp = groups[g]
    grp.mainId = grp.mainId === id ? '' : id
    if (grp.mainId && (grp.timecardId || grp.purchasePackageId)) { grp.timecardId = ''; grp.purchasePackageId = ''; grp.timecardServiceId = ''; wx.showToast({ title: '本组切回普通开单,已取消次卡', icon: 'none' }) }

    const dropped = this.dropMismatchedAddons(grp)
    this.setData({ groups })
    this.renderAll(); this.refresh()
    if (dropped.length) wx.showToast({ title: `已清除类别不符的加项:${dropped.join('、')}`, icon: 'none', duration: 2500 })
  },

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
      grp.purchasePackageId = ''
      if (grp.mainId) { grp.mainId = ''; wx.showToast({ title: '本组切为次卡核销,已清除主项目', icon: 'none' }) }
    }
    this.setData({ groups }); this.renderAll(); this.refresh()
  },

  gPickPurchasePkg(e) {
    const { g, id } = e.currentTarget.dataset
    const groups = this.data.groups.slice()
    const grp = groups[g]
    if (grp.purchasePackageId === id) { grp.purchasePackageId = ''; grp.timecardServiceId = '' }
    else {
      grp.purchasePackageId = id
      grp.timecardServiceId = ''
      grp.timecardId = ''
      if (grp.mainId) { grp.mainId = ''; wx.showToast({ title: '本组切为现场购卡,已清除主项目', icon: 'none' }) }
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

    this.renderAll(); this.refresh()
  },


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
    this.setData({groups,people:MemberPricingInput.people(groups)})
  },
  gServedName(e) {
    const groups = this.data.groups.slice()

    groups[e.currentTarget.dataset.g].servedPersonName = String(e.detail.value || '')
    this.setData({ groups })
    this.renderAll(); this.refresh()
  },

  addGroup() {
    const groups = this.data.groups.map((g) => Object.assign({}, g, { collapsed: true }))
    const proto = this.data.groups[0]
    groups.push(newGroup(proto.tierDefault, (this.data.cats[0] || {}).id))
    this.setData({ groups })
    this.renderAll(); this.refresh()
  },

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
    this.renderAll()
  },


  setDeposit(e) { this.setData({ depositApplied: e.currentTarget.dataset.v === '1' }); this.refresh() },
  toggleFoot() { this.setData({ applyFootSurcharge: !this.data.applyFootSurcharge }); this.refresh() },
  toggleTipReuse() { this.setData({ applyTipReuse: !this.data.applyTipReuse }); this.refresh() },

  payToggleBalance() {
    const m = this.data.payMenu
    this.setData({ payMenu: { useBalance: !m.useBalance, recharge: m.useBalance ? false : m.recharge } })
    this.refresh()
  },
  payToggleDeposit() { this.setData({ depositApplied: !this.data.depositApplied }); this.refresh() },
  payToggleOffline() {

    const v = this.data.view
    if (v && v.hasOffline) { wx.showToast({ title: '还有差额要到店收;想不走线下就先充值抵扣', icon: 'none' }); return }
  },
  payToggleRecharge() {

    if (this.data.rvDraft) {
      this.setData({ rvDraft: null, payMenu: { useBalance: this.data.payMenu.useBalance, recharge: false } })
      this.refresh()
      return
    }
    this.openRecharge()
  },
  payIntentOf() {



    const m = this.data.payMenu
    if (!m.useBalance) return 'offline_full'
    return m.recharge ? 'recharge_then_balance' : 'balance_plus_offline'
  },





  async openRecharge() {
    if (!this.data.userId || !this.data.bind.bound) {
      wx.showToast({ title: '请先让顾客扫码绑定(会员码/签署码)再充值', icon: 'none', duration: 2500 })
      return
    }


    let pkgs = []
    try { pkgs = (await api.adminGet('/admin/recharge-packages')).packages || [] } catch (e) { /* 无套餐也能手输 */ }
    const cur = this.data.rvDraft
    this.setData({
      rvPanel: {
        amount: cur && !cur.packageId ? String(cur.amountCents / 100) : '',
        packageId: cur ? (cur.packageId || '') : '',
        pkgs,rateBps:cur?cur.rateBps:this.data.memberPricing.rateBps
      }
    })
  },
  closeRecharge() { this.setData({ rvPanel: null }) },
  rvPickPkg(e) {
    const id = e.currentTarget.dataset.id
    const p = this.data.rvPanel
    this.setData({ rvPanel: Object.assign({}, p, { packageId: p.packageId === id ? '' : id, amount: '',rateBps:MemberPricingInput.chosenRate(p.pkgs.find(x=>x.id===id),this.data.memberPricing) }) })
  },
  rvAmountInput(e) {
    const p = this.data.rvPanel
    this.setData({ rvPanel: Object.assign({}, p, { amount: e.detail.value, packageId: '' }) })
  },
  rvConfirm() {


    const p = this.data.rvPanel
    if (!p) return
    let draft = null
    if (p.packageId) {
      const pkg = p.pkgs.find((x) => x.id === p.packageId)
      if (!pkg) { wx.showToast({ title: '请重新选充值套餐', icon: 'none' }); return }
      draft = { packageId: pkg.id, label: pkg.label }
    } else {
      const payCents = Math.round(Number(String(p.amount || '').replace(/[^\d.]/g, '')) * 100)
      if (!Number.isFinite(payCents) || payCents <= 0) { wx.showToast({ title: '金额不对', icon: 'none' }); return }
      draft = { packageId: '', amountCents: payCents, label: '手输金额(无赠送)' }
    }


    if(this.data.pricingConfig?.active)draft.rateBps=p.rateBps
    this.setData({ rvDraft: draft, rvPanel: null, payMenu: { useBalance: this.data.payMenu.useBalance, recharge: true } })
    this.refresh()
  },
  rvRemove() {
    this.setData({ rvDraft: null, rvPanel: null, payMenu: { useBalance: this.data.payMenu.useBalance, recharge: false } })
    this.refresh()
  },


  openPersonCoupon(e){const key=e.currentTarget.dataset.person,doc=this.data.preview?.documents?.find(d=>d.beneficiaryKey===key);this.setData({couponPersonKey:key,couponOptions:doc?.couponOptions||[],personCouponSelected:this.data.personCoupons[key]||'',couponPanel:true})},
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
    if(this.data.pricingConfig?.giftEntitlementsEnabled)this.setData({personCoupons:{...this.data.personCoupons,[this.data.couponPersonKey]:id},personCouponSelected:id,couponPanel:false});else this.setData({ couponGrantId: id, couponPanel: false })
    this.refresh()
  },


}
definition.makeGroup=newGroup
Object.assign(definition,require('./preview-signing'),require('./member-pricing'))
Page(definition)
