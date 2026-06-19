import 'dotenv/config'
import { createServer } from 'node:http'
import { createDecipheriv, createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { analyzeReferenceImage, createBookingSummary, createCustomerInsight, createCustomerServiceReply, createDailyBrief, createSocialCopy } from './ai-utils.mjs'

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
const HOLD_MINUTES = Number(process.env.BOOKING_HOLD_MINUTES || 15)
const SLOT_MINUTES = 30
const DATABASE_URL = process.env.DATABASE_URL
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '')
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || ''
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || ''
const APP_PUBLIC_URL = (process.env.APP_PUBLIC_URL || '').replace(/\/$/, '')
const WECOM_CORP_ID = process.env.WECOM_CORP_ID || ''
const WECOM_CUSTOMER_SERVICE_SECRET = process.env.WECOM_CUSTOMER_SERVICE_SECRET || ''
const WECOM_CUSTOMER_SERVICE_TOKEN = process.env.WECOM_CUSTOMER_SERVICE_TOKEN || ''
const WECOM_CUSTOMER_SERVICE_AES_KEY = process.env.WECOM_CUSTOMER_SERVICE_AES_KEY || ''
const WECOM_OPEN_KFID = process.env.WECOM_OPEN_KFID || ''

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
    .filter((item) => typeof item === 'string' && item.startsWith('data:image/'))
    .slice(0, 3)
}

function normalizeWorkImages(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => typeof item === 'string' && item.startsWith('data:image/'))
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
    imageUrl: body.imageUrl ?? current.image_url ?? '/assets/images/nail-addon.png',
    priceCents: Number(body.priceCents ?? current.price_cents ?? 0),
    depositCents: Number(body.depositCents ?? current.deposit_cents ?? 5000),
    baseDurationMin: Number(body.baseDurationMin ?? current.base_duration_min ?? 120),
    sortOrder: Number(body.sortOrder ?? current.sort_order ?? 0),
    isActive: body.isActive === undefined ? (current.is_active ?? true) : Boolean(body.isActive),
    processJson: body.process ?? current.process_json ?? [],
    noticeJson: body.notice ?? current.notice_json ?? []
  }
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
    imageUrl: row.image_url,
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

function isStripeConfigured() {
  return Boolean(STRIPE_SECRET_KEY)
}

function publicAppUrl() {
  return (APP_PUBLIC_URL || 'https://www.luckyluxeatelier.com').replace(/\/$/, '')
}

function wechatWebhookUrl() {
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
    messageId: xmlValue(rawBody, 'MsgId') || xmlValue(rawBody, 'MsgID') || randomId('wxmsg'),
    createdAt: xmlValue(rawBody, 'CreateTime')
  } : {}
  return {
    provider: 'wecom_customer_service',
    externalUserId: body.externalUserId || body.external_userid || body.fromUserName || body.openid || xmlContent.externalUserId || 'mock-customer',
    openKfid: body.openKfid || body.open_kfid || xmlContent.openKfid || WECOM_OPEN_KFID || 'mock-open-kfid',
    msgType: body.msgType || body.msgtype || xmlContent.msgType || 'text',
    content: body.content || body.text || body.message || xmlContent.content || '',
    messageId: body.messageId || body.msgid || xmlContent.messageId || randomId('wxmsg'),
    sourceChannel: body.sourceChannel || body.source || '',
    lang: body.lang || (/^[\x00-\x7F]*$/.test(body.content || body.message || xmlContent.content || '') ? 'en' : 'zh'),
    raw: body.raw || body || rawBody || {}
  }
}

function wecomConfigStatus() {
  const checks = [
    { key: 'WECOM_CORP_ID', label: 'CorpID', ok: Boolean(WECOM_CORP_ID) },
    { key: 'WECOM_CUSTOMER_SERVICE_SECRET', label: 'Customer Service Secret', ok: Boolean(WECOM_CUSTOMER_SERVICE_SECRET) },
    { key: 'WECOM_CUSTOMER_SERVICE_TOKEN', label: 'Webhook Token', ok: Boolean(WECOM_CUSTOMER_SERVICE_TOKEN) },
    { key: 'WECOM_CUSTOMER_SERVICE_AES_KEY', label: 'EncodingAESKey', ok: Boolean(WECOM_CUSTOMER_SERVICE_AES_KEY) },
    { key: 'WECOM_OPEN_KFID', label: 'open_kfid', ok: Boolean(WECOM_OPEN_KFID) }
  ]
  return {
    provider: 'wecom_customer_service',
    mode: checks.every((item) => item.ok) ? 'ready' : 'pending_credentials',
    webhookUrl: wechatWebhookUrl(),
    checks
  }
}

async function recordWecomConversation(inbound, reply, status = 'ai_replied') {
  const conversationId = `wecom:${inbound.externalUserId}`
  const current = await query('SELECT transcript_json FROM wechat_conversations WHERE id = $1', [conversationId])
  const transcript = parseJson(current.rows[0]?.transcript_json)
  const replyData = reply?.data || reply || {}
  transcript.push({
    role: 'customer',
    content: inbound.content,
    messageId: inbound.messageId,
    msgType: inbound.msgType,
    at: iso(new Date())
  })
  if (reply) {
    transcript.push({
      role: 'assistant',
      content: replyData.answerZh || replyData.answerEn || '',
      intent: replyData.intent,
      handoffRequired: Boolean(replyData.handoffRequired),
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

async function handleWecomInbound(inbound, req) {
  const context = await buildCustomerServiceContext(req, inbound.lang || 'zh')
  const reply = await createCustomerServiceReply({
    lang: inbound.lang || 'zh',
    message: inbound.content || '',
    history: [],
    ...context
  })
  const conversationId = await recordWecomConversation(inbound, reply)
  return { conversationId, inbound, reply }
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
    return serializeUser(updated.rows[0])
  }
  const id = randomId('user')
  await query('INSERT INTO users (id, supabase_auth_id, display_name, email, google_id) VALUES ($1, $2, $3, $4, $5)',
    [id, authId, authUserName(authUser), email, provider === 'google' ? authId : null])
  const created = await query('SELECT * FROM users WHERE id = $1', [id])
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
    const depositCents = 5000

    await client.query(`
      INSERT INTO bookings
      (id, public_code, user_id, store_id, technician_id, service_id, status, appointment_start, appointment_end, addons_json, reference_images_json, source_channel, notes, service_price_cents, deposit_cents, final_due_cents, total_duration_min, payment_expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13, $14, $15, $16, $17, now() + ($18::int * interval '1 minute'))
    `, [bookingId, publicCode(), input.userId, input.storeId, input.technicianId, input.serviceId, 'PENDING_PAYMENT', iso(start), iso(end), JSON.stringify(input.addOns), JSON.stringify(input.referenceImages), input.sourceChannel, input.notes, servicePriceCents, depositCents, servicePriceCents - depositCents, durationMin, HOLD_MINUTES])

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
    const result = await handleWecomInbound(inbound, req)
    return json(res, 200, { ok: true, ...result })
  }
  if (req.method === 'GET' && path === '/auth/config') return json(res, 200, { supabaseAuth: isSupabaseConfigured(), googleAuth: isSupabaseConfigured(), stripe: isStripeConfigured() })
  if (req.method === 'GET' && path === '/auth/google/start') return json(res, 200, { url: googleAuthUrl(queryParams.redirectTo) })
  if (req.method === 'POST' && path === '/auth/session') return json(res, 200, await syncSupabaseSession(await readBody(req)))
  if (req.method === 'POST' && path === '/auth/refresh') return json(res, 200, await refreshSupabaseSession(await readBody(req)))
  if (req.method === 'POST' && path === '/auth/email/register') return json(res, 201, await signUpEmailUser(await readBody(req)))
  if (req.method === 'POST' && path === '/auth/email/resend-confirmation') return json(res, 200, await resendSignupConfirmation(await readBody(req)))
  if (req.method === 'POST' && path === '/auth/email/login') return json(res, 200, await signInEmailUser(await readBody(req)))
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
    const reply = await createCustomerServiceReply({
      lang: body.lang || 'zh',
      message: body.message || '',
      history: body.history || [],
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
  if (req.method === 'POST' && path === '/admin/wechat/mock-message') {
    const body = await readBody(req)
    const inbound = normalizeWecomInbound({
      externalUserId: body.externalUserId || `mock-${Date.now()}`,
      openKfid: body.openKfid || WECOM_OPEN_KFID || 'mock-open-kfid',
      content: body.message || body.content || '',
      sourceChannel: body.sourceChannel || body.source || 'mock',
      lang: body.lang || 'zh',
      raw: { mock: true, ...body }
    })
    return json(res, 201, await handleWecomInbound(inbound, req))
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
await pool.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reference_images_json jsonb NOT NULL DEFAULT '[]'::jsonb")
await pool.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS work_images_json jsonb NOT NULL DEFAULT '[]'::jsonb")
await pool.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS approved_work_images_json jsonb NOT NULL DEFAULT '[]'::jsonb")
await pool.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS gallery_status text NOT NULL DEFAULT 'draft'")
await pool.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS gallery_locked_at timestamptz")
await pool.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source_channel text')
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
