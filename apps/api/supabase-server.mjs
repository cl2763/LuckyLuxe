import 'dotenv/config'
import { createServer } from 'node:http'
import { createDecipheriv, createHash, createHmac } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { analyzeReferenceImage, createBookingSummary, createCustomerInsight, createCustomerServiceReply, createDailyBrief, createSocialCopy } from './ai-utils.mjs'
import { buildKnowledgeContext } from './kb-utils.mjs'

process.env.TZ = process.env.APP_TIMEZONE || 'America/Toronto'

const { Pool } = pg
const __dirname = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = join(__dirname, '..', '..')
const webRoot = join(workspaceRoot, 'apps', 'web')
const assetRoot = join(workspaceRoot, 'miniprogram', 'assets')
const PORT = Number(process.env.PORT || 4000)
const HOST = process.env.HOST || '0.0.0.0'
const OWNER_TOKEN = process.env.OWNER_DEMO_TOKEN || ''
const ALLOW_OWNER_DEMO_TOKEN = process.env.ALLOW_OWNER_DEMO_TOKEN === 'true'
const OWNER_EMAILS = (process.env.OWNER_EMAILS || 'nini3131254931@gmail.com').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean)
const STAFF_EMAILS = (process.env.STAFF_EMAILS || 'staff@luckyluxeatelier.com,employee@luckyluxeatelier.com').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean)
const STAFF_DEMO_PASSWORD = process.env.STAFF_DEMO_PASSWORD || 'LuckyluxeStaff0312'
const STAFF_TECH_MAP = Object.fromEntries((process.env.STAFF_TECH_MAP || 'staff@luckyluxeatelier.com:tech-mia,employee@luckyluxeatelier.com:tech-ava')
  .split(',')
  .map((pair) => pair.split(':').map((value) => value.trim().toLowerCase()))
  .filter(([email, technicianId]) => email && technicianId))
const FINANCE_EMAILS = (process.env.FINANCE_EMAILS || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean)
const FINANCE_PASSWORD = process.env.FINANCE_PASSWORD || ''
const HOLD_MINUTES = Number(process.env.BOOKING_HOLD_MINUTES || 30)
const DRAFT_PAYMENT_REMINDER_MINUTES = Number(process.env.DRAFT_PAYMENT_REMINDER_MINUTES || 20)
const HUMAN_REPLY_COOLDOWN_MINUTES = Number(process.env.HUMAN_REPLY_COOLDOWN_MINUTES || 10)
const SLOT_MINUTES = 30
const DATABASE_URL = process.env.DATABASE_URL
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '')
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || ''
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || ''
const APP_PUBLIC_URL = (process.env.APP_PUBLIC_URL || '').replace(/\/$/, '')
const WECHAT_MINI_APPID = process.env.WECHAT_MINI_APPID || process.env.WX_MINI_APPID || ''
const WECHAT_MINI_SECRET = process.env.WECHAT_MINI_SECRET || process.env.WX_MINI_APPSECRET || ''
const WECHAT_MINI_TOKEN_SECRET = process.env.WECHAT_MINI_TOKEN_SECRET || process.env.WX_MINI_TOKEN_SECRET || WECHAT_MINI_SECRET || OWNER_TOKEN || 'luckyluxe-mini-dev'
const WECOM_CORP_ID = process.env.WECOM_CORP_ID || ''
const WECOM_CUSTOMER_SERVICE_SECRET = process.env.WECOM_CUSTOMER_SERVICE_SECRET || ''
const WECOM_CUSTOMER_SERVICE_TOKEN = process.env.WECOM_CUSTOMER_SERVICE_TOKEN || ''
const WECOM_CUSTOMER_SERVICE_AES_KEY = process.env.WECOM_CUSTOMER_SERVICE_AES_KEY || ''
const WECOM_OPEN_KFID = process.env.WECOM_OPEN_KFID || ''
const WECOM_GATEWAY_URL = (process.env.WECOM_GATEWAY_URL || '').replace(/\/$/, '')
const WECOM_GATEWAY_SHARED_SECRET = process.env.WECOM_GATEWAY_SHARED_SECRET || ''
const WECOM_CALLBACK_PUBLIC_URL = (process.env.WECOM_CALLBACK_PUBLIC_URL || '').replace(/\/$/, '')

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

async function readRawBody(req) {
  let body = ''
  for await (const chunk of req) body += chunk
  return body
}

function apiError(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

async function requireOwner(req) {
  const admin = await requireAdmin(req)
  if (admin.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
  return admin
}

async function requireAdmin(req) {
  const auth = req.headers.authorization || ''
  if (ALLOW_OWNER_DEMO_TOKEN && OWNER_TOKEN && auth === `Bearer ${OWNER_TOKEN}`) return { provider: 'demo-token', role: 'owner', technicianId: null }
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const ownerEmail = demoEmailFromToken(token, 'owner')
  if (ownerEmail && OWNER_EMAILS.includes(ownerEmail)) return adminForEmail(ownerEmail, 'demo-owner')
  const staffEmail = demoEmailFromToken(token, 'staff')
  if (staffEmail && STAFF_EMAILS.includes(staffEmail)) return adminForEmail(staffEmail, 'demo-staff')
  if (!isSupabaseConfigured()) {
    if (ownerEmail && OWNER_EMAILS.includes(ownerEmail)) return adminForEmail(ownerEmail, 'demo-owner')
    if (staffEmail && STAFF_EMAILS.includes(staffEmail)) return adminForEmail(staffEmail, 'demo-staff')
  }
  if (!token || !isSupabaseConfigured()) throw apiError(401, 'UNAUTHORIZED', 'Admin login is required.')
  const authUser = await getSupabaseUser(token)
  const email = String(authUser.email || '').toLowerCase()
  const admin = adminForEmail(email, 'supabase')
  if (admin) return admin
  throw apiError(403, 'FORBIDDEN', 'This account is not allowed to access admin.')
}

function adminForEmail(email, provider) {
  const normalized = String(email || '').toLowerCase()
  if (OWNER_EMAILS.includes(normalized)) return { provider, email: normalized, role: 'owner', technicianId: null }
  if (STAFF_EMAILS.includes(normalized)) return { provider, email: normalized, role: 'staff', technicianId: STAFF_TECH_MAP[normalized] || 'tech-mia' }
  return null
}

function assertStaffCanAccessBooking(admin, booking) {
  if (admin.role === 'staff' && booking.technician_id !== admin.technicianId) {
    throw apiError(403, 'FORBIDDEN', 'Staff can only access their own bookings.')
  }
}

async function requireCustomer(req) {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const miniUser = await customerFromMiniToken(token)
  if (miniUser) return miniUser
  if (!isSupabaseConfigured()) {
    const email = demoEmailFromToken(token, 'customer')
    if (email) return registerEmailUser({ email, displayName: email.split('@')[0] })
  }
  if (!token || !isSupabaseConfigured()) throw apiError(401, 'UNAUTHORIZED', 'Customer login is required before booking or payment.')
  const authUser = await getSupabaseUser(token)
  const provider = authUser.app_metadata?.provider || 'email'
  return upsertAuthUser(authUser, provider)
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

function normalizeReferenceImages(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => typeof item === 'string' ? item : item?.url || item?.dataUrl || item?.src || '')
    .filter((item) => typeof item === 'string' && (item.startsWith('data:image/') || /^https?:\/\//.test(item)))
    .slice(0, 3)
}

function normalizeWorkImages(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => typeof item === 'string' ? item : item?.url || item?.dataUrl || item?.src || '')
    .filter((item) => typeof item === 'string' && (item.startsWith('data:image/') || /^https?:\/\//.test(item)))
    .slice(0, 6)
}

function bool(value) {
  return value === true || value === 1 || value === '1'
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
    imageUrl: normalizeAssetImage(body.imageUrl ?? current.image_url ?? '/assets/images/nail-addon.jpg'),
    priceCents: Number(body.priceCents ?? current.price_cents ?? 0),
    depositCents: Number(body.depositCents ?? current.deposit_cents ?? 5000),
    baseDurationMin: Number(body.baseDurationMin ?? current.base_duration_min ?? 120),
    sortOrder: Number(body.sortOrder ?? current.sort_order ?? 0),
    isActive: body.isActive === undefined ? (current.is_active ?? true) : Boolean(body.isActive),
    processJson: body.process ?? current.process_json ?? [],
    noticeJson: body.notice ?? current.notice_json ?? []
  }
}

function normalizeAssetImage(url) {
  const image = String(url || '')
  const map = {
    '/assets/images/nail-french.jpg': '/assets/images/nail-french.jpg',
    '/assets/images/nail-luxe.jpg': '/assets/images/nail-luxe.jpg',
    '/assets/images/nail-jp.jpg': '/assets/images/nail-jp.jpg',
    '/assets/images/nail-care.jpg': '/assets/images/nail-care.jpg',
    '/assets/images/nail-addon.jpg': '/assets/images/nail-addon.jpg',
    '/assets/images/lash-natural.jpg': '/assets/images/lash-natural.jpg',
    '/assets/images/lash-volume.jpg': '/assets/images/lash-volume.jpg',
    '/assets/images/lash-lower.jpg': '/assets/images/lash-lower.jpg',
    '/assets/images/lash-remove.jpg': '/assets/images/lash-remove.jpg',
    '/assets/images/store-cover.jpg': '/assets/images/store-cover.jpg',
    '/assets/images/member-profile.jpg': '/assets/images/member-profile.jpg'
  }
  return map[image] || image || '/assets/images/store-cover.jpg'
}

function serializeService(row, lang = 'zh') {
  const type = String(row.type || '').toLowerCase()
  const isNail = type === 'nail'
  const priceExplanationZh = isNail
    ? '显示价格为基础服务价。纯色、基础护理、基础法式等可按基础价执行；复杂手绘、延长、卸甲、特殊材料、3D 装饰、大面积钻饰或参考图差异较大的款式需要人工报价。'
    : '美睫款式为固定报价。页面价格已包含该款式标准嫁接服务；如有卸除、补睫、特殊敏感处理等附加需求，会在加项中明确显示，确认后即为最终报价。'
  const priceExplanationEn = isNail
    ? 'Displayed price is the base service price. Solid color, basic care, and basic French designs can follow the base price. Complex hand painting, extensions, removal, special materials, 3D charms, heavy rhinestones, or designs that differ from the reference require manual quotation.'
    : 'Lash services use fixed pricing. The listed price includes the standard application for this style. Any removal, refill, or special sensitivity add-on will be shown clearly before checkout, and the confirmed total is the final quote.'
  return {
    id: row.id,
    type,
    category: row.category,
    name: lang === 'en' ? row.name_en : row.name_zh,
    nameZh: row.name_zh,
    nameEn: row.name_en,
    description: lang === 'en' ? row.description_en : row.description_zh,
    descriptionZh: row.description_zh,
    descriptionEn: row.description_en,
    imageUrl: normalizeAssetImage(row.image_url),
    price: cents(row.price_cents),
    priceCents: row.price_cents,
    deposit: cents(row.deposit_cents),
    depositCents: row.deposit_cents,
    durationMin: row.base_duration_min,
    process: parseJson(row.process_json),
    notice: parseJson(row.notice_json),
    requiresManualQuote: isNail,
    pricingType: isNail ? 'base_plus_quote' : 'fixed_final',
    priceLabelZh: isNail ? `基础价 CAD $${cents(row.price_cents)}` : `固定价 CAD $${cents(row.price_cents)}`,
    priceLabelEn: isNail ? `Base price CAD $${cents(row.price_cents)}` : `Fixed price CAD $${cents(row.price_cents)}`,
    quoteHintZh: isNail ? '详细价格请联系客服获取报价' : '加项确认后即为最终报价',
    quoteHintEn: isNail ? 'Contact us for detailed custom quote' : 'Add-ons confirmed before checkout are final',
    priceExplanationZh,
    priceExplanationEn,
    sortOrder: row.sort_order,
    isActive: bool(row.is_active)
  }
}

const MEMBER_TIERS = [
  { key: 'silver', label: 'Silver Member', minSpendCents: 0, nextSpendCents: 50000, depositWaived: false },
  { key: 'gold', label: 'Gold Member', minSpendCents: 50000, nextSpendCents: 120000, depositWaived: true },
  { key: 'platinum', label: 'Platinum Member', minSpendCents: 120000, nextSpendCents: 250000, depositWaived: true },
  { key: 'diamond', label: 'Diamond Member', minSpendCents: 250000, nextSpendCents: null, depositWaived: true }
]

function memberCodeForUserId(userId) {
  return `LL-${String(userId || 'member').replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase().padStart(8, '0')}`
}

function displayNameForUserId(userId) {
  return memberCodeForUserId(userId)
}

function isGenericDisplayName(value, userId = '') {
  const displayName = String(value || '').trim()
  if (!displayName) return true
  return ['Lucky Member', '微信用户', 'WeChat User', displayNameForUserId(userId)].includes(displayName)
}

function membershipForSpend(totalSpentCents = 0) {
  const spend = Number(totalSpentCents || 0)
  const tierIndex = MEMBER_TIERS.findLastIndex
    ? MEMBER_TIERS.findLastIndex((item) => spend >= item.minSpendCents)
    : MEMBER_TIERS.map((item, index) => ({ item, index })).reverse().find(({ item }) => spend >= item.minSpendCents)?.index
  const safeTierIndex = tierIndex >= 0 ? tierIndex : 0
  const tier = MEMBER_TIERS[safeTierIndex]
  const nextTier = MEMBER_TIERS[safeTierIndex + 1] || null
  const nextLevelValue = tier.nextSpendCents ?? spend
  return {
    memberLevel: tier.label,
    memberTier: tier.key,
    growthValue: Math.round(spend / 100),
    nextLevelValue: Math.round(nextLevelValue / 100),
    currentLevelValue: Math.round(tier.minSpendCents / 100),
    nextMemberLevel: nextTier ? nextTier.label : null,
    amountToNextLevel: nextTier ? Math.max(0, Math.round((nextTier.minSpendCents - spend) / 100)) : 0,
    memberTiers: MEMBER_TIERS.map((item) => ({
      key: item.key,
      label: item.label,
      minSpend: Math.round(item.minSpendCents / 100),
      nextSpend: item.nextSpendCents === null ? null : Math.round(item.nextSpendCents / 100),
      depositWaived: item.depositWaived
    })),
    depositWaived: tier.depositWaived,
    depositRule: tier.depositWaived
      ? `${tier.label} and above do not need to pay booking deposits.`
      : 'Silver Member pays CAD $50 deposit for each booking.'
  }
}

async function userBookingStats(userId) {
  if (!userId) return { totalSpentCents: 0, visits: 0 }
  const result = await query(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN service_price_cents ELSE 0 END), 0)::int AS total_spent_cents,
      COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END), 0)::int AS visits
    FROM bookings
    WHERE user_id = $1
  `, [userId])
  return result.rows[0] || { total_spent_cents: 0, visits: 0 }
}

async function upsertUserIdentity({ userId, provider, providerUserId, unionId = '', email = '', phone = '' }, client = null) {
  if (!userId || !provider || !providerUserId) return
  const runner = client || { query }
  await runner.query(`
    INSERT INTO user_identities (id, user_id, provider, provider_user_id, union_id, email, phone)
    VALUES ($1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''), NULLIF($7, ''))
    ON CONFLICT (provider, provider_user_id) DO UPDATE SET
      user_id = excluded.user_id,
      union_id = COALESCE(excluded.union_id, user_identities.union_id),
      email = COALESCE(excluded.email, user_identities.email),
      phone = COALESCE(excluded.phone, user_identities.phone),
      updated_at = now()
  `, [randomId('identity'), userId, provider, providerUserId, unionId, email, phone])
}

async function serializeUser(user) {
  if (!user) return null
  const memberCode = memberCodeForUserId(user.id)
  const stats = await userBookingStats(user.id)
  const totalSpentCents = Number(stats.total_spent_cents || stats.totalSpentCents || 0)
  const membership = membershipForSpend(totalSpentCents)
  const displayName = isGenericDisplayName(user.display_name, user.id) ? memberCode : user.display_name
  return {
    id: user.id,
    displayName,
    phone: user.phone,
    email: user.email,
    provider: user.google_id ? 'google' : user.wechat_open_id ? 'wechat' : 'email',
    profileComplete: !isGenericDisplayName(user.display_name, user.id),
    memberLevel: membership.memberLevel,
    memberTier: membership.memberTier,
    growthValue: membership.growthValue,
    nextLevelValue: membership.nextLevelValue,
    currentLevelValue: membership.currentLevelValue,
    nextMemberLevel: membership.nextMemberLevel,
    amountToNextLevel: membership.amountToNextLevel,
    memberTiers: membership.memberTiers,
    depositWaived: membership.depositWaived,
    depositRule: membership.depositRule,
    points: Math.floor(totalSpentCents / 100),
    couponCount: 0,
    balanceCents: 0,
    totalSpentCents,
    visits: Number(stats.visits || 0),
    memberCode,
    referralCode: memberCode.replace('LL-', 'REF-'),
    referralUrl: `${publicAppUrl()}/?ref=${encodeURIComponent(memberCode.replace('LL-', 'REF-'))}`
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
    referenceImages: parseJson(row.reference_images_json),
    workImages: parseJson(row.work_images_json),
    approvedWorkImages: parseJson(row.approved_work_images_json),
    galleryStatus: row.gallery_status || 'draft',
    galleryLockedAt: row.gallery_locked_at ? iso(row.gallery_locked_at) : null,
    sourceChannel: row.source_channel || null,
    notes: row.notes,
    servicePrice: cents(row.service_price_cents),
    servicePriceCents: row.service_price_cents,
    deposit: cents(row.deposit_cents),
    depositCents: row.deposit_cents,
    depositRequired: cents(row.deposit_required_cents ?? 5000),
    depositRequiredCents: row.deposit_required_cents ?? 5000,
    depositWaived: cents(row.deposit_waived_cents ?? 0),
    depositWaivedCents: row.deposit_waived_cents ?? 0,
    depositWaiveReason: row.deposit_waive_reason || null,
    memberLevelAtBooking: row.member_level_at_booking || null,
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

function lastTranscriptMessageByRole(transcript = [], role = '') {
  return [...(Array.isArray(transcript) ? transcript : [])].reverse().find((item) => item?.role === role) || null
}

function shouldReleaseHumanConversationToAi(status = '', transcript = [], now = new Date()) {
  if (status !== 'human_active') return false
  const lastMessage = [...(Array.isArray(transcript) ? transcript : [])].reverse().find((item) => item?.role)
  const lastStaff = lastTranscriptMessageByRole(transcript, 'staff')
  if (!lastStaff?.at || lastMessage?.role !== 'staff') return false
  const lastStaffAt = new Date(lastStaff.at).getTime()
  if (!Number.isFinite(lastStaffAt)) return false
  return now.getTime() - lastStaffAt >= HUMAN_REPLY_COOLDOWN_MINUTES * 60 * 1000
}

function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
}

function demoAuthFor(email, scope = 'customer') {
  return {
    accessToken: `demo-${scope}:${encodeURIComponent(email)}`,
    refreshToken: null,
    expiresIn: 3600,
    tokenType: 'bearer'
  }
}

function demoEmailFromToken(token, scope = 'customer') {
  const prefix = `demo-${scope}:`
  if (!token.startsWith(prefix)) return ''
  return decodeURIComponent(token.slice(prefix.length)).trim().toLowerCase()
}

function base64UrlEncode(value) {
  return Buffer.from(JSON.stringify(value))
    .toString('base64url')
}

function base64UrlDecode(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
}

function signMiniPayload(payload) {
  return createHmac('sha256', WECHAT_MINI_TOKEN_SECRET)
    .update(payload)
    .digest('base64url')
}

function miniAuthFor(user, openid) {
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000
  const payload = base64UrlEncode({ sub: user.id, openid, exp: expiresAt })
  const signature = signMiniPayload(payload)
  return {
    accessToken: `mini.${payload}.${signature}`,
    refreshToken: null,
    expiresAt,
    expiresIn: Math.round((expiresAt - Date.now()) / 1000),
    tokenType: 'bearer'
  }
}

async function customerFromMiniToken(token) {
  if (!token || !token.startsWith('mini.')) return null
  const [, payload, signature] = token.split('.')
  if (!payload || !signature || signMiniPayload(payload) !== signature) throw apiError(401, 'UNAUTHORIZED', 'Invalid mini program session.')
  const data = base64UrlDecode(payload)
  if (!data.exp || Date.now() > Number(data.exp)) throw apiError(401, 'UNAUTHORIZED', 'Mini program session expired.')
  const row = await query('SELECT * FROM users WHERE id = $1 AND wechat_open_id = $2', [data.sub, data.openid])
  if (!row.rows[0]) throw apiError(401, 'UNAUTHORIZED', 'Mini program user was not found.')
  return serializeUser(row.rows[0])
}

function isStripeConfigured() {
  return Boolean(STRIPE_SECRET_KEY)
}

function publicAppUrl() {
  return (APP_PUBLIC_URL || 'https://www.luckyluxeatelier.com').replace(/\/$/, '')
}

function wechatWebhookUrl() {
  if (WECOM_CALLBACK_PUBLIC_URL) return `${WECOM_CALLBACK_PUBLIC_URL}/wechat/customer-service/webhook`
  return `${publicAppUrl()}/wechat/customer-service/webhook`
}

function sha1Signature(parts = []) {
  return createHash('sha1')
    .update(parts.map((part) => String(part ?? '')).sort().join(''))
    .digest('hex')
}

function verifyWecomSignature({ signature, timestamp, nonce, payload }) {
  if (!WECOM_CUSTOMER_SERVICE_TOKEN) return false
  return sha1Signature([WECOM_CUSTOMER_SERVICE_TOKEN, timestamp, nonce, payload]) === signature
}

function decryptWecomPayload(encrypted) {
  if (!WECOM_CUSTOMER_SERVICE_AES_KEY) throw apiError(501, 'WECHAT_AES_KEY_MISSING', 'EncodingAESKey is required to decrypt WeChat callback payload.')
  const aesKey = Buffer.from(`${WECOM_CUSTOMER_SERVICE_AES_KEY}=`, 'base64')
  if (aesKey.length !== 32) throw apiError(500, 'WECHAT_AES_KEY_INVALID', 'EncodingAESKey must decode to 32 bytes.')
  const decipher = createDecipheriv('aes-256-cbc', aesKey, aesKey.subarray(0, 16))
  decipher.setAutoPadding(false)
  const decrypted = Buffer.concat([decipher.update(encrypted, 'base64'), decipher.final()])
  const pad = decrypted[decrypted.length - 1]
  const unpadded = decrypted.subarray(0, decrypted.length - pad)
  const msgLength = unpadded.readUInt32BE(16)
  const message = unpadded.subarray(20, 20 + msgLength).toString('utf8')
  const receiverId = unpadded.subarray(20 + msgLength).toString('utf8')
  if (WECOM_CORP_ID && receiverId && receiverId !== WECOM_CORP_ID) throw apiError(403, 'WECHAT_RECEIVER_MISMATCH', 'WeChat callback receiver id does not match configured CorpID.')
  return message
}

function xmlValue(xml, tag) {
  const match = String(xml || '').match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, 'i'))
  return match ? match[1].trim() : ''
}

function normalizeWecomInbound(body = {}, queryParams = {}, rawBody = '') {
  const xmlContent = rawBody && rawBody.trim().startsWith('<') ? {
    externalUserId: xmlValue(rawBody, 'FromUserName'),
    openKfid: xmlValue(rawBody, 'ToUserName') || queryParams.open_kfid,
    msgType: xmlValue(rawBody, 'MsgType') || 'text',
    content: xmlValue(rawBody, 'Content') || xmlValue(rawBody, 'Event') || '',
    event: xmlValue(rawBody, 'Event') || '',
    token: xmlValue(rawBody, 'Token') || '',
    messageId: xmlValue(rawBody, 'MsgId') || xmlValue(rawBody, 'MsgID') || randomId('wxmsg'),
    createdAt: xmlValue(rawBody, 'CreateTime')
  } : {}
  return {
    provider: 'wecom_customer_service',
    externalUserId: body.externalUserId || body.external_userid || body.fromUserName || body.openid || xmlContent.externalUserId || 'mock-customer',
    openKfid: body.openKfid || body.open_kfid || xmlContent.openKfid || WECOM_OPEN_KFID || 'mock-open-kfid',
    msgType: body.msgType || body.msgtype || xmlContent.msgType || 'text',
    event: body.event || xmlContent.event || '',
    token: body.token || body.Token || xmlContent.token || queryParams.token || '',
    content: body.content || body.text || body.message || xmlContent.content || '',
    messageId: body.messageId || body.msgid || xmlContent.messageId || randomId('wxmsg'),
    sourceChannel: body.sourceChannel || body.source || '',
    lang: body.lang || (/^[\x00-\x7F]*$/.test(body.content || body.message || xmlContent.content || '') ? 'en' : 'zh'),
    referenceImages: normalizeReferenceImages(body.referenceImages || body.images || []),
    customerStage: body.customerStage || body.stage || '',
    forceAi: Boolean(body.forceAi || body.force_ai),
    raw: body.raw || body || rawBody || {}
  }
}

function wecomConfigStatus() {
  const checks = [
    { key: 'WECOM_CORP_ID', label: 'CorpID', ok: Boolean(WECOM_CORP_ID) },
    { key: 'WECOM_CUSTOMER_SERVICE_SECRET', label: 'Customer Service Secret', ok: Boolean(WECOM_CUSTOMER_SERVICE_SECRET) },
    { key: 'WECOM_CUSTOMER_SERVICE_TOKEN', label: 'Webhook Token', ok: Boolean(WECOM_CUSTOMER_SERVICE_TOKEN) },
    { key: 'WECOM_CUSTOMER_SERVICE_AES_KEY', label: 'EncodingAESKey', ok: Boolean(WECOM_CUSTOMER_SERVICE_AES_KEY) },
    { key: 'WECOM_OPEN_KFID', label: 'open_kfid', ok: Boolean(WECOM_OPEN_KFID) },
    { key: 'WECOM_GATEWAY_URL', label: 'Fixed-IP Gateway', ok: Boolean(WECOM_GATEWAY_URL) },
    { key: 'WECOM_GATEWAY_SHARED_SECRET', label: 'Gateway Secret', ok: Boolean(WECOM_GATEWAY_SHARED_SECRET) }
  ]
  return {
    provider: 'wecom_customer_service',
    mode: checks.every((item) => item.ok) ? 'ready' : 'pending_credentials',
    webhookUrl: wechatWebhookUrl(),
    checks
  }
}

async function callWecomGateway(path, body = null, method = 'POST') {
  if (!WECOM_GATEWAY_URL || !WECOM_GATEWAY_SHARED_SECRET) {
    throw apiError(503, 'WECOM_GATEWAY_NOT_CONFIGURED', 'WeCom fixed-IP gateway is not configured.')
  }
  const response = await fetch(`${WECOM_GATEWAY_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${WECOM_GATEWAY_SHARED_SECRET}`,
      ...(body ? { 'content-type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok === false) {
    throw apiError(response.status || 502, data.error || 'WECOM_GATEWAY_FAILED', data.message || 'WeCom gateway request failed.')
  }
  return data
}

function normalizeWecomSyncedMessage(message = {}) {
  const msgType = message.msgtype || message.msgType || 'event'
  const content = message.text?.content || message.event?.event_type || message.content || ''
  return normalizeWecomInbound({
    externalUserId: message.external_userid || message.externalUserId,
    openKfid: message.open_kfid || message.openKfid,
    msgType,
    content,
    messageId: message.msgid || message.messageId,
    raw: message
  })
}

async function sendWecomTextReply(inbound, reply, conversationId = '') {
  const replyData = reply?.data || reply || {}
  if (!inbound.externalUserId || !replyData.answerZh && !replyData.answerEn) return null
  if (replyData.handoffRequired) return { skipped: true, reason: 'handoff_required' }
  const content = inbound.lang === 'en' ? (replyData.answerEn || replyData.answerZh) : (replyData.answerZh || replyData.answerEn)
  return callWecomGateway('/wecom/send-text', {
    toUser: inbound.externalUserId,
    openKfid: inbound.openKfid || WECOM_OPEN_KFID,
    content,
    msgid: `ll-${conversationId || inbound.messageId || Date.now()}`
  })
}

function wecomConversationId(externalUserId = '') {
  return `wecom:${externalUserId || 'mock-guest'}`
}

async function getWecomConversation(conversationId) {
  const rows = await query('SELECT * FROM wechat_conversations WHERE id = $1', [conversationId])
  const row = rows.rows[0]
  if (!row) return null
  return {
    id: row.id,
    provider: row.provider,
    externalUserId: row.external_user_id,
    openKfid: row.open_kfid,
    sourceChannel: row.source_channel,
    status: row.status,
    lastIntent: row.last_intent,
    lastMessage: row.last_message,
    aiReply: parseJson(row.ai_reply_json),
    transcript: parseJson(row.transcript_json),
    createdAt: row.created_at ? iso(row.created_at) : null,
    updatedAt: row.updated_at ? iso(row.updated_at) : null
  }
}

function serializeAiResponseFeedback(row) {
  if (!row) return null
  return {
    id: row.id,
    conversationId: row.conversation_id,
    messageIndex: row.message_index,
    customerMessage: row.customer_message,
    originalReply: row.original_reply,
    correctedReply: row.corrected_reply,
    notes: row.notes,
    lang: row.lang,
    sourceChannel: row.source_channel,
    intent: row.intent,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at ? iso(row.created_at) : null,
    updatedAt: row.updated_at ? iso(row.updated_at) : null
  }
}

async function getAiResponseFeedback({ limit = 40, status = 'approved' } = {}) {
  const result = await query(`
    SELECT * FROM ai_response_feedback
    WHERE ($1 = '' OR status = $1)
    ORDER BY updated_at DESC
    LIMIT $2
  `, [status || '', Number(limit) || 40])
  return result.rows.map(serializeAiResponseFeedback)
}

async function ownerApprovedReplyPrompt(lang = 'zh', samples = null) {
  samples = samples || await getAiResponseFeedback({ limit: 10, status: 'approved' })
  if (!samples.length) return ''
  const lines = samples.map((sample, index) => [
    `Example ${index + 1}:`,
    `Customer: ${sample.customerMessage}`,
    `Avoid this reply: ${sample.originalReply}`,
    `Owner-approved reply: ${sample.correctedReply}`,
    sample.notes ? `Owner notes: ${sample.notes}` : ''
  ].filter(Boolean).join('\n')).join('\n\n')
  return lang === 'en'
    ? `Owner-approved reply examples. Use these only when the customer message clearly matches the same intent and details. For greetings, short messages, or unrelated questions, ignore the examples and answer normally. Match tone, specificity, and handoff boundaries without mechanically repeating wording.\n${lines}`
    : `店主确认过的满意回复样本。只有当顾客当前问题和样本属于同一意图、同一细节场景时才参考；如果只是问候、短消息或不相关问题，必须忽略样本并正常回答。请学习语气、具体程度和转人工边界，不要机械复读。\n${lines}`
}

async function attachOwnerApprovedSamples(knowledgeContext, lang = 'zh') {
  const samples = await getAiResponseFeedback({ limit: 10, status: 'approved' })
  const prompt = await ownerApprovedReplyPrompt(lang, samples)
  if (!knowledgeContext) return knowledgeContext
  if (!prompt) return { ...knowledgeContext, ownerApprovedSamples: samples }
  return {
    ...knowledgeContext,
    ownerApprovedSamples: samples,
    promptTextZh: `${knowledgeContext.promptTextZh || ''}\n\n${prompt}`,
    promptTextEn: `${knowledgeContext.promptTextEn || ''}\n\n${prompt}`
  }
}

function previousCustomerMessage(transcript = [], index = 0) {
  for (let i = Number(index) - 1; i >= 0; i -= 1) {
    if (transcript[i]?.role === 'customer') return transcript[i]?.content || ''
  }
  return ''
}

function aiConversationHistory(transcript = []) {
  return (transcript || [])
    .slice(-10)
    .map((item) => {
      const role = item.role === 'customer' ? 'user' : item.role === 'staff' ? 'staff' : 'assistant'
      const imageCount = Array.isArray(item.referenceImages) ? item.referenceImages.length : 0
      const imageNote = imageCount ? `\n[customer_uploaded_reference_images:${imageCount}]` : ''
      const content = `${item.content || ''}${imageNote}`.trim()
      return content ? { role, content } : null
    })
    .filter(Boolean)
}

async function saveAiResponseFeedback(body = {}, adminSession = {}) {
  const conversationId = String(body.conversationId || body.conversation_id || '').trim()
  const messageIndex = Number(body.messageIndex ?? body.message_index)
  const correctedReply = String(body.correctedReply || body.corrected_reply || '').trim()
  if (!conversationId) throw apiError(400, 'CONVERSATION_REQUIRED', 'Conversation is required.')
  if (!Number.isInteger(messageIndex) || messageIndex < 0) throw apiError(400, 'MESSAGE_INDEX_REQUIRED', 'A valid message index is required.')
  if (!correctedReply) throw apiError(400, 'CORRECTED_REPLY_REQUIRED', 'Corrected reply is required.')
  const rows = await query('SELECT * FROM wechat_conversations WHERE id = $1', [conversationId])
  const row = rows.rows[0]
  if (!row) throw apiError(404, 'NOT_FOUND', 'Conversation not found.')
  const transcript = parseJson(row.transcript_json)
  const target = transcript[messageIndex]
  if (!target || target.role !== 'assistant') throw apiError(400, 'ASSISTANT_MESSAGE_REQUIRED', 'Selected message must be an AI assistant reply.')
  const customerMessage = String(body.customerMessage || body.customer_message || previousCustomerMessage(transcript, messageIndex) || row.last_message || '').trim()
  const originalReply = String(body.originalReply || body.original_reply || target.originalContent || target.content || '').trim()
  const id = randomId('feedback')
  const now = iso(new Date())
  transcript[messageIndex] = {
    ...target,
    originalContent: originalReply,
    content: correctedReply,
    correctedByOwner: true,
    feedbackId: id,
    correctedAt: now
  }
  await query(`
    INSERT INTO ai_response_feedback
      (id, conversation_id, message_index, customer_message, original_reply, corrected_reply, notes, lang, source_channel, intent, status, created_by, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now())
  `, [
    id,
    conversationId,
    messageIndex,
    customerMessage,
    originalReply,
    correctedReply,
    String(body.notes || '').trim(),
    String(body.lang || 'zh'),
    row.source_channel || '',
    target.intent || row.last_intent || '',
    String(body.status || 'approved'),
    adminSession?.email || ''
  ])
  await query(`
    UPDATE wechat_conversations
    SET transcript_json = $1::jsonb,
        ai_reply_json = $2::jsonb,
        status = 'ai_replied',
        last_intent = 'owner_corrected_ai_reply',
        last_message = $3,
        updated_at = now()
    WHERE id = $4
  `, [
    JSON.stringify(transcript),
    JSON.stringify({ ...(parseJson(row.ai_reply_json) || {}), ownerCorrectedReply: correctedReply, feedbackId: id }),
    correctedReply,
    conversationId
  ])
  const feedback = await query('SELECT * FROM ai_response_feedback WHERE id = $1', [id])
  return { feedback: serializeAiResponseFeedback(feedback.rows[0]), conversation: await getWecomConversation(conversationId) }
}

async function appendWecomConversationMessage(conversationId, message, patch = {}) {
  const currentRows = await query('SELECT * FROM wechat_conversations WHERE id = $1', [conversationId])
  const current = currentRows.rows[0]
  const transcript = parseJson(current?.transcript_json)
  transcript.push({ ...message, at: message.at || iso(new Date()) })
  await query(`
    INSERT INTO wechat_conversations
      (id, provider, external_user_id, open_kfid, source_channel, status, last_intent, last_message, ai_reply_json, transcript_json, raw_event_json, updated_at)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, now())
    ON CONFLICT (id) DO UPDATE SET
      provider = excluded.provider,
      open_kfid = COALESCE(NULLIF(excluded.open_kfid, ''), wechat_conversations.open_kfid),
      source_channel = COALESCE(NULLIF(excluded.source_channel, ''), wechat_conversations.source_channel),
      status = excluded.status,
      last_intent = excluded.last_intent,
      last_message = excluded.last_message,
      ai_reply_json = excluded.ai_reply_json,
      transcript_json = excluded.transcript_json,
      raw_event_json = excluded.raw_event_json,
      updated_at = now()
  `, [
    conversationId,
    patch.provider || current?.provider || 'wecom_customer_service',
    patch.externalUserId || current?.external_user_id || conversationId.replace(/^wecom:/, ''),
    patch.openKfid || current?.open_kfid || '',
    patch.sourceChannel || current?.source_channel || '',
    patch.status || current?.status || 'open',
    patch.lastIntent || current?.last_intent || message.intent || message.role || 'unknown',
    patch.lastMessage || message.content || current?.last_message || '',
    JSON.stringify(patch.aiReply !== undefined ? (patch.aiReply || {}) : parseJson(current?.ai_reply_json)),
    JSON.stringify(transcript),
    JSON.stringify(patch.raw !== undefined ? (patch.raw || {}) : parseJson(current?.raw_event_json))
  ])
  return getWecomConversation(conversationId)
}

async function recordWecomConversation(inbound, reply, status = 'ai_replied', outbound = null) {
  const conversationId = wecomConversationId(inbound.externalUserId)
  const current = await query('SELECT transcript_json FROM wechat_conversations WHERE id = $1', [conversationId])
  const transcript = parseJson(current.rows[0]?.transcript_json)
  const replyData = reply?.data || reply || {}
  transcript.push({
    role: 'customer',
    content: inbound.content,
    messageId: inbound.messageId,
    msgType: inbound.msgType,
    referenceImages: inbound.referenceImages || [],
    at: iso(new Date())
  })
  if (reply) {
    transcript.push({
      role: 'assistant',
      content: replyData.answerZh || replyData.answerEn || '',
      intent: replyData.intent,
      handoffRequired: Boolean(replyData.handoffRequired),
      outbound,
      at: iso(new Date())
    })
  }
  await query(`
    INSERT INTO wechat_conversations
      (id, provider, external_user_id, open_kfid, source_channel, status, last_intent, last_message, ai_reply_json, transcript_json, raw_event_json, updated_at)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, now())
    ON CONFLICT (id) DO UPDATE SET
      open_kfid = excluded.open_kfid,
      source_channel = COALESCE(NULLIF(excluded.source_channel, ''), wechat_conversations.source_channel),
      status = excluded.status,
      last_intent = excluded.last_intent,
      last_message = excluded.last_message,
      ai_reply_json = excluded.ai_reply_json,
      transcript_json = excluded.transcript_json,
      raw_event_json = excluded.raw_event_json,
      updated_at = now()
  `, [
    conversationId,
    inbound.provider,
    inbound.externalUserId,
    inbound.openKfid,
    inbound.sourceChannel,
    replyData.handoffRequired ? 'needs_human' : status,
    replyData.intent || 'unknown',
    inbound.content,
    JSON.stringify(reply || {}),
    JSON.stringify(transcript),
    JSON.stringify(inbound.raw || {})
  ])
  return conversationId
}

function compactIntentText(value = '') {
  return String(value || '').toLowerCase().replace(/\s+/g, '')
}

function hasExplicitPriceIntent(text = '') {
  const raw = String(text || '').toLowerCase()
  const compact = compactIntentText(raw)
  return /价|价格|报价|多少钱|费用|预算/.test(compact) || /price|quote|cost|how\s*much/.test(raw)
}

function hasCapabilityIntent(text = '') {
  const compact = compactIntentText(text)
  return /可以做吗|能做吗|能不能做|可不可以做|可以还原吗|能还原吗|这一款可以吗|这款可以吗|这个可以吗|可以吗|好了吗/.test(compact)
    || /can you do|can u do|possible|is it possible/.test(String(text || '').toLowerCase())
}

function isVagueContextFollowup(text = '') {
  const compact = compactIntentText(text)
  return /^(可以吗|好了吗|这个呢|这款呢|那这个呢|那价格呢|价格呢|多少钱|ok|好的|可以)$/.test(compact)
}

function dedupeReferenceImages(images = []) {
  const seen = new Set()
  return normalizeReferenceImages(images).filter((item) => {
    const key = String(item || '').slice(0, 180)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function mergeReferenceImages(...groups) {
  return dedupeReferenceImages(groups.flatMap((group) => Array.isArray(group) ? group : []))
}

function transcriptReferenceImages(transcript = []) {
  return mergeReferenceImages(...(transcript || []).map((item) => item?.referenceImages || item?.images || []))
}

function quoteTranscriptCorpus(transcript = []) {
  return (transcript || [])
    .slice(-8)
    .map((item) => {
      const imageNote = Array.isArray(item.referenceImages) && item.referenceImages.length ? ` [${item.referenceImages.length}张参考图]` : ''
      return `${item.role || ''}: ${item.content || ''}${imageNote}`
    })
    .join('\n')
}

function inferQuoteFlagFromText(corpus = '', yesPattern, noPattern) {
  const compact = compactIntentText(corpus)
  if (noPattern?.test(compact)) return 'no'
  if (yesPattern?.test(compact)) return 'yes'
  return 'unknown'
}

function buildQuoteIntakeState(inbound = {}, transcript = []) {
  const currentText = String(inbound.content || '')
  const historyText = quoteTranscriptCorpus(transcript)
  const corpus = `${historyText}\ncustomer: ${currentText}`
  const referenceImages = mergeReferenceImages(transcriptReferenceImages(transcript), inbound.referenceImages || [])
  const serviceType = inferServiceTypeFromText(corpus, inferServiceTypeFromText(currentText || historyText, 'nail'))
  const hasReferenceContext = Boolean(referenceImages.length)
    || /参考图|图片|照片|图|这个款|这一款|这款|款式|法式|贝母|渐变|珍珠|手绘|延长|reference|photo|picture|design/.test(compactIntentText(corpus))
  return {
    serviceType,
    currentText,
    corpus,
    referenceImages,
    hasReferenceContext,
    priceIntent: hasExplicitPriceIntent(currentText),
    capabilityIntent: hasCapabilityIntent(currentText),
    contextualFollowup: isVagueContextFollowup(currentText) && (hasReferenceContext || /报价|价格|技师|延长|卸甲|本甲/.test(compactIntentText(historyText))),
    extensionNeeded: inferQuoteFlagFromText(corpus, /延长|加长|长甲|extension/, /本甲|自然甲|原甲|不延长|不用延长|不要延长|不做延长|naturalnail/),
    removalNeeded: inferQuoteFlagFromText(corpus, /卸甲|卸旧甲|removal/, /不卸|不用卸|不要卸|不需要卸甲|无需卸甲|没有旧甲|没旧甲|无旧甲|裸甲/),
    repairNeeded: inferQuoteFlagFromText(corpus, /断甲|修补|补甲|repair/, /无断甲|没有断甲|没断甲|不修|不用修|不修补/),
    charmsNeeded: inferQuoteFlagFromText(corpus, /珍珠|饰品|贴钻|钻|蝴蝶结|charm|rhinestone|pearl/, /不要饰品|无饰品|不贴钻|不加饰品/)
  }
}

function quoteIntakeSummary(state) {
  const parts = []
  if (state.extensionNeeded !== 'unknown') parts.push(state.extensionNeeded === 'yes' ? '需要延长' : '本甲/不延长')
  if (state.removalNeeded !== 'unknown') parts.push(state.removalNeeded === 'yes' ? '需要卸甲' : '不需要卸甲')
  if (state.repairNeeded !== 'unknown') parts.push(state.repairNeeded === 'yes' ? '有断甲修补' : '无断甲修补')
  if (state.charmsNeeded !== 'unknown') parts.push(state.charmsNeeded === 'yes' ? '有饰品/贴钻元素' : '无饰品/贴钻')
  if (state.referenceImages.length) parts.push(`${state.referenceImages.length} 张参考图`)
  return parts.join('，') || '当前信息'
}

function quoteIntakeReply(kind, state, missingQuestions) {
  const missing = missingQuestions.zh || []
  if (kind === 'ready_quote') {
    return {
      data: {
        intent: 'pricing',
        answerZh: `好的亲亲，我已经把需求整理好啦：${quoteIntakeSummary(state)}。我现在转给技师确认最终报价和可预约时长，正常 10 分钟内给您回复；如果技师正在服务中，我也会在收到回复后第一时间发给您。`,
        answerEn: `Got it. I have organized the request: ${quoteIntakeSummary(state)}. I will send it to the technician for the final quote and duration, and usually reply within 10 minutes.`,
        handoffRequired: true
      },
      source: 'quote_intake_state'
    }
  }
  if (kind === 'ask_missing') {
    if (!missing.length) {
      return {
        data: {
          intent: 'nail_quote',
          answerZh: `可以的亲亲，目前需求信息基本齐了：${quoteIntakeSummary(state)}。如果您是想确认具体价格，我可以现在帮您转给技师报价。`,
          answerEn: `Sure. The request details are mostly complete: ${quoteIntakeSummary(state)}. If you would like the exact quote, I can send it to the technician now.`,
          handoffRequired: false
        },
        source: 'quote_intake_state'
      }
    }
    return {
      data: {
        intent: 'nail_quote',
        answerZh: `可以的亲亲，我先不急着转技师报价，避免信息不完整导致报价不准。想确认一下：${missing.join(' ')} 确认后我再把图片和需求一起整理给技师看价。`,
        answerEn: `Sure. Before sending this to the technician, I need to confirm: ${(missingQuestions.en || []).join(' ')} Once confirmed, I will organize the image and details for a quote.`,
        handoffRequired: false
      },
      source: 'quote_intake_state'
    }
  }
  if (!missing.length) {
    return {
      data: {
        intent: 'nail_quote',
        answerZh: `这款我先看到啦，当前信息是：${quoteIntakeSummary(state)}。如果您想问具体价格，我可以帮您转给技师确认报价；如果只是问能否还原，也需要技师结合细节最终确认。`,
        answerEn: `I see this style. Current details: ${quoteIntakeSummary(state)}. If you want an exact quote, I can send it to the technician; final feasibility also depends on technician review.`,
        handoffRequired: false
      },
      source: 'quote_intake_state'
    }
  }
  return {
    data: {
      intent: 'nail_quote',
      answerZh: `图片/款式我先收到啦。能不能完全还原需要技师结合甲面长度和细节确认；如果您想要我帮您问具体价格，我先确认：${missing.join(' ')} 然后再统一整理给技师。`,
      answerEn: `I have the reference/style. Whether it can be fully recreated depends on nail length and details. If you would like a quote, please confirm: ${(missingQuestions.en || []).join(' ')}`,
      handoffRequired: false
    },
    source: 'quote_intake_state'
  }
}

function resolveQuoteWorkflow(inbound = {}, transcript = [], fallbackReply = null, knowledgeContext = {}) {
  const state = buildQuoteIntakeState(inbound, transcript)
  if (state.serviceType !== 'nail') return { reply: fallbackReply, shouldCreateQuote: false, state, quotePayload: null }
  const missingQuestions = quoteMissingQuestions(state)
  const hasMissingRequired = missingQuestions.zh.length > 0
  const quoteRelated = state.hasReferenceContext || state.priceIntent || state.capabilityIntent || state.contextualFollowup
  if (!quoteRelated) return { reply: fallbackReply, shouldCreateQuote: false, state, quotePayload: null }

  if (state.priceIntent && !hasMissingRequired && state.hasReferenceContext) {
    const reply = quoteIntakeReply('ready_quote', state, missingQuestions)
    return {
      reply,
      shouldCreateQuote: true,
      state,
      quotePayload: {
        serviceType: state.serviceType,
        customerMessage: inbound.content || '',
        referenceImages: state.referenceImages,
        styleElements: {
          customerStage: inbound.customerStage || '',
          sourceChannel: inbound.sourceChannel || '',
          quoteIntake: {
            extensionNeeded: state.extensionNeeded,
            removalNeeded: state.removalNeeded,
            repairNeeded: state.repairNeeded,
            charmsNeeded: state.charmsNeeded,
            trigger: 'explicit_price_ready'
          },
          knowledgeIntents: knowledgeContext.intents || [],
          matchedKnowledgeIds: [
            ...(knowledgeContext.matchedRules || []).map((item) => item.id),
            ...(knowledgeContext.matchedQa || []).map((item) => item.id),
            ...(knowledgeContext.matchedHandoffRules || []).map((item) => item.id)
          ]
        }
      }
    }
  }
  if (state.priceIntent || state.contextualFollowup) return { reply: quoteIntakeReply('ask_missing', state, missingQuestions), shouldCreateQuote: false, state, quotePayload: null }
  if (state.capabilityIntent || state.hasReferenceContext) return { reply: quoteIntakeReply('capability_only', state, missingQuestions), shouldCreateQuote: false, state, quotePayload: null }
  return { reply: fallbackReply, shouldCreateQuote: false, state, quotePayload: null }
}

function isQuoteWaitingCheck(text = '') {
  return /好了吗|有回复吗|报价出来了吗|出价了吗|还要多久|等多久|催一下|ready|anyupdate|quoteready/.test(compactIntentText(text))
}

async function getActiveQuoteForConversation(conversationId) {
  if (!conversationId) return null
  const rows = await query(`
    SELECT * FROM quote_requests
    WHERE conversation_id = $1 AND status = 'PENDING_STAFF'
    ORDER BY updated_at DESC
    LIMIT 1
  `, [conversationId])
  return rows.rows[0] || null
}

function quoteWaitingReply(lang = 'zh') {
  const answerZh = '亲亲，我已经把需求发给技师确认啦，目前还在等技师回价。我会帮您盯着，有回复后第一时间把价格、时长和注意事项发给您。'
  const answerEn = 'I have already sent the request to the technician and we are waiting for the quote. I will keep an eye on it and send you the price, duration, and notes as soon as we have an update.'
  return {
    data: {
      intent: 'quote_waiting',
      answerZh,
      answerEn,
      handoffRequired: false
    },
    source: 'quote_waiting_state'
  }
}

async function handleWecomInbound(inbound, req, options = {}) {
  if (!inbound.content || inbound.msgType === 'event') {
    const conversationId = await recordWecomConversation(inbound, null, 'event_received')
    return { conversationId, inbound, reply: null, outbound: null }
  }
  const context = await buildCustomerServiceContext(req, inbound.lang || 'zh')
  const conversationId = wecomConversationId(inbound.externalUserId)
  const existingRows = await query('SELECT status, transcript_json FROM wechat_conversations WHERE id = $1', [conversationId])
  const existing = existingRows.rows[0]
  const existingTranscript = parseJson(existing?.transcript_json)
  const humanCooldownReleased = shouldReleaseHumanConversationToAi(existing?.status, existingTranscript)
  if (['needs_human', 'human_active'].includes(existing?.status) && !inbound.forceAi && !humanCooldownReleased) {
    const activeQuote = await getActiveQuoteForConversation(conversationId)
    if (activeQuote && isQuoteWaitingCheck(inbound.content || '')) {
      await appendWecomConversationMessage(conversationId, {
        role: 'customer',
        content: inbound.content,
        messageId: inbound.messageId,
        msgType: inbound.msgType,
        referenceImages: inbound.referenceImages || []
      }, {
        provider: inbound.provider,
        externalUserId: inbound.externalUserId,
        openKfid: inbound.openKfid,
        sourceChannel: inbound.sourceChannel,
        status: 'needs_human',
        lastIntent: 'quote_waiting_check',
        lastMessage: inbound.content,
        raw: inbound.raw || {}
      })
      const waitReply = quoteWaitingReply(inbound.lang || 'zh')
      const conversation = await appendWecomConversationMessage(conversationId, {
        role: 'assistant',
        content: waitReply.data.answerZh,
        intent: waitReply.data.intent,
        handoffRequired: false,
        quoteRequestId: activeQuote.id
      }, {
        status: 'needs_human',
        lastIntent: 'quote_waiting_check',
        lastMessage: waitReply.data.answerZh,
        aiReply: waitReply
      })
      return { conversationId, inbound, reply: waitReply, outbound: null, waitingForHuman: true, conversation }
    }
    const nextStatus = existing.status === 'needs_human' ? 'needs_human' : 'human_active'
    const conversation = await appendWecomConversationMessage(conversationId, {
      role: 'customer',
      content: inbound.content,
      messageId: inbound.messageId,
      msgType: inbound.msgType,
      referenceImages: inbound.referenceImages || []
    }, {
      provider: inbound.provider,
      externalUserId: inbound.externalUserId,
      openKfid: inbound.openKfid,
      sourceChannel: inbound.sourceChannel,
      status: nextStatus,
      lastIntent: 'human_followup',
      lastMessage: inbound.content,
      raw: inbound.raw || {}
    })
    return { conversationId, inbound, reply: null, outbound: null, waitingForHuman: true, conversation }
  }
  const testContextNotes = [
    inbound.customerStage ? `测试顾客阶段：${inbound.customerStage}` : '',
    inbound.referenceImages?.length ? `顾客已上传 ${inbound.referenceImages.length} 张参考图，当前阶段只能整理需求并转技师确认，不可直接按图最终报价。` : ''
  ].filter(Boolean)
  const enrichedMessage = `${inbound.content || ''}${testContextNotes.length ? `\n${testContextNotes.join('\n')}` : ''}`
  const knowledgeContext = await attachOwnerApprovedSamples(buildKnowledgeContext({
    lang: inbound.lang || 'zh',
    message: enrichedMessage,
    ...context,
    sourceChannel: inbound.sourceChannel,
    customerStage: inbound.customerStage,
    referenceImages: inbound.referenceImages || []
  }), inbound.lang || 'zh')
  const baseReply = await createCustomerServiceReply({
    lang: inbound.lang || 'zh',
    message: enrichedMessage,
    sampleMatchMessage: inbound.content || '',
    history: aiConversationHistory(existingTranscript),
    knowledgeContext,
    ...context
  })
  const quoteWorkflow = resolveQuoteWorkflow(inbound, existingTranscript, baseReply, knowledgeContext)
  const reply = quoteWorkflow.reply || baseReply
  let outbound = null
  if (options.send !== false) {
    outbound = await sendWecomTextReply(inbound, reply, conversationId)
  }
  await recordWecomConversation(inbound, reply, outbound?.skipped ? 'needs_human' : 'ai_replied', outbound)
  if (quoteWorkflow.shouldCreateQuote) {
    upsertActiveQuoteRequest({
      conversationId,
      sourceChannel: inbound.sourceChannel,
      serviceType: quoteWorkflow.quotePayload?.serviceType || inferServiceTypeFromText(inbound.content || ''),
      customerMessage: quoteWorkflow.quotePayload?.customerMessage || inbound.content || '',
      customerLang: inbound.lang || 'zh',
      referenceImages: quoteWorkflow.quotePayload?.referenceImages || inbound.referenceImages || [],
      extensionNeeded: quoteWorkflow.state?.extensionNeeded,
      removalNeeded: quoteWorkflow.state?.removalNeeded,
      repairNeeded: quoteWorkflow.state?.repairNeeded,
      charmsNeeded: quoteWorkflow.state?.charmsNeeded,
      styleElements: quoteWorkflow.quotePayload?.styleElements || {},
      aiReply: reply
    }).catch((error) => console.error('[quote:create]', error))
  }
  return { conversationId, inbound, reply, outbound, conversation: await getWecomConversation(conversationId) }
}

async function handleWecomSyncToken(inbound, req) {
  if (!inbound.token) return handleWecomInbound(inbound, req)
  const synced = await callWecomGateway('/wecom/sync-messages', {
    token: inbound.token,
    openKfid: inbound.openKfid || WECOM_OPEN_KFID,
    limit: 100
  })
  const handled = []
  for (const message of synced.messages || []) {
    const normalized = normalizeWecomSyncedMessage(message)
    if (!normalized.externalUserId || normalized.msgType !== 'text' || !normalized.content) continue
    handled.push(await handleWecomInbound(normalized, req))
  }
  return { conversationId: handled[0]?.conversationId || null, inbound, syncedCount: (synced.messages || []).length, handledCount: handled.length, handled }
}

async function getWecomConversations() {
  const rows = await query(`
    SELECT *
    FROM wechat_conversations
    ORDER BY updated_at DESC
    LIMIT 80
  `)
  return rows.rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    externalUserId: row.external_user_id,
    openKfid: row.open_kfid,
    sourceChannel: row.source_channel,
    status: row.status,
    lastIntent: row.last_intent,
    lastMessage: row.last_message,
    aiReply: parseJson(row.ai_reply_json),
    transcript: parseJson(row.transcript_json),
    createdAt: row.created_at ? iso(row.created_at) : null,
    updatedAt: row.updated_at ? iso(row.updated_at) : null
  }))
}

async function appendManualWecomReply(conversationId, body = {}, adminSession = {}) {
  const message = String(body.message || body.content || '').trim()
  if (!message) throw apiError(400, 'MESSAGE_REQUIRED', 'Manual reply message is required.')
  const conversation = await appendWecomConversationMessage(conversationId, {
    role: 'staff',
    content: message,
    staffName: body.staffName || adminSession?.email || 'Lucky Luxe Staff',
    intent: 'manual_reply'
  }, {
    status: body.releaseToAi ? 'ai_replied' : 'human_active',
    lastIntent: 'manual_reply',
    lastMessage: message
  })
  return { conversation }
}

function inferServiceTypeFromText(text = '', fallback = 'nail') {
  const value = String(text || '').toLowerCase()
  if (/美睫|睫毛|lash|lashes|eyelash/.test(value)) return 'lash'
  if (/美甲|指甲|甲|nail|nails|manicure/.test(value)) return 'nail'
  return fallback
}

function normalizeQuoteFlag(value) {
  const raw = String(value ?? '').trim()
  const text = raw.toLowerCase()
  const compact = compactIntentText(raw)
  if (['yes', 'true', '需要', '是', '要', '有', '需要的'].includes(text)) return 'yes'
  if (['no', 'false', '不需要', '否', '不要', '无', '没有', '不用'].includes(text)) return 'no'
  if (['partial', '部分', '几根', 'some', '一点'].includes(text)) return 'partial'
  if (/不确定|不知道|都想看|都可以|看情况|maybe|not sure/.test(compact)) return 'unknown'
  if (/不需要|不用|不要|没有|无/.test(compact)) return 'no'
  if (/需要|要|有|第一次|首次|初次|firsttime|firstlash/.test(compact)) return 'yes'
  return text || 'unknown'
}

function quoteMissingQuestions(input) {
  const zh = []
  const en = []
  if (input.serviceType === 'nail') {
    if (input.extensionNeeded === 'unknown') {
      zh.push('请问这款是做本甲还是需要延长？')
      en.push('Is this for natural nails, or do you need extensions?')
    }
    if (input.removalNeeded === 'unknown') {
      zh.push('请问是否需要卸甲？如果是非本店作品，卸甲会另计费用和时间。')
      en.push('Do you need removal? Removal from another salon may add time and cost.')
    }
  }
  if (input.serviceType === 'lash') {
    if (input.lowerLashRequested === 'unknown') {
      zh.push('请问这次是否需要下睫毛服务？')
      en.push('Would you like lower lashes included?')
    }
    if (input.healthCheckClear === 'unknown') {
      zh.push('请问近 3 个月内是否做过眼部手术，或目前是否有结膜炎、红肿等眼部症状？')
      en.push('Have you had eye surgery in the past 3 months, or any current eye irritation, redness, or conjunctivitis?')
    }
  }
  return { zh, en }
}

function normalizeQuoteRequestInput(body = {}, customer = null) {
  const serviceType = inferServiceTypeFromText(`${body.serviceType || ''} ${body.customerMessage || body.message || ''}`, String(body.serviceType || 'nail').toLowerCase())
  const status = ['NEEDS_INFO', 'PENDING_STAFF', 'QUOTED', 'DECLINED', 'DRAFT_CREATED', 'CLOSED'].includes(String(body.status || '').toUpperCase())
    ? String(body.status).toUpperCase()
    : 'PENDING_STAFF'
  const input = {
    id: body.id || randomId('quote'),
    conversationId: body.conversationId || body.conversation_id || null,
    userId: body.userId || body.user_id || customer?.id || null,
    sourceChannel: body.sourceChannel || body.source || '',
    serviceType,
    serviceId: body.serviceId || body.service_id || null,
    technicianId: body.technicianId || body.technician_id || null,
    status,
    customerMessage: body.customerMessage || body.message || '',
    customerLang: body.customerLang || body.lang || 'zh',
    referenceImages: normalizeReferenceImages(body.referenceImages || body.images || []),
    styleElements: {
      ...(body.styleElements && typeof body.styleElements === 'object' ? body.styleElements : {}),
      quoteIntake: body.quoteIntake && typeof body.quoteIntake === 'object'
        ? body.quoteIntake
        : (body.styleElements?.quoteIntake || {})
    },
    extensionNeeded: normalizeQuoteFlag(body.extensionNeeded ?? body.styleElements?.extensionNeeded),
    removalNeeded: normalizeQuoteFlag(body.removalNeeded ?? body.styleElements?.removalNeeded),
    repairNeeded: normalizeQuoteFlag(body.repairNeeded ?? body.styleElements?.repairNeeded),
    charmsNeeded: normalizeQuoteFlag(body.charmsNeeded ?? body.styleElements?.charmsNeeded),
    lowerLashRequested: normalizeQuoteFlag(body.lowerLashRequested ?? body.styleElements?.lowerLashRequested),
    healthCheckClear: normalizeQuoteFlag(body.healthCheckClear ?? body.styleElements?.healthCheckClear),
    firstLashVisit: normalizeQuoteFlag(body.firstLashVisit ?? body.styleElements?.quoteIntake?.firstLashVisit ?? body.styleElements?.firstLashVisit),
    aiReply: body.aiReply || body.reply || {}
  }
  const questions = quoteMissingQuestions(input)
  input.missingQuestions = questions
  return input
}

function serializeQuoteRequest(row) {
  if (!row) return null
  const styleElements = parseJson(row.style_elements_json)
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    sourceChannel: row.source_channel,
    serviceType: row.service_type,
    serviceId: row.service_id,
    technicianId: row.technician_id,
    status: row.status,
    customerMessage: row.customer_message,
    customerLang: row.customer_lang,
    referenceImages: parseJson(row.reference_images_json),
    styleElements,
    missingQuestions: parseJson(row.missing_questions_json),
    extensionNeeded: row.extension_needed,
    removalNeeded: row.removal_needed,
    repairNeeded: row.repair_needed,
    charmsNeeded: row.charms_needed,
    lowerLashRequested: row.lower_lash_requested,
    healthCheckClear: row.health_check_clear,
    firstLashVisit: normalizeQuoteFlag(styleElements?.quoteIntake?.firstLashVisit ?? styleElements?.firstLashVisit),
    staffCanDo: row.staff_can_do,
    staffPriceCents: row.staff_price_cents,
    staffPrice: row.staff_price_cents === null || row.staff_price_cents === undefined ? null : cents(row.staff_price_cents),
    staffDurationMin: row.staff_duration_min,
    staffNotes: row.staff_notes,
    aiReply: parseJson(row.ai_reply_json),
    draftBookingId: row.draft_booking_id,
    expiresAt: row.expires_at ? iso(row.expires_at) : null,
    createdAt: row.created_at ? iso(row.created_at) : null,
    updatedAt: row.updated_at ? iso(row.updated_at) : null
  }
}

async function getQuoteRequestById(id) {
  const row = await query('SELECT * FROM quote_requests WHERE id = $1', [id])
  return row.rows[0] ? serializeQuoteRequest(row.rows[0]) : null
}

function formatCadFromCents(value) {
  const centsValue = Number(value || 0)
  if (!Number.isFinite(centsValue) || centsValue <= 0) return ''
  const amount = centsValue / 100
  return Number.isInteger(amount) ? `CAD $${amount}` : `CAD $${amount.toFixed(2)}`
}

function quoteAssistantReplyPayload(quote, { canDo, priceCents, durationMin, notes }) {
  const priceLabel = formatCadFromCents(priceCents)
  const durationZh = durationMin ? `${durationMin} 分钟` : '时长到店再确认'
  const draftPromptZh = canDo
    ? '如果您想继续预约，我可以接着帮您生成一个 30 分钟有效的预约草稿链接，您点进去确认时间并完成定金/免定金流程即可。'
    : '如果您愿意，也可以再发一张更接近想要效果的参考图，我会重新帮您整理给技师确认。'
  const draftPromptEn = canDo
    ? 'If you would like to book, I can create a booking draft link valid for 30 minutes. You can open it to confirm the time and complete the deposit/deposit-waiver flow.'
    : 'If you would like, you can send another reference photo closer to your desired look and I will organize it for the technician again.'
  const answerZh = [
    canDo ? '技师刚刚确认啦，这款可以做。' : '技师看过后，这款暂时需要进一步人工确认。',
    canDo && priceLabel ? `预估价格是 ${priceLabel}` : '',
    canDo ? `预计服务时长 ${durationZh}` : '',
    notes ? `技师备注：${notes}` : '',
    '最终细节会以到店沟通和实际甲面/睫毛状态为准。',
    draftPromptZh
  ].filter(Boolean).join(' ')
  const answerEn = [
    canDo ? 'The technician has confirmed that this style can be done.' : 'The technician reviewed it and this style needs further manual confirmation.',
    canDo && priceLabel ? `Estimated price: ${priceLabel}.` : '',
    canDo ? `Estimated duration: ${durationMin ? `${durationMin} min` : 'to be confirmed in store'}.` : '',
    notes ? `Technician note: ${notes}` : '',
    'Final details are confirmed in store based on the actual nail/lash condition.',
    draftPromptEn
  ].filter(Boolean).join(' ')
  return {
    intent: 'pricing',
    answerZh,
    answerEn,
    handoffRequired: false,
    handoffReasonZh: '',
    handoffReasonEn: '',
    quoteRequestId: quote?.id || null,
    suggestedActions: canDo ? ['create_quote_draft'] : ['request_more_info']
  }
}

async function appendQuoteAssistantReply(quote, payload) {
  if (!quote?.conversationId) return null
  const text = quote.customerLang === 'en' ? payload.answerEn : payload.answerZh
  return appendWecomConversationMessage(quote.conversationId, {
    role: 'assistant',
    content: text,
    intent: 'pricing',
    quoteRequestId: quote.id,
    handoffRequired: false
  }, {
    status: 'ai_replied',
    lastIntent: 'pricing_quote_returned',
    lastMessage: text,
    aiReply: { data: payload, source: 'staff_quote_polished' }
  })
}

function firstLashVisitFromQuote(quote = {}) {
  return normalizeQuoteFlag(
    quote.firstLashVisit
      ?? quote.styleElements?.quoteIntake?.firstLashVisit
      ?? quote.styleElements?.firstLashVisit
  )
}

function firstTimeLashNoticePayload(quote = {}) {
  const answerZh = [
    '第一次做美睫的小提醒：',
    '1. 如果近 3 个月做过眼部手术、近期有结膜炎/红肿/发炎/过敏，或眼部正在不舒服，请提前告诉我们，必要时先暂停服务。',
    '2. 第一次建议先选择自然或轻盈款，舒适度和适应度会更好；后续可以根据喜欢的效果再加密。',
    '3. 到店当天尽量不要画睫毛膏或浓眼妆，保持眼周清洁，方便技师更准确判断睫毛状态。',
    '4. 操作过程中如果有明显刺痛、熏眼、流泪或不舒服，请马上告诉技师，我们会及时调整。',
    '5. 做完后 6 小时内尽量避免水汽、揉眼和油性卸妆；24 小时内尽量避免桑拿、汗蒸或长时间热水蒸汽。'
  ].join('\n')
  const answerEn = [
    'A quick note for your first lash appointment:',
    '1. Please tell us in advance if you had eye surgery within the past 3 months, currently have conjunctivitis, redness, inflammation, allergy, or any eye discomfort. In some cases, we may suggest pausing the service first.',
    '2. For a first set, a natural or lightweight style is usually more comfortable while you get used to the feeling. We can add more volume in future appointments if you like.',
    '3. On the appointment day, please avoid mascara or heavy eye makeup and keep the eye area clean so the technician can assess your natural lashes more accurately.',
    '4. During the service, please tell the technician immediately if you feel stinging, fumes, tearing, or discomfort, so we can adjust right away.',
    '5. After the service, try to avoid steam, rubbing your eyes, and oil-based remover for the first 6 hours; avoid sauna, sweat steaming, or long hot-steam exposure for the first 24 hours.'
  ].join('\n')
  return {
    intent: 'first_time_lash_notice',
    answerZh,
    answerEn,
    handoffRequired: false,
    handoffReasonZh: '',
    handoffReasonEn: '',
    quoteRequestId: quote?.id || null,
    suggestedActions: ['read_first_time_lash_notice']
  }
}

async function appendFirstTimeLashNoticeIfNeeded(quote = {}) {
  if (!quote?.conversationId || quote.serviceType !== 'lash' || firstLashVisitFromQuote(quote) !== 'yes') return null
  const conversation = await getWecomConversation(quote.conversationId)
  const transcript = conversation?.transcript || []
  const alreadySent = transcript.some((item) => item?.intent === 'first_time_lash_notice')
  if (alreadySent) return conversation
  const payload = firstTimeLashNoticePayload(quote)
  const text = quote.customerLang === 'en' ? payload.answerEn : payload.answerZh
  return appendWecomConversationMessage(quote.conversationId, {
    role: 'assistant',
    content: text,
    intent: 'first_time_lash_notice',
    quoteRequestId: quote.id,
    handoffRequired: false
  }, {
    status: 'ai_replied',
    lastIntent: 'first_time_lash_notice',
    lastMessage: text,
    aiReply: { data: payload, source: 'first_time_lash_notice' }
  })
}

function quoteDraftLink(quoteId) {
  return `https://www.luckyluxeatelier.com/?quoteDraft=${encodeURIComponent(quoteId)}&hold=30`
}

async function appendQuoteDraftAssistantReply(quote) {
  if (!quote?.conversationId) return null
  const link = quoteDraftLink(quote.id)
  const textZh = `我已经帮您生成预约草稿啦：${link} 。这个草稿会为您保留 30 分钟，您可以点进去确认服务、时间和定金/免定金状态。`
  const textEn = `I have created your booking draft: ${link}. This draft is held for 30 minutes, and you can open it to confirm the service, time, and deposit/deposit-waiver status.`
  const text = quote.customerLang === 'en' ? textEn : textZh
  return appendWecomConversationMessage(quote.conversationId, {
    role: 'assistant',
    content: text,
    intent: 'booking_draft',
    quoteRequestId: quote.id,
    draftLink: link,
    handoffRequired: false
  }, {
    status: 'ai_replied',
    lastIntent: 'booking_draft_created',
    lastMessage: text,
    aiReply: { data: { intent: 'booking', answerZh: textZh, answerEn: textEn, quoteRequestId: quote.id, draftLink: link }, source: 'quote_draft_mock' }
  })
}

async function scheduleReminderTask({ userId = null, bookingId = null, quoteRequestId = null, conversationId = null, type, channel = 'mock', scheduledAt, payload = {} }) {
  const id = randomId('reminder')
  await query(`
    INSERT INTO reminder_tasks (id, user_id, booking_id, quote_request_id, conversation_id, type, channel, status, scheduled_at, payload_json)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', $8, $9::jsonb)
  `, [id, userId, bookingId, quoteRequestId, conversationId, type, channel, iso(scheduledAt || new Date()), JSON.stringify(payload)])
  return id
}

async function createQuoteRequest(body = {}, customer = null) {
  const input = normalizeQuoteRequestInput(body, customer)
  await query(`
    INSERT INTO quote_requests
      (id, conversation_id, user_id, source_channel, service_type, service_id, technician_id, status, customer_message, customer_lang,
       reference_images_json, style_elements_json, missing_questions_json, extension_needed, removal_needed, repair_needed, charms_needed,
       lower_lash_requested, health_check_clear, ai_reply_json)
    VALUES
      ($1, $2, $3, NULLIF($4, ''), $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14, $15, $16, $17, $18, $19, $20::jsonb)
  `, [
    input.id,
    input.conversationId,
    input.userId,
    input.sourceChannel,
    input.serviceType,
    input.serviceId,
    input.technicianId,
    input.status,
    input.customerMessage,
    input.customerLang,
    JSON.stringify(input.referenceImages),
    JSON.stringify(input.styleElements),
    JSON.stringify(input.missingQuestions),
    input.extensionNeeded,
    input.removalNeeded,
    input.repairNeeded,
    input.charmsNeeded,
    input.lowerLashRequested,
    input.healthCheckClear,
    JSON.stringify(input.aiReply)
  ])
  await scheduleReminderTask({
    userId: input.userId,
    quoteRequestId: input.id,
    conversationId: input.conversationId,
    type: 'QUOTE_STAFF_RESPONSE_10_MIN',
    channel: 'wechat_or_web',
    scheduledAt: addMinutes(new Date(), 10),
    payload: {
      messageZh: '技师仍在忙，我会在收到回复后第一时间通知您。',
      messageEn: 'The technician is still busy. I will notify you as soon as we receive a reply.'
    }
  })
  return getQuoteRequestById(input.id)
}

async function upsertActiveQuoteRequest(body = {}, customer = null) {
  const input = normalizeQuoteRequestInput(body, customer)
  if (!input.conversationId) return createQuoteRequest(body, customer)
  const existingRows = await query(`
    SELECT * FROM quote_requests
    WHERE conversation_id = $1 AND status IN ('PENDING_STAFF', 'NEEDS_INFO')
    ORDER BY updated_at DESC
    LIMIT 1
  `, [input.conversationId])
  const existing = existingRows.rows[0]
  if (!existing) return createQuoteRequest(body, customer)

  const existingImages = parseJson(existing.reference_images_json)
  const mergedImages = mergeReferenceImages(existingImages, input.referenceImages)
  const existingStyle = parseJson(existing.style_elements_json)
  const styleElements = {
    ...existingStyle,
    ...input.styleElements,
    quoteIntake: {
      ...(existingStyle.quoteIntake || {}),
      ...(input.styleElements.quoteIntake || {})
    }
  }
  await query(`
    UPDATE quote_requests
    SET source_channel = COALESCE(NULLIF($1, ''), source_channel),
        service_type = $2,
        service_id = COALESCE($3, service_id),
        technician_id = COALESCE($4, technician_id),
        status = 'PENDING_STAFF',
        customer_message = $5,
        customer_lang = $6,
        reference_images_json = $7::jsonb,
        style_elements_json = $8::jsonb,
        missing_questions_json = $9::jsonb,
        extension_needed = $10,
        removal_needed = $11,
        repair_needed = $12,
        charms_needed = $13,
        lower_lash_requested = $14,
        health_check_clear = $15,
        ai_reply_json = $16::jsonb,
        updated_at = now()
    WHERE id = $17
  `, [
    input.sourceChannel,
    input.serviceType,
    input.serviceId,
    input.technicianId,
    input.customerMessage,
    input.customerLang,
    JSON.stringify(mergedImages),
    JSON.stringify(styleElements),
    JSON.stringify(input.missingQuestions),
    input.extensionNeeded,
    input.removalNeeded,
    input.repairNeeded,
    input.charmsNeeded,
    input.lowerLashRequested,
    input.healthCheckClear,
    JSON.stringify(input.aiReply),
    existing.id
  ])
  return getQuoteRequestById(existing.id)
}

function assertStaffCanAccessQuote(admin, quote) {
  if (admin.role === 'staff' && quote.technician_id && quote.technician_id !== admin.technicianId) {
    throw apiError(403, 'FORBIDDEN', 'Staff can only access quote requests assigned to them.')
  }
}

async function getAdminQuoteRequests(admin) {
  const rows = admin.role === 'staff'
    ? await query('SELECT * FROM quote_requests WHERE technician_id = $1 OR technician_id IS NULL ORDER BY updated_at DESC', [admin.technicianId])
    : await query('SELECT * FROM quote_requests ORDER BY updated_at DESC LIMIT 120')
  return rows.rows.map(serializeQuoteRequest)
}

async function respondQuoteRequest(id, body, admin) {
  const current = await query('SELECT * FROM quote_requests WHERE id = $1', [id])
  if (!current.rows[0]) throw apiError(404, 'NOT_FOUND', 'Quote request not found.')
  assertStaffCanAccessQuote(admin, current.rows[0])
  const canDo = body.canDo === false || body.canDo === 'no' ? false : true
  const priceCents = body.priceCents !== undefined ? Number(body.priceCents) : Math.round(Number(body.price || 0) * 100)
  const durationMin = body.durationMin !== undefined ? Number(body.durationMin) : null
  const notes = String(body.notes || body.staffNotes || '').trim()
  const aiReply = quoteAssistantReplyPayload(serializeQuoteRequest(current.rows[0]), { canDo, priceCents, durationMin, notes })
  await query(`
    UPDATE quote_requests
    SET status = $1, technician_id = COALESCE($2, technician_id), staff_can_do = $3, staff_price_cents = $4,
        staff_duration_min = $5, staff_notes = $6, ai_reply_json = $7::jsonb, updated_at = now()
    WHERE id = $8
  `, [canDo ? 'QUOTED' : 'DECLINED', body.technicianId || admin.technicianId || null, canDo, canDo ? priceCents : null, durationMin, notes, JSON.stringify(aiReply), id])
  const quote = await getQuoteRequestById(id)
  let conversation = await appendQuoteAssistantReply(quote, aiReply)
  const firstLashNoticeConversation = await appendFirstTimeLashNoticeIfNeeded(quote)
  if (firstLashNoticeConversation) conversation = firstLashNoticeConversation
  return { ...quote, conversation }
}

async function createQuoteDraftHold(id, body, admin) {
  const current = await query('SELECT * FROM quote_requests WHERE id = $1', [id])
  if (!current.rows[0]) throw apiError(404, 'NOT_FOUND', 'Quote request not found.')
  assertStaffCanAccessQuote(admin, current.rows[0])
  const expiresAt = addMinutes(new Date(), HOLD_MINUTES)
  await query(`
    UPDATE quote_requests
    SET status = 'DRAFT_CREATED', expires_at = $1, draft_booking_id = COALESCE($2, draft_booking_id), updated_at = now()
    WHERE id = $3
  `, [iso(expiresAt), body.bookingId || null, id])
  await scheduleReminderTask({
    userId: current.rows[0].user_id,
    bookingId: body.bookingId || null,
    quoteRequestId: id,
    conversationId: current.rows[0].conversation_id,
    type: 'DRAFT_PAYMENT_REMINDER',
    channel: 'wechat_or_web',
    scheduledAt: addMinutes(new Date(), DRAFT_PAYMENT_REMINDER_MINUTES),
    payload: { holdMinutes: HOLD_MINUTES, reminderMinutes: DRAFT_PAYMENT_REMINDER_MINUTES }
  })
  await scheduleReminderTask({
    userId: current.rows[0].user_id,
    bookingId: body.bookingId || null,
    quoteRequestId: id,
    conversationId: current.rows[0].conversation_id,
    type: 'DRAFT_RELEASE',
    channel: 'system',
    scheduledAt: expiresAt,
    payload: { holdMinutes: HOLD_MINUTES }
  })
  const quote = await getQuoteRequestById(id)
  const conversation = await appendQuoteDraftAssistantReply(quote)
  return { ...quote, conversation }
}

async function getAdminReminderTasks(admin) {
  const params = []
  let sql = 'SELECT rt.* FROM reminder_tasks rt'
  if (admin.role === 'staff') {
    sql += ' LEFT JOIN quote_requests qr ON qr.id = rt.quote_request_id WHERE qr.technician_id = $1 OR qr.technician_id IS NULL'
    params.push(admin.technicianId)
  }
  sql += ' ORDER BY rt.scheduled_at ASC LIMIT 160'
  const rows = await query(sql, params)
  return rows.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    bookingId: row.booking_id,
    quoteRequestId: row.quote_request_id,
    conversationId: row.conversation_id,
    type: row.type,
    channel: row.channel,
    status: row.status,
    scheduledAt: row.scheduled_at ? iso(row.scheduled_at) : null,
    sentAt: row.sent_at ? iso(row.sent_at) : null,
    payload: parseJson(row.payload_json),
    createdAt: row.created_at ? iso(row.created_at) : null,
    updatedAt: row.updated_at ? iso(row.updated_at) : null
  }))
}

async function markReminderTask(id, status = 'SENT') {
  const valid = ['PENDING', 'SENT', 'SKIPPED', 'FAILED'].includes(status) ? status : 'SENT'
  await query("UPDATE reminder_tasks SET status = $1, sent_at = CASE WHEN $1 = 'SENT' THEN now() ELSE sent_at END, updated_at = now() WHERE id = $2", [valid, id])
  const rows = await query('SELECT * FROM reminder_tasks WHERE id = $1', [id])
  if (!rows.rows[0]) throw apiError(404, 'NOT_FOUND', 'Reminder task not found.')
  return rows.rows[0]
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

async function supabaseFetch(path, options = {}) {
  if (!isSupabaseConfigured()) throw apiError(503, 'AUTH_NOT_CONFIGURED', 'Supabase Auth is not configured.')
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw apiError(response.status, data.error_code || data.code || 'SUPABASE_AUTH_ERROR', data.msg || data.message || 'Supabase Auth request failed.')
  return data
}

async function getSupabaseUser(accessToken) {
  return supabaseFetch('/auth/v1/user', {
    headers: { authorization: `Bearer ${accessToken}` }
  })
}

function authUserName(authUser, fallback = 'Lucky Member') {
  return authUser.user_metadata?.display_name || authUser.user_metadata?.full_name || authUser.user_metadata?.name || authUser.email?.split('@')[0] || fallback
}

async function upsertAuthUser(authUser, provider = 'email') {
  const authId = authUser.id
  const email = String(authUser.email || '').trim().toLowerCase()
  if (!authId || !email) throw apiError(400, 'BAD_AUTH_USER', 'Authenticated user is missing id or email.')
  const existing = await query('SELECT * FROM users WHERE supabase_auth_id = $1 OR email = $2 ORDER BY created_at ASC LIMIT 1', [authId, email])
  if (existing.rows[0]) {
    await query('UPDATE users SET supabase_auth_id = $1, display_name = $2, email = $3, google_id = COALESCE(google_id, $4) WHERE id = $5',
      [authId, authUserName(authUser), email, provider === 'google' ? authId : null, existing.rows[0].id])
    const updated = await query('SELECT * FROM users WHERE id = $1', [existing.rows[0].id])
    await upsertUserIdentity({ userId: updated.rows[0].id, provider, providerUserId: authId, email })
    return serializeUser(updated.rows[0])
  }
  const id = randomId('user')
  await query('INSERT INTO users (id, supabase_auth_id, display_name, email, google_id) VALUES ($1, $2, $3, $4, $5)',
    [id, authId, authUserName(authUser), email, provider === 'google' ? authId : null])
  const created = await query('SELECT * FROM users WHERE id = $1', [id])
  await upsertUserIdentity({ userId: id, provider, providerUserId: authId, email })
  return serializeUser(created.rows[0])
}

function authPayload(data) {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    tokenType: data.token_type
  }
}

async function signUpEmailUser(body) {
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  const displayName = String(body.displayName || '').trim() || email.split('@')[0] || 'Lucky Member'
  if (!email || !email.includes('@')) throw apiError(400, 'BAD_REQUEST', 'A valid email is required.')
  if (!isSupabaseConfigured()) return { user: await registerEmailUser(body), auth: demoAuthFor(email), mode: 'demo' }
  if (password.length < 6) throw apiError(400, 'BAD_REQUEST', 'Password must be at least 6 characters.')
  const params = new URLSearchParams({ redirect_to: `${publicAppUrl()}/` })
  const data = await supabaseFetch(`/auth/v1/signup?${params.toString()}`, {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      data: { display_name: displayName }
    })
  })
  const authUser = data.user
  const user = authUser ? await upsertAuthUser({ ...authUser, email, user_metadata: { ...(authUser.user_metadata || {}), display_name: displayName } }, 'email') : null
  return {
    user,
    auth: data.session ? authPayload(data.session) : null,
    needsEmailConfirmation: Boolean(!data.session),
    mode: 'supabase'
  }
}

async function resendSignupConfirmation(body) {
  const email = String(body.email || '').trim().toLowerCase()
  if (!email || !email.includes('@')) throw apiError(400, 'BAD_REQUEST', 'A valid email is required.')
  if (!isSupabaseConfigured()) return { sent: true, mode: 'demo' }
  await supabaseFetch('/auth/v1/resend', {
    method: 'POST',
    body: JSON.stringify({
      type: 'signup',
      email,
      options: { email_redirect_to: `${publicAppUrl()}/` }
    })
  })
  return { sent: true, mode: 'supabase' }
}

async function signInEmailUser(body) {
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  if (!email || !password) throw apiError(400, 'BAD_REQUEST', 'Email and password are required.')
  if (!isSupabaseConfigured()) return { user: await registerEmailUser({ email, displayName: body.displayName }), auth: demoAuthFor(email), mode: 'demo' }
  const data = await supabaseFetch('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  })
  const user = await upsertAuthUser(data.user, 'email')
  return { user, auth: authPayload(data), mode: 'supabase' }
}

async function syncSupabaseSession(body) {
  const accessToken = String(body.accessToken || '')
  if (!accessToken) throw apiError(400, 'BAD_REQUEST', 'accessToken is required.')
  const authUser = await getSupabaseUser(accessToken)
  const provider = authUser.app_metadata?.provider || 'email'
  const user = await upsertAuthUser(authUser, provider)
  return { user, auth: { accessToken, refreshToken: body.refreshToken || null }, mode: 'supabase' }
}

async function refreshSupabaseSession(body) {
  const refreshToken = String(body.refreshToken || '')
  if (!refreshToken) throw apiError(400, 'BAD_REQUEST', 'refreshToken is required.')
  if (!isSupabaseConfigured()) throw apiError(503, 'AUTH_NOT_CONFIGURED', 'Supabase Auth is not configured.')
  const data = await supabaseFetch('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken })
  })
  const user = await upsertAuthUser(data.user, data.user?.app_metadata?.provider || 'email')
  return { user, auth: authPayload(data), mode: 'supabase' }
}

function googleAuthUrl(redirectTo) {
  if (!isSupabaseConfigured()) throw apiError(503, 'AUTH_NOT_CONFIGURED', 'Supabase Auth is not configured.')
  const target = redirectTo || `${APP_PUBLIC_URL || ''}/`
  const params = new URLSearchParams({
    provider: 'google',
    redirect_to: target
  })
  return `${SUPABASE_URL}/auth/v1/authorize?${params.toString()}`
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
    referenceImages: normalizeReferenceImages(body.referenceImages),
    sourceChannel: body.sourceChannel || body.source || body.channel || null,
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
  if (existing.rows[0]) {
    await upsertUserIdentity({ userId: existing.rows[0].id, provider: 'email', providerUserId: email, email })
    return serializeUser(existing.rows[0])
  }
  const id = randomId('user')
  await query('INSERT INTO users (id, display_name, email) VALUES ($1, $2, $3)', [id, displayName, email])
  await upsertUserIdentity({ userId: id, provider: 'email', providerUserId: email, email })
  const created = await query('SELECT * FROM users WHERE id = $1', [id])
  return serializeUser(created.rows[0])
}

async function signInWechatMiniUser(body) {
  if (!WECHAT_MINI_APPID || !WECHAT_MINI_SECRET) {
    throw apiError(503, 'WECHAT_MINI_NOT_CONFIGURED', 'WeChat Mini Program credentials are not configured on the server.')
  }
  const code = String(body.code || '').trim()
  if (!code) throw apiError(400, 'BAD_REQUEST', 'wx.login code is required.')
  const params = new URLSearchParams({
    appid: WECHAT_MINI_APPID,
    secret: WECHAT_MINI_SECRET,
    js_code: code,
    grant_type: 'authorization_code'
  })
  const response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${params.toString()}`)
  const data = await response.json()
  if (!response.ok || data.errcode || !data.openid) {
    throw apiError(401, 'WECHAT_LOGIN_FAILED', data.errmsg || 'WeChat mini login failed.')
  }
  const incomingDisplayName = String(body.displayName || '').trim()
  const phone = String(body.phone || '').trim()
  const existing = await query(`
    SELECT users.* FROM user_identities
    JOIN users ON users.id = user_identities.user_id
    WHERE user_identities.provider = $1 AND user_identities.provider_user_id = $2
    UNION
    SELECT * FROM users WHERE wechat_open_id = $2
    LIMIT 1
  `, ['wechat_miniprogram', data.openid])
  let user = existing.rows[0]
  if (!user) {
    const id = randomId('user')
    const displayName = isGenericDisplayName(incomingDisplayName, id) ? displayNameForUserId(id) : incomingDisplayName
    await query('INSERT INTO users (id, display_name, phone, wechat_open_id) VALUES ($1, $2, NULLIF($3, \'\'), $4)', [id, displayName, phone, data.openid])
    const created = await query('SELECT * FROM users WHERE id = $1', [id])
    user = created.rows[0]
  } else {
    const nextDisplayName = isGenericDisplayName(incomingDisplayName, user.id) ? user.display_name : incomingDisplayName
    await query('UPDATE users SET display_name = $1, phone = COALESCE(NULLIF($2, \'\'), phone), wechat_open_id = COALESCE(wechat_open_id, $3) WHERE id = $4', [nextDisplayName, phone, data.openid, user.id])
    const updated = await query('SELECT * FROM users WHERE id = $1', [user.id])
    user = updated.rows[0]
  }
  await upsertUserIdentity({
    userId: user.id,
    provider: 'wechat_miniprogram',
    providerUserId: data.openid,
    unionId: data.unionid || '',
    phone
  })
  const serialized = await serializeUser(user)
  return {
    user: serialized,
    auth: miniAuthFor(serialized, data.openid),
    mode: 'wechat-mini'
  }
}

async function registerGoogleDemoUser(body) {
  const email = String(body.email || 'google.demo@luckyluxe.local').trim().toLowerCase()
  const displayName = String(body.displayName || 'Google Member').trim()
  const googleId = `demo-google-${email}`
  const existing = await query('SELECT * FROM users WHERE google_id = $1 OR email = $2', [googleId, email])
  if (existing.rows[0]) {
    await upsertUserIdentity({ userId: existing.rows[0].id, provider: 'google', providerUserId: googleId, email })
    return serializeUser(existing.rows[0])
  }
  const id = randomId('user')
  await query('INSERT INTO users (id, display_name, email, google_id) VALUES ($1, $2, $3, $4)', [id, displayName, email, googleId])
  await upsertUserIdentity({ userId: id, provider: 'google', providerUserId: googleId, email })
  const created = await query('SELECT * FROM users WHERE id = $1', [id])
  return serializeUser(created.rows[0])
}

async function createBooking(body, customer = null) {
  await expireOldHolds()
  const input = validateBookingInput(body)
  if (customer) input.userId = customer.id
  const bookingId = randomId('booking')
  await withTransaction(async (client) => {
    const { service, durationMin, start, end } = await assertBookable(input, client)
    const slots = buildSlotStarts(start, durationMin)
    const addOnTotal = input.addOns.reduce((total, item) => total + Number(item.priceCents || 0), 0)
    const servicePriceCents = service.price_cents + addOnTotal
    const user = input.userId ? await client.query('SELECT * FROM users WHERE id = $1', [input.userId]) : { rows: [] }
    const serializedUser = user.rows[0] ? await serializeUser(user.rows[0]) : null
    const depositRequiredCents = 5000
    const depositWaivedCents = serializedUser?.depositWaived ? depositRequiredCents : 0
    const depositCents = Math.max(0, depositRequiredCents - depositWaivedCents)
    const status = depositCents > 0 ? 'PENDING_PAYMENT' : 'CONFIRMED'
    const waiveReason = depositWaivedCents > 0 ? `${serializedUser.memberLevel} member deposit waived` : null

    await client.query(`
      INSERT INTO bookings
      (id, public_code, user_id, store_id, technician_id, service_id, status, appointment_start, appointment_end, addons_json, reference_images_json, source_channel, notes, service_price_cents, deposit_cents, deposit_required_cents, deposit_waived_cents, deposit_waive_reason, member_level_at_booking, final_due_cents, total_duration_min, payment_expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, CASE WHEN $15::int > 0 THEN now() + ($22::int * interval '1 minute') ELSE NULL END)
    `, [bookingId, publicCode(), input.userId, input.storeId, input.technicianId, input.serviceId, status, iso(start), iso(end), JSON.stringify(input.addOns), JSON.stringify(input.referenceImages), input.sourceChannel, input.notes, servicePriceCents, depositCents, depositRequiredCents, depositWaivedCents, waiveReason, serializedUser?.memberLevel || null, servicePriceCents - depositCents, durationMin, HOLD_MINUTES])

    for (const slot of slots) {
      await client.query('INSERT INTO booking_slots (id, booking_id, technician_id, starts_at) VALUES ($1, $2, $3, $4)', [randomId('slot'), bookingId, input.technicianId, iso(slot)])
    }

    await client.query('INSERT INTO payments (id, booking_id, provider, status, amount_cents, currency) VALUES ($1, $2, $3, $4, $5, $6)', [randomId('pay'), bookingId, 'MOCK', depositCents > 0 ? 'REQUIRES_PAYMENT' : 'PAID', depositCents, 'CAD'])
    await client.query('INSERT INTO booking_status_history (id, booking_id, to_status, note) VALUES ($1, $2, $3, $4)', [randomId('hist'), bookingId, status, depositCents > 0 ? 'Booking hold created pending deposit payment.' : 'Booking confirmed with member deposit waiver.'])
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

async function confirmPaidBooking(bookingId, provider, transactionId, note) {
  const existing = await query('SELECT * FROM bookings WHERE id = $1', [bookingId])
  const booking = existing.rows[0]
  if (!booking) throw apiError(404, 'NOT_FOUND', 'Booking not found.')
  if (booking.status === 'CONFIRMED') return serializeBooking(booking)
  if (booking.status !== 'PENDING_PAYMENT') throw apiError(400, 'BAD_REQUEST', 'Only pending bookings can be paid.')
  if (new Date(booking.payment_expires_at) < new Date()) throw apiError(400, 'BAD_REQUEST', 'Payment hold has expired.')

  await withTransaction(async (client) => {
    await client.query('UPDATE payments SET provider = $1, status = $2, transaction_id = $3, updated_at = now() WHERE booking_id = $4 AND status = $5',
      [provider, 'PAID', transactionId, bookingId, 'REQUIRES_PAYMENT'])
    await client.query("UPDATE bookings SET status = 'CONFIRMED', updated_at = now() WHERE id = $1", [bookingId])
    await client.query('INSERT INTO booking_status_history (id, booking_id, from_status, to_status, note) VALUES ($1, $2, $3, $4, $5)',
      [randomId('hist'), bookingId, 'PENDING_PAYMENT', 'CONFIRMED', note])
  })
  const row = await query('SELECT * FROM bookings WHERE id = $1', [bookingId])
  return serializeBooking(row.rows[0])
}

async function stripeRequest(path, options = {}) {
  if (!isStripeConfigured()) throw apiError(503, 'STRIPE_NOT_CONFIGURED', 'Stripe is not configured.')
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      ...(options.headers || {})
    }
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw apiError(response.status, data.error?.code || 'STRIPE_ERROR', data.error?.message || 'Stripe request failed.')
  return data
}

async function createStripeCheckout(body, req) {
  await expireOldHolds()
  const bookingId = body.bookingId
  if (!bookingId) throw apiError(400, 'BAD_REQUEST', 'bookingId is required.')
  if (!isStripeConfigured()) {
    return { provider: 'mock', booking: await confirmMockPayment({ bookingId }) }
  }
  const row = await query('SELECT * FROM bookings WHERE id = $1', [bookingId])
  const booking = row.rows[0]
  if (!booking) throw apiError(404, 'NOT_FOUND', 'Booking not found.')
  if (booking.status !== 'PENDING_PAYMENT') throw apiError(400, 'BAD_REQUEST', 'Only pending bookings can be paid.')
  const service = await getService(booking.service_id)
  const origin = APP_PUBLIC_URL || `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`
  const params = new URLSearchParams()
  params.set('mode', 'payment')
  params.set('client_reference_id', bookingId)
  params.set('success_url', `${origin}/?payment=success&session_id={CHECKOUT_SESSION_ID}`)
  params.set('cancel_url', `${origin}/?payment=cancelled&booking_id=${encodeURIComponent(bookingId)}`)
  params.set('line_items[0][quantity]', '1')
  params.set('line_items[0][price_data][currency]', 'cad')
  params.set('line_items[0][price_data][unit_amount]', String(booking.deposit_cents))
  params.set('line_items[0][price_data][product_data][name]', `${service?.name_en || 'Lucky Luxe'} deposit`)
  params.set('line_items[0][price_data][product_data][description]', `Booking ${booking.public_code}`)
  params.set('metadata[bookingId]', bookingId)
  params.set('metadata[publicCode]', booking.public_code)
  const session = await stripeRequest('/checkout/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params
  })
  await query('UPDATE payments SET provider = $1, transaction_id = $2, updated_at = now() WHERE booking_id = $3 AND status = $4',
    ['STRIPE', session.id, bookingId, 'REQUIRES_PAYMENT'])
  return { provider: 'stripe', checkoutUrl: session.url, sessionId: session.id, bookingId }
}

async function confirmStripeSession(body) {
  const sessionId = String(body.sessionId || '')
  if (!sessionId) throw apiError(400, 'BAD_REQUEST', 'sessionId is required.')
  const session = await stripeRequest(`/checkout/sessions/${encodeURIComponent(sessionId)}`, { method: 'GET' })
  if (session.payment_status !== 'paid') throw apiError(400, 'PAYMENT_NOT_PAID', 'Stripe session is not paid yet.')
  const bookingId = session.metadata?.bookingId || session.client_reference_id
  return {
    booking: await confirmPaidBooking(bookingId, 'STRIPE', session.payment_intent || session.id, 'Stripe deposit payment confirmed.'),
    sessionId: session.id
  }
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

async function getAdminCustomers() {
  const rows = await query(`
    SELECT
      u.id,
      u.display_name,
      u.phone,
      u.email,
      u.created_at,
      COUNT(b.id)::int AS visit_count,
      MAX(b.appointment_start) AS last_visit_at,
      COALESCE(SUM(CASE WHEN b.status = 'COMPLETED' THEN b.service_price_cents ELSE 0 END), 0)::int AS total_spent_cents
    FROM users u
    LEFT JOIN bookings b ON b.user_id = u.id
    GROUP BY u.id
    ORDER BY LOWER(u.display_name) ASC
  `)
  return rows.rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    phone: row.phone,
    email: row.email,
    createdAt: row.created_at ? iso(row.created_at) : null,
    visitCount: row.visit_count,
    lastVisitAt: row.last_visit_at ? iso(row.last_visit_at) : null,
    totalSpentCents: row.total_spent_cents
  }))
}

async function buildCustomerServiceContext(req, lang = 'zh') {
  const [serviceRows, storeRows] = await Promise.all([
    query('SELECT * FROM services WHERE is_active = true ORDER BY type ASC, sort_order ASC'),
    query('SELECT * FROM stores WHERE is_active = true ORDER BY name ASC')
  ])
  let customer = null
  let bookings = []
  try {
    customer = await requireCustomer(req)
    const bookingRows = await query('SELECT * FROM bookings WHERE user_id = $1 ORDER BY appointment_start DESC LIMIT 8', [customer.id])
    bookings = await Promise.all(bookingRows.rows.map((booking) => serializeBooking(booking, lang)))
  } catch {
    customer = null
    bookings = []
  }
  return {
    customer,
    bookings,
    services: serviceRows.rows.map((service) => serializeService(service, lang)),
    stores: storeRows.rows
  }
}

async function getFinanceSummary(body) {
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  const allowedEmails = FINANCE_EMAILS.length ? FINANCE_EMAILS : OWNER_EMAILS
  if (!FINANCE_PASSWORD) throw apiError(403, 'FINANCE_NOT_CONFIGURED', 'Finance password is not configured yet.')
  if (!allowedEmails.includes(email) || password !== FINANCE_PASSWORD) throw apiError(403, 'FORBIDDEN', 'Finance login failed.')
  const summary = await query(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN service_price_cents WHEN status = 'CONFIRMED' THEN deposit_cents ELSE 0 END), 0)::int AS total_revenue_cents,
      COALESCE(SUM(CASE WHEN appointment_start >= date_trunc('month', now()) AND status = 'COMPLETED' THEN service_price_cents WHEN appointment_start >= date_trunc('month', now()) AND status = 'CONFIRMED' THEN deposit_cents ELSE 0 END), 0)::int AS month_revenue_cents,
      COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END)::int AS completed_services,
      COUNT(CASE WHEN appointment_start >= date_trunc('month', now()) AND status = 'COMPLETED' THEN 1 END)::int AS month_completed_services
    FROM bookings
  `)
  return summary.rows[0]
}

async function route(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {})
  const url = new URL(req.url, `http://${req.headers.host}`)
  const path = url.pathname
  const queryParams = Object.fromEntries(url.searchParams.entries())

  if (req.method === 'GET' && path === '/') return serveFile(res, webRoot, 'index.html')
  if (req.method === 'GET' && path === '/admin') return serveFile(res, webRoot, 'admin.html')
  if (req.method === 'GET' && path === '/wechat-simulator') return serveFile(res, webRoot, 'wechat-simulator.html')
  if (req.method === 'GET' && path === '/share') return serveFile(res, webRoot, 'share.html')
  if (req.method === 'GET' && path.startsWith('/web/')) return serveFile(res, webRoot, path.replace('/web/', ''))
  if (req.method === 'GET' && path.startsWith('/assets/')) return serveFile(res, assetRoot, path.replace('/assets/', ''))

  if (req.method === 'GET' && path === '/health') return json(res, 200, { ok: true, service: 'lucky-luxe-api-supabase', db: 'supabase-postgres', auth: isSupabaseConfigured() ? 'supabase' : 'demo', stripe: isStripeConfigured() ? 'configured' : 'mock', time: iso(new Date()) })
  if (req.method === 'GET' && path === '/wechat/customer-service/webhook') {
    const valid = verifyWecomSignature({
      signature: queryParams.msg_signature || queryParams.signature,
      timestamp: queryParams.timestamp,
      nonce: queryParams.nonce,
      payload: queryParams.echostr
    })
    if (!valid) throw apiError(403, 'WECHAT_SIGNATURE_INVALID', 'WeChat callback signature verification failed or token is not configured.')
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(WECOM_CUSTOMER_SERVICE_AES_KEY ? decryptWecomPayload(queryParams.echostr || '') : (queryParams.echostr || ''))
    return
  }
  if (req.method === 'POST' && path === '/wechat/customer-service/webhook') {
    const rawBody = await readRawBody(req)
    const contentTypeHeader = req.headers['content-type'] || ''
    const body = contentTypeHeader.includes('application/json') && rawBody ? JSON.parse(rawBody) : {}
    const encryptedPayload = xmlValue(rawBody, 'Encrypt')
    if (encryptedPayload && WECOM_CUSTOMER_SERVICE_TOKEN) {
      const valid = verifyWecomSignature({
        signature: queryParams.msg_signature || queryParams.signature,
        timestamp: queryParams.timestamp,
        nonce: queryParams.nonce,
        payload: encryptedPayload
      })
      if (!valid) throw apiError(403, 'WECHAT_SIGNATURE_INVALID', 'WeChat callback signature verification failed.')
    }
    const decryptedBody = encryptedPayload && WECOM_CUSTOMER_SERVICE_AES_KEY ? decryptWecomPayload(encryptedPayload) : rawBody
    const inbound = normalizeWecomInbound(body, queryParams, decryptedBody)
    if (encryptedPayload) inbound.raw = { encrypted: true, body: rawBody }
    if (encryptedPayload) {
      const handler = inbound.token ? handleWecomSyncToken(inbound, req) : handleWecomInbound(inbound, req)
      handler.catch((error) => console.error('[wecom:callback]', error))
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('success')
      return
    }
    const result = inbound.token ? await handleWecomSyncToken(inbound, req) : await handleWecomInbound(inbound, req)
    return json(res, 200, { ok: true, ...result })
  }
  if (req.method === 'GET' && path === '/auth/config') return json(res, 200, { supabaseAuth: isSupabaseConfigured(), googleAuth: isSupabaseConfigured(), stripe: isStripeConfigured() })
  if (req.method === 'GET' && path === '/auth/google/start') return json(res, 200, { url: googleAuthUrl(queryParams.redirectTo) })
  if (req.method === 'POST' && path === '/auth/session') return json(res, 200, await syncSupabaseSession(await readBody(req)))
  if (req.method === 'POST' && path === '/auth/refresh') return json(res, 200, await refreshSupabaseSession(await readBody(req)))
  if (req.method === 'POST' && path === '/auth/email/register') return json(res, 201, await signUpEmailUser(await readBody(req)))
  if (req.method === 'POST' && path === '/auth/email/resend-confirmation') return json(res, 200, await resendSignupConfirmation(await readBody(req)))
  if (req.method === 'POST' && path === '/auth/email/login') return json(res, 200, await signInEmailUser(await readBody(req)))
  if (req.method === 'POST' && path === '/auth/wechat/mini-login') return json(res, 200, await signInWechatMiniUser(await readBody(req)))
  if (req.method === 'POST' && path === '/auth/google/demo') return json(res, 201, { user: await registerGoogleDemoUser(await readBody(req)) })
  if (req.method === 'POST' && path === '/admin/auth/login') {
    const body = await readBody(req)
    const email = String(body.email || '').trim().toLowerCase()
    if (STAFF_EMAILS.includes(email) && String(body.password || '') === STAFF_DEMO_PASSWORD) {
      const admin = adminForEmail(email, 'demo-staff')
      return json(res, 200, {
        user: await registerEmailUser({ email, displayName: body.displayName || 'Lucky Luxe Staff' }),
        auth: demoAuthFor(email, 'staff'),
        admin,
        mode: 'demo-staff'
      })
    }
    const auth = await signInEmailUser(body)
    const loginEmail = String(auth.user.email || '').toLowerCase()
    const role = OWNER_EMAILS.includes(loginEmail) ? 'owner' : STAFF_EMAILS.includes(loginEmail) ? 'staff' : ''
    if (!role) throw apiError(403, 'FORBIDDEN', 'This account is not allowed to access admin.')
    if (!isSupabaseConfigured()) auth.auth = demoAuthFor(auth.user.email, role)
    auth.admin = adminForEmail(loginEmail, 'supabase')
    return json(res, 200, auth)
  }
  if (req.method === 'POST' && path === '/admin/auth/register') {
    const body = await readBody(req)
    const email = String(body.email || '').trim().toLowerCase()
    if (!OWNER_EMAILS.includes(email)) throw apiError(403, 'FORBIDDEN', 'This email is not approved for owner admin.')
    const auth = await signUpEmailUser(body)
    if (!isSupabaseConfigured()) auth.auth = demoAuthFor(email, 'owner')
    return json(res, 201, auth)
  }
  if (req.method === 'GET' && path === '/admin/auth/me') {
    const admin = await requireAdmin(req)
    return json(res, 200, { admin })
  }
  if (req.method === 'GET' && path.startsWith('/users/')) {
    const user = await query('SELECT * FROM users WHERE id = $1', [path.split('/')[2]])
    if (!user.rows[0]) throw apiError(404, 'NOT_FOUND', 'User not found.')
    return json(res, 200, { user: await serializeUser(user.rows[0]) })
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
  if (req.method === 'GET' && path === '/portfolio') {
    const rows = await query(`
      SELECT b.*, t.name AS tech_name, t.title AS tech_title
      FROM bookings b
      JOIN technicians t ON t.id = b.technician_id
      WHERE b.gallery_status = 'approved'
      ORDER BY b.gallery_locked_at DESC NULLS LAST, b.appointment_start DESC
    `)
    const grouped = new Map()
    for (const row of rows.rows) {
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
    await expireOldHolds()
    return json(res, 200, await getAvailability(queryParams))
  }
  if (req.method === 'POST' && path === '/bookings') return json(res, 201, { booking: await createBooking(await readBody(req), await requireCustomer(req)) })
  if (req.method === 'GET' && path === '/bookings') {
    const customer = await requireCustomer(req)
    const rows = await query('SELECT * FROM bookings WHERE user_id = $1 ORDER BY appointment_start DESC', [customer.id])
    return json(res, 200, { bookings: await Promise.all(rows.rows.map((booking) => serializeBooking(booking, queryParams.lang || 'zh'))) })
  }
  if (req.method === 'POST' && path === '/payments/mock/confirm') {
    await requireCustomer(req)
    return json(res, 200, { booking: await confirmMockPayment(await readBody(req)) })
  }
  if (req.method === 'POST' && path === '/payments/stripe/create-checkout') {
    await requireCustomer(req)
    return json(res, 200, await createStripeCheckout(await readBody(req), req))
  }
  if (req.method === 'POST' && path === '/payments/stripe/confirm-session') {
    await requireCustomer(req)
    return json(res, 200, await confirmStripeSession(await readBody(req)))
  }
  if (req.method === 'GET' && path.startsWith('/bookings/')) {
    const id = path.split('/')[2]
    const booking = await query('SELECT * FROM bookings WHERE id = $1', [id])
    if (!booking.rows[0]) throw apiError(404, 'NOT_FOUND', 'Booking not found.')
    return json(res, 200, { booking: await serializeBooking(booking.rows[0], queryParams.lang || 'zh') })
  }
  if (req.method === 'POST' && path.startsWith('/bookings/') && path.endsWith('/cancel')) {
    return json(res, 200, await cancelBooking(path.split('/')[2], await readBody(req)))
  }
  if (req.method === 'POST' && path === '/ai/reference-analysis') {
    return json(res, 200, { analysis: await analyzeReferenceImage(await readBody(req)) })
  }
  if (req.method === 'POST' && path === '/ai/social-copy') {
    const body = await readBody(req)
    const row = body.bookingId ? await query('SELECT * FROM bookings WHERE id = $1', [body.bookingId]) : { rows: [] }
    const booking = row.rows[0] ? await serializeBooking(row.rows[0], body.lang || 'zh') : body.booking
    return json(res, 200, { copy: await createSocialCopy({ lang: body.lang || 'zh', image: body.image || '', booking, platform: body.platform || 'xiaohongshu', audience: body.audience || 'customer', avoidCaptions: body.avoidCaptions || [], variantSeed: body.variantSeed || '' }) })
  }
  if (req.method === 'POST' && path === '/ai/customer-service') {
    const body = await readBody(req)
    const context = await buildCustomerServiceContext(req, body.lang || 'zh')
    const knowledgeContext = await attachOwnerApprovedSamples(buildKnowledgeContext({
      lang: body.lang || 'zh',
      message: body.message || '',
      ...context,
      sourceChannel: body.sourceChannel || body.source || '',
      customerStage: body.customerStage || body.stage || '',
      referenceImages: body.referenceImages || body.images || []
    }), body.lang || 'zh')
    const reply = await createCustomerServiceReply({
      lang: body.lang || 'zh',
      message: body.message || '',
      sampleMatchMessage: body.message || '',
      history: body.history || [],
      knowledgeContext,
      ...context
    })
    return json(res, 200, { reply })
  }
  let adminSession = null
  if (path.startsWith('/admin/')) adminSession = await requireAdmin(req)
  if (req.method === 'GET' && path === '/admin/wechat/status') {
    return json(res, 200, { wechat: wecomConfigStatus() })
  }
  if (req.method === 'GET' && path === '/admin/wechat/conversations') {
    return json(res, 200, { conversations: await getWecomConversations() })
  }
  if (req.method === 'GET' && path === '/admin/ai/customer-service/feedback') {
    return json(res, 200, { feedback: await getAiResponseFeedback({ limit: Number(query.limit || 40), status: query.status || 'approved' }) })
  }
  if (req.method === 'POST' && path === '/admin/ai/customer-service/feedback') {
    return json(res, 201, await saveAiResponseFeedback(await readBody(req), adminSession))
  }
  if (req.method === 'POST' && path === '/admin/wechat/mock-chat-message') {
    const body = await readBody(req)
    const inbound = normalizeWecomInbound({
      externalUserId: body.externalUserId || body.customerId || 'mock-chat-customer',
      openKfid: body.openKfid || WECOM_OPEN_KFID || 'mock-open-kfid',
      content: body.message || body.content || '',
      sourceChannel: body.sourceChannel || body.source || 'mock-chat',
      lang: body.lang || 'zh',
      referenceImages: body.referenceImages || body.images || [],
      customerStage: body.customerStage || body.stage || '',
      forceAi: Boolean(body.forceAi),
      raw: { mockChat: true, ...body }
    })
    return json(res, 201, await handleWecomInbound(inbound, req, { send: false }))
  }
  const manualReplyMatch = path.match(/^\/admin\/wechat\/conversations\/(.+)\/manual-reply$/)
  if (req.method === 'POST' && manualReplyMatch) {
    return json(res, 201, await appendManualWecomReply(decodeURIComponent(manualReplyMatch[1]), await readBody(req), adminSession))
  }
  if (req.method === 'POST' && path === '/admin/wechat/mock-message') {
    const body = await readBody(req)
    const inbound = normalizeWecomInbound({
      externalUserId: body.externalUserId || `mock-${Date.now()}`,
      openKfid: body.openKfid || WECOM_OPEN_KFID || 'mock-open-kfid',
      content: body.message || body.content || '',
      sourceChannel: body.sourceChannel || body.source || 'mock',
      lang: body.lang || 'zh',
      referenceImages: body.referenceImages || body.images || [],
      customerStage: body.customerStage || body.stage || '',
      raw: { mock: true, ...body }
    })
    return json(res, 201, await handleWecomInbound(inbound, req, { send: false }))
  }
  if (req.method === 'GET' && path === '/admin/quote-requests') {
    return json(res, 200, { quoteRequests: await getAdminQuoteRequests(adminSession) })
  }
  if (req.method === 'POST' && path === '/admin/quote-requests') {
    return json(res, 201, { quoteRequest: await createQuoteRequest(await readBody(req)) })
  }
  if ((req.method === 'POST' || req.method === 'PATCH') && path.startsWith('/admin/quote-requests/') && path.endsWith('/respond')) {
    const quoteRequest = await respondQuoteRequest(path.split('/')[3], await readBody(req), adminSession)
    return json(res, 200, { quoteRequest })
  }
  if ((req.method === 'POST' || req.method === 'PATCH') && path.startsWith('/admin/quote-requests/') && path.endsWith('/draft')) {
    const quoteRequest = await createQuoteDraftHold(path.split('/')[3], await readBody(req), adminSession)
    return json(res, 200, { quoteRequest })
  }
  if (req.method === 'GET' && path === '/admin/reminder-tasks') {
    return json(res, 200, { reminderTasks: await getAdminReminderTasks(adminSession) })
  }
  if ((req.method === 'POST' || req.method === 'PATCH') && path.startsWith('/admin/reminder-tasks/') && path.endsWith('/status')) {
    const row = await markReminderTask(path.split('/')[3], (await readBody(req)).status)
    return json(res, 200, { reminderTask: row })
  }
  if (req.method === 'GET' && path === '/admin/bookings') {
    const rows = adminSession.role === 'staff'
      ? await query('SELECT * FROM bookings WHERE technician_id = $1 ORDER BY appointment_start DESC', [adminSession.technicianId])
      : await query('SELECT * FROM bookings ORDER BY appointment_start DESC')
    return json(res, 200, { bookings: await Promise.all(rows.rows.map((booking) => serializeBooking(booking))) })
  }
  if (req.method === 'GET' && path === '/admin/customers') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    return json(res, 200, { customers: await getAdminCustomers() })
  }
  if (req.method === 'POST' && path === '/admin/finance/summary') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    return json(res, 200, { finance: await getFinanceSummary(await readBody(req)) })
  }
  if (req.method === 'POST' && path === '/admin/ai/daily-brief') {
    const body = await readBody(req)
    const [bookingRows, serviceRows, customers] = await Promise.all([
      adminSession.role === 'staff'
        ? query('SELECT * FROM bookings WHERE technician_id = $1 ORDER BY appointment_start DESC LIMIT 60', [adminSession.technicianId])
        : query('SELECT * FROM bookings ORDER BY appointment_start DESC LIMIT 60'),
      query('SELECT * FROM services ORDER BY type ASC, sort_order ASC'),
      adminSession.role === 'owner' ? getAdminCustomers() : []
    ])
    const bookings = await Promise.all(bookingRows.rows.map((booking) => serializeBooking(booking, body.lang || 'zh')))
    return json(res, 200, { brief: await createDailyBrief({ ...body, bookings, customers, services: serviceRows.rows.map((service) => serializeService(service, body.lang || 'zh')) }) })
  }
  if (req.method === 'POST' && path === '/admin/ai/booking-summary') {
    const body = await readBody(req)
    const row = await query('SELECT * FROM bookings WHERE id = $1', [body.bookingId])
    if (!row.rows[0]) throw apiError(404, 'NOT_FOUND', 'Booking not found.')
    assertStaffCanAccessBooking(adminSession, row.rows[0])
    return json(res, 200, { summary: await createBookingSummary({ lang: body.lang || 'zh', booking: await serializeBooking(row.rows[0], body.lang || 'zh') }) })
  }
  if (req.method === 'POST' && path === '/admin/ai/customer-insight') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const body = await readBody(req)
    const customers = await getAdminCustomers()
    const customer = customers.find((item) => item.id === body.customerId)
    if (!customer) throw apiError(404, 'NOT_FOUND', 'Customer not found.')
    const bookingRows = await query('SELECT * FROM bookings WHERE user_id = $1 ORDER BY appointment_start DESC LIMIT 12', [body.customerId])
    const bookings = await Promise.all(bookingRows.rows.map((booking) => serializeBooking(booking, body.lang || 'zh')))
    return json(res, 200, { insight: await createCustomerInsight({ lang: body.lang || 'zh', customer, bookings }) })
  }
  if (req.method === 'POST' && path === '/admin/ai/social-copy') {
    const body = await readBody(req)
    const row = body.bookingId ? await query('SELECT * FROM bookings WHERE id = $1', [body.bookingId]) : { rows: [] }
    if (row.rows[0]) assertStaffCanAccessBooking(adminSession, row.rows[0])
    const booking = row.rows[0] ? await serializeBooking(row.rows[0], body.lang || 'zh') : body.booking
    return json(res, 200, { copy: await createSocialCopy({ lang: body.lang || 'zh', image: body.image || '', booking, platform: body.platform || 'xiaohongshu', audience: body.audience || 'staff', avoidCaptions: body.avoidCaptions || [], variantSeed: body.variantSeed || '' }) })
  }
  if (req.method === 'GET' && path === '/admin/services') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const services = await query('SELECT * FROM services ORDER BY type ASC, sort_order ASC')
    return json(res, 200, { services: services.rows.map((service) => serializeService(service)) })
  }
  if (req.method === 'POST' && path === '/admin/services') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const payload = servicePayload(await readBody(req))
    if (!['NAIL', 'LASH'].includes(payload.type)) throw apiError(400, 'BAD_REQUEST', 'Service type must be NAIL or LASH.')
    if (!payload.nameZh || !payload.nameEn) throw apiError(400, 'BAD_REQUEST', 'Service name is required.')
    const id = serviceIdFrom(payload)
    await query(`INSERT INTO services
      (id, type, category, name_zh, name_en, description_zh, description_en, image_url, price_cents, deposit_cents, base_duration_min, sort_order, is_active, process_json, notice_json)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb)`, [
      id,
      payload.type,
      payload.category,
      payload.nameZh,
      payload.nameEn,
      payload.descriptionZh,
      payload.descriptionEn,
      payload.imageUrl,
      payload.priceCents,
      payload.depositCents,
      payload.baseDurationMin,
      payload.sortOrder,
      payload.isActive,
      JSON.stringify(payload.processJson),
      JSON.stringify(payload.noticeJson)
    ])
    const technicians = await query('SELECT id FROM technicians WHERE is_active = true')
    await Promise.all(technicians.rows.map((tech) => query(
      'INSERT INTO technician_services (technician_id, service_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [tech.id, id]
    )))
    return json(res, 201, { service: serializeService(await getService(id)) })
  }
  if (req.method === 'GET' && path === '/admin/technicians') {
    const technicians = adminSession.role === 'staff'
      ? await query('SELECT * FROM technicians WHERE id = $1 ORDER BY name ASC', [adminSession.technicianId])
      : await query('SELECT * FROM technicians ORDER BY name ASC')
    return json(res, 200, { technicians: technicians.rows })
  }
  if (req.method === 'PATCH' && path.startsWith('/admin/services/')) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const id = path.split('/')[3]
    const body = await readBody(req)
    const current = await getService(id)
    if (!current) throw apiError(404, 'NOT_FOUND', 'Service not found.')
    const payload = servicePayload(body, current)
    await query(`UPDATE services SET
      type = $1, category = $2, name_zh = $3, name_en = $4, description_zh = $5, description_en = $6,
      image_url = $7, price_cents = $8, deposit_cents = $9, base_duration_min = $10, is_active = $11,
      sort_order = $12, process_json = $13::jsonb, notice_json = $14::jsonb
      WHERE id = $15`, [
      payload.type,
      payload.category,
      payload.nameZh,
      payload.nameEn,
      payload.descriptionZh,
      payload.descriptionEn,
      payload.imageUrl,
      payload.priceCents,
      payload.depositCents,
      payload.baseDurationMin,
      payload.isActive,
      payload.sortOrder,
      JSON.stringify(payload.processJson),
      JSON.stringify(payload.noticeJson),
      id
    ])
    return json(res, 200, { service: serializeService(await getService(id)) })
  }
  if (req.method === 'PATCH' && path.startsWith('/admin/technicians/') && path.endsWith('/schedule')) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
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
    assertStaffCanAccessBooking(adminSession, booking.rows[0])
    await withTransaction(async (client) => {
      if (['CANCELLED', 'EXPIRED'].includes(status)) await client.query('DELETE FROM booking_slots WHERE booking_id = $1', [id])
      await client.query('UPDATE bookings SET status = $1, updated_at = now() WHERE id = $2', [status, id])
    })
    const updated = await query('SELECT * FROM bookings WHERE id = $1', [id])
    return json(res, 200, { booking: await serializeBooking(updated.rows[0]) })
  }
  if (req.method === 'PATCH' && path.startsWith('/admin/bookings/') && path.endsWith('/work-images')) {
    const id = path.split('/')[3]
    const body = await readBody(req)
    const images = normalizeWorkImages(body.workImages)
    const booking = await query('SELECT * FROM bookings WHERE id = $1', [id])
    if (!booking.rows[0]) throw apiError(404, 'NOT_FOUND', 'Booking not found.')
    assertStaffCanAccessBooking(adminSession, booking.rows[0])
    if (booking.rows[0].gallery_status === 'approved') throw apiError(409, 'GALLERY_LOCKED', 'This gallery has been approved and locked.')
    await query('UPDATE bookings SET work_images_json = $1::jsonb, updated_at = now() WHERE id = $2', [JSON.stringify(images), id])
    const updated = await query('SELECT * FROM bookings WHERE id = $1', [id])
    return json(res, 200, { booking: await serializeBooking(updated.rows[0]) })
  }
  if (req.method === 'PATCH' && path.startsWith('/admin/bookings/') && path.endsWith('/gallery-approval')) {
    const id = path.split('/')[3]
    const body = await readBody(req)
    const booking = await query('SELECT * FROM bookings WHERE id = $1', [id])
    if (!booking.rows[0]) throw apiError(404, 'NOT_FOUND', 'Booking not found.')
    assertStaffCanAccessBooking(adminSession, booking.rows[0])
    if (booking.rows[0].gallery_status === 'approved') throw apiError(409, 'GALLERY_LOCKED', 'This gallery has already been approved and locked.')
    const current = parseJson(booking.rows[0].work_images_json)
    const selected = normalizeWorkImages(body.images).filter((image) => current.includes(image))
    if (!selected.length) throw apiError(400, 'BAD_REQUEST', 'Select at least one uploaded work image.')
    await query("UPDATE bookings SET work_images_json = $1::jsonb, approved_work_images_json = $1::jsonb, gallery_status = 'approved', gallery_locked_at = now(), updated_at = now() WHERE id = $2", [JSON.stringify(selected), id])
    const updated = await query('SELECT * FROM bookings WHERE id = $1', [id])
    return json(res, 200, { booking: await serializeBooking(updated.rows[0]) })
  }
  throw apiError(404, 'NOT_FOUND', 'Endpoint not found.')
}

await pool.query('SELECT 1')
await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS supabase_auth_id text UNIQUE')
await pool.query(`
  CREATE TABLE IF NOT EXISTS user_identities (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider text NOT NULL,
    provider_user_id text NOT NULL,
    union_id text,
    email text,
    phone text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_user_id)
  )
`)
await pool.query('CREATE INDEX IF NOT EXISTS idx_user_identities_user_id ON user_identities(user_id)')
await pool.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reference_images_json jsonb NOT NULL DEFAULT '[]'::jsonb")
await pool.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS work_images_json jsonb NOT NULL DEFAULT '[]'::jsonb")
await pool.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS approved_work_images_json jsonb NOT NULL DEFAULT '[]'::jsonb")
await pool.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS gallery_status text NOT NULL DEFAULT 'draft'")
await pool.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS gallery_locked_at timestamptz")
await pool.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source_channel text')
await pool.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deposit_required_cents integer NOT NULL DEFAULT 5000')
await pool.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deposit_waived_cents integer NOT NULL DEFAULT 0')
await pool.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deposit_waive_reason text')
await pool.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS member_level_at_booking text')
await pool.query(`
  CREATE TABLE IF NOT EXISTS wechat_conversations (
    id text PRIMARY KEY,
    provider text NOT NULL,
    external_user_id text NOT NULL,
    open_kfid text,
    source_channel text,
    status text NOT NULL DEFAULT 'open',
    last_intent text,
    last_message text,
    ai_reply_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    transcript_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    raw_event_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )
`)
await pool.query('CREATE INDEX IF NOT EXISTS idx_wechat_conversations_updated ON wechat_conversations(updated_at DESC)')
await pool.query('CREATE INDEX IF NOT EXISTS idx_wechat_conversations_external_user ON wechat_conversations(external_user_id)')
await pool.query(`
  CREATE TABLE IF NOT EXISTS ai_response_feedback (
    id text PRIMARY KEY,
    conversation_id text REFERENCES wechat_conversations(id) ON DELETE SET NULL,
    message_index integer,
    customer_message text NOT NULL,
    original_reply text NOT NULL,
    corrected_reply text NOT NULL,
    notes text,
    lang text NOT NULL DEFAULT 'zh',
    source_channel text,
    intent text,
    status text NOT NULL DEFAULT 'approved',
    created_by text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )
`)
await pool.query('CREATE INDEX IF NOT EXISTS idx_ai_response_feedback_status ON ai_response_feedback(status, updated_at DESC)')
await pool.query(`
  CREATE TABLE IF NOT EXISTS quote_requests (
    id text PRIMARY KEY,
    conversation_id text REFERENCES wechat_conversations(id) ON DELETE SET NULL,
    user_id text REFERENCES users(id) ON DELETE SET NULL,
    source_channel text,
    service_type text NOT NULL DEFAULT 'nail',
    service_id text REFERENCES services(id) ON DELETE SET NULL,
    technician_id text REFERENCES technicians(id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'PENDING_STAFF',
    customer_message text,
    customer_lang text NOT NULL DEFAULT 'zh',
    reference_images_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    style_elements_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    missing_questions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    extension_needed text NOT NULL DEFAULT 'unknown',
    removal_needed text NOT NULL DEFAULT 'unknown',
    repair_needed text NOT NULL DEFAULT 'unknown',
    charms_needed text NOT NULL DEFAULT 'unknown',
    lower_lash_requested text NOT NULL DEFAULT 'unknown',
    health_check_clear text NOT NULL DEFAULT 'unknown',
    staff_can_do boolean,
    staff_price_cents integer,
    staff_duration_min integer,
    staff_notes text,
    ai_reply_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    draft_booking_id text REFERENCES bookings(id) ON DELETE SET NULL,
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )
`)
await pool.query('CREATE INDEX IF NOT EXISTS idx_quote_requests_status ON quote_requests(status, updated_at DESC)')
await pool.query('CREATE INDEX IF NOT EXISTS idx_quote_requests_technician ON quote_requests(technician_id, updated_at DESC)')
await pool.query(`
  CREATE TABLE IF NOT EXISTS reminder_tasks (
    id text PRIMARY KEY,
    user_id text REFERENCES users(id) ON DELETE SET NULL,
    booking_id text REFERENCES bookings(id) ON DELETE SET NULL,
    quote_request_id text REFERENCES quote_requests(id) ON DELETE SET NULL,
    conversation_id text REFERENCES wechat_conversations(id) ON DELETE SET NULL,
    type text NOT NULL,
    channel text NOT NULL DEFAULT 'mock',
    status text NOT NULL DEFAULT 'PENDING',
    scheduled_at timestamptz NOT NULL,
    sent_at timestamptz,
    payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )
`)
await pool.query('CREATE INDEX IF NOT EXISTS idx_reminder_tasks_due ON reminder_tasks(status, scheduled_at)')
await pool.query('CREATE INDEX IF NOT EXISTS idx_reminder_tasks_quote ON reminder_tasks(quote_request_id)')

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
}).listen(PORT, HOST, () => {
  console.log(`Lucky Luxe Supabase API running at http://${HOST}:${PORT}`)
})
