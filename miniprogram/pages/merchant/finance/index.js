const api = require('../../../utils/api')

function money(c) {
  const n = Math.round((c || 0) / 100)
  return '$' + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

Page({
  data: {
    unlocked: false,
    configured: true,
    pwd: '',
    pwd2: '',
    setting: false,
    m: { today: '$0', revenue: '$0', net: '$0', netRate: 0 },
    target: { has: false, pct: 0, targetRevenue: '$0' },
    sv: { total: '$0', recharge: '$0', consume: '$0', dormant: '' },
    insight: ''
  },

  async onShow() { if (!(await api.guardOwner())) return; this.init() },

  async init() {
    if (api.getFinanceKey()) { this.setData({ unlocked: true }); this.loadData(); return }
    try {
      const s = await api.adminGet('/admin/finance/lock-status')
      this.setData({ configured: !!s.configured })
    } catch (e) { /* 忽略 */ }
  },

  onPwd(e) { this.setData({ pwd: e.detail.value }) },
  onPwd2(e) { this.setData({ pwd2: e.detail.value }) },

  async unlock() {
    if (this.data.setting) return
    const pw = this.data.pwd
    if (!pw) { wx.showToast({ title: '请输入财务密码', icon: 'none' }); return }
    if (!this.data.configured && pw !== this.data.pwd2) { wx.showToast({ title: '两次密码不一致', icon: 'none' }); return }
    if (!this.data.configured && pw.length < 4) { wx.showToast({ title: '财务密码至少 4 位', icon: 'none' }); return }
    this.setData({ setting: true })
    try {
      await api.financeUnlock(pw, this.data.configured ? undefined : this.data.pwd2)
      this.setData({ unlocked: true, pwd: '', pwd2: '' })
      this.loadData()
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '解锁失败', icon: 'none' })
    } finally {
      this.setData({ setting: false })
    }
  },

  async loadData() {
    try {
      const [p, sv] = await Promise.all([
        api.adminGet('/admin/finance/progress'),
        api.adminGet('/admin/stored-value')
      ])
      const pr = p.progress || {}
      const rev = pr.revenueCents || 0
      const net = pr.netCents || 0
      const tRev = pr.monthRevenueTargetCents || 0
      const targetSet = (pr.targets && pr.targets.monthTargetCents > 0) || tRev > 0
      this.setData({
        m: { today: money(pr.todayRevenueCents), revenue: money(rev), net: money(net), netRate: rev ? Math.round((net / rev) * 100) : 0 },
        target: { has: targetSet, pct: tRev ? Math.min(100, Math.round((rev / tRev) * 100)) : 0, targetRevenue: money(tRev) }
      })
      const s = sv.storedValue || {}
      const accts = (s.accounts || []).slice().sort((a, b) => (b.dormantDays || 0) - (a.dormantDays || 0))
      const d = accts[0]
      this.setData({
        sv: {
          total: money(s.totalBalanceCents),
          recharge: money(s.monthRechargeCents),
          consume: money(s.monthConsumeCents),
          dormant: d ? `${d.displayName} ${money(d.balanceCents)}(${d.dormantDays || 0}天未动)` : ''
        }
      })
    } catch (err) {
      if (err && err.code === 'FINANCE_LOCKED') {
        api.clearFinanceKey()
        this.setData({ unlocked: false })
        wx.showToast({ title: '财务会话已过期,请重新解锁', icon: 'none' })
      }
    }
  },

  async aiInsight() {
    wx.showLoading({ title: 'AI 解读中' })
    try {
      const r = await api.adminPost('/admin/finance/insights', {})
      const ins = (r && r.insight) || r || {}
      const t = ins.text || ins.summaryZh || ins.textZh || (ins.data && (ins.data.summaryZh || ins.data.headlineZh)) || (typeof ins === 'string' ? ins : '') || '(暂无解读)'
      this.setData({ insight: t })
    } catch (err) {
      wx.showToast({ title: '解读失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  toWeb() { wx.showToast({ title: '记一笔/流水/目标设置请在网页后台', icon: 'none' }) },
  wakeSleep() { wx.navigateTo({ url: '/pages/merchant/marketing/index' }) }
})
