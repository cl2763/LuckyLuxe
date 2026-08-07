// P1.2 定金规则每店可配回归(2026-08-08):
// ① 默认配置 = 旗舰店现状等价(不改任何配置时,定金与取消扣费与改造前一致)
// ② fixed / pct 两种计价模式
// ③ 迟到超过宽限 → 按爽约扣费
// ④ 合规改期 → 定金保留一次;第二次超出次数不再保留
// ⑤ deductible 开关随接口下发(P1 结算单定金行据此)
// ⑥ enabled=false → 零定金
// ⑦ 租户隔离:两店各配各的,互不影响
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const PLATFORM = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN_ID = Date.now().toString(36)

let checks = 0
function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

async function request(path, options = {}, token = PLATFORM, extraHeaders = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders, ...(options.headers || {}) }
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, data }
}

async function newShop(label) {
  const id = `p12-${label}-${RUN_ID}`
  const created = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id, name: `定金店${label}${RUN_ID}`, plan: 'chain' }) })
  if (created.status !== 201) throw new Error(`建店失败: ${JSON.stringify(created.data)}`)
  const { username, initialPassword } = created.data.owner
  const first = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: initialPassword }) }, null)
  const pass = `Pw-${RUN_ID}-${label}9`
  await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: initialPassword, newPassword: pass, confirmPassword: pass }) }, first.data.auth.accessToken)
  const again = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: pass }) }, null)
  const token = again.data.auth.accessToken
  // 临时店默认没有营业时间,先铺满一周(00:00-23:59),免得下单被「该日期门店休息」挡住
  await request(`/platform/tenants/${id}/business-hours`, {
    method: 'PUT',
    body: JSON.stringify({ hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, openTime: '00:00', closeTime: '23:30', isClosed: false })) })
  })
  const tech = await request(`/platform/tenants/${id}/technicians`, { method: 'POST', body: JSON.stringify({ name: `技师${label}${RUN_ID}` }) })
  const svc = await request(`/platform/tenants/${id}/services`, {
    method: 'POST', body: JSON.stringify({ type: 'NAIL', nameZh: `项目${label}${RUN_ID}`, nameEn: 'item', priceCents: 40000, depositCents: 5000, baseDurationMin: 60 })
  })
  return { tenantId: id, token, techId: tech.data.technician.id, serviceId: svc.data.service.id }
}

function dateStr(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 老板直接排单不收定金(adminDirect),所以定金链路走顾客侧下单:注册一个演示顾客
async function customerBook(shop, { date, time, userToken }) {
  return request('/bookings', {
    method: 'POST',
    body: JSON.stringify({ storeId: `store-${shop.tenantId}`, serviceId: shop.serviceId, technicianId: shop.techId, date, time, addOns: [] })
  }, userToken, { 'x-tenant-id': shop.tenantId })
}

async function setConfig(shop, config) {
  return request('/admin/deposit-config', { method: 'PUT', body: JSON.stringify({ config }) }, shop.token)
}

async function main() {
  const shopA = await newShop('a')
  const shopB = await newShop('b')
  check('两家临时店建好(各带技师与项目)', Boolean(shopA.token && shopB.token))

  // ---- ① 默认配置 = 现状等价 ----
  const def = await request('/admin/deposit-config', {}, shopA.token)
  const c = def.data.config
  check('① 默认 enabled + per_service + 兜底 5000', c.enabled === true && c.mode === 'per_service' && c.fallbackAmountCents === 5000, JSON.stringify(c))
  check('① 默认会员按等级免定金、定金不抵扣', c.memberWaive === 'by_tier' && c.deductible === false)
  check('① 默认取消规则 = 24h 全退 / 临期扣半 / 爽约不退',
    c.cancelPolicy.refundable === true && c.cancelPolicy.freeCancelHours === 24
    && c.cancelPolicy.lateForfeitPct === 50 && c.cancelPolicy.noShowForfeitPct === 100,
    JSON.stringify(c.cancelPolicy))
  check('① 默认无迟到宽限、改期 24h、保留 0 次',
    c.cancelPolicy.lateArrivalGraceMin === null && c.cancelPolicy.rescheduleNoticeHours === 24 && c.cancelPolicy.depositRetainTimes === 0)

  const reg = await request('/auth/email/register', { method: 'POST', body: JSON.stringify({ email: `dep-${RUN_ID}@example.com`, displayName: `定金客${RUN_ID}` }) }, null)
  const userToken = reg.data?.auth?.accessToken
  check('演示顾客登录可用', Boolean(userToken), JSON.stringify(reg.data).slice(0, 160))

  const b1 = await customerBook(shopA, { date: dateStr(3), time: '11:00', userToken })
  check('默认配置下顾客下单成功', b1.status === 201, JSON.stringify(b1.data).slice(0, 220))
  check('① 默认定金 = 项目自身的 5000(与改造前写死的 5000 一致)',
    b1.data.booking.depositRequiredCents === 5000 && b1.data.booking.depositCents === 5000,
    JSON.stringify({ req: b1.data.booking.depositRequiredCents, dep: b1.data.booking.depositCents }))

  // ---- ⑥ enabled=false → 零定金 ----
  await setConfig(shopA, { enabled: false })
  const b2 = await customerBook(shopA, { date: dateStr(4), time: '11:00', userToken })
  check('⑥ 关掉定金后下单零定金且直接确认', b2.data.booking.depositCents === 0 && b2.data.booking.status === 'CONFIRMED', JSON.stringify(b2.data.booking).slice(0, 200))

  // ---- ② fixed / pct ----
  await setConfig(shopA, { enabled: true, mode: 'fixed', fixedAmountCents: 10000 })
  const b3 = await customerBook(shopA, { date: dateStr(5), time: '11:00', userToken })
  check('② fixed 模式:定金 = 100 元', b3.data.booking.depositRequiredCents === 10000, String(b3.data.booking.depositRequiredCents))

  await setConfig(shopA, { mode: 'pct', pct: 20 })
  const b4 = await customerBook(shopA, { date: dateStr(6), time: '11:00', userToken })
  check('② pct 模式:定金 = 项目价 400 的 20% = 80 元', b4.data.booking.depositRequiredCents === 8000, String(b4.data.booking.depositRequiredCents))

  // ---- ⑤ deductible 开关随接口下发 ----
  await setConfig(shopA, { mode: 'fixed', fixedAmountCents: 10000, deductible: true })
  const policy = await request('/store/deposit-policy', {}, null, { 'x-tenant-id': shopA.tenantId })
  check('⑤ deductible=true 随公开接口下发(结算单定金行据此)', policy.data.config.deductible === true, JSON.stringify(policy.data.config).slice(0, 160))
  check('⑤ 公开文案跟着变(可抵扣)', /可抵扣/.test(policy.data.text.zh), policy.data.text.zh)
  check('⑤ 线上支付未通期间文案不出现「在线支付定金」', !/在线支付定金/.test(policy.data.text.zh), policy.data.text.zh)

  // ---- ③ 迟到超过宽限 → 按爽约扣费 ----
  await setConfig(shopA, { mode: 'fixed', fixedAmountCents: 10000, deductible: false, cancelPolicy: { lateArrivalGraceMin: 30, noShowForfeitPct: 100 } })
  const bLate = await customerBook(shopA, { date: dateStr(-1), time: '10:00', userToken })
  check('造一笔昨天的单用于迟到判定', bLate.status === 201, JSON.stringify(bLate.data).slice(0, 200))
  const arrival = await request(`/admin/bookings/${bLate.data.booking.id}/arrival`, { method: 'PATCH', body: JSON.stringify({ arrived: true }) }, shopA.token)
  check('③ 到店打卡返回迟到判定(超过 30 分钟宽限)',
    arrival.data.lateness && arrival.data.lateness.graceExceeded === true && arrival.data.lateness.suggestedAction === 'no_show',
    JSON.stringify(arrival.data.lateness))
  const noShow = await request(`/admin/bookings/${bLate.data.booking.id}/no-show`, { method: 'POST', body: JSON.stringify({ reason: '迟到超过宽限' }) }, shopA.token)
  check('③ 按爽约处理:扣 100% 定金', noShow.status === 200 && noShow.data.noShow.forfeitedDepositCents === bLate.data.booking.depositCents,
    JSON.stringify(noShow.data.noShow))

  // ---- ④ 合规改期 → 定金保留一次;第二次不保留 ----
  await setConfig(shopA, { mode: 'fixed', fixedAmountCents: 10000, cancelPolicy: { lateArrivalGraceMin: null, rescheduleNoticeHours: 24, depositRetainTimes: 1, refundable: false } })
  const r1 = await customerBook(shopA, { date: dateStr(7), time: '13:00', userToken })
  check('④ 造一笔 7 天后的单', r1.status === 201 && r1.data.booking.depositCents === 10000, JSON.stringify(r1.data.booking).slice(0, 200))
  const resched1 = await request(`/admin/bookings/${r1.data.booking.id}/reschedule`, { method: 'POST', body: JSON.stringify({ reason: '顾客改期' }) }, shopA.token)
  check('④ 合规改期:定金保留(第 1 次)', resched1.data.reschedule.compliant === true && resched1.data.reschedule.depositRetained === true
    && resched1.data.reschedule.retainTimesUsed === 1 && resched1.data.reschedule.forfeitedDepositCents === 0,
    JSON.stringify(resched1.data.reschedule))

  const r2 = await customerBook(shopA, { date: dateStr(8), time: '13:00', userToken })
  check('④ 下一次预约自动用掉保留的定金(本次应付 0)', r2.data.booking.depositCents === 0 && r2.data.booking.depositRequiredCents === 10000,
    JSON.stringify(r2.data.booking).slice(0, 220))

  const resched2 = await request(`/admin/bookings/${r2.data.booking.id}/reschedule`, { method: 'POST', body: JSON.stringify({ reason: '再次改期' }) }, shopA.token)
  check('④ 第二次改期不再保留(depositRetainTimes=1 用完)', resched2.data.reschedule.depositRetained === false,
    JSON.stringify(resched2.data.reschedule))

  // ---- ⑦ 租户隔离 ----
  const bDefault = await request('/admin/deposit-config', {}, shopB.token)
  check('⑦ B 店仍是默认配置,不受 A 店改动影响',
    bDefault.data.config.mode === 'per_service' && bDefault.data.config.fixedAmountCents === 5000
    && bDefault.data.config.cancelPolicy.depositRetainTimes === 0,
    JSON.stringify(bDefault.data.config).slice(0, 200))
  const bPolicy = await request('/store/deposit-policy', {}, null, { 'x-tenant-id': shopB.tenantId })
  check('⑦ B 店公开文案也是默认口径', /提前 24 小时/.test(bPolicy.data.text.zh), bPolicy.data.text.zh)

  // ---- 自定义全文 ----
  await setConfig(shopA, { displayMode: 'custom', customText: `本店定金规则 ${RUN_ID} 专用文案` })
  const custom = await request('/store/deposit-policy', {}, null, { 'x-tenant-id': shopA.tenantId })
  check('displayMode=custom 时输出商家原文', custom.data.text.zh === `本店定金规则 ${RUN_ID} 专用文案`, custom.data.text.zh)

  console.log(`\n定金规则回归通过:${checks} 项断言全绿`)
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`)
  process.exit(1)
})
