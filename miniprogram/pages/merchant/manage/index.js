const api = require('../../../utils/api')

const ROUTES = {
  schedule: '/pages/merchant/schedule-day/index',
  dailyClose: '/pages/merchant/daily-close/index',
  orders: '/pages/merchant/orders/index',
  finance: '/pages/merchant/finance/index',
  customers: '/pages/merchant/customers/index',
  staff: '/pages/merchant/staff/index',
  services: '/pages/merchant/services/index',
  me: '/pages/merchant/me/index',
  marketing: '/pages/merchant/marketing/index',
  member: '/pages/merchant/member/index',
  analytics: '/pages/merchant/analytics/index',
  store: '/pages/merchant/store/index',
  myperf: '/pages/merchant/my-performance/index',
  attendance: '/pages/merchant/attendance/index',
  salaryMonth: '/pages/merchant/salary-month/index',
  pointsMall: '/pages/merchant/points-mall/index'
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
  staff: { k: 'staff', icon: 'm-staff', t: '员工管理', d: '排班 · 业绩目标 · 薪资方案 · 账号' },
  me: { k: 'me', icon: 'm-settings', t: '我的 / 账号', d: '改密 · 语言 · 财务密码' },
  myperf: { k: 'myperf', icon: 'm-analytics', t: '我的业绩', d: '本月营收 · 底薪 · 提成估算' },
  attendance: { k: 'attendance', icon: 'm-staff', t: '考勤打卡', d: '在岗看板 · 修正补卡 · 打卡 WiFi' },
  attendanceStaff: { k: 'attendance', icon: 'm-staff', t: '打卡', d: '上下班打卡 · 本周工时' },
  // 日结不再是独立行 —— 设计图《管理页分组》把它写在「订单管理」副标题里,页面上它长在今日台面下方
  orders: { k: 'orders', icon: 'm-schedule', t: '订单管理', d: '今日台面 · 全部订单 · 日结' },
  salaryMonth: { k: 'salaryMonth', icon: 'm-finance', t: '工资试算', d: '全员月度工资明细 · 需财务密码' },
  pointsMall: { k: 'pointsMall', icon: 'm-member', t: '积分商城', d: '上架奖品 · 顾客用积分兑券' }
}

Page({
  data: { name: '员工', shopName: '', isOwner: true, groups: [] },

  onShow() { if (!api.guardMerchant()) return; this.loadMe() },

  async loadMe() {
    let owner = true
    let name = '老板'
    let shopName = ''
    try {
      const m = await api.adminMe()
      owner = m && m.role === 'owner'
      // 名字=账号自己设的显示名(原先硬编码 'Chang',别的商家登录会串);副标题=店铺名 · 角色
      name = (m && m.displayName ? String(m.displayName).replace(/\s*Owner$/i, '') : '') || (owner ? '老板' : '员工')
      shopName = `${(m && m.tenantName) || ''} · ${owner ? '老板' : '员工'}`
    } catch (e) { owner = api.isOwner() }
    const groups = owner ? [
      // 排班已移入「员工管理 → 排班」板块(P2③ 屏 4a);员工管理随之从「店铺设置」提到
      // 「日常经营」—— 排班是天天要用的,再让老板去设置里翻一层不合理
      { title: '日常经营', rows: [E.orders, E.staff, E.attendance, E.finance, E.salaryMonth, E.customers] },
      { title: '营销与会员', rows: [E.marketing, E.member, E.pointsMall, E.analytics] },
      { title: '店铺设置', rows: [E.services, E.store, E.me] }
    ] : [
      { title: '日常', rows: [E.attendanceStaff, E.scheduleView, E.myperf] },
      { title: '账号', rows: [E.me] }
    ]
    this.setData({ isOwner: owner, name, shopName, groups })
  },

  go(e) {
    const k = e.currentTarget.dataset.k
    if (ROUTES[k]) wx.navigateTo({ url: ROUTES[k] })
    else wx.showToast({ title: '该模块开发中', icon: 'none' })
  }
})
