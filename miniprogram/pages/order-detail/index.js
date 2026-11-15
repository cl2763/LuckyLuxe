const storage = require('../../utils/storage')
const nav = require('../../utils/nav')
const { curOf, ensureCurrencyCached } = require('../../utils/storecurrency')
const i18n = require('../../utils/i18n')
const api = require('../../utils/api')

Page({
behaviors: [require('../../utils/media-privacy')],
onShow() {
ensureCurrencyCached()
this.setData({ cur: curOf() })   // 币种跟门店走,不写死币符

if (this._shownOnce && this._orderId) this.load(this._orderId)
this._shownOnce = true
},
data: {
mediaPrivacyCopy: '复制门店地址或地图链接前，请阅读并同意隐私保护指引。仅复制你选择的内容。',
viewer: { open: false, items: [], index: 0 },
order: null,
bottomInset: 0,
lang: 'zh',
t: i18n.pageCopy('orderDetail', 'zh')
},

onLoad(options) {
this._orderId = options.id
this.load(options.id)
},

async load(id) {
const lang = i18n.getLang()
const t = i18n.pageCopy('orderDetail', lang)
i18n.applyTabBar(lang)
i18n.setTitle(t.title)
if (!api.isLoggedIn()) {
this.setData({ order: null, lang, t })
return
}
let order = null
try {
const bookings = await api.getBookings(lang)
storage.setOrders(bookings)
order = bookings.find((item) => item._id === id || item.orderNo === id)
} catch (error) {

wx.showToast({ title: '订单更新失败，请稍后重试', icon: 'none' })
}
if (order) {
const service = order.service || (order.serviceInfo && { name: order.serviceInfo.serviceName, type: order.serviceInfo.serviceType, duration: order.serviceInfo.duration }) || {} // mock 清除
const localizedService = i18n.localizeService(service, lang)


order.statusText = lang === 'en' ? i18n.statusText(order.status, lang) : (order.statusText || i18n.statusText(order.status, lang))
order.serviceImage = service.image || order.serviceImage || ''   // 裁定二同族:空值交渲染层占位,不回落环境照
order.serviceInfo.serviceName = localizedService.name || order.serviceInfo.serviceName

order.visibleWorkImages = order.status === 'completed' || order.status === 'after_sales' ? (order.workImages || []).slice(0, 6) : []


if (order.payment) {




order.pay = {
code: order.payment.code,
signedAt: String(order.payment.signedAt || '').slice(0, 16).replace('T', ' '),
flowLines: (order.payment.flow && order.payment.flow.lines) || [],
heroLabel: (order.payment.flow && order.payment.flow.heroLabel) || '本单到店支付',
heroText: (order.payment.flow && order.payment.flow.cashDueText) || '',

sheetLinks: order.payment.sheetLinks || [],

sheets: (order.payment.sheets || []).map((sh, i) => ({
...sh,
idx: i,
flowLines: (sh.flow && sh.flow.lines) || [],
heroLabel: (sh.flow && sh.flow.heroLabel) || '本单到店支付',
heroText: (sh.flow && sh.flow.cashDueText) || '',
signedAtText: sh.signedAt ? String(sh.signedAt).slice(0, 16).replace('T', ' ') : '',

snapUrl: sh.snapshotUrl ? `${api.API_BASE}${sh.snapshotUrl}` : ''
})),
groupCashLabel: order.payment.groupCashLabel || '',
groupCashText: order.payment.groupCashDueText || ''
}
}







const ACTION_EN = { cancel: 'Cancel booking', openAfterSales: 'Request after-sales' }
order.actions = (order.customerActions || []).map((a) => ({
key: a.key,
label: lang === 'en' ? (ACTION_EN[a.key] || a.label) : a.label
}))
order.servicePrice = order.servicePrice != null && order.servicePrice !== '' ? order.servicePrice : null
order.payableAmount = order.payableAmount != null && order.payableAmount !== '' ? order.payableAmount : null
order.finalDue = order.finalDue != null && order.finalDue !== '' ? order.finalDue : null
}
this.setData({ order, lang, t, bottomInset: 0 }, () => this.measureBottomBar())
},
onResize() { this.measureBottomBar() },
measureBottomBar() {
if (!this.data.order?.actions?.length) { this.setData({ bottomInset: 0 }); return }
if (typeof wx.createSelectorQuery !== 'function') return

wx.createSelectorQuery().in(this).select('.bottom-bar').boundingClientRect((rect) => {
if (rect && this.data.order?.actions?.length) this.setData({ bottomInset: Math.ceil(rect.height) + 24 })
}).exec()
},





openMemberDocuments(){const id=this.data.order?.memberDocuments?.groupId;if(id)nav.to('/pages/sign/index?memberGroup='+encodeURIComponent(id))},
openViewer(e) {
const o = this.data.order
if (!o || !o.pay) return
const sheets = (o.pay.sheets && o.pay.sheets.length ? o.pay.sheets : [{ idx: 0, code: o.pay.code, label: '服务确认单', snapUrl: o.pay.code ? `${api.API_BASE}/settlements/${encodeURIComponent(o.pay.code)}/snapshot` : '', status: 'signed' }])
const items = sheets.filter((sh) => sh.snapUrl).map((sh) => ({ code: sh.code, label: sh.label || '服务确认单', url: sh.snapUrl }))
const wantCode = e && e.currentTarget && e.currentTarget.dataset.code
const target = sheets.find((sh) => sh.code === wantCode) || sheets[0]
if (!items.length || (wantCode && target && !target.snapUrl)) {

if (target && target.code) nav.to(`/pages/sign/index?code=${encodeURIComponent(target.code)}`)
return
}
const index = Math.max(0, items.findIndex((it) => it.code === (target ? target.code : items[0].code)))
this.setData({ viewer: { open: true, index, items } })
},

closeViewer() { this.setData({ viewer: { open: false, items: [], index: 0 } }) },
asAction() {
const o = this.data.order
if (!o) return
if (o.afterSalesAction === 'progress') {

this.setData({ asPanelOpen: false })
wx.pageScrollTo({ selector: '.as-progress-card', duration: 200, fail: () => {} })
return
}
if (o.afterSalesAction === 'start') this.setData({ asPanelOpen: !this.data.asPanelOpen })
},
onAsDesc(e) { this.setData({ asDesc: e.detail.value }) },
async submitAfterSales() {
const desc = String(this.data.asDesc || '').trim()
if (!desc) { wx.showToast({ title: '问题描述必填', icon: 'none' }); return }
if (this.data.asSubmitting) return
this.setData({ asSubmitting: true })
try {
await api.startAfterSales(this.data.order._id, desc)
wx.showToast({ title: '已发起售后,门店会尽快跟进', icon: 'none', duration: 2200 })
this.setData({ asPanelOpen: false, asDesc: '' })
storage.setOrders([])   // 缓存失效,强制回源刷新徽标/进度
this.load(this.data.order._id)
} catch (e) {
wx.showToast({ title: (e && e.message) || '发起失败,请稍后再试', icon: 'none' })
} finally { this.setData({ asSubmitting: false }) }
},
async withdrawAfterSales() {
if (this.data.asSubmitting) return
this.setData({ asSubmitting: true })
try {
await api.withdrawAfterSales(this.data.order._id)
wx.showToast({ title: '已撤回(记录保留)', icon: 'none' })
storage.setOrders([])
this.load(this.data.order._id)
} catch (e) {
wx.showToast({ title: (e && e.message) || '撤回失败', icon: 'none' })
} finally { this.setData({ asSubmitting: false }) }
},


onAction(e) {
const key = e.currentTarget.dataset.key
if (key === 'cancel') return this.cancelOrder()
if (key === 'openAfterSales') return this.setData({ asPanelOpen: !this.data.asPanelOpen })
},

async cancelOrder(){if(this._cancelling)return;this._cancelling=true;const P=require('../../utils/member-pricing'),id=this.data.order._id,k='booking-cancel:'+api.currentTenantId()+':'+id;try{const old=P.pending(k);let q;if(!old){q=await api.previewBookingCancel(id);const ok=await new Promise(resolve=>wx.showModal({title:'确认取消预约',content:['已收定金 '+q.display.paidText,'退回储值 '+q.display.storedRefundText,'不退部分 '+q.display.forfeitText,'线下退款 '+q.display.cashRefundText,q.display.note].filter(Boolean).join(' · '),success:r=>resolve(r.confirm),fail:()=>resolve(false)}));if(!ok)return}const r=await P.bookingMutation(k,'/bookings/'+id+'/cancel',{reviewHash:q?.reviewHash,reason:''},async(_,b)=>{try{return await api.cancelBooking(id,b.reason,b.reviewHash)}catch(e){if(old){const rows=await api.getBookings(this.data.lang);const saved=rows.find(x=>x._id===id);if(saved?.status==='cancelled')return {booking:saved,refundReceipt:saved.depositPayment?.refundReceipt}}throw e}},!!old);storage.setOrders([]);Promise.resolve().then(()=>api.refreshMember()).catch(()=>{});await this.load(id);wx.showModal({title:'预约已取消',content:r.refundReceipt?.display?.note||'已更新预约记录，请查看退款明细。',showCancel:false,fail:()=>wx.showToast({title:'预约已取消，请查看退款明细',icon:'none'})})}catch(e){wx.showToast({title:e.message||'取消结果待核实，请重试原操作',icon:'none'})}finally{this._cancelling=false}},

callStore() {
require('../../utils/store-navigation').call(this.data.order.store, this.data.lang === 'en')
},

openLocation() {
require('../../utils/store-navigation').navigate(this.data.order.store, this.data.lang === 'en')
},

previewWork(event) {
const url = event.currentTarget.dataset.url
wx.previewImage({ current: url, urls: this.data.order.visibleWorkImages })
}
})
