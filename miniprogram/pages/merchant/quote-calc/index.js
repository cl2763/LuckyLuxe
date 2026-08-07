/* 屏 6｜技师端 · 报价试算器
   与结算同一个计价引擎(POST /admin/settlements/preview),报价口径 = 结算口径。
   试算不落库、不留痕:不传 bookingId / userId,后端只算不写。
   金额红线同屏 1:本页不做任何金额运算。 */
const api = require('../../../utils/api')
const { formatMoney, displayOf } = require('../../../utils/money')

const TIERS = [
  { key: 'list', label: '原价' },
  { key: 'share', label: '分享价' },
  { key: 'member', label: '会员价' }
]
const TIER_PRICE_FIELD = { list: 'listPriceCents', share: 'sharePriceCents', member: 'memberPriceCents' }
const DRAFT_KEY = 'lucky_quote_draft'

Page({
  data: {
    ready: false,
    convId: '', fromLabel: '', quoteId: '',
    tiers: TIERS, tierKey: 'list',
    cats: [], catId: '',
    items: [], addonGroups: [],
    picked: {},
    applyFootSurcharge: false,
    display: null, view: null, preview: null
  },

  onLoad(q) {
    this.setData({
      convId: decodeURIComponent((q && q.conv) || ''),
      fromLabel: decodeURIComponent((q && q.from) || ''),
      quoteId: decodeURIComponent((q && q.quoteId) || '')
    })
    this.boot()
  },

  async boot() {
    try {
      const [cats, items] = await Promise.all([
        api.adminGet('/admin/pricing/categories'),
        api.adminGet('/admin/pricing/items')
      ])
      this.allItems = (items.items || []).filter((i) => i.isActive !== false)
      const categories = (cats.categories || []).filter((c) => c.isBookable !== false)
      this.setData({
        ready: true,
        cats: categories.map((c) => ({ id: c.id, name: c.name })),
        catId: (categories[0] || {}).id || ''
      })
      this.renderCatalogue()
      this.refresh()
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载价目表失败', icon: 'none' })
    }
  },

  renderCatalogue() {
    const field = TIER_PRICE_FIELD[this.data.tierKey] || 'listPriceCents'
    const d = this.data.display
    const decorate = (it) => {
      const cents = it[field] === null || it[field] === undefined ? it.listPriceCents : it[field]
      return {
        id: it.id, name: it.nameZh,
        priceText: cents === 0 ? '免收' : formatMoney(cents, d, d && d.trimZeroDecimals ? 0 : 2),
        on: Object.prototype.hasOwnProperty.call(this.data.picked, it.id)
      }
    }
    const all = this.allItems || []
    const catName = {}
    ;(this.data.cats || []).forEach((c) => { catName[c.id] = c.name })
    const groupMap = {}
    all.filter((i) => i.itemKind === 'addon' && i.unit !== 'per_finger').forEach((i) => {
      const key = i.categoryId || 'other'
      ;(groupMap[key] = groupMap[key] || { title: catName[key] || '加项', items: [] }).items.push(decorate(i))
    })
    this.setData({
      items: all.filter((i) => (i.itemKind || 'main') === 'main' && (i.categoryId || '') === this.data.catId).map(decorate),
      addonGroups: Object.keys(groupMap).map((k) => groupMap[k])
    })
  },

  pickTier(e) { this.setData({ tierKey: e.currentTarget.dataset.k }); this.renderCatalogue(); this.refresh() },
  pickCat(e) { this.setData({ catId: e.currentTarget.dataset.id }); this.renderCatalogue() },
  toggleItem(e) {
    const id = e.currentTarget.dataset.id
    const picked = Object.assign({}, this.data.picked)
    if (Object.prototype.hasOwnProperty.call(picked, id)) delete picked[id]
    else picked[id] = 1
    this.setData({ picked })
    this.renderCatalogue()
    this.refresh()
  },
  toggleFoot() { this.setData({ applyFootSurcharge: !this.data.applyFootSurcharge }); this.refresh() },

  refresh() {
    clearTimeout(this._t)
    this._t = setTimeout(() => this.doPreview(), 250)
  },
  async doPreview() {
    const ids = Object.keys(this.data.picked)
    if (!ids.length) { this.setData({ view: null }); return }
    try {
      const r = await api.adminPost('/admin/settlements/preview', {
        tierKey: this.data.tierKey,
        items: ids.map((id) => ({ serviceId: id, qty: 1 })),
        applyFootSurcharge: this.data.applyFootSurcharge,
        depositApplied: false,
        payIntent: 'offline_full'
      })
      const s = r.settlement || {}
      const d = displayOf(s)
      const m = (cents) => formatMoney(cents, d, d.trimZeroDecimals ? 0 : 2)
      const prev = this.data.display
      this.setData({
        display: d,
        preview: s,
        view: {
          subtotal: m(s.subtotalCents),
          tierLabel: (TIERS.find((t) => t.key === this.data.tierKey) || {}).label || '',
          breakdown: (s.lines || []).map((l) => l.name).join(' + '),
          lines: (s.lines || []).map((l) => ({ name: l.name, amount: m(l.amountCents) }))
        }
      })
      if (!prev || prev.symbol !== d.symbol || prev.prefix !== d.prefix) this.renderCatalogue()
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '试算失败', icon: 'none' })
    }
  },

  quoteText() {
    const v = this.data.view
    if (!v) return ''
    return `您选的款式预估 ${v.subtotal}（含${v.breakdown}），最终以到店确认为准哦～`
  },
  copyText() {
    const text = this.quoteText()
    if (!text) { wx.showToast({ title: '先勾几个项目', icon: 'none' }); return }
    wx.setClipboardData({ data: text, success: () => wx.showToast({ title: '话术已复制', icon: 'none' }) })
  },
  /* 「填入报价单」做两件事,都不碰顾客:
     ① 把话术塞进会话输入框(发不发由技师自己按发送);
     ② 有报价单在手时调 mark-quoted 记一笔「本次已报价」——
        这个端点只写金额与留痕,不向顾客发任何消息(店主 2026-08-08 裁决)。 */
  async fillQuote() {
    const text = this.quoteText()
    if (!text) { wx.showToast({ title: '先勾几个项目', icon: 'none' }); return }
    wx.setStorageSync(DRAFT_KEY, text)
    let marked = false
    if (this.data.quoteId && this.data.preview) {
      try {
        await api.adminPost(`/admin/quote-requests/${encodeURIComponent(this.data.quoteId)}/mark-quoted`, {
          priceCents: this.data.preview.subtotalCents,
          note: text
        })
        marked = true
      } catch (e) { wx.showToast({ title: (e && e.message) || '记录报价失败,话术已填入', icon: 'none' }) }
    }
    wx.showToast({ title: marked ? '已记为已报价,话术已填入' : '已填入会话输入框', icon: 'none' })
    setTimeout(() => wx.navigateBack(), 800)
  }
})
