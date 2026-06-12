import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeReferenceImage, createBookingSummary, createCustomerInsight, createDailyBrief, createSocialCopy } from './ai-utils.mjs'

process.env.TZ = process.env.APP_TIMEZONE || 'America/Toronto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = join(__dirname, '..', '..')
const webRoot = join(workspaceRoot, 'apps', 'web')
const assetRoot = join(workspaceRoot, 'miniprogram', 'assets')
const dataDir = join(__dirname, 'local-data')
mkdirSync(dataDir, { recursive: true })

const db = new DatabaseSync(join(dataDir, 'lucky-luxe.sqlite'))
const PORT = Number(process.env.PORT || 4000)
const OWNER_TOKEN = process.env.OWNER_DEMO_TOKEN || 'owner-demo-token'
const FINANCE_EMAILS = (process.env.FINANCE_EMAILS || 'nini3131254931@gmail.com').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean)
const FINANCE_PASSWORD = process.env.FINANCE_PASSWORD || ''
const HOLD_MINUTES = Number(process.env.BOOKING_HOLD_MINUTES || 15)
const SLOT_MINUTES = 30

const addOns = [
  { id: 'remove', name: '卸甲/卸睫', priceCents: 3000, durationMin: 30 },
  { id: 'reinforce', name: '甲面加固', priceCents: 4000, durationMin: 15 },
  { id: 'senior', name: '指定资深技师', priceCents: 6000, durationMin: 0 },
  { id: 'extend', name: '延长加项时间', priceCents: 5000, durationMin: 30 }
]

const seedServices = [
  ['nail-french-01', 'NAIL', '法式系列', '经典奶油法式', 'Classic Cream French', '柔和奶油底色搭配细线法式边，适合通勤与约会场景。', 'Soft cream base with a delicate French line for daily wear and special dates.', '/assets/images/nail-french.png', 16800, 5000, 120, 1, ['甲型修整', '基础护理', '底色上色', '法式线条', '封层护理'], ['服务前请尽量避免自行修剪过短', '如需卸甲请在预约时勾选加项']],
  ['nail-luxe-01', 'NAIL', '轻奢设计', '柔金贝母设计', 'Soft Gold Shell Design', '贝母片与柔金线条组合，保留高级感，也适合日常穿搭。', 'Mother-of-pearl accents and soft gold lines for an elevated everyday style.', '/assets/images/nail-luxe.png', 23800, 5000, 150, 2, ['甲面护理', '底色铺设', '贝母定位', '金线装饰', '加固封层'], ['复杂设计耗时较长，请预留完整服务时间']],
  ['nail-jp-01', 'NAIL', '日式款', '日式微闪渐变', 'Japanese Shimmer Gradient', '细腻微闪从甲根自然过渡，温柔显白，适合短甲。', 'A subtle shimmer gradient that looks soft, clean, and flattering on short nails.', '/assets/images/nail-jp.png', 19800, 5000, 120, 3, ['手部清洁', '甲型调整', '渐变叠色', '微闪点缀', '封层'], ['渐变色可到店根据肤色调整']],
  ['nail-care-01', 'NAIL', '基础护理', '手部基础护理', 'Basic Hand Care', '修型、软化、死皮护理与营养油养护，适合定期维护。', 'Shape, soften, clean cuticles, and nourish for regular maintenance.', '/assets/images/nail-care.png', 8800, 5000, 120, 4, ['清洁消毒', '修型', '软化护理', '死皮修整', '营养油'], ['此项目不含甲油胶上色']],
  ['lash-natural-01', 'LASH', '自然款', '裸感自然睫', 'Bare Natural Lash', '轻盈自然，放大眼神但保留原生感。', 'Light, natural lashes that open the eyes while keeping a bare-skin look.', '/assets/images/lash-natural.png', 19800, 5000, 120, 1, ['眼型沟通', '清洁隔离', '睫毛嫁接', '梳理定型', '护理说明'], ['服务后 6 小时内尽量避免接触水汽']],
  ['lash-volume-01', 'LASH', '浓密款', '轻盈浓密睫', 'Soft Volume Lash', '在自然舒适的基础上增强存在感，适合拍照和重要场合。', 'Comfortable volume with stronger presence for photos and special occasions.', '/assets/images/lash-volume.png', 26800, 5000, 120, 2, ['眼型设计', '分层嫁接', '密度调整', '梳理检查', '护理说明'], ['敏感眼型请提前备注']]
]

function setupDatabase() {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS stores (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT,
      phone TEXT,
      timezone TEXT NOT NULL,
      currency TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS business_hours (
      store_id TEXT NOT NULL,
      weekday INTEGER NOT NULL,
      open_time TEXT NOT NULL,
      close_time TEXT NOT NULL,
      is_closed INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (store_id, weekday),
      FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS technicians (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      name TEXT NOT NULL,
      title TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      category TEXT NOT NULL,
      name_zh TEXT NOT NULL,
      name_en TEXT NOT NULL,
      description_zh TEXT NOT NULL,
      description_en TEXT NOT NULL,
      image_url TEXT,
      price_cents INTEGER NOT NULL,
      deposit_cents INTEGER NOT NULL,
      base_duration_min INTEGER NOT NULL,
      sort_order INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      process_json TEXT NOT NULL,
      notice_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS technician_services (
      technician_id TEXT NOT NULL,
      service_id TEXT NOT NULL,
      PRIMARY KEY (technician_id, service_id),
      FOREIGN KEY (technician_id) REFERENCES technicians(id) ON DELETE CASCADE,
      FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      wechat_open_id TEXT UNIQUE,
      google_id TEXT UNIQUE
    );
    CREATE TABLE IF NOT EXISTS technician_schedules (
      technician_id TEXT NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      is_working INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (technician_id, date),
      FOREIGN KEY (technician_id) REFERENCES technicians(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      public_code TEXT NOT NULL UNIQUE,
      user_id TEXT,
      store_id TEXT NOT NULL,
      technician_id TEXT NOT NULL,
      service_id TEXT NOT NULL,
      status TEXT NOT NULL,
      appointment_start TEXT NOT NULL,
      appointment_end TEXT NOT NULL,
      addons_json TEXT NOT NULL,
      reference_images_json TEXT NOT NULL DEFAULT '[]',
      work_images_json TEXT NOT NULL DEFAULT '[]',
      approved_work_images_json TEXT NOT NULL DEFAULT '[]',
      gallery_status TEXT NOT NULL DEFAULT 'draft',
      gallery_locked_at TEXT,
      source_channel TEXT,
      notes TEXT,
      service_price_cents INTEGER NOT NULL,
      deposit_cents INTEGER NOT NULL,
      final_due_cents INTEGER NOT NULL,
      total_duration_min INTEGER NOT NULL,
      payment_expires_at TEXT,
      cancelled_at TEXT,
      cancellation_fee_cents INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (store_id) REFERENCES stores(id),
      FOREIGN KEY (technician_id) REFERENCES technicians(id),
      FOREIGN KEY (service_id) REFERENCES services(id)
    );
    CREATE TABLE IF NOT EXISTS booking_slots (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      technician_id TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      UNIQUE (technician_id, starts_at),
      FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
      FOREIGN KEY (technician_id) REFERENCES technicians(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      transaction_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS booking_status_history (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
    );
  `)
}

function seedDatabase() {
  db.prepare('INSERT OR IGNORE INTO stores (id, name, address, phone, timezone, currency) VALUES (?, ?, ?, ?, ?, ?)').run('store-ontario-01', 'Lucky Luxe Ontario', 'Address TBD', 'Phone TBD', 'America/Toronto', 'CAD')
  const hourStmt = db.prepare('INSERT OR IGNORE INTO business_hours (store_id, weekday, open_time, close_time, is_closed) VALUES (?, ?, ?, ?, ?)')
  for (let weekday = 0; weekday <= 6; weekday += 1) hourStmt.run('store-ontario-01', weekday, '10:00', '19:00', weekday === 1 ? 1 : 0)

  const techStmt = db.prepare('INSERT OR IGNORE INTO technicians (id, store_id, name, title) VALUES (?, ?, ?, ?)')
  techStmt.run('tech-mia', 'store-ontario-01', 'Mia Chen', 'Nail Artist')
  techStmt.run('tech-ava', 'store-ontario-01', 'Ava Lin', 'Lash Artist')
  techStmt.run('tech-lina', 'store-ontario-01', 'Lina Zhou', 'Senior Artist')

  const serviceStmt = db.prepare(`INSERT OR IGNORE INTO services
    (id, type, category, name_zh, name_en, description_zh, description_en, image_url, price_cents, deposit_cents, base_duration_min, sort_order, process_json, notice_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  for (const service of seedServices) {
    serviceStmt.run(...service.slice(0, 12), JSON.stringify(service[12]), JSON.stringify(service[13]))
  }

  const assignStmt = db.prepare('INSERT OR IGNORE INTO technician_services (technician_id, service_id) VALUES (?, ?)')
  for (const service of seedServices) {
    const id = service[0]
    const type = service[1]
    if (type === 'NAIL') {
      assignStmt.run('tech-mia', id)
      assignStmt.run('tech-lina', id)
    } else {
      assignStmt.run('tech-ava', id)
      assignStmt.run('tech-lina', id)
    }
  }

  db.prepare('INSERT OR IGNORE INTO users (id, display_name, phone, wechat_open_id) VALUES (?, ?, ?, ?)').run('user-demo', 'Lucky Member', '+1 000 000 0000', 'demo-wechat-openid')
}

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
  const type = contentType(filePath)
  res.writeHead(200, {
    'content-type': type,
    ...(type.startsWith('text/') || type.includes('javascript') ? { 'cache-control': 'no-store' } : {})
  })
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
  try {
    return JSON.parse(value || '[]')
  } catch {
    return []
  }
}

function normalizeReferenceImages(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => typeof item === 'string' && item.startsWith('data:image/'))
    .slice(0, 3)
}

function normalizeWorkImages(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => typeof item === 'string' && item.startsWith('data:image/'))
    .slice(0, 6)
}

function serviceIdFrom(body) {
  const source = String(body.nameEn || body.nameZh || `service-${Date.now()}`)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42) || `service-${Date.now()}`
  return `${String(body.type || 'NAIL').toLowerCase()}-${source}-${Date.now().toString(36)}`
}

function servicePayload(body, current = {}) {
  return {
    type: String(body.type ?? current.type ?? 'NAIL').toUpperCase(),
    category: body.category ?? current.category ?? '未分类',
    nameZh: body.nameZh ?? current.name_zh ?? '',
    nameEn: body.nameEn ?? current.name_en ?? '',
    descriptionZh: body.descriptionZh ?? current.description_zh ?? '',
    descriptionEn: body.descriptionEn ?? current.description_en ?? '',
    imageUrl: body.imageUrl ?? current.image_url ?? '/assets/images/nail-addon.png',
    priceCents: Number(body.priceCents ?? current.price_cents ?? 0),
    depositCents: Number(body.depositCents ?? current.deposit_cents ?? 5000),
    baseDurationMin: Number(body.baseDurationMin ?? current.base_duration_min ?? 120),
    sortOrder: Number(body.sortOrder ?? current.sort_order ?? 0),
    isActive: body.isActive === undefined ? (current.is_active ?? 1) : Number(Boolean(body.isActive)),
    processJson: body.process ?? parseJson(current.process_json),
    noticeJson: body.notice ?? parseJson(current.notice_json)
  }
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
    isActive: Boolean(row.is_active)
  }
}

function serializeBooking(row, lang = 'zh') {
  const service = row.service_id ? getService(row.service_id) : null
  const startLocal = localParts(row.appointment_start)
  const endLocal = localParts(row.appointment_end)
  const user = row.user_id ? db.prepare('SELECT id, display_name, phone, email, wechat_open_id, google_id FROM users WHERE id = ?').get(row.user_id) : null
  return {
    id: row.id,
    publicCode: row.public_code,
    status: row.status,
    appointmentStart: row.appointment_start,
    appointmentEnd: row.appointment_end,
    appointmentDate: startLocal.date,
    appointmentTime: startLocal.time,
    appointmentEndTime: endLocal.time,
    addOns: parseJson(row.addons_json),
    referenceImages: parseJson(row.reference_images_json),
    workImages: parseJson(row.work_images_json),
    approvedWorkImages: parseJson(row.approved_work_images_json),
    galleryStatus: row.gallery_status || 'draft',
    galleryLockedAt: row.gallery_locked_at,
    sourceChannel: row.source_channel || null,
    notes: row.notes,
    servicePrice: cents(row.service_price_cents),
    servicePriceCents: row.service_price_cents,
    deposit: cents(row.deposit_cents),
    depositCents: row.deposit_cents,
    finalDue: cents(row.final_due_cents),
    finalDueCents: row.final_due_cents,
    totalDurationMin: row.total_duration_min,
    paymentExpiresAt: row.payment_expires_at,
    cancellationFeeCents: row.cancellation_fee_cents,
    service: service ? serializeService(service, lang) : null,
    user,
    technician: db.prepare('SELECT * FROM technicians WHERE id = ?').get(row.technician_id),
    store: db.prepare('SELECT * FROM stores WHERE id = ?').get(row.store_id),
    payments: db.prepare('SELECT * FROM payments WHERE booking_id = ? ORDER BY created_at DESC').all(row.id),
    createdAt: row.created_at
  }
}

function serializeUser(user) {
  if (!user) return null
  const memberCode = `LL-${String(user.id).replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase().padStart(8, '0')}`
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
    visits: 6,
    memberCode,
    referralCode: memberCode.replace('LL-', 'REF-'),
    referralUrl: `https://www.luckyluxeatelier.com/?ref=${encodeURIComponent(memberCode.replace('LL-', 'REF-'))}`
  }
}

function registerEmailUser(body) {
  const email = String(body.email || '').trim().toLowerCase()
  const displayName = String(body.displayName || '').trim() || email.split('@')[0] || 'Lucky Member'
  if (!email || !email.includes('@')) throw apiError(400, 'BAD_REQUEST', 'A valid email is required.')
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  if (existing) return serializeUser(existing)
  const id = randomId('user')
  db.prepare('INSERT INTO users (id, display_name, email) VALUES (?, ?, ?)').run(id, displayName, email)
  return serializeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id))
}

function registerGoogleDemoUser(body) {
  const email = String(body.email || 'google.demo@luckyluxe.local').trim().toLowerCase()
  const displayName = String(body.displayName || 'Google Member').trim()
  const googleId = `demo-google-${email}`
  const existing = db.prepare('SELECT * FROM users WHERE google_id = ? OR email = ?').get(googleId, email)
  if (existing) return serializeUser(existing)
  const id = randomId('user')
  db.prepare('INSERT INTO users (id, display_name, email, google_id) VALUES (?, ?, ?, ?)').run(id, displayName, email, googleId)
  return serializeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id))
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

function getService(id) {
  return db.prepare('SELECT * FROM services WHERE id = ?').get(id)
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
  return date.toISOString()
}

function expireOldHolds() {
  const expired = db.prepare("SELECT * FROM bookings WHERE status = 'PENDING_PAYMENT' AND payment_expires_at < ?").all(iso(new Date()))
  for (const booking of expired) {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare('DELETE FROM booking_slots WHERE booking_id = ?').run(booking.id)
      db.prepare("UPDATE bookings SET status = 'EXPIRED', updated_at = ? WHERE id = ?").run(iso(new Date()), booking.id)
      db.prepare('INSERT INTO booking_status_history (id, booking_id, from_status, to_status, note, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(randomId('hist'), booking.id, booking.status, 'EXPIRED', 'Payment hold expired automatically.', iso(new Date()))
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
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
    referenceImages: normalizeReferenceImages(body.referenceImages),
    sourceChannel: body.sourceChannel || body.source || body.channel || null,
    notes: body.notes || null
  }
}

function assertBookable(input) {
  const service = getService(input.serviceId)
  if (!service || !service.is_active) throw apiError(404, 'NOT_FOUND', 'Service is not available.')
  const technician = db.prepare(`
    SELECT t.* FROM technicians t
    JOIN technician_services ts ON ts.technician_id = t.id
    WHERE t.id = ? AND t.store_id = ? AND t.is_active = 1 AND ts.service_id = ?
  `).get(input.technicianId, input.storeId, input.serviceId)
  if (!technician) throw apiError(404, 'NOT_FOUND', 'Technician cannot perform this service at this store.')

  const weekday = localDateTime(input.date, '12:00').getDay()
  const hours = db.prepare('SELECT * FROM business_hours WHERE store_id = ? AND weekday = ?').get(input.storeId, weekday)
  if (!hours || hours.is_closed) throw apiError(400, 'BAD_REQUEST', 'Store is closed on this date.')
  const schedule = db.prepare('SELECT * FROM technician_schedules WHERE technician_id = ? AND date = ?').get(input.technicianId, input.date)
  if (schedule && !schedule.is_working) throw apiError(400, 'BAD_REQUEST', 'Technician is not working on this date.')

  const openTime = schedule?.start_time || hours.open_time
  const closeTime = schedule?.end_time || hours.close_time
  const durationMin = totalDuration(service.type, service.base_duration_min, input.addOns)
  const startMinutes = minutesFromTime(input.time)
  const endMinutes = startMinutes + durationMin
  if (startMinutes < minutesFromTime(openTime) || endMinutes > minutesFromTime(closeTime)) {
    throw apiError(400, 'BAD_REQUEST', 'Requested time is outside available working hours.')
  }

  const start = localDateTime(input.date, input.time)
  return { service, technician, durationMin, start, end: addMinutes(start, durationMin) }
}

function getAvailability(query) {
  const { storeId, serviceId, date, technicianId } = query
  if (!storeId || !serviceId || !date) throw apiError(400, 'BAD_REQUEST', 'storeId, serviceId and date are required.')
  const service = getService(serviceId)
  if (!service) throw apiError(404, 'NOT_FOUND', 'Service not found.')
  const weekday = localDateTime(date, '12:00').getDay()
  const hours = db.prepare('SELECT * FROM business_hours WHERE store_id = ? AND weekday = ?').get(storeId, weekday)
  const extraDurationMin = Math.max(0, Number(query.extraDurationMin || 0))
  const durationMin = totalDuration(service.type, service.base_duration_min, [{ durationMin: extraDurationMin }])
  if (!hours || hours.is_closed) return { date, durationMin, slots: [] }

  const techRows = db.prepare(`
    SELECT t.* FROM technicians t
    JOIN technician_services ts ON ts.technician_id = t.id
    WHERE t.store_id = ? AND t.is_active = 1 AND ts.service_id = ? ${technicianId ? 'AND t.id = ?' : ''}
    ORDER BY t.name ASC
  `).all(...(technicianId ? [storeId, serviceId, technicianId] : [storeId, serviceId]))
  const result = []
  for (const tech of techRows) {
    const schedule = db.prepare('SELECT * FROM technician_schedules WHERE technician_id = ? AND date = ?').get(tech.id, date)
    if (schedule && !schedule.is_working) continue
    const openTime = schedule?.start_time || hours.open_time
    const closeTime = schedule?.end_time || hours.close_time
    const dayStart = iso(localDateTime(date, '00:00'))
    const dayEnd = iso(addMinutes(localDateTime(date, '00:00'), 24 * 60))
    const occupiedRows = db.prepare('SELECT starts_at FROM booking_slots WHERE technician_id = ? AND starts_at >= ? AND starts_at < ?').all(tech.id, dayStart, dayEnd)
    const occupied = new Set(occupiedRows.map((row) => row.starts_at))
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

function createBooking(body) {
  expireOldHolds()
  const input = validateBookingInput(body)
  const { service, durationMin, start, end } = assertBookable(input)
  const bookingId = randomId('booking')
  const now = iso(new Date())
  const slots = buildSlotStarts(start, durationMin)
  const addOnTotal = input.addOns.reduce((total, item) => total + Number(item.priceCents || 0), 0)
  const servicePriceCents = service.price_cents + addOnTotal
  const depositCents = 5000

  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(`
      INSERT INTO bookings
      (id, public_code, user_id, store_id, technician_id, service_id, status, appointment_start, appointment_end, addons_json, reference_images_json, source_channel, notes, service_price_cents, deposit_cents, final_due_cents, total_duration_min, payment_expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(bookingId, publicCode(), input.userId, input.storeId, input.technicianId, input.serviceId, 'PENDING_PAYMENT', iso(start), iso(end), JSON.stringify(input.addOns), JSON.stringify(input.referenceImages), input.sourceChannel, input.notes, servicePriceCents, depositCents, servicePriceCents - depositCents, durationMin, iso(addMinutes(new Date(), HOLD_MINUTES)), now, now)

    const slotStmt = db.prepare('INSERT INTO booking_slots (id, booking_id, technician_id, starts_at) VALUES (?, ?, ?, ?)')
    for (const slot of slots) slotStmt.run(randomId('slot'), bookingId, input.technicianId, iso(slot))

    db.prepare('INSERT INTO payments (id, booking_id, provider, status, amount_cents, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(randomId('pay'), bookingId, 'MOCK', 'REQUIRES_PAYMENT', depositCents, 'CAD', now, now)
    db.prepare('INSERT INTO booking_status_history (id, booking_id, to_status, note, created_at) VALUES (?, ?, ?, ?, ?)').run(randomId('hist'), bookingId, 'PENDING_PAYMENT', 'Booking hold created pending deposit payment.', now)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    if (String(error.message || '').includes('UNIQUE constraint failed')) throw apiError(409, 'SLOT_UNAVAILABLE', 'This technician and time slot was just taken.')
    throw error
  }

  return serializeBooking(db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId))
}

function confirmMockPayment(body) {
  expireOldHolds()
  const bookingId = body.bookingId
  if (!bookingId) throw apiError(400, 'BAD_REQUEST', 'bookingId is required.')
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId)
  if (!booking) throw apiError(404, 'NOT_FOUND', 'Booking not found.')
  if (booking.status !== 'PENDING_PAYMENT') throw apiError(400, 'BAD_REQUEST', 'Only pending bookings can be paid.')
  if (booking.payment_expires_at < iso(new Date())) throw apiError(400, 'BAD_REQUEST', 'Payment hold has expired.')

  const now = iso(new Date())
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare("UPDATE payments SET status = 'PAID', transaction_id = ?, updated_at = ? WHERE booking_id = ? AND provider = 'MOCK'").run(`mock_${Date.now()}`, now, bookingId)
    db.prepare("UPDATE bookings SET status = 'CONFIRMED', updated_at = ? WHERE id = ?").run(now, bookingId)
    db.prepare('INSERT INTO booking_status_history (id, booking_id, from_status, to_status, note, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(randomId('hist'), bookingId, 'PENDING_PAYMENT', 'CONFIRMED', 'Mock deposit payment confirmed.', now)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  return serializeBooking(db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId))
}

function cancelBooking(id, body) {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id)
  if (!booking) throw apiError(404, 'NOT_FOUND', 'Booking not found.')
  if (!['PENDING_PAYMENT', 'CONFIRMED'].includes(booking.status)) throw apiError(400, 'BAD_REQUEST', 'This booking cannot be cancelled.')
  const hoursBefore = (new Date(booking.appointment_start).getTime() - Date.now()) / 3_600_000
  const cancellationFeeCents = hoursBefore >= 24 ? 0 : Math.floor(booking.deposit_cents / 2)
  const now = iso(new Date())

  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('DELETE FROM booking_slots WHERE booking_id = ?').run(id)
    db.prepare("UPDATE bookings SET status = 'CANCELLED', cancelled_at = ?, cancellation_fee_cents = ?, updated_at = ? WHERE id = ?").run(now, cancellationFeeCents, now, id)
    db.prepare('INSERT INTO booking_status_history (id, booking_id, from_status, to_status, note, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(randomId('hist'), id, booking.status, 'CANCELLED', body.reason || 'Customer cancelled booking.', now)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return {
    booking: serializeBooking(db.prepare('SELECT * FROM bookings WHERE id = ?').get(id)),
    refundPolicy: {
      hoursBefore,
      cancellationFeeCents,
      refundableDepositCents: booking.deposit_cents - cancellationFeeCents
    }
  }
}

function getAdminCustomers() {
  return db.prepare(`
    SELECT
      u.id,
      u.display_name,
      u.phone,
      u.email,
      NULL AS created_at,
      COUNT(b.id) AS visit_count,
      MAX(b.appointment_start) AS last_visit_at,
      COALESCE(SUM(CASE WHEN b.status = 'COMPLETED' THEN b.service_price_cents ELSE 0 END), 0) AS total_spent_cents
    FROM users u
    LEFT JOIN bookings b ON b.user_id = u.id
    GROUP BY u.id
    ORDER BY LOWER(u.display_name) ASC
  `).all().map((row) => ({
    id: row.id,
    displayName: row.display_name,
    phone: row.phone,
    email: row.email,
    createdAt: row.created_at,
    visitCount: row.visit_count,
    lastVisitAt: row.last_visit_at,
    totalSpentCents: row.total_spent_cents
  }))
}

function getFinanceSummary(body) {
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  if (!FINANCE_PASSWORD) throw apiError(403, 'FINANCE_NOT_CONFIGURED', 'Finance password is not configured yet.')
  if (!FINANCE_EMAILS.includes(email) || password !== FINANCE_PASSWORD) throw apiError(403, 'FORBIDDEN', 'Finance login failed.')
  return db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN service_price_cents WHEN status = 'CONFIRMED' THEN deposit_cents ELSE 0 END), 0) AS total_revenue_cents,
      COALESCE(SUM(CASE WHEN appointment_start >= datetime('now', 'start of month') AND status = 'COMPLETED' THEN service_price_cents WHEN appointment_start >= datetime('now', 'start of month') AND status = 'CONFIRMED' THEN deposit_cents ELSE 0 END), 0) AS month_revenue_cents,
      COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) AS completed_services,
      COUNT(CASE WHEN appointment_start >= datetime('now', 'start of month') AND status = 'COMPLETED' THEN 1 END) AS month_completed_services
    FROM bookings
  `).get()
}

async function route(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {})
  const url = new URL(req.url, `http://${req.headers.host}`)
  const path = url.pathname
  const query = Object.fromEntries(url.searchParams.entries())

  if (req.method === 'GET' && path === '/') return serveFile(res, webRoot, 'index.html')
  if (req.method === 'GET' && path === '/admin') return serveFile(res, webRoot, 'admin.html')
  if (req.method === 'GET' && path === '/share') return serveFile(res, webRoot, 'share.html')
  if (req.method === 'GET' && path.startsWith('/web/')) return serveFile(res, webRoot, path.replace('/web/', ''))
  if (req.method === 'GET' && path.startsWith('/assets/')) return serveFile(res, assetRoot, path.replace('/assets/', ''))

  if (req.method === 'GET' && path === '/health') return json(res, 200, { ok: true, service: 'lucky-luxe-api-local', time: iso(new Date()) })
  if (req.method === 'POST' && path === '/auth/email/register') return json(res, 201, { user: registerEmailUser(await readBody(req)) })
  if (req.method === 'POST' && path === '/auth/google/demo') return json(res, 201, { user: registerGoogleDemoUser(await readBody(req)) })
  if (req.method === 'GET' && path.startsWith('/users/')) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(path.split('/')[2])
    if (!user) throw apiError(404, 'NOT_FOUND', 'User not found.')
    return json(res, 200, { user: serializeUser(user) })
  }
  if (req.method === 'GET' && path === '/stores') return json(res, 200, { stores: db.prepare('SELECT * FROM stores WHERE is_active = 1').all() })
  if (req.method === 'GET' && path === '/services') {
    const args = []
    let sql = 'SELECT * FROM services WHERE is_active = 1'
    if (query.type) {
      sql += ' AND type = ?'
      args.push(query.type.toUpperCase())
    }
    sql += ' ORDER BY type ASC, sort_order ASC'
    return json(res, 200, { services: db.prepare(sql).all(...args).map((service) => serializeService(service, query.lang || 'zh')) })
  }
  if (req.method === 'GET' && path === '/technicians') {
    const args = []
    let sql = 'SELECT DISTINCT t.* FROM technicians t LEFT JOIN technician_services ts ON ts.technician_id = t.id WHERE t.is_active = 1'
    if (query.storeId) {
      sql += ' AND t.store_id = ?'
      args.push(query.storeId)
    }
    if (query.serviceId) {
      sql += ' AND ts.service_id = ?'
      args.push(query.serviceId)
    }
    sql += ' ORDER BY t.name ASC'
    return json(res, 200, { technicians: db.prepare(sql).all(...args) })
  }
  if (req.method === 'GET' && path === '/portfolio') {
    const rows = db.prepare(`
      SELECT b.*, t.name AS tech_name, t.title AS tech_title
      FROM bookings b
      JOIN technicians t ON t.id = b.technician_id
      WHERE b.gallery_status = 'approved'
      ORDER BY b.gallery_locked_at DESC, b.appointment_start DESC
    `).all()
    const grouped = new Map()
    for (const row of rows) {
      const images = parseJson(row.approved_work_images_json).filter(Boolean)
      if (!images.length) continue
      if (!grouped.has(row.technician_id)) {
        grouped.set(row.technician_id, {
          technician: { id: row.technician_id, name: row.tech_name, title: row.tech_title },
          images: []
        })
      }
      grouped.get(row.technician_id).images.push(...images)
    }
    return json(res, 200, { portfolios: [...grouped.values()] })
  }
  if (req.method === 'GET' && path === '/add-ons') return json(res, 200, { addOns })
  if (req.method === 'GET' && path === '/availability') {
    expireOldHolds()
    return json(res, 200, getAvailability(query))
  }
  if (req.method === 'POST' && path === '/bookings') return json(res, 201, { booking: createBooking(await readBody(req)) })
  if (req.method === 'GET' && path === '/bookings') {
    const args = []
    let sql = 'SELECT * FROM bookings'
    if (query.userId) {
      sql += ' WHERE user_id = ?'
      args.push(query.userId)
    }
    sql += ' ORDER BY appointment_start DESC'
    return json(res, 200, { bookings: db.prepare(sql).all(...args).map((booking) => serializeBooking(booking, query.lang || 'zh')) })
  }
  if (req.method === 'POST' && path === '/payments/mock/confirm') return json(res, 200, { booking: confirmMockPayment(await readBody(req)) })
  if (req.method === 'GET' && path.startsWith('/bookings/')) {
    const id = path.split('/')[2]
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id)
    if (!booking) throw apiError(404, 'NOT_FOUND', 'Booking not found.')
    return json(res, 200, { booking: serializeBooking(booking, query.lang || 'zh') })
  }
  if (req.method === 'POST' && path.startsWith('/bookings/') && path.endsWith('/cancel')) {
    return json(res, 200, cancelBooking(path.split('/')[2], await readBody(req)))
  }
  if (req.method === 'POST' && path === '/ai/reference-analysis') {
    const body = await readBody(req)
    return json(res, 200, { analysis: await analyzeReferenceImage(body) })
  }
  if (req.method === 'POST' && path === '/ai/social-copy') {
    const body = await readBody(req)
    const row = body.bookingId ? db.prepare('SELECT * FROM bookings WHERE id = ?').get(body.bookingId) : null
    const booking = row ? serializeBooking(row, body.lang || 'zh') : body.booking
    return json(res, 200, { copy: await createSocialCopy({ lang: body.lang || 'zh', image: body.image || '', booking, platform: body.platform || 'xiaohongshu', audience: body.audience || 'customer', avoidCaptions: body.avoidCaptions || [], variantSeed: body.variantSeed || '' }) })
  }
  if (path.startsWith('/admin/')) requireOwner(req)
  if (req.method === 'GET' && path === '/admin/bookings') {
    const rows = db.prepare('SELECT * FROM bookings ORDER BY appointment_start DESC').all()
    return json(res, 200, { bookings: rows.map((booking) => serializeBooking(booking)) })
  }
  if (req.method === 'GET' && path === '/admin/customers') {
    return json(res, 200, { customers: getAdminCustomers() })
  }
  if (req.method === 'POST' && path === '/admin/finance/summary') {
    return json(res, 200, { finance: getFinanceSummary(await readBody(req)) })
  }
  if (req.method === 'POST' && path === '/admin/ai/daily-brief') {
    const bookings = db.prepare('SELECT * FROM bookings ORDER BY appointment_start DESC LIMIT 60').all().map((booking) => serializeBooking(booking))
    const services = db.prepare('SELECT * FROM services ORDER BY type ASC, sort_order ASC').all().map(serializeService)
    return json(res, 200, { brief: await createDailyBrief({ ...(await readBody(req)), bookings, customers: getAdminCustomers(), services }) })
  }
  if (req.method === 'POST' && path === '/admin/ai/booking-summary') {
    const body = await readBody(req)
    const row = db.prepare('SELECT * FROM bookings WHERE id = ?').get(body.bookingId)
    if (!row) throw apiError(404, 'NOT_FOUND', 'Booking not found.')
    return json(res, 200, { summary: await createBookingSummary({ lang: body.lang || 'zh', booking: serializeBooking(row, body.lang || 'zh') }) })
  }
  if (req.method === 'POST' && path === '/admin/ai/customer-insight') {
    const body = await readBody(req)
    const customer = getAdminCustomers().find((item) => item.id === body.customerId)
    if (!customer) throw apiError(404, 'NOT_FOUND', 'Customer not found.')
    const bookings = db.prepare('SELECT * FROM bookings WHERE user_id = ? ORDER BY appointment_start DESC LIMIT 12').all(customer.id).map((booking) => serializeBooking(booking, body.lang || 'zh'))
    return json(res, 200, { insight: await createCustomerInsight({ lang: body.lang || 'zh', customer, bookings }) })
  }
  if (req.method === 'POST' && path === '/admin/ai/social-copy') {
    const body = await readBody(req)
    const row = body.bookingId ? db.prepare('SELECT * FROM bookings WHERE id = ?').get(body.bookingId) : null
    const booking = row ? serializeBooking(row, body.lang || 'zh') : body.booking
    return json(res, 200, { copy: await createSocialCopy({ lang: body.lang || 'zh', image: body.image || '', booking, platform: body.platform || 'xiaohongshu', audience: body.audience || 'staff', avoidCaptions: body.avoidCaptions || [], variantSeed: body.variantSeed || '' }) })
  }
  if (req.method === 'GET' && path === '/admin/services') {
    return json(res, 200, { services: db.prepare('SELECT * FROM services ORDER BY type ASC, sort_order ASC').all().map(serializeService) })
  }
  if (req.method === 'POST' && path === '/admin/services') {
    const payload = servicePayload(await readBody(req))
    if (!['NAIL', 'LASH'].includes(payload.type)) throw apiError(400, 'BAD_REQUEST', 'Service type must be NAIL or LASH.')
    if (!payload.nameZh || !payload.nameEn) throw apiError(400, 'BAD_REQUEST', 'Service name is required.')
    const id = serviceIdFrom(payload)
    db.prepare(`INSERT INTO services
      (id, type, category, name_zh, name_en, description_zh, description_en, image_url, price_cents, deposit_cents, base_duration_min, sort_order, is_active, process_json, notice_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, payload.type, payload.category, payload.nameZh, payload.nameEn, payload.descriptionZh, payload.descriptionEn, payload.imageUrl, payload.priceCents, payload.depositCents, payload.baseDurationMin, payload.sortOrder, payload.isActive, JSON.stringify(payload.processJson), JSON.stringify(payload.noticeJson))
    const assign = db.prepare('INSERT OR IGNORE INTO technician_services (technician_id, service_id) VALUES (?, ?)')
    for (const tech of db.prepare('SELECT id FROM technicians WHERE is_active = 1').all()) assign.run(tech.id, id)
    return json(res, 201, { service: serializeService(getService(id)) })
  }
  if (req.method === 'GET' && path === '/admin/technicians') {
    return json(res, 200, { technicians: db.prepare('SELECT * FROM technicians ORDER BY name ASC').all() })
  }
  if (req.method === 'PATCH' && path.startsWith('/admin/services/')) {
    const id = path.split('/')[3]
    const body = await readBody(req)
    const current = getService(id)
    if (!current) throw apiError(404, 'NOT_FOUND', 'Service not found.')
    const payload = servicePayload(body, current)
    db.prepare(`UPDATE services SET
      type = ?, category = ?, name_zh = ?, name_en = ?, description_zh = ?, description_en = ?, image_url = ?,
      price_cents = ?, deposit_cents = ?, base_duration_min = ?, is_active = ?, sort_order = ?, process_json = ?, notice_json = ?
      WHERE id = ?`).run(payload.type, payload.category, payload.nameZh, payload.nameEn, payload.descriptionZh, payload.descriptionEn, payload.imageUrl, payload.priceCents, payload.depositCents, payload.baseDurationMin, payload.isActive, payload.sortOrder, JSON.stringify(payload.processJson), JSON.stringify(payload.noticeJson), id)
    return json(res, 200, { service: serializeService(getService(id)) })
  }
  if (req.method === 'PATCH' && path.startsWith('/admin/technicians/') && path.endsWith('/schedule')) {
    const technicianId = path.split('/')[3]
    const body = await readBody(req)
    if (!body.date) throw apiError(400, 'BAD_REQUEST', 'date is required.')
    db.prepare(`INSERT INTO technician_schedules (technician_id, date, start_time, end_time, is_working)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(technician_id, date) DO UPDATE SET start_time = excluded.start_time, end_time = excluded.end_time, is_working = excluded.is_working`)
      .run(technicianId, body.date, body.startTime || '10:00', body.endTime || '19:00', body.isWorking === undefined ? 1 : Number(Boolean(body.isWorking)))
    return json(res, 200, { schedule: db.prepare('SELECT * FROM technician_schedules WHERE technician_id = ? AND date = ?').get(technicianId, body.date) })
  }
  if (req.method === 'PATCH' && path.startsWith('/admin/bookings/') && path.endsWith('/status')) {
    const id = path.split('/')[3]
    const body = await readBody(req)
    const status = body.status
    if (!['PENDING_PAYMENT', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'AFTER_SALES'].includes(status)) throw apiError(400, 'BAD_REQUEST', 'Invalid status.')
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id)
    if (!booking) throw apiError(404, 'NOT_FOUND', 'Booking not found.')
    if (['CANCELLED', 'EXPIRED'].includes(status)) db.prepare('DELETE FROM booking_slots WHERE booking_id = ?').run(id)
    db.prepare('UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?').run(status, iso(new Date()), id)
    return json(res, 200, { booking: serializeBooking(db.prepare('SELECT * FROM bookings WHERE id = ?').get(id)) })
  }
  if (req.method === 'PATCH' && path.startsWith('/admin/bookings/') && path.endsWith('/work-images')) {
    const id = path.split('/')[3]
    const body = await readBody(req)
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id)
    if (!booking) throw apiError(404, 'NOT_FOUND', 'Booking not found.')
    if (booking.gallery_status === 'approved') throw apiError(409, 'GALLERY_LOCKED', 'This gallery has been approved and locked.')
    db.prepare('UPDATE bookings SET work_images_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(normalizeWorkImages(body.workImages)), iso(new Date()), id)
    return json(res, 200, { booking: serializeBooking(db.prepare('SELECT * FROM bookings WHERE id = ?').get(id)) })
  }
  if (req.method === 'PATCH' && path.startsWith('/admin/bookings/') && path.endsWith('/gallery-approval')) {
    const id = path.split('/')[3]
    const body = await readBody(req)
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id)
    if (!booking) throw apiError(404, 'NOT_FOUND', 'Booking not found.')
    if (booking.gallery_status === 'approved') throw apiError(409, 'GALLERY_LOCKED', 'This gallery has already been approved and locked.')
    const current = parseJson(booking.work_images_json)
    const selected = normalizeWorkImages(body.images).filter((image) => current.includes(image))
    if (!selected.length) throw apiError(400, 'BAD_REQUEST', 'Select at least one uploaded work image.')
    const lockedAt = iso(new Date())
    db.prepare("UPDATE bookings SET work_images_json = ?, approved_work_images_json = ?, gallery_status = 'approved', gallery_locked_at = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(selected), JSON.stringify(selected), lockedAt, lockedAt, id)
    return json(res, 200, { booking: serializeBooking(db.prepare('SELECT * FROM bookings WHERE id = ?').get(id)) })
  }
  throw apiError(404, 'NOT_FOUND', 'Endpoint not found.')
}

setupDatabase()
try {
  db.exec("ALTER TABLE bookings ADD COLUMN reference_images_json TEXT NOT NULL DEFAULT '[]'")
} catch (error) {
  if (!String(error.message || '').includes('duplicate column')) throw error
}
try {
  db.exec("ALTER TABLE bookings ADD COLUMN work_images_json TEXT NOT NULL DEFAULT '[]'")
} catch (error) {
  if (!String(error.message || '').includes('duplicate column')) throw error
}
try {
  db.exec("ALTER TABLE bookings ADD COLUMN approved_work_images_json TEXT NOT NULL DEFAULT '[]'")
} catch (error) {
  if (!String(error.message || '').includes('duplicate column')) throw error
}
try {
  db.exec("ALTER TABLE bookings ADD COLUMN gallery_status TEXT NOT NULL DEFAULT 'draft'")
} catch (error) {
  if (!String(error.message || '').includes('duplicate column')) throw error
}
try {
  db.exec("ALTER TABLE bookings ADD COLUMN gallery_locked_at TEXT")
} catch (error) {
  if (!String(error.message || '').includes('duplicate column')) throw error
}
try {
  db.exec('ALTER TABLE bookings ADD COLUMN source_channel TEXT')
} catch (error) {
  if (!String(error.message || '').includes('duplicate column')) throw error
}
seedDatabase()

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
  console.log(`Lucky Luxe local API running at http://localhost:${PORT}`)
  console.log(`Owner API token: ${OWNER_TOKEN}`)
})
