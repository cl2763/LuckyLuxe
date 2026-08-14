/* S1+S3(图=合同 v1.2 §四):管理宫格「服务与目录」= 网页「服务与价目」的同源镜像屏。
   页签① 上架服务:与网页模块①同源同序;上下架开关手机可直接拨(店主 08-14 拍板:轻量级配置,
   同一后端字段 storefront,双端实时一致)。页签② 结算单目录:项目/价档/加项全量可见,只读。
   新增/编辑/改价一律去网页端(金额红线,合同规则④);数据单源 /admin/pricing/items(员工可读口)。 */
const api = require('../../../utils/api')
const { storeMoney } = require('../../../utils/storeclock')

Page({
  data: { tab: 'storefront', loading: true, isOwner: true, shelf: [], mains: [], addons: [], hasTimecards: false },

  async onShow() {
    if (!api.guardMerchant()) return
    this.setData({ isOwner: api.isOwner() })
    this.load()
  },

  async load() {
    try {
      const r = await api.adminGet('/admin/pricing/items')
      const items = r.items || []
      const mainsRaw = items.filter((i) => i.itemKind === 'main' && !i.isTimecard)
      // 页签①:上架服务(开关=storefront,展示价=最低可用价档+「起」,后端算好下发)
      // 目录已停用(isActive=false)不进页签①(与网页模块①同口径,双端同病检查律);页签②全量可见
      const shelf = mainsRaw.filter((i) => i.isActive !== false).map((i) => ({
        id: i.id,
        name: i.nameZh,
        on: !!i.storefront,
        sub: `${storeMoney(i.startingPriceCents || i.listPriceCents || 0)} 起${i.baseDurationMin ? ' · ' + i.baseDurationMin + ' 分钟' : ''}`
      }))
      // 页签②:项目与价档 chips(只列挂了的档;没挂的开单时根本不出现,规则②)
      const chip = (label, cents, suffix) => (cents ? `${label} ${storeMoney(cents)}${suffix || ''}` : null)
      const mains = mainsRaw.map((i) => ({
        id: i.id,
        name: i.nameZh,
        chips: [
          chip('普通', i.listPriceCents),
          chip('分享', i.sharePriceCents),
          chip('会员', i.memberPriceCents),
          chip('疗程', i.coursePriceCents, i.courseTimes ? `/${i.courseTimes}次` : '/次')
        ].filter(Boolean)
      }))
      const addons = items.filter((i) => i.itemKind === 'addon').map((i) => ({
        id: i.id,
        label: `${i.nameZh} ${storeMoney(i.listPriceCents || 0)}`
      }))
      this.setData({ shelf, mains, addons, hasTimecards: items.some((i) => i.isTimecard), loading: false })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  switchTab(e) { this.setData({ tab: e.currentTarget.dataset.tab }) },

  async toggle(e) {
    // 开关双端同源(闭环③):同一 storefront 字段,拨完网页端立刻见。员工无开关(只读镜像)。
    const { id, on } = e.currentTarget.dataset
    const next = !on
    try {
      await api.adminPatch(`/admin/pricing/items/${encodeURIComponent(id)}`, { storefront: next })
      wx.showToast({ title: next ? '已上架,顾客端立即可见' : '已下架', icon: 'none' })
      this.load()
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' })
      this.load() // 失败回读服务端真值,开关不许停在假状态
    }
  },

  goMembership() { wx.navigateTo({ url: '/pages/merchant/member/index', fail: (e) => console.warn('[nav] member fail', e) }) }
})
