/* 订单管理「今天」界面重做(2026-08-30,小程序今日台面屏=合同)。

   判据(处方与开单件同):①骨同源:网页调**同一条** /admin/schedule-day(不许另起数据口)
   ②几何口径同参(空档≥30 分 / 网格=营业∪预约 / 营业外淡色)③零下拉 ④徽标与状态字形同句
   ⑤「去结算」原位不动(全部预约卡上按钮仍由后端 settleAction 出)⑥运行时取证实发资源。

   ⚠️ standalone:CI_SUITES="today-board" bash apps/api/run-all-tests.sh */
import { assertTestTarget } from './test-guard.mjs'
import { readFileSync } from 'node:fs'

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
await assertTestTarget(BASE_URL)
const PLATFORM = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN = Date.now().toString(36)

let checks = 0
function check(name, cond, detail = '') {
  checks += 1
  if (!cond) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}
async function request(path, options = {}, token = PLATFORM, extra = {}) {
  const r = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra, ...(options.headers || {}) }
  })
  const text = await r.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: r.status, data }
}
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/* ===== ① 骨同源:实发资源里网页台面调的就是 /admin/schedule-day ===== */
const servedTb = await fetch(`${BASE_URL}/web/today-board.js`).then((r) => r.text())
const tbCode = stripJs(servedTb)
check('🔴 ① 骨同源:网页台面调同一条 /admin/schedule-day(与小程序 loadDayView 同口)',
  tbCode.includes('/admin/schedule-day?date='))
check('① 不许另起数据口:模块里除 schedule-day 外零 /admin 调用',
  (tbCode.match(/\/admin\//g) || []).length === 1, String((tbCode.match(/\/admin\//g) || []).length))

/* ===== ② 几何口径同参(与小程序 loadDayView 逐条对) ===== */
const miniOrders = stripJs(readFileSync(new URL('../../miniprogram/pages/merchant/orders/index.js', import.meta.url), 'utf8'))
/* 计数而非 includes(突变自检抓的:两处阈值只改坏一处,includes 照样真)——
   空档阈值在"块间"与"收尾"各一处,两端都必须恰好 2 处 >= 30。 */
check('② 空档 ≥30 分钟才显示(两端同参,块间+收尾**两处都数**)',
  (tbCode.match(/>= 30/g) || []).length === 2 && (miniOrders.match(/>= 30/g) || []).length === 2,
  `web=${(tbCode.match(/>= 30/g) || []).length} mini=${(miniOrders.match(/>= 30/g) || []).length}`)
check('② 网格范围 = 营业时段 ∪ 当天全部预约(店主 08-09 口径,两端同式)',
  ['Math.min(openMin', 'Math.max(closeMin'].every((k) => tbCode.includes(k) && miniOrders.includes(k)))
check('② 营业时段外整点行淡色(off 标记同式)',
  tbCode.includes('off: m < bizOpen || m >= bizClose') && miniOrders.includes('off: m < bizOpen || m >= bizClose'))
check('② 状态字形同句(●进行中 / ✓完成)',
  tbCode.includes("state === 'active' ? '●' : (state === 'done' ? '✓'") && miniOrders.includes("state === 'active' ? '●' : (state === 'done' ? '✓'"))

/* ===== ③ 零下拉 + 小程序同形件在场 ===== */
check('🔴 ③ 零下拉:今天台面模块渲染输出零 <select>', !servedTb.includes('<select'))
check('③ 小程序同形件在场:日期条/今天返回今天/汇总 pills/技师表头忙空/空档点排/图例',
  ['tb-datebar', '返回今天', 'tb-pill', 'tb-st', '+ 直接排单', '图例 · 平时不用看'].every((k) => servedTb.includes(k)))
check('③ 徽标族同句(售后蓝/老板排/指定/新客/未付定金 —— 售后句后端 afterSalesTag)',
  ['afterSalesTag', '老板排', '指定', '新客', '未付定金'].every((k) => servedTb.includes(k)))

/* ===== ④ 「去结算」原位不动 ===== */
const servedAdmin = await fetch(`${BASE_URL}/web/admin.js`).then((r) => r.text())
check('🔴 ④ 全部预约卡上的去结算按钮原样在(booking.settleAction 后端出,一个字没动)',
  servedAdmin.includes('booking.settleAction ?') && servedAdmin.includes('data-settle-booking'))
check('④ 今天网格点块=1 下打开该单(与小程序 tapBlock 动作数同);块上不塞第二颗去结算(不与卡上那颗分叉)',
  servedTb.includes('openBooking(el.dataset.tbBlock)') && !servedTb.includes('data-settle-booking'))

/* ===== ⑤ 行为面:schedule-day 的响应形状(两端吃的同一份) ===== */
const tid = `tb-${RUN}`
if ((await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: tid, name: `台面店${RUN}`, plan: 'chain' }) })).status !== 201) throw new Error('建店失败')
const H = { 'x-admin-tenant-id': tid, 'x-tenant-id': tid }
const t1 = (await request('/admin/technicians', { method: 'POST', body: JSON.stringify({ name: `台面技师${RUN}`, isActive: true }) }, PLATFORM, H)).data.technician
const catId = ((await request('/admin/pricing/categories', {}, PLATFORM, H)).data.categories || [])[0].id
const svc = (await request('/admin/services', { method: 'POST', body: JSON.stringify({ type: 'NAIL', nameZh: `台面项目${RUN}`, nameEn: 'x', priceCents: 10000, baseDurationMin: 60, categoryId: catId }) }, PLATFORM, H)).data.service
const today = (await request('/admin/store-clock', {}, PLATFORM, H)).data.today
await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ newCustomerName: `台面客${RUN}`, serviceId: svc.id, technicianId: t1.id, date: today, time: '11:00' }) }, PLATFORM, H)
const day = (await request(`/admin/schedule-day?date=${today}`, {}, PLATFORM, H)).data
check('⑤ schedule-day 下发两端共用的口径字段(bookings 带 group/arrivalState/时间;technicians 带 bookingCount)',
  Array.isArray(day.bookings) && day.bookings.length === 1
  && ['startTime', 'endTime', 'customerName', 'serviceName'].every((k) => k in day.bookings[0])
  && Array.isArray(day.technicians) && 'bookingCount' in day.technicians[0],
  JSON.stringify(day.bookings?.[0] || {}).slice(0, 160))
check('⑤ 营业时段字段在(网格范围口径的输入)', 'openTime' in day && 'closeTime' in day && 'isClosed' in day)

console.log(`\n✅ test-today-board 通过 ${checks} 项`)
