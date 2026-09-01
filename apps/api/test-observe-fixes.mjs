/* 01t 观看式走查缺陷单常驻断言(D94–D101;判据匹配带界定)。 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
/* 测试护栏(裁 C):套件永远不许写进真库 —— 开跑前问服务器「你往哪个库写」 */
import { assertTestTarget } from './test-guard.mjs'
await assertTestTarget(BASE_URL)
const OWNER = process.env.OWNER_TOKEN || process.env.OWNER_DEMO_TOKEN || 'owner-demo-token'
let checks = 0
function check(name, ok, detail = '') {
  checks += 1
  if (!ok) { console.error(`Error: ${name}: ${detail}`); process.exit(1) }
  console.log(`ok ${checks} - ${name}`)
}
const rf = (p) => readFileSync(join(ROOT, p), 'utf8')
async function request(path, options = {}, token = OWNER) {
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(options.headers || {}) } })
  let data = null
  try { data = await res.json() } catch { data = null }
  return { status: res.status, data }
}

async function main() {
  /* ===== D94:值日 tap 修死 + 静态链 ===== */
  const ordJs = rf('miniprogram/pages/merchant/orders/index.js')
  check('D94 值日 tap 调 loadDayView(this.load 不存在=点击即炸的根)', ordJs.includes('this.loadDayView(this.data.selDate)  // D94') && !/this\.load\(this\.data\.selDate\)/.test(ordJs))
  const dc = rf('miniprogram/utils/dailyclose.js')
  check('D94 snapViewer 初值住唯一真相(mixin dailyCloseData)且关闭不回 null', dc.includes('snapViewer: { open: false, items: [], index: 0 },') && dc.includes("this.setData({ snapViewer: { open: false, items: [], index: 0 } })"))
  check('D94 L2 零残留:全仓不再有 viewer 置 null 写法', !rf('miniprogram/pages/merchant/finance/index.js').includes('snapViewer: null') && !rf('miniprogram/pages/order-detail/index.js').includes('viewer: null'))

  /* ===== D95:网页直排面板对齐小程序(合同项逐条) ===== */
  const tb = rf('apps/web/today-board.js')
  check('D95 两级选择器(大类 data-tbf-cat + 小类 data-tbf-svc)', tb.includes('data-tbf-cat="') && tb.includes('data-tbf-svc="'))
  check('D95 时长自动+微调±30+标准(data-tbf-dur 三钮)', tb.includes('data-tbf-dur="-30"') && tb.includes('data-tbf-dur="30"') && tb.includes('data-tbf-dur="0"'))
  check('D95 预计结束由服务时长定(calcEnd)+提交带 durationMin/depositPaid', tb.includes('function calcEnd(time, dur)') && tb.includes('durationMin: f.durationMin, depositPaid: f.deposit === true'))

  /* ===== D96:直排后回灌全局预约缓存 ===== */
  check('D96 直排成功回灌 owner.bookings(refreshBookings 钩)', tb.includes('if (deps.refreshBookings) deps.refreshBookings()') && rf('apps/web/admin.js').includes("refreshBookings: async () => { try { const d = await request('/admin/bookings')"))

  /* ===== D97:行为闭环 —— 完成单无小记=待写;写(挂单)后消行 ===== */
  const uniq = Date.now().toString(36)
  const svc = (await request('/admin/pricing/items')).data.items.filter((i) => (i.itemKind || 'main') === 'main')[0]
  const techR = (await request('/admin/technicians')).data
  const tech = (techR.technicians || techR)[0]
  const today = new Date().toISOString().slice(0, 10)
  const mk = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ newCustomerName: `观走查${uniq}`, serviceId: svc.id, technicianId: tech.id, date: today, time: '09:00' }) })
  check('D97 夹具:直排建单 201', mk.status === 201, JSON.stringify(mk.data).slice(0, 120))
  const bid = mk.data.booking.id, uid = mk.data.booking.userId || mk.data.booking.user_id || (mk.data.booking.user && mk.data.booking.user.id)
  await request(`/admin/bookings/${bid}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'COMPLETED' }) })
  const p1 = await request(`/admin/service-notes/pending?date=${today}`)
  check('D97 完成无小记 → 进待写清单(按单判定)', p1.status === 200 && (p1.data.items || []).some((x) => x.bookingId === bid), JSON.stringify(p1.data).slice(0, 150))
  const note = await request('/admin/service-notes', { method: 'POST', body: JSON.stringify({ userId: uid, bookingId: bid, rawText: '观看式走查断言:裸色渐变,下次补钻' }) })
  check('D97 写小记挂单 200(bookingId 落库)', note.status === 200 || note.status === 201, JSON.stringify(note.data).slice(0, 120))
  const p2 = await request(`/admin/service-notes/pending?date=${today}`)
  check('D97 写完消行(挂单判定闭环)', !(p2.data.items || []).some((x) => x.bookingId === bid))
  /* 前端链:两端结算钩 + 台面 pill + 员工卡 + 订单卡补写口 */
  check('D97 网页结算完成钩(ServiceNoteModal.open 带 bookingId)', rf('apps/web/settlement-web.js').includes('window.ServiceNoteModal.open(state.userId, state.customerName'))
  check('D97 小程序全签完弹「去写/跳过」', rf('miniprogram/pages/merchant/settlement/index.js').includes("title: '给这单写个服务小记?'"))
  check('D97 台面 pill 双端(data-tb-notes / tapPendingNotes)', tb.includes('data-tb-notes') && ordJs.includes('tapPendingNotes()'))
  check('D97 员工工作台待写卡 + 网页订单卡补写口', rf('apps/web/staff-workbench.js').includes('data-swb-note="') && rf('apps/web/admin.js').includes('data-note-booking="${booking.id}"'))
  check('D97 弹层保存体带 bookingId', rf('apps/web/service-note-modal.js').includes('bookingId: st.bookingId || undefined'))
  check('D97 open() fresh 对象内带 bookingId(自走查咬出:先赋后重建=冲掉恒 null;判据钉在重建体内)', rf('apps/web/service-note-modal.js').includes("deps, bookingId: bookingId || '' }"))

  /* ===== D98/D99(静态链;像素=自走查) ===== */
  check('D98 值日行=标准开关(ui-spec ⑤ 也守),说明句行内小字', rf('apps/web/duty-setting.js').includes('class="note"'))
  check('D99 定金规则摘要行呼吸(20rpx 22rpx)', rf('miniprogram/pages/merchant/store/index.wxss').includes('padding:20rpx 22rpx;border-bottom:1rpx solid #f2ece5'))

  /* ===== D101②:会话侧顾客卡六件双端 ===== */
  const desk = rf('apps/web/ai-desk.js')
  check('D101② 网页卡六件(会员/会员码/储值/次卡/报价状态)', desk.includes('会员码') && desk.includes('data-cs-tc="') && desk.includes('报价状态'))
  const convJs = rf('miniprogram/pages/merchant/conversation/index.js')
  const convWx = rf('miniprogram/pages/merchant/conversation/index.wxml')
  check('D101② 小程序卡六件 + 报价短标(quoteLabel)', convJs.includes("memberCode: cust.memberCode || '—'") && convWx.includes('{{quoteLabel}}') && convWx.includes('{{profile.tcText}}'))
  check('D101① 横幅链仍在(banner 属性界定)', convWx.includes('class="qs-banner {{quoteBannerCls}}"'))

  console.log(`[observe-fixes] all ${checks} checks passed`)
}
main().catch((e) => { console.error('[observe-fixes] failed:', e.message); process.exit(1) })
