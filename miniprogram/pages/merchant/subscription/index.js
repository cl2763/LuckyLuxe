// 2026-08-03 套餐与续费:档位与定价**以 Youji Pricing 定价页为唯一口径**(免费版/单店版/工作室版/连锁版/定制版),
// 当前档位高亮,其他档位可「申请变更」(走 plan_change_requests,平台后台处理);续费按当前档位定价。
// 续费提醒 v1=申请+提醒;正式环境只记录平台核对的线下收款;沙盘 WXPAY_MOCK=1 可模拟。
const api = require('../../../utils/api')

function money(c) { return '¥' + Math.round((c || 0) / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') }
function fmtDate(s) { return s ? String(s).slice(0, 10) : '' }

const STATUS_TEXT = {
  active: { tag: '使用中', cls: 'ok' },
  expiring: { tag: '即将到期', cls: 'warn' },
  grace: { tag: '宽限期', cls: 'warn' },
  suspended: { tag: '已停用', cls: 'warn' },
  unlimited: { tag: '长期授权', cls: 'ok' }
}

Page({
  data: {
    loading: true,
    planName: '',
    statusTag: '',
    statusCls: 'ok',
    status: 'active',
    expiresAt: '',
    daysLeft: null,
    barPct: 100,
    autoRenew: false,
    tiers: [],
    noPrice: false,
    canRenew: true,
    period: 'year',
    payText: '',
    mockPay: false,
    orders: [],
    alertText: '',
    pendingReq: '',
    ai: { includedInPlan: false, trialAvailable: false, badge: '', badgeCls: 'off', expText: '', monthY: 99, yearY: 990 }
  },

  async onShow() {
    if (!(await api.guardOwner())) return
    this.load()
  },

  async load() {
    try {
      const d = await api.adminGet('/admin/subscription')
      this._prices = d.prices
      const st = STATUS_TEXT[d.status] || STATUS_TEXT.active
      let alertText = ''
      if (d.status === 'expiring') alertText = `套餐还有 ${d.daysLeft} 天到期,续费后到期日顺延,不浪费一天`
      if (d.status === 'grace') alertText = '套餐已到期,处于宽限期;请核对授权状态'
      if (d.status === 'suspended') alertText = '套餐已停用，请核对授权状态'
      const req = d.latestPlanRequest
      const pendingReq = req && req.status === 'PENDING'
        ? `已提交${req.requestType === 'renew' ? '续费' : '档位变更'}申请(${fmtDate(req.createdAt)}),平台会尽快联系你`
        : ''
      const noPrice = !d.prices || !d.prices.yearCents // 定制版(面议)与免费版都不走自助续费
      this.setData({
        loading: false,
        planName: d.planName || '',
        status: d.status,
        statusTag: st.tag,
        statusCls: st.cls,
        expiresAt: fmtDate(d.expiresAt),
        daysLeft: d.daysLeft,
        barPct: d.daysLeft == null ? 100 : Math.max(2, Math.min(100, Math.round((d.daysLeft / 365) * 100))),
        autoRenew: !!d.autoRenew,
        tiers: (d.tiers || []).map((t) => ({
          id: t.id,
          name: t.name,
          fit: t.fit,
          note: t.note || '',
          current: t.current,
          priceText: t.yearCents ? `${money(t.yearCents)}/年` : (t.monthCents === 0 ? '¥0' : '面议'),
          subText: t.yearCents ? `或 ${money(t.monthCents)}/月` : ''
        })),
        noPrice,
        canRenew: !noPrice && d.status !== 'unlimited',
        payText: d.prices ? money(this.data.period === 'month' ? d.prices.monthCents : d.prices.yearCents) : '',
        mockPay: !!d.mockPay,
        alertText,
        pendingReq,
        ai: this.buildAi(d.aiAddon),
        orders: (d.orders || []).map((o) => ({
          id: o.id,
          title: `${o.plan === 'ai_addon' ? 'AI 智能包' : ''}${o.period === 'month' ? '月付' : '年付'}${o.plan === 'ai_addon' ? '' : '续费'}`,
          date: fmtDate(o.paidAt || o.createdAt),
          amount: money(o.amountCents),
          statusText: o.status === 'paid' ? '已入账' : '待核对',
          pending: o.status !== 'paid'
        }))
      })
    } catch (err) {
      this.setData({ loading: false })
      wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' })
    }
  },

  // AI 智能包状态文案:套餐自带 / 试用中 / 已订阅 / 待开通(申请已提交) / 未开通
  buildAi(a) {
    const d = a || {}
    const exp = d.expiresAt ? fmtDate(d.expiresAt) : ''
    let badge = '未开通'
    let badgeCls = 'off'
    let expText = ''
    if (d.includedInPlan) { badge = '套餐已含'; badgeCls = 'on'; expText = '当前套餐已包含 AI,无需单独订阅' }
    else if (d.enabled && d.unlimited) { badge = '长期开通'; badgeCls = 'on'; expText = 'AI 智能包长期有效,无到期时间' }
    else if (d.enabled && d.source === 'trial') { badge = '试用中'; badgeCls = 'trial'; expText = `免费试用至 ${exp},到期后可续订` }
    else if (d.enabled) { badge = '已订阅'; badgeCls = 'on'; expText = `AI 有效期至 ${exp}` }
    // 试用为申请制:提交后等平台按门店情况配置好话术与知识库再开通
    else if (d.trialPending) { badge = '待开通'; badgeCls = 'trial'; expText = `试用申请已提交(${fmtDate(d.trialPendingAt)}),我们会联系你确认门店信息后开通` }
    else if (exp) { expText = `已于 ${exp} 到期,续订后立即恢复` }
    return {
      includedInPlan: !!d.includedInPlan,
      trialAvailable: !!d.trialAvailable,
      trialPending: !!d.trialPending,
      badge,
      badgeCls,
      expText,
      monthY: Math.round((d.monthCents || 9900) / 100),
      yearY: Math.round((d.yearCents || 99000) / 100)
    }
  },

  // 申请免费试用:不即时开通,生成申请落到平台后台,由我们联系商家配置后发放
})
