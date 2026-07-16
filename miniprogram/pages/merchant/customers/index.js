const api = require('../../../utils/api')
const TIER = { Silver: '银卡', Gold: '金卡', Platinum: '铂金', Diamond: '钻石' }
const HIGH = { Gold: 1, Platinum: 1, Diamond: 1 }

function money(c) { const n = Math.round((c || 0) / 100); return '$' + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') }
function daysSince(iso) { if (!iso) return 9999; return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) }
function lastText(iso) {
  if (!iso) return '—'
  const d = daysSince(iso)
  if (d <= 0) return '今天'
  if (d < 365) return `${d}天前`
  return iso.slice(0, 10)
}

function vm(u) {
  const ds = daysSince(u.lastVisitAt)
  return {
    id: u.id,
    name: u.displayName || '顾客',
    av: (u.displayName || '?').slice(0, 1),
    tier: TIER[u.memberTier] || u.memberTier || '会员',
    high: !!HIGH[u.memberTier],
    visits: u.visitCount || 0,
    last: lastText(u.lastVisitAt),
    spend: money(u.totalSpentCents),
    stored: money(u.storedValueBalanceCents),
    spendCents: u.totalSpentCents || 0,
    storedCents: u.storedValueBalanceCents || 0,
    lastAt: u.lastVisitAt || '',
    dormant: ds >= 30,
    newbie: (u.visitCount || 0) <= 1,
    tags: (u.tags || []).slice(0, 3)
  }
}

Page({
  data: {
    all: [], list: [], kw: '', filter: 'all', sort: 'spend',
    filters: ['all', 'high', 'stored', 'dormant', 'new'],
    filterLabels: { all: '全部', high: '高价值', stored: '有储值', dormant: '沉睡', new: '新客' },
    sorts: ['spend', 'last', 'stored'],
    sortLabels: { spend: '累计消费', last: '最近到店', stored: '储值余额' },
    counts: { high: 0, dormant: 0, new: 0 }
  },

  async onShow() { if (!(await api.guardOwner())) return; this.load() },

  async load() {
    try {
      const r = await api.adminGet('/admin/customers')
      const all = (r.customers || r.data || r || []).map(vm)
      this.setData({
        all,
        counts: {
          high: all.filter((x) => x.high).length,
          dormant: all.filter((x) => x.dormant).length,
          new: all.filter((x) => x.newbie).length
        }
      })
      this.apply()
    } catch (e) { wx.showToast({ title: '加载客户失败', icon: 'none' }) }
  },

  apply() {
    const { all, kw, filter, sort } = this.data
    let list = all.slice()
    const k = (kw || '').trim()
    if (k) list = list.filter((x) => x.name.indexOf(k) >= 0)
    if (filter === 'high') list = list.filter((x) => x.high)
    else if (filter === 'stored') list = list.filter((x) => x.storedCents > 0)
    else if (filter === 'dormant') list = list.filter((x) => x.dormant)
    else if (filter === 'new') list = list.filter((x) => x.newbie)
    if (sort === 'spend') list.sort((a, b) => b.spendCents - a.spendCents)
    else if (sort === 'stored') list.sort((a, b) => b.storedCents - a.storedCents)
    else if (sort === 'last') list.sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || ''))
    this.setData({ list })
  },

  onKw(e) { this.setData({ kw: e.detail.value }, () => this.apply()) },
  setFilter(e) { this.setData({ filter: e.currentTarget.dataset.f }, () => this.apply()) },
  setSort(e) { this.setData({ sort: e.currentTarget.dataset.s }, () => this.apply()) },
  open(e) { wx.navigateTo({ url: `/pages/merchant/customer/index?id=${encodeURIComponent(e.currentTarget.dataset.id)}` }) }
})
