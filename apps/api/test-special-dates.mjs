// 特殊日期回归:
// 1. 设为休息 → 当天可约时段清空;删除后恢复
// 2. 调整时段 → 可约时段落在特殊时段内
// 3. business-hours 返回 specialDates;hoursText 并入"特殊安排"供 AI 引用
// 4. 周排班视图当天标记店休
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const TOKEN = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'

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

function futureDate(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function findOpenFutureDate(storeId, serviceId) {
  // 找一个未来 7-20 天内本来有可约时段的日期,避开每周店休日
  for (let offset = 7; offset <= 20; offset += 1) {
    const date = futureDate(offset)
    const avail = await request(`/availability?storeId=${storeId}&serviceId=${serviceId}&date=${date}`)
    if ((avail.data?.slots || []).some((tech) => (tech.slots || []).length)) return date
  }
  return null
}

async function main() {
  const hoursData = (await request('/admin/business-hours')).data
  const store = hoursData.stores[0]
  const services = (await request('/admin/services')).data.services
  const service = services.find((item) => item.isActive)
  check('store and active service available', Boolean(store && service))

  const date = await findOpenFutureDate(store.id, service.id)
  check('found a future date with open slots', Boolean(date), date || 'none in 7-20 days')

  try {
    // 1. 设为特殊休息 → 时段清空
    const created = await request('/admin/special-dates', {
      method: 'POST',
      body: JSON.stringify({ storeId: store.id, date, isClosed: true, note: '回归测试休息日' })
    })
    check('special closed date saved', created.status === 201 && created.data.specialDate.is_closed === 1)
    const availClosed = await request(`/availability?storeId=${store.id}&serviceId=${service.id}&date=${date}`)
    const closedSlotCount = (availClosed.data?.slots || []).reduce((sum, tech) => sum + (tech.slots || []).length, 0)
    check('closed special date has zero slots', closedSlotCount === 0, String(closedSlotCount))

    // 3a. business-hours 带 specialDates + hoursText 并入特殊安排
    const hoursAfter = (await request('/admin/business-hours')).data.stores[0]
    check('specialDates listed in business-hours', (hoursAfter.specialDates || []).some((row) => row.date === date && row.isClosed))
    check('hoursText mentions special arrangement for AI', String(hoursAfter.hoursText?.zh || '').includes('特殊安排') && String(hoursAfter.hoursText?.zh || '').includes(date), hoursAfter.hoursText?.zh)

    // 4. 周排班视图当天 isClosed
    const week = await request(`/admin/schedule-week?from=${date}`)
    const day = (week.data.days || []).find((item) => item.date === date)
    check('schedule-week marks special date closed', day?.isClosed === true, JSON.stringify(day))

    // 2. 改成调整时段 12:00-15:00 → 时段都在窗口内
    const adjusted = await request('/admin/special-dates', {
      method: 'POST',
      body: JSON.stringify({ storeId: store.id, date, isClosed: false, openTime: '12:00', closeTime: '15:00', note: '回归测试短时段' })
    })
    check('adjusted-hours special date saved', adjusted.status === 201 && adjusted.data.specialDate.is_closed === 0)
    const availAdjusted = await request(`/availability?storeId=${store.id}&serviceId=${service.id}&date=${date}`)
    const allSlots = (availAdjusted.data?.slots || []).flatMap((tech) => tech.slots || [])
    check('slots exist within adjusted window', allSlots.length > 0, JSON.stringify(availAdjusted.data).slice(0, 150))
    check('all slots start no earlier than 12:00', allSlots.every((time) => time >= '12:00'), JSON.stringify(allSlots.slice(0, 5)))
    check('all slots end within 15:00 window', allSlots.every((time) => time < '15:00'), JSON.stringify(allSlots.slice(-3)))

    // 校验非法输入
    const badMode = await request('/admin/special-dates', {
      method: 'POST',
      body: JSON.stringify({ storeId: store.id, date, isClosed: false })
    })
    check('adjusted mode without times rejected', badMode.status === 400)
  } finally {
    // 清理:删除特殊日期,恢复每周固定模式
    const deleted = await request(`/admin/special-dates/${date}?storeId=${encodeURIComponent(store.id)}`, { method: 'DELETE' })
    check('special date deleted', deleted.status === 200)
    const availRestored = await request(`/availability?storeId=${store.id}&serviceId=${service.id}&date=${date}`)
    const restoredCount = (availRestored.data?.slots || []).reduce((sum, tech) => sum + (tech.slots || []).length, 0)
    check('slots restored after delete', restoredCount > 0, String(restoredCount))
  }

  console.log(`[special-dates] all ${checks} checks passed`)
}

main().catch((error) => {
  console.error('[special-dates] failed:', error.message)
  process.exit(1)
})
