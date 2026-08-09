/* 屏 5a/5b 员工端「我的业绩」+ P2.5 屏 V3(hero 目标进度条)
   两道裁剪都在后端做,本页照单渲染,不自己判断该不该显示分项:
   - display_mode=total_only 时后端不下发卡耗等字段 → 整页(含每日流水)自然没有分项
   - 可见性三态由后端裁,salary_only 时 hero 为 null
   金额红线:一处运算都没有。「还差 X 达标」也是后端算好的 gapCents。 */
const api = require('../../../utils/api')
const { formatMoney, displayOf } = require('../../../utils/money')

Page({
  data: {
    loading: true, title: '我的业绩', tab: 'daily',
    tabs: [{ k: 'daily', t: '每日流水' }, { k: 'monthly', t: '月度' }, { k: 'yearly', t: '年度' }],
    v: null, note: ''
  },

  onLoad(q) {
    // 老板从「员工管理 → 业绩目标」点技师行进来时带 technicianId
    this.techId = (q && q.technicianId) || ''
    if (q && q.name) this.setData({ title: `${decodeURIComponent(q.name)} · 业绩` })
  },
  onShow() { if (!api.guardMerchant()) return; this.load() },
  switchTab(e) { this.setData({ tab: e.currentTarget.dataset.k }) },

  async load() {
    this.setData({ loading: true })
    try {
      const qs = this.techId ? `?technicianId=${encodeURIComponent(this.techId)}` : ''
      const r = await api.adminGet(`/admin/my-performance${qs}`)
      const p = r.performance
      const d = displayOf(p)
      const m = (c) => formatMoney(c, d, d.trimZeroDecimals ? 0 : 2)
      if (!p.hero) {
        this.setData({ loading: false, v: null, note: p.note || '本店未开放业绩明细。' })
        return
      }
      const maxTrend = Math.max(1, ...(p.trend || []).map((t) => t.perfCents))
      this.setData({
        loading: false,
        note: '',
        v: {
          month: p.month,
          perf: m(p.hero.perfCents),
          orderCount: p.hero.orderCount,
          daysLeft: p.hero.daysLeft,
          hasTarget: p.hero.hasTarget,
          pct: p.hero.hasTarget ? Math.min(100, p.hero.pct) : 0,
          pctText: p.hero.hasTarget ? `本月目标进度 ${p.hero.pct}%` : '',
          gapText: p.hero.hasTarget ? (p.hero.hitTarget ? '已达标' : `还差 ${m(p.hero.gapCents)} 达标`) : '',
          // 含分项时后端才给这几个字段;仅总进度时它们是 undefined,模板里自然不渲染
          hasSplit: p.hero.cardUsedCents !== undefined,
          cardUsed: p.hero.cardUsedCents !== undefined ? m(p.hero.cardUsedCents) : '',
          cardTarget: p.hero.cardTargetCents !== undefined ? m(p.hero.cardTargetCents) : '',
          orderTarget: p.hero.orderTarget,
          daily: (p.daily || []).map((x) => ({
            date: x.date.slice(5),
            pending: x.pending,
            orders: x.pending ? '待店长日结' : `${x.orderCount} 单`,
            perf: x.pending ? '—' : m(x.perfCents),
            card: x.cardUsedCents !== undefined ? m(x.cardUsedCents) : ''
          })),
          monthly: (p.monthly || []).map((x) => ({ key: x.month, orders: `${x.orderCount} 单`, perf: m(x.perfCents) })),
          yearly: (p.yearly || []).map((x) => ({ key: `${x.year} 年`, orders: `${x.orderCount} 单`, perf: m(x.perfCents) })),
          trend: (p.trend || []).map((t) => ({
            label: t.month.slice(5),
            h: Math.round(t.perfCents / maxTrend * 100),
            cur: t.isCurrent,
            perf: m(t.perfCents)
          }))
        }
      })
    } catch (e) {
      this.setData({ loading: false, note: (e && e.message) || '加载失败' })
    }
  }
})
