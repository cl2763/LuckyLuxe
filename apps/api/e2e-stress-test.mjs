const base = 'http://127.0.0.1:4000'

async function post(path, body) {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  return { status: response.status, body: await response.json() }
}

async function get(path, headers = {}) {
  const response = await fetch(base + path, { headers })
  return { status: response.status, body: await response.json() }
}

function bookingBody(date, time, technicianId = 'tech-mia', serviceId = 'nail-french-01') {
  return {
    userId: 'user-demo',
    storeId: 'store-ontario-01',
    serviceId,
    technicianId,
    date,
    time,
    addOns: [],
    notes: 'api stress test'
  }
}

const stamp = Date.now()
const results = {}

results.health = await get('/health')
results.emailAuth = await post('/auth/email/register', {
  displayName: 'E2E Member',
  email: `e2e-${stamp}@luckyluxe.demo`
})
results.googleAuth = await post('/auth/google/demo', {
  displayName: 'Google E2E',
  email: `google-${stamp}@luckyluxe.demo`
})
results.services = await get('/services?type=nail&lang=en')
results.stores = await get('/stores')
results.availability = await get('/availability?storeId=store-ontario-01&serviceId=nail-french-01&date=2026-08-05&technicianId=tech-mia')

const single = await post('/bookings', bookingBody('2026-08-12', '10:00', 'tech-lina', 'lash-natural-01'))
results.createSingle = {
  status: single.status,
  bookingStatus: single.body.booking?.status,
  duration: single.body.booking?.totalDurationMin
}
const paid = await post('/payments/mock/confirm', { bookingId: single.body.booking?.id })
results.paySingle = {
  status: paid.status,
  bookingStatus: paid.body.booking?.status,
  deposit: paid.body.booking?.depositCents
}
const cancelled = await post(`/bookings/${single.body.booking?.id}/cancel`, { reason: 'e2e cancel policy test' })
results.cancelSingle = {
  status: cancelled.status,
  bookingStatus: cancelled.body.booking?.status,
  fee: cancelled.body.refundPolicy?.cancellationFeeCents
}

const conflictPayload = bookingBody('2026-08-11', '10:00', 'tech-mia', 'nail-french-01')
const conflictResponses = await Promise.all(Array.from({ length: 20 }, () => post('/bookings', conflictPayload)))
results.conflict20 = {
  total: conflictResponses.length,
  created: conflictResponses.filter((item) => item.status === 201).length,
  conflicts: conflictResponses.filter((item) => item.status === 409).length,
  other: conflictResponses
    .filter((item) => ![201, 409].includes(item.status))
    .map((item) => ({ status: item.status, error: item.body.error }))
}

const dates = ['2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09']
const times = ['10:00', '12:00', '14:00', '16:00']
const bulkPayloads = []
for (const date of dates) {
  for (const time of times) {
    bulkPayloads.push(bookingBody(date, time, 'tech-lina', 'nail-jp-01'))
  }
}
const bulkStart = Date.now()
const bulk = await Promise.all(bulkPayloads.map((body) => post('/bookings', body)))
results.bulk20 = {
  total: bulk.length,
  created: bulk.filter((item) => item.status === 201).length,
  errors: bulk.filter((item) => item.status !== 201).map((item) => ({ status: item.status, error: item.body.error?.code })),
  ms: Date.now() - bulkStart
}
const payBulk = await Promise.all(
  bulk
    .filter((item) => item.status === 201)
    .map((item) => post('/payments/mock/confirm', { bookingId: item.body.booking.id }))
)
results.bulkPay = {
  total: payBulk.length,
  paid: payBulk.filter((item) => item.status === 200 && item.body.booking?.status === 'CONFIRMED').length
}

const admin = await get('/admin/bookings', { authorization: 'Bearer owner-demo-token' })
results.admin = {
  status: admin.status,
  totalBookings: admin.body.bookings?.length,
  hasConfirmed: admin.body.bookings?.some((booking) => booking.status === 'CONFIRMED')
}

console.log(JSON.stringify(results, null, 2))
