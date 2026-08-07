// P2 排班 v2 回归(2026-08-08):
// ① 五选一:全天 / 上午 / 下午 / 自定义 / 休息,半天按当天营业时间 + 上下午分界算
// ② 上下午分界店铺可调(默认 14:30),改了以后半天班边界跟着走
// ③ 排班时段约束可预约时段:时段外的预约直接拒
// ④ 改时段撞上已有预约 → 列出冲突单提醒,但不硬拦(老板自己判断)
// ⑤ 「同步应用到之后每个周 N」批量生效
// ⑥ 老写法(直接给 startTime/endTime/isWorking)行为逐字不变
// ⑦ 租户隔离:排不了别人店的技师
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
  const id = `p2sc-${label}-${RUN_ID}`
  const created = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id, name: `排班店${label}${RUN_ID}`, plan: 'chain' }) })
  if (created.status !== 201) throw new Error(`建店失败: ${JSON.stringify(created.data)}`)
  const { username, initialPassword } = created.data.owner
  const first = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: initialPassword }) }, null)
  const pass = `Pw-${RUN_ID}-${label}9`
  await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: initialPassword, newPassword: pass, confirmPassword: pass }) }, first.data.auth.accessToken)
  const again = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: pass }) }, null)
  // 营业时间钉成 10:00–19:00,半天班边界才有确定值可断言
  await request(`/platform/tenants/${id}/business-hours`, {
    method: 'PUT',
    body: JSON.stringify({ hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, openTime: '10:00', closeTime: '19:00', isClosed: false })) })
  })
  return { tenantId: id, token: again.data.auth.accessToken }
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

async function main() {
  const shop = await newShop('a')
  const other = await newShop('b')
  check('两家临时店建好', Boolean(shop.token && other.token))

  const tech = (await request(`/platform/tenants/${shop.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: `技师${RUN_ID}` }) })).data.technician
  const svc = (await request(`/platform/tenants/${shop.tenantId}/services`, {
    method: 'POST', body: JSON.stringify({ type: 'NAIL', nameZh: `项目${RUN_ID}`, nameEn: 'item', priceCents: 30000, depositCents: 5000, baseDurationMin: 60 })
  })).data.service
  const today = (await request('/admin/store-clock', {}, shop.token)).data.today
  const day = addDays(today, 7) // 用一周后的日子,避开「过去时间不能约」

  const set = (body) => request(`/admin/technicians/${tech.id}/schedule`, { method: 'PATCH', body: JSON.stringify(body) }, shop.token)

  // ---- ① 五选一 ----
  const full = await set({ date: day, shift: 'full' })
  check('① 全天班 = 当天营业时间 10:00–19:00',
    full.data.schedule.start_time === '10:00' && full.data.schedule.end_time === '19:00' && full.data.schedule.is_working === 1,
    JSON.stringify(full.data.schedule))
  const am = await set({ date: day, shift: 'am' })
  check('① 上午班 10:00–14:30(默认分界)', am.data.schedule.start_time === '10:00' && am.data.schedule.end_time === '14:30',
    JSON.stringify(am.data.schedule))
  const pm = await set({ date: day, shift: 'pm' })
  check('① 下午班 14:30–19:00', pm.data.schedule.start_time === '14:30' && pm.data.schedule.end_time === '19:00',
    JSON.stringify(pm.data.schedule))
  const custom = await set({ date: day, startTime: '12:00', endTime: '18:00' })
  check('① 自定义起止照原样写入,并识别为 custom',
    custom.data.schedule.start_time === '12:00' && custom.data.schedule.end_time === '18:00' && custom.data.shift === 'custom',
    JSON.stringify(custom.data))
  const off = await set({ date: day, shift: 'off' })
  check('① 休息 = is_working 0', off.data.schedule.is_working === 0, JSON.stringify(off.data.schedule))

  // ---- ② 分界可调 ----
  check('② 默认分界 14:30', (await request('/admin/schedule-settings', {}, shop.token)).data.afternoonStart === '14:30')
  await request('/admin/schedule-settings', { method: 'PUT', body: JSON.stringify({ afternoonStart: '13:00' }) }, shop.token)
  const am2 = await set({ date: day, shift: 'am' })
  check('② 改成 13:00 后上午班边界跟着走', am2.data.schedule.end_time === '13:00', JSON.stringify(am2.data.schedule))
  await request('/admin/schedule-settings', { method: 'PUT', body: JSON.stringify({ afternoonStart: '14:30' }) }, shop.token)

  // ---- ③ 排班时段约束可预约时段 ----
  await set({ date: day, shift: 'pm' }) // 14:30–19:00
  // 顾客侧下单(老板直接排单会放宽时段限制,验不到这条规则)
  const reg = await request('/auth/email/register', { method: 'POST', body: JSON.stringify({ email: `sc-${RUN_ID}@example.com`, displayName: `排班客${RUN_ID}` }) }, null)
  const userToken = reg.data?.auth?.accessToken
  const book = (time) => request('/bookings', {
    method: 'POST',
    body: JSON.stringify({ storeId: `store-${shop.tenantId}`, serviceId: svc.id, technicianId: tech.id, date: day, time, addOns: [] })
  }, userToken, { 'x-tenant-id': shop.tenantId })
  const early = await book('11:00')
  check('③ 下午班时段外(11:00)的预约被拒', early.status === 400, `${early.status} ${JSON.stringify(early.data).slice(0, 120)}`)
  const okBooking = await book('15:00')
  check('③ 时段内(15:00)的预约正常', okBooking.status === 201, `${okBooking.status} ${JSON.stringify(okBooking.data).slice(0, 160)}`)

  // ---- ④ 改时段撞已有预约:列冲突但不拦 ----
  const clash = await set({ date: day, shift: 'am' }) // 改成上午班,15:00 那单就落在时段外了
  check('④ 冲突单被列出来', clash.data.conflicts.length === 1 && clash.data.conflicts[0].startTime === '15:00',
    JSON.stringify(clash.data.conflicts))
  check('④ 但不硬拦:排班照样改成了上午班', clash.data.schedule.end_time === '14:30', JSON.stringify(clash.data.schedule))
  const offClash = await set({ date: day, shift: 'off' })
  check('④ 改成休息时,当天所有在途预约都算冲突', offClash.data.conflicts.length === 1, JSON.stringify(offClash.data.conflicts))

  // ---- ⑤ 同步应用到之后每个周 N ----
  const repeat = await set({ date: day, shift: 'full', applyToFollowingWeeks: 4 })
  check('⑤ 一次写 5 天(当天 + 之后 4 个同星期几)', repeat.data.appliedDates.length === 5, JSON.stringify(repeat.data.appliedDates))
  check('⑤ 日期正好隔 7 天', repeat.data.appliedDates[1] === addDays(day, 7) && repeat.data.appliedDates[4] === addDays(day, 28),
    JSON.stringify(repeat.data.appliedDates))
  const week = await request(`/admin/schedule-week?from=${addDays(day, 28)}`, {}, shop.token)
  const farRow = (week.data.schedules || []).find((r) => r.technicianId === tech.id && r.date === addDays(day, 28))
  check('⑤ 第 4 周那天确实排上了全天班',
    Boolean(farRow) && farRow.isWorking === true && farRow.startTime === '10:00' && farRow.endTime === '19:00',
    JSON.stringify(farRow || week.data.schedules))

  // ---- ⑥ 老写法逐字不变 ----
  const legacy = await set({ date: addDays(day, 1), startTime: '09:00', endTime: '20:00', isWorking: true })
  check('⑥ 老写法直接给起止时间照写不误', legacy.data.schedule.start_time === '09:00' && legacy.data.schedule.end_time === '20:00',
    JSON.stringify(legacy.data.schedule))
  const legacyOff = await set({ date: addDays(day, 2), isWorking: false })
  check('⑥ 老写法 isWorking=false 仍是休息', legacyOff.data.schedule.is_working === 0, JSON.stringify(legacyOff.data.schedule))

  // ---- ⑦ 租户隔离 ----
  const cross = await request(`/admin/technicians/${tech.id}/schedule`, {
    method: 'PATCH', body: JSON.stringify({ date: day, shift: 'off' })
  }, other.token)
  check('⑦ B 店排不了 A 店的技师(404)', cross.status === 404, `${cross.status}`)

  console.log(`\n排班 v2 回归通过:${checks} 项断言全绿`)
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`)
  process.exit(1)
})
