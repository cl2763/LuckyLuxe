/* 批③次段 A 组(店主 08-23 开工令):顾客端**卡包**——三类聚合(次卡/券/储值)。
   句子与判定全后端(GET /my/card-pack 唯一出口:券门槛走 couponSubtitle、来源走 sourceLabelOf、
   角标数与页内张数同源);本页零计算、零拼话、零金额运算。 */
const api = require('../../utils/api')
const nav = require('../../utils/nav')

Page({
  data: { loading: true, pack: null, error: '' },

  onShow() { this.load() },

  async load() {
    if (!api.isLoggedIn()) { this.setData({ loading: false, pack: null, error: '登录后查看卡包' }); return }
    try {
      const r = await api.getCardPack()
      this.setData({ loading: false, pack: r.cardPack, error: '' })
    } catch (e) {
      // D17:接口失败绝不回 mock,如实报错
      this.setData({ loading: false, pack: null, error: (e && e.message) || '卡包加载失败' })
    }
  },

  // 裁定①(店主 08-23):卡包=券+次卡两类,储值不进卡包(黑卡已直达+自有页,重复即乱)
  goMall() { nav.to('/pages/mall/index') },
  // 裁定②:次卡区「去商城」=统一商城并定位次卡分区(筛选参数,不新建页)
  goMallTimecards() { nav.to('/pages/mall/index?focus=timecard') },
  // 展开某张卡券的使用说明(A2-8:只看不核销,核销只在开单结算)
  toggleCard(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [`open.${key}`]: !((this.data.open || {})[key]) })
  }
})
