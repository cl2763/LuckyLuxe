const api = require('../../../utils/api')

const ROUTES = {
  schedule: '/pages/merchant/schedule/index',
  finance: '/pages/merchant/finance/index',
  customers: '/pages/merchant/customers/index',
  staff: '/pages/merchant/staff/index',
  services: '/pages/merchant/services/index',
  me: '/pages/merchant/me/index',
  marketing: '/pages/merchant/marketing/index',
  member: '/pages/merchant/member/index',
  analytics: '/pages/merchant/analytics/index',
  store: '/pages/merchant/store/index',
  myperf: '/pages/merchant/my-performance/index'
}

const E = {
  schedule: { k: 'schedule', icon: 'm-schedule', t: '排班', d: '周网格 · 申请审批' },
  scheduleView: { k: 'schedule', icon: 'm-schedule', t: '排班', d: '查看本周班表' },
  finance: { k: 'finance', icon: 'm-finance', t: '财务', d: '指标 · 记一笔 · 储值(需密码)' },
  customers: { k: 'customers', icon: 'm-customers', t: '客户库', d: '档案 · 标签 · 分层' },
  marketing: { k: 'marketing', icon: 'm-marketing', t: '营销管理', d: '渠道发帖 · 营销措施' },
  member: { k: 'member', icon: 'm-member', t: '会员套餐 / 充值 / 券', d: '充值套餐 · 次卡 · 优惠券' },
  analytics: { k: 'analytics', icon: 'm-analytics', t: '经营分析', d: '询价转化 · 复购 · 客单价' },
  services: { k: 'services', icon: 'm-services', t: '服务与价格', d: '服务项目 · 定金' },
  store: { k: 'store', icon: 'm-store', t: '门店信息 / 营业时间', d: '地址 · 电话 · 特殊日期 · 预约规则' },
  staff: { k: 'staff', icon: 'm-staff', t: '员工管理', d: '新增/生成账号 · 业绩' },
  me: { k: 'me', icon: 'm-settings', t: '我的 / 账号', d: '改密 · 语言 · 财务密码' },
  myperf: { k: 'myperf', icon: 'm-analytics', t: '我的业绩', d: '本月营收 · 底薪 · 提成估算' }
}

Page({
  data: { name: '员工', isOwner: true, groups: [] },

  onShow() { this.loadMe() },

  async loadMe() {
    let owner = true
    let name = '老板'
    try {
      const m = await api.adminMe()
      owner = m && m.role === 'owner'
      name = owner ? 'Chang' : ((m && m.displayName) || '员工')
    } catch (e) { owner = api.isOwner() }
    const groups = owner ? [
      { title: '日常经营', rows: [E.schedule, E.finance, E.customers] },
      { title: '营销与会员', rows: [E.marketing, E.member, E.analytics] },
      { title: '店铺设置', rows: [E.services, E.store, E.staff, E.me] }
    ] : [
      { title: '日常', rows: [E.scheduleView, E.myperf] },
      { title: '账号', rows: [E.me] }
    ]
    this.setData({ isOwner: owner, name, groups })
  },

  go(e) {
    const k = e.currentTarget.dataset.k
    if (ROUTES[k]) wx.navigateTo({ url: ROUTES[k] })
    else wx.showToast({ title: '该模块开发中', icon: 'none' })
  }
})
