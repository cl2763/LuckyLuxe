// 员工端P0批回归:
// 1. 管理端订单携带顾客标签/备注(customerCare)
// 2. 排班申请:员工只能为自己发起;重复日期拒绝;老板审批 set-off 后当天变休息
// 3. 员工薪酬预估:底薪+提成×本月完成业绩
// 4. staff 只能看到自己的订单(既有隔离不回归)
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
/* 测试护栏(裁 C):套件永远不许写进真库 —— 开跑前问服务器「你往哪个库写」 */
import { readFileSync } from 'node:fs'
import { assertTestTarget } from './test-guard.mjs'
await assertTestTarget(BASE_URL)
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
  // 时区红线(复发登记 08-23,L2 同类):日期一律按门店时区推,裸 new Date() 在 CST 午夜跨天错位
  return new Date(Date.now() + days * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
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

  /* ===== 小记图片(店主 08-30f 二部三,小合同五条) ===== */
  {
    const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    // 员工给自己服务过的顾客写带图小记(合同①入口 ②归属小记 ⑤复用 base64 通道)
    const myBk = (await request('/admin/bookings', {}, STAFF)).data.bookings.find((b) => b.user?.id)
    check('小记图片 前置:员工有带客订单', Boolean(myBk), '员工无带客单,夹具缺')
    const made = await request('/admin/service-notes', { method: 'POST', body: JSON.stringify({ userId: myBk.user.id, bookingId: myBk.id, rawText: `图测小记-${RUN_ID}`, images: [PX] }) }, STAFF)
    check('🔴 小记图片:员工真传一张 → 201 且随小记返回', made.status === 201 && (made.data.note.images || [])[0] === PX, JSON.stringify(made.data).slice(0, 120))
    const back = await request(`/admin/customers/${encodeURIComponent(myBk.user.id)}/notes`, {}, STAFF)
    const mine = (back.data.notes || []).find((n) => n.rawText === `图测小记-${RUN_ID}`)
    check('🔴 小记图片:限权读口回图(写的技师可见);无图小记 images=[](空态零占位)', 
      mine && mine.images[0] === PX && (back.data.notes || []).every((n) => Array.isArray(n.images)), JSON.stringify(mine || {}).slice(0, 100))
    // 合同①终闸:>9 拒 / 非图拒(前端拦只算体验)
    const ten = await request('/admin/service-notes', { method: 'POST', body: JSON.stringify({ userId: myBk.user.id, bookingId: myBk.id, rawText: 'x', images: Array(10).fill(PX) }) }, STAFF)
    check('小记图片 终闸:第 10 张 → 400「最多 9 张」', ten.status === 400 && /9 张/.test(ten.data?.error?.message || ''))
    const evil = await request('/admin/service-notes', { method: 'POST', body: JSON.stringify({ userId: myBk.user.id, bookingId: myBk.id, rawText: 'x', images: ['https://evil.example/x.png'] }) }, STAFF)
    check('小记图片 终闸:非 data:image 拒(只收拍照/相册通道)', evil.status === 400)
    // 合同③⑤:默认私密不上墙 —— galleryStatus 分立零牵动;顾客端零暴露(压根没有顾客侧小记口)
    const pub = await fetch(`${BASE_URL}/my/service-notes`, { headers: {} })
    check('小记图片 合同⑤:顾客端零小记口(/my/service-notes 不存在)', pub.status === 404 || pub.status === 401)
    const srcLS = readFileSync(new URL('./local-server.mjs', import.meta.url), 'utf8')
    check('小记图片 合同③:本批零上墙牵动(小记写口不碰 gallery_status/work_images)', 
      !/service-notes'[\s\S]{0,2000}gallery_status/.test(srcLS))
  }
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
  const estimate = await request('/admin/salary/my-estimate', {}, STAFF)
  check('staff gets salary estimate (v2 engine, single mouth after #2 collapse)',
    estimate.status === 200 && estimate.data.estimate && (estimate.data.estimate.noPlan === true || typeof estimate.data.estimate.totalCents === 'number'),
    JSON.stringify(estimate.data).slice(0, 150))
  const est2 = estimate.data.estimate
  check('estimate math consistent or honestly noPlan',
    est2.noPlan === true || est2.totalCents === (est2.baseSalaryCents + est2.handworkCents + est2.commissionCents
      + est2.firstRechargePayCents + est2.renewRechargePayCents + est2.customCommissionPayCents + est2.overtimePayCents + est2.adjustCents))

  // ===== D91 工资历史月切换(31q):API 吃 ?month= + 双端渲染链静态钉(判据带界定:引号闭合/属性闭合) =====
  const histMonth = '2025-01'
  const hist = await request(`/admin/salary/my-estimate?month=${histMonth}`, {}, STAFF)
  check('D91 历史月可查:?month=2025-01 回 200 且结构同当月', hist.status === 200 && hist.data.estimate
    && (hist.data.estimate.noPlan === true || typeof hist.data.estimate.totalCents === 'number'), JSON.stringify(hist.data).slice(0, 120))
  const badMonth = await request('/admin/salary/my-estimate?month=2025-13', {}, STAFF)
  check('D91 畸形月份不炸:回落当月(正则闸)', badMonth.status === 200)
  const { readFileSync: rfs91 } = await import('node:fs')
  const { join: j91 } = await import('node:path')
  const R91 = new URL('../..', import.meta.url).pathname
  const wbJs = rfs91(j91(R91, 'apps/web/staff-workbench.js'), 'utf8')
  check('D91 网页薪资卡:月切换取数走 ?month=(引号界定)', wbJs.includes('`/admin/salary/my-estimate${st.salMonth ? `?month=${st.salMonth}` : \'\'}`'))
  check('D91 网页薪资卡:前后箭头控件在(属性界定)', wbJs.includes('data-swb-mprev type="button"') && wbJs.includes('data-swb-mnext type="button"'))
  check('D91 网页薪资卡:未来月钉死(next > cur 即拦)', wbJs.includes('if (next > cur) return'))
  const mpJs = rfs91(j91(R91, 'miniprogram/pages/merchant/my-performance/index.js'), 'utf8')
  const mpWxml = rfs91(j91(R91, 'miniprogram/pages/merchant/my-performance/index.wxml'), 'utf8')
  check('D91 小程序薪资卡:月切换取数走 ?month=(模板串界定)', mpJs.includes('`/admin/salary/my-estimate${isCur ? \'\' : `?month=${month}`}`'))
  check('D91 小程序薪资卡:monthbar 形制(bindtap 属性界定)', mpWxml.includes('bindtap="salPrevMonth"') && mpWxml.includes('bindtap="salNextMonth"'))
  check('D91 小程序薪资卡:未来月钉死 + 当月基准=storeMonth(门店时区)', mpJs.includes('if (next > cur) return') && mpJs.includes('const cur = storeMonth()'))
  const qsPutStaff = await request('/admin/quote-settings', { method: 'PUT', body: JSON.stringify({ gapHours: 5 }) }, STAFF)
  check('裁定1 员工改报价设置=403(老板权限,后端最终闸)', qsPutStaff.status === 403, String(qsPutStaff.status))
  const qsGetStaff = await request('/admin/quote-settings', {}, STAFF)
  check('裁定1 员工可读报价设置(工作台横幅要用同一份数)', qsGetStaff.status === 200 && qsGetStaff.data.gapHours >= 1)
  // 「客服与报价」设置行(31q 裁定1):网页行+模块挂载+工作台横幅角同端捷径
  const html91 = rfs91(j91(R91, 'apps/web/admin.html'), 'utf8')
  const qsJs = rfs91(j91(R91, 'apps/web/quote-settings.js'), 'utf8')
  const deskJs = rfs91(j91(R91, 'apps/web/ai-desk.js'), 'utf8')
  const adminJs91 = rfs91(j91(R91, 'apps/web/admin.js'), 'utf8')
  check('裁定1 门店设置有「客服与报价」行(id 属性界定)', html91.includes('id="quoteSettingsBody"') && html91.includes('id="quoteSettingsTitle"'))
  check('裁定1 quote-settings 模块读写唯一口(引号界定)', qsJs.includes("request('/admin/quote-settings')") && qsJs.includes("request('/admin/quote-settings', { method: 'PUT'"))
  check('裁定1 admin.js 挂载设置行', adminJs91.includes("window.QuoteSettings.mount(document.querySelector('#quoteSettingsBody')"))
  check('裁定1 工作台横幅角同端捷径=同一表单弹层(属性界定)', deskJs.includes('data-quote-settings') && deskJs.includes('window.QuoteSettings.openModal'))

  console.log(`[staff-portal] all ${checks} checks passed`)
}

main().catch((error) => {
  console.error('[staff-portal] failed:', error.message)
  process.exit(1)
})
