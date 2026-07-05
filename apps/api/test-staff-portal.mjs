// 员工端P0批回归:
// 1. 管理端订单携带顾客标签/备注(customerCare)
// 2. 排班申请:员工只能为自己发起;重复日期拒绝;老板审批 set-off 后当天变休息
// 3. 员工薪酬预估:底薪+提成×本月完成业绩
// 4. staff 只能看到自己的订单(既有隔离不回归)
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const OWNER = 'owner-demo-token'
const RUN_ID = Date.now().toString(36)

let checks = 0
function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

async function request(path, options = {}, token = OWNER) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(options.headers || {}) }
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, data }
}

function futureDate(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function main() {
  // staff 登录拿 token
  const login = await request('/admin/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'staff@luckyluxeatelier.com', password: 'LuckyluxeStaff0312' })
  })
  const STAFF = login.data?.auth?.accessToken
  check('staff login works', Boolean(STAFF), JSON.stringify(login.data).slice(0, 120))
  const myTechId = (await request('/admin/technicians', {}, STAFF)).data.technicians[0]?.id
  check('staff bound to one technician', Boolean(myTechId))

  // 1. 订单携带 customerCare(用一个带标签的用户造一单历史数据验证:直接查所有订单里 care 字段存在)
  const ownerBookings = (await request('/admin/bookings')).data.bookings
  check('bookings carry customerCare field', ownerBookings.length > 0 && ownerBookings.every((booking) => booking.customerCare && Array.isArray(booking.customerCare.tags)))
  // 给某单的顾客加标签后再取,标签应出现在订单上
  const withUser = ownerBookings.find((booking) => booking.user?.id)
  if (withUser) {
    await request(`/admin/customers/${withUser.user.id}/profile`, { method: 'PATCH', body: JSON.stringify({ tags: [`回归标签-${RUN_ID}`] }) })
    const again = (await request('/admin/bookings')).data.bookings.find((booking) => booking.id === withUser.id)
    check('care tags flow onto booking', again.customerCare.tags.includes(`回归标签-${RUN_ID}`), JSON.stringify(again.customerCare))
    await request(`/admin/customers/${withUser.user.id}/profile`, { method: 'PATCH', body: JSON.stringify({ tags: [] }) })
  } else {
    check('care tags flow onto booking (skipped: no user-linked booking)', true)
  }

  // 4. staff 订单隔离
  const staffBookings = (await request('/admin/bookings', {}, STAFF)).data.bookings
  check('staff sees only own bookings', staffBookings.every((booking) => booking.technician?.id === myTechId), `${staffBookings.length} rows`)

  // 2. 排班申请
  const reqDate = futureDate(9)
  const created = await request('/admin/schedule-requests', { method: 'POST', body: JSON.stringify({ date: reqDate, note: `回归请假-${RUN_ID}` }) }, STAFF)
  check('staff creates schedule request', created.status === 201 && created.data.request.technician_id === myTechId, JSON.stringify(created.data).slice(0, 150))
  const duplicate = await request('/admin/schedule-requests', { method: 'POST', body: JSON.stringify({ date: reqDate, note: 'x' }) }, STAFF)
  check('duplicate pending request rejected', duplicate.status === 409)
  const forOther = await request('/admin/schedule-requests', { method: 'POST', body: JSON.stringify({ date: futureDate(10), technicianId: 'tech-other', note: 'x' }) }, STAFF)
  check('staff cannot request for another technician', forOther.status === 403)
  const staffList = (await request('/admin/schedule-requests', {}, STAFF)).data.requests
  check('staff sees own request pending', staffList.some((row) => row.date === reqDate && row.status === 'pending'))
  const ownerList = (await request('/admin/schedule-requests')).data.requests
  const target = ownerList.find((row) => row.date === reqDate && row.technicianId === myTechId && row.status === 'pending')
  check('owner sees pending request with tech name', Boolean(target && target.technicianName))
  const staffResolve = await request(`/admin/schedule-requests/${target.id}/set-off`, { method: 'POST' }, STAFF)
  check('staff cannot approve requests', staffResolve.status === 403)
  const approved = await request(`/admin/schedule-requests/${target.id}/set-off`, { method: 'POST' })
  check('owner approves as set-off', approved.status === 200 && approved.data.request.status === 'approved')
  const week = await request(`/admin/schedule-week?from=${reqDate}`)
  const override = (week.data.schedules || []).find((row) => row.technicianId === myTechId && row.date === reqDate)
  check('approved day becomes off in week view', override && override.isWorking === false, JSON.stringify(override))
  const twice = await request(`/admin/schedule-requests/${target.id}/reject`, { method: 'POST' })
  check('resolved request cannot be re-resolved', twice.status === 400)
  // 清理:恢复该日为上班
  await request(`/admin/technicians/${myTechId}/schedule`, { method: 'PATCH', body: JSON.stringify({ date: reqDate, isWorking: true }) })

  // 3. 薪酬预估
  await request('/admin/finance/unlock', { method: 'POST', body: JSON.stringify({ password: OWNER }) }).then(async (unlock) => {
    const finKey = unlock.data.financeKey
    await fetch(`${BASE_URL}/admin/finance/compensation`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${OWNER}`, 'x-finance-key': finKey },
      body: JSON.stringify({ technicianId: myTechId, baseSalary: 2000, commissionRate: 0.1, active: true })
    })
  })
  const estimate = await request('/admin/my-compensation-estimate', {}, STAFF)
  check('staff gets compensation estimate', estimate.status === 200 && estimate.data.estimate && estimate.data.estimate.baseSalaryCents === 200000, JSON.stringify(estimate.data).slice(0, 150))
  const expected = estimate.data.estimate.baseSalaryCents + Math.round(estimate.data.estimate.monthRevenueCents * estimate.data.estimate.commissionRate)
  check('estimate math consistent (base + rate × revenue)', estimate.data.estimate.totalCents === expected)

  console.log(`[staff-portal] all ${checks} checks passed`)
}

main().catch((error) => {
  console.error('[staff-portal] failed:', error.message)
  process.exit(1)
})
