// P0.9 按店时区回归(2026-08-07,审计 B-1):
// 服务端的「今天 / 本月 / 当天时段窗口」必须按**门店时区**算,不是按服务器进程时区。
//
// 断言用的是「同一时刻、两家不同时区的店」这种可复现的对照,不依赖测试跑在一天中的哪个钟点:
// ① 两店各自的 today 等于用该店时区独立算出的日期;两地日期不同的时刻,服务端也必须不同
// ② 上海店 21:30 下的单,落在上海店的当天(而不是被多伦多算成第二天/前一天)
// ③ 月末跨月时刻,两店的财务月份键各归各月
// ④ 当天时段窗口(排班日视图)按店时区取,不串到别的日子
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const PLATFORM = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN_ID = Date.now().toString(36)

let checks = 0
function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

async function request(path, options = {}, token = PLATFORM) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, data }
}

// 测试侧独立算一遍,不复用服务端逻辑,避免"用被测代码验被测代码"
function localDateIn(tz, when = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(when)
}
function localTimeIn(tz, when = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(when)
}

async function newTenant(label, tz) {
  const id = `p09-${label}-${RUN_ID}`
  const created = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id, name: `时区店${label}${RUN_ID}`, plan: 'chain', timezone: tz }) })
  if (created.status !== 201) throw new Error(`建店失败: ${JSON.stringify(created.data)}`)
  await request(`/platform/tenants/${id}/store`, { method: 'PUT', body: JSON.stringify({ timezone: tz }) })
  const { username, initialPassword } = created.data.owner
  const first = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: initialPassword }) }, null)
  const newPass = `Pw-${RUN_ID}-${label}9`
  await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: initialPassword, newPassword: newPass, confirmPassword: newPass }) }, first.data.auth.accessToken)
  const again = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: newPass }) }, null)
  return { tenantId: id, token: again.data.auth.accessToken, tz }
}

async function main() {
  const sh = await newTenant('sh', 'Asia/Shanghai')
  const tor = await newTenant('tor', 'America/Toronto')
  check('两家不同时区的临时店建好', Boolean(sh.token && tor.token))

  // ---- ① today 按各自门店时区 ----
  const clockSh = await request('/admin/store-clock', {}, sh.token)
  const clockTor = await request('/admin/store-clock', {}, tor.token)
  check('/admin/store-clock 可读', clockSh.status === 200 && clockTor.status === 200, JSON.stringify(clockSh.data))
  check('上海店时区 = Asia/Shanghai', clockSh.data.timezone === 'Asia/Shanghai', clockSh.data.timezone)
  check('多伦多店时区 = America/Toronto', clockTor.data.timezone === 'America/Toronto', clockTor.data.timezone)

  // 固定时刻断言(不依赖测试跑在几点):2026-08-08T00:00Z = 北京 08-08 08:00 = 多伦多 08-07 20:00
  const FIXED_CROSSDAY = '2026-08-08T00:00:00.000Z'
  const fixShDay = await request(`/admin/store-clock?at=${encodeURIComponent(FIXED_CROSSDAY)}`, {}, sh.token)
  const fixTorDay = await request(`/admin/store-clock?at=${encodeURIComponent(FIXED_CROSSDAY)}`, {}, tor.token)
  check('① 固定时刻(北京 08-08 08:00):上海店 today = 2026-08-08', fixShDay.data.today === '2026-08-08', JSON.stringify(fixShDay.data))
  check('① 同一时刻:多伦多店 today = 2026-08-07(改造前两店都会是这一天)', fixTorDay.data.today === '2026-08-07', JSON.stringify(fixTorDay.data))
  check('① 同一时刻两店的今天必须不同', fixShDay.data.today !== fixTorDay.data.today)

  // 固定时刻断言跨月:2026-08-31T20:00Z = 北京 09-01 04:00 = 多伦多 08-31 16:00
  const FIXED_CROSSMONTH = '2026-08-31T20:00:00.000Z'
  const fixShMon = await request(`/admin/store-clock?at=${encodeURIComponent(FIXED_CROSSMONTH)}`, {}, sh.token)
  const fixTorMon = await request(`/admin/store-clock?at=${encodeURIComponent(FIXED_CROSSMONTH)}`, {}, tor.token)
  check('③ 跨月时刻:上海店归 2026-09', fixShMon.data.monthKey === '2026-09', JSON.stringify(fixShMon.data))
  check('③ 跨月时刻:多伦多店归 2026-08', fixTorMon.data.monthKey === '2026-08', JSON.stringify(fixTorMon.data))
  check('③ 跨月时刻两店财务分桶各归各月', fixShMon.data.monthKey !== fixTorMon.data.monthKey)

  const expectSh = localDateIn('Asia/Shanghai')
  const expectTor = localDateIn('America/Toronto')
  check('① 上海店的今天 = 上海时区的今天', clockSh.data.today === expectSh, `${clockSh.data.today} vs ${expectSh}`)
  check('① 多伦多店的今天 = 多伦多时区的今天', clockTor.data.today === expectTor, `${clockTor.data.today} vs ${expectTor}`)
  // 两地日期不同的那段时间(每天约 12 小时),服务端也必须给出不同的今天 —— 改造前这里一定相等
  if (expectSh !== expectTor) {
    check('① 跨日窗口内两店的今天不同(改造前必然相同 → 这条是回归的核心)',
      clockSh.data.today !== clockTor.data.today, `${clockSh.data.today} / ${clockTor.data.today}`)
  } else {
    check(`① 当前时刻两地同日(${expectSh}),两店今天一致`, clockSh.data.today === clockTor.data.today,
      `${clockSh.data.today} / ${clockTor.data.today}`)
  }
  check('① 进程时区被如实回报为兜底值', clockTor.data.serverProcessTimezone === 'America/Toronto', clockTor.data.serverProcessTimezone)

  // ---- ② 21:30 的单落在本店当天 ----
  const tech = await request(`/platform/tenants/${sh.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: `上海技师${RUN_ID}` }) })
  const svc = await request(`/platform/tenants/${sh.tenantId}/services`, {
    method: 'POST', body: JSON.stringify({ type: 'NAIL', nameZh: `上海项目${RUN_ID}`, nameEn: 'SH item', priceCents: 20000, baseDurationMin: 60 })
  })
  check('上海店有技师和项目', tech.status === 201 && svc.status === 201)

  const day = localDateIn('Asia/Shanghai')
  const direct = await request('/admin/bookings/direct', {
    method: 'POST',
    body: JSON.stringify({ newCustomerName: `夜场客${RUN_ID}`, serviceId: svc.data.service.id, technicianId: tech.data.technician.id, date: day, time: '21:30', durationMin: 60 })
  }, sh.token)
  check('上海店 21:30 直接排单成功', direct.status === 201, JSON.stringify(direct.data).slice(0, 200))

  const startUtc = direct.data.booking.appointmentStart || direct.data.booking.appointment_start
  check('② 21:30 的单换算成 UTC 后,在上海时区读回来仍是当天 21:30',
    localDateIn('Asia/Shanghai', new Date(startUtc)) === day && localTimeIn('Asia/Shanghai', new Date(startUtc)) === '21:30',
    `${startUtc} → ${localDateIn('Asia/Shanghai', new Date(startUtc))} ${localTimeIn('Asia/Shanghai', new Date(startUtc))}`)
  check('② 同一时刻在多伦多是另一个钟点(证明存的是绝对时刻,不是裸字符串)',
    localTimeIn('America/Toronto', new Date(startUtc)) !== '21:30',
    localTimeIn('America/Toronto', new Date(startUtc)))

  // ---- ④ 当天时段窗口按店时区 ----
  const dayView = await request(`/admin/schedule-day?date=${day}`, {}, sh.token)
  check('④ 排班日视图能取到该日', dayView.status === 200, JSON.stringify(dayView.data).slice(0, 160))
  const dayBookings = JSON.stringify(dayView.data)
  check('④ 21:30 那一单落在上海店当天的日视图里', dayBookings.includes(`夜场客${RUN_ID}`) || dayBookings.includes(direct.data.booking.id),
    dayBookings.slice(0, 300))

  // ---- ③ 月份键按店时区 ----
  check('③ 上海店月份键 = 上海时区的月份', clockSh.data.monthKey === expectSh.slice(0, 7), `${clockSh.data.monthKey} vs ${expectSh.slice(0, 7)}`)
  check('③ 多伦多店月份键 = 多伦多时区的月份', clockTor.data.monthKey === expectTor.slice(0, 7), `${clockTor.data.monthKey} vs ${expectTor.slice(0, 7)}`)
  if (expectSh.slice(0, 7) !== expectTor.slice(0, 7)) {
    check('③ 跨月时刻两店月份键各归各月', clockSh.data.monthKey !== clockTor.data.monthKey)
  } else {
    check(`③ 当前不在跨月时刻(同为 ${expectSh.slice(0, 7)}),两店月份键一致`, clockSh.data.monthKey === clockTor.data.monthKey)
  }

  // ---- 改门店时区后立即生效(缓存要失效)----
  await request(`/platform/tenants/${sh.tenantId}/store`, { method: 'PUT', body: JSON.stringify({ timezone: 'America/Toronto' }) })
  const afterSwitch = await request('/admin/store-clock', {}, sh.token)
  check('改门店时区后立刻生效(缓存已失效)', afterSwitch.data.timezone === 'America/Toronto' && afterSwitch.data.today === expectTor,
    JSON.stringify(afterSwitch.data))
  await request(`/platform/tenants/${sh.tenantId}/store`, { method: 'PUT', body: JSON.stringify({ timezone: 'Asia/Shanghai' }) })

  // ---- 非法时区不许把服务打挂 ----
  await request(`/platform/tenants/${tor.tenantId}/store`, { method: 'PUT', body: JSON.stringify({ timezone: 'Not/AZone' }) })
  const bad = await request('/admin/store-clock', {}, tor.token)
  check('门店时区值非法时回落进程时区,不报错', bad.status === 200 && bad.data.today === expectTor, JSON.stringify(bad.data))
  await request(`/platform/tenants/${tor.tenantId}/store`, { method: 'PUT', body: JSON.stringify({ timezone: 'America/Toronto' }) })

  console.log(`\n按店时区回归通过:${checks} 项断言全绿`)
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`)
  process.exit(1)
})
