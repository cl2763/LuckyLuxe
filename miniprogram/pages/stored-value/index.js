const api = require('../../utils/api')
const { curOf, ensureCurrencyCached, money, moneyFromYuan } = require('../../utils/storecurrency')

const TYPE_LABEL = { recharge: '充值到账', consume: '耗卡', bonus: '充值赠送', reversal: '更正冲销', migrate_opening: '期初迁移' }
/* B5 走查抓出:cash/card/alipay 漏映射=顾客回执卡上裸英文;marketing=赠送行渠道 */
const CH_LABEL = { manual: '门店补录', wechat: '微信支付', stored_value: '门店核销', cash: '现金', card: '银行卡', alipay: '支付宝', marketing: '营销赠送', unknown: '' }

Page({
  data: { balance: 0, level: '', packages: [], txns: [], pendingConfirm: [], loading: true },

  async onShow() {
    ensureCurrencyCached()
    this.setData({ cur: curOf() })   // 币种跟门店走,不写死币符

    await api.refreshMember()
    const m = wx.getStorageSync('lucky_member') || {}
    // 余额与明细为真实数据;充值套餐改由商城页(/pages/mall)按商家上架配置下发
    // 币种红线:示例套餐的金额也不许写死 $ —— 那是顾客直接看到的钱
    const packages = [
      { id: 1, name: '充 1000 送 50', sub: `到账 ${moneyFromYuan(1050)}` },
      { id: 2, name: '充 3000 送 300', sub: `到账 ${moneyFromYuan(3300)} · 最划算` }
    ]
    let txns = []
    let pendingConfirm = []
    try {
      const r = await api.getMyStoredValue()
      txns = (r.txns || []).map((t, i) => ({
        id: t.id || i,
        title: (TYPE_LABEL[t.type] || t.type) + (t.note && t.note !== '演示储值' ? ' · ' + t.note : ''),
        date: String(t.createdAt || '').slice(0, 10) + (CH_LABEL[t.payChannel] ? ' · ' + CH_LABEL[t.payChannel] : ''),
        delta: (t.amountCents >= 0 ? '+' : '-') + money(Math.abs(t.amountCents)),
        up: t.amountCents >= 0,
        needsConfirm: Boolean(t.needsConfirm)
      }))
      /* B3-3/4 代充回执:门店代充的到账回执(金额/渠道/时间戳,余额=顶部大数)。
         确认只是「我看到了」——不确认不影响余额与消费。 */
      pendingConfirm = (r.pendingConfirm || []).map((t) => ({
        id: t.id,
        amount: money(t.amountCents),
        channel: CH_LABEL[t.payChannel] || t.payChannel || '门店',
        at: String(t.createdAt || '').slice(0, 16).replace('T', ' '),
        note: t.note || ''
      }))
      this.setData({ balance: Math.round((r.balanceCents || 0) / 100) })
    } catch (e) { this.setData({ balance: m.balance || 0 }) }
    this.setData({ level: m.memberLevel || '', packages, txns, pendingConfirm, loading: false })
  },

  // B3-4 确认回执:幂等口,成功后行内状态就地更新(不整页闪)
  async confirmRecharge(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    try {
      await api.confirmStoredRecharge(id)
      wx.showToast({ title: '已确认到账', icon: 'none' })
      this.setData({
        pendingConfirm: this.data.pendingConfirm.filter((p) => p.id !== id),
        txns: this.data.txns.map((t) => (t.id === id ? Object.assign({}, t, { needsConfirm: false }) : t))
      })
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '确认失败,请稍后再试', icon: 'none' })
    }
  },

  // B1-1:去商城看充值套餐/次卡(唯一出口;不再是「即将上线」的死胡同)
  goMall() { require('../../utils/nav').to('/pages/mall/index') }
})
