import 'dotenv/config'
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

process.env.TZ = process.env.APP_TIMEZONE || 'America/Toronto'

const { Pool } = pg
const __dirname = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = join(__dirname, '..', '..')
const webRoot = join(workspaceRoot, 'apps', 'web')
const assetRoot = join(workspaceRoot, 'miniprogram', 'assets')
const PORT = Number(process.env.PORT || 4000)
const OWNER_TOKEN = process.env.OWNER_DEMO_TOKEN || 'owner-demo-token'
const HOLD_MINUTES = Number(process.env.BOOKING_HOLD_MINUTES || 15)
const SLOT_MINUTES = 30
const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL || !DATABASE_URL.startsWith('postgresql://')) {
  throw new Error('Supabase server requires DATABASE_URL to be a PostgreSQL connection string.')
}

const pgConnectionUrl = new URL(DATABASE_URL)
pgConnectionUrl.searchParams.delete('sslmode')

const pool = new Pool({
  connectionString: pgConnectionUrl.toString(),
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX || 8)
})

const addOns = [
  { id: 'remove', name: '卸甲/卸睫', priceCents: 3000, durationMin: 30 },
  { id: 'reinforce', name: '甲面加固', priceCents: 4000, durationMin: 15 },
  { id: 'senior', name: '指定资深技师', priceCents: 6000, durationMin: 0 },
  { id: 'extend', name: '延长加项时间', priceCents: 5000, durationMin: 30 }
]

function json(res, statusCode, body) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization'
  })
  res.end(JSON.stringify(body))
}

function contentType(filePath) {
  const ext = extname(filePath)
  if (ext === '.html') return 'text/html; charset=utf-8'
  if (ext === '.css') return 'text/css; charset=utf-8'
  if (ext === '.js') return 'application/javascript; charset=utf-8'
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.svg') return 'image/svg+xml'
  return 'application/octet-stream'
}

function serveFile(res, baseDir, requestPath, fallback = 'index.html') {
  const cleaned = normalize(decodeURIComponent(requestPath))
    .replace(/^[/\\]+/, '')
    .replace(/^(\.\.(\/|\\|$))+/, '')
  const candidate = join(baseDir, cleaned)
  const filePath = existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(baseDir, fallback)
  if (!existsSync(filePath)) return false
  res.writeHead(200, { 'content-type': contentType(filePath) })
  res.end(readFileSync(filePath))
  return true
}

async function readBody(req) {
  let body = ''
  for await (const chunk of req) body += chunk
  if (!body) return {}
  try {
    return JSON.parse(body)
  } catch {
    throw apiError(400, 'BAD_REQUEST', 'Request body must be valid JSON.')
  }
}

function apiError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function requireOwner(req) {
  if (req.headers.authorization !== `Bearer ${OWNER_TOKEN}`) throw apiError(401, 'UNAUTHORIZED', 'Owner token is required.')
}

function cents(centsValue) {
  return Number((centsValue / 100).toFixed(2))
}

function parseJson(value) {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return value
  try {
    return JSON.parse(value || '[]')
  } catch {
    return []
  }
}

function bool(value) {
  return value === true || value === 1 || value === '1'
}

function serializeService(row, lang = 'zh') {
  return {
    id: row.id,
    type: row.type.toLowerCase(),
    category: row.category,
    name: lang === 'en' ? row.name_en : row.name_zh,
    nameZh: row.name_zh,
    nameEn: row.name_en,
    description: lang === 'en' ? row.description_en : row.description_zh,
    descriptionZh: row.description_zh,
    descriptionEn: row.description_en,
    imageUrl: row.image_url,
    price: cents(row.price_cents),
    priceCents: row.price_cents,
    deposit: cents(row.deposit_cents),
    depositCents: row.deposit_cents,
    durationMin: row.base_duration_min,
    process: parseJson(row.process_json),
    notice: parseJson(row.notice_json),
    sortOrder: row.sort_order,
    isActive: bool(row.is_active)
  }
}

function serializeUser(user) {
  if (!user) return null
  return {
    id: user.id,
    displayName: user.display_name,
    phone: user.phone,
    email: user.email,
    provider: user.google_id ? 'google' : user.wechat_open_id ? 'wechat' : 'email',
    memberLevel: 'Gold Member',
    growthValue: 1280,
    nextLevelValue: 2000,
    points: 1280,
    couponCount: 2,
    balanceCents: 30000,
    totalSpentCents: 86000,
    visits: 6
  }
}

async function serializeBooking(row, lang = 'zh') {
  const [serviceResult, userResult, technicianResult, storeResult, paymentsResult] = await Promise.all([
    query('SELECT * FROM services WHERE id = $1', [row.service_id]),
    row.user_id ? query('SELECT id, display_name, phone, email, wechat_open_id, google_id FROM users WHERE id = $1', [row.user_id]) : Promise.resolve({ rows: [] }),
    query('SELECT * FROM technicians WHERE id = $1', [row.technician_id]),
    query('SELECT * FROM stores WHERE id = $1', [row.store_id]),
    query('SELECT * FROM payments WHERE booking_id = $1 ORDER BY created_at DESC', [row.id])
  ])
  const service = serviceResult.rows[0]
  const startLocal = localParts(row.appointment_start)
  const endLocal = localParts(row.appointment_end)
  return {
    id: row.id,
    publicCode: row.public_code,
    status: row.status,
    appointmentStart: iso(row.appointment_start),
    appointmentEnd: iso(row.appointment_end),
    appointmentDate: startLocal.date,
    appointmentTime: startLocal.time,
    appointmentEndTime: endLocal.time,
    addOns: parseJson(row.addons_json),
    notes: row.notes,
    servicePrice: cents(row.service_price_cents),
    servicePriceCents: row.service_price_cents,
    deposit: cents(row.deposit_cents),
    depositCents: row.deposit_cents,
    finalDue: cents(row.final_due_cents),
    finalDueCents: row.final_due_cents,
    totalDurationMin: row.total_duration_min,
    paymentExpiresAt: row.payment_expires_at ? iso(row.payment_expires_at) : null,
    cancellationFeeCents: row.cancellation_fee_cents,
    service: service ? serializeService(service, lang) : null,
    user: userResult.rows[0] || null,
    technician: technicianResult.rows[0],
    store: storeResult.rows[0],
    payments: paymentsResult.rows,
    createdAt: iso(row.created_at)
  }
}

function localParts(dateLike) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date(dateLike))
  const get = (type) => parts.find((part) => part.type === type)?.value
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`
  }
}

function minutesFromTime(time) {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function timeFromMinutes(total) {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function localDateTime(date, time) {
  return new Date(`${date}T${time}:00`)
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60_000)
}

function buildSlotStarts(start, durationMin) {
  const slots = []
  for (let offset = 0; offset < durationMin; offset += SLOT_MINUTES) slots.push(addMinutes(start, offset))
  return slots
}

function totalDuration(type, baseDurationMin, bookingAddOns = []) {
  if (type === 'LASH') return 120
  return Math.max(120, baseDurationMin) + bookingAddOns.reduce((total, item) => total + Number(item.durationMin || 0), 0)
}

function publicCode() {
  return `LL${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 90 + 10)}`
}

function randomId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function iso(date) {
  return new Date(date).toISOString()
}

function query(text, params = []) {
  return pool.query(text, params)
}

async function withTransaction(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function getService(id, client = pool) {
  const result = await client.query('SELECT * FROM services WHERE id = $1', [id])
  return result.rows[0]
}

async function expireOldHolds() {
  const expired = await query("SELECT * FROM bookings WHERE status = 'PENDING_PAYMENT' AND payment_expires_at < now()")
  for (const booking of expired.rows) {
    await withTransaction(async (client) => {
      await client.query('DELETE FROM booking_slots WHERE booking_id = $1', [booking.id])
      await client.query("UPDATE bookings SET status = 'EXPIRED', updated_at = now() WHERE id = $1", [booking.id])
      await client.query(
        'INSERT INTO booking_status_history (id, booking_id, from_status, to_status, note) VALUES ($1, $2, $3, $4, $5)',
        [randomId('hist'), booking.id, booking.status, 'EXPIRED', 'Payment hold expired automatically.']
      )
    })
  }
}

function validateBookingInput(body) {
  for (const key of ['storeId', 'serviceId', 'technicianId', 'date', 'time']) {
    if (!body[key]) throw apiError(400, 'BAD_REQUEST', `${key} is required.`)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) throw apiError(400, 'BAD_REQUEST', 'date must be YYYY-MM-DD.')
  if (!/^\d{2}:\d{2}$/.test(body.time)) throw apiError(400, 'BAD_REQUEST', 'time must be HH:mm.')
  return {
    userId: body.userId || null,
    storeId: body.storeId,
    serviceId: body.serviceId,
    technicianId: body.technicianId,
    date: body.date,
    time: body.time,
    addOns: Array.isArray(body.addOns) ? body.addOns : [],
    notes: body.notes || null
  }
}

async function assertBookable(input, client = pool) {
  const service = await getService(input.serviceId, client)
  if (!service || !service.is_active) throw apiError(404, 'NOT_FOUND', 'Service is not available.')
  const techResult = await client.query(`
    SELECT t.* FROM technicians t
    JOIN technician_services ts ON ts.technician_id = t.id
    WHERE t.id = $1 AND t.store_id = $2 AND t.is_active = true AND ts.service_id = $3
  `, [input.technicianId, input.storeId, input.serviceId])
  if (!techResult.rows[0]) throw apiError(404, 'NOT_FOUND', 'Technician cannot perform this service at this store.')

  const weekday = localDateTime(input.date, '12:00').getDay()
  const hours = await client.query('SELECT * FROM business_hours WHERE store_id = $1 AND weekday = $2', [input.storeId, weekday])
  if (!hours.rows[0] || hours.rows[0].is_closed) throw apiError(400, 'BAD_REQUEST', 'Store is closed on this date.')
  const schedule = await client.query('SELECT * FROM technician_schedules WHERE technician_id = $1 AND date = $2', [input.technicianId, input.date])
  if (schedule.rows[0] && !schedule.rows[0].is_working) throw apiError(400, 'BAD_REQUEST', 'Technician is not working on this date.')

  const openTime = schedule.rows[0]?.start_time || hours.rows[0].open_time
  const closeTime = schedule.rows[0]?.end_time || hours.rows[0].close_time
  const durationMin = totalDuration(service.type, service.base_duration_min, input.addOns)
  const startMinutes = minutesFromTime(input.time)
  const endMinutes = startMinutes + durationMin
  if (startMinutes < minutesFromTime(openTime) || endMinutes > minutesFromTime(closeTime)) {
    throw apiError(400, 'BAD_REQUEST', 'Requested time is outside available working hours.')
  }

  const start = localDateTime(input.date, input.time)
  return { service, durationMin, start, end: addMinutes(start, durationMin) }
}

async function getAvailability(queryParams) {
  const { storeId, serviceId, date, technicianId } = queryParams
  if (!storeId || !serviceId || !date) throw apiError(400, 'BAD_REQUEST', 'storeId, serviceId and date are required.')
  const service = await getService(serviceId)
  if (!service) throw apiError(404, 'NOT_FOUND', 'Service not found.')
  const weekday = localDateTime(date, '12:00').getDay()
  const hours = await query('SELECT * FROM business_hours WHERE store_id = $1 AND weekday = $2', [storeId, weekday])
  const extraDurationMin = Math.max(0, Number(queryParams.extraDurationMin || 0))
  const durationMin = totalDuration(service.type, service.base_duration_min, [{ durationMin: extraDurationMin }])
  if (!hours.rows[0] || hours.rows[0].is_closed) return { date, durationMin, slots: [] }

  const techParams = technicianId ? [storeId, serviceId, technicianId] : [storeId, serviceId]
  const techRows = await query(`
    SELECT DISTINCT t.* FROM technicians t
    JOIN technician_services ts ON ts.technician_id = t.id
    WHERE t.store_id = $1 AND t.is_active = true AND ts.service_id = $2 ${technicianId ? 'AND t.id = $3' : ''}
    ORDER BY t.name ASC
  `, techParams)
  const result = []
  for (const tech of techRows.rows) {
    const schedule = await query('SELECT * FROM technician_schedules WHERE technician_id = $1 AND date = $2', [tech.id, date])
    if (schedule.rows[0] && !schedule.rows[0].is_working) continue
    const openTime = schedule.rows[0]?.start_time || hours.rows[0].open_time
    const closeTime = schedule.rows[0]?.end_time || hours.rows[0].close_time
    const dayStart = localDateTime(date, '00:00')
    const dayEnd = addMinutes(dayStart, 24 * 60)
    const occupiedRows = await query('SELECT starts_at FROM booking_slots WHERE technician_id = $1 AND starts_at >= $2 AND starts_at < $3', [tech.id, iso(dayStart), iso(dayEnd)])
    const occupied = new Set(occupiedRows.rows.map((row) => iso(row.starts_at)))
    const slots = []
    for (let startMin = minutesFromTime(openTime); startMin + durationMin <= minutesFromTime(closeTime); startMin += SLOT_MINUTES) {
      const time = timeFromMinutes(startMin)
      const required = buildSlotStarts(localDateTime(date, time), durationMin).map(iso)
      if (required.every((slot) => !occupied.has(slot))) slots.push(time)
    }
    result.push({ technician: tech, slots })
  }
  return { date, durationMin, slots: result }
}

async function registerEmailUser(body) {
  const email = String(body.email || '').trim().toLowerCase()
  const displayName = String(body.displayName || '').trim() || email.split('@')[0] || 'Lucky Member'
  if (!email || !email.includes('@')) throw apiError(400, 'BAD_REQUEST', 'A valid email is required.')
  const existing = await query('SELECT * FROM users WHERE email = $1', [email])
  if (existing.rows[0]) return serializeUser(existing.rows[0])
  const id = randomId('user')
  await query('INSERT INTO users (id, display_name, email) VALUES ($1, $2, $3)', [id, displayName, email])
  const created = await query('SELECT * FROM users WHERE id = $1', [id])
  return serializeUser(created.rows[0])
}

async function registerGoogleDemoUser(body) {
  const email = String(body.email || 'google.demo@luckyluxe.local').trim().toLowerCase()
  const displayName = String(body.displayName || 'Google Member').trim()
  const googleId = `demo-google-${email}`
  const existing = await query('SELECT * FROM users WHERE google_id = $1 OR email = $2', [googleId, email])
  if (existing.rows[0]) return serializeUser(existing.rows[0])
  const id = randomId('user')
  await query('INSERT INTO users (id, display_name, email, google_id) VALUES ($1, $2, $3, $4)', [id, displayName, email, googleId])
  const created = await query('SELECT * FROM users WHERE id = $1', [id])
  return serializeUser(created.rows[0])
}

async function createBooking(body) {
  await expireOldHolds()
  const input = validateBookingInput(body)
  const bookingId = randomId('booking')
  await withTransaction(async (client) => {
    const { service, durationMin, start, end } = await assertBookable(input, client)
    const slots = buildSlotStarts(start, durationMin)
    const addOnTotal = input.addOns.reduce((total, item) => total + Number(item.priceCents || 0), 0)
    const servicePriceCents = service.price_cents + addOnTotal
    const depositCents = 5000

    await client.query(`
      INSERT INTO bookings
      (id, public_code, user_id, store_id, technician_id, service_id, status, appointment_start, appointment_end, addons_json, notes, service_price_cents, deposit_cents, final_due_cents, total_duration_min, payment_expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15, now() + ($16::int * interval '1 minute'))
    `, [bookingId, publicCode(), input.userId, input.storeId, input.technicianId, input.serviceId, 'PENDING_PAYMENT', iso(start), iso(end), JSON.stringify(input.addOns), input.notes, servicePriceCents, depositCents, servicePriceCents - depositCents, durationMin, HOLD_MINUTES])

    for (const slot of slots) {
      await client.query('INSERT INTO booking_slots (id, booking_id, technician_id, starts_at) VALUES ($1, $2, $3, $4)', [randomId('slot'), bookingId, input.technicianId, iso(slot)])
    }

    await client.query('INSERT INTO payments (id, booking_id, provider, status, amount_cents, currency) VALUES ($1, $2, $3, $4, $5, $6)', [randomId('pay'), bookingId, 'MOCK', 'REQUIRES_PAYMENT', depositCents, 'CAD'])
    await client.query('INSERT INTO booking_status_history (id, booking_id, to_status, note) VALUES ($1, $2, $3, $4)', [randomId('hist'), bookingId, 'PENDING_PAYMENT', 'Booking hold created pending deposit payment.'])
  }).catch((error) => {
    if (error.code === '23505') throw apiError(409, 'SLOT_UNAVAILABLE', 'This technician and time slot was just taken.')
    throw error
  })

  const row = await query('SELECT * FROM bookings WHERE id = $1', [bookingId])
  return serializeBooking(row.rows[0])
}

async function confirmMockPayment(body) {
  await expireOldHolds()
  const bookingId = body.bookingId
  if (!bookingId) throw apiError(400, 'BAD_REQUEST', 'bookingId is required.')
  const existing = await query('SELECT * FROM bookings WHERE id = $1', [bookingId])
  const booking = existing.rows[0]
  if (!booking) throw apiError(404, 'NOT_FOUND', 'Booking not found.')
  if (booking.status !== 'PENDING_PAYMENT') throw apiError(400, 'BAD_REQUEST', 'Only pending bookings can be paid.')
  if (new Date(booking.payment_expires_at) < new Date()) throw apiError(400, 'BAD_REQUEST', 'Payment hold has expired.')

  await withTransaction(async (client) => {
    await client.query("UPDATE payments SET status = 'PAID', transaction_id = $1, updated_at = now() WHERE booking_id = $2 AND provider = 'MOCK'", [`mock_${Date.now()}`, bookingId])
    await client.query("UPDATE bookings SET status = 'CONFIRMED', updated_at = now() WHERE id = $1", [bookingId])
    await client.query('INSERT INTO booking_status_history (id, booking_id, from_status, to_status, note) VALUES ($1, $2, $3, $4, $5)', [randomId('hist'), bookingId, 'PENDING_PAYMENT', 'CONFIRMED', 'Mock deposit payment confirmed.'])
  })

  const row = await query('SELECT * FROM bookings WHERE id = $1', [bookingId])
  return serializeBooking(row.rows[0])
}

async function cancelBooking(id, body) {
  const existing = await query('SELECT * FROM bookings WHERE id = $1', [id])
  const booking = existing.rows[0]
  if (!booking) throw apiError(404, 'NOT_FOUND', 'Booking not found.')
  if (!['PENDING_PAYMENT', 'CONFIRMED'].includes(booking.status)) throw apiError(400, 'BAD_REQUEST', 'This booking cannot be cancelled.')
  const hoursBefore = (new Date(booking.appointment_start).getTime() - Date.now()) / 3_600_000
  const cancellationFeeCents = hoursBefore >= 24 ? 0 : Math.floor(booking.deposit_cents / 2)

  await withTransaction(async (client) => {
    await client.query('DELETE FROM booking_slots WHERE booking_id = $1', [id])
    await client.query("UPDATE bookings SET status = 'CANCELLED', cancelled_at = now(), cancellation_fee_cents = $1, updated_at = now() WHERE id = $2", [cancellationFeeCents, id])
    await client.query('INSERT INTO booking_status_history (id, booking_id, from_status, to_status, note) VALUES ($1, $2, $3, $4, $5)', [randomId('hist'), id, booking.status, 'CANCELLED', body.reason || 'Customer cancelled booking.'])
  })
  const row = await query('SELECT * FROM bookings WHERE id = $1', [id])
  return {
    booking: await serializeBooking(row.rows[0]),
    refundPolicy: {
      hoursBefore,
      cancellationFeeCents,
      refundableDepositCents: booking.deposit_cents - cancellationFeeCents
    }
  }
}

async function route(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {})
  const url = new URL(req.url, `http://${req.headers.host}`)
  const path = url.pathname
  const queryParams = Object.fromEntries(url.searchParams.entries())

  if (req.method === 'GET' && path === '/') return serveFile(res, webRoot, 'index.html')
  if (req.method === 'GET' && path === '/admin') return serveFile(res, webRoot, 'admin.html')
  if (req.method === 'GET' && path.startsWith('/web/')) return serveFile(res, webRoot, path.replace('/web/', ''))
  if (req.method === 'GET' && path.startsWith('/assets/')) return serveFile(res, assetRoot, path.replace('/assets/', ''))

  if (req.method === 'GET' && path === '/health') return json(res, 200, { ok: true, service: 'lucky-luxe-api-supabase', db: 'supabase-postgres', time: iso(new Date()) })
  if (req.method === 'POST' && path === '/auth/email/register') return json(res, 201, { user: await registerEmailUser(await readBody(req)) })
  if (req.method === 'POST' && path === '/auth/google/demo') return json(res, 201, { user: await registerGoogleDemoUser(await readBody(req)) })
  if (req.method === 'GET' && path.startsWith('/users/')) {
    const user = await query('SELECT * FROM users WHERE id = $1', [path.split('/')[2]])
    if (!user.rows[0]) throw apiError(404, 'NOT_FOUND', 'User not found.')
    return json(res, 200, { user: serializeUser(user.rows[0]) })
  }
  if (req.method === 'GET' && path === '/stores') {
    const stores = await query('SELECT * FROM stores WHERE is_active = true ORDER BY name ASC')
    return json(res, 200, { stores: stores.rows })
  }
  if (req.method === 'GET' && path === '/services') {
    const params = []
    let sql = 'SELECT * FROM services WHERE is_active = true'
    if (queryParams.type) {
      params.push(queryParams.type.toUpperCase())
      sql += ` AND type = $${params.length}`
    }
    sql += ' ORDER BY type ASC, sort_order ASC'
    const services = await query(sql, params)
    return json(res, 200, { services: services.rows.map((service) => serializeService(service, queryParams.lang || 'zh')) })
  }
  if (req.method === 'GET' && path === '/technicians') {
    const params = []
    let sql = 'SELECT DISTINCT t.* FROM technicians t LEFT JOIN technician_services ts ON ts.technician_id = t.id WHERE t.is_active = true'
    if (queryParams.storeId) {
      params.push(queryParams.storeId)
      sql += ` AND t.store_id = $${params.length}`
    }
    if (queryParams.serviceId) {
      params.push(queryParams.serviceId)
      sql += ` AND ts.service_id = $${params.length}`
    }
    sql += ' ORDER BY t.name ASC'
    const technicians = await query(sql, params)
    return json(res, 200, { technicians: technicians.rows })
  }
  if (req.method === 'GET' && path === '/add-ons') return json(res, 200, { addOns })
  if (req.method === 'GET' && path === '/availability') {
    await expireOldHolds()
    return json(res, 200, await getAvailability(queryParams))
  }
  if (req.method === 'POST' && path === '/bookings') return json(res, 201, { booking: await createBooking(await readBody(req)) })
  if (req.method === 'POST' && path === '/payments/mock/confirm') return json(res, 200, { booking: await confirmMockPayment(await readBody(req)) })
  if (req.method === 'GET' && path.startsWith('/bookings/')) {
    const id = path.split('/')[2]
    const booking = await query('SELECT * FROM bookings WHERE id = $1', [id])
    if (!booking.rows[0]) throw apiError(404, 'NOT_FOUND', 'Booking not found.')
    return json(res, 200, { booking: await serializeBooking(booking.rows[0], queryParams.lang || 'zh') })
  }
  if (req.method === 'POST' && path.startsWith('/bookings/') && path.endsWith('/cancel')) {
    return json(res, 200, await cancelBooking(path.split('/')[2], await readBody(req)))
  }
  if (path.startsWith('/admin/')) requireOwner(req)
  if (req.method === 'GET' && path === '/admin/bookings') {
    const rows = await query('SELECT * FROM bookings ORDER BY appointment_start DESC')
    return json(res, 200, { bookings: await Promise.all(rows.rows.map((booking) => serializeBooking(booking))) })
  }
  if (req.method === 'GET' && path === '/admin/services') {
    const services = await query('SELECT * FROM services ORDER BY type ASC, sort_order ASC')
    return json(res, 200, { services: services.rows.map((service) => serializeService(service)) })
  }
  if (req.method === 'GET' && path === '/admin/technicians') {
    const technicians = await query('SELECT * FROM technicians ORDER BY name ASC')
    return json(res, 200, { technicians: technicians.rows })
  }
  if (req.method === 'PATCH' && path.startsWith('/admin/services/')) {
    const id = path.split('/')[3]
    const body = await readBody(req)
    const current = await getService(id)
    if (!current) throw apiError(404, 'NOT_FOUND', 'Service not found.')
    await query(`UPDATE services SET
      name_zh = $1, name_en = $2, description_zh = $3, description_en = $4, price_cents = $5, base_duration_min = $6, is_active = $7, sort_order = $8
      WHERE id = $9`, [
      body.nameZh ?? current.name_zh,
      body.nameEn ?? current.name_en,
      body.descriptionZh ?? current.description_zh,
      body.descriptionEn ?? current.description_en,
      body.priceCents ?? current.price_cents,
      body.baseDurationMin ?? current.base_duration_min,
      body.isActive === undefined ? current.is_active : Boolean(body.isActive),
      body.sortOrder ?? current.sort_order,
      id
    ])
    return json(res, 200, { service: serializeService(await getService(id)) })
  }
  if (req.method === 'PATCH' && path.startsWith('/admin/technicians/') && path.endsWith('/schedule')) {
    const technicianId = path.split('/')[3]
    const body = await readBody(req)
    if (!body.date) throw apiError(400, 'BAD_REQUEST', 'date is required.')
    await query(`INSERT INTO technician_schedules (technician_id, date, start_time, end_time, is_working)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT(technician_id, date) DO UPDATE SET start_time = excluded.start_time, end_time = excluded.end_time, is_working = excluded.is_working`,
      [technicianId, body.date, body.startTime || '10:00', body.endTime || '19:00', body.isWorking === undefined ? true : Boolean(body.isWorking)])
    const schedule = await query('SELECT * FROM technician_schedules WHERE technician_id = $1 AND date = $2', [technicianId, body.date])
    return json(res, 200, { schedule: schedule.rows[0] })
  }
  if (req.method === 'PATCH' && path.startsWith('/admin/bookings/') && path.endsWith('/status')) {
    const id = path.split('/')[3]
    const body = await readBody(req)
    const status = body.status
    if (!['PENDING_PAYMENT', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'AFTER_SALES'].includes(status)) throw apiError(400, 'BAD_REQUEST', 'Invalid status.')
    const booking = await query('SELECT * FROM bookings WHERE id = $1', [id])
    if (!booking.rows[0]) throw apiError(404, 'NOT_FOUND', 'Booking not found.')
    await withTransaction(async (client) => {
      if (['CANCELLED', 'EXPIRED'].includes(status)) await client.query('DELETE FROM booking_slots WHERE booking_id = $1', [id])
      await client.query('UPDATE bookings SET status = $1, updated_at = now() WHERE id = $2', [status, id])
    })
    const updated = await query('SELECT * FROM bookings WHERE id = $1', [id])
    return json(res, 200, { booking: await serializeBooking(updated.rows[0]) })
  }
  throw apiError(404, 'NOT_FOUND', 'Endpoint not found.')
}

await pool.query('SELECT 1')

createServer((req, res) => {
  route(req, res).catch((error) => {
    const status = error.status || 500
    if (status === 500) console.error(error)
    json(res, status, {
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.message || 'Unexpected server error.'
      }
    })
  })
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Lucky Luxe Supabase API running at http://localhost:${PORT}`)
  console.log(`Owner API token: ${OWNER_TOKEN}`)
})
