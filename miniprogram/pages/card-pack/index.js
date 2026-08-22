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

  // 储值行 → 现有储值页(假设④:不新造储值明细页)
  goStored() { nav.to('/pages/stored-value/index') },
  // 空态/储值行的「去充值」→ 商城(B1-1:储值卡页=充值套餐唯一出口,这里与储值页同一落点)
  goMall() { nav.to('/pages/mall/index') },
  // 展开某张卡券的使用说明(A2-8:只看不核销,核销只在开单结算)
  toggleCard(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [`open.${key}`]: !((this.data.open || {})[key]) })
  }
})
