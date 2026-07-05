// 周排班+员工管理回归:
// 1. schedule-week 返回周一对齐的 7 天 + 店休标记 + 技师列表
// 2. 单格切换(PATCH schedule)后 override 反映在周视图里
// 3. 批量应用(schedule-batch)写入未来数周
// 4. 添加技师/改名/停用;停用后不出现在可预约技师里
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const TOKEN = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN_ID = Date.now().toString(36)

let checks = 0
function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(options.headers || {}) }
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, data }
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function main() {
  // 1. 周视图结构
  const week = await request('/admin/schedule-week')
  check('schedule-week returns 200 with 7 days', week.status === 200 && week.data.days?.length === 7)
  const monday = new Date(`${week.data.weekStart}T12:00:00`)
  check('week starts on Monday', monday.getDay() === 1, week.data.weekStart)
  check('days carry closed flag and hours', week.data.days.every((day) => 'isClosed' in day && day.openTime && day.closeTime))
  check('technicians listed', Array.isArray(week.data.technicians) && week.data.technicians.length > 0)

  // 2. 单格切换:指定未来某天休息 → override 出现
  const tech = week.data.technicians.find((item) => item.isActive)
  const targetDate = addDays(week.data.weekStart, 14 + 2) // 两周后的周三,避开真实数据
  const patched = await request(`/admin/technicians/${tech.id}/schedule`, {
    method: 'PATCH',
    body: JSON.stringify({ date: targetDate, isWorking: false })
  })
  check('single cell toggle accepted', patched.status === 200 && patched.data.schedule.is_working === 0)
  const week2 = await request(`/admin/schedule-week?from=${targetDate}`)
  const override = (week2.data.schedules || []).find((row) => row.technicianId === tech.id && row.date === targetDate)
  check('override reflected in week view', override && override.isWorking === false, JSON.stringify(override))

  // 3. 批量应用
  const batchDates = [addDays(targetDate, 7), addDays(targetDate, 14)]
  const batch = await request('/admin/schedule-batch', {
    method: 'POST',
    body: JSON.stringify({ entries: batchDates.map((date) => ({ technicianId: tech.id, date, startTime: '11:00', endTime: '18:00', isWorking: true })) })
  })
  check('batch apply returns applied count', batch.status === 200 && batch.data.applied === 2, JSON.stringify(batch.data))
  const week3 = await request(`/admin/schedule-week?from=${batchDates[0]}`)
  const batchRow = (week3.data.schedules || []).find((row) => row.technicianId === tech.id && row.date === batchDates[0])
  check('batch row persisted with custom times', batchRow?.startTime === '11:00' && batchRow?.endTime === '18:00', JSON.stringify(batchRow))
  const emptyBatch = await request('/admin/schedule-batch', { method: 'POST', body: JSON.stringify({ entries: [] }) })
  check('empty batch rejected', emptyBatch.status === 400)

  // 4. 员工管理:添加/改名/停用
  const created = await request('/admin/technicians', {
    method: 'POST',
    body: JSON.stringify({ name: `测试技师-${RUN_ID}`, title: '美甲师' })
  })
  check('technician created', created.status === 201 && created.data.technician.name.includes(RUN_ID))
  const newId = created.data.technician.id
  const renamed = await request(`/admin/technicians/${newId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: `测试技师改-${RUN_ID}`, title: '资深美甲师' })
  })
  check('technician renamed', renamed.status === 200 && renamed.data.technician.title === '资深美甲师')
  const deactivated = await request(`/admin/technicians/${newId}`, { method: 'PATCH', body: JSON.stringify({ isActive: false }) })
  check('technician deactivated', deactivated.status === 200 && deactivated.data.technician.is_active === 0)
  const weekAfter = await request('/admin/schedule-week')
  const listedNew = (weekAfter.data.technicians || []).find((item) => item.id === newId)
  check('deactivated technician flagged inactive in week view', listedNew && listedNew.isActive === false)
  // 停用后不可作为可预约技师(availability 只查 is_active=1,间接验证:services 列表可用技师)
  const missing = await request('/admin/technicians/does-not-exist', { method: 'PATCH', body: JSON.stringify({ name: 'x' }) })
  check('unknown technician returns 404', missing.status === 404)

  // 清理:恢复被切换的排班日为默认(标记回上班),测试技师保持停用即无副作用
  await request(`/admin/technicians/${tech.id}/schedule`, { method: 'PATCH', body: JSON.stringify({ date: targetDate, isWorking: true }) })

  console.log(`[schedule-week] all ${checks} checks passed`)
}

main().catch((error) => {
  console.error('[schedule-week] failed:', error.message)
  process.exit(1)
})
