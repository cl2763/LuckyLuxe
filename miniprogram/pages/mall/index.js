/* 批③次段 B 组:顾客端**充值/买卡商城**。商品=商家端勾了「上架商城」的套餐;
   §十-2 支付过渡红线:未接通=「到店购买」,点了只同屏出一句话说明,**不跳转/不弹层/不建单**,也不出现任何「已付款」类字样;
   句子全后端唯一(buyButtonText/offlineNote),前端不 if/else 拼两套话。 */
const api = require('../../utils/api')

Page({
  data: { loading: true, mall: null, error: '', noteFor: '', filter: 'all' },

  /* 裁定②:卡包次卡区的「去商城」带 ?focus=timecard —— 进来直接落在次卡筛选上
     (同一个商城页,不新建页;筛选条与分区都由后端给) */
  onLoad(q) { if (q && q.focus === 'timecard') this.setData({ filter: 'timecard' }) },
  onShow() { this.load() },

  async load() {
    try {
      const r = await api.getMall()
      this.setData({ loading: false, mall: r, error: '' })
    } catch (e) {
      this.setData({ loading: false, mall: null, error: (e && e.message) || '商城加载失败' })
    }
  },

  pickFilter(e) { this.setData({ filter: e.currentTarget.dataset.k || 'all' }) },
  // B3-2:同屏展开说明(不弹原生弹窗,四之七);再点收起
  tapBuy(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ noteFor: this.data.noteFor === id ? '' : id })
  }
})
