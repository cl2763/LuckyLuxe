const api = require('../../utils/api')

const TYPE_LABEL = { recharge: '充值到账', consume: '耗卡' }
const CH_LABEL = { manual: '门店补录', wechat: '微信支付', stored_value: '门店核销', unknown: '' }

Page({
  data: { balance: 0, level: '', packages: [], txns: [], loading: true },

  async onShow() {
    await api.refreshMember()
    const m = wx.getStorageSync('lucky_member') || {}
    // 充值套餐为示例(在线直充待微信支付);余额与明细为真实数据
    const packages = [
      { id: 1, name: '充 1000 送 50', sub: '到账 $1,050' },
      { id: 2, name: '充 3000 送 300', sub: '到账 $3,300 · 最划算' }
    ]
    let txns = []
    try {
      const r = await api.getMyStoredValue()
      txns = (r.txns || []).map((t, i) => ({
        id: i,
        title: (TYPE_LABEL[t.type] || t.type) + (t.note && t.note !== '演示储值' ? ' · ' + t.note : ''),
        date: String(t.createdAt || '').slice(0, 10) + (CH_LABEL[t.payChannel] ? ' · ' + CH_LABEL[t.payChannel] : ''),
        delta: (t.amountCents >= 0 ? '+$' : '-$') + Math.abs(t.amountCents / 100),
        up: t.amountCents >= 0
      }))
      this.setData({ balance: Math.round((r.balanceCents || 0) / 100) })
    } catch (e) { this.setData({ balance: m.balance || 0 }) }
    this.setData({ level: m.memberLevel || '', packages, txns, loading: false })
  },

  soon() { wx.showToast({ title: '在线充值即将上线(微信支付)', icon: 'none' }) }
})
