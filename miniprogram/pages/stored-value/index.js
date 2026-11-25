const api = require('../../utils/api')
const { curOf, ensureCurrencyCached, refreshStoreCurrency, money, moneyFromYuan } = require('../../utils/storecurrency')
/* 🔴 N-5(店主 08-25):类型文案改**后端下发**(txn.typeText)。
原来这儿存着一份本地词典 —— 后端加一个类型(比如退卡 refund),这边不跟,
顾客那一行就是空白。同一事实两处两份,迟早分叉。 */
/* B5 走查抓出:cash/card/alipay 漏映射=顾客回执卡上裸英文;marketing=赠送行渠道 */
const CH_LABEL = { manual: '门店补录', wechat: '微信支付', stored_value: '门店核销', cash: '现金', card: '银行卡', alipay: '支付宝', marketing: '营销赠送', unknown: '' }
const receipt=r=>r&&({...r,principalText:r.principalCents==null?'未记录':money(r.principalCents,2),bonusText:r.bonusCents==null?'关联未记录':money(r.bonusCents,2)})
Page({
data: { balance: 0, balanceText: '', level: '', packages: [], txns: [], pendingConfirm: [], loading: true, isDemo: false },
async onShow() {
await refreshStoreCurrency().catch(() => ensureCurrencyCached())
this.setData({ cur: curOf() })   // 币种跟门店走,不写死币符
await api.refreshMember()
const m = wx.getStorageSync('lucky_member') || {}
const packages = [
{ id: 1, name: '充 1000 送 50', sub: `到账 ${moneyFromYuan(1050)}` },
{ id: 2, name: '充 3000 送 300', sub: `到账 ${moneyFromYuan(3300)} · 最划算` }
]
let txns = []
let pendingConfirm = []
try {
const r = await api.getMyStoredValue()
txns = (r.txns || []).map((t, i) => ({
id: t.id || i, discountReceipt:receipt(t.discountReceipt),
title: (t.typeText || t.type) + (t.note && t.note !== '演示储值' ? ' · ' + t.note : ''),
date: t.discountReceipt?.createdText || String(t.createdAt || '').slice(0, 10) + (CH_LABEL[t.payChannel] ? ' · ' + CH_LABEL[t.payChannel] : ''),
delta: (t.amountCents >= 0 ? '+' : '-') + money(Math.abs(t.amountCents)),
up: t.amountCents >= 0,
giftItems: (t.giftItems || []).map((g) => ({ ...g, unitValueText: g.unitValueCents==null?'':money(g.unitValueCents, 2) })),
needsConfirm: Boolean(t.needsConfirm)
}))
/* B3-3/4 代充回执:门店代充的到账回执(金额/渠道/时间戳,余额=顶部大数)。
确认只是「我看到了」——不确认不影响余额与消费。 */
pendingConfirm = (r.pendingConfirm || []).map((t) => ({
discountReceipt:receipt(t.discountReceipt), id: t.id,
amount: money(t.amountCents),
channel: CH_LABEL[t.payChannel] ?? t.payChannel ?? '门店',
at: t.discountReceipt?.createdText || String(t.createdAt || '').slice(0, 16).replace('T', ' '),
giftItems: (t.giftItems || []).map((g) => ({ ...g, unitValueText: g.unitValueCents==null?'':money(g.unitValueCents, 2) })),
note: t.note || ''
}))
this.setData({ balance: (r.balanceCents || 0) / 100, balanceText: money(r.balanceCents || 0, 2) })
} catch (e) { this.setData({ balance: m.balance || 0, balanceText: moneyFromYuan(m.balance || 0, 2) }) }
/* 03u:样例块只在演示店出 —— 标志来自公开 /stores 的 isDemo(判据落在 tenants.kind) */
const isDemo = wx.getStorageSync('lucky_store_demo') === true
this.setData({ level: m.memberLevel || '', packages, txns, pendingConfirm, loading: false, isDemo })
},
async confirmRecharge(e) {
const id = e.currentTarget.dataset.id
if (!id) return
try {
await api.confirmStoredRecharge(id)
wx.showToast({ title: '已确认核对', icon: 'none' })
this.setData({
pendingConfirm: this.data.pendingConfirm.filter((p) => p.id !== id),
txns: this.data.txns.map((t) => (t.id === id ? Object.assign({}, t, { needsConfirm: false }) : t))
})
} catch (err) {
wx.showToast({ title: (err && err.message) || '确认失败,请稍后再试', icon: 'none' })
}
},
contactStore(){require('../../utils/nav').to('/pages/store-location/index')},
goMall() { require('../../utils/nav').to('/pages/mall/index') }
})
