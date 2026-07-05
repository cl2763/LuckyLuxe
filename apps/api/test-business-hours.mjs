const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const TOKEN = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'

let checks = 0

function check(name, condition, detail = '') {
  checks += 1
  if (!condition) {
    throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  }
  console.log(`ok ${checks} - ${name}`)
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
      ...(options.headers || {})
    }
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }
  return { status: response.status, data }
}

function defaultHours() {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    openTime: '10:00',
    closeTime: '19:00',
    isClosed: weekday === 1
  }))
}

async function main() {
  // 1. GET returns store hours
  const initial = await request('/admin/business-hours')
  check('GET /admin/business-hours returns 200', initial.status === 200)
  const store = initial.data.stores?.[0]
  check('at least one store with 7 weekday rows', store && store.hours?.length === 7)
  check('hoursText present in zh and en', Boolean(store.hoursText?.zh && store.hoursText?.en))

  // 2. PUT updates hours (close Wednesday, shorten Saturday) and takes effect immediately
  const updated = defaultHours().map((entry) => {
    if (entry.weekday === 3) return { ...entry, isClosed: true }
    if (entry.weekday === 6) return { ...entry, openTime: '11:00', closeTime: '16:00' }
    return entry
  })
  const put = await request('/admin/business-hours', {
    method: 'PUT',
    body: JSON.stringify({ storeId: store.id, hours: updated })
  })
  check('PUT /admin/business-hours returns 200', put.status === 200, JSON.stringify(put.data).slice(0, 300))
  const wednesday = put.data.hours.find((row) => row.weekday === 3)
  const saturday = put.data.hours.find((row) => row.weekday === 6)
  check('Wednesday saved as closed', wednesday?.isClosed === true)
  check('Saturday saved as 11:00-16:00', saturday?.openTime === '11:00' && saturday?.closeTime === '16:00')
  check('update is audited (updatedAt/updatedBy)', Boolean(wednesday.updatedAt && wednesday.updatedBy))
  check('hoursText reflects new schedule', /11:00-16:00/.test(put.data.hoursText.zh), put.data.hoursText.zh)
  check('hoursText mentions closed Wednesday', /周三休息|周三/.test(put.data.hoursText.zh), put.data.hoursText.zh)

  // 3. Validation guards
  const badTime = await request('/admin/business-hours', {
    method: 'PUT',
    body: JSON.stringify({ storeId: store.id, hours: [{ weekday: 2, openTime: '25:00', closeTime: '19:00', isClosed: false }] })
  })
  check('rejects invalid time format', badTime.status === 400)
  const badRange = await request('/admin/business-hours', {
    method: 'PUT',
    body: JSON.stringify({ storeId: store.id, hours: [{ weekday: 2, openTime: '18:00', closeTime: '10:00', isClosed: false }] })
  })
  check('rejects open >= close', badRange.status === 400)
  const badWeekday = await request('/admin/business-hours', {
    method: 'PUT',
    body: JSON.stringify({ storeId: store.id, hours: [{ weekday: 9, openTime: '10:00', closeTime: '19:00', isClosed: false }] })
  })
  check('rejects invalid weekday', badWeekday.status === 400)

  // 4. Availability respects updated hours: closed Wednesday has no slots
  const nextWednesday = (() => {
    const now = Date.now()
    for (let i = 1; i <= 7; i += 1) {
      const candidate = new Date(now + i * 86400000)
      if (candidate.getUTCDay() === 3) return candidate.toISOString().slice(0, 10)
    }
    return null
  })()
  const availability = await request(`/availability?storeId=${store.id}&serviceId=nail-care-01&date=${nextWednesday}`)
  check('closed Wednesday exposes no bookable slots', availability.status === 200 && (availability.data.slots || []).length === 0, JSON.stringify(availability.data).slice(0, 200))

  // 5a. Simulator channel: new customer asking store hours must NOT get the nail intake template
  const chatReply = await request('/admin/wechat/mock-chat-message', {
    method: 'POST',
    body: JSON.stringify({
      externalUserId: `bh-test-${Date.now().toString(36)}`,
      message: '请问你们门店的营业时间是什么时候？地址在哪里？',
      customerType: 'new',
      memberTier: 'silver',
      lang: 'zh',
      forceAi: true
    })
  })
  const chatIntent = chatReply.data?.reply?.data?.intent || ''
  const chatAnswer = chatReply.data?.reply?.data?.answerZh || ''
  check('store-hours question does not trigger intake template', chatIntent !== 'nail_intake_template' && chatIntent !== 'lash_intake_template', `intent=${chatIntent}`)
  check('store-hours chat answer mentions updated hours', /11:00-16:00|周三休息/.test(chatAnswer), chatAnswer.slice(0, 200))

  // 5b. Web customer-service channel reflects live settings too
  const aiReply = await request('/ai/customer-service', {
    method: 'POST',
    body: JSON.stringify({
      lang: 'zh',
      message: '请问你们门店的营业时间是什么时候？地址在哪里？'
    })
  })
  check('mock chat responds ok', aiReply.status >= 200 && aiReply.status < 300, `status=${aiReply.status} ${JSON.stringify(aiReply.data).slice(0, 300)}`)
  const replyText = JSON.stringify(aiReply.data)
  check('AI reply reflects updated Saturday hours or closed Wednesday', /11:00-16:00|周三休息/.test(replyText), replyText.slice(0, 400))

  // 6. Restore default hours so other regression tests stay deterministic
  const restore = await request('/admin/business-hours', {
    method: 'PUT',
    body: JSON.stringify({ storeId: store.id, hours: defaultHours() })
  })
  check('restore default hours', restore.status === 200 && /10:00-19:00/.test(restore.data.hoursText.zh))

  console.log(`[business-hours] all ${checks} checks passed`)
}

main().catch((error) => {
  console.error('[business-hours] failed:', error.message)
  process.exit(1)
})
