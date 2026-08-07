import { createServer } from 'node:http'
import { AsyncLocalStorage } from 'node:async_hooks'
import { DatabaseSync } from 'node:sqlite'
import { createDecipheriv, createHash, createHmac } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeReferenceImage, createBookingSummary, createCustomerInsight, createCustomerServiceReply, createDailyBrief, createRecallMessages, createServiceNoteInsights, createSocialCopy, extractKbEntriesFromDocument, polishStaffQuoteReply } from './ai-utils.mjs'
import { buildKnowledgeContext, loadCustomerServiceKnowledgeBase } from './kb-utils.mjs'

// 进程时区只作为「没有门店时区可用时」的兜底。业务上的「今天/本月/日期分桶」一律按门店时区算,
// 见下方 tenantTimezone() / localParts(dateLike, tz) —— 2026-08-07 P0.9 按店时区改造(审计 B-1)。
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/Toronto'
process.env.TZ = APP_TIMEZONE

const __dirname = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = join(__dirname, '..', '..')
const webRoot = join(workspaceRoot, 'apps', 'web')
const assetRoot = join(workspaceRoot, 'miniprogram', 'assets')
// DATA_DIR 环境变量可指定数据目录(测试跑临时库用);不设则维持原路径,本机/云端(Volume 挂载点)行为不变
const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(__dirname, 'local-data')
mkdirSync(dataDir, { recursive: true })

// 数据迁移:发现待导入文件时,先给现库留底份,再原子替换(配合 /admin/ops/import-db)
const pendingImportPath = join(dataDir, 'lucky-luxe.sqlite.pending')
if (existsSync(pendingImportPath)) {
  const mainDbPath = join(dataDir, 'lucky-luxe.sqlite')
  if (existsSync(mainDbPath)) {
    copyFileSync(mainDbPath, join(dataDir, `lucky-luxe.pre-import-${Date.now()}.sqlite`))
  }
  renameSync(pendingImportPath, mainDbPath)
  console.log('[import] 已应用待导入数据库(原库已留底份 lucky-luxe.pre-import-*.sqlite)')
}

const db = new DatabaseSync(join(dataDir, 'lucky-luxe.sqlite'))
const PORT = Number(process.env.PORT || 4000)
// 主钥匙:新名 OWNER_TOKEN 优先,旧名 OWNER_DEMO_TOKEN 兼容(现网还在用旧名,先不破坏)。
// 名字带 DEMO 容易让人低估它的权限——它是平台最高信任根。
const OWNER_TOKEN = process.env.OWNER_TOKEN || process.env.OWNER_DEMO_TOKEN || 'owner-demo-token'
// 生产判定(Railway 会注入 RAILWAY_ENVIRONMENT):用于「日志里不许出现主钥匙」这类只在云端生效的收紧
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || Boolean(process.env.RAILWAY_ENVIRONMENT)
// 多租户:请求级租户上下文。商家端 /admin 进入时按登录账号的租户 enterWith;
// 顾客/公开路径不设上下文 → 回退默认租户(行为不变)。所有用 currentTenantId() 的模块自动按租户走。
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || 'lucky-luxe'
const tenantContext = new AsyncLocalStorage()
function currentTenantId() {
  const store = tenantContext.getStore()
  return (store && store.tenantId) || DEFAULT_TENANT_ID
}

// 多租户:校验租户 id(存在且启用),否则回退默认。默认安全,现有单租户行为不变。
function validTenantId(raw) {
  const id = String(raw || '').trim()
  if (id) {
    try {
      const t = db.prepare("SELECT id FROM tenants WHERE id = ? AND status = 'active'").get(id)
      if (t) return t.id
    } catch (e) { /* tenants 表异常时回退 */ }
  }
  return DEFAULT_TENANT_ID
}
// 从顾客请求解析"当前进的店"(x-tenant-id 头 或 ?tenantId=)。
function resolveTenant(req, query) {
  return validTenantId((req && req.headers && req.headers['x-tenant-id']) || (query && query.tenantId) || '')
}

// 套餐与功能开关（留接口纪律 #7）：套餐默认值 + 商户覆盖项（试用/加购）合并。
function getEntitlements(tenantId = DEFAULT_TENANT_ID) {
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId)
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(tenant?.plan || 'chain')
  let planFeatures = []
  let limits = {}
  try { planFeatures = JSON.parse(plan?.features_json || '[]') } catch { planFeatures = [] }
  try { limits = JSON.parse(plan?.limits_json || '{}') } catch { limits = {} }
  const now = Date.now()
  // 套餐到期：null = 长期有效（自有/内部租户）；过期后套餐内功能整体失效，单独开通的覆盖项不受影响。
  const planExpiresAt = tenant?.plan_expires_at || null
  const planExpired = Boolean(planExpiresAt && new Date(planExpiresAt).getTime() < now)
  const features = {}
  for (const feature of planFeatures) {
    features[feature] = planExpired
      ? { enabled: false, source: 'plan_expired', expiresAt: planExpiresAt }
      : { enabled: true, source: 'plan', expiresAt: null }
  }
  for (const row of db.prepare('SELECT * FROM tenant_entitlements WHERE tenant_id = ?').all(tenantId)) {
    const expired = row.expires_at ? new Date(row.expires_at).getTime() < now : false
    features[row.feature] = {
      enabled: Boolean(row.enabled) && !expired,
      source: row.expires_at ? 'trial' : 'override',
      expiresAt: row.expires_at || null
    }
  }
  const latestPlanRequest = db.prepare(`
    SELECT target_plan AS targetPlan, request_type AS requestType, status, created_at AS createdAt
    FROM plan_change_requests WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(tenantId) || null
  return {
    tenantId,
    tenantName: tenant?.name || tenantId,
    plan: plan?.id || 'chain',
    planNameZh: plan?.name_zh || '连锁门店版',
    planNameEn: plan?.name_en || 'Chain',
    planExpiresAt,
    planExpired,
    latestPlanRequest,
    features,
    limits
  }
}

function checkEntitlement(tenantId, feature) {
  return Boolean(getEntitlements(tenantId).features[feature]?.enabled)
}

// ===== AI 智能包总闸(2026-08-04 店主定:全部 AI 能力归智能包)=====
// 之前只有「微信/在线客服自动回复」两处有闸门,其余 9 项 AI 能力所有商家免费在用。
// hasAi():给「主功能照常、只跳过 AI 那一段」的混合接口用(小记保存、知识库导入、报价发送、召回周报)。
// requireAi():给纯 AI 接口用,统一抛 AI_ADDON_REQUIRED,前端据此提示"去开通"而不是弹英文报错。
function hasAi(tenantId = currentTenantId()) {
  return checkEntitlement(tenantId, AI_ADDON.feature)
}
function requireAi(tenantId = currentTenantId()) {
  if (!hasAi(tenantId)) throw apiError(403, 'AI_ADDON_REQUIRED', '该功能属于 AI 智能包,当前店铺未开通。')
  requireAiQuota(tenantId)
}

// ===== AI 月用量与配额(2026-08-04)=====
// 配额取「套餐自带条数」与「AI 智能包加购条数」的较大者,再加平台临时加量。
// 加购包的条数写在 AI_ADDON.monthlyQuota(见下方常量),改一处即可调整。
function aiMonthKey() { return localParts(new Date()).date.slice(0, 7) }

function aiQuotaFor(tenantId) {
  const ent = getEntitlements(tenantId)
  const planQuota = Number(ent.limits?.aiMessagesPerMonth || 0)
  // 有加购包(非套餐自带)时按加购包配额;套餐自带的按套餐配额;两者取大,互不吃亏
  const addonQuota = hasAi(tenantId) ? AI_ADDON.monthlyQuota : 0
  const row = db.prepare('SELECT bonus FROM ai_usage WHERE tenant_id = ? AND month = ?').get(tenantId, aiMonthKey())
  return Math.max(planQuota, addonQuota) + Number(row?.bonus || 0)
}

function aiUsageOf(tenantId) {
  const row = db.prepare('SELECT used, bonus FROM ai_usage WHERE tenant_id = ? AND month = ?').get(tenantId, aiMonthKey())
  const used = Number(row?.used || 0)
  const quota = aiQuotaFor(tenantId)
  return { month: aiMonthKey(), used, quota, remaining: Math.max(0, quota - used), bonus: Number(row?.bonus || 0) }
}

function requireAiQuota(tenantId) {
  const { used, quota } = aiUsageOf(tenantId)
  if (quota > 0 && used >= quota) {
    throw apiError(403, 'AI_QUOTA_EXCEEDED', `本月 AI 用量已达上限(${quota} 次),下月 1 日自动重置;需要提前恢复请联系平台。`)
  }
}

// 真正发生一次 AI 调用后计数。只在「确实调了模型」之后加,跳过 AI 的降级路径不计。
function countAiUsage(tenantId = currentTenantId(), n = 1) {
  db.prepare(`INSERT INTO ai_usage (tenant_id, month, used, bonus, updated_at) VALUES (?, ?, ?, 0, ?)
    ON CONFLICT(tenant_id, month) DO UPDATE SET used = used + excluded.used, updated_at = excluded.updated_at`)
    .run(tenantId, aiMonthKey(), n, iso(new Date()))
}

// 订阅定价:**唯一口径 = Youji Pricing 定价页**(免费版/单店版/工作室版/连锁版/定制版)。
// 纯订阅、不收搭建费、不抽客单佣金;年付约 8 折(月付≈年价÷10);AI 智能包单独订阅、前 3 个月免费。
// custom=面议(null)。改价只改这里。
const PLAN_PRICING = {
  free: { monthCents: 0, yearCents: 0 },
  single: { monthCents: 13800, yearCents: 138000 },
  studio: { monthCents: 29800, yearCents: 298000 },
  chain: { monthCents: 68000, yearCents: 680000 },
  custom: null
}
const PLAN_FIT = {
  free: '先上手,把顾客和作品搬上小程序',
  single: '一家店的全部经营功能',
  studio: '多技师团队,全套薪酬与进阶分析',
  chain: '多店 / 总部统管,含 3 店起',
  custom: '私有化 / 白标 / API,按需求报价'
}
const PLAN_NOTE = {
  free: '永久免费 · 功能受限',
  single: '最受欢迎',
  studio: '',
  chain: '含 3 店 · 超出 +¥1,200/店/年',
  custom: '建议 ¥30,000 起 + 年维护'
}
// AI 智能包:独立于基础订阅的加购项(基础订阅功能齐全但不含 AI);前 3 个月免费试用,每店限一次
// monthlyQuota:加购包自带的月调用上限。¥99/月对应 3000 次,平均单次成本约 3 分,留足毛利。
// 改额度只改这一处;个别店要临时多批走平台后台的「加量」(写进 ai_usage.bonus,当月有效)。
const AI_ADDON = { feature: 'ai_customer_service', monthCents: 9900, yearCents: 99000, trialDays: 90, monthlyQuota: 3000 }

// AI 智能包当前状态:套餐自带 / 试用中 / 已订阅 / 未开通;试用是否还能领
function aiAddonState(tenantId) {
  const ent = getEntitlements(tenantId)
  const f = ent.features[AI_ADDON.feature]
  const row = db.prepare('SELECT * FROM tenant_entitlements WHERE tenant_id = ? AND feature = ?').get(tenantId, AI_ADDON.feature)
  const trialRow = db.prepare("SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = 'ai_trial_started_at'").get(tenantId)
  // 试用不再自动开通:商家点「领取」只生成申请,落到平台后台由运营配置后才发放
  const pendingTrial = db.prepare(`SELECT id, created_at AS createdAt FROM plan_change_requests
    WHERE tenant_id = ? AND request_type = 'ai_trial' AND status = 'PENDING' ORDER BY created_at DESC LIMIT 1`).get(tenantId) || null
  // 付费订阅与免费试用都带到期日,靠 note 区分(getEntitlements 一律标 trial)
  const isPaid = String(row?.note || '').includes('订阅')
  // 2026-08-07:有权限行但没有到期日 = 长期开通(体验店/内部店),既不是试用也不是付费订阅
  const isUnlimited = Boolean(row) && !row.expires_at && Boolean(row.enabled)
  return {
    enabled: Boolean(f?.enabled),
    includedInPlan: f?.source === 'plan',
    unlimited: isUnlimited,
    source: f?.source === 'plan' ? 'plan' : (row ? (isUnlimited ? 'unlimited' : (isPaid ? 'paid' : 'trial')) : 'none'),
    expiresAt: row?.expires_at || null,
    trialAvailable: !trialRow && !pendingTrial && f?.source !== 'plan',
    trialPending: Boolean(pendingTrial),
    trialPendingAt: pendingTrial?.createdAt || null,
    trialDays: AI_ADDON.trialDays,
    monthCents: AI_ADDON.monthCents,
    yearCents: AI_ADDON.yearCents
  }
}

// 平台后台确认后才真正发放试用(商家端只能发起申请)
function grantAiTrial(tenantId) {
  const until = new Date()
  until.setDate(until.getDate() + AI_ADDON.trialDays)
  const untilIso = iso(until)
  const now = iso(new Date())
  db.prepare(`INSERT INTO tenant_entitlements (id, tenant_id, feature, enabled, expires_at, note, updated_by, updated_at)
    VALUES (?, ?, ?, 1, ?, 'AI 智能包免费试用', 'platform', ?)
    ON CONFLICT(tenant_id, feature) DO UPDATE SET enabled = 1, expires_at = excluded.expires_at, note = excluded.note, updated_by = 'platform', updated_at = excluded.updated_at`)
    .run(randomId('ent'), tenantId, AI_ADDON.feature, untilIso, now)
  db.prepare("INSERT INTO tenant_settings (tenant_id, key, value, updated_at) VALUES (?, 'ai_trial_started_at', ?, ?) ON CONFLICT(tenant_id, key) DO NOTHING")
    .run(tenantId, JSON.stringify({ at: now }), now)
  return untilIso
}

// 不限期开通 AI 智能包(expires_at = NULL):体验店/内部店用。
// getEntitlements 对 expires_at 为空的覆盖项一律视为「永不过期」,所以这就是长期有效。
function grantAiAddonUnlimited(tenantId) {
  const now = iso(new Date())
  db.prepare(`INSERT INTO tenant_entitlements (id, tenant_id, feature, enabled, expires_at, note, updated_by, updated_at)
    VALUES (?, ?, ?, 1, NULL, 'AI 智能包长期开通(不限期)', 'platform', ?)
    ON CONFLICT(tenant_id, feature) DO UPDATE SET enabled = 1, expires_at = NULL, note = excluded.note, updated_by = 'platform', updated_at = excluded.updated_at`)
    .run(randomId('ent'), tenantId, AI_ADDON.feature, now)
  return null
}

// 顺延 AI 智能包到期日:以 max(原到期日, 今天) 为基准 + 周期
function extendAiAddon(tenantId, period) {
  const row = db.prepare('SELECT * FROM tenant_entitlements WHERE tenant_id = ? AND feature = ?').get(tenantId, AI_ADDON.feature)
  const base = new Date(Math.max(Date.now(), row?.expires_at ? new Date(row.expires_at).getTime() : 0))
  const next = new Date(base)
  if (period === 'month') next.setMonth(next.getMonth() + 1)
  else next.setFullYear(next.getFullYear() + 1)
  const nextIso = iso(next)
  db.prepare(`INSERT INTO tenant_entitlements (id, tenant_id, feature, enabled, expires_at, note, updated_by, updated_at)
    VALUES (?, ?, ?, 1, ?, 'AI 智能包订阅', 'billing', ?)
    ON CONFLICT(tenant_id, feature) DO UPDATE SET enabled = 1, expires_at = excluded.expires_at, note = excluded.note, updated_by = 'billing', updated_at = excluded.updated_at`)
    .run(randomId('ent'), tenantId, AI_ADDON.feature, nextIso, iso(new Date()))
  return nextIso
}
const OWNER_EMAILS = (process.env.OWNER_EMAILS || 'nini3131254931@gmail.com').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean)
const STAFF_EMAILS = (process.env.STAFF_EMAILS || 'staff@luckyluxeatelier.com,employee@luckyluxeatelier.com').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean)
const STAFF_DEMO_PASSWORD = process.env.STAFF_DEMO_PASSWORD || 'LuckyluxeStaff0312'
const STAFF_TECH_MAP = Object.fromEntries((process.env.STAFF_TECH_MAP || 'staff@luckyluxeatelier.com:tech-mia,employee@luckyluxeatelier.com:tech-ava')
  .split(',')
  .map((pair) => pair.split(':').map((value) => value.trim().toLowerCase()))
  .filter(([email, technicianId]) => email && technicianId))
const FINANCE_EMAILS = (process.env.FINANCE_EMAILS || 'nini3131254931@gmail.com').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean)
const FINANCE_PASSWORD = process.env.FINANCE_PASSWORD || ''
const HOLD_MINUTES = Number(process.env.BOOKING_HOLD_MINUTES || 30)
const DRAFT_PAYMENT_REMINDER_MINUTES = Number(process.env.DRAFT_PAYMENT_REMINDER_MINUTES || 20)
const HUMAN_REPLY_COOLDOWN_MINUTES = Number(process.env.HUMAN_REPLY_COOLDOWN_MINUTES || 10)
const SLOT_MINUTES = 30
const APP_PUBLIC_URL = (process.env.APP_PUBLIC_URL || 'https://www.luckyluxeatelier.com').replace(/\/$/, '')
const WECHAT_MINI_APPID = process.env.WECHAT_MINI_APPID || process.env.WX_MINI_APPID || ''
const WECHAT_MINI_SECRET = process.env.WECHAT_MINI_SECRET || process.env.WX_MINI_APPSECRET || ''
const WECHAT_MINI_TOKEN_SECRET = process.env.WECHAT_MINI_TOKEN_SECRET || process.env.WX_MINI_TOKEN_SECRET || WECHAT_MINI_SECRET || OWNER_TOKEN || 'luckyluxe-mini-dev'
const WECOM_CORP_ID = process.env.WECOM_CORP_ID || ''
const WECOM_CUSTOMER_SERVICE_SECRET = process.env.WECOM_CUSTOMER_SERVICE_SECRET || ''
const WECOM_CUSTOMER_SERVICE_TOKEN = process.env.WECOM_CUSTOMER_SERVICE_TOKEN || ''
const WECOM_CUSTOMER_SERVICE_AES_KEY = process.env.WECOM_CUSTOMER_SERVICE_AES_KEY || ''
const WECOM_OPEN_KFID = process.env.WECOM_OPEN_KFID || ''
const WECOM_AGENT_ID = process.env.WECOM_AGENT_ID || ''
// 转人工提醒推给谁(企微成员账号);默认 @all = 应用可见范围内全体
const WECOM_NOTIFY_USERID = process.env.WECOM_NOTIFY_USERID || '@all'

const addOns = [
  { id: 'remove', name: '卸甲/卸睫', priceCents: 3000, durationMin: 30 },
  { id: 'reinforce', name: '甲面加固', priceCents: 4000, durationMin: 15 },
  { id: 'senior', name: '指定资深技师', priceCents: 6000, durationMin: 0 },
  { id: 'extend', name: '延长加项时间', priceCents: 5000, durationMin: 30 }
]

const seedServices = [
  ['nail-french-01', 'NAIL', '法式系列', '经典奶油法式', 'Classic Cream French', '柔和奶油底色搭配细线法式边，适合通勤与约会场景。', 'Soft cream base with a delicate French line for daily wear and special dates.', '/assets/images/nail-french.jpg', 16800, 5000, 120, 1, ['甲型修整', '基础护理', '底色上色', '法式线条', '封层护理'], ['服务前请尽量避免自行修剪过短', '如需卸甲请在预约时勾选加项']],
  ['nail-luxe-01', 'NAIL', '轻奢设计', '柔金贝母设计', 'Soft Gold Shell Design', '贝母片与柔金线条组合，保留高级感，也适合日常穿搭。', 'Mother-of-pearl accents and soft gold lines for an elevated everyday style.', '/assets/images/nail-luxe.jpg', 23800, 5000, 150, 2, ['甲面护理', '底色铺设', '贝母定位', '金线装饰', '加固封层'], ['复杂设计耗时较长，请预留完整服务时间']],
  ['nail-jp-01', 'NAIL', '日式款', '日式微闪渐变', 'Japanese Shimmer Gradient', '细腻微闪从甲根自然过渡，温柔显白，适合短甲。', 'A subtle shimmer gradient that looks soft, clean, and flattering on short nails.', '/assets/images/nail-jp.jpg', 19800, 5000, 120, 3, ['手部清洁', '甲型调整', '渐变叠色', '微闪点缀', '封层'], ['渐变色可到店根据肤色调整']],
  ['nail-care-01', 'NAIL', '基础护理', '手部基础护理', 'Basic Hand Care', '修型、软化、死皮护理与营养油养护，适合定期维护。', 'Shape, soften, clean cuticles, and nourish for regular maintenance.', '/assets/images/nail-care.jpg', 8800, 5000, 120, 4, ['清洁消毒', '修型', '软化护理', '死皮修整', '营养油'], ['此项目不含甲油胶上色']],
  ['lash-natural-01', 'LASH', '自然款', '裸感自然睫', 'Bare Natural Lash', '轻盈自然，放大眼神但保留原生感。', 'Light, natural lashes that open the eyes while keeping a bare-skin look.', '/assets/images/lash-natural.jpg', 19800, 5000, 120, 1, ['眼型沟通', '清洁隔离', '睫毛嫁接', '梳理定型', '护理说明'], ['服务后 6 小时内尽量避免接触水汽']],
  ['lash-volume-01', 'LASH', '浓密款', '轻盈浓密睫', 'Soft Volume Lash', '在自然舒适的基础上增强存在感，适合拍照和重要场合。', 'Comfortable volume with stronger presence for photos and special occasions.', '/assets/images/lash-volume.jpg', 26800, 5000, 120, 2, ['眼型设计', '分层嫁接', '密度调整', '梳理检查', '护理说明'], ['敏感眼型请提前备注']]
]

function setupDatabase() {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'chain',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      name_zh TEXT NOT NULL,
      name_en TEXT NOT NULL,
      features_json TEXT NOT NULL DEFAULT '[]',
      limits_json TEXT NOT NULL DEFAULT '{}',
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS tenant_kb_facts (
      tenant_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, key)
    );
    CREATE TABLE IF NOT EXISTS finance_transactions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'lucky-luxe',
      store_id TEXT,
      type TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      category TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '',
      amount_cents INTEGER NOT NULL,
      pay_channel TEXT NOT NULL DEFAULT 'unknown',
      occurred_on TEXT NOT NULL,
      note TEXT,
      booking_id TEXT,
      recurring_rule_id TEXT,
      reversal_of TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_finance_txn_tenant_date ON finance_transactions(tenant_id, occurred_on);
    CREATE INDEX IF NOT EXISTS idx_finance_txn_booking ON finance_transactions(booking_id);
    CREATE TABLE IF NOT EXISTS stored_value_transactions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'lucky-luxe',
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      pay_channel TEXT NOT NULL DEFAULT 'unknown',
      note TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_stored_value_user ON stored_value_transactions(tenant_id, user_id);
    CREATE TABLE IF NOT EXISTS finance_targets (
      tenant_id TEXT PRIMARY KEY,
      target_mode TEXT NOT NULL DEFAULT 'net_profit',
      month_target_cents INTEGER NOT NULL DEFAULT 0,
      year_target_cents INTEGER,
      variable_cost_rate REAL NOT NULL DEFAULT 0.25,
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS staff_compensation (
      technician_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'lucky-luxe',
      base_salary_cents INTEGER NOT NULL DEFAULT 0,
      commission_rate REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS finance_recurring_rules (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'lucky-luxe',
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '',
      amount_cents INTEGER NOT NULL,
      cadence TEXT NOT NULL DEFAULT 'monthly',
      day_of_month INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      last_run_on TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS tenant_kb_documents (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      updated_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS tenant_kb_entries (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      question TEXT NOT NULL,
      keywords TEXT NOT NULL DEFAULT '',
      answer_zh TEXT NOT NULL,
      answer_en TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    -- AI 用量计量(2026-08-04):此前套餐里写着"连锁版 10 万条/月",但**代码里没有任何地方在数条数**,
    -- 也没有用量表——买了包的和滥用的一视同仁。这张表按 门店×月份 累计真实发生的 AI 调用次数。
    CREATE TABLE IF NOT EXISTS ai_usage (
      tenant_id TEXT NOT NULL,
      month TEXT NOT NULL,              -- YYYY-MM,按门店时区
      used INTEGER NOT NULL DEFAULT 0,
      bonus INTEGER NOT NULL DEFAULT 0, -- 平台临时加量(不改套餐的前提下给某店多批一些)
      updated_at TEXT,
      PRIMARY KEY (tenant_id, month)
    );
    -- 平台通用 AI 知识库(2026-08-04):原先只存在静态种子 phase1-kb.seed.json 里、没有后台可改。
    -- 这是「两层知识库」的上层:所有商家共享的通用美业流程/话术/转人工边界。
    -- 下层(店家私有)仍走 tenant_kb_entries / tenant_kb_facts,按租户隔离,互不影响。
    CREATE TABLE IF NOT EXISTS platform_kb_entries (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'qa',        -- qa=问答口径 / rule=通用规则
      intent TEXT,                            -- 意图标签(pricing/booking/policy/after_sales...)
      question TEXT,                          -- qa:顾客常见问法
      content TEXT NOT NULL,                  -- qa:回答口径;rule:规则正文
      handoff_required INTEGER NOT NULL DEFAULT 0,
      handoff_type TEXT,                      -- technician/frontdesk/owner
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS plan_change_requests (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      current_plan TEXT NOT NULL,
      target_plan TEXT NOT NULL,
      request_type TEXT NOT NULL DEFAULT 'upgrade',
      note TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS tenant_entitlements (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      feature TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT,
      note TEXT,
      updated_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, feature)
    );
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
    CREATE TABLE IF NOT EXISTS user_identities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      union_id TEXT,
      email TEXT,
      phone TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (provider, provider_user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_identities_user_id ON user_identities(user_id);
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
      deposit_required_cents INTEGER NOT NULL DEFAULT 5000,
      deposit_waived_cents INTEGER NOT NULL DEFAULT 0,
      deposit_waive_reason TEXT,
      member_level_at_booking TEXT,
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
    CREATE TABLE IF NOT EXISTS wechat_conversations (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      external_user_id TEXT NOT NULL,
      open_kfid TEXT,
      source_channel TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      last_intent TEXT,
      last_message TEXT,
      ai_reply_json TEXT NOT NULL DEFAULT '{}',
      transcript_json TEXT NOT NULL DEFAULT '[]',
      raw_event_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS ai_response_feedback (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      message_index INTEGER,
      customer_message TEXT NOT NULL,
      original_reply TEXT NOT NULL,
      corrected_reply TEXT NOT NULL,
      notes TEXT,
      lang TEXT NOT NULL DEFAULT 'zh',
      source_channel TEXT,
      intent TEXT,
      status TEXT NOT NULL DEFAULT 'approved',
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES wechat_conversations(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_response_feedback_status ON ai_response_feedback(status, updated_at);
    CREATE TABLE IF NOT EXISTS ai_conversation_states (
      conversation_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'lucky-luxe',
      source_channel TEXT,
      service_type TEXT,
      intent TEXT,
      customer_stage TEXT,
      quote_stage TEXT NOT NULL DEFAULT 'idle',
      next_action TEXT,
      reference_images_json TEXT NOT NULL DEFAULT '[]',
      state_json TEXT NOT NULL DEFAULT '{}',
      summary_text TEXT,
      last_customer_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES wechat_conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_ai_conversation_states_updated ON ai_conversation_states(updated_at);
    CREATE TABLE IF NOT EXISTS ai_learning_examples (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'lucky-luxe',
      conversation_id TEXT,
      feedback_id TEXT,
      source TEXT NOT NULL DEFAULT 'owner_feedback',
      customer_message TEXT NOT NULL,
      original_reply TEXT,
      corrected_reply TEXT NOT NULL,
      context_json TEXT NOT NULL DEFAULT '{}',
      tags_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'approved',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES wechat_conversations(id) ON DELETE SET NULL,
      FOREIGN KEY (feedback_id) REFERENCES ai_response_feedback(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_learning_examples_status ON ai_learning_examples(status, updated_at);
    CREATE TABLE IF NOT EXISTS quote_requests (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      user_id TEXT,
      source_channel TEXT,
      service_type TEXT NOT NULL DEFAULT 'nail',
      service_id TEXT,
      technician_id TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING_STAFF',
      customer_message TEXT,
      customer_lang TEXT NOT NULL DEFAULT 'zh',
      reference_images_json TEXT NOT NULL DEFAULT '[]',
      style_elements_json TEXT NOT NULL DEFAULT '{}',
      missing_questions_json TEXT NOT NULL DEFAULT '[]',
      extension_needed TEXT NOT NULL DEFAULT 'unknown',
      removal_needed TEXT NOT NULL DEFAULT 'unknown',
      repair_needed TEXT NOT NULL DEFAULT 'unknown',
      charms_needed TEXT NOT NULL DEFAULT 'unknown',
      lower_lash_requested TEXT NOT NULL DEFAULT 'unknown',
      health_check_clear TEXT NOT NULL DEFAULT 'unknown',
      staff_can_do INTEGER,
      staff_price_cents INTEGER,
      staff_duration_min INTEGER,
      staff_notes TEXT,
      ai_reply_json TEXT NOT NULL DEFAULT '{}',
      draft_booking_id TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES wechat_conversations(id) ON DELETE SET NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL,
      FOREIGN KEY (technician_id) REFERENCES technicians(id) ON DELETE SET NULL,
      FOREIGN KEY (draft_booking_id) REFERENCES bookings(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_quote_requests_status ON quote_requests(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_quote_requests_technician ON quote_requests(technician_id, updated_at);
    CREATE TABLE IF NOT EXISTS booking_drafts (
      id TEXT PRIMARY KEY,
      quote_request_id TEXT,
      conversation_id TEXT,
      user_id TEXT,
      source_channel TEXT,
      service_id TEXT NOT NULL,
      technician_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      addons_json TEXT NOT NULL DEFAULT '[]',
      reference_images_json TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      booking_id TEXT,
      link_url TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (quote_request_id) REFERENCES quote_requests(id) ON DELETE SET NULL,
      FOREIGN KEY (conversation_id) REFERENCES wechat_conversations(id) ON DELETE SET NULL,
      FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_booking_drafts_status ON booking_drafts(status, expires_at);
    CREATE INDEX IF NOT EXISTS idx_booking_drafts_quote ON booking_drafts(quote_request_id);
    CREATE TABLE IF NOT EXISTS reminder_tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      booking_id TEXT,
      quote_request_id TEXT,
      conversation_id TEXT,
      type TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'mock',
      status TEXT NOT NULL DEFAULT 'PENDING',
      scheduled_at TEXT NOT NULL,
      sent_at TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL,
      FOREIGN KEY (quote_request_id) REFERENCES quote_requests(id) ON DELETE SET NULL,
      FOREIGN KEY (conversation_id) REFERENCES wechat_conversations(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reminder_tasks_due ON reminder_tasks(status, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_reminder_tasks_quote ON reminder_tasks(quote_request_id);
  `)
}

const WEEKDAY_LABELS = {
  zh: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
}
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

function defaultStoreId() {
  // 租户感知:取"当前租户上下文"的门店(商家端=登录账号的店;无上下文=默认店)
  return db.prepare('SELECT id FROM stores WHERE is_active = 1 AND tenant_id = ? ORDER BY name ASC').get(currentTenantId())?.id || null
}

function getBusinessHoursRows(storeId = null) {
  const id = storeId || defaultStoreId()
  if (!id) return []
  return db.prepare('SELECT * FROM business_hours WHERE store_id = ? ORDER BY weekday ASC').all(id)
}

function serializeBusinessHour(row) {
  return {
    weekday: row.weekday,
    openTime: row.open_time,
    closeTime: row.close_time,
    isClosed: Boolean(row.is_closed),
    updatedAt: row.updated_at || null,
    updatedBy: row.updated_by || null
  }
}

function specialDateFor(storeId, date) {
  return db.prepare('SELECT * FROM store_special_dates WHERE store_id = ? AND date = ?').get(storeId || defaultStoreId(), date) || null
}

function upcomingSpecialDates(storeId = null, limitDays = 45) {
  const id = storeId || defaultStoreId()
  if (!id) return []
  const today = new Date()
  const from = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const until = new Date(today)
  until.setDate(until.getDate() + limitDays)
  const to = `${until.getFullYear()}-${String(until.getMonth() + 1).padStart(2, '0')}-${String(until.getDate()).padStart(2, '0')}`
  return db.prepare('SELECT * FROM store_special_dates WHERE store_id = ? AND date >= ? AND date <= ? ORDER BY date ASC').all(id, from, to)
}

function businessHoursText(storeId = null, lang = 'zh') {
  const rows = getBusinessHoursRows(storeId)
  if (!rows.length) return lang === 'en' ? 'business hours not configured yet' : '营业时间未设置'
  const byWeekday = new Map(rows.map((row) => [row.weekday, row]))
  const groups = []
  for (const weekday of WEEKDAY_ORDER) {
    const row = byWeekday.get(weekday)
    if (!row) continue
    const key = row.is_closed ? 'closed' : `${row.open_time}-${row.close_time}`
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.days.push(weekday)
    else groups.push({ key, closed: Boolean(row.is_closed), open: row.open_time, close: row.close_time, days: [weekday] })
  }
  const labels = WEEKDAY_LABELS[lang === 'en' ? 'en' : 'zh']
  const parts = groups.map((group) => {
    const first = labels[group.days[0]]
    const last = labels[group.days[group.days.length - 1]]
    const range = group.days.length === 1 ? first : (lang === 'en' ? `${first} to ${last}` : `${first}至${last}`)
    if (group.closed) return lang === 'en' ? `${range} closed` : `${range}休息`
    return `${range} ${group.open}-${group.close}`
  })
  let text = parts.join(lang === 'en' ? ', ' : '，')
  // 近期特殊日期(节假日)自动并入 AI 回答,避免顾客按常规时间到店扑空
  const specials = upcomingSpecialDates(storeId)
  if (specials.length) {
    const specialParts = specials.map((row) => {
      const note = row.note ? `(${row.note})` : ''
      if (row.is_closed) return lang === 'en' ? `${row.date} closed${note}` : `${row.date} 休息${note}`
      return lang === 'en' ? `${row.date} ${row.open_time}-${row.close_time}${note}` : `${row.date} ${row.open_time}-${row.close_time}${note}`
    })
    text += lang === 'en' ? `. Special dates: ${specialParts.join(', ')}` : `。特殊安排：${specialParts.join('，')}`
  }
  return text
}

function tenantKbFacts(tenantId = DEFAULT_TENANT_ID) {
  const facts = {}
  for (const row of db.prepare('SELECT key, value FROM tenant_kb_facts WHERE tenant_id = ?').all(tenantId)) {
    facts[row.key] = row.value
  }
  return facts
}

// ===== 平台通用知识库(上层):首次启动把种子里 scope='platform' 的条目导进表,之后一律以表为准 =====
function seedPlatformKbIfEmpty() {
  const n = db.prepare('SELECT COUNT(*) AS n FROM platform_kb_entries').get().n
  if (n > 0) return
  let seed = null
  try { seed = loadCustomerServiceKnowledgeBase() } catch (e) { return }
  const now = iso(new Date())
  const ins = db.prepare(`INSERT INTO platform_kb_entries (id, kind, intent, question, content, handoff_required, handoff_type, enabled, sort_order, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 'seed', ?, ?)`)
  let order = 0
  for (const qa of (seed.qaEntries || []).filter((e) => e.scope === 'platform')) {
    ins.run(qa.id || randomId('pkb'), 'qa', qa.intent || null, qa.customerQuestionZh || '', qa.answerGuidanceZh || '',
      qa.handoffRequired ? 1 : 0, qa.handoffType || null, order++, now, now)
  }
  for (const rule of (seed.businessRules || []).filter((e) => e.scope === 'platform')) {
    ins.run(rule.id || randomId('pkb'), 'rule', null, '', rule.rule || '', 0, null, order++, now, now)
  }
}

// 供 kb-utils 覆盖种子的 platform 层:表里有内容就用表的,表被清空则自动回落到种子
function platformKbOverride() {
  const rows = db.prepare('SELECT * FROM platform_kb_entries WHERE enabled = 1 ORDER BY sort_order ASC, rowid ASC').all()
  if (!rows.length) return null
  return {
    qaEntries: rows.filter((r) => r.kind === 'qa').map((r) => ({
      id: r.id,
      scope: 'platform',
      intent: r.intent || undefined,
      customerQuestionZh: r.question || '',
      answerGuidanceZh: r.content || '',
      handoffRequired: Boolean(r.handoff_required),
      handoffType: r.handoff_type || undefined
    })),
    businessRules: rows.filter((r) => r.kind === 'rule').map((r) => ({
      id: r.id, scope: 'platform', status: 'confirmed', rule: r.content || ''
    }))
  }
}

// 静态种子知识库(phase1-kb.seed.json)是旗舰店 Lucky Luxe 的口径(安省/CAD/美甲价目表)。
// 只有旗舰店本身允许回落到种子,其他租户一律用自己库里的实时数据,否则会把别家的价格/地区念给顾客听。
const KB_SEED_TENANT_IDS = new Set(['lucky-luxe', 'luckyluxe'])

// AI 每次回答都实时读这里:商家在小程序或网页改完基础信息,下一句回答就是新的,无需重新发布知识库。
function liveTenantFacts() {
  const tid = currentTenantId()
  const facts = tenantKbFacts(tid)
  const store = db.prepare('SELECT address, phone, currency FROM stores WHERE tenant_id = ? AND is_active = 1 ORDER BY rowid ASC LIMIT 1').get(tid)
  const currency = facts.currency || store?.currency || ''
  const priceOf = (cents) => (cents || cents === 0 ? Number((cents / 100).toFixed(2)) : null)
  // 价目表:直接由「服务项目」生成,商家改价即时生效
  // 2026-08-06 P0:多价位模型上线后,每项带上三档价与疗程价,AI 回答分享价/会员价才不会瞎编
  const categoryById = {}
  for (const cat of db.prepare('SELECT * FROM service_categories WHERE tenant_id = ?').all(tid)) categoryById[cat.id] = cat
  const tierPrices = (serviceId) => {
    const map = servicePriceMap(serviceId)
    return {
      sharePrice: map.share ? priceOf(map.share.priceCents) : undefined,
      memberPrice: map.member ? priceOf(map.member.priceCents) : undefined,
      coursePrice: map.course ? priceOf(map.course.priceCents) : undefined,
      courseTimes: map.course ? (map.course.courseTimes || undefined) : undefined
    }
  }
  const allItems = db.prepare("SELECT id, name_zh, name_en, price_cents, deposit_cents, base_duration_min, item_kind, category_id, unit, addon_scope_json FROM services WHERE tenant_id = ? AND is_active = 1 ORDER BY sort_order ASC, rowid ASC").all(tid)
  const services = allItems.filter((s) => (s.item_kind || 'main') !== 'addon')
  const addons = allItems.filter((s) => (s.item_kind || 'main') === 'addon')
  const priceList = services.length ? {
    currency,
    policy: '以下为门店当前在售项目的基础价;参考图、复杂款、加项与特殊材料需技师确认最终报价。',
    items: services.map((s) => ({
      nameZh: s.name_zh,
      nameEn: s.name_en || undefined,
      category: s.category_id && categoryById[s.category_id] ? categoryById[s.category_id].name : undefined,
      price: priceOf(s.price_cents),
      deposit: priceOf(s.deposit_cents),
      durationMin: s.base_duration_min || undefined,
      ...tierPrices(s.id)
    }))
  } : null
  // 加项目录:顾客问「卸甲多少钱」「补一根多少钱」时 AI 才答得上来,并知道这个加项能配在哪些大类上
  const addonList = addons.length ? {
    currency,
    policy: '加项在主项目之外单独计费;单指类按指数计费。',
    items: addons.map((s) => {
      let scope = []
      try { scope = JSON.parse(s.addon_scope_json || '[]') } catch { scope = [] }
      return {
        nameZh: s.name_zh,
        nameEn: s.name_en || undefined,
        unit: s.unit === 'per_finger' ? '按指' : (s.unit === 'per_session' ? '按次' : '单次'),
        price: priceOf(s.price_cents),
        appliesTo: scope.map((catId) => categoryById[catId]?.name).filter(Boolean),
        ...tierPrices(s.id)
      }
    })
  } : null
  // 计价规则摘要:用自然语言写进事实,AI 就不会把「足部加收」「本店免卸」答错
  const ruleState = getPricingRules(tid)
  const ruleTexts = []
  if (ruleState.foot_surcharge.isActive) ruleTexts.push(`足部项目在最终金额上整单加收 ${priceOf(ruleState.foot_surcharge.config.amountCents)}(任何价格档都一样加)。`)
  if (ruleState.single_finger.isActive) ruleTexts.push(`单指计费:按该单所用价格档的延长类主项目价的 ${ruleState.single_finger.config.pct || 10}% 每指计算。`)
  if (ruleState.tip_reuse.isActive) ruleTexts.push(`甲片重利用固定收 ${priceOf(ruleState.tip_reuse.config.amountCents)},不分价格档。`)
  const pricingRules = ruleTexts.length ? ruleTexts : null
  // 定金与取消规则:AI 必须按本店配置回答,不能再用旗舰店的口径(P1.2)
  const depositConfigForAi = getDepositConfig(tid)
  const depositPolicy = {
    enabled: depositConfigForAi.enabled,
    deductible: depositConfigForAi.deductible,
    onlinePaymentReady: ONLINE_PAYMENT_READY,
    text: depositPolicyText(depositConfigForAi, tid, 'zh'),
    textEn: depositPolicyText(depositConfigForAi, tid, 'en')
  }
  // 会员/储值方案:同样实时读商家自己的配置
  const packages = db.prepare('SELECT kind, name, price_cents, bonus_cents, times_count, benefits FROM membership_packages WHERE tenant_id = ? AND is_active = 1 ORDER BY sort_order ASC, rowid ASC').all(tid)
  const memberLevels = packages.length ? packages.map((p) => ({
    name: p.name,
    kind: p.kind === 'times' ? '次卡' : '储值卡',
    price: priceOf(p.price_cents),
    bonus: p.bonus_cents ? priceOf(p.bonus_cents) : undefined,
    times: p.times_count || undefined,
    benefits: p.benefits || undefined
  })) : null
  // 技师名单:顾客问「有哪些技师/谁做美睫」时 AI 才答得上来
  const technicians = db.prepare('SELECT name, title FROM technicians WHERE tenant_id = ? AND is_active = 1 ORDER BY rowid ASC').all(tid)
    .map((t) => (t.title ? `${t.name}(${t.title})` : t.name))
  return {
    tenantId: tid, // 让提示词里的 tenantId 是真实租户,而不是种子里写死的 luckyluxe
    defaultHours: {
      zh: businessHoursText(null, 'zh'),
      en: businessHoursText(null, 'en')
    },
    // 允许回落到静态种子的只有旗舰店;其他租户即使某项为空也不借用种子数据
    allowSeedFallback: KB_SEED_TENANT_IDS.has(tid),
    ...(facts.brandName ? { brandName: facts.brandName } : {}),
    ...(facts.assistantName ? { assistantName: facts.assistantName } : {}),
    ...(facts.storeAddress || store?.address ? { storeAddress: facts.storeAddress || store.address } : {}),
    ...(facts.storePhone || store?.phone ? { storePhone: facts.storePhone || store.phone } : {}),
    ...(facts.depositAmount ? { depositAmount: Number(facts.depositAmount) || facts.depositAmount } : {}),
    ...(currency ? { currency } : {}),
    ...(facts.region ? { region: facts.region } : {}),
    ...(priceList ? { priceList } : {}),
    ...(addonList ? { addonList } : {}),
    ...(pricingRules ? { pricingRules } : {}),
    depositPolicy,
    ...(memberLevels ? { memberLevels } : {}),
    ...(technicians.length ? { technicians } : {})
  }
}

// 商家上传文档的解析：识别 CSV（问题,关键词,回答）与问答体（问:/答:），供文件导入直接拆条。
function parseKbEntriesFromText(content = '') {
  const text = String(content || '').replace(/\r\n/g, '\n').trim()
  if (!text) return []
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
  const entries = []
  // 格式 A：CSV，表头含 问题/question
  if (lines.length >= 2 && /(问题|question)/i.test(lines[0]) && lines[0].includes(',')) {
    const header = lines[0].split(',').map((cell) => cell.trim().toLowerCase())
    const qIndex = header.findIndex((cell) => /问题|question/.test(cell))
    const kIndex = header.findIndex((cell) => /关键词|keyword/.test(cell))
    const aIndex = header.findIndex((cell) => /回答|答案|answer/.test(cell))
    if (qIndex >= 0 && aIndex >= 0) {
      for (const line of lines.slice(1)) {
        const cells = line.split(',').map((cell) => cell.trim())
        const question = cells[qIndex] || ''
        const answerZh = cells[aIndex] || ''
        if (question && answerZh) {
          entries.push({ question, keywords: (kIndex >= 0 && cells[kIndex]) || question, answerZh, answerEn: '' })
        }
      }
      return entries
    }
  }
  // 格式 B：问答体（问:/Q:/问题: 与 答:/A:/回答:）
  let currentQuestion = ''
  let currentAnswer = []
  const flush = () => {
    if (currentQuestion && currentAnswer.length) {
      entries.push({ question: currentQuestion, keywords: currentQuestion, answerZh: currentAnswer.join(' '), answerEn: '' })
    }
    currentQuestion = ''
    currentAnswer = []
  }
  for (const line of lines) {
    const questionMatch = line.match(/^(?:问题?|Q)\s*[:：]\s*(.+)$/i)
    const answerMatch = line.match(/^(?:回?答|A)\s*[:：]\s*(.+)$/i)
    if (questionMatch) {
      flush()
      currentQuestion = questionMatch[1].trim()
    } else if (answerMatch && currentQuestion) {
      currentAnswer.push(answerMatch[1].trim())
    } else if (currentQuestion && currentAnswer.length) {
      currentAnswer.push(line)
    }
  }
  flush()
  return entries
}

function tenantKbDocumentsForPrompt(tenantId = DEFAULT_TENANT_ID) {
  return db.prepare('SELECT title, content FROM tenant_kb_documents WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 3').all(tenantId)
    .map((row) => ({ title: row.title, content: String(row.content || '').slice(0, 1500) }))
}

// 商家自助 FAQ 匹配：仅当消息不含服务/报价/预约意图时直答，避免抢占询单流程。
function matchTenantKbEntry(text = '') {
  const compact = compactIntentText(text)
  if (!compact) return null
  if (/美甲|美睫|睫毛|指甲|款式|参考图|报价|价格|多少钱|卸甲|延长|断甲|修补|预约|想约|要约|确认预约|nail|lash|quote|price|book/.test(compact)) return null
  const rows = db.prepare('SELECT * FROM tenant_kb_entries WHERE tenant_id = ? AND enabled = 1 ORDER BY updated_at DESC').all(currentTenantId())
  for (const row of rows) {
    const keywords = String(row.keywords || '').split(/[,，、/\s]+/).map((keyword) => keyword.trim()).filter(Boolean)
    if (keywords.some((keyword) => compact.includes(compactIntentText(keyword)))) return row
  }
  return null
}

function seedDatabase() {
  db.prepare('INSERT OR IGNORE INTO tenants (id, name, plan, status) VALUES (?, ?, ?, ?)').run(DEFAULT_TENANT_ID, 'Lucky Luxe', 'chain', 'active')
  const planStmt = db.prepare('INSERT OR IGNORE INTO plans (id, name_zh, name_en, features_json, limits_json, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
  // 2026-08-03 档位=Youji Pricing 定价页(店主确认的唯一口径):免费版/单店版/工作室版/连锁版/定制版
  planStmt.run('free', '免费版', 'Free', JSON.stringify(['booking', 'gallery']), JSON.stringify({ maxStores: 1, maxStaff: 1, maxServices: 20, maxOrdersPerMonth: 50, aiMessagesPerMonth: 0 }), 1)
  planStmt.run('single', '单店版', 'Single Store', JSON.stringify(['booking', 'crm', 'gallery', 'membership', 'staff_schedule', 'reports']), JSON.stringify({ maxStores: 1, maxStaff: 3, aiMessagesPerMonth: 0 }), 2)
  planStmt.run('studio', '工作室版', 'Studio', JSON.stringify(['booking', 'crm', 'gallery', 'membership', 'staff_schedule', 'reports', 'advanced_reports']), JSON.stringify({ maxStores: 1, maxStaff: 15, aiMessagesPerMonth: 0 }), 3)
  planStmt.run('chain', '连锁版', 'Chain', JSON.stringify(['booking', 'crm', 'gallery', 'membership', 'staff_schedule', 'reports', 'advanced_reports', 'multi_store', 'ai_customer_service']), JSON.stringify({ maxStores: 10, maxStaff: 999, aiMessagesPerMonth: 100000 }), 4)
  planStmt.run('custom', '定制版', 'Custom', JSON.stringify(['booking', 'crm', 'gallery', 'membership', 'staff_schedule', 'reports', 'advanced_reports', 'multi_store', 'ai_customer_service', 'white_label']), JSON.stringify({ maxStores: 999, maxStaff: 999, aiMessagesPerMonth: 1000000 }), 5)
  // 老档位(solo/studio 旧义/member)对齐:已有租户平移到最接近的新档位,再清掉废弃档位行
  db.prepare("UPDATE plans SET name_zh = '工作室版', name_en = 'Studio', features_json = ?, limits_json = ?, sort_order = 3 WHERE id = 'studio'")
    .run(JSON.stringify(['booking', 'crm', 'gallery', 'membership', 'staff_schedule', 'reports', 'advanced_reports']), JSON.stringify({ maxStores: 1, maxStaff: 15, aiMessagesPerMonth: 0 }))
  db.prepare("UPDATE plans SET name_zh = '连锁版', name_en = 'Chain', features_json = ?, limits_json = ?, sort_order = 4 WHERE id = 'chain'")
    .run(JSON.stringify(['booking', 'crm', 'gallery', 'membership', 'staff_schedule', 'reports', 'advanced_reports', 'multi_store', 'ai_customer_service']), JSON.stringify({ maxStores: 10, maxStaff: 999, aiMessagesPerMonth: 100000 }))
  db.prepare("UPDATE plans SET name_zh = '定制版', name_en = 'Custom', sort_order = 5 WHERE id = 'custom'").run()
  db.prepare("UPDATE tenants SET plan = 'single' WHERE plan IN ('solo', 'member')").run()
  db.prepare("DELETE FROM plans WHERE id IN ('solo', 'member')").run()
  // 租户私有事实种子（来自 phase1-kb tenantPrivate 层）：商家可在门店设置里自助修改，AI 实时读取。
  const kbFactStmt = db.prepare('INSERT OR IGNORE INTO tenant_kb_facts (tenant_id, key, value, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)')
  for (const [key, value] of [
    ['brandName', 'Lucky Luxe'],
    ['assistantName', 'Lucky Luxe 预约助手'],
    ['storeAddress', '136 veterans place'],
    ['depositAmount', '50'],
    ['currency', 'CAD']
  ]) kbFactStmt.run(DEFAULT_TENANT_ID, key, value, 'seed', iso(new Date()))
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
    'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
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
  let candidate = join(baseDir, cleaned)
  // 图片扩展名自愈:引用 .png 但文件是 .jpg(或反之)时自动换后缀,避免退回 index.html 变成花图
  if (!(existsSync(candidate) && statSync(candidate).isFile()) && /\.(png|jpe?g)$/i.test(candidate)) {
    const swaps = candidate.endsWith('.png')
      ? [candidate.replace(/\.png$/i, '.jpg'), candidate.replace(/\.png$/i, '.jpeg')]
      : [candidate.replace(/\.jpe?g$/i, '.png')]
    const found = swaps.find((alt) => existsSync(alt) && statSync(alt).isFile())
    if (found) candidate = found
    else {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('image not found')
      return true
    }
  }
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

function apiError(status, code, message, details = null) {
  const error = new Error(message)
  error.status = status
  error.code = code
  if (details) error.details = details
  return error
}

function requireOwner(req) {
  const admin = requireAdmin(req)
  if (admin.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
  return admin
}

function requireAdmin(req) {
  const auth = req.headers.authorization || ''
  if (auth === `Bearer ${OWNER_TOKEN}`) {
    // 平台主钥匙可显式指定要操作哪个租户(平台侧运维脚本用:体验店种子注入、代商家配价目表)。
    // 不带这个头时行为与以前完全一致(=默认租户),所以对现有调用零影响;主钥匙本来就是最高信任根。
    const asTenant = validTenantId(req.headers['x-admin-tenant-id'] || '')
    return { role: 'owner', provider: 'demo-token', technicianId: null, tenantId: asTenant }
  }
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  // 真实账号会话优先(sess_ 前缀);演示白名单 token 仅在本地开发开关下有效
  const accountAdmin = adminFromSessionToken(token)
  if (accountAdmin) return accountAdmin
  if (process.env.ALLOW_DEMO_ADMIN_LOGIN === 'true') {
    const ownerEmail = demoEmailFromToken(token, 'owner')
    if (ownerEmail && OWNER_EMAILS.includes(ownerEmail)) return adminForEmail(ownerEmail, 'demo-owner')
    const staffEmail = demoEmailFromToken(token, 'staff')
    if (staffEmail && STAFF_EMAILS.includes(staffEmail)) return adminForEmail(staffEmail, 'demo-staff')
  }
  throw apiError(401, 'UNAUTHORIZED', 'Admin login is required.')
}

function adminForEmail(email, provider) {
  const normalized = String(email || '').toLowerCase()
  if (OWNER_EMAILS.includes(normalized)) return { role: 'owner', email: normalized, provider, technicianId: null, tenantId: DEFAULT_TENANT_ID }
  if (STAFF_EMAILS.includes(normalized)) return { role: 'staff', email: normalized, provider, technicianId: STAFF_TECH_MAP[normalized] || 'tech-mia', tenantId: DEFAULT_TENANT_ID }
  return null
}

function assertStaffCanAccessBooking(admin, booking) {
  // 多租户:任何角色都只能操作本店订单
  if (booking.tenant_id && booking.tenant_id !== currentTenantId()) {
    throw apiError(404, 'NOT_FOUND', 'Booking not found.')
  }
  if (admin.role === 'staff' && booking.technician_id !== admin.technicianId) {
    throw apiError(403, 'FORBIDDEN', 'Staff can only access their own bookings.')
  }
}

function requireCustomer(req) {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const miniUser = customerFromMiniToken(token)
  if (miniUser) return miniUser
  const email = demoEmailFromToken(token, 'customer')
  if (email) return registerEmailUser({ email, displayName: email.split('@')[0] })
  throw apiError(401, 'UNAUTHORIZED', 'Customer login is required before booking or payment.')
}

// 平台主钥匙(OWNER_TOKEN):用于「只有我能改」的接口——档位、权限开通等
function isPlatformKey(req) {
  return (req.headers.authorization || '') === `Bearer ${OWNER_TOKEN}`
}

// 顾客或商家皆可(顾客端 AI 入口用):挡住完全匿名的调用,防止有人拿域名循环烧 AI 额度
function requireCustomerOrAdmin(req) {
  try { return requireCustomer(req) } catch (e) { /* 不是顾客,再试商家 */ }
  try { return requireAdmin(req) } catch (e) { /* 两者都不是 */ }
  throw apiError(401, 'UNAUTHORIZED', '请先登录后再使用该功能。')
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

function parseJson2(value) {
  try {
    return JSON.parse(value || '{}')
  } catch {
    return {}
  }
}

function publicAppUrl() {
  return APP_PUBLIC_URL || 'https://www.luckyluxeatelier.com'
}

function customerAppUrl() {
  return (process.env.APP_PUBLIC_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '')
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
    messageId: xmlValue(rawBody, 'MsgId') || xmlValue(rawBody, 'MsgID') || randomId('wxmsg')
  } : {}
  const content = body.content || body.text || body.message || xmlContent.content || ''
  return {
    provider: 'wecom_customer_service',
    externalUserId: body.externalUserId || body.external_userid || body.fromUserName || body.openid || xmlContent.externalUserId || 'mock-customer',
    openKfid: body.openKfid || body.open_kfid || xmlContent.openKfid || WECOM_OPEN_KFID || 'mock-open-kfid',
    msgType: body.msgType || body.msgtype || xmlContent.msgType || 'text',
    content,
    messageId: body.messageId || body.msgid || xmlContent.messageId || randomId('wxmsg'),
    sourceChannel: body.sourceChannel || body.source || '',
    lang: body.lang || (/^[\x00-\x7F]*$/.test(content) ? 'en' : 'zh'),
    referenceImages: normalizeReferenceImages(body.referenceImages || body.images || []),
    customerStage: body.customerStage || body.stage || '',
    customerType: body.customerType || body.customer_type || '',
    memberTier: body.memberTier || body.member_tier || '',
    points: Number(body.points || body.memberPoints || body.member_points || 0) || 0,
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
    { key: 'WECOM_OPEN_KFID', label: 'open_kfid', ok: Boolean(WECOM_OPEN_KFID) }
  ]
  return {
    provider: 'wecom_customer_service',
    mode: checks.every((item) => item.ok) ? 'ready' : 'pending_credentials',
    webhookUrl: wechatWebhookUrl(),
    checks
  }
}

// ── 企微微信客服 出站链路(gettoken / sync_msg / send_msg)──
// 密钥齐备(wecomConfigStatus=ready)时,回调事件触发真实拉取+AI回复发送;缺密钥时保持原 mock/测试路径不变。
const WECOM_API_BASE = 'https://qyapi.weixin.qq.com/cgi-bin'
let wecomTokenCache = { token: '', expiresAt: 0 }

function wecomOutboundReady() {
  return Boolean(WECOM_CORP_ID && WECOM_CUSTOMER_SERVICE_SECRET)
}

async function getWecomAccessToken(forceRefresh = false) {
  if (!forceRefresh && wecomTokenCache.token && Date.now() < wecomTokenCache.expiresAt) return wecomTokenCache.token
  const response = await fetch(`${WECOM_API_BASE}/gettoken?corpid=${encodeURIComponent(WECOM_CORP_ID)}&corpsecret=${encodeURIComponent(WECOM_CUSTOMER_SERVICE_SECRET)}`)
  const data = await response.json()
  if (data.errcode) throw apiError(502, 'WECOM_TOKEN_FAILED', `企微 access_token 获取失败:${data.errcode} ${data.errmsg}`)
  wecomTokenCache = { token: data.access_token, expiresAt: Date.now() + Math.max(60, (data.expires_in || 7200) - 300) * 1000 }
  return wecomTokenCache.token
}

async function wecomApiPost(pathName, payload) {
  let token = await getWecomAccessToken()
  let response = await fetch(`${WECOM_API_BASE}/${pathName}?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  })
  let data = await response.json()
  if (data.errcode === 40014 || data.errcode === 42001) {
    token = await getWecomAccessToken(true)
    response = await fetch(`${WECOM_API_BASE}/${pathName}?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    })
    data = await response.json()
  }
  return data
}

function readWecomKfCursor(openKfid) {
  const row = db.prepare('SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = ?').get(currentTenantId(), `wecom_kf_cursor_${openKfid}`)
  return row?.value || ''
}

function saveWecomKfCursor(openKfid, cursor) {
  db.prepare(`INSERT INTO tenant_settings (tenant_id, key, value, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(currentTenantId(), `wecom_kf_cursor_${openKfid}`, cursor || '', iso(new Date()))
}

async function sendWecomKfText(openKfid, externalUserId, content) {
  const text = String(content || '').slice(0, 2000)
  if (!text) return null
  const data = await wecomApiPost('kf/send_msg', {
    touser: externalUserId,
    open_kfid: openKfid,
    msgtype: 'text',
    text: { content: text }
  })
  if (data.errcode) console.error(`[wecom] send_msg 失败 ${data.errcode} ${data.errmsg} (touser=${externalUserId})`)
  return data
}

// 转人工时给店主/接待人员的企业微信 App 推一条应用消息(官方应用消息,不受 48 小时会话窗口限制)。
// 未配 AgentId 或出站未就绪时静默跳过——绝不因为通知失败影响主链路。
async function notifyWecomStaff(text) {
  if (!wecomOutboundReady() || !WECOM_AGENT_ID) return null
  try {
    const data = await wecomApiPost('message/send', {
      touser: WECOM_NOTIFY_USERID,
      msgtype: 'text',
      agentid: Number(WECOM_AGENT_ID),
      text: { content: String(text || '').slice(0, 2000) },
      duplicate_check_interval: 300
    })
    if (data.errcode) console.error(`[wecom] 应用消息推送失败 ${data.errcode} ${data.errmsg}`)
    return data
  } catch (error) {
    console.error('[wecom] 应用消息推送异常:', error?.message || error)
    return null
  }
}

// 回调事件只是"有新消息"通知;真实消息用 sync_msg 拉取,逐条走既有 handleWecomInbound(AI/转人工逻辑复用),再把 AI 回复经 send_msg 发回顾客。
async function syncAndProcessWecomKfMessages(openKfid, eventToken, req) {
  const results = []
  let cursor = readWecomKfCursor(openKfid)
  for (let page = 0; page < 10; page += 1) {
    const payload = { open_kfid: openKfid, limit: 100 }
    if (cursor) payload.cursor = cursor
    if (eventToken) payload.token = eventToken
    const data = await wecomApiPost('kf/sync_msg', payload)
    if (data.errcode) {
      console.error(`[wecom] sync_msg 失败 ${data.errcode} ${data.errmsg}`)
      break
    }
    cursor = data.next_cursor || cursor
    saveWecomKfCursor(openKfid, cursor)
    for (const msg of data.msg_list || []) {
      // origin: 3=顾客发来 · 4=系统推送 · 5=接待人员(员工在企微客服工具里手动回的)
      // 员工在企微里直接回的话也要落进同一份会话记录,否则小程序工作台看到的对话是残缺的。
      if (msg.origin === 5) {
        const staffText = msg.msgtype === 'text' ? (msg.text?.content || '') : `[员工发送了${msg.msgtype || '一条消息'}]`
        if (!staffText || !msg.external_userid) continue
        try {
          const cid = wecomConversationId(msg.external_userid)
          const existed = db.prepare('SELECT id FROM wechat_conversations WHERE id = ?').get(cid)
          if (!existed) continue // 没有上下文的孤儿消息不建档
          appendWecomConversationMessage(cid, {
            role: 'staff',
            content: staffText,
            staffName: msg.servicer_userid || '企微接待',
            intent: 'wecom_staff_reply'
          }, {
            status: 'human_active',
            lastIntent: 'wecom_staff_reply',
            lastMessage: staffText,
            provider: 'wecom_customer_service',
            externalUserId: msg.external_userid,
            openKfid
          })
          results.push({ msgid: msg.msgid, staffRecorded: true })
        } catch (error) {
          console.error(`[wecom] 记录员工回复失败 msgid=${msg.msgid}:`, error?.message || error)
        }
        continue
      }
      if (msg.origin !== 3) continue // 系统消息不处理
      let content = ''
      if (msg.msgtype === 'text') content = msg.text?.content || ''
      else if (msg.msgtype === 'image') content = '[顾客发来一张图片]'
      else if (msg.msgtype === 'voice') content = '[顾客发来一条语音]'
      else continue
      const inbound = {
        provider: 'wecom_customer_service',
        externalUserId: msg.external_userid || '',
        openKfid,
        content,
        lang: 'zh',
        raw: { msgid: msg.msgid, msgtype: msg.msgtype }
      }
      try {
        const result = await handleWecomInbound(inbound, req)
        if (result?.reply?.content) await sendWecomKfText(openKfid, msg.external_userid, result.reply.content)
        results.push({ msgid: msg.msgid, replied: Boolean(result?.reply?.content), status: result?.conversation?.status || null })
      } catch (error) {
        console.error(`[wecom] 处理消息失败 msgid=${msg.msgid}:`, error?.message || error)
      }
    }
    if (!data.has_more) break
  }
  return results
}

// ── 触达规则(企微双通道边界)──
// 设计:真人管家账号只负责"喊话"(提醒/回访/召回),所有对话必须回到客服窗口(可同步进工作台、AI 可接管)。
// 手段:每条主动触达文案末尾自动追加客服入口 CTA。未配置链接时不追加,行为与旧版一致。
const TOUCH_RULES_DEFAULT = { kfLink: '', ctaText: '点这里咨询/预约最快 👉', appendCta: true }

function readTouchRules() {
  const row = db.prepare("SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = 'touch_rules'").get(currentTenantId())
  return { ...TOUCH_RULES_DEFAULT, ...(row ? parseJson(row.value) : {}) }
}

function withTouchCta(message = '') {
  const rules = readTouchRules()
  const text = String(message || '')
  if (!rules.appendCta || !rules.kfLink) return text
  if (text.includes(rules.kfLink)) return text
  return `${text}\n\n${rules.ctaText || TOUCH_RULES_DEFAULT.ctaText} ${rules.kfLink}`
}

function wecomConversationId(externalUserId = '') {
  return `wecom:${externalUserId || 'mock-guest'}`
}

function readWecomTranscript(conversationId) {
  const current = db.prepare('SELECT transcript_json FROM wechat_conversations WHERE id = ?').get(conversationId)
  return parseJson(current?.transcript_json)
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

function appendWecomConversationMessage(conversationId, message, patch = {}) {
  const current = db.prepare('SELECT * FROM wechat_conversations WHERE id = ?').get(conversationId)
  const transcript = parseJson(current?.transcript_json)
  const now = iso(new Date())
  transcript.push({ ...message, at: message.at || now })
  const provider = patch.provider || current?.provider || 'wecom_customer_service'
  const externalUserId = patch.externalUserId || current?.external_user_id || conversationId.replace(/^wecom:/, '')
  const aiReplyJson = patch.aiReply !== undefined ? JSON.stringify(patch.aiReply || {}) : (current?.ai_reply_json || '{}')
  const rawEventJson = patch.raw !== undefined ? JSON.stringify(patch.raw || {}) : (current?.raw_event_json || '{}')
  db.prepare(`
    INSERT INTO wechat_conversations
      (id, tenant_id, provider, external_user_id, open_kfid, source_channel, status, last_intent, last_message, ai_reply_json, transcript_json, raw_event_json, created_at, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      provider = excluded.provider,
      open_kfid = COALESCE(NULLIF(excluded.open_kfid, ''), wechat_conversations.open_kfid),
      source_channel = COALESCE(NULLIF(excluded.source_channel, ''), wechat_conversations.source_channel),
      status = excluded.status,
      last_intent = excluded.last_intent,
      last_message = excluded.last_message,
      ai_reply_json = excluded.ai_reply_json,
      transcript_json = excluded.transcript_json,
      raw_event_json = excluded.raw_event_json,
      updated_at = excluded.updated_at
  `).run(
    conversationId,
    currentTenantId(),
    provider,
    externalUserId,
    patch.openKfid || current?.open_kfid || '',
    patch.sourceChannel || current?.source_channel || '',
    patch.status || current?.status || 'open',
    patch.lastIntent || current?.last_intent || message.intent || message.role || 'unknown',
    patch.lastMessage || message.content || current?.last_message || '',
    aiReplyJson,
    JSON.stringify(transcript),
    rawEventJson,
    current?.created_at || now,
    now
  )
  const saved = getWecomConversation(conversationId)
  // 转人工的唯一收口:状态刚变成 needs_human 时,给店主的企业微信推一条提醒(不重复推)。
  // fire-and-forget:通知失败绝不影响会话主链路。
  if (saved?.status === 'needs_human' && current?.status !== 'needs_human') {
    const who = saved.linkedUser?.name || saved.externalUserId || '顾客'
    const gist = String(patch.lastMessage || message.content || '').slice(0, 60)
    notifyWecomStaff(`【有迹·需要人工】${who} 的咨询 AI 接不住了${gist ? `\n最后一句:${gist}` : ''}\n打开有迹小程序 → 客服工作台 处理`)
      .catch(() => {})
  }
  return saved
}

function getWecomConversation(conversationId) {
  const row = db.prepare('SELECT * FROM wechat_conversations WHERE id = ?').get(conversationId)
  if (!row) return null
  // 会话↔会员互链:该外部账号若已绑定会员,带上会员信息供后台跳转客户档案
  const linkedUser = resolveUserByIdentity(row.provider || 'wecom_customer_service', row.external_user_id)
  return {
    id: row.id,
    provider: row.provider,
    externalUserId: row.external_user_id,
    linkedUserId: linkedUser?.id || null,
    linkedUserName: linkedUser?.display_name || null,
    openKfid: row.open_kfid,
    sourceChannel: row.source_channel,
    status: row.status,
    lastIntent: row.last_intent,
    lastMessage: row.last_message,
    aiReply: parseJson(row.ai_reply_json),
    transcript: parseJson(row.transcript_json),
    conversationState: getConversationState(conversationId),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function serializeConversationState(row) {
  if (!row) return null
  const state = parseJson(row.state_json)
  return {
    conversationId: row.conversation_id,
    tenantId: row.tenant_id,
    sourceChannel: row.source_channel,
    serviceType: row.service_type,
    intent: row.intent,
    customerStage: row.customer_stage,
    quoteStage: row.quote_stage,
    nextAction: row.next_action,
    referenceImages: parseJson(row.reference_images_json),
    summaryText: row.summary_text,
    lastCustomerMessage: row.last_customer_message,
    state,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function getConversationState(conversationId) {
  if (!conversationId) return null
  return serializeConversationState(db.prepare('SELECT * FROM ai_conversation_states WHERE conversation_id = ?').get(conversationId))
}

function strongerQuoteFlag(existing = 'unknown', incoming = 'unknown') {
  const oldValue = normalizeQuoteFlag(existing)
  const newValue = normalizeQuoteFlag(incoming)
  if (newValue !== 'unknown') return newValue
  return oldValue || 'unknown'
}

function conversationStateSummary(state = {}) {
  const memory = state.workingMemory || {}
  const quote = memory.quote || {}
  const data = {
    ...state,
    ...memory,
    ...quote
  }
  const referenceImages = mergeReferenceImages(data.referenceImages || [], memory.referenceImages || [], quote.referenceImages || [])
  const parts = []
  if (data.customerType) parts.push(data.customerType === 'returning' ? '老客' : '新客')
  if (data.memberTier) parts.push(`${String(data.memberTier).toUpperCase()} 会员`)
  if (data.serviceType) parts.push(data.serviceType === 'lash' ? '美睫' : '美甲')
  if (referenceImages.length) parts.push(`${referenceImages.length} 张参考图`)
  if (data.extensionNeeded && data.extensionNeeded !== 'unknown') parts.push(data.extensionNeeded === 'yes' ? '需要延长' : '本甲/不延长')
  if (data.removalNeeded && data.removalNeeded !== 'unknown') parts.push(data.removalNeeded === 'yes' ? '需要卸甲' : '不需要卸甲')
  if (data.repairNeeded && data.repairNeeded !== 'unknown') parts.push(data.repairNeeded === 'yes' ? '有断甲修补' : '无断甲修补')
  if (data.charmsNeeded && data.charmsNeeded !== 'unknown') parts.push(data.charmsNeeded === 'yes' ? '有饰品/贴钻' : '无饰品/贴钻')
  if (data.firstLashVisit && data.firstLashVisit !== 'unknown') parts.push(data.firstLashVisit === 'yes' ? '首次美睫' : '非首次美睫')
  if (data.lowerLashRequested && data.lowerLashRequested !== 'unknown') parts.push(data.lowerLashRequested === 'yes' ? '需要下睫毛' : '不需要下睫毛')
  if (data.bookingDate && data.bookingTime) parts.push(`意向时间 ${data.bookingDate} ${data.bookingTime}`)
  return parts.join('，') || '还未形成明确需求'
}

function deriveNextAction({ quoteStage = 'idle', quoteState = {}, missingQuestions = { zh: [] }, shouldCreateQuote = false } = {}) {
  if (quoteStage === 'waiting_staff_quote' || shouldCreateQuote) return 'waiting_staff_quote'
  if (quoteStage === 'quoted') return 'send_quote_or_create_draft'
  if (quoteStage === 'draft_created') return 'wait_payment_or_remind'
  if (quoteState?.priceIntent && missingQuestions?.zh?.length) return 'collect_quote_requirements'
  if (quoteState?.capabilityIntent || quoteState?.hasReferenceContext) return 'answer_capability_then_collect_requirements'
  return 'continue_ai_chat'
}

function flattenPersistedQuoteState(persistedState = null) {
  const raw = persistedState?.state || persistedState || {}
  const memory = raw.workingMemory || {}
  const quote = memory.quote || {}
  return {
    ...raw,
    ...quote,
    customerType: raw.customerType || memory.customerType || '',
    memberTier: raw.memberTier || memory.memberTier || '',
    points: raw.points ?? memory.points ?? 0,
    serviceType: raw.serviceType || quote.serviceType || memory.serviceType || persistedState?.serviceType || '',
    sourceChannel: raw.sourceChannel || memory.sourceChannel || persistedState?.sourceChannel || '',
    referenceImages: mergeReferenceImages(raw.referenceImages || [], memory.referenceImages || [], quote.referenceImages || [], persistedState?.referenceImages || []),
    bookingDate: raw.bookingDate || quote.bookingDate || '',
    bookingTime: raw.bookingTime || quote.bookingTime || '',
    bookingTimeRaw: raw.bookingTimeRaw || quote.bookingTimeRaw || '',
    suggestedBookingDate: raw.suggestedBookingDate || quote.suggestedBookingDate || '',
    suggestedBookingTime: raw.suggestedBookingTime || quote.suggestedBookingTime || '',
    lastUnavailableBookingDate: raw.lastUnavailableBookingDate || quote.lastUnavailableBookingDate || '',
    lastUnavailableBookingTime: raw.lastUnavailableBookingTime || quote.lastUnavailableBookingTime || '',
    staffPriceCents: raw.staffPriceCents ?? quote.staffPriceCents ?? null,
    staffDurationMin: raw.staffDurationMin ?? quote.staffDurationMin ?? null,
    extractedPriceCad: raw.extractedPriceCad || quote.extractedPriceCad || '',
    extractedDurationMin: raw.extractedDurationMin || quote.extractedDurationMin || '',
    pendingPriceIntent: Boolean(raw.pendingPriceIntent || raw.priceIntent || quote.pendingPriceIntent || quote.priceIntent),
    pendingCapabilityIntent: Boolean(raw.pendingCapabilityIntent || raw.capabilityIntent || quote.pendingCapabilityIntent || quote.capabilityIntent),
    extensionNeeded: raw.extensionNeeded || quote.extensionNeeded || 'unknown',
    removalNeeded: raw.removalNeeded || quote.removalNeeded || 'unknown',
    repairNeeded: raw.repairNeeded || quote.repairNeeded || 'unknown',
    charmsNeeded: raw.charmsNeeded || quote.charmsNeeded || 'unknown',
    firstLashVisit: raw.firstLashVisit || quote.firstLashVisit || 'unknown',
    lowerLashRequested: raw.lowerLashRequested || quote.lowerLashRequested || 'unknown',
    healthCheckClear: raw.healthCheckClear || quote.healthCheckClear || 'unknown',
    lashRemovalNeeded: raw.lashRemovalNeeded || quote.lashRemovalNeeded || 'unknown'
  }
}

function buildWorkingMemorySnapshot({ oldState = {}, mergedState = {}, patch = {}, conversationId = '', quoteStage = 'idle', nextAction = '', referenceImages = [] } = {}) {
  const oldMemory = oldState.workingMemory || {}
  const oldQuote = oldMemory.quote || {}
  const now = iso(new Date())
  const serviceType = mergedState.serviceType || oldQuote.serviceType || oldMemory.serviceType || ''
  const quoteState = {
    ...oldQuote,
    serviceType,
    referenceImages,
    priceIntent: Boolean(mergedState.priceIntent || oldQuote.priceIntent),
    pendingPriceIntent: Boolean(mergedState.pendingPriceIntent || oldQuote.pendingPriceIntent || mergedState.priceIntent),
    capabilityIntent: Boolean(mergedState.capabilityIntent || oldQuote.capabilityIntent),
    pendingCapabilityIntent: Boolean(mergedState.pendingCapabilityIntent || oldQuote.pendingCapabilityIntent || mergedState.capabilityIntent),
    appointmentIntent: Boolean(mergedState.appointmentIntent || oldQuote.appointmentIntent),
    serviceStartIntent: Boolean(mergedState.serviceStartIntent || oldQuote.serviceStartIntent),
    contextualFollowup: Boolean(mergedState.contextualFollowup || oldQuote.contextualFollowup),
    extensionNeeded: strongerQuoteFlag(oldQuote.extensionNeeded, mergedState.extensionNeeded),
    removalNeeded: strongerQuoteFlag(oldQuote.removalNeeded, mergedState.removalNeeded),
    repairNeeded: strongerQuoteFlag(oldQuote.repairNeeded, mergedState.repairNeeded),
    charmsNeeded: strongerQuoteFlag(oldQuote.charmsNeeded, mergedState.charmsNeeded),
    firstLashVisit: strongerQuoteFlag(oldQuote.firstLashVisit, mergedState.firstLashVisit),
    lowerLashRequested: strongerQuoteFlag(oldQuote.lowerLashRequested, mergedState.lowerLashRequested),
    healthCheckClear: strongerQuoteFlag(oldQuote.healthCheckClear, mergedState.healthCheckClear),
    lashRemovalNeeded: strongerQuoteFlag(oldQuote.lashRemovalNeeded, mergedState.lashRemovalNeeded),
    noReferenceImage: referenceImages.length ? false : Boolean(mergedState.noReferenceImage || oldQuote.noReferenceImage),
    bookingDate: mergedState.bookingDate || oldQuote.bookingDate || '',
    bookingTime: mergedState.bookingTime || oldQuote.bookingTime || '',
    bookingTimeRaw: mergedState.bookingTimeRaw || oldQuote.bookingTimeRaw || '',
    suggestedBookingDate: mergedState.suggestedBookingDate || oldQuote.suggestedBookingDate || '',
    suggestedBookingTime: mergedState.suggestedBookingTime || oldQuote.suggestedBookingTime || '',
    lastUnavailableBookingDate: mergedState.lastUnavailableBookingDate || oldQuote.lastUnavailableBookingDate || '',
    lastUnavailableBookingTime: mergedState.lastUnavailableBookingTime || oldQuote.lastUnavailableBookingTime || '',
    staffPriceCents: mergedState.staffPriceCents ?? oldQuote.staffPriceCents ?? null,
    staffDurationMin: mergedState.staffDurationMin ?? oldQuote.staffDurationMin ?? null,
    extractedPriceCad: mergedState.extractedPriceCad || oldQuote.extractedPriceCad || '',
    extractedDurationMin: mergedState.extractedDurationMin || oldQuote.extractedDurationMin || '',
    quoteRequestId: mergedState.quoteRequestId || oldQuote.quoteRequestId || '',
    updatedAt: now
  }
  const recentMessages = [...(oldMemory.recentMessages || [])]
  if (patch.lastCustomerMessage) {
    recentMessages.push({ role: 'customer', content: patch.lastCustomerMessage, at: now })
  }
  if (patch.lastAssistantMessage) {
    recentMessages.push({ role: 'assistant', content: patch.lastAssistantMessage, at: now })
  }
  if (patch.lastStaffMessage || mergedState.lastStaffReply) {
    recentMessages.push({ role: 'staff', content: patch.lastStaffMessage || mergedState.lastStaffReply, at: now })
  }
  const completion = typeof intakeCompletion === 'function' ? intakeCompletion({ ...mergedState, ...quoteState }) : { filled: 0, total: 0 }
  const missingQuestions = typeof quoteMissingQuestions === 'function' ? quoteMissingQuestions({ ...mergedState, ...quoteState }) : { zh: [], en: [] }
  const workflow = {
    ...(oldMemory.workflow || {}),
    quoteStage,
    nextAction,
    handoffOwner: mergedState.handoffOwner || oldMemory.workflow?.handoffOwner || (quoteStage === 'waiting_staff_quote' ? 'staff' : 'ai'),
    humanCooldownMinutes: mergedState.humanCooldownMinutes || oldMemory.workflow?.humanCooldownMinutes || HUMAN_REPLY_COOLDOWN_MINUTES,
    updatedAt: now
  }
  const oldPromptCount = Number(oldMemory.workflow?.intakePromptCount || oldState.intakePromptCount || 0) || 0
  const isIntakePrompt = nextAction === 'collect_quote_requirements'
    || /intake_template|collect_quote_requirements/.test(String(patch.intent || mergedState.intent || ''))
  workflow.intakePromptCount = isIntakePrompt ? oldPromptCount + 1 : Number(mergedState.intakePromptCount ?? oldPromptCount) || 0
  return {
    version: 2,
    conversationId,
    sourceChannel: mergedState.sourceChannel || oldMemory.sourceChannel || '',
    customerType: mergedState.customerType || oldMemory.customerType || '',
    memberTier: mergedState.memberTier || oldMemory.memberTier || '',
    points: Number(mergedState.points ?? oldMemory.points ?? 0) || 0,
    serviceType,
    referenceImages,
    quote: {
      ...quoteState,
      completion,
      missingQuestions
    },
    workflow,
    lastCustomerMessage: patch.lastCustomerMessage || oldMemory.lastCustomerMessage || '',
    lastAssistantMessage: patch.lastAssistantMessage || oldMemory.lastAssistantMessage || '',
    lastStaffMessage: patch.lastStaffMessage || mergedState.lastStaffReply || oldMemory.lastStaffMessage || '',
    recentMessages: recentMessages.slice(-12),
    updatedAt: now
  }
}

function workingMemoryPromptText(conversationState = null) {
  const state = conversationState?.state || {}
  const memory = state.workingMemory || {}
  const quote = memory.quote || {}
  if (!memory.version && !conversationState?.summaryText) return ''
  const recentMessages = Array.isArray(memory.recentMessages)
    ? memory.recentMessages.slice(-8).map((item) => `  ${item.role}: ${String(item.content || '').slice(0, 220)}`).join('\n')
    : ''
  const lines = [
    'Working memory for this exact conversation:',
    conversationState?.summaryText ? `- Summary: ${conversationState.summaryText}` : '',
    memory.customerType ? `- Customer type: ${memory.customerType}` : '',
    memory.memberTier ? `- Member tier: ${memory.memberTier}` : '',
    quote.serviceType ? `- Service type: ${quote.serviceType}` : '',
    quote.referenceImages?.length ? `- Reference images already received: ${quote.referenceImages.length}` : '',
    quote.extensionNeeded && quote.extensionNeeded !== 'unknown' ? `- Extension needed: ${quote.extensionNeeded}` : '',
    quote.removalNeeded && quote.removalNeeded !== 'unknown' ? `- Removal needed: ${quote.removalNeeded}` : '',
    quote.repairNeeded && quote.repairNeeded !== 'unknown' ? `- Repair needed: ${quote.repairNeeded}` : '',
    quote.firstLashVisit && quote.firstLashVisit !== 'unknown' ? `- First lash visit: ${quote.firstLashVisit}` : '',
    quote.lowerLashRequested && quote.lowerLashRequested !== 'unknown' ? `- Lower lash: ${quote.lowerLashRequested}` : '',
    quote.lashRemovalNeeded && quote.lashRemovalNeeded !== 'unknown' ? `- Lash removal: ${quote.lashRemovalNeeded}` : '',
    quote.healthCheckClear && quote.healthCheckClear !== 'unknown' ? `- Lash health check clear: ${quote.healthCheckClear}` : '',
    quote.bookingDate || quote.bookingTime ? `- Requested booking time: ${quote.bookingDate || '-'} ${quote.bookingTime || '-'} ${quote.bookingTimeRaw || ''}` : '',
    quote.staffPriceCents ? `- Technician quoted price: ${formatCadFromCents(quote.staffPriceCents)}` : '',
    quote.staffDurationMin ? `- Technician quoted duration: ${quote.staffDurationMin} minutes` : '',
    conversationState?.quoteStage ? `- Quote stage: ${conversationState.quoteStage}; next action: ${conversationState.nextAction || '-'}` : '',
    quote.completion ? `- Intake completion: ${quote.completion.filled || 0}/${quote.completion.total || 0}` : '',
    quote.missingQuestions?.zh?.length ? `- Still missing: ${quote.missingQuestions.zh.join('；')}` : '',
    memory.lastStaffMessage ? `- Last human/staff message to customer: ${memory.lastStaffMessage}` : '',
    recentMessages ? `- Recent conversation messages:\n${recentMessages}` : '',
    'Memory rule: Treat this working memory as confirmed state for this exact conversation. Do not ask again for fields already marked yes/no/partial. If the customer sends a vague follow-up, resolve it from recent customer, assistant, and staff messages plus quote stage.',
    'Do not infer facts from blank intake-form labels. A label such as "是否有断甲需要修补：" with no answer means unknown, not yes. If reference images are already received, never say the customer has no reference image.'
  ].filter(Boolean)
  return lines.join('\n')
}

function upsertConversationState(conversationId, patch = {}) {
  if (!conversationId) return null
  const current = getConversationState(conversationId)
  const oldState = current?.state || {}
  const incomingState = patch.state || {}
  const referenceImages = mergeReferenceImages(current?.referenceImages || [], incomingState.referenceImages || [], patch.referenceImages || [])
  const mergedState = {
    ...oldState,
    ...incomingState,
    referenceImages,
    pendingPriceIntent: Boolean(oldState.pendingPriceIntent || oldState.priceIntent || incomingState.pendingPriceIntent || incomingState.priceIntent),
    pendingCapabilityIntent: Boolean(oldState.pendingCapabilityIntent || oldState.capabilityIntent || incomingState.pendingCapabilityIntent || incomingState.capabilityIntent),
    extensionNeeded: strongerQuoteFlag(oldState.extensionNeeded, incomingState.extensionNeeded),
    removalNeeded: strongerQuoteFlag(oldState.removalNeeded, incomingState.removalNeeded),
    repairNeeded: strongerQuoteFlag(oldState.repairNeeded, incomingState.repairNeeded),
    charmsNeeded: strongerQuoteFlag(oldState.charmsNeeded, incomingState.charmsNeeded),
    firstLashVisit: strongerQuoteFlag(oldState.firstLashVisit, incomingState.firstLashVisit),
    lowerLashRequested: strongerQuoteFlag(oldState.lowerLashRequested, incomingState.lowerLashRequested),
    healthCheckClear: strongerQuoteFlag(oldState.healthCheckClear, incomingState.healthCheckClear),
    lashRemovalNeeded: strongerQuoteFlag(oldState.lashRemovalNeeded, incomingState.lashRemovalNeeded)
  }
  const sourceChannel = patch.sourceChannel || current?.sourceChannel || mergedState.sourceChannel || ''
  const serviceType = patch.serviceType || mergedState.serviceType || current?.serviceType || ''
  const quoteStage = patch.quoteStage || current?.quoteStage || 'idle'
  const nextAction = patch.nextAction || deriveNextAction({ quoteStage, quoteState: mergedState, missingQuestions: patch.missingQuestions })
  mergedState.serviceType = serviceType
  mergedState.sourceChannel = sourceChannel
  mergedState.workingMemory = buildWorkingMemorySnapshot({ oldState, mergedState, patch, conversationId, quoteStage, nextAction, referenceImages })
  const summaryText = patch.summaryText || conversationStateSummary({ ...mergedState, serviceType, referenceImages })
  const now = iso(new Date())
  db.prepare(`
    INSERT INTO ai_conversation_states
      (conversation_id, tenant_id, source_channel, service_type, intent, customer_stage, quote_stage, next_action,
       reference_images_json, state_json, summary_text, last_customer_message, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(conversation_id) DO UPDATE SET
      source_channel = COALESCE(NULLIF(excluded.source_channel, ''), ai_conversation_states.source_channel),
      service_type = COALESCE(NULLIF(excluded.service_type, ''), ai_conversation_states.service_type),
      intent = COALESCE(NULLIF(excluded.intent, ''), ai_conversation_states.intent),
      customer_stage = COALESCE(NULLIF(excluded.customer_stage, ''), ai_conversation_states.customer_stage),
      quote_stage = excluded.quote_stage,
      next_action = excluded.next_action,
      reference_images_json = excluded.reference_images_json,
      state_json = excluded.state_json,
      summary_text = excluded.summary_text,
      last_customer_message = COALESCE(NULLIF(excluded.last_customer_message, ''), ai_conversation_states.last_customer_message),
      updated_at = excluded.updated_at
  `).run(
    conversationId,
    currentTenantId(),
    sourceChannel,
    serviceType,
    patch.intent || current?.intent || incomingState.intent || '',
    patch.customerStage || current?.customerStage || incomingState.customerStage || '',
    quoteStage,
    nextAction,
    JSON.stringify(referenceImages),
    JSON.stringify(mergedState),
    summaryText,
    patch.lastCustomerMessage || current?.lastCustomerMessage || '',
    current?.createdAt || now,
    now
  )
  return getConversationState(conversationId)
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
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function getAiResponseFeedback({ limit = 40, status = 'approved', tenantId = currentTenantId() } = {}) {
  // 2026-08-07:必须按租户过滤——这些样本会进 AI 提示词,跨店混用等于把 A 店的话术和价格教给 B 店的顾客
  return db.prepare(`
    SELECT * FROM ai_response_feedback
    WHERE tenant_id = ? AND (? = '' OR status = ?)
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(tenantId, status || '', status || '', Number(limit) || 40).map(serializeAiResponseFeedback)
}

function ownerApprovedReplyPrompt(lang = 'zh', samples = getAiResponseFeedback({ limit: 10, status: 'approved' })) {
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

function attachOwnerApprovedSamples(knowledgeContext, lang = 'zh') {
  const samples = getAiResponseFeedback({ limit: 10, status: 'approved' })
  const prompt = ownerApprovedReplyPrompt(lang, samples)
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

function saveAiResponseFeedback(body = {}, adminSession = {}) {
  const conversationId = String(body.conversationId || body.conversation_id || '').trim()
  const messageIndex = Number(body.messageIndex ?? body.message_index)
  const correctedReply = String(body.correctedReply || body.corrected_reply || '').trim()
  if (!conversationId) throw apiError(400, 'CONVERSATION_REQUIRED', 'Conversation is required.')
  if (!Number.isInteger(messageIndex) || messageIndex < 0) throw apiError(400, 'MESSAGE_INDEX_REQUIRED', 'A valid message index is required.')
  if (!correctedReply) throw apiError(400, 'CORRECTED_REPLY_REQUIRED', 'Corrected reply is required.')
  const row = db.prepare('SELECT * FROM wechat_conversations WHERE id = ?').get(conversationId)
  if (!row) throw apiError(404, 'NOT_FOUND', 'Conversation not found.')
  const transcript = parseJson(row.transcript_json)
  const target = transcript[messageIndex]
  if (!target || target.role !== 'assistant') throw apiError(400, 'ASSISTANT_MESSAGE_REQUIRED', 'Selected message must be an AI assistant reply.')
  const customerMessage = String(body.customerMessage || body.customer_message || previousCustomerMessage(transcript, messageIndex) || row.last_message || '').trim()
  const originalReply = String(body.originalReply || body.original_reply || target.originalContent || target.content || '').trim()
  const now = iso(new Date())
  const id = randomId('feedback')
  transcript[messageIndex] = {
    ...target,
    originalContent: originalReply,
    content: correctedReply,
    correctedByOwner: true,
    feedbackId: id,
    correctedAt: now
  }
  db.prepare(`
    INSERT INTO ai_response_feedback
      (id, tenant_id, conversation_id, message_index, customer_message, original_reply, corrected_reply, notes, lang, source_channel, intent, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    currentTenantId(),
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
    adminSession?.email || '',
    now,
    now
  )
  const learningId = randomId('learn')
  db.prepare(`
    INSERT INTO ai_learning_examples
      (id, tenant_id, conversation_id, feedback_id, source, customer_message, original_reply, corrected_reply, context_json, tags_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'owner_feedback', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    learningId,
    currentTenantId(),
    conversationId,
    id,
    customerMessage,
    originalReply,
    correctedReply,
    JSON.stringify({
      sourceChannel: row.source_channel || '',
      intent: target.intent || row.last_intent || '',
      notes: String(body.notes || '').trim(),
      conversationState: getConversationState(conversationId)
    }),
    JSON.stringify([target.intent || row.last_intent || 'customer_service'].filter(Boolean)),
    String(body.status || 'approved'),
    now,
    now
  )
  db.prepare(`
    UPDATE wechat_conversations
    SET transcript_json = ?,
        ai_reply_json = ?,
        status = 'ai_replied',
        last_intent = 'owner_corrected_ai_reply',
        last_message = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    JSON.stringify(transcript),
    JSON.stringify({ ...(parseJson(row.ai_reply_json) || {}), ownerCorrectedReply: correctedReply, feedbackId: id }),
    correctedReply,
    now,
    conversationId
  )
  return {
    feedback: serializeAiResponseFeedback(db.prepare('SELECT * FROM ai_response_feedback WHERE id = ?').get(id)),
    conversation: getWecomConversation(conversationId)
  }
}

function saveAiLogicNote(body = {}, adminSession = {}) {
  const conversationId = String(body.conversationId || body.conversation_id || '').trim()
  const note = String(body.note || body.requirement || body.content || '').trim()
  if (!note) throw apiError(400, 'NOTE_REQUIRED', 'Logic note is required.')
  const conversation = conversationId ? getWecomConversation(conversationId) : null
  const now = iso(new Date())
  const id = randomId('learn')
  db.prepare(`
    INSERT INTO ai_learning_examples
      (id, tenant_id, conversation_id, feedback_id, source, customer_message, original_reply, corrected_reply, context_json, tags_json, status, created_at, updated_at)
    VALUES (?, ?, ?, NULL, 'workflow_logic_gap', ?, '', ?, ?, ?, 'approved', ?, ?)
  `).run(
    id,
    currentTenantId(),
    conversationId || null,
    String(body.customerMessage || conversation?.lastMessage || '').trim(),
    note,
    JSON.stringify({
      conversationId,
      currentState: conversation?.conversationState || null,
      sourceChannel: conversation?.sourceChannel || body.sourceChannel || '',
      createdBy: adminSession?.email || 'simulator',
      noteType: 'workflow_logic_gap'
    }),
    JSON.stringify(['workflow_logic_gap', 'owner_requirement', body.category || 'customer_service'].filter(Boolean)),
    now,
    now
  )
  return { logicNote: { id, conversationId, note, createdAt: now } }
}

function recordWecomConversation(inbound, reply, status = 'ai_replied') {
  const conversationId = wecomConversationId(inbound.externalUserId)
  const current = db.prepare('SELECT transcript_json FROM wechat_conversations WHERE id = ?').get(conversationId)
  const transcript = parseJson(current?.transcript_json)
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
    if (shouldSendReturningCustomerWelcome(inbound, transcript)) {
      transcript.push({
        role: 'assistant',
        content: returningCustomerWelcome(inbound.lang || 'zh'),
        intent: 'returning_customer_welcome',
        handoffRequired: false,
        at: iso(new Date())
      })
    } else if (shouldSendNewCustomerWelcome(inbound, transcript)) {
      transcript.push({
        role: 'assistant',
        content: newCustomerWelcome(inbound.lang || 'zh'),
        intent: 'new_customer_welcome',
        handoffRequired: false,
        at: iso(new Date())
      })
    }
    transcript.push({
      role: 'assistant',
      content: replyData.answerZh || replyData.answerEn || '',
      intent: replyData.intent,
      handoffRequired: Boolean(replyData.handoffRequired),
      at: iso(new Date())
    })
  }
  db.prepare(`
    INSERT INTO wechat_conversations
      (id, tenant_id, provider, external_user_id, open_kfid, source_channel, status, last_intent, last_message, ai_reply_json, transcript_json, raw_event_json, created_at, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      open_kfid = excluded.open_kfid,
      source_channel = COALESCE(NULLIF(excluded.source_channel, ''), wechat_conversations.source_channel),
      status = excluded.status,
      last_intent = excluded.last_intent,
      last_message = excluded.last_message,
      ai_reply_json = excluded.ai_reply_json,
      transcript_json = excluded.transcript_json,
      raw_event_json = excluded.raw_event_json,
      updated_at = excluded.updated_at
  `).run(
    conversationId,
    currentTenantId(),
    inbound.provider,
    inbound.externalUserId,
    inbound.openKfid,
    inbound.sourceChannel,
    replyData.handoffRequired ? 'needs_human' : status,
    replyData.intent || 'unknown',
    inbound.content,
    JSON.stringify(reply || {}),
    JSON.stringify(transcript),
    JSON.stringify(inbound.raw || {}),
    iso(new Date()),
    iso(new Date())
  )
  return conversationId
}

function silentHandoffUnknown(inbound, reason = 'unknown_out_of_scope') {
  const conversationId = wecomConversationId(inbound.externalUserId)
  const currentState = getConversationState(conversationId)
  const intakeState = buildQuoteIntakeState(inbound, readWecomTranscript(conversationId), currentState)
  let conversation = appendWecomConversationMessage(conversationId, {
    role: 'customer',
    content: inbound.content,
    messageId: inbound.messageId,
    msgType: inbound.msgType,
    referenceImages: inbound.referenceImages || [],
    intent: 'silent_unknown_handoff'
  }, {
    provider: inbound.provider,
    externalUserId: inbound.externalUserId,
    openKfid: inbound.openKfid,
    sourceChannel: inbound.sourceChannel,
    status: 'needs_human',
    lastIntent: 'silent_unknown_handoff',
    lastMessage: inbound.content,
    raw: inbound.raw || {},
    aiReply: {
      silentHandoff: true,
      reason,
      data: {
        intent: 'silent_unknown_handoff',
        handoffRequired: true,
        answerZh: '',
        answerEn: ''
      }
    }
  })
  const mergedState = {
    ...(currentState?.state || {}),
    ...intakeState,
    handoffOwner: 'human',
    silentHandoffReason: reason,
    silentHandoffAt: iso(new Date()),
    unknownCustomerMessage: inbound.content || ''
  }
  const referenceImages = mergeReferenceImages(currentState?.referenceImages || [], intakeState.referenceImages || [], inbound.referenceImages || [])
  upsertConversationState(conversationId, {
    sourceChannel: inbound.sourceChannel,
    customerStage: inbound.customerStage,
    serviceType: currentState?.serviceType || intakeState.serviceType || '',
    quoteStage: currentState?.quoteStage || 'idle',
    nextAction: 'silent_handoff_unknown',
    intent: 'silent_unknown_handoff',
    state: mergedState,
    referenceImages,
    lastCustomerMessage: inbound.content || '',
    summaryText: currentState?.summaryText || '知识库外或上下文无法判断的顾客消息，静默转人工。'
  })
  conversation = getWecomConversation(conversationId) || conversation
  return { conversationId, inbound, reply: null, waitingForHuman: true, silentHandoff: true, conversation }
}

function isReturningCustomerInbound(inbound = {}) {
  return normalizeCustomerContext(inbound).customerType === 'returning'
}

function returningCustomerWelcome(lang = 'zh') {
  return lang === 'en' ? 'Welcome back, babe. How can I help you today?' : '欢迎回来宝，有什么可以帮到您~'
}

function shouldSendReturningCustomerWelcome(inbound = {}, transcript = []) {
  if (!isReturningCustomerInbound(inbound)) return false
  return !(Array.isArray(transcript) ? transcript : []).some((item) => (
    ['assistant', 'staff'].includes(item?.role)
    && /欢迎回来宝|welcome back/i.test(String(item?.content || ''))
  ))
}

function normalizeMemberTierValue(value = '', fallback = 'silver') {
  const compact = compactIntentText(value)
  if (/diamond|钻石/.test(compact)) return 'diamond'
  if (/platinum|白金/.test(compact)) return 'platinum'
  if (/gold|黄金|金卡/.test(compact)) return 'gold'
  if (/silver|白银|银卡|新客|new|guest|visitor/.test(compact)) return 'silver'
  return fallback
}

function normalizeCustomerContext(inbound = {}, persisted = {}) {
  const rawType = compactIntentText(inbound.customerType || inbound.customer_type || persisted.customerType || persisted.customer_type || '')
  const rawStage = compactIntentText(inbound.customerStage || inbound.stage || persisted.customerStage || persisted.stage || '')
  const points = Number(inbound.points ?? inbound.memberPoints ?? inbound.member_points ?? persisted.points ?? persisted.memberPoints ?? persisted.member_points ?? 0) || 0
  const explicitReturning = ['returning', 'old', '老客', 'member'].includes(rawType)
    || /returning|老客|复购|回访/.test(rawStage)
  const explicitNew = ['new', 'guest', 'visitor', '新客', '游客'].includes(rawType)
  const customerType = explicitReturning || (!explicitNew && points > 0) ? 'returning' : 'new'
  const rawTier = inbound.memberTier || inbound.member_tier || persisted.memberTier || persisted.member_tier || ''
  return {
    customerType,
    // 新客就是 Silver。即使测试器误传 Gold/Platinum，只要积分为 0 且客户类型是新客，就不能解锁高阶权益。
    memberTier: customerType === 'new' || points <= 0 ? 'silver' : normalizeMemberTierValue(rawTier, 'silver'),
    points
  }
}

function isNewCustomerInbound(inbound = {}) {
  return normalizeCustomerContext(inbound).customerType === 'new'
}

function newCustomerWelcome(lang = 'zh') {
  // 2026-08-07:以前写死 Lucky Luxe,别家店的新客一进来就被欢迎到旗舰店去了
  const brand = tenantKbFacts(currentTenantId())?.brandName
    || db.prepare('SELECT name FROM stores WHERE tenant_id = ? AND is_active = 1 ORDER BY rowid ASC LIMIT 1').get(currentTenantId())?.name
    || 'Lucky Luxe'
  return lang === 'en'
    ? `Hello, welcome to ${brand}. I am your booking assistant. You can ask me about nail/lash services, pricing rules, available times, deposits, and aftercare. For complex nail styles, you can also send a reference photo and I will help organize the details first.`
    : `您好欢迎来到 ${brand}，我是您的预约助手。您可以咨询美甲/美睫服务、价格规则、预约时间、定金和护理说明；如果是复杂美甲款式，也可以先发参考图，我会先帮您整理需求。`
}

function shouldSendNewCustomerWelcome(inbound = {}, transcript = []) {
  if (!isNewCustomerInbound(inbound)) return false
  return !(Array.isArray(transcript) ? transcript : []).some((item) => (
    ['assistant', 'staff'].includes(item?.role)
    && /欢迎来到\s*Lucky\s*Luxe|welcome to lucky luxe|预约助手/i.test(String(item?.content || ''))
  ))
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

function hasAppointmentInquiryIntent(text = '') {
  const compact = compactIntentText(text)
  return /预约|想约|要约|可以约吗|能约吗|档期|有空吗|时间|book|appointment|available|availability/.test(compact)
}

function hasSpecialManualHandoffIntent(text = '') {
  const compact = compactIntentText(text)
  return /朋友一起|一起做|两个人|2个人|多人|带朋友|同行|同伴|闺蜜一起|情侣一起|团体|包场|上门|外出|孕妇|儿童|过敏严重|临时加人|特殊安排/.test(compact)
    || /friend|together|group|party|pregnant|kid|child|allergy|special\s*arrangement/i.test(String(text || ''))
}

function isBlankRepairIntakeLabel(text = '') {
  const compact = compactIntentText(text)
  return /是否有断甲需要修补[:：]?$/.test(compact)
    || (/是否有断甲需要修补/.test(compact) && !/(售后|返修|补修|做完|刚做|上次|昨天|前天|今天做|开胶|起翘|翘边|掉|裂|疼|红肿|过敏|不舒服|不满意)/.test(compact))
}

function stripNegatedAfterSalesSignals(text = '') {
  return compactIntentText(text)
    .replace(/(没有|无|不|无需|不需要)(不舒服|红肿|过敏|发炎|刺痛|疼痛|眼睛疼|流泪|扎眼|敏感)/g, '')
    .replace(/(眼睛|眼部)(没有|无|不)(不舒服|红肿|过敏|发炎|刺痛|疼|流泪|扎眼|敏感)/g, '')
    .replace(/(不掉|没有掉|没掉|无掉)(睫|睫毛|甲|钻|饰品)?/g, '')
}

function hasAfterSalesProblemIntent(text = '', stage = '') {
  const compact = compactIntentText(text)
  if (!compact) return false
  if (isBlankRepairIntakeLabel(text)) return false
  const signalText = stripNegatedAfterSalesSignals(compact)
  const stageSignalsAfterSales = /aftercare|after_sales|售后|返修/i.test(String(stage || ''))
  const explicitAfterSales = /售后|返修|补修|开胶|起翘|翘边|甲片掉|掉甲|掉钻|掉饰品|掉色|色差|做坏|不满意|掉睫|睫毛掉|掉了好多|眼睛疼|红肿|过敏|发炎|扎眼|刺痛|不舒服|流泪|after.?sales|repair|complaint|lifting|fallout|irritation|allergy|pain/.test(signalText)
  const contextualRepair = /修补|补甲|断甲/.test(signalText) && /(做完|刚做|上次|昨天|前天|今天做|回来|回去|售后|返修|开胶|掉|裂)/.test(signalText)
  const stageContextFollowup = stageSignalsAfterSales
    && /(怎么处理|怎么办|能补吗|可以补吗|能修吗|可以修吗|处理一下|看一下|这种情况|这个情况|修一下|补一下|掉了|坏了|不舒服|疼|红|肿|刺)/.test(signalText)
  return Boolean(explicitAfterSales || contextualRepair || stageContextFollowup)
}

function detectAfterSalesProblem({ inbound = {}, transcript = [], persistedState = null } = {}) {
  const currentText = String(inbound.content || '')
  const state = flattenPersistedQuoteState(persistedState)
  const stage = inbound.customerStage || persistedState?.customerStage || state.customerStage || ''
  const sanitizedCurrentText = isIntakeFormLikeResponse(currentText)
    ? stripIntakeFormLabelsForInference(currentText)
    : currentText
  if (!hasAfterSalesProblemIntent(sanitizedCurrentText, stage)) return { matched: false }
  const corpus = compactIntentText(`${stripIntakeFormLabelsForInference(quoteTranscriptCorpus(transcript))}\n${sanitizedCurrentText}`)
  const explicitStructuredService = explicitServiceTypeFromStructuredText(currentText)
  const persistedServiceType = normalizeServiceTypeValue(state.serviceType, '')
  const serviceType = explicitStructuredService
    || persistedServiceType
    || (/睫|眼睛|红肿|过敏|发炎|扎眼|刺痛|流泪|lash|eye|allergy|irritation|fallout/.test(corpus)
      ? 'lash'
      : inferServiceTypeFromText(`${sanitizedCurrentText} ${corpus}`, 'nail'))
  const urgentHealth = /红肿|过敏|发炎|扎眼|刺痛|眼睛疼|流泪|不舒服|allergy|irritation|pain/.test(corpus)
  let category = 'after_sales_review'
  if (urgentHealth) category = 'health_or_discomfort'
  else if (/开胶|起翘|翘边|lifting/.test(corpus)) category = 'nail_lifting'
  else if (/掉钻|掉饰品|掉色|色差|不满意|做坏/.test(corpus)) category = 'quality_dispute'
  else if (/掉睫|睫毛掉|掉了好多|fallout/.test(corpus)) category = 'lash_fallout'
  return {
    matched: true,
    serviceType,
    category,
    urgentHealth,
    needsOwner: urgentHealth || /投诉|投诉技师|complaint|严重不满意/.test(corpus)
  }
}

function afterSalesHandoffReply(afterSales = {}, lang = 'zh') {
  const isLash = afterSales.serviceType === 'lash'
  const healthZh = '亲亲我收到啦，这个情况我先帮您转给工作人员确认处理方式。如果目前有明显红肿、刺痛或过敏不适，请先暂停揉眼或自行处理；方便的话请补一张现在状态照片，并告诉我是哪一天做的，我会一起带给店里看。'
  const normalZh = isLash
    ? '亲亲我收到啦，这个属于美睫售后情况，我先帮您转给工作人员核对服务记录和处理方式。方便的话请补一张现在状态照片，并告诉我是哪一天做的，我会一起带给店里看。'
    : '亲亲我收到啦，这个属于美甲售后/返修情况，我先帮您转给工作人员核对服务记录和处理方式。方便的话请补一张现在状态照片，并告诉我是哪一天做的，我会一起带给店里看。'
  const healthEn = 'I understand. I will route this to our staff so they can review it properly. If there is obvious redness, stinging, or allergy-like discomfort, please avoid rubbing or self-treating for now. If convenient, please send a current photo and the service date so I can include them for the team.'
  const normalEn = isLash
    ? 'I understand. This is a lash after-sales case, so I will route it to our staff to review the service record and next steps. If convenient, please send a current photo and the service date so I can include them for the team.'
    : 'I understand. This is a nail after-sales/repair case, so I will route it to our staff to review the service record and next steps. If convenient, please send a current photo and the service date so I can include them for the team.'
  return {
    data: {
      intent: 'after_sales_handoff',
      answerZh: afterSales.urgentHealth ? healthZh : normalZh,
      answerEn: afterSales.urgentHealth ? healthEn : normalEn,
      handoffRequired: true,
      handoffType: afterSales.needsOwner ? 'owner' : 'frontdesk'
    },
    source: 'after_sales_route'
  }
}

function hasServiceStartIntent(text = '') {
  const compact = compactIntentText(text)
  if (!compact) return false
  if (/退款|取消|改期|售后|投诉|退定金|开胶|起翘|翘边|掉甲|掉钻|掉色|色差|掉睫|红肿|过敏|发炎|刺痛|不舒服|refund|cancel|reschedule|complaint/.test(compact)) return false
  return /想做美甲|要做美甲|做美甲|想弄指甲|做指甲|想做指甲|想做美睫|要做美睫|做美睫|想接睫毛|接睫毛|种睫毛|做睫毛|nailappointment|lashappointment/.test(compact)
}

function isVagueContextFollowup(text = '') {
  const compact = compactIntentText(text)
  return /^(可以吗|好了吗|这个呢|这款呢|那这个呢|那价格呢|价格呢|多少钱|ok|好的|可以)$/.test(compact)
}

function isGreetingOnly(text = '') {
  const compact = compactIntentText(text)
  return /^(你好|您好|哈喽|哈咯|嗨|hi|hello|hey|在吗|在不在|想咨询一下|咨询一下|问一下|打扰一下)$/.test(compact)
}

function isExplicitAiResumeIntent(text = '') {
  const compact = compactIntentText(text)
  return /交回ai|转回ai|ai继续|继续ai|请ai继续|让ai继续|机器人继续|恢复ai|ai接待/.test(compact)
}

function hasConversationBusinessContext(transcript = [], persistedState = null) {
  const state = flattenPersistedQuoteState(persistedState)
  if ((persistedState?.quoteStage || '') && persistedState.quoteStage !== 'idle') return true
  if (state.serviceType || state.referenceImages?.length || state.pendingPriceIntent || state.pendingCapabilityIntent) return true
  const recentText = (Array.isArray(transcript) ? transcript : [])
    .slice(-8)
    .map((item) => `${item.role || ''}:${item.content || ''}`)
    .join('\n')
  return /美甲|指甲|本甲|延长|卸甲|断甲|款式|参考图|美睫|睫毛|预约|报价|价格|定金|技师|nail|lash|booking|appointment|quote|price/i.test(recentText)
}

function hasCustomerServiceBusinessSignal(inbound = {}, transcript = [], persistedState = null) {
  const text = String(inbound.content || '')
  const compact = compactIntentText(text)
  if (!compact && !(inbound.referenceImages || []).length) return false
  if ((inbound.referenceImages || []).length) return true
  if (hasAfterSalesProblemIntent(text, inbound.customerStage || persistedState?.customerStage || persistedState?.state?.customerStage || '')) return true
  if (hasSpecialManualHandoffIntent(text) || hasServiceStartIntent(text) || hasExplicitPriceIntent(text) || hasAppointmentInquiryIntent(text)) return true
  if (/美甲|指甲|本甲|延长|卸甲|断甲|修补|甲面|款式|参考图|图片|美睫|睫毛|上睫毛|下睫毛|嫁接|卸睫|门店|地址|营业|电话|客服|订单|支付|定金|退款|取消|改期|会员|优惠券|积分|储值|技师|作品|护理|售后|返修|开胶|起翘|翘边|掉甲|掉钻|掉色|色差|不满意|掉睫|红肿|过敏|nail|lash|booking|appointment|deposit|refund|cancel|reschedule|member|coupon|store|address|hours|technician|artist|aftercare/i.test(compact)) {
    return true
  }
  if (hasCapabilityIntent(text)) {
    return hasConversationBusinessContext(transcript, persistedState) || /这款|这个款|图片|图|参考|款式|style|design/i.test(compact)
  }
  return false
}

function isKnowledgeOnlyDefaultRule(rule = {}) {
  return String(rule.id || '') === 'booking.one_service'
}

function hasConcreteKnowledgeMatch(knowledgeContext = {}) {
  const matchedRules = Array.isArray(knowledgeContext.matchedRules) ? knowledgeContext.matchedRules : []
  const concreteRules = matchedRules.filter((rule) => !isKnowledgeOnlyDefaultRule(rule))
  return concreteRules.length > 0
    || (Array.isArray(knowledgeContext.matchedQa) && knowledgeContext.matchedQa.length > 0)
    || (Array.isArray(knowledgeContext.matchedHandoffRules) && knowledgeContext.matchedHandoffRules.length > 0)
}

function replyLooksUnknown(reply = null) {
  const data = reply?.data || reply || {}
  const intent = compactIntentText(data.intent || '')
  const answer = `${data.answerZh || ''}\n${data.answerEn || ''}`
  return /unknown|unclear|unsupported|outofscope|out_of_scope|other|smalltalk|chitchat|handoff/.test(intent)
    || /不确定|无法判断|不太确定|没太理解|not sure|cannot determine|i'm not sure/i.test(answer)
}

function shouldSilentHandoffBeforeAi({ inbound = {}, transcript = [], persistedState = null } = {}) {
  const text = String(inbound.content || '').trim()
  if (!text && !(inbound.referenceImages || []).length) return false
  if (isGreetingOnly(text)) return false
  if (isReturningCustomerInbound(inbound) && shouldSendReturningCustomerWelcome(inbound, transcript)) return false
  if (hasCustomerServiceBusinessSignal(inbound, transcript, persistedState)) return false
  if (/^(谢谢|感谢|好的|好滴|ok|嗯嗯|哈哈|收到|明白|辛苦了|thank you|thanks)$/i.test(compactIntentText(text))) return true
  if (/[?？吗呢]|为什么|怎么|如何|觉得|意思|what|why|how|where|when|can/i.test(text)) return true
  return text.length >= 4
}

function shouldSilentHandoffAfterAi({ inbound = {}, reply = null, quoteWorkflow = null, knowledgeContext = {}, transcript = [], persistedState = null } = {}) {
  const text = String(inbound.content || '').trim()
  if (!text && !(inbound.referenceImages || []).length) return false
  if (quoteWorkflow?.shouldCreateQuote || quoteWorkflow?.reply?.source) return false
  if (isReturningCustomerInbound(inbound) && shouldSendReturningCustomerWelcome(inbound, transcript)) return false
  if (isGreetingOnly(text) || hasCustomerServiceBusinessSignal(inbound, transcript, persistedState)) return false
  if (hasConcreteKnowledgeMatch(knowledgeContext)) return false
  return replyLooksUnknown(reply) || shouldSilentHandoffBeforeAi({ inbound, transcript, persistedState })
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

function quoteCustomerCorpus(transcript = [], currentText = '') {
  const customerLines = (transcript || [])
    .slice(-12)
    .filter((item) => item?.role === 'customer')
    .map((item) => {
      const imageNote = Array.isArray(item.referenceImages) && item.referenceImages.length ? ` [${item.referenceImages.length}张参考图]` : ''
      return `${item.content || ''}${imageNote}`
    })
  if (currentText) customerLines.push(currentText)
  return customerLines.join('\n')
}

function stripIntakeFormLabelsForInference(text = '') {
  const labelPattern = /项目类型|想做日期和时间|想做款式|是否需要卸甲|需要卸甲|是否需要延长|需要延长|是否有断甲需要修补|断甲需要修补|是否有断甲|是否有参考图|有参考图|其他备注|是否需要下睫毛|需要下睫毛|是否需要卸睫|需要卸睫|是否第一次做美睫|眼睛是否容易敏感|是否指定技师/
  return String(text || '')
    .split(/\n+/)
    .map((line) => {
      const cleaned = line.replace(/^\s*\d+\s*[.、)]\s*/, '').trim()
      const looksLikeFormLine = /^\s*\d+\s*[.、)]/.test(line) || /[：:]/.test(cleaned)
      if (!looksLikeFormLine) return line
      if (!labelPattern.test(cleaned)) return line
      const split = cleaned.split(/[：:]/)
      if (split.length > 1) return split.slice(1).join(':').trim()
      return ''
    })
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .join('\n')
}

function inferQuoteFlagFromText(corpus = '', yesPattern, noPattern) {
  const compact = compactIntentText(corpus)
  if (/不确定|不太确定|不清楚|还没想好|两个都|都想看|都报价|都问|两个价格|分别报价|分别看|本甲.*延长|延长.*本甲|either|both|not sure/i.test(compact)) return 'unknown'
  if (noPattern?.test(compact)) return 'no'
  if (yesPattern?.test(compact)) return 'yes'
  return 'unknown'
}

function intakeFieldAnswer(text = '', labelPatterns = []) {
  const lines = String(text || '').split(/\n+/).map((line) => line.trim()).filter(Boolean)
  for (const line of lines) {
    const cleaned = line.replace(/^\s*\d+\s*[.、)]\s*/, '').trim()
    for (const pattern of labelPatterns) {
      if (!pattern.test(cleaned)) continue
      const split = cleaned.split(/[：:]/)
      if (split.length > 1) return split.slice(1).join(':').trim()
      return cleaned.replace(pattern, '').replace(/^[：:\s]+/, '').trim()
    }
  }
  return ''
}

function inferQuoteFlagFromField(text = '', labelPatterns = [], yesPattern, noPattern) {
  const answer = intakeFieldAnswer(text, labelPatterns)
  if (!answer) return 'unknown'
  return inferQuoteFlagFromText(answer, yesPattern, noPattern)
}

function normalizeServiceTypeValue(value = '', fallback = '') {
  const compact = compactIntentText(value)
  if (!compact) return fallback
  if (/美睫|睫毛|lash|lashes|接睫|种睫/.test(compact)) return 'lash'
  if (/美甲|指甲|nail|nails/.test(compact)) return 'nail'
  return fallback
}

function explicitServiceTypeFromStructuredText(text = '') {
  const lines = String(text || '').split(/\n+/)
  for (const line of lines) {
    const cleaned = line.replace(/^\s*\d+\s*[.、)]\s*/, '').trim()
    const match = cleaned.match(/项目类型\s*[：:]\s*(.+)$/)
    if (!match) continue
    const serviceType = normalizeServiceTypeValue(match[1], '')
    if (serviceType) return serviceType
  }
  const compact = compactIntentText(text)
  if (/(想约|想做|要做|预约|项目类型|做)[\s\S]{0,12}(美甲|指甲|nail)/i.test(compact)) return 'nail'
  if (/(想约|想做|要做|预约|项目类型|做)[\s\S]{0,12}(美睫|睫毛|lash)/i.test(compact)) return 'lash'
  return ''
}

function lastAssistantContent(transcript = []) {
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    if ((transcript[i]?.role || '') === 'assistant') return String(transcript[i]?.content || '')
  }
  return ''
}

function answerPolarityFromText(text = '') {
  const compact = compactIntentText(text)
  if (!compact) return 'unknown'
  if (/不需要|不用|不要|无需|不卸|不延长|没有|没|无|no|not|none/.test(compact)) return 'no'
  if (/需要|要|就是|是|对|可以|嗯|好|有|yes|need|sure/.test(compact)) return 'yes'
  return 'unknown'
}

function contextualQuoteFlags(currentText = '', transcript = []) {
  const currentCompact = compactIntentText(currentText)
  if (/卸甲|卸旧|旧甲|延长|本甲|自然甲|断甲|修补|补甲|饰品|贴钻|珍珠|蝴蝶结|手绘|猫眼|闪粉|亮片/.test(currentCompact)) return {}
  const compactQuestion = compactIntentText(lastAssistantContent(transcript))
  const polarity = answerPolarityFromText(currentText)
  if (polarity === 'unknown') return {}
  const flags = {}
  if (/卸甲|卸旧|旧甲|removal/.test(compactQuestion)) flags.removalNeeded = polarity
  if (/延长|本甲|自然甲|长甲|extension/.test(compactQuestion)) flags.extensionNeeded = polarity
  if (/断甲|修补|补甲|repair/.test(compactQuestion)) flags.repairNeeded = polarity
  if (/饰品|贴钻|珍珠|蝴蝶结|手绘|charm|rhinestone|pearl/.test(compactQuestion)) flags.charmsNeeded = polarity
  return flags
}

function mergeQuoteFlagValues(...values) {
  return values.reduce((current, value) => strongerQuoteFlag(current, value), 'unknown')
}

function isSuggestedBookingSlotAcceptance(text = '', persisted = {}) {
  if (!persisted.suggestedBookingDate || !persisted.suggestedBookingTime) return false
  const compact = compactIntentText(text)
  if (!compact) return false
  return /^(好|好的|可以|行|没问题|ok|okay|yes|那就|就这个|定这个|约这个|确认|可以的)/i.test(compact)
    || /那就|就这个|这个时间|定这个|约这个|确认这个|可以的|没问题/.test(compact)
}

function buildQuoteIntakeState(inbound = {}, transcript = [], persistedState = null) {
  const persisted = flattenPersistedQuoteState(persistedState)
  const currentText = String(inbound.content || '')
  const historyText = quoteTranscriptCorpus(transcript)
  const customerCorpus = quoteCustomerCorpus(transcript, currentText)
  const inferenceCustomerCorpus = stripIntakeFormLabelsForInference(customerCorpus)
  const corpus = `${historyText}\ncustomer: ${currentText}`
  const referenceImages = mergeReferenceImages(persisted.referenceImages || [], transcriptReferenceImages(transcript), inbound.referenceImages || [])
  const structuredServiceType = explicitServiceTypeFromStructuredText(currentText)
  const inboundServiceType = normalizeServiceTypeValue(inbound.serviceType || inbound.service_type, '')
  const explicitServiceType = inferServiceTypeFromText(currentText, '')
  const historicalServiceType = inferServiceTypeFromText(corpus, '')
  const persistedServiceType = normalizeServiceTypeValue(persisted.serviceType, '')
  const serviceType = structuredServiceType || inboundServiceType || explicitServiceType || persistedServiceType || historicalServiceType || 'nail'
  const normalizedCustomer = normalizeCustomerContext(inbound, persisted)
  const inferenceCustomerCompact = compactIntentText(inferenceCustomerCorpus)
  const hasReferenceContext = Boolean(referenceImages.length)
    || /参考图|图片|照片|图|这个款|这一款|这款|款式|法式|贝母|渐变|珍珠|手绘|延长|reference|photo|picture|design/.test(inferenceCustomerCompact)
  const currentPriceIntent = hasExplicitPriceIntent(currentText)
  const canCarryPriceIntent = !persistedState?.quoteStage || ['idle', 'collecting_requirements'].includes(persistedState.quoteStage)
  const priceIntent = currentPriceIntent || (canCarryPriceIntent && Boolean(persisted.priceIntent || persisted.pendingPriceIntent))
  const currentCapabilityIntent = hasCapabilityIntent(currentText)
  const capabilityIntent = currentCapabilityIntent || (canCarryPriceIntent && Boolean(persisted.capabilityIntent || persisted.pendingCapabilityIntent))
  const currentAppointmentIntent = hasAppointmentInquiryIntent(currentText)
  const appointmentIntent = currentAppointmentIntent || Boolean(persisted.appointmentIntent)
  const serviceStartIntent = hasServiceStartIntent(currentText)
  const contextualFollowup = isVagueContextFollowup(currentText) && (hasReferenceContext || /报价|价格|技师|延长|卸甲|本甲/.test(compactIntentText(historyText)))
  const contextualFlags = contextualQuoteFlags(currentText, transcript)
  const fieldExtension = inferQuoteFlagFromField(
    currentText,
    [/是否需要延长|需要延长|延长/],
    /需要|要|做|加长|长甲|延长|yes|need|extension/,
    /本甲|自然甲|原甲|短甲|不|不用|不要|无需|没有|没|无|no|natural/
  )
  const directExtension = inferQuoteFlagFromText(inferenceCustomerCorpus, /需要延长|要延长|做延长|加长|长甲|延长款|延长|tips|extension/, /本甲|自然甲|原甲|短甲|不延长|不用延长|不要延长|不做延长|naturalnail/)
  const fieldRemoval = inferQuoteFlagFromField(
    currentText,
    [/是否需要卸甲|需要卸甲|卸甲/],
    /需要|要|卸|有旧甲|yes|need|removal/,
    /不|不用|不要|无需|没有|没|无|裸甲|no/
  )
  const directRemoval = inferQuoteFlagFromText(
    inferenceCustomerCorpus,
    /需要卸|要卸|卸甲|卸旧|卸掉|要卸掉|需要卸掉|旧甲要卸|旧甲需要卸|有旧甲|有甲油胶|removal/,
    /不卸|不用卸|不要卸|不需要卸|无需卸|没有旧甲|没旧甲|无旧甲|裸甲/
  )
  const fieldRepair = inferQuoteFlagFromField(
    currentText,
    [/是否有断甲需要修补|断甲需要修补|是否有断甲|断甲|修补/],
    /需要|要|有|断|补|修|yes|need|repair/,
    /不|不用|不要|无需|没有|没|无|no/
  )
  const directRepair = inferQuoteFlagFromText(inferenceCustomerCorpus, /断甲|需要修补|要修补|补甲|repair/, /无断甲|没有断甲|没断甲|不修|不用修|不需要修补|无需修补|不修补/)
  const directCharms = inferQuoteFlagFromText(inferenceCustomerCorpus, /需要饰品|要饰品|加饰品|贴钻|珍珠|蝴蝶结|手绘|猫眼|闪粉|亮片|水彩|钻|charm|rhinestone|pearl/, /不要饰品|无饰品|不贴钻|不加饰品|不需要饰品|不需要珍珠|无需饰品|不要贴钻|不要手绘/)
  const fieldLowerLash = serviceType === 'lash'
    ? inferQuoteFlagFromField(currentText, [/是否需要下睫毛|需要下睫毛|下睫毛|下睫/], /需要|要|做|有|yes|need/, /不|不用|不要|无需|没有|没|无|只做上睫|no/)
    : 'unknown'
  const fieldFirstLashVisit = serviceType === 'lash'
    ? inferQuoteFlagFromField(
      currentText,
      [/是否第一次做美睫|第一次做美睫|首次美睫|第一次|首次/],
      /第一次|首次|没做过|没有做过|从来没做|新手|first/i,
      /不是第一次|非首次|做过|以前做过|之前做过|经常做|老客|not\s*first/i
    )
    : 'unknown'
  const fieldHealthClear = serviceType === 'lash'
    ? inferQuoteFlagFromField(currentText, [/眼睛是否容易敏感|眼睛|眼部|敏感/], /没有|无|不敏感|正常|健康|no/, /手术|结膜炎|红肿|发炎|过敏|敏感|不舒服|yes/)
    : 'unknown'
  const fieldLashRemoval = serviceType === 'lash'
    ? inferQuoteFlagFromField(currentText, [/是否需要卸睫|需要卸睫|卸睫|卸睫毛/], /需要|要|卸|有旧睫|yes|need/, /不|不用|不要|无需|没有|没|无|no/)
    : 'unknown'
  const directLowerLash = serviceType === 'lash'
    ? inferQuoteFlagFromText(inferenceCustomerCorpus, /下睫毛|下睫|lowerlash|lowerlashes/, /不做下睫|不要下睫|不用下睫|不需要下睫|只做上睫/)
    : 'unknown'
  const directFirstLashVisit = serviceType === 'lash'
    ? inferQuoteFlagFromText(
      inferenceCustomerCorpus,
      /第一次做美睫|第一次接睫毛|首次美睫|首次接睫|没做过美睫|没有做过美睫|从来没做过美睫|第一次|首次|firsttime|firstlash/i,
      /不是第一次|非首次|做过美睫|之前做过|以前做过|经常做|老客|notfirst/i
    )
    : 'unknown'
  const directHealthClear = serviceType === 'lash'
    ? inferQuoteFlagFromText(inferenceCustomerCorpus, /没有眼部|无眼部|不敏感|没有红肿|没有结膜炎|没有手术|健康|正常/, /眼部手术|结膜炎|红肿|发炎|过敏|敏感|不舒服/)
    : 'unknown'
  const directLashRemoval = serviceType === 'lash'
    ? inferQuoteFlagFromText(inferenceCustomerCorpus, /卸睫|卸睫毛|有旧睫毛|removelash|lashremoval/, /不卸睫|不用卸睫|不要卸睫|不需要卸睫|没有旧睫毛/)
    : 'unknown'
  const noReferenceImage = !referenceImages.length && /无图|没图|没有图|没有参考图|不发图|暂无图|noreference|nophoto|nopicture/.test(compactIntentText(inferenceCustomerCorpus))
  const currentParsedBookingTime = extractBookingDateTime(currentText)
  const historicalParsedBookingTime = extractBookingDateTime(customerCorpus)
  const acceptsSuggestedSlot = isSuggestedBookingSlotAcceptance(currentText, persisted)
  const bookingDate = currentParsedBookingTime.date
    || (currentParsedBookingTime.time ? (persisted.suggestedBookingDate || persisted.bookingDate || persisted.requestedDate || '') : '')
    || (acceptsSuggestedSlot ? persisted.suggestedBookingDate : '')
    || historicalParsedBookingTime.date
    || persisted.bookingDate
    || persisted.requestedDate
    || persisted.suggestedBookingDate
    || ''
  const bookingTime = currentParsedBookingTime.time
    || (acceptsSuggestedSlot ? persisted.suggestedBookingTime : '')
    || historicalParsedBookingTime.time
    || persisted.bookingTime
    || persisted.requestedTime
    || persisted.suggestedBookingTime
    || ''
  const bookingTimeRaw = currentParsedBookingTime.raw || historicalParsedBookingTime.raw || persisted.bookingTimeRaw || ''
  const hasDateMention = Boolean(bookingDate)
    || /(\d{1,2}[\/月.-]\d{1,2})|周[一二三四五六日天]|星期[一二三四五六日天]|今天|明天|后天/.test(customerCorpus)
  const hasTimeMention = Boolean(bookingTime)
    || /\d{1,2}[:：]\d{2}|[一二两三四五六七八九十\d]{1,3}点|am|pm/.test(customerCorpus)
  const hasDateTime = Boolean(bookingDate && bookingTime)
  const hasOtherNotes = /备注|其他|注意|要求|想要|偏好|喜欢|不要|希望/.test(compactIntentText(customerCorpus))
  const serviceTypeConfirmed = Boolean(inbound.serviceType || inbound.service_type || explicitServiceType || /美甲|指甲|甲|美睫|睫毛|nail|lash/.test(compactIntentText(customerCorpus)))
  const lashStyleKnown = /自然款|浓密款|中式|单根|仙子|漫画|太阳花|泰式|欧美|设计款|裸感|网红款|natural|volume|wetlook|anime|manga/.test(compactIntentText(customerCorpus))
  return {
    serviceType,
    currentText,
    corpus,
    referenceImages,
    hasReferenceContext,
    priceIntent,
    pendingPriceIntent: priceIntent,
    capabilityIntent,
    pendingCapabilityIntent: capabilityIntent,
    appointmentIntent,
    serviceStartIntent,
    contextualFollowup,
    customerCorpus,
    customerType: normalizedCustomer.customerType,
    memberTier: normalizedCustomer.memberTier,
    points: normalizedCustomer.points,
    serviceTypeConfirmed,
    hasDateMention,
    hasTimeMention,
    hasDateTime,
    hasOtherNotes,
    noReferenceImage,
    bookingDate,
    bookingTime,
    bookingTimeRaw,
    suggestedBookingDate: persisted.suggestedBookingDate || '',
    suggestedBookingTime: persisted.suggestedBookingTime || '',
    lastUnavailableBookingDate: persisted.lastUnavailableBookingDate || '',
    lastUnavailableBookingTime: persisted.lastUnavailableBookingTime || '',
    lashStyleKnown,
    extensionNeeded: mergeQuoteFlagValues(persisted.extensionNeeded, directExtension, fieldExtension, contextualFlags.extensionNeeded),
    removalNeeded: mergeQuoteFlagValues(persisted.removalNeeded, directRemoval, fieldRemoval, contextualFlags.removalNeeded),
    repairNeeded: mergeQuoteFlagValues(persisted.repairNeeded, directRepair, fieldRepair, contextualFlags.repairNeeded),
    charmsNeeded: mergeQuoteFlagValues(persisted.charmsNeeded, directCharms, contextualFlags.charmsNeeded),
    firstLashVisit: mergeQuoteFlagValues(persisted.firstLashVisit, directFirstLashVisit, fieldFirstLashVisit),
    lowerLashRequested: mergeQuoteFlagValues(persisted.lowerLashRequested, directLowerLash, fieldLowerLash),
    healthCheckClear: mergeQuoteFlagValues(persisted.healthCheckClear, directHealthClear, fieldHealthClear),
    lashRemovalNeeded: mergeQuoteFlagValues(persisted.lashRemovalNeeded, directLashRemoval, fieldLashRemoval)
  }
}

function isReturningQuoteCustomer(state = {}) {
  const customerType = String(state.customerType || '').toLowerCase()
  const memberTier = String(state.memberTier || '').toLowerCase()
  if (customerType === 'new' && Number(state.points || 0) <= 0) return false
  return customerType === 'returning'
    || Number(state.points || 0) > 0
    || ['gold', 'platinum', 'diamond'].includes(memberTier)
}

function quoteIntakeSummary(state) {
  const parts = []
  if (state.serviceType === 'lash') parts.push('美睫')
  if (state.serviceType === 'nail') parts.push('美甲')
  if (state.extensionNeeded !== 'unknown') parts.push(state.extensionNeeded === 'yes' ? '需要延长' : '本甲/不延长')
  if (state.removalNeeded !== 'unknown') parts.push(state.removalNeeded === 'yes' ? '需要卸甲' : '不需要卸甲')
  if (state.repairNeeded !== 'unknown') parts.push(state.repairNeeded === 'yes' ? '有断甲修补' : '无断甲修补')
  if (state.firstLashVisit !== 'unknown') parts.push(state.firstLashVisit === 'yes' ? '首次美睫' : '非首次美睫')
  if (state.lowerLashRequested !== 'unknown') parts.push(state.lowerLashRequested === 'yes' ? '需要下睫毛' : '不需要下睫毛')
  if (state.lashRemovalNeeded !== 'unknown') parts.push(state.lashRemovalNeeded === 'yes' ? '需要卸睫' : '不需要卸睫')
  if (state.healthCheckClear !== 'unknown') parts.push(state.healthCheckClear === 'yes' ? '眼部状态正常' : '眼部状态需人工确认')
  if (state.referenceImages.length) parts.push(`${state.referenceImages.length} 张参考图`)
  if (!state.referenceImages.length && state.noReferenceImage) parts.push('无参考图')
  if (state.bookingDate && state.bookingTime) parts.push(`预约意向 ${state.bookingDate} ${state.bookingTime}`)
  else if (state.bookingDate) parts.push(`已提到日期 ${state.bookingDate}，待确认具体时间`)
  else if (state.bookingTime) parts.push(`已提到时间 ${state.bookingTime}，待确认日期`)
  else if (state.hasDateMention && !state.hasTimeMention) parts.push('已提到日期，待确认具体时间')
  else if (state.hasTimeMention && !state.hasDateMention) parts.push('已提到时间，待确认日期')
  return parts.join('，') || '当前信息'
}

function canSpecifyTechnician(state = {}) {
  const tier = String(state.memberTier || '').toLowerCase()
  return ['gold', 'platinum', 'diamond'].includes(tier)
}

function quoteCollectionTemplate(serviceType = 'nail', state = {}) {
  const withTech = canSpecifyTechnician(state)
  if (serviceType === 'lash') {
    const lines = [
      '可以的亲亲，我先帮您把美睫预约/确认需要的信息一次性整理好，这样确认会更快，也避免漏掉细节。',
      '',
      '请您按下面格式回复我（可以直接粘贴本段话到聊天框）：',
      '',
      '1. 项目类型：美睫',
      '2. 想做款式：自然款 / 浓密款 / 中式设计款 / 不确定',
      '3. 是否需要下睫毛：',
      '4. 是否需要卸睫：',
      '5. 想做日期和时间：',
      '6. 是否第一次做美睫 / 眼睛是否容易敏感：',
      '7. 其他备注：'
    ]
    if (withTech) lines.push('8. 是否指定技师：')
    lines.push('', '如果暂时有些信息不确定也没关系，您先填知道的部分，我会帮您整理后确认。')
    return lines.join('\n')
  }
  const lines = [
    '可以的亲亲，我先帮您把预约/报价需要的信息一次性整理好，这样技师确认会更快，也避免漏掉细节。',
    '',
    '请您按下面格式回复我（可以直接粘贴本段话到聊天框）：',
    '',
    '1. 项目类型：美甲',
    '2. 想做日期和时间：',
    '3. 是否需要卸甲：',
    '4. 是否需要延长：',
    '5. 是否有断甲需要修补：',
    '6. 是否有参考图：有的话请直接发图；没有也可以写“无图”',
    '7. 其他备注：'
  ]
  if (withTech) lines.push('8. 是否指定技师：')
  lines.push('', '如果这段信息没有补充完全也没关系，您先填知道的部分，我会帮您整理；大部分信息补充后就可以交给技师/人工判断。')
  return lines.join('\n')
}

function intakeCompletion(state = {}) {
  if (state.serviceType === 'lash') {
    const fields = [
      state.serviceTypeConfirmed,
      state.lashStyleKnown,
      state.lowerLashRequested !== 'unknown',
      state.lashRemovalNeeded !== 'unknown',
      state.hasDateTime,
      state.healthCheckClear !== 'unknown',
      state.hasOtherNotes
    ]
    return { filled: fields.filter(Boolean).length, total: fields.length }
  }
  const fields = [
    state.serviceTypeConfirmed,
    state.hasDateTime,
    state.removalNeeded !== 'unknown',
    state.extensionNeeded !== 'unknown',
    state.repairNeeded !== 'unknown',
    Boolean(state.referenceImages?.length || state.noReferenceImage),
    state.hasOtherNotes
  ]
  return { filled: fields.filter(Boolean).length, total: fields.length }
}

function isIntakeFormLikeResponse(text = '') {
  const compact = compactIntentText(text)
  return /项目类型|想做日期|是否需要卸|是否需要延长|断甲|参考图|其他备注|想做款式|下睫毛|卸睫|眼睛/.test(compact)
}

function addDaysToDateString(date, days) {
  const value = localDateTime(date, '12:00')
  value.setDate(value.getDate() + days)
  return value.toISOString().slice(0, 10)
}

function dateFromMonthDay(month, day) {
  const today = localParts(new Date()).date
  const year = Number(today.slice(0, 4))
  const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return candidate < today ? `${year + 1}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : candidate
}

function formatYmd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function parseChineseNumber(value = '') {
  const text = String(value || '').trim()
  if (!text) return NaN
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text)
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  if (text === '十') return 10
  const tenMatch = text.match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/)
  if (tenMatch) return (tenMatch[1] ? digits[tenMatch[1]] : 1) * 10 + (tenMatch[2] ? digits[tenMatch[2]] : 0)
  if (text.length === 1 && text in digits) return digits[text]
  return NaN
}

function parseDurationMinutesFromText(text = '') {
  const raw = String(text || '')
  const numericMinutes = raw.match(/(\d{2,3})\s*(?:分钟|min|mins|minutes)/i)
  if (numericMinutes) return Number(numericMinutes[1])
  const numericHours = raw.match(/(\d+(?:\.\d+)?)\s*(?:小时|个小时|h|hr|hrs|hour|hours)/i)
  if (numericHours) return Math.round(Number(numericHours[1]) * 60)
  const chineseHour = raw.match(/([一二两三四五六七八九十\d]+)\s*(?:个)?小时(?:半|([一二三四五六七八九十\d]+)\s*(?:分钟|分))?/)
  if (chineseHour) {
    const hours = parseChineseNumber(chineseHour[1])
    const minutePart = chineseHour[2] ? parseChineseNumber(chineseHour[2]) : (/半/.test(chineseHour[0]) ? 30 : 0)
    if (Number.isFinite(hours)) return Math.round(hours * 60 + (Number.isFinite(minutePart) ? minutePart : 0))
  }
  const chineseHalf = raw.match(/([一二两三四五六七八九十\d]+)\s*个?半\s*(?:小时)?/)
  if (chineseHalf) {
    const hours = parseChineseNumber(chineseHalf[1])
    if (Number.isFinite(hours)) return Math.round(hours * 60 + 30)
  }
  return 0
}

function parseCadCentsFromText(text = '') {
  const raw = String(text || '')
  const match = raw.match(/(?:CAD\s*\$?\s*|C\$\s*|\$\s*)(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:cad|加币|加元|刀|块|元|dollars?)/i)
    || raw.match(/(?:报价|价格|价钱|价位|参考价|费用|收费|一共|总共|price|quote|cost)[^\d]{0,12}(\d+(?:\.\d{1,2})?)/i)
  let value = Number(match?.[1] || match?.[2] || 0)
  if (!value) {
    // 兜底：技师只写了一个裸数字（如“可以做 150”）。
    // 排除时间/日期/数量语境（分钟、小时、点、号、月、日、张、个、周）后，取第一个 2-4 位数字作为价格。
    const bare = raw.match(/(?:^|[^\d.:月])(\d{2,4})(?!\s*(?:分钟|分|小时|个?半|点|号|月|日|张|个|周|天|min|hour|h|:|\d))/)
    if (bare) value = Number(bare[1])
  }
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null
}

function formatCadNumber(value) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount) || amount <= 0) return ''
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2)
}

function normalizeStaffQuoteOptionLabel(label = '') {
  const text = String(label || '').trim()
  if (/不延长|本甲|本价|自然甲|原甲|裸甲/.test(text)) return '本甲'
  if (/延长|加长|长甲/.test(text)) return '延长'
  if (/卸睫/.test(text)) return '卸睫'
  if (/卸甲|卸除/.test(text)) return '卸甲'
  if (/下睫毛|下睫/.test(text)) return '下睫毛'
  return text
}

function extractStaffQuoteOptions(text = '') {
  const raw = String(text || '')
  const regex = /(不延长|本甲|本价|自然甲|原甲|裸甲|延长|加长|长甲|卸甲|卸除|卸睫|下睫毛|下睫)[^\d\n]{0,12}(?:CAD\s*\$?\s*|\$)?\s*(\d+(?:\.\d{1,2})?)\s*(?:cad|CAD|加币|加元|刀|块|元)?/gi
  const options = []
  const seen = new Set()
  for (const match of raw.matchAll(regex)) {
    const label = normalizeStaffQuoteOptionLabel(match[1])
    const priceCad = Number(match[2])
    if (!label || !Number.isFinite(priceCad) || priceCad <= 0) continue
    const key = `${label}:${priceCad}`
    if (seen.has(key)) continue
    seen.add(key)
    options.push({ label, priceCad, priceCents: Math.round(priceCad * 100) })
  }
  return options
}

function primaryStaffQuoteOptionCents(text = '') {
  const first = extractStaffQuoteOptions(text)[0]
  return first ? first.priceCents : null
}

function formatStaffQuoteOptions(options = [], lang = 'zh') {
  if (!Array.isArray(options) || !options.length) return ''
  const enLabels = {
    本甲: 'natural nail',
    延长: 'extension',
    卸甲: 'removal',
    卸睫: 'lash removal',
    下睫毛: 'lower lash'
  }
  return options
    .map((item) => {
      const label = lang === 'en' ? (enLabels[item.label] || item.label) : item.label
      const amount = formatCadNumber(item.priceCad)
      return amount ? `${label} ${formatMoneyCents(Math.round(Number(String(amount).replace(/,/g, '')) * 100), currentTenantId(), 'auto')}` : ''
    })
    .filter(Boolean)
    .join(lang === 'en' ? '; ' : '，')
}

function extractDurationDisplayFromText(text = '') {
  const raw = String(text || '')
  const match = raw.match(/(?:大概|预计|约|大约)?\s*((?:\d+(?:\.\d+)?|[一二两三四五六七八九十]+)\s*(?:个)?小时(?:半)?(?:以内|左右)?|[一二两三四五六七八九十\d]+\s*个?半\s*(?:小时)?(?:以内|左右)?|(?:\d{2,3}|[一二两三四五六七八九十]+)\s*(?:分钟|分|min|mins|minutes)(?:以内|左右)?)/i)
  return match?.[1]?.trim() || ''
}

function weekdayDateFromText(raw = '') {
  const compact = compactIntentText(raw)
  const match = compact.match(/(下下周|下周|这周|本周)?(?:星期|周)([一二三四五六日天])/)
  if (!match) return ''
  const targetMap = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 }
  const target = targetMap[match[2]]
  const today = new Date(`${localParts(new Date()).date}T12:00:00`)
  const current = today.getDay()
  let diff = (target - current + 7) % 7
  if (match[1] === '下下周') diff += 14
  else if (match[1] === '下周') diff += 7
  if (match[1] === '这周' || match[1] === '本周') {
    if (diff === 0 && !/今天|现在/.test(compact)) diff = 7
  } else if (diff === 0 && !/今天|现在/.test(compact)) {
    diff = 7
  }
  today.setDate(today.getDate() + diff)
  return formatYmd(today)
}

function normalizeBookingTime(rawHour, rawMinute = '00', marker = '') {
  let hour = parseChineseNumber(rawHour)
  const minute = parseChineseNumber(rawMinute || '0')
  const lowerMarker = String(marker || '').toLowerCase()
  if ((/下午|晚上|pm/.test(lowerMarker)) && hour < 12) hour += 12
  if (/中午/.test(lowerMarker) && hour > 0 && hour < 11) hour += 12
  if ((/凌晨|上午|am/.test(lowerMarker)) && hour === 12) hour = 0
  if (!Number.isFinite(hour) || hour < 0 || hour > 23 || !Number.isFinite(minute) || minute < 0 || minute > 59) return ''
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function extractBookingDateTime(text = '') {
  const raw = String(text || '')
  const today = localParts(new Date()).date
  let date = ''
  const isoMatch = raw.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/)
  if (isoMatch) {
    date = `${isoMatch[1]}-${String(isoMatch[2]).padStart(2, '0')}-${String(isoMatch[3]).padStart(2, '0')}`
  }
  if (!date) {
    const mdMatch = raw.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)?/)
    if (mdMatch) date = dateFromMonthDay(mdMatch[1], mdMatch[2])
  }
  if (!date) {
    const looseMdMatch = raw.match(/(?:^|[^\d])(\d{1,2})\s*[./-]\s*(\d{1,2})(?!\s*[./-]\s*\d)/)
    if (looseMdMatch) date = dateFromMonthDay(looseMdMatch[1], looseMdMatch[2])
  }
  const compact = compactIntentText(raw)
  if (!date && /后天/.test(compact)) date = addDaysToDateString(today, 2)
  if (!date && /明天/.test(compact)) date = addDaysToDateString(today, 1)
  if (!date && /今天/.test(compact)) date = today
  if (!date) date = weekdayDateFromText(raw)

  let time = ''
  const colonMatch = raw.match(/(上午|下午|晚上|凌晨|中午|am|pm)?\s*(\d{1,2})[:：](\d{2})\s*(am|pm)?/i)
  if (colonMatch) time = normalizeBookingTime(colonMatch[2], colonMatch[3], `${colonMatch[1] || ''}${colonMatch[4] || ''}`)
  if (!time) {
    const halfMatch = raw.match(/(上午|下午|晚上|凌晨|中午)?\s*([一二两三四五六七八九十\d]{1,3})\s*点\s*半/)
    if (halfMatch) time = normalizeBookingTime(halfMatch[2], '30', halfMatch[1] || '')
  }
  if (!time) {
    const hourMatch = raw.match(/(上午|下午|晚上|凌晨|中午)?\s*([一二两三四五六七八九十\d]{1,3})\s*点/)
    if (hourMatch) time = normalizeBookingTime(hourMatch[2], '00', hourMatch[1] || '')
  }
  return {
    date,
    time,
    raw: raw.trim()
  }
}

function shouldHandOffForQuote(state = {}) {
  const completion = intakeCompletion(state)
  const overHalf = completion.filled >= Math.ceil(completion.total / 2)
  const hasReferenceAnswer = Boolean(state.referenceImages?.length || state.noReferenceImage)
  if (state.serviceType === 'lash') return overHalf && (state.priceIntent || state.capabilityIntent || isIntakeFormLikeResponse(state.currentText))
  return overHalf && hasReferenceAnswer && (state.priceIntent || state.capabilityIntent || state.contextualFollowup || isIntakeFormLikeResponse(state.currentText))
}

function shouldEscalateUnclearIntake(state = {}, persistedState = null, missingQuestions = { zh: [] }) {
  const memory = persistedState?.state?.workingMemory || {}
  const promptCount = Number(memory.workflow?.intakePromptCount || persistedState?.state?.intakePromptCount || 0) || 0
  const completion = intakeCompletion(state)
  const hasSomeContext = state.hasReferenceContext
    || state.serviceStartIntent
    || state.appointmentIntent
    || state.priceIntent
    || state.capabilityIntent
    || state.contextualFollowup
    || completion.filled >= 2
  const vagueAgain = isVagueContextFollowup(state.currentText)
    || (!isIntakeFormLikeResponse(state.currentText) && !state.referenceImages?.length && missingQuestions.zh?.length)
  return promptCount >= 2 && hasSomeContext && vagueAgain
}

function quotePayloadFromState(state, inbound = {}, knowledgeContext = {}, trigger = 'intake_ready') {
  const customerMessage = String(state.customerCorpus || inbound.content || '').trim()
  const hasReferenceImages = Boolean(state.referenceImages?.length)
  return {
    serviceType: state.serviceType,
    customerMessage,
    referenceImages: state.referenceImages,
    styleElements: {
      customerStage: inbound.customerStage || '',
      sourceChannel: inbound.sourceChannel || '',
      quoteIntake: {
        extensionNeeded: state.extensionNeeded,
        removalNeeded: state.removalNeeded,
        repairNeeded: state.repairNeeded,
        firstLashVisit: state.firstLashVisit,
        lowerLashRequested: state.lowerLashRequested,
        lashRemovalNeeded: state.lashRemovalNeeded,
        healthCheckClear: state.healthCheckClear,
        noReferenceImage: hasReferenceImages ? false : Boolean(state.noReferenceImage),
        bookingDate: state.bookingDate || '',
        bookingTime: state.bookingTime || '',
        bookingTimeRaw: state.bookingTimeRaw || '',
        completion: intakeCompletion(state),
        trigger
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

function quoteIntakeReply(kind, state, missingQuestions) {
  const missing = missingQuestions.zh || []
  if (kind === 'collect_template') {
    return {
      data: {
        intent: `${state.serviceType || 'nail'}_intake_template`,
        answerZh: quoteCollectionTemplate(state.serviceType || 'nail', state),
        answerEn: state.serviceType === 'lash'
          ? 'Sure. Please send your lash style, whether lower lashes/removal are needed, preferred date/time, eye sensitivity, and any notes. If anything is uncertain, send what you know first.'
          : 'Sure. Please send your nail service type, preferred date/time, whether removal/extensions/repairs are needed, reference photo status, and any notes. If anything is uncertain, send what you know first.',
        handoffRequired: false
      },
      source: 'quote_intake_template'
    }
  }
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
  if (kind === 'ready_returning_feasibility') {
    return {
      data: {
        intent: 'returning_feasibility_check',
        answerZh: `好的亲亲，我已经把这款需求整理好啦：${quoteIntakeSummary(state)}。我先转给技师确认这款能不能做、建议预留时长和可预约安排；如果涉及额外价格，技师会一起备注，我收到后再用清楚一点的话术发给您。`,
        answerEn: `Got it. I have organized the request: ${quoteIntakeSummary(state)}. I will send it to the technician to confirm feasibility, suggested duration, and booking arrangement. If any extra pricing applies, I will summarize it clearly after the technician replies.`,
        handoffRequired: true
      },
      source: 'quote_intake_state'
    }
  }
  if (kind === 'manual_intake_review') {
    return {
      data: {
        intent: 'manual_intake_review',
        answerZh: `亲亲，我先不继续反复追问啦。我已经把目前的信息整理好：${quoteIntakeSummary(state)}。接下来我会转给人工/技师帮您判断缺少哪些关键信息，收到回复后我再第一时间发给您。`,
        answerEn: `I will stop asking repeated questions for now. I have organized the current information: ${quoteIntakeSummary(state)}. I will send this to staff/technician to check what key details are still needed and reply once we have an update.`,
        handoffRequired: true
      },
      source: 'quote_intake_manual_review'
    }
  }
  if (kind === 'manual_special_review') {
    return {
      data: {
        intent: 'manual_special_review',
        answerZh: `亲亲，这个属于需要人工确认的特殊安排，我先帮您转给店里确认一下。收到回复后我会第一时间发给您。`,
        answerEn: `This needs a manual check from our team. I will send it to the store first and reply as soon as we have an update.`,
        handoffRequired: true
      },
      source: 'quote_special_manual_review'
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

function isStoreInfoOnlyInquiry(text = '') {
  const compact = compactIntentText(text)
  if (!compact) return false
  const asksStoreInfo = /营业时间|几点开门|几点关门|几点营业|营业到几点|开到几点|哪天营业|周几营业|地址|在哪|怎么走|位置|定位|电话|联系方式|business hours|opening hours|address|location|how to get there/.test(compact)
  if (!asksStoreInfo) return false
  const serviceSignal = /美甲|美睫|睫毛|指甲|款式|参考图|报价|价格|多少钱|卸甲|延长|断甲|修补|预约|想约|要约|book|nail|lash|quote|price/.test(compact)
  return !serviceSignal
}

function isPolicyOrDepositOnlyInquiry(text = '') {
  const compact = compactIntentText(text)
  if (!compact) return false
  const asksPolicy = /取消|改期|改时间|换时间|退定金|退款|迟到|爽约|cancel|reschedule|refund/.test(compact)
  const asksDeposit = /定金|deposit/.test(compact)
  if (!asksPolicy && !asksDeposit) return false
  const serviceSignal = /款式|参考图|法式|贝母|渐变|手绘|卸甲|延长|断甲|修补|做美甲|做美睫|做指甲|做睫毛|这个款|这一款|这款/.test(compact)
  return !serviceSignal
}

function resolveQuoteWorkflow(inbound = {}, transcript = [], fallbackReply = null, knowledgeContext = {}, persistedState = null) {
  const state = buildQuoteIntakeState(inbound, transcript, persistedState)
  const missingQuestions = quoteMissingQuestions(state)
  if (hasBookingScheduleFollowupIntent(state.currentText || inbound.content || '', state, persistedState)) {
    return { reply: fallbackReply, shouldCreateQuote: false, state, quotePayload: null }
  }
  // 纯门店信息问题（营业时间/地址/电话等）直接走普通回答，不进询单流程。
  // “营业时间”里的“时间”曾被误判为预约意图导致新客被回美甲询单模板。
  if (isStoreInfoOnlyInquiry(state.currentText || inbound.content || '')) {
    state.appointmentIntent = false
    return { reply: fallbackReply, shouldCreateQuote: false, state, quotePayload: null }
  }
  // 纯政策/定金问题（取消、改期、定金多少等）同理直接走普通回答。
  if (isPolicyOrDepositOnlyInquiry(state.currentText || inbound.content || '')) {
    state.appointmentIntent = false
    return { reply: fallbackReply, shouldCreateQuote: false, state, quotePayload: null }
  }
  const hasMissingRequired = missingQuestions.zh.length > 0
  const hasQuoteStateUpdate = [
    state.extensionNeeded,
    state.removalNeeded,
    state.repairNeeded,
    state.lowerLashRequested,
    state.lashRemovalNeeded,
    state.healthCheckClear
  ].some((value) => ['yes', 'no', 'partial'].includes(value))
  const quoteRelated = state.hasReferenceContext || state.priceIntent || state.capabilityIntent || state.appointmentIntent || state.serviceStartIntent || state.contextualFollowup || hasQuoteStateUpdate
  if (!quoteRelated) return { reply: fallbackReply, shouldCreateQuote: false, state, quotePayload: null }

  if (hasSpecialManualHandoffIntent(state.currentText || inbound.content || '')) {
    const reply = quoteIntakeReply('manual_special_review', state, missingQuestions)
    return {
      reply,
      shouldCreateQuote: true,
      state,
      quotePayload: quotePayloadFromState(state, inbound, knowledgeContext, 'special_manual_review')
    }
  }

  if (isReturningQuoteCustomer(state) && state.capabilityIntent && !state.priceIntent && shouldHandOffForQuote(state)) {
    const reply = quoteIntakeReply('ready_returning_feasibility', state, missingQuestions)
    return {
      reply,
      shouldCreateQuote: true,
      state,
      quotePayload: quotePayloadFromState(state, inbound, knowledgeContext, 'returning_feasibility_ready')
    }
  }

  if (shouldEscalateUnclearIntake(state, persistedState, missingQuestions)) {
    const reply = quoteIntakeReply('manual_intake_review', state, missingQuestions)
    return {
      reply,
      shouldCreateQuote: true,
      state,
      quotePayload: quotePayloadFromState(state, inbound, knowledgeContext, 'unclear_intake_manual_review')
    }
  }

  if (shouldHandOffForQuote(state)) {
    const reply = quoteIntakeReply('ready_quote', state, missingQuestions)
    return {
      reply,
      shouldCreateQuote: true,
      state,
      quotePayload: quotePayloadFromState(state, inbound, knowledgeContext, state.priceIntent ? 'explicit_price_ready' : 'intake_ready')
    }
  }

  if (state.priceIntent || state.contextualFollowup || state.capabilityIntent || state.appointmentIntent || state.serviceStartIntent || state.hasReferenceContext || hasQuoteStateUpdate) {
    return { reply: quoteIntakeReply('collect_template', state, missingQuestions), shouldCreateQuote: false, state, quotePayload: null }
  }
  return { reply: fallbackReply, shouldCreateQuote: false, state, quotePayload: null }
}

function isQuoteWaitingCheck(text = '') {
  return /好了吗|有回复吗|报价出来了吗|出价了吗|还要多久|等多久|催一下|ready|any update|quote ready/.test(compactIntentText(text))
}

function getActiveQuoteForConversation(conversationId) {
  if (!conversationId) return null
  return db.prepare(`
    SELECT * FROM quote_requests
    WHERE conversation_id = ? AND status = 'PENDING_STAFF'
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(conversationId)
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

function assistantReplyText(reply = null, lang = 'zh') {
  const data = reply?.data || reply || {}
  return lang === 'en' ? (data.answerEn || data.answerZh || '') : (data.answerZh || data.answerEn || '')
}

function hasBookingDraftIntent(text = '') {
  const compact = compactIntentText(text)
  return /确认预约|想预约|要预约|可以预约|帮我约|帮我预约|就约|约这个|可以下单|发链接|预约链接|草稿链接|book|appointment|reserve/.test(compact)
}

function hasBookingScheduleFollowupIntent(text = '', state = {}, persistedState = null) {
  const stage = persistedState?.quoteStage || state?.quoteStage || ''
  if (!['quoted', 'draft_created'].includes(stage)) return false
  const compact = compactIntentText(text)
  if (!compact) return false
  if (state.bookingDate || state.bookingTime || state.hasDateTime) return true
  return /这周|本周|下周|周[一二三四五六日天]|星期[一二三四五六日天]|今天|明天|后天|上午|下午|晚上|中午|凌晨|\d{1,2}[:：]\d{2}|[一二两三四五六七八九十\d]{1,3}点|那就|就这个|这个时间|可以|确认|定这个/.test(compact)
}

function getLatestQuotedQuoteForConversation(conversationId, preferredQuoteId = '') {
  if (!conversationId) return null
  if (preferredQuoteId) {
    const preferred = db.prepare("SELECT * FROM quote_requests WHERE id = ? AND conversation_id = ? AND status IN ('QUOTED', 'DRAFT_CREATED')").get(preferredQuoteId, conversationId)
    if (preferred) return serializeQuoteRequest(preferred)
  }
  const row = db.prepare(`
    SELECT * FROM quote_requests
    WHERE conversation_id = ? AND status IN ('QUOTED', 'DRAFT_CREATED')
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(conversationId)
  return serializeQuoteRequest(row)
}

function latestDraftForQuote(quoteId) {
  if (!quoteId) return null
  const row = db.prepare(`
    SELECT id FROM booking_drafts
    WHERE quote_request_id = ? AND status IN ('DRAFT', 'BOOKING_CREATED')
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(quoteId)
  return row?.id ? getBookingDraftById(row.id) : null
}

function appendCustomerBookingIntent(conversationId, inbound) {
  return appendWecomConversationMessage(conversationId, {
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
    status: 'ai_replied',
    lastIntent: 'booking_draft_request',
    lastMessage: inbound.content,
    raw: inbound.raw || {}
  })
}

function confirmedBookingSlotFromQuote(quote = {}, stateOrBody = {}) {
  const intake = quote?.styleElements?.quoteIntake || {}
  const state = stateOrBody?.state || stateOrBody || {}
  const rawDate = state.date || state.bookingDate || state.requestedDate || state.suggestedBookingDate || intake.bookingDate || intake.requestedDate || intake.suggestedBookingDate || ''
  const rawTime = state.time || state.bookingTime || state.requestedTime || state.suggestedBookingTime || intake.bookingTime || intake.requestedTime || intake.suggestedBookingTime || ''
  let date = /^\d{4}-\d{2}-\d{2}$/.test(String(rawDate || '')) ? rawDate : ''
  let time = /^\d{2}:\d{2}$/.test(String(rawTime || '')) ? rawTime : ''
  // 顾客在询单表里用松散格式（如“7.6 下午3点”）提到过时间时，
  // 不能因为格式不严格就丢掉，否则报价返回后会重复追问时间。
  if (!date || !time) {
    const looseSource = [state.bookingTimeRaw, intake.bookingTimeRaw, !date && rawDate, !time && rawTime]
      .filter(Boolean)
      .join(' ')
    if (looseSource.trim()) {
      const parsed = extractBookingDateTime(looseSource)
      if (!date && parsed.date) date = parsed.date
      if (!time && parsed.time) time = parsed.time
    }
  }
  return {
    date,
    time,
    raw: state.bookingTimeRaw || intake.bookingTimeRaw || ''
  }
}

function appendQuoteNeedsTimeAssistantReply(quote, state = {}) {
  if (!quote?.conversationId) return null
  let textZh = '可以的亲亲，我可以继续帮您生成预约草稿，但在创建前需要先确认到店日期和时间。请直接回复“日期 + 时间”，例如：7月1日 14:30。如果这个时间没有空位，我会优先帮您找前后半小时最接近的时间。'
  let textEn = 'Sure, I can create a booking draft for you, but I need to confirm the visit date and time first. Please reply with the date + time, for example: July 1 at 2:30 PM. If that slot is unavailable, I will look for the closest time around it.'
  if (state.bookingDate && !state.bookingTime) {
    textZh = `收到亲亲，日期我记下来了：${state.bookingDate}。创建预约草稿前还需要确认具体到店时间，例如 14:30 或下午两点。`
    textEn = `Got it, I have the date: ${state.bookingDate}. Before creating the booking draft, I still need the exact visit time, for example 2:30 PM.`
  } else if (!state.bookingDate && state.bookingTime) {
    textZh = `收到亲亲，时间我记下来了：${state.bookingTime}。创建预约草稿前还需要确认具体日期，例如 7月1日。`
    textEn = `Got it, I have the time: ${state.bookingTime}. Before creating the booking draft, I still need the date, for example July 1.`
  }
  const text = quote.customerLang === 'en' ? textEn : textZh
  upsertConversationState(quote.conversationId, {
    quoteStage: 'quoted',
    nextAction: 'collect_booking_time',
    intent: 'booking_time_required',
    lastAssistantMessage: text,
    state: {
      ...(getConversationState(quote.conversationId)?.state || {}),
      ...(state || {}),
      quoteRequestId: quote.id
    },
    summaryText: conversationStateSummary(state || {})
  })
  return appendWecomConversationMessage(quote.conversationId, {
    role: 'assistant',
    content: text,
    intent: 'booking_time_required',
    quoteRequestId: quote.id,
    handoffRequired: false
  }, {
    status: 'ai_replied',
    lastIntent: 'booking_time_required',
    lastMessage: text,
    aiReply: { data: { intent: 'booking_time_required', answerZh: textZh, answerEn: textEn, quoteRequestId: quote.id }, source: 'quote_draft_guard' }
  })
}

function appendQuoteUnavailableSlotAssistantReply(quote, slot = {}, error = {}, state = {}) {
  if (!quote?.conversationId) return null
  const details = error.details || {}
  const requestedDate = details.requestedDate || slot.date || state.bookingDate || ''
  const requestedTime = details.requestedTime || slot.time || state.bookingTime || ''
  const nearestDate = details.nearestDate || ''
  const nearestTime = details.nearestTime || ''
  const hoursZh = businessHoursText(null, 'zh')
  const hoursEn = businessHoursText(null, 'en')
  let textZh = `亲亲，${requestedDate || '您选的日期'} ${requestedTime || '这个时间'} 系统里暂时没有可预约排班。我们的营业时间是${hoursZh}，请尽量选择营业时间内的到店时间。`
  let textEn = `That requested slot ${requestedDate || ''} ${requestedTime || ''} is not available in the schedule. Our business hours are ${hoursEn}. Please choose a visit time within business hours.`

  if (nearestDate && nearestTime && nearestDate === requestedDate) {
    textZh += `当天最近可约时间是 ${nearestTime}，您看这个时间可以吗？如果不合适，我也可以继续帮您找前后相近的时间。`
    textEn += ` The closest available time on the same day is ${nearestTime}. Would that work for you? If not, I can keep checking nearby times.`
  } else if (nearestDate && nearestTime) {
    textZh += `这一天暂时没有合适空位，最近可以安排的是 ${nearestDate} ${nearestTime}，您看可以吗？`
    textEn += ` There is no suitable slot on that date. The nearest available slot is ${nearestDate} ${nearestTime}. Would that work for you?`
  } else {
    textZh += '我先转给人工帮您确认最近可约时间。'
    textEn += ' I will ask our team to confirm the nearest available time for you.'
  }

  const text = quote.customerLang === 'en' ? textEn : textZh
  const currentState = getConversationState(quote.conversationId)?.state || {}
  const nextState = {
    ...currentState,
    ...(state || {}),
    quoteRequestId: quote.id,
    bookingDate: nearestDate || requestedDate || state.bookingDate || '',
    bookingTime: nearestTime || '',
    bookingTimeRaw: state.bookingTimeRaw || '',
    suggestedBookingDate: nearestDate || '',
    suggestedBookingTime: nearestTime || '',
    lastUnavailableBookingDate: requestedDate || '',
    lastUnavailableBookingTime: requestedTime || ''
  }
  upsertConversationState(quote.conversationId, {
    quoteStage: 'quoted',
    nextAction: nearestDate && nearestTime ? 'confirm_suggested_booking_time' : 'manual_schedule_review',
    intent: nearestDate && nearestTime ? 'booking_slot_unavailable' : 'booking_slot_manual_review',
    lastAssistantMessage: text,
    state: nextState,
    summaryText: conversationStateSummary(nextState)
  })
  return appendWecomConversationMessage(quote.conversationId, {
    role: 'assistant',
    content: text,
    intent: nearestDate && nearestTime ? 'booking_slot_unavailable' : 'booking_slot_manual_review',
    quoteRequestId: quote.id,
    suggestedSlot: nearestDate && nearestTime ? { date: nearestDate, time: nearestTime } : null,
    handoffRequired: !(nearestDate && nearestTime)
  }, {
    status: nearestDate && nearestTime ? 'ai_replied' : 'needs_human',
    lastIntent: nearestDate && nearestTime ? 'booking_slot_unavailable' : 'booking_slot_manual_review',
    lastMessage: text,
    aiReply: {
      data: {
        intent: nearestDate && nearestTime ? 'booking_slot_unavailable' : 'booking_slot_manual_review',
        answerZh: textZh,
        answerEn: textEn,
        quoteRequestId: quote.id,
        requestedSlot: requestedDate || requestedTime ? { date: requestedDate, time: requestedTime } : null,
        suggestedSlot: nearestDate && nearestTime ? { date: nearestDate, time: nearestTime } : null
      },
      source: 'quote_draft_slot_guard'
    }
  })
}

async function handleWecomInbound(inbound, req) {
  const conversationId = wecomConversationId(inbound.externalUserId)
  // 套餐闸门：AI 客服未开通或试用过期时，进线照常记录并静默转人工，AI 不回复。
  if (!checkEntitlement(currentTenantId(), 'ai_customer_service')) {
    const conversation = appendWecomConversationMessage(conversationId, {
      role: 'customer',
      content: inbound.content || '',
      referenceImages: inbound.referenceImages || []
    }, {
      status: 'needs_human',
      lastIntent: 'entitlement_ai_disabled',
      lastMessage: inbound.content || '',
      provider: inbound.provider,
      externalUserId: inbound.externalUserId,
      raw: inbound.raw
    })
    return { conversationId, inbound, reply: null, entitlementBlocked: true, conversation }
  }
  const context = buildCustomerServiceContext(req, inbound.lang || 'zh')
  const existing = db.prepare('SELECT status, transcript_json FROM wechat_conversations WHERE id = ?').get(conversationId)
  const existingTranscript = parseJson(existing?.transcript_json)
  const persistedState = getConversationState(conversationId)
  const allowAi = Boolean(inbound.forceAi)
  const explicitAiResume = isExplicitAiResumeIntent(inbound.content || '')
  const bypassSilentHandoff = (allowAi || explicitAiResume) && ['needs_human', 'human_active'].includes(existing?.status)
  const humanCooldownReleased = shouldReleaseHumanConversationToAi(existing?.status, existingTranscript)
  if ((allowAi || explicitAiResume) && ['needs_human', 'human_active'].includes(existing?.status)) {
    upsertConversationState(conversationId, {
      sourceChannel: inbound.sourceChannel,
      customerStage: inbound.customerStage,
      nextAction: 'continue_ai_chat',
      lastCustomerMessage: inbound.content || '',
      intent: 'manual_release_to_ai',
      state: {
        ...(persistedState?.state || {}),
        handoffOwner: 'ai',
        humanReleasedAt: iso(new Date())
      }
    })
  }
  if (humanCooldownReleased) {
    upsertConversationState(conversationId, {
      sourceChannel: inbound.sourceChannel,
      customerStage: inbound.customerStage,
      nextAction: 'ai_resume_after_human_cooldown',
      lastCustomerMessage: inbound.content || '',
      intent: 'ai_resume_after_human_cooldown',
      state: {
        ...(persistedState?.state || {}),
        handoffOwner: 'ai',
        humanCooldownMinutes: HUMAN_REPLY_COOLDOWN_MINUTES,
        humanReleasedAt: iso(new Date())
      }
    })
  }
  if (['needs_human', 'human_active'].includes(existing?.status) && !allowAi && !humanCooldownReleased) {
    const activeQuote = getActiveQuoteForConversation(conversationId)
    if (existing.status === 'needs_human' && activeQuote && isQuoteWaitingCheck(inbound.content || '')) {
      upsertConversationState(conversationId, {
        sourceChannel: inbound.sourceChannel,
        customerStage: inbound.customerStage,
        quoteStage: 'waiting_staff_quote',
        nextAction: 'waiting_staff_quote',
        lastCustomerMessage: inbound.content || '',
        intent: 'quote_waiting_check'
      })
      appendWecomConversationMessage(conversationId, {
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
      const waitReplyText = assistantReplyText(waitReply, inbound.lang || 'zh')
      upsertConversationState(conversationId, {
        quoteStage: 'waiting_staff_quote',
        nextAction: 'waiting_staff_quote',
        intent: 'quote_waiting_check',
        lastAssistantMessage: waitReplyText,
        state: {
          ...(getConversationState(conversationId)?.state || {}),
          quoteRequestId: activeQuote.id
        }
      })
      const conversation = appendWecomConversationMessage(conversationId, {
        role: 'assistant',
        content: waitReplyText,
        intent: waitReply.data.intent,
        handoffRequired: false,
        quoteRequestId: activeQuote.id
      }, {
        status: 'needs_human',
        lastIntent: 'quote_waiting_check',
        lastMessage: waitReplyText,
        aiReply: waitReply
      })
      return { conversationId, inbound, reply: waitReply, waitingForHuman: true, conversation }
    }
    const humanState = buildQuoteIntakeState(inbound, existingTranscript, persistedState)
    const activeQuoteStyle = parseJson(activeQuote?.style_elements_json)
    upsertConversationState(conversationId, {
      sourceChannel: inbound.sourceChannel,
      customerStage: inbound.customerStage,
      quoteStage: persistedState?.quoteStage || 'waiting_staff_quote',
      nextAction: 'waiting_human_reply',
      lastCustomerMessage: inbound.content || '',
      intent: 'human_followup',
      state: humanState,
      summaryText: conversationStateSummary(humanState),
      referenceImages: humanState.referenceImages || []
    })
    if (activeQuote) {
      upsertActiveQuoteRequest({
        conversationId,
        sourceChannel: inbound.sourceChannel,
        serviceType: humanState.serviceType,
        customerMessage: [
          activeQuote.customer_message || '',
          inbound.content ? `顾客补充：${inbound.content}` : ''
        ].filter(Boolean).join('\n'),
        customerLang: inbound.lang || 'zh',
        referenceImages: humanState.referenceImages || inbound.referenceImages || [],
        extensionNeeded: humanState.extensionNeeded,
        removalNeeded: humanState.removalNeeded,
        repairNeeded: humanState.repairNeeded,
        charmsNeeded: humanState.charmsNeeded,
        firstLashVisit: humanState.firstLashVisit,
        lowerLashRequested: humanState.lowerLashRequested,
        healthCheckClear: humanState.healthCheckClear,
        styleElements: {
          quoteIntake: {
            ...(activeQuoteStyle.quoteIntake || {}),
            extensionNeeded: humanState.extensionNeeded,
            removalNeeded: humanState.removalNeeded,
            repairNeeded: humanState.repairNeeded,
            firstLashVisit: humanState.firstLashVisit,
            lowerLashRequested: humanState.lowerLashRequested,
            lashRemovalNeeded: humanState.lashRemovalNeeded,
            healthCheckClear: humanState.healthCheckClear,
            latestCustomerSupplement: inbound.content || '',
            completion: intakeCompletion(humanState),
            updatedDuringHumanWait: true
          }
        }
      })
    }
    const nextStatus = existing.status === 'needs_human' ? 'needs_human' : 'human_active'
    const conversation = appendWecomConversationMessage(conversationId, {
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
    return { conversationId, inbound, reply: null, waitingForHuman: true, conversation }
  }
  const afterSalesProblem = detectAfterSalesProblem({ inbound, transcript: existingTranscript, persistedState })
  if (!bypassSilentHandoff && afterSalesProblem.matched) {
    const intakeState = buildQuoteIntakeState(inbound, existingTranscript, persistedState)
    const referenceImages = mergeReferenceImages(
      intakeState.referenceImages || [],
      transcriptReferenceImages(existingTranscript),
      inbound.referenceImages || []
    )
    const reply = afterSalesHandoffReply(afterSalesProblem, inbound.lang || 'zh')
    const replyText = assistantReplyText(reply, inbound.lang || 'zh')
    let conversation = appendWecomConversationMessage(conversationId, {
      role: 'customer',
      content: inbound.content,
      messageId: inbound.messageId,
      msgType: inbound.msgType,
      referenceImages: inbound.referenceImages || [],
      intent: 'after_sales_handoff'
    }, {
      provider: inbound.provider,
      externalUserId: inbound.externalUserId,
      openKfid: inbound.openKfid,
      sourceChannel: inbound.sourceChannel,
      status: 'needs_human',
      lastIntent: 'after_sales_handoff',
      lastMessage: inbound.content,
      raw: inbound.raw || {},
      aiReply: reply
    })
    const quoteRequest = upsertActiveQuoteRequest({
      conversationId,
      sourceChannel: inbound.sourceChannel,
      serviceType: afterSalesProblem.serviceType || intakeState.serviceType || inferServiceTypeFromText(inbound.content || ''),
      customerMessage: quoteCustomerCorpus(existingTranscript, inbound.content || ''),
      customerLang: inbound.lang || 'zh',
      referenceImages,
      extensionNeeded: intakeState.extensionNeeded,
      removalNeeded: intakeState.removalNeeded,
      repairNeeded: intakeState.repairNeeded,
      charmsNeeded: intakeState.charmsNeeded,
      firstLashVisit: intakeState.firstLashVisit,
      lowerLashRequested: intakeState.lowerLashRequested,
      healthCheckClear: intakeState.healthCheckClear,
      styleElements: {
        workflowType: 'after_sales',
        afterSales: afterSalesProblem,
        quoteIntake: {
          trigger: 'after_sales_review',
          firstLashVisit: intakeState.firstLashVisit,
          latestCustomerMessage: inbound.content || '',
          completion: intakeCompletion(intakeState),
          historicalReferenceImageCount: referenceImages.length
        }
      },
      aiReply: reply
    })
    conversation = appendWecomConversationMessage(conversationId, {
      role: 'assistant',
      content: replyText,
      intent: reply?.data?.intent || 'after_sales_handoff',
      handoffRequired: true
    }, {
      provider: inbound.provider,
      externalUserId: inbound.externalUserId,
      openKfid: inbound.openKfid,
      sourceChannel: inbound.sourceChannel,
      status: 'needs_human',
      lastIntent: reply?.data?.intent || 'after_sales_handoff',
      lastMessage: inbound.content,
      raw: inbound.raw || {},
      aiReply: reply
    })
    const latestState = getConversationState(conversationId)?.state || {}
    upsertConversationState(conversationId, {
      sourceChannel: inbound.sourceChannel,
      customerStage: inbound.customerStage || 'aftercare',
      serviceType: afterSalesProblem.serviceType || intakeState.serviceType,
      intent: 'after_sales_handoff',
      quoteStage: 'waiting_staff_quote',
      nextAction: 'waiting_human_after_sales',
      state: {
        ...latestState,
        ...intakeState,
        referenceImages,
        afterSales: afterSalesProblem,
        quoteRequestId: quoteRequest?.id,
        quoteCreatedAt: iso(new Date()),
        handoffOwner: afterSalesProblem.needsOwner ? 'owner' : 'human'
      },
      referenceImages,
      missingQuestions: [],
      lastCustomerMessage: inbound.content || '',
      lastAssistantMessage: replyText,
      summaryText: conversationStateSummary({
        ...intakeState,
        serviceType: afterSalesProblem.serviceType,
        referenceImages,
        afterSales: afterSalesProblem
      })
    })
    return { conversationId, inbound, reply, conversation, waitingForHuman: true, quoteRequest }
  }
  const quotedBookingState = ['quoted', 'draft_created'].includes(persistedState?.quoteStage || '')
    ? buildQuoteIntakeState(inbound, existingTranscript, persistedState)
    : null
  if ((hasBookingDraftIntent(inbound.content || '') || hasBookingScheduleFollowupIntent(inbound.content || '', quotedBookingState || {}, persistedState)) && ['quoted', 'draft_created'].includes(persistedState?.quoteStage || '')) {
    appendCustomerBookingIntent(conversationId, inbound)
    const quote = getLatestQuotedQuoteForConversation(conversationId, persistedState?.state?.quoteRequestId || '')
    if (quote) {
      const bookingState = quotedBookingState || buildQuoteIntakeState(inbound, existingTranscript, persistedState)
      const existingDraft = latestDraftForQuote(quote.id)
      if (existingDraft) {
        const conversation = appendQuoteDraftAssistantReply(quote, existingDraft)
        return { conversationId, inbound, reply: conversation?.aiReply || null, conversation, bookingDraft: existingDraft }
      }
      const slot = confirmedBookingSlotFromQuote(quote, bookingState)
      if (!slot.date || !slot.time) {
        const conversation = appendQuoteNeedsTimeAssistantReply(quote, bookingState)
        return { conversationId, inbound, reply: conversation?.aiReply || null, conversation, bookingTimeRequired: true }
      }
      try {
        const result = createQuoteDraftHold(quote.id, { date: slot.date, time: slot.time }, { role: 'owner', email: 'ai-system@luckyluxe.local' })
        return { conversationId, inbound, reply: result.conversation?.aiReply || null, conversation: result.conversation, bookingDraft: result.bookingDraft }
      } catch (error) {
        if (['REQUESTED_DRAFT_SLOT_UNAVAILABLE', 'REQUESTED_DRAFT_DATE_UNAVAILABLE', 'NO_AVAILABLE_DRAFT_SLOT'].includes(error.code)) {
          const conversation = appendQuoteUnavailableSlotAssistantReply(quote, slot, error, bookingState)
          const suggestedSlot = error.details?.nearestDate && error.details?.nearestTime
            ? { date: error.details.nearestDate, time: error.details.nearestTime }
            : null
          return {
            conversationId,
            inbound,
            reply: conversation?.aiReply || null,
            conversation,
            bookingSlotUnavailable: true,
            suggestedSlot
          }
        }
        throw error
      }
    }
  }
  // 商家自助 FAQ 直答：命中商家维护的知识条目时，用商家原文回答，替代静默转人工。
  const tenantKbEntry = matchTenantKbEntry(inbound.content || '')
  if (tenantKbEntry) {
    const kbReply = {
      data: {
        intent: 'tenant_kb_answer',
        answerZh: tenantKbEntry.answer_zh,
        answerEn: tenantKbEntry.answer_en || tenantKbEntry.answer_zh,
        handoffRequired: false
      },
      source: 'tenant_kb'
    }
    recordWecomConversation(inbound, kbReply, 'ai_replied')
    upsertConversationState(conversationId, {
      sourceChannel: inbound.sourceChannel,
      intent: 'tenant_kb_answer',
      lastCustomerMessage: inbound.content || '',
      lastAssistantMessage: assistantReplyText(kbReply, inbound.lang || 'zh'),
      state: getConversationState(conversationId)?.state || {},
      summaryText: getConversationState(conversationId)?.summaryText || ''
    })
    return { conversationId, inbound, reply: kbReply, conversation: getWecomConversation(conversationId) }
  }
  if (!bypassSilentHandoff && shouldSilentHandoffBeforeAi({ inbound, transcript: existingTranscript, persistedState })) {
    return silentHandoffUnknown(inbound, 'unknown_before_ai')
  }
  const preQuoteWorkflow = resolveQuoteWorkflow(inbound, existingTranscript, null, {}, persistedState)
  if (preQuoteWorkflow.reply) {
    const reply = preQuoteWorkflow.reply
    const replyText = assistantReplyText(reply, inbound.lang || 'zh')
    recordWecomConversation(inbound, reply, preQuoteWorkflow.shouldCreateQuote ? 'needs_human' : 'ai_replied')
    const missingQuestions = quoteMissingQuestions(preQuoteWorkflow.state || {})
    const nextAction = deriveNextAction({
      quoteStage: getConversationState(conversationId)?.quoteStage || 'idle',
      quoteState: preQuoteWorkflow.state,
      missingQuestions,
      shouldCreateQuote: preQuoteWorkflow.shouldCreateQuote
    })
    upsertConversationState(conversationId, {
      sourceChannel: inbound.sourceChannel,
      customerStage: inbound.customerStage,
      serviceType: preQuoteWorkflow.state?.serviceType,
      intent: preQuoteWorkflow.state?.priceIntent ? 'pricing' : (reply?.data?.intent || 'unknown'),
      quoteStage: preQuoteWorkflow.shouldCreateQuote ? 'waiting_staff_quote' : (nextAction === 'collect_quote_requirements' ? 'collecting_requirements' : (getConversationState(conversationId)?.quoteStage || 'idle')),
      nextAction,
      state: preQuoteWorkflow.state || {},
      referenceImages: preQuoteWorkflow.state?.referenceImages || inbound.referenceImages || [],
      missingQuestions,
      lastCustomerMessage: inbound.content || '',
      lastAssistantMessage: replyText,
      summaryText: conversationStateSummary(preQuoteWorkflow.state || {})
    })
    if (preQuoteWorkflow.shouldCreateQuote) {
      const quoteRequest = upsertActiveQuoteRequest({
        conversationId,
        sourceChannel: inbound.sourceChannel,
        serviceType: preQuoteWorkflow.quotePayload?.serviceType || inferServiceTypeFromText(inbound.content || ''),
        customerMessage: preQuoteWorkflow.quotePayload?.customerMessage || inbound.content || '',
        customerLang: inbound.lang || 'zh',
        referenceImages: preQuoteWorkflow.quotePayload?.referenceImages || preQuoteWorkflow.state?.referenceImages || inbound.referenceImages || [],
        extensionNeeded: preQuoteWorkflow.state?.extensionNeeded,
        removalNeeded: preQuoteWorkflow.state?.removalNeeded,
        repairNeeded: preQuoteWorkflow.state?.repairNeeded,
        charmsNeeded: preQuoteWorkflow.state?.charmsNeeded,
        firstLashVisit: preQuoteWorkflow.state?.firstLashVisit,
        lowerLashRequested: preQuoteWorkflow.state?.lowerLashRequested,
        healthCheckClear: preQuoteWorkflow.state?.healthCheckClear,
        styleElements: preQuoteWorkflow.quotePayload?.styleElements || {},
        aiReply: reply
      })
      upsertConversationState(conversationId, {
        quoteStage: 'waiting_staff_quote',
        nextAction: 'waiting_staff_quote',
        intent: 'pricing',
        state: {
          ...(getConversationState(conversationId)?.state || {}),
          quoteRequestId: quoteRequest?.id,
          quoteCreatedAt: iso(new Date())
        },
        lastAssistantMessage: replyText,
        summaryText: conversationStateSummary({
          ...(getConversationState(conversationId)?.state || {}),
          serviceType: preQuoteWorkflow.state?.serviceType,
          referenceImages: preQuoteWorkflow.state?.referenceImages || [],
          extensionNeeded: preQuoteWorkflow.state?.extensionNeeded,
          removalNeeded: preQuoteWorkflow.state?.removalNeeded,
          repairNeeded: preQuoteWorkflow.state?.repairNeeded,
          charmsNeeded: preQuoteWorkflow.state?.charmsNeeded,
          firstLashVisit: preQuoteWorkflow.state?.firstLashVisit,
          lowerLashRequested: preQuoteWorkflow.state?.lowerLashRequested,
          lashRemovalNeeded: preQuoteWorkflow.state?.lashRemovalNeeded,
          healthCheckClear: preQuoteWorkflow.state?.healthCheckClear
        })
      })
    }
    return { conversationId, inbound, reply, conversation: getWecomConversation(conversationId) }
  }
  const memoryContextText = workingMemoryPromptText(persistedState)
  const normalizedCustomerStage = String(inbound.customerStage || '').trim()
  const testContextNotes = [
    normalizedCustomerStage && normalizedCustomerStage !== 'unified_test' ? `测试顾客阶段：${normalizedCustomerStage}` : '',
    inbound.referenceImages?.length ? `顾客已上传 ${inbound.referenceImages.length} 张参考图，当前阶段只能整理需求并转技师确认，不可直接按图最终报价。` : '',
    memoryContextText ? `系统 working memory:\n${memoryContextText}` : '',
    persistedState?.summaryText ? `系统已记住的本会话需求：${persistedState.summaryText}` : '',
    persistedState?.quoteStage && persistedState.quoteStage !== 'idle' ? `当前报价阶段：${persistedState.quoteStage}；下一步：${persistedState.nextAction || 'continue_ai_chat'}。` : '',
    persistedState?.referenceImages?.length ? `本会话历史参考图数量：${persistedState.referenceImages.length}。即使当前消息没有带图，后台报价也要带入历史参考图。` : ''
  ].filter(Boolean)
  const enrichedMessage = `${inbound.content || ''}${testContextNotes.length ? `\n${testContextNotes.join('\n')}` : ''}`
  const knowledgeContext = attachOwnerApprovedSamples(buildKnowledgeContext({
    lang: inbound.lang || 'zh',
    message: enrichedMessage,
    ...context,
    sourceChannel: inbound.sourceChannel,
      customerStage: normalizedCustomerStage === 'unified_test' ? '' : inbound.customerStage,
    referenceImages: inbound.referenceImages || [],
    liveTenantFacts: liveTenantFacts(),
    platformKb: platformKbOverride(),
    tenantDocuments: tenantKbDocumentsForPrompt(currentTenantId())
  }), inbound.lang || 'zh')
  countAiUsage()
  const baseReply = await createCustomerServiceReply({
    lang: inbound.lang || 'zh',
    message: enrichedMessage,
    sampleMatchMessage: inbound.content || '',
    history: aiConversationHistory(existingTranscript),
    knowledgeContext,
    ...context
  })
  const quoteWorkflow = resolveQuoteWorkflow(inbound, existingTranscript, baseReply, knowledgeContext, persistedState)
  const reply = quoteWorkflow.reply || baseReply
  if (!bypassSilentHandoff && shouldSilentHandoffAfterAi({ inbound, reply, quoteWorkflow, knowledgeContext, transcript: existingTranscript, persistedState })) {
    return silentHandoffUnknown(inbound, 'unknown_after_ai')
  }
  const replyText = assistantReplyText(reply, inbound.lang || 'zh')
  recordWecomConversation(inbound, reply, quoteWorkflow.shouldCreateQuote ? 'needs_human' : 'ai_replied')
  const missingQuestions = quoteMissingQuestions(quoteWorkflow.state || {})
  const nextAction = deriveNextAction({
    quoteStage: getConversationState(conversationId)?.quoteStage || 'idle',
    quoteState: quoteWorkflow.state,
    missingQuestions,
    shouldCreateQuote: quoteWorkflow.shouldCreateQuote
  })
  upsertConversationState(conversationId, {
    sourceChannel: inbound.sourceChannel,
    customerStage: inbound.customerStage,
    serviceType: quoteWorkflow.state?.serviceType,
    intent: quoteWorkflow.state?.priceIntent ? 'pricing' : (reply?.data?.intent || 'unknown'),
    quoteStage: quoteWorkflow.shouldCreateQuote ? 'waiting_staff_quote' : (nextAction === 'collect_quote_requirements' ? 'collecting_requirements' : (getConversationState(conversationId)?.quoteStage || 'idle')),
    nextAction,
    state: quoteWorkflow.state || {},
    referenceImages: quoteWorkflow.state?.referenceImages || inbound.referenceImages || [],
    missingQuestions,
    lastCustomerMessage: inbound.content || '',
    lastAssistantMessage: replyText,
    summaryText: conversationStateSummary(quoteWorkflow.state || {})
  })
  if (quoteWorkflow.shouldCreateQuote) {
    const quoteRequest = upsertActiveQuoteRequest({
      conversationId,
      sourceChannel: inbound.sourceChannel,
      serviceType: quoteWorkflow.quotePayload?.serviceType || inferServiceTypeFromText(inbound.content || ''),
      customerMessage: quoteWorkflow.quotePayload?.customerMessage || inbound.content || '',
      customerLang: inbound.lang || 'zh',
      referenceImages: quoteWorkflow.quotePayload?.referenceImages || quoteWorkflow.state?.referenceImages || inbound.referenceImages || [],
      extensionNeeded: quoteWorkflow.state?.extensionNeeded,
      removalNeeded: quoteWorkflow.state?.removalNeeded,
      repairNeeded: quoteWorkflow.state?.repairNeeded,
      charmsNeeded: quoteWorkflow.state?.charmsNeeded,
      firstLashVisit: quoteWorkflow.state?.firstLashVisit,
      lowerLashRequested: quoteWorkflow.state?.lowerLashRequested,
      healthCheckClear: quoteWorkflow.state?.healthCheckClear,
      styleElements: quoteWorkflow.quotePayload?.styleElements || {},
      aiReply: reply
    })
    upsertConversationState(conversationId, {
      quoteStage: 'waiting_staff_quote',
      nextAction: 'waiting_staff_quote',
      intent: 'pricing',
      state: {
        ...(getConversationState(conversationId)?.state || {}),
        quoteRequestId: quoteRequest?.id,
        quoteCreatedAt: iso(new Date())
      },
      lastAssistantMessage: replyText,
      summaryText: conversationStateSummary({
        ...(getConversationState(conversationId)?.state || {}),
        serviceType: quoteWorkflow.state?.serviceType,
        referenceImages: quoteWorkflow.state?.referenceImages || [],
        extensionNeeded: quoteWorkflow.state?.extensionNeeded,
        removalNeeded: quoteWorkflow.state?.removalNeeded,
        repairNeeded: quoteWorkflow.state?.repairNeeded,
        charmsNeeded: quoteWorkflow.state?.charmsNeeded,
        firstLashVisit: quoteWorkflow.state?.firstLashVisit,
        lowerLashRequested: quoteWorkflow.state?.lowerLashRequested,
        lashRemovalNeeded: quoteWorkflow.state?.lashRemovalNeeded,
        healthCheckClear: quoteWorkflow.state?.healthCheckClear
      })
    })
  }
  return { conversationId, inbound, reply, conversation: getWecomConversation(conversationId) }
}

function getWecomConversations() {
  return db.prepare('SELECT * FROM wechat_conversations WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT 80').all(currentTenantId()).map((row) => getWecomConversation(row.id)).filter(Boolean)
}

function saveManualReplyLearningSample(conversationId, correctedReply, adminSession = {}) {
  const conversation = getWecomConversation(conversationId)
  const transcript = conversation?.transcript || []
  const lastCustomer = [...transcript].reverse().find((item) => item.role === 'customer')
  const lastAssistant = [...transcript].reverse().find((item) => item.role === 'assistant')
  if (!lastCustomer?.content || !correctedReply) return null
  const feedbackId = randomId('feedback')
  const now = iso(new Date())
  db.prepare(`
    INSERT INTO ai_response_feedback
      (id, tenant_id, conversation_id, message_index, customer_message, original_reply, corrected_reply, notes, lang, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?)
  `).run(
    feedbackId,
    currentTenantId(),
    conversationId,
    Math.max(0, transcript.length - 1),
    lastCustomer.content,
    lastAssistant?.content || '',
    correctedReply,
    '后台人工回复沉淀：用于学习人工判断与话术。',
    conversation?.lang || 'zh',
    adminSession?.email || 'manual_staff',
    now,
    now
  )
  db.prepare(`
    INSERT INTO ai_learning_examples
      (id, tenant_id, conversation_id, feedback_id, source, customer_message, original_reply, corrected_reply, context_json, tags_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'manual_staff_reply', ?, ?, ?, ?, ?, 'approved', ?, ?)
  `).run(
    randomId('learn'),
    currentTenantId(),
    conversationId,
    feedbackId,
    lastCustomer.content,
    lastAssistant?.content || '',
    correctedReply,
    JSON.stringify({
      conversationId,
      sourceChannel: conversation?.sourceChannel || '',
      customerType: conversation?.conversationState?.state?.customerType || '',
      memberTier: conversation?.conversationState?.state?.memberTier || '',
      storedFrom: 'manual_reply'
    }),
    JSON.stringify(['manual_reply', 'owner_approved']),
    now,
    now
  )
  return feedbackId
}

function manualReplyQuoteSignal(message = '', currentState = null) {
  const text = String(message || '')
  const compact = compactIntentText(text)
  const hasPrice = /(cad|\$|加币|报价|价格|价钱|定价|费用|需要|大概|约)\s*\d+|\d+\s*(cad|加币|刀|块)|cad\s*\$?\s*\d+/i.test(text)
  const canDo = /可以做|能做|可做|没问题|可以安排|可以约|可以接|can do|available/i.test(text)
  const cannotDo = /做不了|不能做|不建议做|无法做|不可做|cannot|can't/.test(compact)
  const hasDuration = Boolean(parseDurationMinutesFromText(text)) || /时长|预留/.test(text)
  if (!hasPrice && !canDo && !cannotDo && !hasDuration) return null
  const priorStage = currentState?.quoteStage || ''
  const nextAction = cannotDo ? 'request_more_info' : 'send_quote_or_create_draft'
  return {
    quoteStage: cannotDo ? 'declined' : 'quoted',
    nextAction,
    intent: priorStage === 'waiting_staff_quote' ? 'manual_quote_returned' : 'manual_reply_quote_signal',
    quoteCanDo: !cannotDo,
    staffMessage: text,
    quotedAt: iso(new Date())
  }
}

function setConversationHandoffOwner(conversationId, ownerRole = 'human', adminSession = {}) {
  const current = db.prepare('SELECT * FROM wechat_conversations WHERE id = ?').get(conversationId)
  if (!current) throw apiError(404, 'NOT_FOUND', 'Conversation not found.')
  const now = iso(new Date())
  const status = ownerRole === 'human' ? 'human_active' : 'ai_replied'
  db.prepare('UPDATE wechat_conversations SET status = ?, updated_at = ? WHERE id = ?').run(status, now, conversationId)
  const currentState = getConversationState(conversationId)
  upsertConversationState(conversationId, {
    quoteStage: currentState?.quoteStage || 'idle',
    nextAction: ownerRole === 'human' ? 'waiting_human_reply' : 'continue_ai_chat',
    intent: ownerRole === 'human' ? 'manual_takeover' : 'manual_release_to_ai',
    state: {
      ...(currentState?.state || {}),
      handoffOwner: ownerRole,
      ...(ownerRole === 'human'
        ? { humanTakeoverAt: now, humanTakeoverBy: adminSession?.email || 'owner', humanCooldownMinutes: HUMAN_REPLY_COOLDOWN_MINUTES }
        : { humanReleasedAt: now, humanReleasedBy: adminSession?.email || 'owner' })
    },
    summaryText: currentState?.summaryText || ''
  })
  return { conversation: getWecomConversation(conversationId) }
}

async function appendManualWecomReply(conversationId, body = {}, adminSession = {}) {
  const message = String(body.message || body.content || '').trim()
  if (!message) throw apiError(400, 'MESSAGE_REQUIRED', 'Manual reply message is required.')
  // 回复一个不存在的会话没有意义:以前会 upsert 出一条空壳会话,污染客服工作台(老板会看到凭空冒出来的对话)。
  const existing = db.prepare('SELECT id FROM wechat_conversations WHERE id = ?').get(conversationId)
  if (!existing) throw apiError(404, 'CONVERSATION_NOT_FOUND', '会话不存在。')
  saveManualReplyLearningSample(conversationId, message, adminSession)
  const currentState = getConversationState(conversationId)
  const quoteSignal = manualReplyQuoteSignal(message, currentState)
  const conversation = appendWecomConversationMessage(conversationId, {
    role: 'staff',
    content: message,
    staffName: body.staffName || adminSession?.email || 'Lucky Luxe Staff',
    intent: 'manual_reply'
  }, {
    status: body.releaseToAi ? 'ai_replied' : 'human_active',
    lastIntent: 'manual_reply',
    lastMessage: message
  })
  upsertConversationState(conversationId, {
    quoteStage: quoteSignal?.quoteStage || currentState?.quoteStage || 'idle',
    nextAction: body.releaseToAi ? 'continue_ai_chat' : (quoteSignal?.nextAction || 'waiting_after_manual_reply'),
    intent: quoteSignal?.intent || 'manual_reply',
    lastStaffMessage: message,
    state: {
      ...(currentState?.state || {}),
      lastStaffReply: message,
      lastStaffReplyAt: iso(new Date()),
      handoffOwner: body.releaseToAi ? 'ai' : 'human',
      humanCooldownMinutes: HUMAN_REPLY_COOLDOWN_MINUTES,
      ...(quoteSignal || {})
    },
    summaryText: currentState?.summaryText || ''
  })
  const saved = getWecomConversation(conversationId)
  // 真正把人工回复发到顾客微信(出站未就绪/非企微会话时静默跳过,行为与旧版一致)。
  let delivered = false
  if (wecomOutboundReady() && saved?.provider === 'wecom_customer_service') {
    const openKfid = saved.openKfid || saved.open_kfid || WECOM_OPEN_KFID
    const externalUserId = saved.externalUserId || saved.external_user_id
    if (openKfid && externalUserId) {
      try {
        const sent = await sendWecomKfText(openKfid, externalUserId, message)
        delivered = Boolean(sent && !sent.errcode)
      } catch (error) {
        console.error('[wecom] 人工回复发送失败:', error?.message || error)
      }
    }
  }
  return { conversation: saved, delivered }
}

function inferServiceTypeFromText(text = '', fallback = 'nail') {
  const value = String(text || '').toLowerCase()
  if (/美睫|睫毛|lash|lashes|eyelash/.test(value)) return 'lash'
  if (/美甲|指甲|甲|nail|nails|manicure/.test(value)) return 'nail'
  return fallback
}

function normalizeQuoteFlag(value) {
  const text = String(value ?? '').trim().toLowerCase()
  const compact = compactIntentText(text)
  if (!compact || ['unknown', '未知', '不确定', ''].includes(compact)) return 'unknown'
  if (['yes', 'true', '需要', '是', '要'].includes(text)) return 'yes'
  if (['no', 'false', '不需要', '否', '不要'].includes(text)) return 'no'
  if (['partial', '部分', '几根', 'some'].includes(text)) return 'partial'
  if (/不需要|不用|不要|无需|没有|没|无|不做|不卸|不延长|不修|裸甲|本甲|自然甲|原甲|短甲|false|none|not/.test(compact) || /\bno\b/.test(text)) return 'no'
  if (/需要|要|是|有|做|卸|延长|加长|断|补|修|yes|true|need/.test(compact)) return 'yes'
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
    if (input.repairNeeded === 'unknown') {
      zh.push('请问是否有断甲或需要修补？')
      en.push('Do you have any broken nails or repairs needed?')
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
    styleElements: body.styleElements && typeof body.styleElements === 'object' ? body.styleElements : {},
    extensionNeeded: normalizeQuoteFlag(body.extensionNeeded ?? body.styleElements?.extensionNeeded),
    removalNeeded: normalizeQuoteFlag(body.removalNeeded ?? body.styleElements?.removalNeeded),
    repairNeeded: normalizeQuoteFlag(body.repairNeeded ?? body.styleElements?.repairNeeded),
    charmsNeeded: normalizeQuoteFlag(body.charmsNeeded ?? body.styleElements?.charmsNeeded),
    firstLashVisit: normalizeQuoteFlag(body.firstLashVisit ?? body.styleElements?.firstLashVisit ?? body.styleElements?.quoteIntake?.firstLashVisit),
    lowerLashRequested: normalizeQuoteFlag(body.lowerLashRequested ?? body.styleElements?.lowerLashRequested ?? body.styleElements?.quoteIntake?.lowerLashRequested),
    healthCheckClear: normalizeQuoteFlag(body.healthCheckClear ?? body.styleElements?.healthCheckClear ?? body.styleElements?.quoteIntake?.healthCheckClear),
    aiReply: body.aiReply || body.reply || {}
  }
  const existingQuoteIntake = input.styleElements.quoteIntake && typeof input.styleElements.quoteIntake === 'object'
    ? input.styleElements.quoteIntake
    : {}
  input.styleElements = {
    ...input.styleElements,
    quoteIntake: {
      ...existingQuoteIntake,
      firstLashVisit: input.firstLashVisit,
      lowerLashRequested: input.lowerLashRequested,
      lashRemovalNeeded: input.styleElements?.quoteIntake?.lashRemovalNeeded ?? input.styleElements?.lashRemovalNeeded,
      healthCheckClear: input.healthCheckClear
    }
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
    firstLashVisit: normalizeQuoteFlag(styleElements?.quoteIntake?.firstLashVisit ?? styleElements?.firstLashVisit),
    lowerLashRequested: row.lower_lash_requested,
    healthCheckClear: row.health_check_clear,
    staffCanDo: row.staff_can_do === null || row.staff_can_do === undefined ? null : Boolean(row.staff_can_do),
    staffPriceCents: row.staff_price_cents,
    staffPrice: row.staff_price_cents === null || row.staff_price_cents === undefined ? null : cents(row.staff_price_cents),
    staffDurationMin: row.staff_duration_min,
    staffNotes: row.staff_notes,
    aiReply: parseJson(row.ai_reply_json),
    draftBookingId: row.draft_booking_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function getQuoteRequestById(id) {
  return serializeQuoteRequest(db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(id))
}

// 2026-08-07:本店币种。以前所有金额文案都写死 CAD,境内店(CNY)对外报价、AI 上下文全是错的。
// 取值顺序:租户 AI 事实 currency → 门店 currency → CAD(旗舰店就是 CAD,所以它的文案一字不变)。
function tenantCurrencyCode(tenantId = currentTenantId()) {
  try {
    const fact = db.prepare("SELECT value FROM tenant_kb_facts WHERE tenant_id = ? AND key = 'currency'").get(tenantId)
    if (fact?.value) return String(fact.value).trim().toUpperCase().slice(0, 6) || 'CAD'
    const store = db.prepare('SELECT currency FROM stores WHERE tenant_id = ? AND is_active = 1 ORDER BY rowid ASC LIMIT 1').get(tenantId)
    return String(store?.currency || 'CAD').trim().toUpperCase().slice(0, 6) || 'CAD'
  } catch (e) {
    return 'CAD'
  }
}

/* 2026-08-08 币种显示映射表:同一套代码,按币种查表渲染。
   CNY → 「¥358」(符号前置、无币种前缀、整数不带小数)
   CAD → 「CAD $50」/「CAD $50.00」—— 逐字维持现状,所以旗舰店对外文案零 diff。
   以后想改某个币种的展示格式,改这张表一行即可,不用翻遍全站。 */
const CURRENCY_DISPLAY = {
  CNY: { prefix: '', symbol: '¥', trimZeroDecimals: true },
  DEFAULT: { prefix: '<CODE> ', symbol: '$', trimZeroDecimals: false }
}

function currencyDisplayOf(code) {
  return CURRENCY_DISPLAY[String(code || '').toUpperCase()] || CURRENCY_DISPLAY.DEFAULT
}

/* decimals: 'auto' = 整数不带小数、有零头带两位(旧 formatCadFromCents 的行为)
             0 / 2  = 固定位数(旧 money()/cadFromCentsText 的行为)
   CNY 的 trimZeroDecimals 会把 .00 去掉,与设计图一致;CAD 不去,保持现状。 */
function formatMoneyCents(value, tenantId = currentTenantId(), decimals = 'auto') {
  const centsValue = Number(value || 0)
  if (!Number.isFinite(centsValue)) return ''
  const code = tenantCurrencyCode(tenantId)
  const fmt = currencyDisplayOf(code)
  const amount = centsValue / 100
  let text
  if (decimals === 'auto') text = Number.isInteger(amount) ? String(amount) : amount.toFixed(2)
  else text = amount.toFixed(Number(decimals) || 0)
  if (fmt.trimZeroDecimals) text = text.replace(/\.00$/, '')
  return `${fmt.prefix.replace('<CODE>', code)}${fmt.symbol}${text}`
}

function formatCadFromCents(value, tenantId = currentTenantId()) {
  const centsValue = Number(value || 0)
  if (!Number.isFinite(centsValue) || centsValue <= 0) return ''
  return formatMoneyCents(centsValue, tenantId, 'auto')
}

function quoteAssistantReplyPayload(quote, { canDo, priceCents, durationMin, notes }) {
  const priceLabel = formatCadFromCents(priceCents)
  const durationLabel = durationMin ? `${durationMin} 分钟` : '时长到店再确认'
  const draftPromptZh = canDo
    ? '如果您想继续预约，我可以接着帮您生成一个 30 分钟有效的预约草稿链接，您点进去确认时间并完成定金/免定金流程即可。'
    : '如果您愿意，也可以再发一张更接近想要效果的参考图，我会重新帮您整理给技师确认。'
  const draftPromptEn = canDo
    ? 'If you would like to book, I can create a booking draft link valid for 30 minutes. You can open it to confirm the time and complete the deposit/deposit-waiver flow.'
    : 'If you would like, you can send another reference photo closer to your desired look and I will organize it for the technician again.'
  const detailZh = [
    canDo ? '技师刚刚确认啦，这款可以做。' : '技师看过后，这款暂时需要进一步人工确认。',
    canDo && priceLabel ? `预估价格是 ${priceLabel}` : '',
    canDo ? `预计服务时长 ${durationLabel}` : '',
    notes ? `技师备注：${notes}` : '',
    '最终细节会以到店沟通和实际甲面/睫毛状态为准。',
    draftPromptZh
  ].filter(Boolean).join(' ')
  const detailEn = [
    canDo ? 'The technician has confirmed that this style can be done.' : 'The technician reviewed it and this style needs further manual confirmation.',
    canDo && priceLabel ? `Estimated price: ${priceLabel}.` : '',
    canDo ? `Estimated duration: ${durationMin ? `${durationMin} min` : 'to be confirmed in store'}.` : '',
    notes ? `Technician note: ${notes}` : '',
    'Final details are confirmed in store based on the actual nail/lash condition.',
    draftPromptEn
  ].filter(Boolean).join(' ')
  return {
    intent: 'pricing',
    answerZh: detailZh,
    answerEn: detailEn,
    handoffRequired: false,
    handoffReasonZh: '',
    handoffReasonEn: '',
    quoteRequestId: quote?.id || null,
    suggestedActions: canDo ? ['create_quote_draft'] : ['request_more_info']
  }
}

function politeStaffQuoteText(text = '') {
  const trimmed = String(text || '').trim().replace(/\s*\n+\s*/g, '；')
  if (!trimmed) return ''
  return /[。！!？?～~”"]$/.test(trimmed) ? trimmed : `${trimmed}。`
}

function normalizePolishedQuotePayload(quote, aiResult, staffMessage = '', conversationState = {}) {
  // 规则（店主要求）：AI 润色只负责把技师原话连成通顺完整的句子，
  // 不得改写、不得删减、不得替换技师的本意；技师原文必须原样包含在回复里。
  const data = aiResult?.data || aiResult || {}
  const text = String(staffMessage || '').trim()
  const cannotDo = /(做不了|不能做|不可以做|无法做|做不出|做不到|不好做|不建议做|cannot\s+do|can'?t\s+do)/i.test(text)
  const canDo = data.canDo === false ? false : (!cannotDo && !/(不能|不可|不做|无法|\bno\b|\bcannot\b|\bcan't\b|\bnot\s+available\b)/i.test(text))
  const quoteOptions = extractStaffQuoteOptions(text)
  const optionPriceTextZh = formatStaffQuoteOptions(quoteOptions, 'zh')
  const optionPriceTextEn = formatStaffQuoteOptions(quoteOptions, 'en')
  const priceCents = parseCadCentsFromText(text || data.extractedPriceCad || '') || primaryStaffQuoteOptionCents(text)
  const durationMin = parseDurationMinutesFromText(text || data.extractedDurationMin || '')
  const durationDisplay = extractDurationDisplayFromText(text)
  const priceText = optionPriceTextZh || (priceCents ? formatCadFromCents(priceCents) : '')
  const priceTextEn = optionPriceTextEn || priceText
  const slot = confirmedBookingSlotFromQuote(quote, conversationState)
  const needsTimeBeforeDraft = canDo && (!slot.date || !slot.time)
  const politeText = politeStaffQuoteText(text)
  const fallbackZh = canDo
    ? [
        `亲亲，技师看过啦：${politeText}`,
        '款式细节、饰品数量和实际甲面/睫毛状态到店前会再帮您确认一次。',
        needsTimeBeforeDraft
          ? '如您需要预约，请回复“确认预约 + 想预约的日期和时间”，我会先帮您查找空位；如果您说的时间没有空位，我会优先帮您找同日最接近的前后时间。确认好时间后，我再帮您生成预约草稿链接。'
          : `如您需要预约，请回复“确认预约”，我会按您之前提到的时间（${slot.date} ${slot.time}）帮您生成预约草稿链接；如果该时段临时没有空位，我会优先帮您找同日最接近的前后时间。`
      ].join(' ')
    : (cannotDo
        ? [
            `亲亲，非常抱歉，技师看过这款啦：${politeText}`,
            '如果您愿意，可以换一个相近风格或简单一些的款式，把参考图发给我，我马上再帮您转给技师确认哦。'
          ].join(' ')
        : [
            `亲亲，技师看过这款啦：${politeText}`,
            '麻烦您按技师提到的内容补充一下信息，或再发一张更清晰的参考图，我再帮您转给技师确认。'
          ].join(' '))
  const fallbackEn = canDo
    ? [
        `The technician has reviewed it: ${politeText}`,
        'Design details, charm quantity, and actual nail/lash condition will be confirmed again before service.',
        needsTimeBeforeDraft
          ? 'If you would like to book, please reply with "confirm booking + your preferred date and time". I will check availability first; if that time is unavailable, I will look for the closest time around it on the same day. Once the time is confirmed, I can create the booking draft link.'
          : `If you would like to book, just reply "confirm booking" and I will create the draft for the time you mentioned earlier (${slot.date} ${slot.time}); if that slot is unavailable, I will look for the closest time around it on the same day.`
      ].join(' ')
    : (cannotDo
        ? [
            `We are so sorry — the technician has reviewed this style: ${politeText}`,
            'If you would like, you can pick a similar or simpler style and send me the reference photo, and I will check with the technician again right away.'
          ].join(' ')
        : [
            `The technician has reviewed this style: ${politeText}`,
            'Please add the details the technician mentioned, or send a clearer reference photo, and I will pass it to the technician again.'
          ].join(' '))
  const safeAnswerZh = fallbackZh
  const safeAnswerEn = fallbackEn
  return {
    intent: 'pricing',
    answerZh: safeAnswerZh,
    answerEn: safeAnswerEn,
    handoffRequired: false,
    handoffReasonZh: '',
    handoffReasonEn: '',
    quoteRequestId: quote?.id || null,
    staffMessage,
    extractedPriceCad: priceText || data.extractedPriceCad || '',
    extractedDurationMin: data.extractedDurationMin || (durationMin ? String(durationMin) : ''),
    quoteOptions,
    canDo,
    suggestedActions: Array.isArray(data.suggestedActions) && data.suggestedActions.length
      ? data.suggestedActions
      : (canDo ? ['create_quote_draft'] : ['request_more_info'])
  }
}

function appendQuoteAssistantReply(quote, payload) {
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
  const textZh = [
    '第一次做美睫的小提醒：',
    '1. 如果近 3 个月做过眼部手术、近期有结膜炎/红肿/发炎/过敏，或眼部正在不舒服，请提前告诉我们，必要时先暂停服务。',
    '2. 第一次建议先选择自然或轻盈款，舒适度和适应度会更好；后续可以根据喜欢的效果再加密。',
    '3. 到店当天尽量不要画睫毛膏或浓眼妆，保持眼周清洁，方便技师更准确判断睫毛状态。',
    '4. 操作过程中如果有明显刺痛、熏眼、流泪或不舒服，请马上告诉技师，我们会及时调整。',
    '5. 做完后 6 小时内尽量避免水汽、揉眼和油性卸妆；24 小时内尽量避免桑拿、汗蒸或长时间热水蒸汽。'
  ].join('\n')
  const textEn = [
    'A quick note for your first lash appointment:',
    '1. If you had eye surgery in the past 3 months, currently have conjunctivitis, redness, inflammation, allergy, or eye discomfort, please tell us in advance. The service may need to be paused if needed.',
    '2. For the first time, we recommend a natural or lightweight style first so it feels more comfortable. We can add more volume in later appointments.',
    '3. Please avoid mascara or heavy eye makeup on the appointment day and keep the eye area clean so the technician can check your natural lashes clearly.',
    '4. If you feel stinging, strong fumes, tearing, or any discomfort during the service, please tell the technician right away so we can adjust.',
    '5. After the service, avoid steam/water, rubbing your eyes, and oil-based remover for about 6 hours. Avoid sauna, steaming, or long hot-water steam exposure for 24 hours.'
  ].join('\n')
  const content = quote.customerLang === 'en' ? textEn : textZh
  return {
    intent: 'lash_first_time_notice',
    answerZh: textZh,
    answerEn: textEn,
    quoteRequestId: quote.id || null,
    content
  }
}

function appendFirstTimeLashNoticeIfNeeded(quote = {}) {
  if (!quote?.conversationId || quote.serviceType !== 'lash' || firstLashVisitFromQuote(quote) !== 'yes') return null
  const conversation = getWecomConversation(quote.conversationId)
  const alreadySent = (conversation?.transcript || []).some((item) => item.intent === 'lash_first_time_notice' && item.quoteRequestId === quote.id)
  if (alreadySent) return null
  const payload = firstTimeLashNoticePayload(quote)
  return appendWecomConversationMessage(quote.conversationId, {
    role: 'assistant',
    content: payload.content,
    intent: 'lash_first_time_notice',
    quoteRequestId: quote.id,
    handoffRequired: false
  }, {
    status: 'ai_replied',
    lastIntent: 'lash_first_time_notice',
    lastMessage: payload.content,
    aiReply: { data: payload, source: 'first_lash_visit_notice' }
  })
}

function bookingDraftLink(draftId) {
  return `${customerAppUrl()}/?bookingDraft=${encodeURIComponent(draftId)}`
}

function appendQuoteDraftAssistantReply(quote, draft = null) {
  if (!quote?.conversationId) return null
  const link = draft?.linkUrl || bookingDraftLink(draft?.id || quote.id)
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
    aiReply: { data: { intent: 'booking', answerZh: textZh, answerEn: textEn, quoteRequestId: quote.id, bookingDraftId: draft?.id || null, draftLink: link }, source: 'quote_draft' }
  })
}

// 2026-08-07 多租户清账:这两个"随便挑一个"的兜底以前不带租户,非旗舰店会挑到旗舰店的门店/项目,
// 兜底值还写死了 store-ontario-01。现在一律限定当前租户,挑不到就返回 null 让上层报错,不许跨店。
function firstActiveStoreId() {
  return db.prepare('SELECT id FROM stores WHERE is_active = 1 AND tenant_id = ? ORDER BY name ASC LIMIT 1').get(currentTenantId())?.id || null
}

function firstActiveService(serviceType = 'nail') {
  const type = String(serviceType || 'nail').toUpperCase()
  const tid = currentTenantId()
  return db.prepare('SELECT * FROM services WHERE is_active = 1 AND tenant_id = ? AND type = ? ORDER BY sort_order ASC LIMIT 1').get(tid, type)
    || db.prepare('SELECT * FROM services WHERE is_active = 1 AND tenant_id = ? ORDER BY sort_order ASC LIMIT 1').get(tid)
}

function firstQualifiedTechnician(storeId, serviceId) {
  return db.prepare(`
    SELECT t.* FROM technicians t
    JOIN technician_services ts ON ts.technician_id = t.id
    WHERE t.store_id = ? AND t.is_active = 1 AND ts.service_id = ?
    ORDER BY t.name ASC
    LIMIT 1
  `).get(storeId, serviceId)
}

function draftSlotCandidates({ storeId, serviceId, technicianId = null, date }) {
  const availability = getAvailability({ storeId, serviceId, date, technicianId: technicianId || undefined })
  const candidates = []
  for (const group of availability.slots || []) {
    for (const slotTime of group.slots || []) {
      candidates.push({ date, time: slotTime, technicianId: group.technician.id })
    }
  }
  return candidates
}

function nearestDraftSlot(candidates = [], requestedTime = '') {
  if (!candidates.length) return null
  if (!requestedTime) return candidates[0]
  const requestedMinutes = minutesFromTime(requestedTime)
  return [...candidates].sort((a, b) => {
    const distanceA = Math.abs(minutesFromTime(a.time) - requestedMinutes)
    const distanceB = Math.abs(minutesFromTime(b.time) - requestedMinutes)
    return distanceA - distanceB
  })[0]
}

function firstFutureDraftSlot({ storeId, serviceId, technicianId = null }) {
  const start = new Date()
  for (let offset = 1; offset <= 21; offset += 1) {
    const candidate = new Date(start.getTime())
    candidate.setDate(start.getDate() + offset)
    const candidateDate = candidate.toISOString().slice(0, 10)
    const slot = draftSlotCandidates({ storeId, serviceId, technicianId, date: candidateDate })[0]
    if (slot) return slot
  }
  return null
}

function nextBookingDraftSlot({ storeId, serviceId, technicianId = null, date = '', time = '' }) {
  if (date && time) {
    const sameDayCandidates = draftSlotCandidates({ storeId, serviceId, technicianId, date })
    const exact = sameDayCandidates.find((candidate) => candidate.time === time && (!technicianId || candidate.technicianId === technicianId))
    if (exact) return exact
    const nearestSameDay = nearestDraftSlot(sameDayCandidates, time)
    if (nearestSameDay) {
      throw apiError(
        409,
        'REQUESTED_DRAFT_SLOT_UNAVAILABLE',
        `Requested draft time ${date} ${time} is unavailable. Nearest available on this date is ${nearestSameDay.time}.`,
        {
          requestedDate: date,
          requestedTime: time,
          nearestDate: nearestSameDay.date || date,
          nearestTime: nearestSameDay.time,
          reason: 'same_day_nearest'
        }
      )
    }
    const futureSlot = firstFutureDraftSlot({ storeId, serviceId, technicianId })
    if (futureSlot) {
      throw apiError(
        409,
        'REQUESTED_DRAFT_DATE_UNAVAILABLE',
        `No slot is available on ${date}. Nearest available draft slot is ${futureSlot.date} ${futureSlot.time}.`,
        {
          requestedDate: date,
          requestedTime: time,
          nearestDate: futureSlot.date,
          nearestTime: futureSlot.time,
          reason: 'future_nearest'
        }
      )
    }
    throw apiError(409, 'NO_AVAILABLE_DRAFT_SLOT', 'No available draft slot was found in the next 21 days.', {
      requestedDate: date,
      requestedTime: time,
      reason: 'no_available_slot'
    })
  }
  if (date) {
    const sameDaySlot = draftSlotCandidates({ storeId, serviceId, technicianId, date })[0]
    if (sameDaySlot) return sameDaySlot
    const futureSlot = firstFutureDraftSlot({ storeId, serviceId, technicianId })
    if (futureSlot) return futureSlot
    throw apiError(409, 'NO_AVAILABLE_DRAFT_SLOT', 'No available draft slot was found in the next 21 days.')
  }
  const futureSlot = firstFutureDraftSlot({ storeId, serviceId, technicianId })
  if (futureSlot) return futureSlot
  throw apiError(409, 'NO_AVAILABLE_DRAFT_SLOT', 'No available draft slot was found in the next 21 days.')
}

function serializeBookingDraft(row, lang = 'zh') {
  if (!row) return null
  const service = getService(row.service_id)
  const technician = db.prepare('SELECT * FROM technicians WHERE id = ?').get(row.technician_id)
  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(row.store_id)
  return {
    id: row.id,
    quoteRequestId: row.quote_request_id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    sourceChannel: row.source_channel,
    serviceId: row.service_id,
    technicianId: row.technician_id,
    storeId: row.store_id,
    date: row.date,
    time: row.time,
    addOns: parseJson(row.addons_json),
    referenceImages: parseJson(row.reference_images_json),
    notes: row.notes || '',
    status: row.status,
    bookingId: row.booking_id,
    linkUrl: row.link_url || bookingDraftLink(row.id),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    service: service ? serializeService(service, lang) : null,
    technician,
    store
  }
}

function getBookingDraftById(id, lang = 'zh') {
  return serializeBookingDraft(db.prepare('SELECT * FROM booking_drafts WHERE id = ?').get(id), lang)
}

function createBookingDraft(body = {}, admin = {}) {
  const quoteRow = body.quoteRequestId || body.quote_request_id
    ? db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(body.quoteRequestId || body.quote_request_id)
    : null
  if (quoteRow) assertStaffCanAccessQuote(admin, quoteRow)
  const quote = quoteRow ? serializeQuoteRequest(quoteRow) : null
  const requestedConversationId = quote?.conversationId || body.conversationId || body.conversation_id || null
  const conversationId = requestedConversationId && db.prepare('SELECT id FROM wechat_conversations WHERE id = ?').get(requestedConversationId)
    ? requestedConversationId
    : null
  const service = body.serviceId || body.service_id
    ? getService(body.serviceId || body.service_id)
    : firstActiveService(quote?.serviceType || body.serviceType || 'nail')
  if (!service) throw apiError(404, 'SERVICE_NOT_FOUND', 'No active service is available for the booking draft.')
  const storeId = body.storeId || body.store_id || firstActiveStoreId()
  const requestedTechnicianId = body.technicianId || body.technician_id || quote?.technicianId || null
  const slot = nextBookingDraftSlot({
    storeId,
    serviceId: service.id,
    technicianId: requestedTechnicianId,
    date: body.date || '',
    time: body.time || ''
  })
  const technician = db.prepare('SELECT * FROM technicians WHERE id = ?').get(slot.technicianId) || firstQualifiedTechnician(storeId, service.id)
  if (!technician) throw apiError(404, 'TECHNICIAN_NOT_FOUND', 'No qualified technician is available for this service.')
  const now = iso(new Date())
  const expiresAt = iso(addMinutes(new Date(), HOLD_MINUTES))
  const draftId = body.id || randomId('draft')
  const referenceImages = mergeReferenceImages(
    body.referenceImages || body.images || [],
    quote?.referenceImages || []
  )
  const notes = String(body.notes || body.staffNotes || quote?.staffNotes || quote?.customerMessage || '').trim()
  const linkUrl = bookingDraftLink(draftId)
  db.prepare(`
    INSERT INTO booking_drafts
      (id, quote_request_id, conversation_id, user_id, source_channel, service_id, technician_id, store_id, date, time,
       addons_json, reference_images_json, notes, status, booking_id, link_url, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', NULL, ?, ?, ?, ?)
  `).run(
    draftId,
    quote?.id || body.quoteRequestId || null,
    conversationId,
    quote?.userId || body.userId || null,
    body.sourceChannel || quote?.sourceChannel || 'admin_booking_draft',
    service.id,
    technician.id,
    storeId,
    slot.date,
    slot.time,
    JSON.stringify(Array.isArray(body.addOns) ? body.addOns : []),
    JSON.stringify(referenceImages),
    notes,
    linkUrl,
    expiresAt,
    now,
    now
  )
  const draft = getBookingDraftById(draftId)
  if (quote?.id) {
    db.prepare("UPDATE quote_requests SET status = 'DRAFT_CREATED', expires_at = ?, updated_at = ? WHERE id = ?")
      .run(expiresAt, now, quote.id)
  }
  return draft
}

function scheduleReminderTask({ userId = null, bookingId = null, quoteRequestId = null, conversationId = null, type, channel = 'mock', scheduledAt, payload = {} }) {
  const id = randomId('reminder')
  const now = iso(new Date())
  db.prepare(`
    INSERT INTO reminder_tasks (id, user_id, booking_id, quote_request_id, conversation_id, type, channel, status, scheduled_at, payload_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)
  `).run(id, userId, bookingId, quoteRequestId, conversationId, type, channel, iso(scheduledAt || new Date()), JSON.stringify(payload), now, now)
  return id
}

function createQuoteRequest(body = {}, customer = null) {
  const input = normalizeQuoteRequestInput(body, customer)
  const now = iso(new Date())
  db.prepare(`
    INSERT INTO quote_requests
      (id, conversation_id, user_id, source_channel, service_type, service_id, technician_id, status, customer_message, customer_lang,
       reference_images_json, style_elements_json, missing_questions_json, extension_needed, removal_needed, repair_needed, charms_needed,
       lower_lash_requested, health_check_clear, ai_reply_json, created_at, updated_at)
    VALUES
      (?, ?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
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
    JSON.stringify(input.aiReply),
    now,
    now
  )
  scheduleReminderTask({
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

function upsertActiveQuoteRequest(body = {}, customer = null) {
  const input = normalizeQuoteRequestInput(body, customer)
  if (!input.conversationId) return createQuoteRequest(body, customer)
  const existing = db.prepare(`
    SELECT * FROM quote_requests
    WHERE conversation_id = ? AND status IN ('PENDING_STAFF', 'NEEDS_INFO')
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(input.conversationId)
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
  const now = iso(new Date())
  db.prepare(`
    UPDATE quote_requests
    SET source_channel = COALESCE(NULLIF(?, ''), source_channel),
        service_type = ?,
        service_id = COALESCE(?, service_id),
        technician_id = COALESCE(?, technician_id),
        status = 'PENDING_STAFF',
        customer_message = ?,
        customer_lang = ?,
        reference_images_json = ?,
        style_elements_json = ?,
        missing_questions_json = ?,
        extension_needed = ?,
        removal_needed = ?,
        repair_needed = ?,
        charms_needed = ?,
        lower_lash_requested = ?,
        health_check_clear = ?,
        ai_reply_json = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
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
    now,
    existing.id
  )
  return getQuoteRequestById(existing.id)
}

function assertStaffCanAccessQuote(admin, quote) {
  // 多租户:只能访问本店的报价请求
  if (quote.tenant_id && quote.tenant_id !== currentTenantId()) {
    throw apiError(404, 'NOT_FOUND', 'Quote request not found.')
  }
  if (admin.role === 'staff' && quote.technician_id && quote.technician_id !== admin.technicianId) {
    throw apiError(403, 'FORBIDDEN', 'Staff can only access quote requests assigned to them.')
  }
}

function getAdminQuoteRequests(admin) {
  const rows = admin.role === 'staff'
    ? db.prepare('SELECT * FROM quote_requests WHERE tenant_id = ? AND (technician_id = ? OR technician_id IS NULL) ORDER BY updated_at DESC').all(currentTenantId(), admin.technicianId)
    : db.prepare('SELECT * FROM quote_requests WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT 120').all(currentTenantId())
  return rows.map(serializeQuoteRequest)
}

async function respondQuoteRequest(id, body, admin) {
  const current = db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(id)
  if (!current) throw apiError(404, 'NOT_FOUND', 'Quote request not found.')
  assertStaffCanAccessQuote(admin, current)
  const staffMessage = String(body.staffMessage || body.message || body.notes || body.staffNotes || '').trim()
  if (!staffMessage) throw apiError(400, 'STAFF_MESSAGE_REQUIRED', 'Technician reply message is required.')
  const quoteSnapshot = serializeQuoteRequest(current)
  // 未开通 AI 智能包:技师的报价照常发出去,只是不经过 AI 润色(原文直发),不能因为没买 AI 就回不了顾客。
  if (hasAi()) countAiUsage()
  const polished = hasAi()
    ? await polishStaffQuoteReply({ lang: quoteSnapshot.customerLang || 'zh', quote: quoteSnapshot, staffMessage })
    : null
  const conversationStateForSlot = quoteSnapshot.conversationId
    ? (getConversationState(quoteSnapshot.conversationId)?.state || {})
    : {}
  const aiReply = normalizePolishedQuotePayload(quoteSnapshot, polished, staffMessage, conversationStateForSlot)
  const canDo = aiReply.canDo ? 1 : 0
  const staffPriceCents = parseCadCentsFromText(staffMessage) || primaryStaffQuoteOptionCents(staffMessage) || parseCadCentsFromText(aiReply.extractedPriceCad || '')
  const staffDurationMin = Number(aiReply.extractedDurationMin || 0) || parseDurationMinutesFromText(staffMessage) || null
  db.prepare(`
    UPDATE quote_requests
    SET status = ?, technician_id = COALESCE(?, technician_id), staff_can_do = ?, staff_price_cents = ?,
        staff_duration_min = ?, staff_notes = ?, ai_reply_json = ?, updated_at = ?
    WHERE id = ?
  `).run(canDo ? 'QUOTED' : 'DECLINED', body.technicianId || admin.technicianId || null, canDo, staffPriceCents, staffDurationMin, staffMessage, JSON.stringify(aiReply), iso(new Date()), id)
  const quote = getQuoteRequestById(id)
  let conversation = appendQuoteAssistantReply(quote, aiReply)
  const quoteReplyText = assistantReplyText({ data: aiReply }, quote?.customerLang || quoteSnapshot.customerLang || 'zh')
  let aiReplyText = quoteReplyText
  const firstLashNoticeConversation = appendFirstTimeLashNoticeIfNeeded(quote)
  if (firstLashNoticeConversation) {
    conversation = firstLashNoticeConversation
    aiReplyText = `${quoteReplyText}\n${firstTimeLashNoticePayload(quote).content}`
  }
  if (quote?.conversationId) {
    upsertConversationState(quote.conversationId, {
      quoteStage: canDo ? 'quoted' : 'declined',
      nextAction: canDo ? 'send_quote_or_create_draft' : 'request_more_info',
      intent: 'pricing_quote_returned',
      lastAssistantMessage: aiReplyText,
      lastStaffMessage: staffMessage,
      state: {
        ...(getConversationState(quote.conversationId)?.state || {}),
        quoteRequestId: quote.id,
        lastStaffReply: staffMessage,
        lastStaffReplyAt: iso(new Date()),
        staffMessage,
        quotedAt: iso(new Date()),
        quoteCanDo: Boolean(canDo),
        staffPriceCents,
        staffDurationMin,
        extractedPriceCad: aiReply.extractedPriceCad || '',
        extractedDurationMin: aiReply.extractedDurationMin || '',
        quoteOptions: aiReply.quoteOptions || []
      }
    })
  }
  return { ...quote, conversation }
}

function createQuoteDraftHold(id, body, admin) {
  const current = db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(id)
  if (!current) throw apiError(404, 'NOT_FOUND', 'Quote request not found.')
  assertStaffCanAccessQuote(admin, current)
  const quoteSnapshot = serializeQuoteRequest(current)
  const slot = confirmedBookingSlotFromQuote(quoteSnapshot, body || {})
  if (!slot.date || !slot.time) {
    throw apiError(400, 'BOOKING_TIME_REQUIRED', 'Booking draft cannot be created before the customer confirms both date and time.')
  }
  const draft = createBookingDraft({ ...body, date: slot.date, time: slot.time, quoteRequestId: id }, admin)
  const expiresAt = new Date(draft.expiresAt)
  scheduleReminderTask({
    userId: current.user_id,
    bookingId: null,
    quoteRequestId: id,
    conversationId: current.conversation_id,
    type: 'DRAFT_PAYMENT_REMINDER',
    channel: 'wechat_or_web',
    scheduledAt: addMinutes(new Date(), DRAFT_PAYMENT_REMINDER_MINUTES),
    payload: { holdMinutes: HOLD_MINUTES, reminderMinutes: DRAFT_PAYMENT_REMINDER_MINUTES }
  })
  scheduleReminderTask({
    userId: current.user_id,
    bookingId: null,
    quoteRequestId: id,
    conversationId: current.conversation_id,
    type: 'DRAFT_RELEASE',
    channel: 'system',
    scheduledAt: expiresAt,
    payload: { holdMinutes: HOLD_MINUTES }
  })
  const quote = getQuoteRequestById(id)
  const conversation = appendQuoteDraftAssistantReply(quote, draft)
  const draftReplyText = assistantReplyText(conversation?.aiReply, quote?.customerLang || 'zh')
  if (quote?.conversationId) {
    upsertConversationState(quote.conversationId, {
      quoteStage: 'draft_created',
      nextAction: 'wait_payment_or_remind',
      intent: 'booking_draft_created',
      lastAssistantMessage: draftReplyText,
      state: {
        ...(getConversationState(quote.conversationId)?.state || {}),
        quoteRequestId: quote.id,
        bookingDraftId: draft.id,
        draftLink: draft.linkUrl,
        draftCreatedAt: iso(new Date()),
        draftExpiresAt: draft.expiresAt
      }
    })
  }
  return { ...quote, bookingDraft: draft, conversation }
}

function getAdminReminderTasks(admin) {
  const rows = admin.role === 'staff'
    ? db.prepare(`
      SELECT rt.* FROM reminder_tasks rt
      LEFT JOIN quote_requests qr ON qr.id = rt.quote_request_id
      WHERE rt.tenant_id = ? AND (qr.technician_id = ? OR qr.technician_id IS NULL)
      ORDER BY rt.scheduled_at ASC
      LIMIT 160
    `).all(currentTenantId(), admin.technicianId)
    : db.prepare('SELECT * FROM reminder_tasks WHERE tenant_id = ? ORDER BY scheduled_at ASC LIMIT 160').all(currentTenantId())
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    bookingId: row.booking_id,
    quoteRequestId: row.quote_request_id,
    conversationId: row.conversation_id,
    type: row.type,
    channel: row.channel,
    status: row.status,
    scheduledAt: row.scheduled_at,
    sentAt: row.sent_at,
    payload: parseJson(row.payload_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }))
}

function markReminderTask(id, status = 'SENT') {
  const valid = ['PENDING', 'SENT', 'SKIPPED', 'FAILED'].includes(status) ? status : 'SENT'
  const sentAt = valid === 'SENT' ? iso(new Date()) : null
  db.prepare('UPDATE reminder_tasks SET status = ?, sent_at = COALESCE(?, sent_at), updated_at = ? WHERE id = ?').run(valid, sentAt, iso(new Date()), id)
  const row = db.prepare('SELECT * FROM reminder_tasks WHERE id = ?').get(id)
  if (!row) throw apiError(404, 'NOT_FOUND', 'Reminder task not found.')
  return row
}

function normalizeReferenceImages(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => typeof item === 'string' ? item : item?.url || item?.dataUrl || item?.src || '')
    .filter((item) => typeof item === 'string' && (item.startsWith('data:image/') || /^https?:\/\//.test(item)))
    .slice(0, 6)
}

function normalizeWorkImages(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => typeof item === 'string' ? item : item?.url || item?.dataUrl || item?.src || '')
    .filter((item) => typeof item === 'string' && (item.startsWith('data:image/') || /^https?:\/\//.test(item)))
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
    imageUrl: body.imageUrl ?? current.image_url ?? '/assets/images/nail-addon.jpg',
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
  const type = String(row.type || '').toLowerCase()
  const serviceCurrency = tenantCurrencyCode(row.tenant_id || currentTenantId())
  // 价格标签走币种映射表:CAD 仍是「CAD $198」逐字不变,CNY 变成「¥198」
  const serviceMoney = (c) => formatMoneyCents(c, row.tenant_id || currentTenantId(), 'auto')
  // 2026-08-08:对外显示的定金要按本店 deposit_config 算,不能只报项目表里的原始值。
  // 旗舰店是 per_service 模式 → 结果就是 row.deposit_cents,与改造前完全一致。
  const effectiveDepositCents = (() => {
    try {
      const cfg = getDepositConfig(row.tenant_id || currentTenantId())
      return depositAmountForService(row, cfg, row.tenant_id || currentTenantId())
    } catch (e) { return row.deposit_cents }
  })()
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
    deposit: cents(effectiveDepositCents),
    depositCents: effectiveDepositCents,
    durationMin: row.base_duration_min,
    process: parseJson(row.process_json),
    notice: parseJson(row.notice_json),
    requiresManualQuote: isNail,
    pricingType: isNail ? 'base_plus_quote' : 'fixed_final',
    priceLabelZh: `${isNail ? '基础价' : '固定价'} ${serviceMoney(row.price_cents)}`,
    priceLabelEn: `${isNail ? 'Base price' : 'Fixed price'} ${serviceMoney(row.price_cents)}`,
    quoteHintZh: isNail ? '详细价格请联系客服获取报价' : '加项确认后即为最终报价',
    quoteHintEn: isNail ? 'Contact us for detailed custom quote' : 'Add-ons confirmed before checkout are final',
    priceExplanationZh,
    priceExplanationEn,
    sortOrder: row.sort_order,
    isActive: Boolean(row.is_active)
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
      : `Silver Member pays ${formatMoneyCents(5000, currentTenantId(), 'auto')} deposit for each booking.`
  }
}

function userBookingStats(userId, tenantId = DEFAULT_TENANT_ID) {
  if (!userId) return { total_spent_cents: 0, visits: 0 }
  // 每店独立会员:消费/到店只算这家店(tenant)
  return db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN service_price_cents ELSE 0 END), 0) AS total_spent_cents,
      COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END), 0) AS visits
    FROM bookings
    WHERE user_id = ? AND tenant_id = ?
  `).get(userId, tenantId) || { total_spent_cents: 0, visits: 0 }
}

// 统一身份解析（留接口纪律 #4）：任何渠道身份 → 内部用户。未来微信客服/企微/网页渠道都走这两个函数。
function resolveUserByIdentity(provider, providerUserId) {
  if (!provider || !providerUserId) return null
  return db.prepare(`
    SELECT users.* FROM user_identities
    JOIN users ON users.id = user_identities.user_id
    WHERE user_identities.provider = ? AND user_identities.provider_user_id = ?
  `).get(provider, providerUserId) || null
}

function resolveUserByUnionId(unionId) {
  if (!unionId) return null
  return db.prepare(`
    SELECT users.* FROM user_identities
    JOIN users ON users.id = user_identities.user_id
    WHERE user_identities.union_id = ?
    ORDER BY user_identities.created_at ASC
  `).get(unionId) || null
}

function upsertUserIdentity({ userId, provider, providerUserId, unionId = '', email = '', phone = '' }) {
  if (!userId || !provider || !providerUserId) return
  const now = iso(new Date())
  const existing = db.prepare('SELECT id FROM user_identities WHERE provider = ? AND provider_user_id = ?').get(provider, providerUserId)
  if (existing) {
    db.prepare(`
      UPDATE user_identities
      SET user_id = ?, union_id = COALESCE(NULLIF(?, ''), union_id), email = COALESCE(NULLIF(?, ''), email),
          phone = COALESCE(NULLIF(?, ''), phone), updated_at = ?
      WHERE id = ?
    `).run(userId, unionId, email, phone, now, existing.id)
    return
  }
  db.prepare(`
    INSERT INTO user_identities (id, user_id, provider, provider_user_id, union_id, email, phone, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?)
  `).run(randomId('identity'), userId, provider, providerUserId, unionId, email, phone, now, now)
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
    depositRequired: cents(row.deposit_required_cents ?? 5000),
    depositRequiredCents: row.deposit_required_cents ?? 5000,
    depositWaived: cents(row.deposit_waived_cents ?? 0),
    depositWaivedCents: row.deposit_waived_cents ?? 0,
    depositWaiveReason: row.deposit_waive_reason || null,
    memberLevelAtBooking: row.member_level_at_booking || null,
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

function serializeUser(user, tenantId = DEFAULT_TENANT_ID) {
  if (!user) return null
  const memberCode = memberCodeForUserId(user.id)
  // 每店独立会员:消费/到店/积分/等级/储值都只算这家店(tenant)
  const stats = userBookingStats(user.id, tenantId)
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
    // 积分=消费推导+台账(兑换扣减/冲正);与积分商城余额同口径
    points: Math.floor(totalSpentCents / 100) + pointsLedgerSum(user.id, tenantId),
    couponCount: 0,
    balanceCents: storedValueBalanceCents(user.id, tenantId),
    totalSpentCents,
    visits: Number(stats.visits || 0),
    memberCode,
    referralCode: memberCode.replace('LL-', 'REF-'),
    referralUrl: `${APP_PUBLIC_URL}/?ref=${encodeURIComponent(memberCode.replace('LL-', 'REF-'))}`
  }
}

function registerEmailUser(body) {
  const email = String(body.email || '').trim().toLowerCase()
  const displayName = String(body.displayName || '').trim() || email.split('@')[0] || 'Lucky Member'
  if (!email || !email.includes('@')) throw apiError(400, 'BAD_REQUEST', 'A valid email is required.')
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  if (existing) {
    upsertUserIdentity({ userId: existing.id, provider: 'email', providerUserId: email, email })
    return serializeUser(existing)
  }
  const id = randomId('user')
  db.prepare('INSERT INTO users (id, display_name, email) VALUES (?, ?, ?)').run(id, displayName, email)
  upsertUserIdentity({ userId: id, provider: 'email', providerUserId: email, email })
  return serializeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id))
}

// 演示铺单:仅本地/演示开关下,给首次登录且无订单的顾客铺 2 完成 + 1 待到店 + 储值,
// 让会员卡(积分/消费/成长/等级/储值)与订单一致、可直接体验。生产不启用。
function seedDemoBookingsForUser(userId, tenantId = DEFAULT_TENANT_ID) {
  if (!userId) return
  const store = db.prepare('SELECT id FROM stores WHERE is_active = 1 AND tenant_id = ? LIMIT 1').get(tenantId)
  const nail = db.prepare("SELECT * FROM services WHERE is_active = 1 AND tenant_id = ? AND UPPER(type) = 'NAIL' ORDER BY sort_order ASC LIMIT 1").get(tenantId)
  const lash = db.prepare("SELECT * FROM services WHERE is_active = 1 AND tenant_id = ? AND UPPER(type) = 'LASH' ORDER BY sort_order ASC LIMIT 1").get(tenantId)
  const techs = db.prepare('SELECT id FROM technicians WHERE is_active = 1 AND tenant_id = ? ORDER BY name ASC LIMIT 2').all(tenantId)
  if (!store || !nail || !techs.length) return
  const nowIso = iso(new Date())
  let seq = 0
  const mk = (svc, techId, dayOffset, status) => {
    if (!svc) return
    try {
      seq += 1
      const start = new Date(); start.setDate(start.getDate() + dayOffset); start.setHours(14, 0, 0, 0)
      const end = new Date(start.getTime() + (svc.base_duration_min || 120) * 60000)
      const price = svc.price_cents
      const deposit = 5000
      const code = `LLD${Date.now().toString().slice(-7)}${seq}${Math.floor(Math.random() * 900 + 100)}`
      db.prepare(`INSERT INTO bookings
        (id, tenant_id, public_code, user_id, store_id, technician_id, service_id, status, appointment_start, appointment_end, addons_json, reference_images_json, notes, service_price_cents, deposit_cents, deposit_required_cents, deposit_waived_cents, final_due_cents, total_duration_min, source_channel, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', '', ?, ?, ?, 0, ?, ?, 'demo-seed', ?, ?)`)
        .run(randomId('booking'), tenantId, code, userId, store.id, techId, svc.id, status, iso(start), iso(end), price, deposit, deposit, price - deposit, svc.base_duration_min || 120, nowIso, nowIso)
    } catch (e) { /* 单条失败不影响其它 */ }
  }
  mk(nail, techs[0].id, -24, 'COMPLETED')
  mk(lash, (techs[1] || techs[0]).id, -10, 'COMPLETED')
  mk(nail, techs[0].id, 3, 'CONFIRMED')
  try { insertStoredValueTransaction({ userId, type: 'recharge', amountCents: 30000, payChannel: 'manual', note: '演示储值', createdBy: 'demo-seed', tenantId }) } catch (e) { /* 忽略 */ }
}

// 演示:给部分老顾客铺服务小记(结构化直接内置,不调 AI),让老板/员工端能看到「有小记/无小记」两态。
// 只在 ALLOW_DEMO_ADMIN_LOGIN=true 时跑;已存在任何小记则跳过(避免重复灌)。
function seedDemoServiceNotes(tenantId = DEFAULT_TENANT_ID) {
  try {
    // 取有 COMPLETED 单、且当前还没有小记的顾客,按最近完成排序,给前 3 位铺小记
    // (逐顾客判空,而非"库里有任何小记就整体跳过"——否则演示顾客先占了坑,真实老客永远铺不上,
    //  老板端/员工端就永远看不到"命名老客有小记"这一态。其余老客保持无小记,天然形成对照。)
    const rows = db.prepare(`
      SELECT b.user_id AS userId, b.id AS bookingId, b.technician_id AS techId, b.service_id AS svcId,
             (SELECT name FROM technicians WHERE id = b.technician_id) AS techName,
             (SELECT display_name FROM users WHERE id = b.user_id) AS custName,
             (SELECT name_zh FROM services WHERE id = b.service_id) AS svcName
      FROM bookings b
      WHERE b.tenant_id = ? AND b.status = 'COMPLETED' AND b.user_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM service_notes sn WHERE sn.user_id = b.user_id AND sn.tenant_id = b.tenant_id)
      GROUP BY b.user_id
      ORDER BY b.appointment_start DESC
      LIMIT 3`).all(tenantId)
    if (!rows.length) return
    const samples = [
      {
        raw: '做的日式晕染,顾客很喜欢裸粉色系,怕疼(打磨轻一点),喜欢短一点的方形。今天和闺蜜一起来的,聊到下个月生日想做点亮片款。',
        structured: {
          summary: '偏爱裸粉日式晕染、短方形;怕疼需轻磨;下月生日想试亮片。',
          styles: ['日式晕染', '裸粉色系', '短方形'],
          personality: ['温和', '话多'],
          preferences: ['短甲', '低调配色'],
          companions: ['闺蜜同行'],
          safetyFlags: ['怕疼·打磨要轻'],
          other: ['下月生日想做亮片款']
        }
      },
      {
        raw: '美睫,顾客眼睛敏感,之前用某胶水流泪过,今天换了低敏胶水没事。喜欢自然款不要太浓,睫毛比较软建议下次做加固。',
        structured: {
          summary: '美睫敏感眼,需低敏胶水;偏自然款;睫毛软,建议加固。',
          styles: ['自然款美睫'],
          personality: ['安静'],
          preferences: ['自然不浓'],
          companions: [],
          safetyFlags: ['眼睛敏感·必须低敏胶水'],
          other: ['睫毛软·下次建议加固']
        }
      },
      {
        raw: '做的猫眼款,顾客是老客了很爽快,指定我做。手偏干平时不怎么护理,提醒她加个手膜。喜欢深色系酒红、墨绿这种。',
        structured: {
          summary: '老客·指定;偏爱深色系(酒红/墨绿)猫眼;手干需护理。',
          styles: ['猫眼', '深色系', '酒红', '墨绿'],
          personality: ['爽快', '忠诚老客'],
          preferences: ['深色调'],
          companions: [],
          safetyFlags: [],
          other: ['手偏干·建议加手膜']
        }
      }
    ]
    const nowIso = iso(new Date())
    rows.forEach((r, i) => {
      const s = samples[i % samples.length]
      try {
        db.prepare(`INSERT INTO service_notes (id, tenant_id, user_id, booking_id, technician_id, technician_name, service_name, raw_text, structured_json, created_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          randomId('snote'), tenantId, r.userId, r.bookingId, r.techId,
          r.techName || '技师', r.svcName || '服务', s.raw, JSON.stringify(s.structured), 'demo-seed', nowIso)
      } catch (e) { /* 单条失败不影响其它 */ }
    })
    console.log(`[demo-seed] service_notes seeded for ${rows.length} customers`)
  } catch (e) { console.error('[demo-seed] service_notes failed:', e && e.message) }
}

async function signInWechatMiniUser(body) {
  // 演示旁路:本地/演示环境未配微信凭证时,直接以演示顾客登录当前门店,
  // 让真机/模拟器无需真实微信授权即可演示"我的/会员/发券"等需登录页。
  // 仅在 ALLOW_DEMO_ADMIN_LOGIN=true 且服务器没有微信凭证时启用;生产(配了凭证)永不走这里。
  if (process.env.ALLOW_DEMO_ADMIN_LOGIN === 'true' && body.demoLogin === true) {
    const demoTenant = validTenantId(body.tenantId)
    const demoUser = db.prepare('SELECT * FROM users WHERE id = ?').get('demo-cust-01')
      || db.prepare('SELECT * FROM users LIMIT 1').get()
    try {
      if (demoTenant === DEFAULT_TENANT_ID
        && !db.prepare('SELECT 1 FROM bookings WHERE user_id = ? AND tenant_id = ? LIMIT 1').get(demoUser.id, demoTenant)) {
        seedDemoBookingsForUser(demoUser.id, demoTenant)
      }
    } catch (e) { console.error('[demo-seed] failed:', e && e.message) }
    const serializedDemo = serializeUser(demoUser, demoTenant)
    return { user: serializedDemo, auth: miniAuthFor(serializedDemo, `demo-openid-${demoUser.id}`), mode: 'demo-mini' }
  }
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
  const identity = resolveUserByIdentity('wechat_miniprogram', data.openid)
  // unionid 跨端匹配：同一微信用户从公众号/企微等其他端已注册过时，认成同一个人而不是新建。
  const byUnionId = !identity && data.unionid ? resolveUserByUnionId(data.unionid) : null
  const existing = identity || byUnionId || db.prepare('SELECT * FROM users WHERE wechat_open_id = ?').get(data.openid)
  let user = existing
  if (!user) {
    const id = randomId('user')
    const displayName = isGenericDisplayName(incomingDisplayName, id) ? displayNameForUserId(id) : incomingDisplayName
    db.prepare('INSERT INTO users (id, display_name, phone, wechat_open_id) VALUES (?, ?, NULLIF(?, \'\'), ?)').run(id, displayName, phone, data.openid)
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
  } else {
    const nextDisplayName = isGenericDisplayName(incomingDisplayName, user.id) ? user.display_name : incomingDisplayName
    db.prepare('UPDATE users SET display_name = ?, phone = COALESCE(NULLIF(?, \'\'), phone), wechat_open_id = COALESCE(wechat_open_id, ?) WHERE id = ?').run(nextDisplayName, phone, data.openid, user.id)
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)
  }
  upsertUserIdentity({
    userId: user.id,
    provider: 'wechat_miniprogram',
    providerUserId: data.openid,
    unionId: data.unionid || '',
    phone
  })
  // 多租户:顾客登录时进的是哪家店(小程序传 tenantId);会员数据按这家店算
  const loginTenant = validTenantId(body.tenantId)
  // 演示环境:仅默认店(lucky-luxe)首登无单时铺演示数据;其它店首登保持 0,便于直观看到"每店独立会员"。生产开关关闭不启用。
  try {
    if (process.env.ALLOW_DEMO_ADMIN_LOGIN === 'true' && loginTenant === DEFAULT_TENANT_ID
      && !db.prepare('SELECT 1 FROM bookings WHERE user_id = ? AND tenant_id = ? LIMIT 1').get(user.id, loginTenant)) {
      seedDemoBookingsForUser(user.id, loginTenant)
    }
  } catch (e) { console.error('[demo-seed] failed:', e && e.message) }
  const serialized = serializeUser(user, loginTenant)
  return {
    user: serialized,
    auth: miniAuthFor(serialized, data.openid),
    mode: 'wechat-mini'
  }
}

function registerGoogleDemoUser(body) {
  const email = String(body.email || 'google.demo@luckyluxe.local').trim().toLowerCase()
  const displayName = String(body.displayName || 'Google Member').trim()
  const googleId = `demo-google-${email}`
  const existing = db.prepare('SELECT * FROM users WHERE google_id = ? OR email = ?').get(googleId, email)
  if (existing) {
    upsertUserIdentity({ userId: existing.id, provider: 'google', providerUserId: googleId, email })
    return serializeUser(existing)
  }
  const id = randomId('user')
  db.prepare('INSERT INTO users (id, display_name, email, google_id) VALUES (?, ?, ?, ?)').run(id, displayName, email, googleId)
  upsertUserIdentity({ userId: id, provider: 'google', providerUserId: googleId, email })
  return serializeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id))
}

/* ===== P0.9 按店时区(2026-08-07,审计 B-1)=====
   以前这里写死 America/Toronto,于是所有商家的「今天/本月/日期分桶」都按多伦多算。
   小婕店在中国:北京 8/8 08:00 = 多伦多 8/7 20:00,她早上看到的「今日预约」是多伦多的昨天。
   现在默认取「当前租户主门店的时区」;租户上下文之外(启动、备份)回落 APP_TIMEZONE,
   而旗舰店门店时区就是 America/Toronto —— 它的所有分桶结果逐字不变。 */
const tenantTimezoneCache = new Map()

function isValidTimeZone(tz) {
  if (!tz) return false
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz })
    return true
  } catch (e) {
    return false
  }
}

function tenantTimezone(tenantId = currentTenantId()) {
  if (tenantTimezoneCache.has(tenantId)) return tenantTimezoneCache.get(tenantId)
  let tz = APP_TIMEZONE
  try {
    const row = db.prepare('SELECT timezone FROM stores WHERE tenant_id = ? AND is_active = 1 ORDER BY rowid ASC LIMIT 1').get(tenantId)
    if (row?.timezone && isValidTimeZone(row.timezone)) tz = row.timezone
  } catch (e) { /* 建表前/异常时回落 */ }
  tenantTimezoneCache.set(tenantId, tz)
  return tz
}

// 门店时区改了要立刻生效,别等重启
function invalidateTenantTimezone(tenantId) {
  if (tenantId) tenantTimezoneCache.delete(tenantId)
  else tenantTimezoneCache.clear()
}

// 某个时刻在指定时区的 UTC 偏移(毫秒)。用它把「墙上时间」换算成真实时刻,DST 也对。
function timeZoneOffsetMs(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(date)
  const get = (type) => Number(parts.find((part) => part.type === type)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return asUtc - date.getTime()
}

function localParts(dateLike, tz = tenantTimezone()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: isValidTimeZone(tz) ? tz : APP_TIMEZONE,
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

// 本店的「今天」/「本月」——业务分桶统一走这两个
function todayOf(tenantId = currentTenantId()) {
  return localParts(new Date(), tenantTimezone(tenantId)).date
}

function monthKeyOf(tenantId = currentTenantId(), dateLike = new Date()) {
  return localParts(dateLike, tenantTimezone(tenantId)).date.slice(0, 7)
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

// 「2026-08-08 10:00」这种墙上时间要按门店时区解释,而不是按服务器进程时区。
// 旗舰店门店时区 = 进程时区,所以它的结果与改造前完全一致。
function localDateTime(date, time, tz = tenantTimezone()) {
  const zone = isValidTimeZone(tz) ? tz : APP_TIMEZONE
  const naiveUtc = new Date(`${date}T${time}:00Z`)
  const firstGuess = new Date(naiveUtc.getTime() - timeZoneOffsetMs(naiveUtc, zone))
  // DST 边界上第一次猜可能差一小时,用落点自身的偏移再校正一次
  const settled = new Date(naiveUtc.getTime() - timeZoneOffsetMs(firstGuess, zone))
  return settled
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
  if (!String(token || '').startsWith(prefix)) return ''
  return decodeURIComponent(token.slice(prefix.length)).trim().toLowerCase()
}

function base64UrlEncode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
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

function customerFromMiniToken(token) {
  if (!token || !token.startsWith('mini.')) return null
  const [, payload, signature] = token.split('.')
  if (!payload || !signature || signMiniPayload(payload) !== signature) throw apiError(401, 'UNAUTHORIZED', 'Invalid mini program session.')
  const data = base64UrlDecode(payload)
  if (!data.exp || Date.now() > Number(data.exp)) throw apiError(401, 'UNAUTHORIZED', 'Mini program session expired.')
  let user = db.prepare('SELECT * FROM users WHERE id = ? AND wechat_open_id = ?').get(data.sub, data.openid)
  // 演示登录旁路:demo-openid 无真实 openid,仅在演示开关下按用户 id 回退(生产不触发)
  if (!user && process.env.ALLOW_DEMO_ADMIN_LOGIN === 'true' && String(data.openid || '').startsWith('demo-openid-')) {
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(data.sub)
  }
  if (!user) throw apiError(401, 'UNAUTHORIZED', 'Mini program user was not found.')
  return serializeUser(user)
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
  if (!/^\d{2}:\d{2}$/.test(body.time)) throw apiError(400, 'BAD_REQUEST', '时间格式不对,应为 HH:mm(如 14:30)。')
  return {
    userId: body.userId || null,
    tenantId: body.tenantId || DEFAULT_TENANT_ID,
    storeId: body.storeId,
    serviceId: body.serviceId,
    technicianId: body.technicianId,
    date: body.date,
    time: body.time,
    addOns: Array.isArray(body.addOns) ? body.addOns : [],
    referenceImages: normalizeReferenceImages(body.referenceImages),
    sourceChannel: body.sourceChannel || body.source || body.channel || null,
    notes: body.notes || null,
    bookingDraftId: body.bookingDraftId || body.draftId || null,
    // 老板直接排单可自定义时长(30–360 分钟,30 的倍数);普通顾客预约忽略此字段
    durationMin: Number.isFinite(Number(body.durationMin)) ? Math.min(360, Math.max(30, Math.round(Number(body.durationMin) / 30) * 30)) : null
  }
}

function assertBookable(input, opts = {}) {
  const service = getService(input.serviceId)
  if (!service || !service.is_active) throw apiError(404, 'NOT_FOUND', '该服务不存在或已下架。')
  // 老板直接排单:放宽"技师-服务绑定"(老板可指派任意在岗技师),仍要求技师在职且属本店
  const technician = opts.adminDirect
    ? db.prepare('SELECT * FROM technicians t WHERE t.id = ? AND t.store_id = ? AND t.is_active = 1').get(input.technicianId, input.storeId)
    : db.prepare(`
    SELECT t.* FROM technicians t
    JOIN technician_services ts ON ts.technician_id = t.id
    WHERE t.id = ? AND t.store_id = ? AND t.is_active = 1 AND ts.service_id = ?
  `).get(input.technicianId, input.storeId, input.serviceId)
  if (!technician) throw apiError(404, 'NOT_FOUND', '该技师不在本店或不做这项服务。')

  const weekday = localDateTime(input.date, '12:00').getDay()
  const hours = db.prepare('SELECT * FROM business_hours WHERE store_id = ? AND weekday = ?').get(input.storeId, weekday)
  // 特殊日期优先于每周固定模式(节假日休息/调整时段)
  const special = specialDateFor(input.storeId, input.date)
  const closedThatDay = special ? Boolean(special.is_closed) : (!hours || Boolean(hours.is_closed))
  // 老板直接排单:放宽"闭店/技师未排班/营业时段"限制(老板当面约的客,可能留晚点/加班);仍占位、仍防时段冲突
  if (closedThatDay && !opts.adminDirect) throw apiError(400, 'BAD_REQUEST', '该日期门店休息。')
  const schedule = db.prepare('SELECT * FROM technician_schedules WHERE technician_id = ? AND date = ?').get(input.technicianId, input.date)
  if (schedule && !schedule.is_working && !opts.adminDirect) throw apiError(400, 'BAD_REQUEST', '该技师这天休息。')

  const baseOpen = (special && !special.is_closed && special.open_time) || hours?.open_time || '10:00'
  const baseClose = (special && !special.is_closed && special.close_time) || hours?.close_time || '19:00'
  const openTime = schedule?.start_time || baseOpen
  const closeTime = schedule?.end_time || baseClose
  // 老板直接排单可覆盖时长(这次多做/少做);普通预约按服务标准时长
  const durationMin = (opts.adminDirect && input.durationMin) ? input.durationMin : totalDuration(service.type, service.base_duration_min, input.addOns)
  const startMinutes = minutesFromTime(input.time)
  const endMinutes = startMinutes + durationMin
  if (!opts.adminDirect && (startMinutes < minutesFromTime(openTime) || endMinutes > minutesFromTime(closeTime))) {
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
  // 特殊日期优先于每周固定模式
  const special = specialDateFor(storeId, date)
  const closedThatDay = special ? Boolean(special.is_closed) : (!hours || Boolean(hours.is_closed))
  if (closedThatDay) return { date, durationMin, slots: [] }
  const dayOpen = (special && !special.is_closed && special.open_time) || hours?.open_time || '10:00'
  const dayClose = (special && !special.is_closed && special.close_time) || hours?.close_time || '19:00'

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
    const openTime = schedule?.start_time || dayOpen
    const closeTime = schedule?.end_time || dayClose
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

// ===== 积分:赚分=完成单消费推导($1=1分,与既有展示口径一致);余额=赚分+台账(兑换负/冲正正) =====
function earnedPoints(userId, tenantId = currentTenantId()) {
  const row = db.prepare("SELECT COALESCE(SUM(service_price_cents), 0) AS s FROM bookings WHERE user_id = ? AND tenant_id = ? AND status = 'COMPLETED'").get(userId, tenantId)
  return Math.floor((row.s || 0) / 100)
}
function pointsLedgerSum(userId, tenantId = currentTenantId()) {
  return db.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM points_transactions WHERE user_id = ? AND tenant_id = ?').get(userId, tenantId).s
}
function pointsBalance(userId, tenantId = currentTenantId()) {
  return earnedPoints(userId, tenantId) + pointsLedgerSum(userId, tenantId)
}
function serializePrize(r, couponsById) {
  const c = couponsById ? couponsById[r.coupon_id] : db.prepare('SELECT * FROM coupons WHERE id = ?').get(r.coupon_id)
  return {
    id: r.id, couponId: r.coupon_id,
    name: c ? c.name : '奖品',
    discountType: c ? c.discount_type : 'amount', amountCents: c ? c.amount_cents : 0,
    percentOff: c ? c.percent_off : 0, minSpendCents: c ? c.min_spend_cents : 0,
    costPoints: r.cost_points, stock: r.stock, perUserLimit: r.per_user_limit,
    validDays: r.valid_days || (c ? c.valid_days : 30),
    isActive: Boolean(r.is_active), redeemedQty: r.redeemed_qty
  }
}

function serializeAttendance(r) {
  if (!r) return null
  const inT = r.clock_in_at ? localParts(r.clock_in_at).time : ''
  const outT = r.clock_out_at ? localParts(r.clock_out_at).time : ''
  let workedMin = 0
  let abnormal = false
  if (r.clock_in_at && r.clock_out_at) {
    const diff = minutesFromTime(outT) - minutesFromTime(inT)
    if (diff < 0) abnormal = true // 下班早于上班(数据异常,提示老板修正)
    workedMin = Math.max(0, diff)
  }
  return {
    id: r.id, technicianId: r.technician_id, date: r.work_date,
    clockIn: inT, clockOut: outT, workedMin, abnormal,
    overtimeMin: r.overtime_min || 0,
    inVerified: Boolean(r.in_verified), adjusted: Boolean(r.adjusted_by), note: r.note || ''
  }
}

// ===== 薪资方案:序列化 / 生效方案 / 月度估算 =====
function serializeSalaryPlan(r) {
  if (!r) return null
  return {
    id: r.id, technicianId: r.technician_id || '', template: r.template,
    baseSalaryCents: r.base_salary_cents, handworkFeeCents: r.handwork_fee_cents,
    ladder: Array.isArray(parseJson2(r.ladder_json)) ? parseJson2(r.ladder_json) : [],
    flatPct: r.flat_pct, cardPct: r.card_pct, rechargePct: r.recharge_pct || 0,
    overtimeRateCents: r.overtime_rate_cents, overtimeUnitMin: r.overtime_unit_min,
    updatedAt: r.updated_at
  }
}
function effectiveSalaryPlan(techId, tid) {
  const custom = techId ? db.prepare("SELECT * FROM salary_plans WHERE tenant_id = ? AND technician_id = ?").get(tid, techId) : null
  if (custom) return { plan: serializeSalaryPlan(custom), source: 'custom' }
  const dft = db.prepare("SELECT * FROM salary_plans WHERE tenant_id = ? AND technician_id = ''").get(tid)
  return dft ? { plan: serializeSalaryPlan(dft), source: 'default' } : { plan: null, source: 'none' }
}
function computeSalaryEstimate(techId, month, tid) {
  const [y, m] = month.split('-').map(Number)
  const startIso = iso(localDateTime(`${month}-01`, '00:00'))
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  const endIso = iso(localDateTime(`${nextMonth}-01`, '00:00'))
  const agg = db.prepare(`SELECT COUNT(*) AS cnt, COALESCE(SUM(service_price_cents), 0) AS perf FROM bookings
    WHERE tenant_id = ? AND technician_id = ? AND status = 'COMPLETED' AND appointment_start >= ? AND appointment_start < ?`)
    .get(tid, techId, startIso, endIso)
  const ot = db.prepare(`SELECT COALESCE(SUM(overtime_min), 0) AS m FROM attendance_records
    WHERE tenant_id = ? AND technician_id = ? AND work_date LIKE ?`).get(tid, techId, `${month}-%`)
  const { plan, source } = effectiveSalaryPlan(techId, tid)
  const perfCents = agg.perf, orderCount = agg.cnt, overtimeMin = ot.m
  if (!plan) return { technicianId: techId, month, noPlan: true, perfCents, orderCount, overtimeMin }
  // 落档:阶梯按 minCents 升序,取业绩落入的那档;固定提点模板直接用 flatPct
  const ladder = (plan.ladder || []).slice().sort((a, b) => (a.minCents || 0) - (b.minCents || 0))
  let pct = plan.flatPct || 0, tierIndex = -1
  if (plan.template === 'base_ladder' && ladder.length) {
    ladder.forEach((t, i) => { if (perfCents >= (t.minCents || 0) && (t.maxCents == null || perfCents < t.maxCents)) { pct = t.pct || 0; tierIndex = i } })
    if (tierIndex === -1 && perfCents >= ((ladder[ladder.length - 1] || {}).minCents || 0)) { tierIndex = ladder.length - 1; pct = ladder[tierIndex].pct || 0 }
  }
  let nextTier = null
  if (plan.template === 'base_ladder' && tierIndex >= 0 && tierIndex < ladder.length - 1) {
    nextTier = { needCents: Math.max(0, (ladder[tierIndex + 1].minCents || 0) - perfCents), pct: ladder[tierIndex + 1].pct || 0 }
  }
  const commissionCents = Math.round(perfCents * pct / 100)
  const handworkCents = (plan.handworkFeeCents || 0) * orderCount
  const unit = plan.overtimeUnitMin === 60 ? 60 : 30
  const overtimeSegs = Math.floor(overtimeMin / unit)
  const overtimePayCents = overtimeSegs * (plan.overtimeRateCents || 0)
  // 充值/耗卡提成:按储值流水的归属技师(operating 时选「经手技师」)在当月汇总
  const cardUseCents = Math.abs(db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS s FROM stored_value_transactions
    WHERE tenant_id = ? AND technician_id = ? AND type = 'consume' AND created_at >= ? AND created_at < ?`).get(tid, techId, startIso, endIso).s)
  const cardCents = Math.round(cardUseCents * (plan.cardPct || 0) / 100)
  const rechargeCents = db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS s FROM stored_value_transactions
    WHERE tenant_id = ? AND technician_id = ? AND type = 'recharge' AND created_at >= ? AND created_at < ?`).get(tid, techId, startIso, endIso).s
  const rechargePayCents = Math.round(rechargeCents * (plan.rechargePct || 0) / 100)
  // 手动调整(补贴+/扣款-,锁定前可改)
  const adj = db.prepare('SELECT adjust_cents, note FROM salary_adjusts WHERE tenant_id = ? AND month = ? AND technician_id = ?').get(tid, month, techId)
  const adjustCents = adj ? adj.adjust_cents : 0
  return {
    technicianId: techId, month, planSource: source, template: plan.template,
    perfCents, orderCount, overtimeMin, overtimeSegs, overtimeUnitMin: unit,
    pct, tierIndex, nextTier,
    baseSalaryCents: plan.baseSalaryCents || 0, handworkCents, commissionCents,
    cardUseCents, cardCents, rechargeCents, rechargePayCents, overtimePayCents,
    adjustCents, adjustNote: adj ? (adj.note || '') : '',
    totalCents: (plan.baseSalaryCents || 0) + handworkCents + commissionCents + cardCents + rechargePayCents + overtimePayCents + adjustCents
  }
}

function createBooking(body, opts = {}) {
  expireOldHolds()
  const input = validateBookingInput(body)
  const { service, durationMin, start, end } = assertBookable(input, opts)
  const bookingId = randomId('booking')
  const now = iso(new Date())
  const slots = buildSlotStarts(start, durationMin)
  const addOnTotal = input.addOns.reduce((total, item) => total + Number(item.priceCents || 0), 0)
  const servicePriceCents = service.price_cents + addOnTotal
  const user = input.userId ? db.prepare('SELECT * FROM users WHERE id = ?').get(input.userId) : null
  const serializedUser = serializeUser(user, input.tenantId || DEFAULT_TENANT_ID)
  // 线上定金开关(租户级,默认开):关闭=顾客自约免定金直接确认、到店收款——给没有/不想办支付商户号的商家用
  const bookingTenantId = input.tenantId || DEFAULT_TENANT_ID
  const onlineDeposit = (() => {
    try {
      const row = db.prepare("SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = 'booking_rules'").get(bookingTenantId)
      const rules = row ? parseJson2(row.value) : {}
      return rules.onlineDeposit !== false
    } catch (e) { return true }
  })()
  /* P1.2:定金金额与减免改为按本店 deposit_config 算。默认配置 = per_service,
     旗舰店所有项目的 deposit_cents 都是 5000,所以算出来与改造前写死的 5000 完全一致。 */
  const depositConfig = getDepositConfig(bookingTenantId)
  const depositRequiredCents = onlineDeposit ? depositAmountForService(service, depositConfig, bookingTenantId) : 0
  const memberWaives = depositConfig.memberWaive === 'all'
    ? Boolean(serializedUser)
    : (depositConfig.memberWaive === 'by_tier' ? Boolean(serializedUser?.depositWaived) : false)
  const depositWaivedCents = memberWaives ? depositRequiredCents : 0
  // 上一次合规改期留下的定金保留凭据:有就直接抵掉本次定金,并核销
  const retain = (!opts.adminDirect && depositRequiredCents > 0) ? activeDepositRetain(input.userId, bookingTenantId) : null
  // 老板直接排单:一律 CONFIRMED、不走在线定金门、不设占位到期;记"未付定金"标(占位但提醒之后收)
  const directUnpaid = opts.adminDirect && !opts.depositPaid ? 1 : 0
  const retainCoverCents = retain ? Math.min(retain.amount_cents, Math.max(0, depositRequiredCents - depositWaivedCents)) : 0
  const depositCents = opts.adminDirect ? 0 : Math.max(0, depositRequiredCents - depositWaivedCents - retainCoverCents)
  const status = opts.adminDirect ? 'CONFIRMED' : (depositCents > 0 ? 'PENDING_PAYMENT' : 'CONFIRMED')
  const paymentExpiresAt = (!opts.adminDirect && depositCents > 0) ? iso(addMinutes(new Date(), HOLD_MINUTES)) : null
  const waiveReason = depositWaivedCents > 0
    ? `${serializedUser.memberLevel} member deposit waived`
    : (retainCoverCents > 0 ? '上一次合规改期保留的定金已抵扣' : null)
  const sourceChannel = opts.adminDirect ? 'owner_direct' : input.sourceChannel

  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(`
      INSERT INTO bookings
      (id, tenant_id, public_code, user_id, store_id, technician_id, service_id, status, appointment_start, appointment_end, addons_json, reference_images_json, source_channel, notes, service_price_cents, deposit_cents, deposit_required_cents, deposit_waived_cents, deposit_waive_reason, member_level_at_booking, final_due_cents, total_duration_min, payment_expires_at, direct_deposit_unpaid, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(bookingId, input.tenantId || DEFAULT_TENANT_ID, publicCode(), input.userId, input.storeId, input.technicianId, input.serviceId, status, iso(start), iso(end), JSON.stringify(input.addOns), JSON.stringify(input.referenceImages), sourceChannel, input.notes, servicePriceCents, depositCents, depositRequiredCents, depositWaivedCents, waiveReason, serializedUser?.memberLevel || null, servicePriceCents - depositCents, durationMin, paymentExpiresAt, directUnpaid, now, now)

    const slotStmt = db.prepare('INSERT INTO booking_slots (id, booking_id, technician_id, starts_at) VALUES (?, ?, ?, ?)')
    for (const slot of slots) slotStmt.run(randomId('slot'), bookingId, input.technicianId, iso(slot))

    db.prepare('INSERT INTO payments (id, booking_id, provider, status, amount_cents, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(randomId('pay'), bookingId, 'MOCK', depositCents > 0 ? 'REQUIRES_PAYMENT' : 'PAID', depositCents, tenantCurrencyCode(input.tenantId || DEFAULT_TENANT_ID), now, now)
    db.prepare('INSERT INTO booking_status_history (id, booking_id, to_status, note, created_at) VALUES (?, ?, ?, ?, ?)').run(randomId('hist'), bookingId, status, depositCents > 0 ? 'Booking hold created pending deposit payment.' : 'Booking confirmed with member deposit waiver.', now)
    if (retain && retainCoverCents > 0) consumeDepositRetain(retain.id, bookingId)
    if (input.bookingDraftId) {
      db.prepare("UPDATE booking_drafts SET status = 'BOOKING_CREATED', booking_id = ?, updated_at = ? WHERE id = ?")
        .run(bookingId, now, input.bookingDraftId)
      db.prepare("UPDATE quote_requests SET draft_booking_id = ?, updated_at = ? WHERE id IN (SELECT quote_request_id FROM booking_drafts WHERE id = ?)")
        .run(bookingId, now, input.bookingDraftId)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    if (String(error.message || '').includes('UNIQUE constraint failed')) throw apiError(409, 'SLOT_UNAVAILABLE', '该技师这个时段刚被约走了,换个时间试试。')
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
    db.prepare("UPDATE booking_drafts SET status = 'PAID', updated_at = ? WHERE booking_id = ?").run(now, bookingId)
    db.prepare("UPDATE quote_requests SET status = 'CLOSED', updated_at = ? WHERE draft_booking_id = ?").run(now, bookingId)
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
  // P1.2:扣费规则改为按本店 deposit_config 算。默认 refundable + 24h 全退 + 临期扣 50%,
  // 与改造前的 `hoursBefore >= 24 ? 0 : floor(deposit/2)` 完全等价。
  const cancelConfig = getDepositConfig(booking.tenant_id || currentTenantId())
  const cancellationFeeCents = forfeitedDepositCents(booking, cancelConfig, { noShow: Boolean(body.noShow) })
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
  const tid = currentTenantId()
  // 多租户:统计只算本店订单;非默认店只列"在本店有订单或储值"的顾客(默认店保留全量,行为不变)
  const activityFilter = tid === DEFAULT_TENANT_ID ? '' : `
    WHERE EXISTS (SELECT 1 FROM bookings x WHERE x.user_id = u.id AND x.tenant_id = '${tid.replace(/'/g, "''")}')
       OR EXISTS (SELECT 1 FROM stored_value_transactions s WHERE s.user_id = u.id AND s.tenant_id = '${tid.replace(/'/g, "''")}')`
  return db.prepare(`
    SELECT
      u.id,
      u.display_name,
      u.phone,
      u.email,
      u.tags_json,
      u.notes,
      u.birthday,
      NULL AS created_at,
      COUNT(b.id) AS visit_count,
      MAX(b.appointment_start) AS last_visit_at,
      COALESCE(SUM(CASE WHEN b.status = 'COMPLETED' THEN b.service_price_cents ELSE 0 END), 0) AS total_spent_cents,
      COALESCE(SUM(CASE WHEN b.status = 'COMPLETED' THEN 1 ELSE 0 END), 0) AS completed_count,
      MIN(CASE WHEN b.status = 'COMPLETED' THEN b.appointment_start END) AS first_visit_at,
      MAX(CASE WHEN b.status = 'COMPLETED' THEN b.appointment_start END) AS last_completed_at
    FROM users u
    LEFT JOIN bookings b ON b.user_id = u.id AND b.tenant_id = ?
    ${activityFilter}
    GROUP BY u.id
    ORDER BY LOWER(u.display_name) ASC
  `).all(tid).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    phone: row.phone,
    email: row.email,
    createdAt: row.created_at,
    visitCount: row.visit_count,
    lastVisitAt: row.last_visit_at,
    totalSpentCents: row.total_spent_cents,
    // RFM 分层用(按完成单口径)
    completedCount: row.completed_count || 0,
    firstVisitAt: row.first_visit_at || null,
    lastCompletedAt: row.last_completed_at || null,
    tags: parseJson(row.tags_json) || [],
    notes: row.notes || '',
    birthday: row.birthday || '',
    storedValueBalanceCents: storedValueBalanceCents(row.id),
    memberCode: memberCodeForUserId(row.id),
    // 等级按累计消费推导(默认阈值,以后由商家在租户配置里自定义)
    memberTier: row.total_spent_cents >= 600000 ? 'Diamond' : row.total_spent_cents >= 300000 ? 'Platinum' : row.total_spent_cents >= 100000 ? 'Gold' : 'Silver'
  }))
}

function buildCustomerServiceContext(req, lang = 'zh') {
  // 多租户:AI 上下文只含当前店的服务与门店
  const services = db.prepare('SELECT * FROM services WHERE is_active = 1 AND tenant_id = ? ORDER BY type ASC, sort_order ASC').all(currentTenantId()).map((service) => serializeService(service, lang))
  const stores = db.prepare('SELECT * FROM stores WHERE is_active = 1 AND tenant_id = ? ORDER BY name ASC').all(currentTenantId())
  let customer = null
  let bookings = []
  try {
    customer = requireCustomer(req)
    bookings = db.prepare('SELECT * FROM bookings WHERE user_id = ? ORDER BY appointment_start DESC LIMIT 8')
      .all(customer.id)
      .map((booking) => serializeBooking(booking, lang))
  } catch {
    customer = null
    bookings = []
  }
  // 免定金模式感知:仅当门店关闭线上定金时,注入一条事实,让 AI 不再引导付定金而是"确认即锁位,到店付款"。
  // 默认开=不注入任何内容,已训练的 matrix 行为零变化。
  let depositMode = null
  try {
    const row = db.prepare("SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = 'booking_rules'").get(currentTenantId())
    const rules = row ? parseJson2(row.value) : {}
    if (rules.onlineDeposit === false) {
      depositMode = lang === 'zh'
        ? '本店预约无需线上支付定金:顾客确认时段后立即锁位,费用到店支付即可。不要引导顾客付定金或发送付款链接。'
        : 'No online deposit required: the slot is locked upon confirmation; payment is collected in store. Do not ask customers to pay a deposit online.'
    }
  } catch (e) { /* 忽略 */ }
  return depositMode ? { customer, bookings, services, stores, depositMode } : { customer, bookings, services, stores }
}

// ===== 财务记账底座（阶段3A/3B）=====
// 金额带符号存储：收入为正、支出为负、冲销取反。汇总 = 直接求和，永远对得上。
// 防篡改：只追加（触发器拒绝 UPDATE/DELETE）+ 哈希链（每笔指纹咬合上一笔）。
function financeRowHash(row, prevHash) {
  const canonical = JSON.stringify([
    row.id, row.tenant_id, row.type, row.source, row.category,
    row.amount_cents, row.pay_channel, row.occurred_on,
    row.booking_id || '', row.recurring_rule_id || '', row.reversal_of || '',
    row.created_by || '', row.created_at, prevHash
  ])
  return createHash('sha256').update(canonical).digest('hex')
}

function latestFinanceHash(tenantId) {
  const row = db.prepare('SELECT row_hash FROM finance_transactions WHERE tenant_id = ? ORDER BY rowid DESC LIMIT 1').get(tenantId)
  return row?.row_hash || 'genesis'
}

function verifyFinanceLedger(tenantId = DEFAULT_TENANT_ID) {
  const rows = db.prepare('SELECT rowid, * FROM finance_transactions WHERE tenant_id = ? ORDER BY rowid ASC').all(tenantId)
  let prev = 'genesis'
  for (const row of rows) {
    if (row.prev_hash !== prev || row.row_hash !== financeRowHash(row, prev)) {
      return { valid: false, count: rows.length, firstBrokenId: row.id, firstBrokenAt: row.created_at }
    }
    prev = row.row_hash
  }
  return { valid: true, count: rows.length, firstBrokenId: null }
}

function insertFinanceTransaction({ type, source = 'manual', category, tags = '', amountCents, payChannel = 'unknown', occurredOn, note = '', bookingId = null, recurringRuleId = null, reversalOf = null, createdBy = 'system', storeId = null }) {
  const id = randomId('fin')
  const signed = type === 'expense' ? -Math.abs(amountCents) : Math.abs(amountCents)
  const tenantId = currentTenantId()
  const createdAt = iso(new Date())
  const record = {
    id,
    tenant_id: tenantId,
    type,
    source,
    category,
    amount_cents: reversalOf ? amountCents : signed,
    pay_channel: payChannel,
    occurred_on: occurredOn || localParts(new Date()).date,
    booking_id: bookingId,
    recurring_rule_id: recurringRuleId,
    reversal_of: reversalOf,
    created_by: createdBy,
    created_at: createdAt
  }
  const prevHash = latestFinanceHash(tenantId)
  const rowHash = financeRowHash(record, prevHash)
  db.prepare(`
    INSERT INTO finance_transactions
      (id, tenant_id, store_id, type, source, category, tags, amount_cents, pay_channel, occurred_on, note, booking_id, recurring_rule_id, reversal_of, created_by, created_at, prev_hash, row_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, tenantId, storeId || defaultStoreId(), type, source, category, tags, record.amount_cents, payChannel, record.occurred_on, note, bookingId, recurringRuleId, reversalOf, createdBy, createdAt, prevHash, rowHash)
  return db.prepare('SELECT * FROM finance_transactions WHERE id = ?').get(id)
}

function bookingIncomeCategory(booking) {
  const service = booking.service_id ? getService(booking.service_id) : null
  if (service?.type === 'LASH') return '服务收入-美睫'
  if (service?.type === 'NAIL') return '服务收入-美甲'
  return '服务收入-其他'
}

// 订单完成 → 自动确认收入（按订单幂等：已有未被冲销的收入则跳过）
function recordBookingIncome(booking, createdBy = 'system') {
  if (!booking?.id || !booking.service_price_cents) return null
  const existing = db.prepare(`
    SELECT t.* FROM finance_transactions t
    WHERE t.booking_id = ? AND t.source = 'booking'
      AND NOT EXISTS (SELECT 1 FROM finance_transactions r WHERE r.reversal_of = t.id)
    ORDER BY t.created_at DESC LIMIT 1
  `).get(booking.id)
  if (existing) return existing
  return insertFinanceTransaction({
    type: 'income',
    source: 'booking',
    category: bookingIncomeCategory(booking),
    tags: booking.technician_id || '',
    amountCents: booking.service_price_cents,
    payChannel: 'in_store',
    occurredOn: localParts(new Date()).date,
    note: `订单 ${booking.public_code || booking.id} 完成自动入账`,
    bookingId: booking.id,
    createdBy
  })
}

// 已入账订单被取消 → 自动红字冲销
function reverseBookingIncome(bookingId, createdBy = 'system') {
  const original = db.prepare(`
    SELECT t.* FROM finance_transactions t
    WHERE t.booking_id = ? AND t.source = 'booking'
      AND NOT EXISTS (SELECT 1 FROM finance_transactions r WHERE r.reversal_of = t.id)
    ORDER BY t.created_at DESC LIMIT 1
  `).get(bookingId)
  if (!original) return null
  return insertFinanceTransaction({
    type: original.type,
    source: 'reversal',
    category: original.category,
    tags: original.tags,
    amountCents: -original.amount_cents,
    payChannel: original.pay_channel,
    occurredOn: localParts(new Date()).date,
    note: `冲销：${original.note || original.id}`,
    bookingId,
    reversalOf: original.id,
    createdBy
  })
}

// 固定支出规则：把到期未生成的支出补齐（幂等，可反复调用）
function materializeRecurringTransactions() {
  const today = localParts(new Date()).date
  const rules = db.prepare('SELECT * FROM finance_recurring_rules WHERE tenant_id = ? AND active = 1').all(currentTenantId())
  let generated = 0
  for (const rule of rules) {
    const startFrom = rule.last_run_on || String(rule.created_at || today).slice(0, 10)
    let cursor = new Date(`${startFrom.slice(0, 7)}-01T12:00:00`)
    for (let i = 0; i < 24; i += 1) {
      const year = cursor.getFullYear()
      const month = cursor.getMonth()
      const lastDay = new Date(year, month + 1, 0).getDate()
      const day = Math.min(rule.day_of_month, lastDay)
      const occurrence = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      if (occurrence > today) break
      if (!rule.last_run_on || occurrence > rule.last_run_on) {
        insertFinanceTransaction({
          type: 'expense',
          source: 'recurring',
          category: rule.category,
          tags: rule.tags,
          amountCents: rule.amount_cents,
          payChannel: 'unknown',
          occurredOn: occurrence,
          note: `固定支出自动入账：${rule.name}`,
          recurringRuleId: rule.id,
          createdBy: 'recurring-engine'
        })
        rule.last_run_on = occurrence
        db.prepare('UPDATE finance_recurring_rules SET last_run_on = ?, updated_at = ? WHERE id = ?').run(occurrence, iso(new Date()), rule.id)
        generated += 1
      }
      cursor = new Date(year, month + 1, 1, 12)
    }
  }
  return generated
}

// ===== 目标进度与工资月结（阶段3C）=====
function cadFromCentsText(cents) {
  return formatMoneyCents(cents || 0, currentTenantId(), 2)
}

function getFinanceTargets(tenantId = DEFAULT_TENANT_ID) {
  const row = db.prepare('SELECT * FROM finance_targets WHERE tenant_id = ?').get(tenantId)
  return {
    targetMode: row?.target_mode || 'net_profit',
    monthTargetCents: row?.month_target_cents || 0,
    yearTargetCents: row?.year_target_cents ?? null,
    variableCostRate: row?.variable_cost_rate ?? 0.25,
    updatedAt: row?.updated_at || null
  }
}

function businessDaysInMonth(month) {
  const [year, monthIndex] = [Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1]
  const openWeekdays = new Set(
    db.prepare('SELECT weekday FROM business_hours WHERE store_id = ? AND is_closed = 0').all(defaultStoreId()).map((row) => row.weekday)
  )
  const lastDay = new Date(year, monthIndex + 1, 0).getDate()
  let total = 0
  let elapsed = 0
  const today = localParts(new Date()).date
  for (let day = 1; day <= lastDay; day += 1) {
    const date = new Date(year, monthIndex, day, 12)
    if (!openWeekdays.has(date.getDay())) continue
    total += 1
    const dateStr = `${month}-${String(day).padStart(2, '0')}`
    if (dateStr <= today) elapsed += 1
  }
  return { total: Math.max(total, 1), elapsed: Math.max(elapsed, 0) }
}

function monthFinanceNet(month, type = null) {
  const args = [currentTenantId(), `${month}-01`, `${month}-31`]
  let sql = 'SELECT COALESCE(SUM(amount_cents), 0) AS net FROM finance_transactions WHERE tenant_id = ? AND occurred_on >= ? AND occurred_on <= ?'
  if (type) { sql += ' AND type = ?'; args.push(type) }
  return db.prepare(sql).get(...args).net
}

function payrollDraftsForMonth(month) {
  const comps = db.prepare(`
    SELECT c.*, t.name AS tech_name FROM staff_compensation c
    JOIN technicians t ON t.id = c.technician_id
    WHERE c.tenant_id = ? AND c.active = 1
  `).all(currentTenantId())
  return comps.map((comp) => {
    const revenue = db.prepare(`
      SELECT COALESCE(SUM(service_price_cents), 0) AS revenue FROM bookings
      WHERE technician_id = ? AND status = 'COMPLETED' AND substr(appointment_start, 1, 7) = ?
    `).get(comp.technician_id, month).revenue
    const commissionCents = Math.round(revenue * comp.commission_rate)
    const marker = `payroll:${month}:${comp.technician_id}`
    const settled = db.prepare("SELECT id FROM finance_transactions WHERE tenant_id = ? AND tags = ? AND reversal_of IS NULL AND NOT EXISTS (SELECT 1 FROM finance_transactions r WHERE r.reversal_of = finance_transactions.id)").get(currentTenantId(), marker)
    return {
      technicianId: comp.technician_id,
      technicianName: comp.tech_name,
      baseSalaryCents: comp.base_salary_cents,
      commissionRate: comp.commission_rate,
      monthRevenueCents: revenue,
      commissionCents,
      totalCents: comp.base_salary_cents + commissionCents,
      settled: Boolean(settled),
      marker
    }
  })
}

function computeFinanceProgress(month) {
  const targets = getFinanceTargets(currentTenantId())
  const rate = Math.min(0.95, Math.max(0, targets.variableCostRate))
  const fixedCents = db.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS total FROM finance_recurring_rules WHERE tenant_id = ? AND active = 1').get(currentTenantId()).total
  const breakEvenRevenueCents = Math.round(fixedCents / (1 - rate))
  const monthRevenueTargetCents = targets.targetMode === 'revenue'
    ? targets.monthTargetCents
    : Math.round((fixedCents + targets.monthTargetCents) / (1 - rate))
  const revenueCents = monthFinanceNet(month, 'income')
  const expenseCents = -monthFinanceNet(month, 'expense')
  const netCents = revenueCents - expenseCents
  const pendingPayroll = payrollDraftsForMonth(month).filter((item) => !item.settled)
  const pendingPayrollCents = pendingPayroll.reduce((sum, item) => sum + item.totalCents, 0)
  const days = businessDaysInMonth(month)
  const today = localParts(new Date()).date
  const todayRevenueCents = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS net FROM finance_transactions WHERE tenant_id = ? AND type = 'income' AND occurred_on = ?").get(currentTenantId(), today).net
  const dailyTargetCents = Math.round(monthRevenueTargetCents / days.total)
  const paceProjectionCents = days.elapsed > 0 ? Math.round((revenueCents / days.elapsed) * days.total) : 0
  const isCurrentMonth = today.slice(0, 7) === month
  const year = month.slice(0, 4)
  const yearRevenueCents = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS net FROM finance_transactions WHERE tenant_id = ? AND type = 'income' AND occurred_on >= ? AND occurred_on <= ?").get(currentTenantId(), `${year}-01-01`, `${year}-12-31`).net
  const yearTargetCents = targets.yearTargetCents ?? (monthRevenueTargetCents * 12)
  const alerts = []
  if (monthRevenueTargetCents > 0) {
    const pct = revenueCents / monthRevenueTargetCents
    if (revenueCents >= breakEvenRevenueCents && breakEvenRevenueCents > 0) alerts.push({ level: 'good', code: 'break_even_crossed' })
    if (pct >= 1) alerts.push({ level: 'good', code: 'month_target_hit' })
    else if (pct >= 0.8) alerts.push({ level: 'good', code: 'month_target_80' })
    if (isCurrentMonth && days.elapsed >= 3 && paceProjectionCents < monthRevenueTargetCents) {
      alerts.push({ level: 'warn', code: 'pace_behind', shortfallCents: monthRevenueTargetCents - paceProjectionCents })
    }
  }
  if (pendingPayroll.length && isCurrentMonth) alerts.push({ level: 'info', code: 'payroll_pending', count: pendingPayroll.length })
  return {
    month,
    targets,
    fixedCents,
    breakEvenRevenueCents,
    monthRevenueTargetCents,
    dailyTargetCents,
    revenueCents,
    expenseCents,
    netCents,
    estimatedNetCents: netCents - pendingPayrollCents,
    pendingPayrollCents,
    todayRevenueCents,
    businessDays: days,
    paceProjectionCents,
    yearRevenueCents,
    yearTargetCents,
    alerts
  }
}

// ===== 财务密码门禁：进入财务数据前的第二道锁 =====
const financeSessions = new Map()

function financePasswordHash(password) {
  return createHash('sha256').update(`finance:${currentTenantId()}:${String(password)}`).digest('hex')
}

function financeLockConfigured() {
  const row = db.prepare('SELECT finance_password_hash FROM tenants WHERE id = ?').get(currentTenantId())
  return Boolean(row?.finance_password_hash)
}

function issueFinanceKey() {
  const key = randomId('finkey')
  // 多租户:钥匙绑定发放时的租户,跨店不可复用
  financeSessions.set(key, { expires: Date.now() + 12 * 60 * 60 * 1000, tenantId: currentTenantId() })
  return key
}

function requireFinanceKey(req) {
  const key = req.headers['x-finance-key'] || ''
  const session = financeSessions.get(key)
  const expires = session && (typeof session === 'object' ? session.expires : session)
  const keyTenant = session && typeof session === 'object' ? session.tenantId : null
  if (!expires || expires < Date.now() || (keyTenant && keyTenant !== currentTenantId())) {
    if (expires && expires < Date.now()) financeSessions.delete(key)
    throw apiError(403, 'FINANCE_LOCKED', 'FINANCE_LOCKED')
  }
}

// ===== 储值卡（阶段3D）：充值=负债，耗卡=确认收入 =====
function storedValueBalanceCents(userId, tenantId = currentTenantId()) {
  return db.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS balance FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ?')
    .get(tenantId, userId).balance
}

function insertStoredValueTransaction({ userId, type, amountCents, payChannel = 'unknown', note = '', createdBy = 'system', createdAt = null, tenantId = currentTenantId(), technicianId = null }) {
  const id = randomId('sv')
  const signed = type === 'recharge' ? Math.abs(amountCents) : (type === 'consume' ? -Math.abs(amountCents) : Math.round(amountCents))
  db.prepare(`
    INSERT INTO stored_value_transactions (id, tenant_id, user_id, type, amount_cents, pay_channel, note, created_by, created_at, technician_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, tenantId, userId, type, signed, payChannel, note, createdBy, createdAt || iso(new Date()), technicianId || null)
  return db.prepare('SELECT * FROM stored_value_transactions WHERE id = ?').get(id)
}

function storedValueOverview() {
  const month = localParts(new Date()).date.slice(0, 7)
  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(amount_cents), 0) AS balance,
      COALESCE(SUM(CASE WHEN type = 'recharge' AND substr(created_at, 1, 7) = ? THEN amount_cents ELSE 0 END), 0) AS month_recharge,
      COALESCE(SUM(CASE WHEN type = 'consume' AND substr(created_at, 1, 7) = ? THEN -amount_cents ELSE 0 END), 0) AS month_consume
    FROM stored_value_transactions WHERE tenant_id = ?
  `).get(month, month, currentTenantId())
  const accounts = db.prepare(`
    SELECT sv.user_id,
      COALESCE(SUM(sv.amount_cents), 0) AS balance,
      MAX(CASE WHEN sv.type = 'consume' THEN sv.created_at END) AS last_consume_at,
      MAX(sv.created_at) AS last_activity_at,
      u.display_name
    FROM stored_value_transactions sv
    LEFT JOIN users u ON u.id = sv.user_id
    WHERE sv.tenant_id = ?
    GROUP BY sv.user_id
    HAVING balance > 0
  `).all(currentTenantId())
  const now = Date.now()
  const list = accounts.map((row) => {
    const lastTouch = row.last_consume_at || row.last_activity_at
    const dormantDays = lastTouch ? Math.floor((now - new Date(lastTouch).getTime()) / 86400000) : 999
    return {
      userId: row.user_id,
      displayName: row.display_name || memberCodeForUserId(row.user_id),
      memberCode: memberCodeForUserId(row.user_id),
      balanceCents: row.balance,
      lastConsumeAt: row.last_consume_at || null,
      dormantDays
    }
  }).sort((a, b) => b.dormantDays - a.dormantDays || b.balanceCents - a.balanceCents)
  return {
    totalBalanceCents: totals.balance,
    monthRechargeCents: totals.month_recharge,
    monthConsumeCents: totals.month_consume,
    consumeRate: totals.balance + totals.month_consume > 0 ? Math.round((totals.month_consume / (totals.balance + totals.month_consume)) * 1000) / 10 : 0,
    accounts: list
  }
}

function serializeFinanceTransaction(row) {
  return {
    id: row.id,
    type: row.type,
    source: row.source,
    category: row.category,
    tags: row.tags,
    amountCents: row.amount_cents,
    payChannel: row.pay_channel,
    occurredOn: row.occurred_on,
    note: row.note,
    bookingId: row.booking_id,
    recurringRuleId: row.recurring_rule_id,
    reversalOf: row.reversal_of,
    createdBy: row.created_by,
    createdAt: row.created_at
  }
}

function getFinanceSummary(body) {
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  if (!FINANCE_PASSWORD) throw apiError(403, 'FINANCE_NOT_CONFIGURED', 'Finance password is not configured yet.')
  if (!FINANCE_EMAILS.includes(email) || password !== FINANCE_PASSWORD) throw apiError(403, 'FORBIDDEN', 'Finance login failed.')
  // 2026-08-07:这段旧版汇总以前不带租户,等于把全平台营业额算给了当前商家
  return db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN service_price_cents WHEN status = 'CONFIRMED' THEN deposit_cents ELSE 0 END), 0) AS total_revenue_cents,
      COALESCE(SUM(CASE WHEN appointment_start >= datetime('now', 'start of month') AND status = 'COMPLETED' THEN service_price_cents WHEN appointment_start >= datetime('now', 'start of month') AND status = 'CONFIRMED' THEN deposit_cents ELSE 0 END), 0) AS month_revenue_cents,
      COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) AS completed_services,
      COUNT(CASE WHEN appointment_start >= datetime('now', 'start of month') AND status = 'COMPLETED' THEN 1 END) AS month_completed_services
    FROM bookings WHERE tenant_id = ?
  `).get(currentTenantId())
}

/* ===== P0 多价位计价引擎(2026-08-06,店主定稿口径,勿改语义)=====
   四档价:list 原价 / share 分享价 / member 会员价 / course 疗程价(course 另带次数)。
   四条行业规则:
     foot_surcharge          足部加收——整单最终金额 +amountCents(各档算完后加,不分档)
     single_finger           单指价——按「该单所用价格档」的延长类主项目价 ÷10(pct) × 指数
     tip_reuse               甲片重利用——固定 amountCents,无档
   注:tip_reuse 计入小计(它是一项服务费);foot_surcharge 在小计之外整单加收。

   2026-08-08 卸甲/卸睫降维定稿:原来的 removal_free_if_in_store 规则引擎**已整体删除**。
   「本店制作免卸甲 / 免卸睫毛」改为价目表里的免收目录项(三档价均 0,item_kind='addon',
   addon_scope 只挂对应大类)—— 纯卸除单的表单自然不出现该项,「本单继续做才免」零代码实现。 */
const PRICE_TIERS = ['list', 'share', 'member', 'course']
const PRICING_RULE_KEYS = ['foot_surcharge', 'single_finger', 'tip_reuse']
const DEFAULT_PRICING_RULES = {
  foot_surcharge: { amountCents: 10000 },
  single_finger: { pct: 10 },
  tip_reuse: { amountCents: 10000 }
}
const MEMBER_QUALIFY_MODES = ['any_recharge', 'balance_gt_0', 'total_spend', 'manual']
const DEFAULT_MEMBERSHIP_CONFIG = {
  tiersEnabled: false,
  memberQualify: 'any_recharge',
  qualifyValueCents: 0,
  expireDays: null,
  tiers: []
}

function getPricingRules(tenantId = currentTenantId()) {
  const rows = db.prepare('SELECT * FROM pricing_rules WHERE tenant_id = ?').all(tenantId)
  const byKey = {}
  for (const row of rows) byKey[row.key] = row
  const out = {}
  for (const key of PRICING_RULE_KEYS) {
    const row = byKey[key]
    let config = { ...DEFAULT_PRICING_RULES[key] }
    if (row) {
      try { config = { ...config, ...JSON.parse(row.config_json || '{}') } } catch { /* 配置损坏时退回默认 */ }
    }
    out[key] = {
      key,
      // 没配过的规则默认关闭(存量商户行为零变化);配过才按 is_active 走
      isActive: row ? Boolean(row.is_active) : false,
      config,
      updatedAt: row?.updated_at || null
    }
  }
  return out
}

function putPricingRule(tenantId, key, { isActive, config }) {
  if (!PRICING_RULE_KEYS.includes(key)) throw apiError(400, 'BAD_REQUEST', `未知计价规则:${key}`)
  const merged = { ...DEFAULT_PRICING_RULES[key], ...(config && typeof config === 'object' ? config : {}) }
  db.prepare(`INSERT INTO pricing_rules (tenant_id, key, config_json, is_active, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, key) DO UPDATE SET config_json = excluded.config_json, is_active = excluded.is_active, updated_at = excluded.updated_at`)
    .run(tenantId, key, JSON.stringify(merged), isActive === false ? 0 : 1, iso(new Date()))
}

function getMembershipConfig(tenantId = currentTenantId()) {
  const row = db.prepare("SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = 'membership_config'").get(tenantId)
  let stored = {}
  if (row) {
    try { stored = JSON.parse(row.value || '{}') } catch { stored = {} }
  }
  const merged = { ...DEFAULT_MEMBERSHIP_CONFIG, ...stored }
  if (!MEMBER_QUALIFY_MODES.includes(merged.memberQualify)) merged.memberQualify = 'any_recharge'
  merged.tiersEnabled = Boolean(merged.tiersEnabled)
  merged.qualifyValueCents = Math.max(0, Math.round(Number(merged.qualifyValueCents) || 0))
  merged.expireDays = merged.expireDays === null || merged.expireDays === undefined || merged.expireDays === ''
    ? null
    : Math.max(0, Math.round(Number(merged.expireDays) || 0)) || null
  merged.tiers = Array.isArray(merged.tiers) ? merged.tiers : []
  // 等级未开启时不下发等级字段,避免前端/AI 误以为门店有等级体系
  if (!merged.tiersEnabled) delete merged.tiers
  return merged
}

function setMembershipConfig(tenantId, input = {}) {
  const current = getMembershipConfig(tenantId)
  const next = {
    tiersEnabled: input.tiersEnabled === undefined ? Boolean(current.tiersEnabled) : Boolean(input.tiersEnabled),
    memberQualify: MEMBER_QUALIFY_MODES.includes(input.memberQualify) ? input.memberQualify : current.memberQualify,
    qualifyValueCents: input.qualifyValueCents === undefined
      ? current.qualifyValueCents
      : Math.max(0, Math.round(Number(input.qualifyValueCents) || 0)),
    expireDays: input.expireDays === undefined
      ? (current.expireDays ?? null)
      : (input.expireDays === null || input.expireDays === '' ? null : Math.max(0, Math.round(Number(input.expireDays) || 0)) || null),
    tiers: Array.isArray(input.tiers) ? input.tiers.slice(0, 20) : (current.tiers || [])
  }
  db.prepare(`INSERT INTO tenant_settings (tenant_id, key, value, updated_at) VALUES (?, 'membership_config', ?, ?)
    ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(tenantId, JSON.stringify(next), iso(new Date()))
  return getMembershipConfig(tenantId)
}

// 储值余额分桶:legacy = 老平台迁移过来的期初余额(不是本店收的钱),normal = 本系统内真实充值
function storedValueBalanceDetail(userId, tenantId = currentTenantId()) {
  const row = db.prepare(`SELECT
      COALESCE(SUM(amount_cents), 0) AS total,
      COALESCE(SUM(CASE WHEN bucket = 'legacy' THEN amount_cents ELSE 0 END), 0) AS legacy
    FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ?`).get(tenantId, userId)
  const totalCents = row.total || 0
  const legacyCents = row.legacy || 0
  return { totalCents, legacyCents, normalCents: totalCents - legacyCents }
}

// 首充判定 = 该顾客从未有过任何 recharge 流水(不是「余额为 0」——清零复充不算首充)
function isFirstRecharge(userId, tenantId = currentTenantId()) {
  const row = db.prepare("SELECT 1 AS hit FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ? AND type = 'recharge' LIMIT 1")
    .get(tenantId, userId)
  return !row
}

// 顾客累计消费:本系统内完成单的实收 + 迁移带过来的历史累计(只用于会员判定,不进财务)
function customerTotalSpendCents(userId, tenantId = currentTenantId(), sinceIso = null) {
  const booked = sinceIso
    ? db.prepare("SELECT COALESCE(SUM(final_due_cents), 0) AS spent FROM bookings WHERE tenant_id = ? AND user_id = ? AND status = 'COMPLETED' AND appointment_start >= ?").get(tenantId, userId, sinceIso)
    : db.prepare("SELECT COALESCE(SUM(final_due_cents), 0) AS spent FROM bookings WHERE tenant_id = ? AND user_id = ? AND status = 'COMPLETED'").get(tenantId, userId)
  const legacy = sinceIso ? 0 : (db.prepare('SELECT legacy_total_spend_cents AS c FROM users WHERE id = ?').get(userId)?.c || 0)
  return (booked?.spent || 0) + legacy
}

// 会员判定:四种资格模式由商家在「会员与储值设置」里选
function isMemberOf(userId, tenantId = currentTenantId()) {
  if (!userId) return false
  const config = getMembershipConfig(tenantId)
  const sinceIso = config.expireDays ? iso(new Date(Date.now() - config.expireDays * 86400000)) : null
  if (config.memberQualify === 'balance_gt_0') return storedValueBalanceDetail(userId, tenantId).totalCents > 0
  if (config.memberQualify === 'total_spend') {
    return customerTotalSpendCents(userId, tenantId, sinceIso) >= config.qualifyValueCents
  }
  if (config.memberQualify === 'manual') {
    const row = db.prepare('SELECT tags_json FROM users WHERE id = ? AND tenant_id = ?').get(userId, tenantId)
    let tags = []
    try { tags = JSON.parse(row?.tags_json || '[]') } catch { tags = [] }
    return tags.some((tag) => /会员|member/i.test(String(tag)))
  }
  // any_recharge:充过值就是会员。迁移期初(migrate_opening)本质是老店的充值,同样算数。
  const sql = sinceIso
    ? "SELECT 1 AS hit FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ? AND type IN ('recharge', 'migrate_opening') AND created_at >= ? LIMIT 1"
    : "SELECT 1 AS hit FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ? AND type IN ('recharge', 'migrate_opening') LIMIT 1"
  const row = sinceIso ? db.prepare(sql).get(tenantId, userId, sinceIso) : db.prepare(sql).get(tenantId, userId)
  return Boolean(row)
}

function pricingCategories(tenantId = currentTenantId()) {
  return db.prepare('SELECT * FROM service_categories WHERE tenant_id = ? ORDER BY sort_order ASC, rowid ASC').all(tenantId)
}

// 单个项目的某档价格:缺档回落 list 档,再回落 services.price_cents(老数据零配置也能报价)
function servicePriceCents(service, tierKey = 'list') {
  if (!service) return { priceCents: 0, courseTimes: null, tierUsed: tierKey, fallback: true }
  const pick = (tier) => db.prepare('SELECT * FROM service_prices WHERE service_id = ? AND tier_key = ?').get(service.id, tier)
  const row = pick(tierKey) || (tierKey === 'list' ? null : pick('list'))
  if (row) return { priceCents: row.price_cents || 0, courseTimes: row.course_times || null, tierUsed: row.tier_key, fallback: row.tier_key !== tierKey }
  return { priceCents: service.price_cents || 0, courseTimes: null, tierUsed: 'list', fallback: true }
}

function servicePriceMap(serviceId) {
  const out = {}
  for (const row of db.prepare('SELECT * FROM service_prices WHERE service_id = ?').all(serviceId)) {
    out[row.tier_key] = { priceCents: row.price_cents || 0, courseTimes: row.course_times || null }
  }
  return out
}

/* 纯函数计价:入参 { tenantId, serviceId, tierKey, addons:[{serviceId, qty, fingers}], applyFootSurcharge,
   applyTipReuse, userId } → { lines, subtotalCents, rulesApplied, totalCents } */
function quotePrice(input = {}) {
  const tenantId = input.tenantId || currentTenantId()
  const tierKey = PRICE_TIERS.includes(input.tierKey) ? input.tierKey : 'list'
  const rules = getPricingRules(tenantId)
  const categoryById = {}
  for (const cat of pricingCategories(tenantId)) categoryById[cat.id] = cat
  const getSvc = (id) => db.prepare('SELECT * FROM services WHERE id = ? AND tenant_id = ?').get(id, tenantId)

  const main = input.serviceId ? getSvc(input.serviceId) : null
  if (input.serviceId && !main) throw apiError(404, 'NOT_FOUND', '本店没有这个项目(或不属于当前门店)。')
  const mainPrice = main ? servicePriceCents(main, tierKey) : { priceCents: 0, courseTimes: null }

  const userId = input.userId || ''
  const hasStoreHistory = Boolean(userId && db.prepare("SELECT 1 AS hit FROM bookings WHERE tenant_id = ? AND user_id = ? AND status = 'COMPLETED' LIMIT 1").get(tenantId, userId))

  const lines = []
  const rulesApplied = []
  const noteRule = (key, amountCents, label) => {
    if (!rulesApplied.some((item) => item.key === key)) rulesApplied.push({ key, label, amountCents })
  }

  const pushItemLine = (service, { kind, qty, fingers, unitCents, note }) => {
    const count = fingers || qty || 1
    const amountCents = unitCents * count
    // 免收项就是「价目表里价格为 0 的目录项」,不再有任何规则判定
    const freeReason = amountCents === 0 ? 'catalog_free' : null
    lines.push({
      kind,
      serviceId: service.id,
      name: service.name_zh,
      nameEn: service.name_en || '',
      unit: service.unit || 'once',
      qty: service.unit === 'per_finger' ? 1 : count,
      fingers: service.unit === 'per_finger' ? count : 0,
      unitCents,
      amountCents,
      isFree: amountCents === 0,
      freeReason,
      note: note || ''
    })
  }

  if (main) {
    pushItemLine(main, { kind: 'main', qty: 1, unitCents: mainPrice.priceCents })
  }

  for (const raw of Array.isArray(input.addons) ? input.addons : []) {
    const svc = getSvc(raw && raw.serviceId)
    if (!svc) throw apiError(404, 'NOT_FOUND', '本店没有这个加项(或不属于当前门店)。')
    const unit = svc.unit || 'once'
    if (unit === 'per_finger') {
      const fingers = Math.max(1, Math.round(Number(raw.fingers ?? raw.qty ?? 1) || 1))
      let unitCents = servicePriceCents(svc, tierKey).priceCents
      let note = ''
      // 单指价按比例挂靠主项目(延长类)时:单指价 = 主项目该档价 × pct%(默认 10%,即 ÷10)
      if (svc.price_rule === 'pct_of_tier_price' && rules.single_finger.isActive) {
        const pct = Number(svc.price_rule_value) > 0 ? Number(svc.price_rule_value) : Number(rules.single_finger.config.pct || 10)
        unitCents = Math.round(mainPrice.priceCents * pct / 100)
        note = `按主项目${tierKey}档价 ${pct}%/指`
        noteRule('single_finger', unitCents * fingers, '单指计费')
      }
      pushItemLine(svc, { kind: 'addon', fingers, unitCents, note })
    } else {
      const qty = Math.max(1, Math.round(Number(raw.qty ?? 1) || 1))
      pushItemLine(svc, { kind: 'addon', qty, unitCents: servicePriceCents(svc, tierKey).priceCents })
    }
  }

  // 甲片重利用:固定金额,不分档
  if ((input.applyTipReuse || input.tipReuse) && rules.tip_reuse.isActive) {
    const amountCents = Math.max(0, Math.round(Number(rules.tip_reuse.config.amountCents ?? 10000)))
    lines.push({ kind: 'rule', serviceId: null, name: '甲片重利用', nameEn: 'Tip reuse', unit: 'once', qty: 1, fingers: 0, unitCents: amountCents, amountCents, isRemoval: false, freeReason: null, note: '固定价,不分档' })
    noteRule('tip_reuse', amountCents, '甲片重利用')
  }

  const subtotalCents = lines.reduce((sum, line) => sum + line.amountCents, 0)
  let totalCents = subtotalCents
  // 足部加收:整单最终 +amountCents(各档算完后加,任何价格档都一样加)
  if (input.applyFootSurcharge && rules.foot_surcharge.isActive) {
    const amountCents = Math.max(0, Math.round(Number(rules.foot_surcharge.config.amountCents ?? 10000)))
    totalCents += amountCents
    noteRule('foot_surcharge', amountCents, '足部加收')
  }
  return {
    tenantId,
    tierKey,
    courseTimes: mainPrice.courseTimes || null,
    lines,
    subtotalCents,
    rulesApplied,
    totalCents,
    hasStoreHistory
  }
}

function upsertServicePrice(tenantId, serviceId, tierKey, priceCents, courseTimes = null) {
  const cents = Math.max(0, Math.round(Number(priceCents) || 0))
  db.prepare(`INSERT INTO service_prices (id, tenant_id, service_id, tier_key, price_cents, course_times)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(service_id, tier_key) DO UPDATE SET price_cents = excluded.price_cents, course_times = excluded.course_times, tenant_id = excluded.tenant_id`)
    .run(randomId('sp'), tenantId, serviceId, tierKey, cents,
      tierKey === 'course' ? (Math.max(0, Math.round(Number(courseTimes) || 0)) || null) : null)
}

function writePricingItemPrices(tenantId, serviceId, body = {}, listCents = 0) {
  const clear = (tier) => db.prepare('DELETE FROM service_prices WHERE service_id = ? AND tier_key = ?').run(serviceId, tier)
  upsertServicePrice(tenantId, serviceId, 'list', listCents) // list 档 = services.price_cents,永远双写
  for (const [field, tier] of [['sharePriceCents', 'share'], ['memberPriceCents', 'member']]) {
    if (body[field] === undefined) continue
    if (body[field] === null || body[field] === '') clear(tier)
    else upsertServicePrice(tenantId, serviceId, tier, body[field])
  }
  if (body.coursePriceCents !== undefined) {
    if (body.coursePriceCents === null || body.coursePriceCents === '') clear('course')
    else upsertServicePrice(tenantId, serviceId, 'course', body.coursePriceCents, body.courseTimes)
  }
}

function pricingItemShape(body = {}, cur = {}, tenantId = currentTenantId()) {
  const itemKind = body.itemKind === undefined ? (cur.item_kind || 'main') : (body.itemKind === 'addon' ? 'addon' : 'main')
  const categoryId = body.categoryId === undefined ? (cur.category_id || null) : (String(body.categoryId || '').trim() || null)
  let categoryName = cur.category || '未分类'
  if (categoryId) {
    const cat = db.prepare('SELECT * FROM service_categories WHERE id = ? AND tenant_id = ?').get(categoryId, tenantId)
    if (!cat) throw apiError(400, 'BAD_REQUEST', '大类不存在或不属于本店。')
    categoryName = cat.name
  } else if (body.category !== undefined) {
    categoryName = String(body.category || '未分类')
  }
  const type = String(body.type || cur.type || 'OTHER').toUpperCase()
  let addonScope = []
  if (Array.isArray(body.addonScope)) addonScope = body.addonScope.map((item) => String(item))
  else { try { addonScope = JSON.parse(cur.addon_scope_json || '[]') } catch { addonScope = [] } }
  return {
    itemKind,
    categoryId,
    categoryName,
    unit: ['once', 'per_finger', 'per_session'].includes(body.unit) ? body.unit : (cur.unit || 'once'),
    priceRule: ['fixed', 'pct_of_tier_price'].includes(body.priceRule) ? body.priceRule : (cur.price_rule || 'fixed'),
    priceRuleValue: body.priceRuleValue === undefined ? (cur.price_rule_value || 0) : (Number(body.priceRuleValue) || 0),
    addonScope,
    type: ['NAIL', 'LASH', 'CARE', 'OTHER'].includes(type) ? type : 'OTHER'
  }
}

function serializePricingCategory(row) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    sortOrder: row.sort_order,
    isBookable: Boolean(row.is_bookable),
    note: row.note || '',
    itemCount: db.prepare('SELECT COUNT(*) AS n FROM services WHERE tenant_id = ? AND category_id = ?').get(row.tenant_id, row.id).n
  }
}

function serializePricingItem(row) {
  const prices = servicePriceMap(row.id)
  let addonScope = []
  try { addonScope = JSON.parse(row.addon_scope_json || '[]') } catch { addonScope = [] }
  return {
    id: row.id,
    nameZh: row.name_zh,
    nameEn: row.name_en || '',
    type: row.type,
    itemKind: row.item_kind || 'main',
    categoryId: row.category_id || null,
    category: row.category,
    unit: row.unit || 'once',
    priceRule: row.price_rule || 'fixed',
    priceRuleValue: row.price_rule_value || 0,
    addonScope,
    baseDurationMin: row.base_duration_min,
    depositCents: row.deposit_cents,
    sortOrder: row.sort_order,
    isActive: Boolean(row.is_active),
    priceCents: row.price_cents,
    listPriceCents: prices.list ? prices.list.priceCents : row.price_cents,
    sharePriceCents: prices.share ? prices.share.priceCents : null,
    memberPriceCents: prices.member ? prices.member.priceCents : null,
    coursePriceCents: prices.course ? prices.course.priceCents : null,
    courseTimes: prices.course ? prices.course.courseTimes : null
  }
}

function serializeRechargeTier(row) {
  let gift = {}
  try { gift = JSON.parse(row.gift_json || '{}') } catch { gift = {} }
  return {
    id: row.id,
    amountCents: row.amount_cents,
    gift,
    sortOrder: row.sort_order,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at
  }
}

/* ===== P0 顾客批量导入(平台代商家迁移老顾客与期初余额)=====
   口径:手机号是唯一主键;期初余额进 legacy 桶(是老店欠顾客的服务,不是本店的收入,永远不进财务账本);
   历史累计消费只写 users.legacy_total_spend_cents,仅用于会员资格判定。 */
function normalizeImportPhone(raw) {
  return String(raw || '').replace(/[\s\-()（）]/g, '').trim().slice(0, 30)
}

function importTenantCustomers(tenantId, body = {}) {
  const rows = Array.isArray(body.rows) ? body.rows : []
  if (!rows.length) throw apiError(400, 'BAD_REQUEST', '没有可导入的数据行。')
  if (rows.length > 5000) throw apiError(400, 'BAD_REQUEST', '单次导入上限 5000 行,请分批。')
  const dryRun = body.dryRun !== false
  const seenPhones = new Set()
  const report = { toCreate: 0, toUpdate: 0, conflicts: [], skipped: [], balanceSumCents: 0, rowCount: rows.length }
  const actions = []
  rows.forEach((raw, index) => {
    const line = index + 1
    const source = raw && typeof raw === 'object' ? raw : {}
    const name = String(source.name || source.displayName || '').trim()
    const nickname = String(source.nickname || '').trim()
    const phone = normalizeImportPhone(source.phone)
    if (!phone) {
      report.skipped.push({ line, name, reason: '缺手机号,无法去重,已跳过' })
      return
    }
    if (seenPhones.has(phone)) {
      report.skipped.push({ line, name, phone, reason: '同一文件内手机号重复,只取第一条' })
      return
    }
    seenPhones.add(phone)
    const balanceCents = Math.max(0, Math.round(Number(source.balanceCents) || 0))
    const totalSpendCents = Math.max(0, Math.round(Number(source.totalSpendCents) || 0))
    const existing = db.prepare('SELECT * FROM users WHERE tenant_id = ? AND phone = ? ORDER BY rowid ASC LIMIT 1').get(tenantId, phone)
    if (existing && name && String(existing.display_name || '').trim() && String(existing.display_name).trim() !== name) {
      report.conflicts.push({ line, phone, existingName: existing.display_name, incomingName: name, reason: '同手机号已存在但姓名不同,不自动合并,请人工确认' })
      return
    }
    report.balanceSumCents += balanceCents
    if (existing) report.toUpdate += 1
    else report.toCreate += 1
    actions.push({ mode: existing ? 'update' : 'create', userId: existing?.id || null, name, nickname, phone, balanceCents, totalSpendCents, source })
  })
  if (dryRun) return { dryRun: true, tenantId, ...report }
  // 执行前的最后一道闸:平台端必须把试跑报告里的期初余额总额原样回传,数额对不上直接拒绝
  if (body.confirmBalanceCents !== undefined && Math.round(Number(body.confirmBalanceCents) || 0) !== report.balanceSumCents) {
    throw apiError(400, 'BALANCE_CONFIRM_MISMATCH', `期初余额总额与试跑报告不一致(试跑 ${report.balanceSumCents} 分,确认 ${body.confirmBalanceCents} 分),请重新试跑。`)
  }
  const now = iso(new Date())
  let created = 0
  let updated = 0
  let openingWrittenCents = 0
  const writtenUsers = []
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const action of actions) {
      let userId = action.userId
      const tags = Array.isArray(action.source.tags)
        ? action.source.tags.map((tag) => String(tag).trim()).filter(Boolean)
        : String(action.source.tags || '').split(/[,，、|]/).map((tag) => tag.trim()).filter(Boolean)
      const noteParts = [String(action.source.note || '').trim()]
      if (action.nickname && action.nickname !== action.name) noteParts.push(`昵称:${action.nickname}`)
      const note = noteParts.filter(Boolean).join(' · ').slice(0, 400) || null
      const birthday = String(action.source.birthday || '').trim() || null
      if (action.mode === 'create') {
        userId = randomId('user')
        db.prepare(`INSERT INTO users (id, display_name, phone, tenant_id, tags_json, notes, birthday, is_migrated, legacy_total_spend_cents)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`).run(userId, action.name || action.nickname || action.phone, action.phone, tenantId,
          JSON.stringify(tags), note, birthday, action.totalSpendCents)
        db.prepare(`INSERT OR IGNORE INTO user_identities (id, user_id, provider, provider_user_id, phone, created_at, updated_at, tenant_id)
          VALUES (?, ?, 'phone', ?, ?, ?, ?, ?)`).run(randomId('identity'), userId, action.phone, action.phone, now, now, tenantId)
        created += 1
      } else {
        const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
        let curTags = []
        try { curTags = JSON.parse(cur.tags_json || '[]') } catch { curTags = [] }
        const mergedTags = Array.from(new Set([...curTags, ...tags]))
        db.prepare(`UPDATE users SET display_name = ?, tags_json = ?, notes = ?, birthday = ?, is_migrated = 1, legacy_total_spend_cents = ? WHERE id = ?`).run(
          String(cur.display_name || '').trim() || action.name || action.nickname || action.phone,
          JSON.stringify(mergedTags),
          note || cur.notes || null,
          birthday || cur.birthday || null,
          Math.max(cur.legacy_total_spend_cents || 0, action.totalSpendCents),
          userId)
        updated += 1
      }
      if (action.balanceCents > 0) {
        db.prepare(`INSERT INTO stored_value_transactions (id, tenant_id, user_id, type, amount_cents, pay_channel, note, created_by, created_at, bucket)
          VALUES (?, ?, ?, 'migrate_opening', ?, 'migration', ?, 'platform-import', ?, 'legacy')`).run(
          randomId('sv'), tenantId, userId, action.balanceCents,
          `老系统迁移期初余额(${action.phone})`, now)
        openingWrittenCents += action.balanceCents
      }
      writtenUsers.push({ userId, phone: action.phone, mode: action.mode, balanceCents: action.balanceCents })
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return { dryRun: false, tenantId, created, updated, openingWrittenCents, users: writtenUsers, ...report }
}

/* ===== P1.2 定金规则每店可配(2026-08-08)=====
   以前定金写死 5000 分、取消规则写死「24h 全退 / 临期扣半」,所有商家一个样。
   现在整套参数进 tenant_settings.deposit_config,**默认值与旗舰店现状完全等价**:
   per_service(旗舰店所有项目 deposit_cents 都是 5000)/ 会员按等级免 / 不抵扣 /
   24h 全退、临期扣半、爽约不退 —— 所以旗舰店上线后行为逐字不变。 */
const DEFAULT_DEPOSIT_CONFIG = {
  enabled: true,
  mode: 'per_service',            // per_service 用项目自身的 deposit_cents;fixed 固定额;pct 按项目价百分比
  fixedAmountCents: 5000,
  pct: 0,
  fallbackAmountCents: 5000,      // 替换代码里写死的 ?? 5000
  deductible: false,              // 定金是否抵扣尾款(P1 结算单定金行据此)
  memberWaive: 'by_tier',         // by_tier 按会员等级 / all 会员全免 / none 都不免
  cancelPolicy: {
    refundable: true,             // 定金是否可退
    freeCancelHours: 24,          // 可退时:提前 N 小时全退
    lateForfeitPct: 50,           // 临期取消扣多少(旗舰店现状=扣一半)
    noShowForfeitPct: 100,
    lateArrivalGraceMin: null,    // 迟到宽限(分钟);null=不启用
    rescheduleNoticeHours: 24,    // 改期需提前 N 小时
    depositRetainTimes: 0         // 合规改期时定金可保留次数
  },
  displayMode: 'auto',            // auto=参数自动生成文案 / custom=商家自定义全文
  customText: '',
  customTextEn: ''
}

const MESSAGE_TEMPLATE_SCENES = ['pre_sale', 'in_service', 'post_sale', 'booking_confirmed_invite', 'arrival_reminder', 'coupon_expiry']
const MESSAGE_TEMPLATE_SCENE_LABELS = {
  pre_sale: '售前',
  in_service: '售中',
  post_sale: '售后',
  booking_confirmed_invite: '预约成功邀请函',
  arrival_reminder: '到店提醒',
  coupon_expiry: '优惠券到期'
}
// 每店预置一套通用文案(商家可改)。变量在发送时替换,发送引擎归 P3,本批只建模+配置。
const DEFAULT_MESSAGE_TEMPLATES = [
  { scene: 'pre_sale', title: '售前咨询开场', content: '你好呀{customerName}~ 这里是{storeName}。想做什么款式呢?可以发参考图给我,我帮你看看时长和价格~', variables: ['{customerName}', '{storeName}'] },
  { scene: 'in_service', title: '服务中关怀', content: '{customerName},今天的款式做到一半啦,有哪里不舒服或者想调整的随时说哦~', variables: ['{customerName}'] },
  { scene: 'post_sale', title: '服务后回访', content: '{customerName}今天辛苦啦!新做的款式记得 24 小时内少沾水。有任何问题随时找我~', variables: ['{customerName}'] },
  { scene: 'booking_confirmed_invite', title: '预约成功邀请函', content: '{customerName}你好,你在{storeName}的预约已确认:\n时间 {bookingTime}\n地址 {storeAddress}\n期待见到你~', variables: ['{customerName}', '{storeName}', '{bookingTime}', '{storeAddress}'] },
  { scene: 'arrival_reminder', title: '到店提醒', content: '{customerName}你好,提醒一下你在{storeName}的预约是 {bookingTime},路上注意安全~', variables: ['{customerName}', '{storeName}', '{bookingTime}'] },
  { scene: 'coupon_expiry', title: '优惠券到期提醒', content: '{customerName}你好,你有一张优惠券即将到期({couponExpiry}),记得来用哦~', variables: ['{customerName}', '{couponExpiry}'] }
]

function serializeMessageTemplate(row) {
  let variables = []
  try { variables = JSON.parse(row.variables_json || '[]') } catch { variables = [] }
  return {
    id: row.id,
    scene: row.scene,
    sceneLabel: MESSAGE_TEMPLATE_SCENE_LABELS[row.scene] || row.scene,
    title: row.title,
    content: row.content || '',
    contentEn: row.content_en || '',
    variables,
    isActive: Boolean(row.is_active),
    sort: row.sort,
    updatedAt: row.updated_at
  }
}

// 懒预置:某租户第一次读模板列表时铺一套默认文案(只铺一次,商家改过/删过都不会被覆盖)
function ensureDefaultMessageTemplates(tenantId) {
  const seeded = db.prepare("SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = 'message_templates_seeded'").get(tenantId)
  if (seeded) return
  const now = iso(new Date())
  const stmt = db.prepare(`INSERT INTO message_templates (id, tenant_id, scene, title, content, content_en, variables_json, is_active, sort, updated_at)
    VALUES (?, ?, ?, ?, ?, '', ?, 1, ?, ?)`)
  DEFAULT_MESSAGE_TEMPLATES.forEach((tpl, index) => {
    stmt.run(randomId('tpl'), tenantId, tpl.scene, tpl.title, tpl.content, JSON.stringify(tpl.variables), index, now)
  })
  db.prepare(`INSERT INTO tenant_settings (tenant_id, key, value, updated_at) VALUES (?, 'message_templates_seeded', ?, ?)
    ON CONFLICT(tenant_id, key) DO NOTHING`).run(tenantId, JSON.stringify({ at: now }), now)
}

function getDepositConfig(tenantId = currentTenantId()) {
  const row = db.prepare("SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = 'deposit_config'").get(tenantId)
  let stored = {}
  if (row) {
    try { stored = JSON.parse(row.value || '{}') } catch { stored = {} }
  }
  const cancelPolicy = { ...DEFAULT_DEPOSIT_CONFIG.cancelPolicy, ...(stored.cancelPolicy && typeof stored.cancelPolicy === 'object' ? stored.cancelPolicy : {}) }
  const merged = { ...DEFAULT_DEPOSIT_CONFIG, ...stored, cancelPolicy }
  if (!['per_service', 'fixed', 'pct'].includes(merged.mode)) merged.mode = 'per_service'
  if (!['by_tier', 'all', 'none'].includes(merged.memberWaive)) merged.memberWaive = 'by_tier'
  if (!['auto', 'custom'].includes(merged.displayMode)) merged.displayMode = 'auto'
  merged.enabled = merged.enabled !== false
  merged.deductible = Boolean(merged.deductible)
  return merged
}

function setDepositConfig(tenantId, input = {}) {
  const current = getDepositConfig(tenantId)
  const num = (value, fallback) => (value === undefined || value === null || value === '' ? fallback : Math.max(0, Math.round(Number(value) || 0)))
  const nullableNum = (value, fallback) => (value === undefined ? fallback : (value === null || value === '' ? null : Math.max(0, Math.round(Number(value) || 0))))
  const cp = input.cancelPolicy && typeof input.cancelPolicy === 'object' ? input.cancelPolicy : {}
  const next = {
    enabled: input.enabled === undefined ? current.enabled : input.enabled !== false,
    mode: ['per_service', 'fixed', 'pct'].includes(input.mode) ? input.mode : current.mode,
    fixedAmountCents: num(input.fixedAmountCents, current.fixedAmountCents),
    pct: input.pct === undefined ? current.pct : Math.max(0, Math.min(100, Number(input.pct) || 0)),
    fallbackAmountCents: num(input.fallbackAmountCents, current.fallbackAmountCents),
    deductible: input.deductible === undefined ? current.deductible : Boolean(input.deductible),
    memberWaive: ['by_tier', 'all', 'none'].includes(input.memberWaive) ? input.memberWaive : current.memberWaive,
    cancelPolicy: {
      refundable: cp.refundable === undefined ? current.cancelPolicy.refundable : Boolean(cp.refundable),
      freeCancelHours: nullableNum(cp.freeCancelHours, current.cancelPolicy.freeCancelHours),
      lateForfeitPct: cp.lateForfeitPct === undefined ? current.cancelPolicy.lateForfeitPct : Math.max(0, Math.min(100, Number(cp.lateForfeitPct) || 0)),
      noShowForfeitPct: cp.noShowForfeitPct === undefined ? current.cancelPolicy.noShowForfeitPct : Math.max(0, Math.min(100, Number(cp.noShowForfeitPct) || 0)),
      lateArrivalGraceMin: nullableNum(cp.lateArrivalGraceMin, current.cancelPolicy.lateArrivalGraceMin),
      rescheduleNoticeHours: nullableNum(cp.rescheduleNoticeHours, current.cancelPolicy.rescheduleNoticeHours),
      depositRetainTimes: num(cp.depositRetainTimes, current.cancelPolicy.depositRetainTimes)
    },
    displayMode: ['auto', 'custom'].includes(input.displayMode) ? input.displayMode : current.displayMode,
    customText: input.customText === undefined ? current.customText : String(input.customText).slice(0, 4000),
    customTextEn: input.customTextEn === undefined ? current.customTextEn : String(input.customTextEn).slice(0, 4000)
  }
  db.prepare(`INSERT INTO tenant_settings (tenant_id, key, value, updated_at) VALUES (?, 'deposit_config', ?, ?)
    ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(tenantId, JSON.stringify(next), iso(new Date()))
  return getDepositConfig(tenantId)
}

// 线上支付通道是否已接通。没通之前任何对外文案都不许出现「在线支付定金」——
// 通道接通后把 ONLINE_PAYMENT_READY 打开,文案自动切换,不用再改代码。
const ONLINE_PAYMENT_READY = process.env.ONLINE_PAYMENT_READY === 'true'

function depositPolicyText(config, tenantId = currentTenantId(), lang = 'zh') {
  if (config.displayMode === 'custom') {
    const text = lang === 'en' ? (config.customTextEn || config.customText) : config.customText
    if (String(text || '').trim()) return String(text).trim()
  }
  const money = (cents) => formatMoneyCents(cents, tenantId, 'auto')
  const cp = config.cancelPolicy
  const zh = []
  const en = []
  if (!config.enabled) {
    zh.push('本店预约无需定金,确认时段即锁位,费用到店支付。')
    en.push('No deposit is required. Your slot is locked on confirmation and payment is collected in store.')
  } else {
    const amountZh = config.mode === 'fixed'
      ? `每次预约定金 ${money(config.fixedAmountCents)}`
      : (config.mode === 'pct' ? `定金为项目价的 ${config.pct}%` : `定金按所选项目的定金金额收取(默认 ${money(config.fallbackAmountCents)})`)
    const amountEn = config.mode === 'fixed'
      ? `A deposit of ${money(config.fixedAmountCents)} is required for each booking`
      : (config.mode === 'pct' ? `The deposit is ${config.pct}% of the service price` : `The deposit follows each service's own deposit amount (default ${money(config.fallbackAmountCents)})`)
    const payZh = ONLINE_PAYMENT_READY ? '' : '(暂通过门店确认收取,不支持在线支付)'
    zh.push(`${amountZh}${payZh}。${config.deductible ? '定金可抵扣尾款。' : '定金不抵扣尾款。'}`)
    en.push(`${amountEn}${ONLINE_PAYMENT_READY ? '' : ' (collected by the store; online payment is not available yet)'}. ${config.deductible ? 'The deposit is deducted from the final balance.' : 'The deposit is not deducted from the final balance.'}`)
    if (config.memberWaive === 'all') { zh.push('会员免定金。'); en.push('Members are exempt from the deposit.') }
    else if (config.memberWaive === 'by_tier') { zh.push('部分会员等级可免定金。'); en.push('Some member tiers are exempt from the deposit.') }
    if (!cp.refundable) { zh.push('定金一经支付不予退还。'); en.push('The deposit is non-refundable once paid.') }
    else if (cp.freeCancelHours !== null) {
      zh.push(`提前 ${cp.freeCancelHours} 小时以上取消可全额退还定金;不足 ${cp.freeCancelHours} 小时取消扣除定金的 ${cp.lateForfeitPct}%。`)
      en.push(`Cancel more than ${cp.freeCancelHours}h in advance for a full deposit refund; cancelling later forfeits ${cp.lateForfeitPct}% of the deposit.`)
    }
    if (cp.noShowForfeitPct) { zh.push(`爽约扣除定金的 ${cp.noShowForfeitPct}%。`); en.push(`No-shows forfeit ${cp.noShowForfeitPct}% of the deposit.`) }
    if (cp.lateArrivalGraceMin !== null) {
      zh.push(`迟到超过 ${cp.lateArrivalGraceMin} 分钟视为爽约,当天服务将被取消。`)
      en.push(`Arriving more than ${cp.lateArrivalGraceMin} minutes late counts as a no-show and the appointment is cancelled.`)
    }
    if (cp.rescheduleNoticeHours !== null) {
      zh.push(`改期需提前 ${cp.rescheduleNoticeHours} 小时告知${cp.depositRetainTimes > 0 ? `,合规改期定金可保留 ${cp.depositRetainTimes} 次` : ''}。`)
      en.push(`Rescheduling requires ${cp.rescheduleNoticeHours}h notice${cp.depositRetainTimes > 0 ? `; a compliant reschedule keeps the deposit up to ${cp.depositRetainTimes} time(s)` : ''}.`)
    }
  }
  return (lang === 'en' ? en : zh).join('')
}

/* 定金三要点小卡(迟到宽限 / 改期时限 / 定金保留)。
   后台屏 4 的预览、顾客预约页屏 3 用的是同一份 —— 措辞在这里定一次,
   两端各自拼一版迟早会对不上。参数没配就给「—」,不编默认值。 */
function depositKeyFacts(config, lang = 'zh') {
  const cp = config.cancelPolicy
  const zh = lang !== 'en'
  const grace = cp.lateArrivalGraceMin
  const notice = cp.rescheduleNoticeHours
  const retain = cp.depositRetainTimes || 0
  const noticeText = notice === null ? '—'
    : (notice >= 24 && notice % 24 === 0
      ? (zh ? `提前 ${notice / 24} 天` : `${notice / 24} day(s) ahead`)
      : (zh ? `提前 ${notice} 小时` : `${notice}h ahead`))
  return [
    { key: 'grace', value: grace === null ? '—' : (zh ? `${grace} 分钟` : `${grace} min`), label: zh ? '迟到宽限' : 'Late grace' },
    { key: 'reschedule', value: noticeText, label: zh ? '改期时限' : 'Reschedule' },
    { key: 'retain', value: zh ? `可保留 ${retain} 次` : `${retain}x`, label: zh ? '合规改期定金' : 'Deposit retained' }
  ]
}

// 某笔预约应收的定金(不含会员减免)
function depositAmountForService(service, config, tenantId = currentTenantId()) {
  if (!config.enabled) return 0
  if (config.mode === 'fixed') return Math.max(0, Math.round(config.fixedAmountCents))
  if (config.mode === 'pct') return Math.max(0, Math.round((service?.price_cents || 0) * (Number(config.pct) || 0) / 100))
  const own = Number(service?.deposit_cents)
  return Number.isFinite(own) && own > 0 ? Math.round(own) : Math.max(0, Math.round(config.fallbackAmountCents))
}

// 取消 / 爽约时扣除的定金
function forfeitedDepositCents(booking, config, { noShow = false, now = new Date() } = {}) {
  const deposit = Math.max(0, Number(booking.deposit_cents) || 0)
  if (!deposit) return 0
  const cp = config.cancelPolicy
  if (noShow) return Math.floor(deposit * (Number(cp.noShowForfeitPct) || 0) / 100)
  if (!cp.refundable) return deposit
  const hoursBefore = (new Date(booking.appointment_start).getTime() - now.getTime()) / 3_600_000
  if (cp.freeCancelHours !== null && hoursBefore >= cp.freeCancelHours) return 0
  return Math.floor(deposit * (Number(cp.lateForfeitPct) || 0) / 100)
}

/* 定金保留凭据:合规改期时把已付定金转到下一次预约。
   depositRetainTimes 是「同一笔定金最多被保留几次」,超次数就按正常规则处理(该扣就扣)。 */
function issueDepositRetain({ tenantId, userId, bookingId, amountCents, timesUsed }) {
  const id = randomId('retain')
  db.prepare(`INSERT INTO deposit_retains (id, tenant_id, user_id, source_booking_id, amount_cents, times_used, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`).run(id, tenantId, userId, bookingId, Math.max(0, Math.round(amountCents)), timesUsed, iso(new Date()))
  return db.prepare('SELECT * FROM deposit_retains WHERE id = ?').get(id)
}

function activeDepositRetain(userId, tenantId = currentTenantId()) {
  if (!userId) return null
  return db.prepare("SELECT * FROM deposit_retains WHERE tenant_id = ? AND user_id = ? AND status = 'active' ORDER BY created_at ASC LIMIT 1").get(tenantId, userId) || null
}

function consumeDepositRetain(retainId, bookingId) {
  db.prepare("UPDATE deposit_retains SET status = 'consumed', consumed_booking_id = ?, consumed_at = ? WHERE id = ?")
    .run(bookingId, iso(new Date()), retainId)
}

/* ===== P1 结算计算(2026-08-08)=====
   金额红线:前端永远不自行计算任何金额。这里是唯一的计算入口,两条恒等式在返回前强制校验。
     共优惠 ≡ 原价合计 − 档位小计
     应收   ≡ 档位小计 − 定金抵扣
   足部加收(整单 +100)按店主确认口径**同时进原价合计与档位小计** —— 它是加价不是折扣,
   这样两条恒等式才自洽。 */
function assertSettlementInvariants(result) {
  const d = result.listTotalCents - result.subtotalCents
  if (result.discountTotalCents !== d) {
    throw apiError(500, 'SETTLEMENT_INVARIANT', `共优惠对不上:${result.discountTotalCents} ≠ ${result.listTotalCents} − ${result.subtotalCents}`)
  }
  const due = result.subtotalCents - result.depositDeductCents
  if (result.totalCents !== due) {
    throw apiError(500, 'SETTLEMENT_INVARIANT', `应收对不上:${result.totalCents} ≠ ${result.subtotalCents} − ${result.depositDeductCents}`)
  }
  return result
}

/* 入参 { tenantId, tierKey, items:[{serviceId, qty, fingers}], customItems:[{name, amountCents}],
   applyFootSurcharge, applyTipReuse, depositApplied, bookingId, userId, payerUserId }
   出参:带编号的明细 + 五个汇总数 + 支付构成 */
function computeSettlement(input = {}) {
  const tenantId = input.tenantId || currentTenantId()
  const tierKey = PRICE_TIERS.includes(input.tierKey) ? input.tierKey : 'list'
  const rules = getPricingRules(tenantId)
  const getSvc = (id) => db.prepare('SELECT * FROM services WHERE id = ? AND tenant_id = ?').get(id, tenantId)

  const rawItems = Array.isArray(input.items) ? input.items : []
  const mainRow = rawItems.map((it) => getSvc(it.serviceId)).find((svc) => svc && (svc.item_kind || 'main') === 'main')
  const mainTierCents = mainRow ? servicePriceCents(mainRow, tierKey).priceCents : 0

  const lines = []
  let no = 0
  for (const raw of rawItems) {
    const svc = getSvc(raw && raw.serviceId)
    if (!svc) throw apiError(404, 'NOT_FOUND', '本店没有这个项目(或不属于当前门店)。')
    no += 1
    const unit = svc.unit || 'once'
    const count = unit === 'per_finger'
      ? Math.max(1, Math.round(Number(raw.fingers ?? raw.qty ?? 1) || 1))
      : Math.max(1, Math.round(Number(raw.qty ?? 1) || 1))
    let tierUnit = servicePriceCents(svc, tierKey).priceCents
    let listUnit = servicePriceCents(svc, 'list').priceCents
    let ruleApplied = null
    // 单指挂靠主项目按比例:两档都按各自档的主项目价算,否则原价合计会失真
    if (unit === 'per_finger' && svc.price_rule === 'pct_of_tier_price' && rules.single_finger.isActive) {
      const pct = Number(svc.price_rule_value) > 0 ? Number(svc.price_rule_value) : Number(rules.single_finger.config.pct || 10)
      tierUnit = Math.round(mainTierCents * pct / 100)
      listUnit = Math.round((mainRow ? servicePriceCents(mainRow, 'list').priceCents : 0) * pct / 100)
      ruleApplied = 'single_finger'
    }
    lines.push({
      itemNo: no,
      kind: (svc.item_kind || 'main') === 'addon' ? 'addon' : 'main',
      serviceId: svc.id,
      name: svc.name_zh,
      tierKey,
      unit,
      qty: count,
      listUnitCents: listUnit,
      unitPriceCents: tierUnit,
      listAmountCents: listUnit * count,
      amountCents: tierUnit * count,
      ruleApplied,
      isFree: tierUnit * count === 0
    })
  }
  // 自选填写行:价目表外的项目,原价与档价相同(没有"原价"这一说,不产生优惠)
  for (const raw of Array.isArray(input.customItems) ? input.customItems : []) {
    const name = String(raw?.name || '').trim()
    const amount = Math.max(0, Math.round(Number(raw?.amountCents) || 0))
    if (!name || !amount) continue
    no += 1
    lines.push({
      itemNo: no, kind: 'custom', serviceId: null, name, tierKey, unit: 'once', qty: 1,
      listUnitCents: amount, unitPriceCents: amount, listAmountCents: amount, amountCents: amount,
      ruleApplied: null, isFree: false
    })
  }

  const rulesApplied = []
  // 甲片重利用:固定价,不分档 → 原价与档价相同
  if ((input.applyTipReuse || input.tipReuse) && rules.tip_reuse.isActive) {
    const amount = Math.max(0, Math.round(Number(rules.tip_reuse.config.amountCents ?? 10000)))
    no += 1
    lines.push({
      itemNo: no, kind: 'rule', serviceId: null, name: '甲片重复利用', tierKey, unit: 'once', qty: 1,
      listUnitCents: amount, unitPriceCents: amount, listAmountCents: amount, amountCents: amount,
      ruleApplied: 'tip_reuse', isFree: false
    })
    rulesApplied.push({ key: 'tip_reuse', label: '甲片重复利用', amountCents: amount })
  }

  let listTotalCents = lines.reduce((sum, l) => sum + l.listAmountCents, 0)
  let subtotalCents = lines.reduce((sum, l) => sum + l.amountCents, 0)
  // 足部加收:整单加价,两边同时加(店主 2026-08-08 确认口径)
  if (input.applyFootSurcharge && rules.foot_surcharge.isActive) {
    const amount = Math.max(0, Math.round(Number(rules.foot_surcharge.config.amountCents ?? 10000)))
    listTotalCents += amount
    subtotalCents += amount
    rulesApplied.push({ key: 'foot_surcharge', label: '足部美甲(整单加收)', amountCents: amount })
  }

  // 定金抵扣:只有本店 deposit_config 允许抵扣、且技师勾了「已付定金抵扣」才抵
  const depositConfig = getDepositConfig(tenantId)
  let depositDeductCents = 0
  if (input.depositApplied && depositConfig.deductible) {
    const booking = input.bookingId ? db.prepare('SELECT * FROM bookings WHERE id = ? AND tenant_id = ?').get(input.bookingId, tenantId) : null
    const paid = booking ? Math.max(0, booking.deposit_cents || 0) : 0
    depositDeductCents = Math.min(paid || depositAmountForService(mainRow, depositConfig, tenantId), subtotalCents)
  }

  const discountTotalCents = listTotalCents - subtotalCents
  const totalCents = subtotalCents - depositDeductCents

  // 支付构成:储值先烧迁移桶,再烧新桶;不够的进线下腿
  const payerId = input.payerUserId || input.userId || ''
  const balance = payerId ? storedValueBalanceDetail(payerId, tenantId) : { totalCents: 0, legacyCents: 0, normalCents: 0 }
  const plan = ['balance_plus_offline', 'recharge_then_balance', 'offline_full'].includes(input.payIntent) ? input.payIntent : 'balance_plus_offline'
  const legs = []
  let remaining = totalCents
  if (plan !== 'offline_full') {
    const useLegacy = Math.min(Math.max(0, balance.legacyCents), remaining)
    if (useLegacy > 0) { legs.push({ leg: 'migrate_stored', amountCents: useLegacy, payerUserId: payerId, note: '迁移桶(不进本店收入)' }); remaining -= useLegacy }
    const useNormal = Math.min(Math.max(0, balance.normalCents), remaining)
    if (useNormal > 0) { legs.push({ leg: 'stored_value', amountCents: useNormal, payerUserId: payerId }); remaining -= useNormal }
  }
  if (remaining > 0) legs.push({ leg: 'offline', amountCents: remaining, payerUserId: payerId, note: '到店支付' })

  const storedUsedCents = legs.filter((l) => l.leg === 'stored_value' || l.leg === 'migrate_stored').reduce((sum, l) => sum + l.amountCents, 0)

  return assertSettlementInvariants({
    tenantId,
    tierKey,
    currency: tenantCurrencyCode(tenantId),
    currencyDisplay: currencyDisplayOf(tenantCurrencyCode(tenantId)),
    lines,
    rulesApplied,
    listTotalCents,
    subtotalCents,
    depositDeductCents,
    discountTotalCents,
    totalCents,
    payment: {
      plan,
      legs,
      balanceAvailableCents: balance.totalCents,
      legacyBalanceCents: balance.legacyCents,
      normalBalanceCents: balance.normalCents,
      storedUsedCents,
      offlineCents: Math.max(0, remaining),
      shortfallCents: Math.max(0, totalCents - balance.totalCents)
    },
    // 互斥软校验:同单既勾了免收项、又勾了对应的收费卸除项 → 提示,不硬拦
    softWarnings: buildSettlementWarnings(lines)
  })
}

function buildSettlementWarnings(lines) {
  const warnings = []
  const hasFreeRemoval = lines.some((l) => l.isFree && /免卸/.test(l.name))
  const paidRemoval = lines.filter((l) => !l.isFree && /卸/.test(l.name))
  if (hasFreeRemoval && paidRemoval.length) {
    warnings.push({
      code: 'FREE_AND_PAID_REMOVAL',
      message: `本单同时勾了「免卸」和收费卸除项(${paidRemoval.map((l) => l.name).join('、')}),确认是有意为之吗?`
    })
  }
  return warnings
}

/* 建结算组:一次结算一组,组内一位被服务者一张单。
   朋友不建档 —— 朋友的单 user_id 仍是卡主,served_person_name 记称呼,is_proxy_paid=1;
   全部单据推给卡主,逐张本人签,无代确认兜底(原稿第 1 条)。 */
function createSettlementGroup(body = {}, adminSession = {}) {
  const tenantId = currentTenantId()
  const cardOwnerUserId = String(body.cardOwnerUserId || body.userId || '').trim()
  if (!cardOwnerUserId) throw apiError(400, 'BAD_REQUEST', '缺少卡主(签字人)。')
  if (!db.prepare('SELECT id FROM users WHERE id = ? AND tenant_id = ?').get(cardOwnerUserId, tenantId)) {
    throw apiError(404, 'NOT_FOUND', '卡主不在本店档案里。')
  }
  const sheets = Array.isArray(body.settlements) && body.settlements.length ? body.settlements : [body]
  const now = iso(new Date())
  const groupId = randomId('sgrp')
  const created = []
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(`INSERT INTO settlement_groups (id, tenant_id, booking_id, card_owner_user_id, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending_sign', ?, ?, ?)`)
      .run(groupId, tenantId, body.bookingId || null, cardOwnerUserId, adminSession.email || 'staff', now, now)

    for (const sheet of sheets) {
      const computed = computeSettlement({ ...sheet, tenantId, userId: cardOwnerUserId, payerUserId: cardOwnerUserId, bookingId: sheet.bookingId || body.bookingId })
      const id = randomId('stl')
      const isProxy = Boolean(sheet.servedPersonName && String(sheet.servedPersonName).trim())
      db.prepare(`INSERT INTO settlements
        (id, tenant_id, group_id, booking_id, user_id, served_person_name, is_proxy_paid, code, status,
         price_tier_used, tier_changed_from, tier_changed_by, tier_changed_at,
         list_total_cents, subtotal_cents, deposit_deduct_cents, discount_total_cents, total_cents,
         pay_intent, perf_alloc_status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_sign', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`)
        .run(id, tenantId, groupId, sheet.bookingId || body.bookingId || null, cardOwnerUserId,
          String(sheet.servedPersonName || '').slice(0, 40) || null, isProxy ? 1 : 0, settlementCode(tenantId),
          computed.tierKey, sheet.tierChangedFrom || null, sheet.tierChangedFrom ? (adminSession.email || 'staff') : null, sheet.tierChangedFrom ? now : null,
          computed.listTotalCents, computed.subtotalCents, computed.depositDeductCents, computed.discountTotalCents, computed.totalCents,
          computed.payment.plan, adminSession.email || 'staff', now, now)

      const itemStmt = db.prepare(`INSERT INTO settlement_items
        (id, tenant_id, settlement_id, item_no, kind, service_id, name_snapshot, tier_key, unit, qty,
         list_unit_cents, unit_price_cents, list_amount_cents, amount_cents, rule_applied, is_free)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      for (const line of computed.lines) {
        itemStmt.run(randomId('sitem'), tenantId, id, line.itemNo, line.kind, line.serviceId, line.name, line.tierKey,
          line.unit, line.qty, line.listUnitCents, line.unitPriceCents, line.listAmountCents, line.amountCents,
          line.ruleApplied, line.isFree ? 1 : 0)
      }
      // 技师:1–2 位,主/副 + 各自勾的编号;分成留空(P2 老板日结时写)
      const techs = Array.isArray(sheet.technicians) ? sheet.technicians.slice(0, 2) : []
      const techStmt = db.prepare(`INSERT INTO settlement_technicians (id, tenant_id, settlement_id, technician_id, role, item_nos_json)
        VALUES (?, ?, ?, ?, ?, ?)`)
      techs.forEach((t, index) => {
        if (!db.prepare('SELECT 1 FROM technicians WHERE id = ? AND tenant_id = ?').get(t.technicianId, tenantId)) {
          throw apiError(400, 'BAD_REQUEST', '技师不属于本店。')
        }
        techStmt.run(randomId('stech'), tenantId, id, t.technicianId, t.role === 'assist' || index > 0 ? 'assist' : 'main',
          JSON.stringify(Array.isArray(t.itemNos) ? t.itemNos.map(Number) : []))
      })
      // 支付腿:先落 pending,签字那一刻才真正扣卡
      const payStmt = db.prepare(`INSERT INTO settlement_payments (id, tenant_id, settlement_id, leg, amount_cents, payer_user_id, status, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
      if (computed.depositDeductCents > 0) {
        payStmt.run(randomId('spay'), tenantId, id, 'deposit', computed.depositDeductCents, cardOwnerUserId, '已付定金抵扣', now)
      }
      for (const leg of computed.payment.legs) {
        payStmt.run(randomId('spay'), tenantId, id, leg.leg, leg.amountCents, leg.payerUserId || cardOwnerUserId, leg.note || null, now)
      }
      created.push(id)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  const rows = created.map((id) => db.prepare('SELECT * FROM settlements WHERE id = ?').get(id))
  return {
    groupId,
    sheetCount: rows.length,
    cardOwnerUserId,
    settlements: rows.map((r) => serializeSettlement(r)),
    note: `已生成 ${rows.length} 张服务单,推送给卡主逐张签字。`
  }
}

/* 签字:卡主本人签的那一刻即时扣卡。
   顺序 = 先烧迁移桶(不进财务收入)→ 再烧新桶(进财务收入)→ 线下腿标"待收款"。
   签前二次校验余额,不足直接拦回让技师改支付构成(原稿第 2 条)。 */
async function signSettlement(row, { signature, signedBy = '', strokes = [] }) {
  const tenantId = row.tenant_id
  const legs = db.prepare("SELECT * FROM settlement_payments WHERE settlement_id = ? AND leg IN ('stored_value','migrate_stored') ORDER BY rowid ASC").all(row.id)
  const needStored = legs.reduce((sum, l) => sum + l.amount_cents, 0)
  const balance = storedValueBalanceDetail(row.user_id, tenantId)
  if (needStored > balance.totalCents) {
    throw apiError(400, 'INSUFFICIENT_BALANCE',
      `储值余额不足(需 ${needStored / 100},现有 ${balance.totalCents / 100}),请回到结算页改支付构成。`)
  }
  const now = iso(new Date())
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const leg of legs) {
      if (leg.amount_cents <= 0) continue
      db.prepare(`INSERT INTO stored_value_transactions (id, tenant_id, user_id, type, amount_cents, pay_channel, note, created_by, created_at, bucket)
        VALUES (?, ?, ?, 'consume', ?, 'stored_value', ?, ?, ?, ?)`)
        .run(randomId('sv'), tenantId, row.user_id, -Math.abs(leg.amount_cents),
          `服务单 ${row.code} 结算扣卡`, signedBy || row.user_id, now, leg.leg === 'migrate_stored' ? 'legacy' : 'normal')
      db.prepare("UPDATE settlement_payments SET status = 'paid' WHERE id = ?").run(leg.id)
      // 迁移桶是老店欠顾客的服务,不是本店收入 —— 只有新桶进财务
      if (leg.leg === 'stored_value') {
        insertFinanceTransaction({
          type: 'income', source: 'settlement', category: '服务收入-耗卡', tags: row.code,
          amountCents: leg.amount_cents, payChannel: 'stored_value', occurredOn: todayOf(tenantId),
          note: `服务单 ${row.code}`, createdBy: signedBy || 'customer_sign'
        })
      }
    }
    db.prepare("UPDATE settlement_payments SET status = 'awaiting' WHERE settlement_id = ? AND leg = 'offline' AND status = 'pending'").run(row.id)
    db.prepare("UPDATE settlements SET status = 'signed', signature_data = ?, signed_at = ?, disclaimer_accepted = 1, updated_at = ? WHERE id = ?")
      .run(String(signature).slice(0, 200), now, now, row.id)
    // 结算 → 订单:签署驱动 COMPLETED
    if (row.booking_id) {
      db.prepare("UPDATE bookings SET status = 'COMPLETED', updated_at = ? WHERE id = ? AND status IN ('PENDING_PAYMENT','CONFIRMED')").run(now, row.booking_id)
    }
    // 组内全部签完,组才算完成
    const unsigned = db.prepare("SELECT COUNT(*) AS n FROM settlements WHERE group_id = ? AND status <> 'signed'").get(row.group_id).n
    db.prepare('UPDATE settlement_groups SET status = ?, updated_at = ? WHERE id = ?').run(unsigned === 0 ? 'signed' : 'pending_sign', now, row.group_id)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  // 快照:签完立刻把整张单连同笔迹渲染成 SVG。这是唯一签署凭证 ——
  // 结算数据随时可重渲染,笔迹只在签的这一瞬间存在,过后补不了,所以必须在这里生成。
  const signedRow = db.prepare('SELECT * FROM settlements WHERE id = ?').get(row.id)
  const snapshotSvg = renderSettlementSnapshotSvg(serializeSettlement(signedRow, { includeSignature: true }), { strokes, signedAt: now })
  const objectKey = `settlements/${tenantId}/${signedRow.code}.svg`
  const url = await cosPutObject(objectKey, snapshotSvg, 'image/svg+xml')
  // COS 没配 / 上传失败 → inline 入库标 storage=inline,后续可迁移,绝不因存储故障拦签署
  db.prepare('UPDATE settlements SET snapshot_url = ?, snapshot_inline = ?, snapshot_storage = ?, snapshot_at = ? WHERE id = ?')
    .run(url || null, url ? null : snapshotSvg, url ? 'cos' : 'inline', now, row.id)

  const fresh = db.prepare('SELECT * FROM settlements WHERE id = ?').get(row.id)
  return {
    settlement: serializeSettlement(fresh),
    snapshot: { storage: fresh.snapshot_storage, url: fresh.snapshot_url, at: fresh.snapshot_at, bytes: snapshotSvg.length },
    storedDeductedCents: needStored,
    groupAllSigned: db.prepare("SELECT COUNT(*) AS n FROM settlements WHERE group_id = ? AND status <> 'signed'").get(row.group_id).n === 0
  }
}

/* 更正:已签单据永不修改,只追加 amendments(改前/改后/谁/何时)。
   储值支付的单被更正后,系统按差额自动补配余额 —— 纯系统行为,人工不可改这一笔(原稿第 6 条)。 */
function amendSettlement(settlementId, body = {}, adminSession = {}) {
  const tenantId = currentTenantId()
  const row = db.prepare('SELECT * FROM settlements WHERE id = ? AND tenant_id = ?').get(settlementId, tenantId)
  if (!row) throw apiError(404, 'NOT_FOUND', 'Settlement not found.')
  if (row.status !== 'signed') throw apiError(400, 'BAD_REQUEST', '未签署的单直接改就行,不需要走更正。')
  const before = serializeSettlement(row)
  const newTotal = Math.max(0, Math.round(Number(body.totalCents ?? row.total_cents)))
  const delta = newTotal - row.total_cents
  const now = iso(new Date())
  const storedPaid = db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS n FROM settlement_payments WHERE settlement_id = ? AND leg IN ('stored_value','migrate_stored') AND status = 'paid'").get(row.id).n
  // 少收了要退回卡里,多收了从卡里补扣;只在这张单确实用卡付过的时候才动余额
  const autoAdjust = storedPaid > 0 ? -delta : 0
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(`INSERT INTO settlement_amendments (id, tenant_id, settlement_id, before_json, after_json, reason, amount_delta_cents, auto_balance_adjust_cents, amended_by, amended_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomId('samd'), tenantId, row.id, JSON.stringify(before), JSON.stringify({ totalCents: newTotal, reason: body.reason || '' }),
        String(body.reason || '').slice(0, 300), delta, autoAdjust, adminSession.email || 'owner', now, now)
    if (autoAdjust !== 0) {
      db.prepare(`INSERT INTO stored_value_transactions (id, tenant_id, user_id, type, amount_cents, pay_channel, note, created_by, created_at, bucket)
        VALUES (?, ?, ?, 'adjust', ?, 'stored_value', ?, 'system_amendment', ?, 'normal')`)
        .run(randomId('sv'), tenantId, row.user_id, autoAdjust, `服务单 ${row.code} 更正差额自动补配`, now)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return {
    amended: true,
    amountDeltaCents: delta,
    autoBalanceAdjustCents: autoAdjust,
    note: '原单据未改动(已签单据不可修改),更正已作为追加记录留痕。',
    settlement: serializeSettlement(db.prepare('SELECT * FROM settlements WHERE id = ?').get(row.id))
  }
}

/* ===== 对象存储(腾讯云 COS)最小上传封装(2026-08-08)=====
   零依赖,只用 node:crypto 做 COS v5 签名。密钥只从 env 读,不写代码、不进仓库、不打印日志
   (沿用主钥匙那次的纪律)。没配或上传失败一律返回 null,由调用方降级 —— 不因存储故障拦流程。
   环境变量:COS_SECRET_ID / COS_SECRET_KEY / COS_REGION / COS_BUCKET */
const COS = {
  secretId: process.env.COS_SECRET_ID || '',
  secretKey: process.env.COS_SECRET_KEY || '',
  region: process.env.COS_REGION || '',
  bucket: process.env.COS_BUCKET || ''
}
function cosConfigured() {
  return Boolean(COS.secretId && COS.secretKey && COS.region && COS.bucket)
}

function cosAuthorization({ method, key, headers, now = Math.floor(Date.now() / 1000) }) {
  const keyTime = `${now - 60};${now + 900}`
  const signKey = createHmac('sha1', COS.secretKey).update(keyTime).digest('hex')
  const headerKeys = Object.keys(headers).map((k) => k.toLowerCase()).sort()
  const headerString = headerKeys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(headers[Object.keys(headers).find((x) => x.toLowerCase() === k)]))}`).join('&')
  const httpString = `${method.toLowerCase()}\n${key}\n\n${headerString}\n`
  const stringToSign = `sha1\n${keyTime}\n${createHash('sha1').update(httpString).digest('hex')}\n`
  const signature = createHmac('sha1', signKey).update(stringToSign).digest('hex')
  return [
    'q-sign-algorithm=sha1',
    `q-ak=${COS.secretId}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    `q-header-list=${headerKeys.join(';')}`,
    'q-url-param-list=',
    `q-signature=${signature}`
  ].join('&')
}

async function cosPutObject(objectKey, body, contentType = 'application/octet-stream') {
  if (!cosConfigured()) return null
  const key = objectKey.startsWith('/') ? objectKey : `/${objectKey}`
  const host = `${COS.bucket}.cos.${COS.region}.myqcloud.com`
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8')
  const headers = { host, 'content-type': contentType, 'content-length': String(payload.length) }
  try {
    const response = await fetch(`https://${host}${key}`, {
      method: 'PUT',
      headers: { ...headers, authorization: cosAuthorization({ method: 'PUT', key, headers }) },
      body: payload,
      signal: AbortSignal.timeout(15000)
    })
    if (!response.ok) {
      console.error(`[cos] 上传失败 ${response.status}(已降级,不影响业务)`)
      return null
    }
    return `https://${host}${key}`
  } catch (error) {
    console.error(`[cos] 上传异常: ${error.message}(已降级,不影响业务)`)
    return null
  }
}

/* ===== 已签结算单快照(2026-08-08 店主拍板口径)=====
   顾客点确认的那一刻,把整张结算单连同笔迹渲染成一张 SVG —— 这就是唯一签署凭证。
   为什么是服务端渲染:一处渲染,小程序与网页拿到的凭证逐字节相同;笔迹只在签的那一瞬间存在,
   过后补不了,所以生成时机必须在签署时刻。 */
function escapeXml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]))
}

// 笔迹:客户端传来的点阵 [[{x,y},...], ...],按签名板 300×150 坐标系归一化后画成 path
function signatureStrokesToPath(strokes) {
  if (!Array.isArray(strokes) || !strokes.length) return ''
  return strokes
    .filter((stroke) => Array.isArray(stroke) && stroke.length)
    .map((stroke) => stroke.map((pt, index) => `${index === 0 ? 'M' : 'L'}${Number(pt.x).toFixed(1)},${Number(pt.y).toFixed(1)}`).join(' '))
    .join(' ')
}

/* 凭证只管金额与签名。定金规则的完整展示留在预约页(顾客付定金时已看过并同意),
   快照上只保留「已付定金抵扣」这一金额行 —— 店主 2026-08-08 拍板。 */
function renderSettlementSnapshotSvg(settlement, { strokes = [], signedAt = '' } = {}) {
  const s = settlement
  const fmt = s.currencyDisplay || { prefix: '<CODE> ', symbol: '$', trimZeroDecimals: false }
  const money = (cents) => {
    let text = (Math.round(cents) / 100).toFixed(2)
    if (fmt.trimZeroDecimals) text = text.replace(/\.00$/, '')
    return `${String(fmt.prefix).replace('<CODE>', s.currency)}${fmt.symbol}${text}`
  }
  const W = 720
  const lineH = 30
  const rows = []
  let y = 208
  rows.push(`<text x="40" y="${y}" class="h">服务技师</text>`)
  y += 26
  rows.push(`<text x="40" y="${y}" class="t">${escapeXml(s.technicians.map((t) => `${t.name}（${t.role === 'main' ? '主' : '副'}）`).join(' · ') || '—')}</text>`)
  y += 22
  rows.push(`<text x="40" y="${y}" class="s">${escapeXml(s.technicians.map((t) => `${t.name}：${t.itemNos.join('·') || '—'}`).join(' ／ '))}</text>`)
  y += 36
  rows.push(`<text x="40" y="${y}" class="h">服务明细${s.isProxyPaid ? '（代付）' : ''}</text>`)
  y += 8
  for (const item of s.items) {
    y += lineH
    const label = `${String(item.itemNo).padStart(2, '0')}  ${item.name}${item.unit === 'per_finger' ? ` ×${item.qty} 指` : (item.qty > 1 ? ` ×${item.qty}` : '')}`
    rows.push(`<text x="40" y="${y}" class="t">${escapeXml(label)}</text>`)
    if (item.isFree) {
      rows.push(`<text x="${W - 40}" y="${y}" class="free" text-anchor="end">免收</text>`)
    } else {
      if (item.listAmountCents !== item.amountCents) {
        rows.push(`<text x="${W - 130}" y="${y}" class="strike" text-anchor="end">${escapeXml(money(item.listAmountCents))}</text>`)
      }
      rows.push(`<text x="${W - 40}" y="${y}" class="t" text-anchor="end">${escapeXml(money(item.amountCents))}</text>`)
    }
  }
  y += 40
  rows.push(`<text x="40" y="${y}" class="h">支付构成</text>`)
  const payLabel = { deposit: '已付定金抵扣', stored_value: '储值卡抵扣', migrate_stored: '储值卡抵扣（历史余额）', offline: '到店支付', times_card: '次卡抵扣', coupon: '优惠券' }
  for (const p of s.payments) {
    y += lineH
    rows.push(`<text x="40" y="${y}" class="t">${escapeXml(payLabel[p.leg] || p.leg)}</text>`)
    rows.push(`<text x="${W - 40}" y="${y}" class="t" text-anchor="end">${escapeXml(`${p.leg === 'deposit' ? '−' : ''}${money(p.amountCents)}`)}</text>`)
  }
  y += 30
  rows.push(`<line x1="40" y1="${y}" x2="${W - 40}" y2="${y}" class="rule"/>`)
  y += 30
  rows.push(`<text x="40" y="${y}" class="s">原价合计</text><text x="${W - 40}" y="${y}" class="strike" text-anchor="end">${escapeXml(money(s.listTotalCents))}</text>`)
  y += 26
  rows.push(`<text x="40" y="${y}" class="s">较原价共优惠</text><text x="${W - 40}" y="${y}" class="t" text-anchor="end">${escapeXml(money(s.discountTotalCents))}</text>`)
  y += 40
  rows.push(`<text x="40" y="${y}" class="grand">合计</text><text x="${W - 40}" y="${y}" class="grand gold" text-anchor="end">${escapeXml(money(s.totalCents))}</text>`)
  y += 46
  rows.push(`<text x="40" y="${y}" class="s">本单据为服务确认凭证,由顾客本人签署确认。</text>`)
  const H = y + 40
  const inkPath = signatureStrokesToPath(strokes)
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>
  .t{font:15px -apple-system,"PingFang SC",sans-serif;fill:#2d2826}
  .s{font:12.5px -apple-system,"PingFang SC",sans-serif;fill:#8c8279}
  .h{font:700 13px -apple-system,"PingFang SC",sans-serif;fill:#8c8279}
  .store{font:800 21px -apple-system,"PingFang SC",sans-serif;fill:#2d2826}
  .grand{font:800 20px -apple-system,"PingFang SC",sans-serif;fill:#2d2826}
  .gold{fill:#9b7655}
  .free{font:700 14px -apple-system,"PingFang SC",sans-serif;fill:#2f7d5c}
  .strike{font:12.5px -apple-system,"PingFang SC",sans-serif;fill:#8c8279;text-decoration:line-through}
  .rule{stroke:#e7ddd4;stroke-width:1}
</style>
<rect width="${W}" height="${H}" fill="#ffffff"/>
<text x="40" y="60" class="store">${escapeXml(s.storeName)}</text>
<text x="40" y="86" class="s">订单编号 ${escapeXml(s.code)}</text>
<text x="40" y="106" class="s">${escapeXml(`${s.appointmentAt ? String(s.appointmentAt).slice(0, 16).replace('T', ' ') : ''}${s.servedPersonName ? ` · 被服务者：${s.servedPersonName}` : ''}`)}</text>
<text x="40" y="126" class="s">签署时间 ${escapeXml(String(signedAt).slice(0, 19).replace('T', ' '))}</text>
<text x="${W - 200}" y="56" class="s">顾客签名：</text>
<g transform="translate(${W - 200},64)">
  <rect width="160" height="90" fill="none" stroke="#e7ddd4" stroke-dasharray="3 3"/>
  ${inkPath ? `<path d="${inkPath}" fill="none" stroke="#2d2826" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" transform="scale(0.53)"/>` : `<text x="80" y="52" class="s" text-anchor="middle">${escapeXml(s.signatureName || '')}</text>`}
</g>
<line x1="40" y1="170" x2="${W - 40}" y2="170" class="rule"/>
${rows.join('\n')}
</svg>`
}

function settlementCode(tenantId) {
  const prefix = String(tenantId || '').replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || 'LL'
  return `${prefix}-${todayOf(tenantId).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
}

function serializeSettlement(row, { includeSignature = false } = {}) {
  const items = db.prepare('SELECT * FROM settlement_items WHERE settlement_id = ? ORDER BY item_no ASC').all(row.id)
  const techs = db.prepare('SELECT st.*, t.name AS tech_name FROM settlement_technicians st LEFT JOIN technicians t ON t.id = st.technician_id WHERE st.settlement_id = ?').all(row.id)
  const pays = db.prepare('SELECT * FROM settlement_payments WHERE settlement_id = ? ORDER BY rowid ASC').all(row.id)
  const store = db.prepare('SELECT name, address FROM stores WHERE tenant_id = ? AND is_active = 1 ORDER BY rowid ASC LIMIT 1').get(row.tenant_id)
  const booking = row.booking_id ? db.prepare('SELECT appointment_start FROM bookings WHERE id = ?').get(row.booking_id) : null
  return {
    id: row.id,
    code: row.code,
    tenantId: row.tenant_id,
    groupId: row.group_id,
    bookingId: row.booking_id,
    storeName: store?.name || '',
    storeAddress: store?.address || '',
    appointmentAt: booking?.appointment_start || null,
    currency: tenantCurrencyCode(row.tenant_id),
    currencyDisplay: currencyDisplayOf(tenantCurrencyCode(row.tenant_id)),
    servedPersonName: row.served_person_name || '',
    isProxyPaid: Boolean(row.is_proxy_paid),
    status: row.status,
    tierKey: row.price_tier_used,
    tierChangedFrom: row.tier_changed_from,
    listTotalCents: row.list_total_cents,
    subtotalCents: row.subtotal_cents,
    depositDeductCents: row.deposit_deduct_cents,
    discountTotalCents: row.discount_total_cents,
    totalCents: row.total_cents,
    payIntent: row.pay_intent,
    signedAt: row.signed_at,
    signatureName: row.signature_data ? (includeSignature ? row.signature_data : '(已签)') : null,
    disclaimerAccepted: Boolean(row.disclaimer_accepted),
    aftersalesStatus: row.aftersales_status || null,
    snapshot: row.snapshot_at ? { storage: row.snapshot_storage, url: row.snapshot_url, at: row.snapshot_at } : null,
    perfAllocStatus: row.perf_alloc_status,
    items: items.map((i) => ({
      itemNo: i.item_no, kind: i.kind, serviceId: i.service_id, name: i.name_snapshot,
      unit: i.unit, qty: i.qty, listUnitCents: i.list_unit_cents, unitPriceCents: i.unit_price_cents,
      listAmountCents: i.list_amount_cents, amountCents: i.amount_cents, ruleApplied: i.rule_applied, isFree: Boolean(i.is_free)
    })),
    technicians: techs.map((t) => ({
      technicianId: t.technician_id, name: t.tech_name || '', role: t.role,
      itemNos: (() => { try { return JSON.parse(t.item_nos_json || '[]') } catch { return [] } })(),
      sharePct: t.share_pct, shareCents: t.share_cents
    })),
    payments: pays.map((p) => ({ leg: p.leg, amountCents: p.amount_cents, payerUserId: p.payer_user_id, status: p.status, note: p.note })),
    amendments: db.prepare('SELECT id, reason, amount_delta_cents AS amountDeltaCents, auto_balance_adjust_cents AS autoBalanceAdjustCents, amended_by AS amendedBy, amended_at AS amendedAt FROM settlement_amendments WHERE settlement_id = ? ORDER BY created_at ASC').all(row.id)
  }
}

async function route(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {})
  const url = new URL(req.url, `http://${req.headers.host}`)
  const path = url.pathname
  const query = Object.fromEntries(url.searchParams.entries())

  if (req.method === 'GET' && path === '/') return serveFile(res, webRoot, 'index.html')
  if (req.method === 'GET' && path === '/admin') return serveFile(res, webRoot, 'admin.html')
  if (req.method === 'GET' && path === '/platform') return serveFile(res, webRoot, 'platform.html')
  if (req.method === 'GET' && path === '/wechat-simulator') return serveFile(res, webRoot, 'wechat-simulator.html')
  if (req.method === 'GET' && path === '/share') return serveFile(res, webRoot, 'share.html')
  // 顾客签署页(网页版,与小程序同构):/sign/<单号>
  if (req.method === 'GET' && (path === '/sign' || path.startsWith('/sign/'))) return serveFile(res, webRoot, 'sign.html')
  if (req.method === 'GET' && path.startsWith('/web/')) return serveFile(res, webRoot, path.replace('/web/', ''))
  if (req.method === 'GET' && path.startsWith('/assets/')) return serveFile(res, assetRoot, path.replace('/assets/', ''))

  // 公开只读:本店定金与取消规则(结构化参数 + 按 displayMode 输出的文案),供客户端与 AI
  if (req.method === 'GET' && path === '/store/deposit-policy') {
    const tid = resolveTenant(req, query)
    const config = getDepositConfig(tid)
    // 2026-08-08 屏 3 增量:金额(带 serviceId 就按该项目算)、三要点小卡、币种格式。
    // 顾客端只拿现成的显示串,不自己算金额、不自己拼「提前 1 天」这种措辞。
    const service = query.serviceId
      ? db.prepare('SELECT * FROM services WHERE id = ? AND tenant_id = ?').get(query.serviceId, tid)
      : null
    const amountCents = depositAmountForService(service, config, tid)
    return json(res, 200, {
      tenantId: tid,
      currency: tenantCurrencyCode(tid),
      currencyDisplay: currencyDisplayOf(tenantCurrencyCode(tid)),
      onlinePaymentReady: ONLINE_PAYMENT_READY,
      enabled: config.enabled,
      deductible: config.deductible,
      amountCents,
      amountText: formatMoneyCents(amountCents, tid, 'auto'),
      keyFacts: { zh: depositKeyFacts(config, 'zh'), en: depositKeyFacts(config, 'en') },
      config,
      text: { zh: depositPolicyText(config, tid, 'zh'), en: depositPolicyText(config, tid, 'en') }
    })
  }
  // 顾客签署页(小程序 / 网页同构):凭单号只读,不需要登录
  if (req.method === 'GET' && path.startsWith('/settlements/') && !path.endsWith('/sign') && !path.endsWith('/snapshot')) {
    const code = decodeURIComponent(path.split('/')[2] || '')
    const row = db.prepare('SELECT * FROM settlements WHERE code = ?').get(code)
    if (!row) throw apiError(404, 'NOT_FOUND', '找不到这张服务单。')
    const config = getDepositConfig(row.tenant_id)
    return json(res, 200, {
      settlement: serializeSettlement(row),
      depositPolicy: { text: depositPolicyText(config, row.tenant_id, 'zh'), deductible: config.deductible },
      // 电子签定位:服务确认凭证,不做法律效力表述(原稿第 11 条)
      disclaimer: '我已阅读并确认以上服务内容及款项无误,同意以此作为本次服务的结算凭证。'
    })
  }
  // 签署快照(唯一凭证):COS 存的直接 302 过去,inline 的直接吐 SVG
  if (req.method === 'GET' && path.startsWith('/settlements/') && path.endsWith('/snapshot')) {
    const code = decodeURIComponent(path.split('/')[2] || '')
    const row = db.prepare('SELECT * FROM settlements WHERE code = ?').get(code)
    if (!row || !row.snapshot_at) throw apiError(404, 'NOT_FOUND', '这张单还没有签署快照。')
    if (row.snapshot_url) {
      res.writeHead(302, { location: row.snapshot_url })
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-store' })
    res.end(row.snapshot_inline || '')
    return
  }
  // 卡主签字:签字那一刻即时扣卡(先烧迁移桶再烧新桶);签前二次校验余额,不足直接拦
  if (req.method === 'POST' && path.startsWith('/settlements/') && path.endsWith('/sign')) {
    const code = decodeURIComponent(path.split('/')[2] || '')
    const row = db.prepare('SELECT * FROM settlements WHERE code = ?').get(code)
    if (!row) throw apiError(404, 'NOT_FOUND', '找不到这张服务单。')
    if (row.status === 'signed') throw apiError(400, 'ALREADY_SIGNED', '这张单已经签过了。')
    const body = await readBody(req)
    if (body.disclaimerAccepted !== true) throw apiError(400, 'DISCLAIMER_REQUIRED', '请先勾选确认声明再签字。')
    const signature = String(body.signature || '').trim()
    if (!signature) throw apiError(400, 'SIGNATURE_REQUIRED', '请签名后再确认。')
    return json(res, 200, await signSettlement(row, { signature, signedBy: body.signedBy || '', strokes: body.strokes || [] }))
  }
  if (req.method === 'GET' && path === '/health') return json(res, 200, { ok: true, service: 'lucky-luxe-api-local', time: iso(new Date()) })
  if (req.method === 'GET' && path === '/wechat/customer-service/webhook') {
    const valid = verifyWecomSignature({
      signature: query.msg_signature || query.signature,
      timestamp: query.timestamp,
      nonce: query.nonce,
      payload: query.echostr
    })
    if (!valid) throw apiError(403, 'WECHAT_SIGNATURE_INVALID', 'WeChat callback signature verification failed or token is not configured.')
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(WECOM_CUSTOMER_SERVICE_AES_KEY ? decryptWecomPayload(query.echostr || '') : (query.echostr || ''))
    return
  }
  if (req.method === 'POST' && path === '/wechat/customer-service/webhook') {
    // 2026-08-04 修:此前这里没有设置租户上下文,handleWecomInbound 里的 AI 闸门会退回默认租户(旗舰店)
    // 去判断——结果所有商家的微信进线都在拿旗舰店的权限做判断,要么全部白送 AI、要么全部被停。
    // 现在按回调参数解析真实租户(缺省仍回落默认租户,保持既有单店部署行为不变)。
    tenantContext.enterWith({ tenantId: resolveTenant(req, query) })
    const rawBody = await readRawBody(req)
    const contentTypeHeader = req.headers['content-type'] || ''
    const body = contentTypeHeader.includes('application/json') && rawBody ? JSON.parse(rawBody) : {}
    const encryptedPayload = xmlValue(rawBody, 'Encrypt')
    if (encryptedPayload && WECOM_CUSTOMER_SERVICE_TOKEN) {
      const valid = verifyWecomSignature({
        signature: query.msg_signature || query.signature,
        timestamp: query.timestamp,
        nonce: query.nonce,
        payload: encryptedPayload
      })
      if (!valid) throw apiError(403, 'WECHAT_SIGNATURE_INVALID', 'WeChat callback signature verification failed.')
    }
    const decryptedBody = encryptedPayload && WECOM_CUSTOMER_SERVICE_AES_KEY ? decryptWecomPayload(encryptedPayload) : rawBody
    // 真实企微「微信客服」事件:回调仅是通知,立即 200 应答,异步拉取消息+AI回复发送(密钥齐备时)
    const kfEventToken = xmlValue(decryptedBody, 'Token')
    const kfEventOpenKfid = xmlValue(decryptedBody, 'OpenKfId') || WECOM_OPEN_KFID
    if (encryptedPayload && kfEventToken && kfEventOpenKfid && wecomOutboundReady()) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('success')
      syncAndProcessWecomKfMessages(kfEventOpenKfid, kfEventToken, req).catch((error) => {
        console.error('[wecom] 异步处理进线失败:', error?.message || error)
      })
      return
    }
    const inbound = normalizeWecomInbound(body, query, decryptedBody)
    if (encryptedPayload) inbound.raw = { encrypted: true, body: rawBody }
    const result = await handleWecomInbound(inbound, req)
    return json(res, 200, { ok: true, ...result })
  }
  if (req.method === 'POST' && path === '/auth/email/register') {
    const body = await readBody(req)
    const user = registerEmailUser(body)
    return json(res, 201, { user, auth: demoAuthFor(user.email || body.email), mode: 'demo' })
  }
  if (req.method === 'POST' && path === '/auth/email/login') {
    const body = await readBody(req)
    const user = registerEmailUser(body)
    return json(res, 200, { user, auth: demoAuthFor(user.email || body.email), mode: 'demo' })
  }
  if (req.method === 'POST' && path === '/auth/wechat/mini-login') return json(res, 200, await signInWechatMiniUser(await readBody(req)))
  // 商家入驻申请(公开表单,无需登录):留资给平台客服联系
  if (req.method === 'POST' && path === '/merchant-leads') {
    const body = await readBody(req)
    const shopName = String(body.shopName || '').trim()
    const phone = String(body.phone || '').trim()
    if (!shopName) throw apiError(400, 'BAD_REQUEST', '店铺名称必填。')
    if (!phone && !String(body.wechatId || '').trim()) throw apiError(400, 'BAD_REQUEST', '请至少留手机号或微信号。')
    const id = randomId('lead')
    const now = iso(new Date())
    db.prepare(`INSERT INTO merchant_leads (id, shop_name, contact_name, phone, wechat_id, shop_type, city, note, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`).run(
      id, shopName.slice(0, 60), String(body.contactName || '').slice(0, 40), phone.slice(0, 30),
      String(body.wechatId || '').slice(0, 40), String(body.shopType || '').slice(0, 30),
      String(body.city || '').slice(0, 40), String(body.note || '').slice(0, 300), now, now)
    return json(res, 201, { ok: true })
  }
  if (req.method === 'POST' && path === '/auth/google/demo') return json(res, 201, { user: registerGoogleDemoUser(await readBody(req)) })
  // 数据迁移入口:双重开关(ALLOW_DB_IMPORT 环境变量,迁移完立即关) + 强 token + 确认头 + 文件魔数校验
  if (req.method === 'POST' && path === '/admin/ops/import-db') {
    if (process.env.ALLOW_DB_IMPORT !== 'true') throw apiError(403, 'FORBIDDEN', 'DB import is disabled.')
    const auth = req.headers.authorization || ''
    if (auth !== `Bearer ${OWNER_TOKEN}`) throw apiError(401, 'UNAUTHORIZED', 'Owner token required.')
    if (req.headers['x-confirm-import'] !== 'yes') throw apiError(400, 'BAD_REQUEST', 'x-confirm-import: yes header is required.')
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const buffer = Buffer.concat(chunks)
    if (buffer.length < 4096 || !buffer.subarray(0, 15).toString('utf8').startsWith('SQLite format 3')) {
      throw apiError(400, 'BAD_REQUEST', '上传内容不是有效的 SQLite 数据库文件。')
    }
    writeFileSync(pendingImportPath, buffer)
    json(res, 201, { staged: true, bytes: buffer.length, note: '已暂存。服务将在 2 秒后重启并应用导入(原库自动留底份)。' })
    setTimeout(() => {
      console.log('[import] 重启以应用导入的数据库')
      process.exit(1)
    }, 2000)
    return
  }
  if (req.method === 'POST' && path === '/admin/auth/login') {
    const body = await readBody(req)
    const loginId = String(body.email || body.username || '').trim().toLowerCase()
    const password = String(body.password || '')
    // 1) 真实账号优先:用户名(或用户名当邮箱输入)+密码
    const account = db.prepare('SELECT * FROM admin_accounts WHERE LOWER(username) = ?').get(loginId)
    if (account) {
      if (account.status !== 'active') throw apiError(403, 'ACCOUNT_DISABLED', '该账号已被停用,请联系老板。')
      // 多租户已贯通(2026-07-17):登录后所有 /admin 请求按账号租户 scope,安全闸解除。
      if (adminPasswordHash(account.username, password) !== account.password_hash) {
        throw apiError(401, 'WRONG_PASSWORD', '密码不正确。员工忘记密码请找老板重置;老板忘记密码请联系平台。')
      }
      const rememberDays = body.remember === false ? 1 : 30
      const token = issueAdminSession(account.id, rememberDays)
      db.prepare('UPDATE admin_accounts SET last_login_at = ? WHERE id = ?').run(iso(new Date()), account.id)
      return json(res, 200, {
        auth: { accessToken: token, tokenType: 'bearer', expiresIn: rememberDays * 86400 },
        admin: {
          role: account.role,
          email: account.username,
          displayName: account.display_name,
          technicianId: account.technician_id || null,
          mustChangePassword: Boolean(account.must_change_password)
        },
        mode: 'account'
      })
    }
    // 2) 演示白名单兼容——仅本地开发开启(ALLOW_DEMO_ADMIN_LOGIN=true);云端默认禁用
    if (process.env.ALLOW_DEMO_ADMIN_LOGIN !== 'true') {
      throw apiError(403, 'FORBIDDEN', '账号不存在。请用正式账号登录(老板:boss;员工:老板发的账号)。')
    }
    const role = OWNER_EMAILS.includes(loginId) ? 'owner' : STAFF_EMAILS.includes(loginId) ? 'staff' : ''
    if (!role) throw apiError(403, 'FORBIDDEN', 'This account is not allowed to access admin.')
    if (role === 'staff' && password !== STAFF_DEMO_PASSWORD) throw apiError(403, 'FORBIDDEN', 'Staff demo password is incorrect.')
    const user = registerEmailUser({ email: loginId, displayName: role === 'staff' ? 'Lucky Luxe Staff' : 'Lucky Luxe Owner' })
    return json(res, 200, { user, auth: demoAuthFor(loginId, role), admin: adminForEmail(loginId, `demo-${role}`), mode: `demo-${role}` })
  }
  // 自助改密(账号体系):旧密码验证,改完清除强制改密标记并作废其他会话
  if (req.method === 'POST' && path === '/admin/auth/change-password') {
    const admin = requireAdmin(req)
    if (admin.provider !== 'account') throw apiError(400, 'BAD_REQUEST', '演示账号无需改密;请使用正式账号登录。')
    const body = await readBody(req)
    const account = db.prepare('SELECT * FROM admin_accounts WHERE id = ?').get(admin.accountId)
    if (adminPasswordHash(account.username, String(body.oldPassword || '')) !== account.password_hash) {
      throw apiError(401, 'WRONG_PASSWORD', '旧密码不正确。')
    }
    const next = String(body.newPassword || '')
    if (next.length < 6) throw apiError(400, 'BAD_REQUEST', '新密码至少 6 位。')
    if (next !== String(body.confirmPassword || '')) throw apiError(400, 'BAD_REQUEST', '两次输入的新密码不一致。')
    db.prepare('UPDATE admin_accounts SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?')
      .run(adminPasswordHash(account.username, next), iso(new Date()), account.id)
    // 作废其他会话,保留当前
    const current = (req.headers.authorization || '').slice(7)
    db.prepare('DELETE FROM admin_sessions WHERE account_id = ? AND token != ?').run(account.id, current)
    if (account.role === 'owner') { try { unlinkSync(OWNER_CREDENTIALS_FILE) } catch { /* 已删 */ } }
    return json(res, 200, { changed: true })
  }
  /* 员工账号管理(老板):列表/生成/重置密码/停用启用。
     🔴 2026-08-08 修:这三条路由排在租户上下文闸门之前,自己 requireAdmin 却没进上下文,
     currentTenantId() 一律回落旗舰店 —— 非旗舰商家看到的是旗舰店的员工账号列表,
     建账号则因为「技师不在旗舰店」直接 404。按登录账号自己的租户进上下文即可。 */
  if (req.method === 'GET' && path === '/admin/staff-accounts') {
    const admin = requireAdmin(req)
    if (admin.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    tenantContext.enterWith({ tenantId: admin.tenantId || DEFAULT_TENANT_ID })
    const rows = db.prepare("SELECT id, username, role, technician_id, status, must_change_password, last_login_at FROM admin_accounts WHERE role = 'staff' AND tenant_id = ? ORDER BY created_at ASC").all(currentTenantId())
    return json(res, 200, {
      accounts: rows.map((row) => ({
        id: row.id, username: row.username, technicianId: row.technician_id, status: row.status,
        mustChangePassword: Boolean(row.must_change_password), lastLoginAt: row.last_login_at
      }))
    })
  }
  if (req.method === 'POST' && path === '/admin/staff-accounts') {
    const admin = requireAdmin(req)
    if (admin.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    tenantContext.enterWith({ tenantId: admin.tenantId || DEFAULT_TENANT_ID })
    const body = await readBody(req)
    const tech = db.prepare('SELECT * FROM technicians WHERE id = ? AND tenant_id = ?').get(String(body.technicianId || ''), currentTenantId())
    if (!tech) throw apiError(404, 'NOT_FOUND', 'Technician not found.')
    if (db.prepare('SELECT id FROM admin_accounts WHERE technician_id = ?').get(tech.id)) {
      throw apiError(409, 'DUPLICATE', '该技师已有登录账号,可重置密码或停用。')
    }
    const base = tech.name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'staff'
    let username = base
    let suffix = 1
    while (db.prepare('SELECT id FROM admin_accounts WHERE LOWER(username) = ?').get(username)) { suffix += 1; username = `${base}${suffix}` }
    const initialPassword = randomPassword()
    db.prepare(`INSERT INTO admin_accounts (id, tenant_id, username, display_name, role, technician_id, password_hash, must_change_password, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'staff', ?, ?, 1, 'active', ?, ?)`)
      .run(randomId('acct'), currentTenantId(), username, tech.name, tech.id, adminPasswordHash(username, initialPassword), iso(new Date()), iso(new Date()))
    return json(res, 201, { username, initialPassword, note: '初始密码只显示这一次,请立即发给员工;员工首次登录会被要求改密。' })
  }
  const staffAcctMatch = path.match(/^\/admin\/staff-accounts\/([^/]+)\/(reset-password|toggle)$/)
  if (req.method === 'POST' && staffAcctMatch) {
    const admin = requireAdmin(req)
    if (admin.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    tenantContext.enterWith({ tenantId: admin.tenantId || DEFAULT_TENANT_ID })
    const account = db.prepare("SELECT * FROM admin_accounts WHERE id = ? AND role = 'staff' AND tenant_id = ?").get(staffAcctMatch[1], currentTenantId())
    if (!account) throw apiError(404, 'NOT_FOUND', 'Account not found.')
    if (staffAcctMatch[2] === 'reset-password') {
      const initialPassword = randomPassword()
      db.prepare('UPDATE admin_accounts SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?')
        .run(adminPasswordHash(account.username, initialPassword), iso(new Date()), account.id)
      db.prepare('DELETE FROM admin_sessions WHERE account_id = ?').run(account.id)
      return json(res, 200, { username: account.username, initialPassword })
    }
    const nextStatus = account.status === 'active' ? 'disabled' : 'active'
    db.prepare('UPDATE admin_accounts SET status = ?, updated_at = ? WHERE id = ?').run(nextStatus, iso(new Date()), account.id)
    if (nextStatus === 'disabled') db.prepare('DELETE FROM admin_sessions WHERE account_id = ?').run(account.id)
    return json(res, 200, { username: account.username, status: nextStatus })
  }
  if (req.method === 'POST' && path === '/admin/auth/register') {
    if (process.env.ALLOW_DEMO_ADMIN_LOGIN !== 'true') throw apiError(403, 'FORBIDDEN', '注册已停用。老板主账号由平台交付。')
    const body = await readBody(req)
    const email = String(body.email || '').trim().toLowerCase()
    if (!OWNER_EMAILS.includes(email)) throw apiError(403, 'FORBIDDEN', 'This email is not approved for owner admin.')
    const user = registerEmailUser({ email, displayName: 'Lucky Luxe Owner' })
    return json(res, 201, { user, auth: demoAuthFor(email, 'owner'), admin: { role: 'owner', email }, mode: 'demo-owner' })
  }
  if (req.method === 'GET' && path === '/admin/auth/me') {
    // 2026-08-03 附带店铺名:商家端「我的/管理」页顶部显示自己的店名(而非"老板"这类通用词)
    const me = requireAdmin(req)
    const t = db.prepare('SELECT name FROM tenants WHERE id = ?').get(me.tenantId || currentTenantId())
    return json(res, 200, { admin: Object.assign({}, me, { tenantName: t?.name || '' }) })
  }
  if (req.method === 'PATCH' && path === '/admin/auth/display-name') {
    // 2026-08-03 显示名自助修改(店主/员工都可改自己的):管理页顶部那行黑字
    const me = requireAdmin(req)
    if (!me.accountId) throw apiError(400, 'BAD_REQUEST', '演示 token 无法修改显示名,请用账号密码登录。')
    const body = await readBody(req)
    const displayName = String(body.displayName || '').trim().slice(0, 20)
    if (!displayName) throw apiError(400, 'BAD_REQUEST', '显示名不能为空。')
    db.prepare('UPDATE admin_accounts SET display_name = ?, updated_at = ? WHERE id = ?').run(displayName, iso(new Date()), me.accountId)
    return json(res, 200, { displayName })
  }
  if (req.method === 'GET' && path.startsWith('/users/')) {
    // 隐私:必须登录,且只能查自己的资料(此前任意 id 可读,已修)
    const customer = requireCustomer(req)
    const id = path.split('/')[2]
    if (id !== customer.id) throw apiError(403, 'FORBIDDEN', 'You can only view your own profile.')
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
    if (!user) throw apiError(404, 'NOT_FOUND', 'User not found.')
    return json(res, 200, { user: serializeUser(user, resolveTenant(req, query)) })
  }
  if (req.method === 'GET' && path === '/stores') {
    // 附带每周营业时间(hours),供顾客端首页店卡展示"今日营业时间/营业中"。加字段向后兼容。
    const tid = resolveTenant(req, query)
    const storeRows = db.prepare('SELECT * FROM stores WHERE is_active = 1 AND tenant_id = ?').all(tid)
    const hourStmt = db.prepare('SELECT weekday, open_time, close_time, is_closed FROM business_hours WHERE store_id = ? ORDER BY weekday ASC')
    // aiEnabled:顾客端据此决定要不要显示「AI 在线客服」「AI 款式建议」入口。
    // 没开通就别把按钮摆在顾客面前——点了没结果比没有按钮更伤体验。只暴露布尔值,不泄露套餐信息。
    return json(res, 200, {
      aiEnabled: checkEntitlement(tid, AI_ADDON.feature),
      stores: storeRows.map((s) => Object.assign({}, s, { hours: hourStmt.all(s.id) }))
    })
  }
  if (req.method === 'GET' && path === '/services') {
    const args = [resolveTenant(req, query)]
    let sql = 'SELECT * FROM services WHERE is_active = 1 AND tenant_id = ?'
    if (query.type === 'care') {
      // 顾客端「护理·其他」tab:聚合 CARE + OTHER 两类
      sql += " AND type IN ('CARE', 'OTHER')"
    } else if (query.type) {
      sql += ' AND type = ?'
      args.push(query.type.toUpperCase())
    }
    sql += ' ORDER BY type ASC, sort_order ASC'
    return json(res, 200, { services: db.prepare(sql).all(...args).map((service) => serializeService(service, query.lang || 'zh')) })
  }
  if (req.method === 'GET' && path === '/technicians') {
    const args = [resolveTenant(req, query)]
    let sql = 'SELECT DISTINCT t.* FROM technicians t LEFT JOIN technician_services ts ON ts.technician_id = t.id WHERE t.is_active = 1 AND t.tenant_id = ?'
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
    // 2026-07-20 方案B:除按技师分组(portfolios,保留兼容)外,平铺 works(带品类/技师)+ categories
    // 品类来自作品所属订单的服务类型——该店没开的品类天然不会出现
    const rows = db.prepare(`
      SELECT b.*, t.name AS tech_name, t.title AS tech_title, s.type AS service_type, s.name_zh AS service_name
      FROM bookings b
      JOIN technicians t ON t.id = b.technician_id
      LEFT JOIN services s ON s.id = b.service_id
      WHERE b.gallery_status = 'approved' AND b.tenant_id = ?
      ORDER BY b.gallery_locked_at DESC, b.appointment_start DESC
    `).all(resolveTenant(req, query))
    const grouped = new Map()
    const works = []
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
      images.forEach((image, idx) => works.push({
        id: `${row.id}:${idx}`,
        image,
        technician: { id: row.technician_id, name: row.tech_name, title: row.tech_title },
        serviceType: row.service_type || '',
        serviceName: row.service_name || ''
      }))
    }
    const categories = [...new Set(works.map((w) => w.serviceType).filter(Boolean))]
    return json(res, 200, { portfolios: [...grouped.values()], works, categories })
  }
  if (req.method === 'GET' && path === '/add-ons') return json(res, 200, { addOns })
  if (req.method === 'GET' && path === '/availability') {
    expireOldHolds()
    // 多租户:storeId 必须属于"当前进的店",防止跨店查可约时段
    const tid = resolveTenant(req, query)
    if (query.storeId) {
      const s = db.prepare('SELECT tenant_id FROM stores WHERE id = ?').get(query.storeId)
      if (s && s.tenant_id !== tid) throw apiError(404, 'NOT_FOUND', 'Store not found in this shop.')
    }
    return json(res, 200, getAvailability(query))
  }
  // 公开门店列表(兜底进店:顾客没带店标识时选择进入哪家)
  if (req.method === 'GET' && path === '/shops') {
    // 默认不返回演示门店(顾客看不到);店主在小程序里开「演示模式」时带 ?include=demo 才返回。
    const includeDemo = String(query.include || '') === 'demo' ? 1 : 0
    const rows = db.prepare(`
      SELECT t.id, t.name AS tenant_name, s.name AS store_name, s.address, s.phone
      FROM tenants t
      JOIN stores s ON s.tenant_id = t.id AND s.is_active = 1
      WHERE t.status = 'active' AND (t.id NOT LIKE 'demo-%' OR ? = 1)
      GROUP BY t.id
      ORDER BY t.name ASC
    `).all(includeDemo)
    return json(res, 200, {
      shops: rows.map((r) => ({
        tenantId: r.id, name: r.tenant_name || r.store_name, storeName: r.store_name,
        address: r.address || '', phone: r.phone || '', isDemo: String(r.id).startsWith('demo-')
      }))
    })
  }
  if (req.method === 'GET' && path.startsWith('/booking-drafts/')) {
    const draft = getBookingDraftById(path.split('/')[2], query.lang || 'zh')
    if (!draft) throw apiError(404, 'NOT_FOUND', 'Booking draft not found.')
    return json(res, 200, { bookingDraft: draft })
  }
  if (req.method === 'POST' && path === '/bookings') {
    // 安全:必须登录,且强制以登录用户下单(此前不鉴权 + userId 取自请求体,可匿名/冒用他人下单)
    const customer = requireCustomer(req)
    const body = await readBody(req)
    body.userId = customer.id
    body.tenantId = resolveTenant(req, query) // 多租户:订单归属"当前进的店"
    return json(res, 201, { booking: createBooking(body) })
  }
  // ===== 顾客侧"我的资产"(user × 当前店) =====
  if (req.method === 'GET' && path === '/my/coupons') {
    const customer = requireCustomer(req)
    const tid = resolveTenant(req, query)
    const nowIso = iso(new Date())
    db.prepare("UPDATE coupon_grants SET status = 'expired' WHERE user_id = ? AND tenant_id = ? AND status = 'active' AND expires_at < ?").run(customer.id, tid, nowIso)
    const rows = db.prepare(`SELECT g.id, g.code, g.status, g.expires_at, g.used_at, c.name, c.discount_type, c.amount_cents, c.percent_off, c.min_spend_cents
      FROM coupon_grants g JOIN coupons c ON c.id = g.coupon_id
      WHERE g.user_id = ? AND g.tenant_id = ? ORDER BY g.created_at DESC`).all(customer.id, tid)
    return json(res, 200, {
      coupons: rows.map((r) => ({
        id: r.id, code: r.code, status: r.status, name: r.name,
        discountType: r.discount_type, amountCents: r.amount_cents, percentOff: r.percent_off, minSpendCents: r.min_spend_cents,
        expiresAt: r.expires_at, usedAt: r.used_at
      }))
    })
  }
  if (req.method === 'GET' && path === '/my/stored-value') {
    const customer = requireCustomer(req)
    const tid = resolveTenant(req, query)
    const txns = db.prepare('SELECT type, amount_cents, pay_channel, note, created_at FROM stored_value_transactions WHERE user_id = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT 50').all(customer.id, tid)
    return json(res, 200, {
      balanceCents: storedValueBalanceCents(customer.id, tid),
      txns: txns.map((t) => ({ type: t.type, amountCents: t.amount_cents, payChannel: t.pay_channel, note: t.note || '', createdAt: t.created_at }))
    })
  }
  // ===== 积分商城(顾客) =====
  if (req.method === 'GET' && path === '/my/points-mall') {
    const customer = requireCustomer(req)
    const tid = resolveTenant(req, query)
    const balance = pointsBalance(customer.id, tid)
    const prizes = db.prepare('SELECT * FROM points_prizes WHERE tenant_id = ? AND is_active = 1 ORDER BY cost_points ASC').all(tid)
      .map((r) => {
        const p = serializePrize(r)
        const myCount = db.prepare("SELECT COUNT(*) AS c FROM points_transactions WHERE tenant_id = ? AND user_id = ? AND type = 'redeem' AND note LIKE ?").get(tid, customer.id, `%#${r.id}`).c
        return Object.assign(p, {
          soldOut: r.stock <= 0,
          limitReached: r.per_user_limit > 0 && myCount >= r.per_user_limit,
          canRedeem: balance >= r.cost_points && r.stock > 0 && !(r.per_user_limit > 0 && myCount >= r.per_user_limit)
        })
      })
    // 明细:赚分(完成单推导)+ 台账(兑换/冲正)合并按时间倒序
    const earns = db.prepare(`SELECT b.id, b.appointment_start AS at, b.service_price_cents AS cents, s.name_zh AS sname
      FROM bookings b LEFT JOIN services s ON s.id = b.service_id
      WHERE b.user_id = ? AND b.tenant_id = ? AND b.status = 'COMPLETED' ORDER BY b.appointment_start DESC LIMIT 20`).all(customer.id, tid)
      .map((r) => ({ title: `到店消费 · ${r.sname || '服务'}`, at: r.at, delta: Math.floor((r.cents || 0) / 100) }))
    const ledger = db.prepare('SELECT type, amount, note, created_at FROM points_transactions WHERE user_id = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT 20').all(customer.id, tid)
      .map((r) => ({ title: r.note || (r.type === 'redeem' ? '积分兑换' : '积分退回'), at: r.created_at, delta: r.amount }))
    const history = earns.concat(ledger).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 25)
      .map((h) => ({ title: h.title.split(' #')[0], date: localParts(h.at).date, delta: h.delta }))
    return json(res, 200, { balance, prizes, history })
  }
  if (req.method === 'POST' && path === '/my/points-mall/redeem') {
    const customer = requireCustomer(req)
    const tid = resolveTenant(req, query)
    const body = await readBody(req)
    const prize = db.prepare('SELECT * FROM points_prizes WHERE id = ? AND tenant_id = ?').get(String(body.prizeId || ''), tid)
    if (!prize || !prize.is_active) throw apiError(404, 'NOT_FOUND', '该奖品已下架。')
    const coupon = db.prepare('SELECT * FROM coupons WHERE id = ?').get(prize.coupon_id)
    if (!coupon || !coupon.is_active) throw apiError(400, 'BAD_REQUEST', '该奖品对应的券已停用,请联系门店。')
    db.exec('BEGIN IMMEDIATE')
    try {
      // 事务内复核:库存 / 每人限兑 / 余额
      const fresh = db.prepare('SELECT * FROM points_prizes WHERE id = ?').get(prize.id)
      if (fresh.stock <= 0) throw apiError(409, 'SOLD_OUT', '手慢了,已兑完。')
      if (fresh.per_user_limit > 0) {
        const my = db.prepare("SELECT COUNT(*) AS c FROM points_transactions WHERE tenant_id = ? AND user_id = ? AND type = 'redeem' AND note LIKE ?").get(tid, customer.id, `%#${prize.id}`).c
        if (my >= fresh.per_user_limit) throw apiError(409, 'LIMIT', `该奖品每人限兑 ${fresh.per_user_limit} 次。`)
      }
      const balance = pointsBalance(customer.id, tid)
      if (balance < fresh.cost_points) throw apiError(400, 'INSUFFICIENT', `积分不足:需 ${fresh.cost_points},当前 ${balance}。`)
      // 发券(有效期:奖品覆盖 > 券模板)
      const code = `LL-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
      const days = fresh.valid_days || coupon.valid_days || 30
      const expiresAt = iso(new Date(Date.now() + days * 86400000))
      const grantId = randomId('grant')
      db.prepare(`INSERT INTO coupon_grants (id, tenant_id, coupon_id, user_id, code, status, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`).run(grantId, tid, coupon.id, customer.id, code, expiresAt, iso(new Date()))
      db.prepare('UPDATE coupons SET issued_qty = issued_qty + 1 WHERE id = ?').run(coupon.id)
      // 扣积分(台账只追加;note 末尾 #prizeId 供限兑统计与撤销回补)
      db.prepare('INSERT INTO points_transactions (id, tenant_id, user_id, type, amount, ref_id, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(randomId('pts'), tid, customer.id, 'redeem', -fresh.cost_points, grantId, `兑换 · ${coupon.name} #${prize.id}`, customer.id, iso(new Date()))
      db.prepare('UPDATE points_prizes SET stock = stock - 1, redeemed_qty = redeemed_qty + 1, updated_at = ? WHERE id = ?').run(iso(new Date()), prize.id)
      db.exec('COMMIT')
      return json(res, 200, { ok: true, code, expiresAt, balance: pointsBalance(customer.id, tid), couponName: coupon.name })
    } catch (error) { db.exec('ROLLBACK'); throw error }
  }
  if (req.method === 'GET' && path === '/my/points-history') {
    const customer = requireCustomer(req)
    const tid = resolveTenant(req, query)
    // 积分台账(权威版):由本店已完成订单推导,消费 $1 = 1 分;兑换扣分待积分商城接入
    const rows = db.prepare(`SELECT b.id, b.appointment_start, b.service_price_cents, s.name_zh AS service_name
      FROM bookings b LEFT JOIN services s ON s.id = b.service_id
      WHERE b.user_id = ? AND b.tenant_id = ? AND b.status = 'COMPLETED' ORDER BY b.appointment_start DESC LIMIT 50`).all(customer.id, tid)
    return json(res, 200, {
      records: rows.map((r) => ({
        id: r.id, title: '消费获得 · ' + (r.service_name || '服务'),
        date: localParts(r.appointment_start).date, delta: Math.floor((r.service_price_cents || 0) / 100)
      }))
    })
  }
  if (req.method === 'GET' && path === '/bookings') {
    // 隐私+一致性+多租户:必须登录,只返回本人在"当前进的店"的订单
    const customer = requireCustomer(req)
    const tenantId = resolveTenant(req, query)
    return json(res, 200, {
      bookings: db.prepare('SELECT * FROM bookings WHERE user_id = ? AND tenant_id = ? ORDER BY appointment_start DESC').all(customer.id, tenantId)
        .map((booking) => serializeBooking(booking, query.lang || 'zh'))
    })
  }
  if (req.method === 'POST' && path === '/payments/mock/confirm') {
    // 安全:必须登录,且只能为自己的订单确认支付(此前无鉴权,可标记他人订单已付)。正式上线由微信支付回调(服务端验签)取代。
    const customer = requireCustomer(req)
    const body = await readBody(req)
    const target = db.prepare('SELECT user_id FROM bookings WHERE id = ?').get(body.bookingId)
    if (!target) throw apiError(404, 'NOT_FOUND', 'Booking not found.')
    if (target.user_id !== customer.id) throw apiError(403, 'FORBIDDEN', 'You can only pay for your own booking.')
    return json(res, 200, { booking: confirmMockPayment(body) })
  }
  if (req.method === 'POST' && path === '/payments/stripe/create-checkout') {
    const body = await readBody(req)
    return json(res, 200, { provider: 'mock-stripe', booking: confirmMockPayment(body), bookingId: body.bookingId })
  }
  if (req.method === 'POST' && path === '/payments/stripe/confirm-session') {
    return json(res, 200, { provider: 'mock-stripe', booking: confirmMockPayment(await readBody(req)) })
  }
  if (req.method === 'GET' && path.startsWith('/bookings/')) {
    const id = path.split('/')[2]
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id)
    if (!booking) throw apiError(404, 'NOT_FOUND', 'Booking not found.')
    return json(res, 200, { booking: serializeBooking(booking, query.lang || 'zh') })
  }
  if (req.method === 'POST' && path.startsWith('/bookings/') && path.endsWith('/cancel')) {
    // 安全:必须登录,且只能取消自己的订单(此前无鉴权,可取消任意订单)
    const customer = requireCustomer(req)
    const bid = path.split('/')[2]
    const target = db.prepare('SELECT user_id FROM bookings WHERE id = ?').get(bid)
    if (!target) throw apiError(404, 'NOT_FOUND', 'Booking not found.')
    if (target.user_id !== customer.id) throw apiError(403, 'FORBIDDEN', 'You can only cancel your own booking.')
    return json(res, 200, cancelBooking(bid, await readBody(req)))
  }
  // 参考图分析:原先**无任何身份校验、无套餐闸门**,任何人拿到域名就能循环烧 AI 额度(单图 300KB、每次 3 张)。
  // 现在:必须是登录顾客或商家 + 必须按顾客所在门店判断 AI 智能包。
  if (req.method === 'POST' && path === '/ai/reference-analysis') {
    tenantContext.enterWith({ tenantId: resolveTenant(req, query) })
    requireCustomerOrAdmin(req)
    requireAi()
    const body = await readBody(req)
    countAiUsage()
    return json(res, 200, { analysis: await analyzeReferenceImage(body) })
  }
  // 社媒文案(顾客侧):同上,原先也是公开无闸门
  if (req.method === 'POST' && path === '/ai/social-copy') {
    tenantContext.enterWith({ tenantId: resolveTenant(req, query) })
    requireCustomerOrAdmin(req)
    requireAi()
    const body = await readBody(req)
    const row = body.bookingId ? db.prepare('SELECT * FROM bookings WHERE id = ?').get(body.bookingId) : null
    const booking = row ? serializeBooking(row, body.lang || 'zh') : body.booking
    countAiUsage()
    return json(res, 200, { copy: await createSocialCopy({ lang: body.lang || 'zh', image: body.image || '', booking, platform: body.platform || 'xiaohongshu', audience: body.audience || 'customer', avoidCaptions: body.avoidCaptions || [], variantSeed: body.variantSeed || '' }) })
  }
  if (req.method === 'POST' && path === '/ai/customer-service') {
    // 多租户:AI 客服按"顾客当前进的店"取知识/服务/事实回答
    tenantContext.enterWith({ tenantId: resolveTenant(req, query) })
    if (!checkEntitlement(currentTenantId(), 'ai_customer_service')) {
      // 2026-08-04 修:原文案是「已为你转接人工，店员看到后会尽快回复」——但这里直接 return 了,
      // 消息根本没写进会话库,商家的客服工作台是空的,顾客在等一个永远不会来的回复。
      // 现在改成不撒谎:告诉顾客怎么真的联系到店(小程序自助预约 / 门店电话)。
      const st = db.prepare('SELECT phone FROM stores WHERE tenant_id = ? AND is_active = 1 AND phone IS NOT NULL AND phone <> \'\' LIMIT 1').get(currentTenantId())
      const tel = st?.phone ? `，或致电 ${st.phone} 联系门店` : ''
      const telEn = st?.phone ? `, or call us at ${st.phone}` : ''
      return json(res, 200, {
        reply: {
          data: {
            intent: 'entitlement_disabled',
            answerZh: `这边暂时不支持在线答复~你可以直接在小程序里选择项目预约${tel}，我们会尽快为你安排。`,
            answerEn: `Online replies are unavailable here right now. You can book directly in the mini-program${telEn}, and we'll take care of you.`,
            handoffRequired: false
          },
          source: 'entitlement_gate'
        }
      })
    }
    const body = await readBody(req)
    const context = buildCustomerServiceContext(req, body.lang || 'zh')
    const knowledgeContext = attachOwnerApprovedSamples(buildKnowledgeContext({
      lang: body.lang || 'zh',
      message: body.message || '',
      ...context,
      sourceChannel: body.sourceChannel || body.source || '',
      customerStage: body.customerStage || body.stage || '',
      referenceImages: body.referenceImages || body.images || [],
      liveTenantFacts: liveTenantFacts(),
      platformKb: platformKbOverride(),
      tenantDocuments: tenantKbDocumentsForPrompt(currentTenantId())
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
  if (path.startsWith('/admin/')) {
    adminSession = requireAdmin(req)
    // 多租户贯通:本请求内所有 currentTenantId() 都按登录账号的租户走(财务/KB/套餐/券/储值等自动隔离)
    tenantContext.enterWith({ tenantId: adminSession.tenantId || DEFAULT_TENANT_ID })
  }
  if (req.method === 'GET' && path === '/admin/wechat/status') {
    return json(res, 200, { wechat: wecomConfigStatus() })
  }
  if (req.method === 'GET' && path === '/admin/wechat/conversations') {
    return json(res, 200, { conversations: getWecomConversations() })
  }
  if (req.method === 'GET' && path === '/admin/ai/customer-service/feedback') {
    requireAi()
    return json(res, 200, { feedback: getAiResponseFeedback({ limit: Number(query.limit || 40), status: query.status || 'approved' }) })
  }
  if (req.method === 'POST' && path === '/admin/ai/customer-service/feedback') {
    requireAi()
    return json(res, 201, saveAiResponseFeedback(await readBody(req), adminSession))
  }
  if (req.method === 'POST' && path === '/admin/ai/customer-service/logic-notes') {
    return json(res, 201, saveAiLogicNote(await readBody(req), adminSession))
  }
  if (req.method === 'POST' && path === '/admin/wechat/mock-chat-message') {
    const chatStartedAt = Date.now()
    console.log(`[chat] ${new Date().toISOString()} 收到进线请求`)
    const body = await readBody(req)
    console.log(`[chat] +${Date.now() - chatStartedAt}ms 消息内容: ${String(body.message || body.content || '').slice(0, 40)}`)
    const inbound = normalizeWecomInbound({
      externalUserId: body.externalUserId || body.customerId || 'mock-chat-customer',
      openKfid: body.openKfid || WECOM_OPEN_KFID || 'mock-open-kfid',
      content: body.message || body.content || '',
      sourceChannel: body.sourceChannel || body.source || 'mock-chat',
      lang: body.lang || 'zh',
      referenceImages: body.referenceImages || body.images || [],
      customerStage: body.customerStage || body.stage || '',
      customerType: body.customerType || body.customer_type || '',
      memberTier: body.memberTier || body.member_tier || '',
      points: Number(body.points || body.memberPoints || body.member_points || 0) || 0,
      forceAi: Boolean(body.forceAi || body.force_ai),
      raw: { mockChat: true, ...body }
    })
    const chatResult = await handleWecomInbound(inbound, req)
    console.log(`[chat] +${Date.now() - chatStartedAt}ms 回复完成 intent=${chatResult?.reply?.data?.intent || (chatResult?.entitlementBlocked ? 'entitlement_blocked' : 'silent/none')}`)
    return json(res, 201, chatResult)
  }
  // 会话绑定会员:把外部聊天账号与会员档案关联(互链的另一半)
  const linkMemberMatch = path.match(/^\/admin\/wechat\/conversations\/(.+)\/link-member$/)
  if (req.method === 'POST' && linkMemberMatch) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const conversationId = decodeURIComponent(linkMemberMatch[1])
    const row = db.prepare('SELECT * FROM wechat_conversations WHERE id = ?').get(conversationId)
    if (!row) throw apiError(404, 'NOT_FOUND', 'Conversation not found.')
    const body = await readBody(req)
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(String(body.userId || ''))
    if (!user) throw apiError(404, 'NOT_FOUND', 'Customer not found.')
    upsertUserIdentity({
      userId: user.id,
      provider: row.provider || 'wecom_customer_service',
      providerUserId: row.external_user_id
    })
    return json(res, 200, { conversation: getWecomConversation(conversationId) })
  }
  const manualReplyMatch = path.match(/^\/admin\/wechat\/conversations\/(.+)\/manual-reply$/)
  if (req.method === 'POST' && manualReplyMatch) {
    return json(res, 201, await appendManualWecomReply(decodeURIComponent(manualReplyMatch[1]), await readBody(req), adminSession))
  }
  const handoffOwnerMatch = path.match(/^\/admin\/wechat\/conversations\/(.+)\/(take-over|release-to-ai)$/)
  if (req.method === 'POST' && handoffOwnerMatch) {
    const conversationId = decodeURIComponent(handoffOwnerMatch[1])
    const ownerRole = handoffOwnerMatch[2] === 'take-over' ? 'human' : 'ai'
    return json(res, 200, setConversationHandoffOwner(conversationId, ownerRole, adminSession))
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
    return json(res, 201, await handleWecomInbound(inbound, req))
  }
  if (req.method === 'GET' && path === '/admin/quote-requests') {
    return json(res, 200, { quoteRequests: getAdminQuoteRequests(adminSession) })
  }
  if (req.method === 'POST' && path === '/admin/quote-requests') {
    return json(res, 201, { quoteRequest: createQuoteRequest(await readBody(req)) })
  }
  if ((req.method === 'POST' || req.method === 'PATCH') && path.startsWith('/admin/quote-requests/') && path.endsWith('/respond')) {
    return json(res, 200, { quoteRequest: await respondQuoteRequest(path.split('/')[3], await readBody(req), adminSession) })
  }
  if ((req.method === 'POST' || req.method === 'PATCH') && path.startsWith('/admin/quote-requests/') && path.endsWith('/draft')) {
    return json(res, 200, { quoteRequest: createQuoteDraftHold(path.split('/')[3], await readBody(req), adminSession) })
  }
  if (req.method === 'POST' && path === '/admin/booking-drafts') {
    return json(res, 201, { bookingDraft: createBookingDraft(await readBody(req), adminSession) })
  }
  if (req.method === 'GET' && path === '/admin/reminder-tasks') {
    return json(res, 200, { reminderTasks: getAdminReminderTasks(adminSession) })
  }
  if ((req.method === 'POST' || req.method === 'PATCH') && path.startsWith('/admin/reminder-tasks/') && path.endsWith('/status')) {
    return json(res, 200, { reminderTask: markReminderTask(path.split('/')[3], (await readBody(req)).status) })
  }
  if (req.method === 'GET' && path === '/admin/bookings') {
    const rows = adminSession.role === 'staff'
      ? db.prepare('SELECT * FROM bookings WHERE tenant_id = ? AND technician_id = ? ORDER BY appointment_start DESC').all(currentTenantId(), adminSession.technicianId)
      : db.prepare('SELECT * FROM bookings WHERE tenant_id = ? ORDER BY appointment_start DESC').all(currentTenantId())
    // 服务安全:管理端订单随单携带顾客标签/备注(过敏史/忌讳),技师上钟前必看;不开放完整客户库
    const careStmt = db.prepare('SELECT tags_json, notes FROM users WHERE id = ?')
    return json(res, 200, {
      bookings: rows.map((booking) => {
        const serialized = serializeBooking(booking)
        const care = booking.user_id ? careStmt.get(booking.user_id) : null
        serialized.customerCare = {
          tags: care ? (parseJson(care.tags_json) || []) : [],
          notes: care?.notes || ''
        }
        return serialized
      })
    })
  }
  if (req.method === 'GET' && path === '/admin/customers') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    return json(res, 200, { customers: getAdminCustomers() })
  }
  if (req.method === 'POST' && path === '/admin/finance/summary') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    return json(res, 200, { finance: getFinanceSummary(await readBody(req)) })
  }
  if (req.method === 'POST' && path === '/admin/ai/daily-brief') {
    requireAi()
    const bookings = adminSession.role === 'staff'
      ? db.prepare('SELECT * FROM bookings WHERE tenant_id = ? AND technician_id = ? ORDER BY appointment_start DESC LIMIT 60').all(currentTenantId(), adminSession.technicianId).map((booking) => serializeBooking(booking))
      : db.prepare('SELECT * FROM bookings WHERE tenant_id = ? ORDER BY appointment_start DESC LIMIT 60').all(currentTenantId()).map((booking) => serializeBooking(booking))
    const services = db.prepare('SELECT * FROM services WHERE tenant_id = ? ORDER BY type ASC, sort_order ASC').all(currentTenantId()).map(serializeService)
    countAiUsage()
    return json(res, 200, { brief: await createDailyBrief({ ...(await readBody(req)), bookings, customers: adminSession.role === 'owner' ? getAdminCustomers() : [], services }) })
  }
  if (req.method === 'POST' && path === '/admin/ai/booking-summary') {
    requireAi()
    const body = await readBody(req)
    const row = db.prepare('SELECT * FROM bookings WHERE id = ?').get(body.bookingId)
    if (!row) throw apiError(404, 'NOT_FOUND', 'Booking not found.')
    assertStaffCanAccessBooking(adminSession, row)
    countAiUsage()
    return json(res, 200, { summary: await createBookingSummary({ lang: body.lang || 'zh', booking: serializeBooking(row, body.lang || 'zh') }) })
  }
  if (req.method === 'POST' && path === '/admin/ai/customer-insight') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    requireAi()
    const body = await readBody(req)
    const customer = getAdminCustomers().find((item) => item.id === body.customerId)
    if (!customer) throw apiError(404, 'NOT_FOUND', 'Customer not found.')
    const bookings = db.prepare('SELECT * FROM bookings WHERE user_id = ? ORDER BY appointment_start DESC LIMIT 12').all(customer.id).map((booking) => serializeBooking(booking, body.lang || 'zh'))
    countAiUsage()
    return json(res, 200, { insight: await createCustomerInsight({ lang: body.lang || 'zh', customer, bookings }) })
  }
  if (req.method === 'POST' && path === '/admin/ai/social-copy') {
    requireAi()
    const body = await readBody(req)
    const row = body.bookingId ? db.prepare('SELECT * FROM bookings WHERE id = ?').get(body.bookingId) : null
    if (row) assertStaffCanAccessBooking(adminSession, row)
    const booking = row ? serializeBooking(row, body.lang || 'zh') : body.booking
    countAiUsage()
    return json(res, 200, { copy: await createSocialCopy({ lang: body.lang || 'zh', image: body.image || '', booking, platform: body.platform || 'xiaohongshu', audience: body.audience || 'staff', avoidCaptions: body.avoidCaptions || [], variantSeed: body.variantSeed || '' }) })
  }
  if (req.method === 'GET' && path === '/admin/services') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    return json(res, 200, { services: db.prepare('SELECT * FROM services WHERE tenant_id = ? ORDER BY type ASC, sort_order ASC').all(currentTenantId()).map(serializeService) })
  }
  if (req.method === 'POST' && path === '/admin/services') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const payload = servicePayload(await readBody(req))
    if (!['NAIL', 'LASH', 'CARE', 'OTHER'].includes(payload.type)) throw apiError(400, 'BAD_REQUEST', '服务类型须为 美甲/美睫/护理/其他。')
    if (!payload.nameZh || !payload.nameEn) throw apiError(400, 'BAD_REQUEST', 'Service name is required.')
    const id = serviceIdFrom(payload)
    db.prepare(`INSERT INTO services
      (id, tenant_id, type, category, name_zh, name_en, description_zh, description_en, image_url, price_cents, deposit_cents, base_duration_min, sort_order, is_active, process_json, notice_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, currentTenantId(), payload.type, payload.category, payload.nameZh, payload.nameEn, payload.descriptionZh, payload.descriptionEn, payload.imageUrl, payload.priceCents, payload.depositCents, payload.baseDurationMin, payload.sortOrder, payload.isActive, JSON.stringify(payload.processJson), JSON.stringify(payload.noticeJson))
    // 2026-08-06:老「服务管理」页也走多价位模型的 list 档,保证 price_cents 与 service_prices(list) 永不漂移
    upsertServicePrice(currentTenantId(), id, 'list', payload.priceCents)
    const assign = db.prepare('INSERT OR IGNORE INTO technician_services (technician_id, service_id) VALUES (?, ?)')
    for (const tech of db.prepare('SELECT id FROM technicians WHERE is_active = 1 AND tenant_id = ?').all(currentTenantId())) assign.run(tech.id, id)
    return json(res, 201, { service: serializeService(getService(id)) })
  }
  if (req.method === 'GET' && path === '/admin/technicians') {
    // roster=1:本店在职名单(结算开单要勾主/副技师,员工也得看得见同事)。
    // 台面日视图早就把整店技师列给员工看了,这里不多暴露任何东西;默认行为不变。
    const technicians = adminSession.role === 'staff' && query.roster !== '1'
      ? db.prepare('SELECT * FROM technicians WHERE tenant_id = ? AND id = ? ORDER BY name ASC').all(currentTenantId(), adminSession.technicianId)
      : db.prepare('SELECT * FROM technicians WHERE tenant_id = ? ORDER BY name ASC').all(currentTenantId())
    return json(res, 200, { technicians })
  }
  if (req.method === 'PATCH' && path.startsWith('/admin/services/')) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const id = path.split('/')[3]
    const body = await readBody(req)
    const current = getService(id)
    if (!current || (current.tenant_id && current.tenant_id !== currentTenantId())) throw apiError(404, 'NOT_FOUND', 'Service not found.')
    const payload = servicePayload(body, current)
    db.prepare(`UPDATE services SET
      type = ?, category = ?, name_zh = ?, name_en = ?, description_zh = ?, description_en = ?, image_url = ?,
      price_cents = ?, deposit_cents = ?, base_duration_min = ?, is_active = ?, sort_order = ?, process_json = ?, notice_json = ?
      WHERE id = ?`).run(payload.type, payload.category, payload.nameZh, payload.nameEn, payload.descriptionZh, payload.descriptionEn, payload.imageUrl, payload.priceCents, payload.depositCents, payload.baseDurationMin, payload.isActive, payload.sortOrder, JSON.stringify(payload.processJson), JSON.stringify(payload.noticeJson), id)
    upsertServicePrice(currentTenantId(), id, 'list', payload.priceCents) // 同上:改价即同步 list 档
    return json(res, 200, { service: serializeService(getService(id)) })
  }
  // ===== P1 结算(技师端开单)=====
  if (req.method === 'POST' && path === '/admin/settlements/preview') {
    // 技师端表单实时试算:不落库,金额口径与正式开单完全一致
    const body = await readBody(req)
    return json(res, 200, { settlement: computeSettlement({ ...body, tenantId: currentTenantId() }) })
  }
  if (req.method === 'POST' && path === '/admin/settlements') {
    if (adminSession.role !== 'owner' && adminSession.role !== 'staff') throw apiError(403, 'FORBIDDEN', '需要员工或老板权限。')
    const body = await readBody(req)
    return json(res, 201, createSettlementGroup(body, adminSession))
  }
  if (req.method === 'GET' && path === '/admin/settlements') {
    const tid = currentTenantId()
    const rows = query.groupId
      ? db.prepare('SELECT * FROM settlements WHERE tenant_id = ? AND group_id = ? ORDER BY rowid ASC').all(tid, query.groupId)
      : (query.bookingId
        ? db.prepare('SELECT * FROM settlements WHERE tenant_id = ? AND booking_id = ? ORDER BY rowid DESC').all(tid, query.bookingId)
        : db.prepare('SELECT * FROM settlements WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 60').all(tid))
    return json(res, 200, { settlements: rows.map((r) => serializeSettlement(r)) })
  }
  if (req.method === 'POST' && path.startsWith('/admin/settlements/') && path.endsWith('/amend')) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '只有老板可以更正已签单据。')
    const id = path.split('/')[3]
    const body = await readBody(req)
    return json(res, 200, amendSettlement(id, body, adminSession))
  }
  if (req.method === 'POST' && path.startsWith('/admin/settlements/') && path.endsWith('/aftersales')) {
    const id = path.split('/')[3]
    const row = db.prepare('SELECT * FROM settlements WHERE id = ? AND tenant_id = ?').get(id, currentTenantId())
    if (!row) throw apiError(404, 'NOT_FOUND', 'Settlement not found.')
    const body = await readBody(req)
    db.prepare('UPDATE settlements SET aftersales_status = ?, updated_at = ? WHERE id = ?')
      .run(String(body.status || 'in_progress').slice(0, 20), iso(new Date()), id)
    return json(res, 200, { settlement: serializeSettlement(db.prepare('SELECT * FROM settlements WHERE id = ?').get(id)) })
  }
  // ===== P1.2 定金规则(商家自助)=====
  if (path === '/admin/deposit-config') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const tid = currentTenantId()
    if (req.method === 'GET') {
      const config = getDepositConfig(tid)
      return json(res, 200, {
        config,
        onlinePaymentReady: ONLINE_PAYMENT_READY,
        keyFacts: { zh: depositKeyFacts(config, 'zh'), en: depositKeyFacts(config, 'en') },
        text: { zh: depositPolicyText(config, tid, 'zh'), en: depositPolicyText(config, tid, 'en') }
      })
    }
    if (req.method === 'PUT') {
      const body = await readBody(req)
      const config = setDepositConfig(tid, body.config && typeof body.config === 'object' ? body.config : body)
      return json(res, 200, {
        config,
        keyFacts: { zh: depositKeyFacts(config, 'zh'), en: depositKeyFacts(config, 'en') },
        text: { zh: depositPolicyText(config, tid, 'zh'), en: depositPolicyText(config, tid, 'en') }
      })
    }
  }
  // ===== P1.2 话术模板中心(本批只建模 + 配置,发送引擎归 P3)=====
  if (path === '/admin/message-templates' || path.startsWith('/admin/message-templates/')) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const tid = currentTenantId()
    const tplId = path.split('/')[3] || null
    if (req.method === 'GET' && !tplId) {
      ensureDefaultMessageTemplates(tid)
      const rows = db.prepare('SELECT * FROM message_templates WHERE tenant_id = ? ORDER BY sort ASC, rowid ASC').all(tid)
      return json(res, 200, {
        templates: rows.map(serializeMessageTemplate),
        scenes: MESSAGE_TEMPLATE_SCENES.map((scene) => ({ scene, label: MESSAGE_TEMPLATE_SCENE_LABELS[scene] })),
        note: '本批只做模板管理;自动发送引擎在后续批次接入。'
      })
    }
    if (req.method === 'POST' && !tplId) {
      const body = await readBody(req)
      const scene = MESSAGE_TEMPLATE_SCENES.includes(body.scene) ? body.scene : 'pre_sale'
      const title = String(body.title || '').trim()
      if (!title) throw apiError(400, 'BAD_REQUEST', '模板标题必填。')
      const id = randomId('tpl')
      db.prepare(`INSERT INTO message_templates (id, tenant_id, scene, title, content, content_en, variables_json, is_active, sort, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, tid, scene, title.slice(0, 60),
        String(body.content || '').slice(0, 2000), String(body.contentEn || '').slice(0, 2000),
        JSON.stringify(Array.isArray(body.variables) ? body.variables.map(String) : []),
        body.isActive === false ? 0 : 1, Math.round(Number(body.sort) || 0), iso(new Date()))
      return json(res, 201, { template: serializeMessageTemplate(db.prepare('SELECT * FROM message_templates WHERE id = ?').get(id)) })
    }
    if (req.method === 'PATCH' && tplId) {
      const cur = db.prepare('SELECT * FROM message_templates WHERE id = ? AND tenant_id = ?').get(tplId, tid)
      if (!cur) throw apiError(404, 'NOT_FOUND', 'Template not found.')
      const body = await readBody(req)
      db.prepare(`UPDATE message_templates SET scene = ?, title = ?, content = ?, content_en = ?, variables_json = ?, is_active = ?, sort = ?, updated_at = ? WHERE id = ?`).run(
        MESSAGE_TEMPLATE_SCENES.includes(body.scene) ? body.scene : cur.scene,
        body.title === undefined ? cur.title : String(body.title).trim().slice(0, 60) || cur.title,
        body.content === undefined ? cur.content : String(body.content).slice(0, 2000),
        body.contentEn === undefined ? cur.content_en : String(body.contentEn).slice(0, 2000),
        body.variables === undefined ? cur.variables_json : JSON.stringify(Array.isArray(body.variables) ? body.variables.map(String) : []),
        body.isActive === undefined ? cur.is_active : (body.isActive ? 1 : 0),
        body.sort === undefined ? cur.sort : Math.round(Number(body.sort) || 0),
        iso(new Date()), tplId)
      return json(res, 200, { template: serializeMessageTemplate(db.prepare('SELECT * FROM message_templates WHERE id = ?').get(tplId)) })
    }
    if (req.method === 'DELETE' && tplId) {
      const r = db.prepare('DELETE FROM message_templates WHERE id = ? AND tenant_id = ?').run(tplId, tid)
      if (!r.changes) throw apiError(404, 'NOT_FOUND', 'Template not found.')
      return json(res, 200, { deleted: true })
    }
  }
  /* ===== P0 价目表管理(大类 / 项目与加项 / 计价规则 / 试算)=====
     全部 owner-only + 租户隔离;写库时 services.price_cents 与 service_prices(list) 双写保持一致。 */
  if (path.startsWith('/admin/pricing/') || path.startsWith('/admin/membership/') || path.startsWith('/admin/recharge-tiers')) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
  }
  if (path === '/admin/pricing/categories' || path.startsWith('/admin/pricing/categories/')) {
    const tid = currentTenantId()
    const catId = path.split('/')[4] || null
    if (req.method === 'GET' && !catId) {
      return json(res, 200, { categories: pricingCategories(tid).map(serializePricingCategory) })
    }
    if (req.method === 'POST' && !catId) {
      const body = await readBody(req)
      const name = String(body.name || '').trim()
      if (!name) throw apiError(400, 'BAD_REQUEST', '大类名称必填。')
      const key = String(body.key || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || `cat-${Math.random().toString(36).slice(2, 8)}`
      if (db.prepare('SELECT id FROM service_categories WHERE tenant_id = ? AND key = ?').get(tid, key)) throw apiError(409, 'DUPLICATE', `大类标识 ${key} 已存在。`)
      const id = randomId('cat')
      db.prepare(`INSERT INTO service_categories (id, tenant_id, key, name, sort_order, is_bookable, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, tid, key, name.slice(0, 40),
        Math.round(Number(body.sortOrder) || 0), body.isBookable === false ? 0 : 1, String(body.note || '').slice(0, 200) || null, iso(new Date()))
      return json(res, 201, { category: serializePricingCategory(db.prepare('SELECT * FROM service_categories WHERE id = ?').get(id)) })
    }
    if (req.method === 'PATCH' && catId) {
      const cur = db.prepare('SELECT * FROM service_categories WHERE id = ? AND tenant_id = ?').get(catId, tid)
      if (!cur) throw apiError(404, 'NOT_FOUND', 'Category not found.')
      const body = await readBody(req)
      db.prepare('UPDATE service_categories SET name = ?, sort_order = ?, is_bookable = ?, note = ? WHERE id = ?').run(
        body.name === undefined ? cur.name : String(body.name).trim().slice(0, 40) || cur.name,
        body.sortOrder === undefined ? cur.sort_order : Math.round(Number(body.sortOrder) || 0),
        body.isBookable === undefined ? cur.is_bookable : (body.isBookable ? 1 : 0),
        body.note === undefined ? cur.note : (String(body.note).slice(0, 200) || null), catId)
      return json(res, 200, { category: serializePricingCategory(db.prepare('SELECT * FROM service_categories WHERE id = ?').get(catId)) })
    }
    if (req.method === 'DELETE' && catId) {
      const cur = db.prepare('SELECT * FROM service_categories WHERE id = ? AND tenant_id = ?').get(catId, tid)
      if (!cur) throw apiError(404, 'NOT_FOUND', 'Category not found.')
      const used = db.prepare('SELECT COUNT(*) AS n FROM services WHERE tenant_id = ? AND category_id = ?').get(tid, catId).n
      if (used > 0) throw apiError(409, 'CATEGORY_IN_USE', `该大类下还有 ${used} 个项目,请先移走或删除项目。`)
      db.prepare('DELETE FROM service_categories WHERE id = ?').run(catId)
      return json(res, 200, { deleted: true })
    }
  }
  if (path === '/admin/pricing/items' || path.startsWith('/admin/pricing/items/')) {
    const tid = currentTenantId()
    const itemId = path.split('/')[4] || null
    if (req.method === 'GET' && !itemId) {
      const rows = db.prepare('SELECT * FROM services WHERE tenant_id = ? ORDER BY item_kind ASC, sort_order ASC, rowid ASC').all(tid)
      return json(res, 200, { items: rows.map(serializePricingItem) })
    }
    if (req.method === 'POST' && !itemId) {
      const body = await readBody(req)
      const nameZh = String(body.nameZh || body.name || '').trim()
      if (!nameZh) throw apiError(400, 'BAD_REQUEST', '项目名称必填。')
      const id = serviceIdFrom({ type: body.type || 'OTHER', nameEn: body.nameEn, nameZh })
      const shape = pricingItemShape(body, {}, tid)
      const listCents = Math.max(0, Math.round(Number(body.listPriceCents ?? body.priceCents ?? 0) || 0))
      db.prepare(`INSERT INTO services
        (id, tenant_id, type, category, name_zh, name_en, description_zh, description_en, image_url, price_cents, deposit_cents, base_duration_min, sort_order, is_active, process_json, notice_json,
         item_kind, category_id, unit, price_rule, price_rule_value, addon_scope_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, tid, shape.type, shape.categoryName, nameZh, String(body.nameEn || nameZh), String(body.descriptionZh || ''), String(body.descriptionEn || ''),
        String(body.imageUrl || '/assets/images/nail-addon.jpg'), listCents,
        Math.max(0, Math.round(Number(body.depositCents ?? 0) || 0)),
        Math.max(0, Math.round(Number(body.baseDurationMin ?? 60) || 0)),
        Math.round(Number(body.sortOrder) || 0), body.isActive === false ? 0 : 1, '[]', '[]',
        shape.itemKind, shape.categoryId, shape.unit, shape.priceRule, shape.priceRuleValue, JSON.stringify(shape.addonScope))
      writePricingItemPrices(tid, id, body, listCents)
      // 主项目自动分配给全部在职技师(与 /admin/services 同规则);加项不占技师能力位
      if (shape.itemKind === 'main') {
        const assign = db.prepare('INSERT OR IGNORE INTO technician_services (technician_id, service_id) VALUES (?, ?)')
        for (const tech of db.prepare('SELECT id FROM technicians WHERE is_active = 1 AND tenant_id = ?').all(tid)) assign.run(tech.id, id)
      }
      return json(res, 201, { item: serializePricingItem(db.prepare('SELECT * FROM services WHERE id = ?').get(id)) })
    }
    if (req.method === 'PATCH' && itemId) {
      const cur = db.prepare('SELECT * FROM services WHERE id = ? AND tenant_id = ?').get(itemId, tid)
      if (!cur) throw apiError(404, 'NOT_FOUND', 'Item not found.')
      const body = await readBody(req)
      const shape = pricingItemShape(body, cur, tid)
      const listCents = body.listPriceCents === undefined && body.priceCents === undefined
        ? cur.price_cents
        : Math.max(0, Math.round(Number(body.listPriceCents ?? body.priceCents) || 0))
      db.prepare(`UPDATE services SET type = ?, category = ?, name_zh = ?, name_en = ?, price_cents = ?, deposit_cents = ?, base_duration_min = ?,
        sort_order = ?, is_active = ?, item_kind = ?, category_id = ?, unit = ?, price_rule = ?, price_rule_value = ?, addon_scope_json = ? WHERE id = ?`).run(
        shape.type, shape.categoryName,
        body.nameZh === undefined ? cur.name_zh : String(body.nameZh).trim().slice(0, 60) || cur.name_zh,
        body.nameEn === undefined ? cur.name_en : String(body.nameEn).trim().slice(0, 80),
        listCents,
        body.depositCents === undefined ? cur.deposit_cents : Math.max(0, Math.round(Number(body.depositCents) || 0)),
        body.baseDurationMin === undefined ? cur.base_duration_min : Math.max(0, Math.round(Number(body.baseDurationMin) || 0)),
        body.sortOrder === undefined ? cur.sort_order : Math.round(Number(body.sortOrder) || 0),
        body.isActive === undefined ? cur.is_active : (body.isActive ? 1 : 0),
        shape.itemKind, shape.categoryId, shape.unit, shape.priceRule, shape.priceRuleValue, JSON.stringify(shape.addonScope), itemId)
      writePricingItemPrices(tid, itemId, body, listCents)
      return json(res, 200, { item: serializePricingItem(db.prepare('SELECT * FROM services WHERE id = ?').get(itemId)) })
    }
    if (req.method === 'DELETE' && itemId) {
      const cur = db.prepare('SELECT * FROM services WHERE id = ? AND tenant_id = ?').get(itemId, tid)
      if (!cur) throw apiError(404, 'NOT_FOUND', 'Item not found.')
      // 有历史订单引用的项目不能物理删(会断掉订单溯源),改为下架
      const used = db.prepare('SELECT COUNT(*) AS n FROM bookings WHERE service_id = ?').get(itemId).n
      if (used > 0) {
        db.prepare('UPDATE services SET is_active = 0 WHERE id = ?').run(itemId)
        return json(res, 200, { deleted: false, disabled: true, reason: `该项目有 ${used} 笔历史订单,已改为下架而非删除。` })
      }
      db.prepare('DELETE FROM service_prices WHERE service_id = ?').run(itemId)
      db.prepare('DELETE FROM technician_services WHERE service_id = ?').run(itemId)
      db.prepare('DELETE FROM services WHERE id = ?').run(itemId)
      return json(res, 200, { deleted: true })
    }
  }
  if (path === '/admin/pricing/rules') {
    const tid = currentTenantId()
    if (req.method === 'GET') return json(res, 200, { rules: getPricingRules(tid) })
    if (req.method === 'PUT') {
      const body = await readBody(req)
      const incoming = body.rules && typeof body.rules === 'object' ? body.rules : body
      for (const key of PRICING_RULE_KEYS) {
        if (incoming[key] === undefined) continue
        const entry = incoming[key] || {}
        putPricingRule(tid, key, { isActive: entry.isActive, config: entry.config })
      }
      return json(res, 200, { rules: getPricingRules(tid) })
    }
  }
  if (req.method === 'POST' && path === '/admin/pricing/preview') {
    const body = await readBody(req)
    return json(res, 200, { quote: quotePrice({ ...body, tenantId: currentTenantId() }) })
  }
  // 会员判定结果读接口:老板端「会员与储值」列表用,也是 isMemberOf / isFirstRecharge / 分桶余额的对外口径
  if (req.method === 'GET' && path === '/admin/membership/members') {
    const tid = currentTenantId()
    const one = String(query.userId || '').trim()
    const rows = one
      ? db.prepare('SELECT id, display_name, phone, is_migrated, legacy_total_spend_cents FROM users WHERE id = ? AND tenant_id = ?').all(one, tid)
      : db.prepare('SELECT id, display_name, phone, is_migrated, legacy_total_spend_cents FROM users WHERE tenant_id = ? ORDER BY rowid DESC LIMIT 500').all(tid)
    return json(res, 200, {
      config: getMembershipConfig(tid),
      members: rows.map((row) => {
        const balance = storedValueBalanceDetail(row.id, tid)
        return {
          userId: row.id,
          name: row.display_name,
          phone: row.phone || '',
          isMember: isMemberOf(row.id, tid),
          isFirstRecharge: isFirstRecharge(row.id, tid),
          isMigrated: Boolean(row.is_migrated),
          balanceCents: balance.totalCents,
          legacyBalanceCents: balance.legacyCents,
          normalBalanceCents: balance.normalCents,
          totalSpendCents: customerTotalSpendCents(row.id, tid)
        }
      })
    })
  }
  if (path === '/admin/membership/config') {
    const tid = currentTenantId()
    if (req.method === 'GET') {
      return json(res, 200, {
        config: getMembershipConfig(tid),
        qualifyModes: MEMBER_QUALIFY_MODES,
        // 2026-08-08 店主拍板:会员资格模式与等级体系(含「储值耗完是否保留会员」)由平台统一把关,
        // 商家端只读;充值档位与赠送项仍归商家自助。
        readOnly: true,
        managedBy: 'platform',
        readOnlyNote: '会员资格与等级由平台统一配置,如需调整请联系平台。充值档位与赠送项仍可自助设置。'
      })
    }
    if (req.method === 'PUT') {
      if (!isPlatformKey(req)) {
        throw apiError(403, 'MANAGED_BY_PLATFORM', '会员资格与等级由平台统一配置,如需调整请联系平台。充值档位与赠送项仍可自助设置。')
      }
      const body = await readBody(req)
      return json(res, 200, { config: setMembershipConfig(tid, body.config && typeof body.config === 'object' ? body.config : body) })
    }
  }
  if (path === '/admin/recharge-tiers' || path.startsWith('/admin/recharge-tiers/')) {
    const tid = currentTenantId()
    const tierId = path.split('/')[3] || null
    if (req.method === 'GET' && !tierId) {
      return json(res, 200, { tiers: db.prepare('SELECT * FROM recharge_tiers WHERE tenant_id = ? ORDER BY sort_order ASC, amount_cents ASC').all(tid).map(serializeRechargeTier) })
    }
    if (req.method === 'POST' && !tierId) {
      const body = await readBody(req)
      const amountCents = Math.max(0, Math.round(Number(body.amountCents) || 0))
      if (!amountCents) throw apiError(400, 'BAD_REQUEST', '充值金额必填且大于 0。')
      const id = randomId('rt')
      db.prepare('INSERT INTO recharge_tiers (id, tenant_id, amount_cents, gift_json, sort_order, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, tid, amountCents, JSON.stringify(body.gift && typeof body.gift === 'object' ? body.gift : {}),
          Math.round(Number(body.sortOrder) || 0), body.isActive === false ? 0 : 1, iso(new Date()))
      return json(res, 201, { tier: serializeRechargeTier(db.prepare('SELECT * FROM recharge_tiers WHERE id = ?').get(id)) })
    }
    if (req.method === 'PATCH' && tierId) {
      const cur = db.prepare('SELECT * FROM recharge_tiers WHERE id = ? AND tenant_id = ?').get(tierId, tid)
      if (!cur) throw apiError(404, 'NOT_FOUND', 'Recharge tier not found.')
      const body = await readBody(req)
      db.prepare('UPDATE recharge_tiers SET amount_cents = ?, gift_json = ?, sort_order = ?, is_active = ? WHERE id = ?').run(
        body.amountCents === undefined ? cur.amount_cents : Math.max(0, Math.round(Number(body.amountCents) || 0)),
        body.gift === undefined ? cur.gift_json : JSON.stringify(body.gift && typeof body.gift === 'object' ? body.gift : {}),
        body.sortOrder === undefined ? cur.sort_order : Math.round(Number(body.sortOrder) || 0),
        body.isActive === undefined ? cur.is_active : (body.isActive ? 1 : 0), tierId)
      return json(res, 200, { tier: serializeRechargeTier(db.prepare('SELECT * FROM recharge_tiers WHERE id = ?').get(tierId)) })
    }
    if (req.method === 'DELETE' && tierId) {
      const cur = db.prepare('SELECT * FROM recharge_tiers WHERE id = ? AND tenant_id = ?').get(tierId, tid)
      if (!cur) throw apiError(404, 'NOT_FOUND', 'Recharge tier not found.')
      db.prepare('DELETE FROM recharge_tiers WHERE id = ?').run(tierId)
      return json(res, 200, { deleted: true })
    }
  }
  // ===== 会员套餐(充值套餐 / 会员次卡)定义 CRUD =====
  if (req.method === 'GET' && path === '/admin/packages') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    return json(res, 200, { packages: db.prepare('SELECT * FROM membership_packages WHERE tenant_id = ? ORDER BY kind ASC, sort_order ASC, created_at ASC').all(currentTenantId()).map(serializeMembershipPackage) })
  }
  if (req.method === 'POST' && path === '/admin/packages') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const body = await readBody(req)
    const kind = body.kind === 'times' ? 'times' : 'recharge'
    const name = String(body.name || '').trim()
    if (!name) throw apiError(400, 'BAD_REQUEST', '套餐名称必填。')
    const id = randomId('pkg')
    db.prepare(`INSERT INTO membership_packages (id, tenant_id, kind, name, price_cents, bonus_cents, times_count, scope, benefits, is_active, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, currentTenantId(), kind, name,
      Math.max(0, Math.round(Number(body.priceCents) || 0)),
      Math.max(0, Math.round(Number(body.bonusCents) || 0)),
      Math.max(0, Math.round(Number(body.timesCount) || 0)),
      String(body.scope || '').slice(0, 200) || null,
      String(body.benefits || '').slice(0, 400) || null,
      body.isActive === false ? 0 : 1,
      Math.round(Number(body.sortOrder) || 0), iso(new Date()))
    return json(res, 201, { package: serializeMembershipPackage(db.prepare('SELECT * FROM membership_packages WHERE id = ?').get(id)) })
  }
  if (req.method === 'PATCH' && path.startsWith('/admin/packages/')) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const id = path.split('/')[3]
    const cur = db.prepare('SELECT * FROM membership_packages WHERE id = ? AND tenant_id = ?').get(id, currentTenantId())
    if (!cur) throw apiError(404, 'NOT_FOUND', 'Package not found.')
    const body = await readBody(req)
    db.prepare(`UPDATE membership_packages SET kind = ?, name = ?, price_cents = ?, bonus_cents = ?, times_count = ?, scope = ?, benefits = ?, is_active = ?, sort_order = ? WHERE id = ?`).run(
      body.kind === undefined ? cur.kind : (body.kind === 'times' ? 'times' : 'recharge'),
      body.name === undefined ? cur.name : String(body.name).trim(),
      body.priceCents === undefined ? cur.price_cents : Math.max(0, Math.round(Number(body.priceCents) || 0)),
      body.bonusCents === undefined ? cur.bonus_cents : Math.max(0, Math.round(Number(body.bonusCents) || 0)),
      body.timesCount === undefined ? cur.times_count : Math.max(0, Math.round(Number(body.timesCount) || 0)),
      body.scope === undefined ? cur.scope : (String(body.scope).slice(0, 200) || null),
      body.benefits === undefined ? cur.benefits : (String(body.benefits).slice(0, 400) || null),
      body.isActive === undefined ? cur.is_active : (body.isActive ? 1 : 0),
      body.sortOrder === undefined ? cur.sort_order : Math.round(Number(body.sortOrder) || 0), id)
    return json(res, 200, { package: serializeMembershipPackage(db.prepare('SELECT * FROM membership_packages WHERE id = ?').get(id)) })
  }
  // ===== 优惠券 定义 CRUD =====
  if (req.method === 'GET' && path === '/admin/coupons') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    return json(res, 200, { coupons: db.prepare('SELECT * FROM coupons WHERE tenant_id = ? ORDER BY created_at DESC').all(currentTenantId()).map(serializeCoupon) })
  }
  if (req.method === 'POST' && path === '/admin/coupons') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const body = await readBody(req)
    const name = String(body.name || '').trim()
    if (!name) throw apiError(400, 'BAD_REQUEST', '优惠券名称必填。')
    const discountType = body.discountType === 'percent' ? 'percent' : 'amount'
    const id = randomId('cpn')
    db.prepare(`INSERT INTO coupons (id, tenant_id, name, discount_type, amount_cents, percent_off, min_spend_cents, valid_days, total_qty, issued_qty, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`).run(
      id, currentTenantId(), name, discountType,
      Math.max(0, Math.round(Number(body.amountCents) || 0)),
      Math.max(0, Math.min(100, Math.round(Number(body.percentOff) || 0))),
      Math.max(0, Math.round(Number(body.minSpendCents) || 0)),
      Math.max(1, Math.round(Number(body.validDays) || 30)),
      Math.max(0, Math.round(Number(body.totalQty) || 0)),
      body.isActive === false ? 0 : 1, iso(new Date()))
    return json(res, 201, { coupon: serializeCoupon(db.prepare('SELECT * FROM coupons WHERE id = ?').get(id)) })
  }
  // 发券:把某张券发给某会员(生成一次性核销码)
  if (req.method === 'POST' && path.startsWith('/admin/coupons/') && path.endsWith('/grant')) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const couponId = path.split('/')[3]
    const coupon = db.prepare('SELECT * FROM coupons WHERE id = ? AND tenant_id = ?').get(couponId, currentTenantId())
    if (!coupon) throw apiError(404, 'NOT_FOUND', 'Coupon not found.')
    if (!coupon.is_active) throw apiError(400, 'BAD_REQUEST', '该券已停用。')
    if (coupon.total_qty > 0 && coupon.issued_qty >= coupon.total_qty) throw apiError(400, 'BAD_REQUEST', '该券发放量已用完。')
    const body = await readBody(req)
    const user = db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(String(body.userId || ''))
    if (!user) throw apiError(404, 'NOT_FOUND', 'Member not found.')
    const code = `LL-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
    // 发放时可覆盖有效期(天);不传则按券模板的 valid_days
    const days = Number.isFinite(Number(body.validDays)) && Number(body.validDays) > 0
      ? Math.min(365, Math.round(Number(body.validDays))) : (coupon.valid_days || 30)
    const expiresAt = iso(new Date(Date.now() + days * 86400000))
    db.prepare(`INSERT INTO coupon_grants (id, tenant_id, coupon_id, user_id, code, status, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`).run(randomId('grant'), currentTenantId(), couponId, user.id, code, expiresAt, iso(new Date()))
    db.prepare('UPDATE coupons SET issued_qty = issued_qty + 1 WHERE id = ?').run(couponId)
    return json(res, 201, { grant: { code, couponName: coupon.name, userName: user.display_name, expiresAt } })
  }
  // 群发券(P1-③ 分层联动):把某张券一键发给一批顾客(如「沉睡S」全层)。
  // 已持有该券未用的跳过(防重复轰炸);受总量限制;返回 发了几张/跳过几人。
  if (req.method === 'POST' && path.startsWith('/admin/coupons/') && path.endsWith('/grant-batch')) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const couponId = path.split('/')[3]
    const coupon = db.prepare('SELECT * FROM coupons WHERE id = ? AND tenant_id = ?').get(couponId, currentTenantId())
    if (!coupon) throw apiError(404, 'NOT_FOUND', 'Coupon not found.')
    if (!coupon.is_active) throw apiError(400, 'BAD_REQUEST', '该券已停用。')
    const body = await readBody(req)
    const userIds = (Array.isArray(body.userIds) ? body.userIds : []).slice(0, 200)
    if (!userIds.length) throw apiError(400, 'BAD_REQUEST', '缺少顾客名单。')
    let granted = 0, skipped = 0
    let issued = coupon.issued_qty
    const nowIso2 = iso(new Date())
    // 群发时可覆盖有效期(天);不传按券模板
    const days = Number.isFinite(Number(body.validDays)) && Number(body.validDays) > 0
      ? Math.min(365, Math.round(Number(body.validDays))) : (coupon.valid_days || 30)
    for (const uid of userIds) {
      if (coupon.total_qty > 0 && issued >= coupon.total_qty) { skipped += 1; continue }
      const user = db.prepare('SELECT id FROM users WHERE id = ?').get(String(uid))
      if (!user) { skipped += 1; continue }
      const has = db.prepare("SELECT 1 FROM coupon_grants WHERE tenant_id = ? AND coupon_id = ? AND user_id = ? AND status = 'active'").get(currentTenantId(), couponId, user.id)
      if (has) { skipped += 1; continue }
      const code = `LL-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
      const expiresAt = iso(new Date(Date.now() + days * 86400000))
      db.prepare(`INSERT INTO coupon_grants (id, tenant_id, coupon_id, user_id, code, status, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`).run(randomId('grant'), currentTenantId(), couponId, user.id, code, expiresAt, nowIso2)
      issued += 1; granted += 1
    }
    db.prepare('UPDATE coupons SET issued_qty = ? WHERE id = ?').run(issued, couponId)
    return json(res, 201, { granted, skipped, couponName: coupon.name })
  }
  // ===== 积分商城 · 老板奖品管理 =====
  if (req.method === 'GET' && path === '/admin/points-prizes') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const rows = db.prepare('SELECT * FROM points_prizes WHERE tenant_id = ? ORDER BY created_at DESC').all(currentTenantId())
    return json(res, 200, { prizes: rows.map((r) => serializePrize(r)) })
  }
  if (req.method === 'POST' && path === '/admin/points-prizes') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const body = await readBody(req)
    const coupon = db.prepare('SELECT * FROM coupons WHERE id = ? AND tenant_id = ?').get(String(body.couponId || ''), currentTenantId())
    if (!coupon) throw apiError(404, 'NOT_FOUND', '券不存在,先到 会员套餐/券 里建一张。')
    const cost = Math.max(1, Math.round(Number(body.costPoints) || 0))
    const id = randomId('prize')
    const now = iso(new Date())
    db.prepare(`INSERT INTO points_prizes (id, tenant_id, coupon_id, cost_points, stock, per_user_limit, valid_days, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, currentTenantId(), coupon.id, cost,
      Math.max(0, Math.round(Number(body.stock) || 0)),
      Math.max(0, Math.round(Number(body.perUserLimit) || 0)),
      Number(body.validDays) > 0 ? Math.min(365, Math.round(Number(body.validDays))) : null,
      body.isActive === false ? 0 : 1, now, now)
    return json(res, 201, { prize: serializePrize(db.prepare('SELECT * FROM points_prizes WHERE id = ?').get(id)) })
  }
  if (req.method === 'PATCH' && path.match(/^\/admin\/points-prizes\/[^/]+$/)) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const id = path.split('/')[3]
    const r = db.prepare('SELECT * FROM points_prizes WHERE id = ? AND tenant_id = ?').get(id, currentTenantId())
    if (!r) throw apiError(404, 'NOT_FOUND', '奖品不存在。')
    const body = await readBody(req)
    const cost = body.costPoints != null ? Math.max(1, Math.round(Number(body.costPoints) || r.cost_points)) : r.cost_points
    const stock = body.stock != null ? Math.max(0, Math.round(Number(body.stock) || 0)) : r.stock
    const limit = body.perUserLimit != null ? Math.max(0, Math.round(Number(body.perUserLimit) || 0)) : r.per_user_limit
    const vd = body.validDays !== undefined ? (Number(body.validDays) > 0 ? Math.min(365, Math.round(Number(body.validDays))) : null) : r.valid_days
    const active = body.isActive != null ? (body.isActive ? 1 : 0) : r.is_active
    db.prepare('UPDATE points_prizes SET cost_points = ?, stock = ?, per_user_limit = ?, valid_days = ?, is_active = ?, updated_at = ? WHERE id = ?')
      .run(cost, stock, limit, vd, active, iso(new Date()), id)
    return json(res, 200, { prize: serializePrize(db.prepare('SELECT * FROM points_prizes WHERE id = ?').get(id)) })
  }
  // 撤销兑换(误兑):券未核销 → 券作废 + 积分冲正退回 + 库存回补
  if (req.method === 'POST' && path === '/admin/points-mall/revoke') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const body = await readBody(req)
    const code = String(body.code || '').trim().toUpperCase()
    if (!code) throw apiError(400, 'BAD_REQUEST', '请输入券码。')
    const grant = db.prepare('SELECT * FROM coupon_grants WHERE code = ? AND tenant_id = ?').get(code, currentTenantId())
    if (!grant) throw apiError(404, 'NOT_FOUND', '券码不存在。')
    if (grant.status !== 'active') throw apiError(409, 'NOT_REVOCABLE', `该券状态为 ${grant.status},已核销/失效的不能撤销。`)
    const redeemTxn = db.prepare("SELECT * FROM points_transactions WHERE ref_id = ? AND type = 'redeem' AND tenant_id = ?").get(grant.id, currentTenantId())
    if (!redeemTxn) throw apiError(400, 'BAD_REQUEST', '该券不是积分兑换所得(老板手动发的券直接停用即可)。')
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare("UPDATE coupon_grants SET status = 'revoked' WHERE id = ?").run(grant.id)
      db.prepare('INSERT INTO points_transactions (id, tenant_id, user_id, type, amount, ref_id, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(randomId('pts'), currentTenantId(), grant.user_id, 'reversal', Math.abs(redeemTxn.amount), grant.id, '撤销兑换 · 积分退回', adminSession.email || 'owner', iso(new Date()))
      // 库存回补:兑换流水 note 末尾带 #prizeId;解析失败只跳过回补(积分退回不受影响)
      const pid = String(redeemTxn.note || '').includes('#') ? String(redeemTxn.note).split('#').pop().trim() : ''
      if (pid && db.prepare('SELECT 1 FROM points_prizes WHERE id = ?').get(pid)) {
        db.prepare('UPDATE points_prizes SET stock = stock + 1, redeemed_qty = MAX(0, redeemed_qty - 1), updated_at = ? WHERE id = ?').run(iso(new Date()), pid)
      }
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
    return json(res, 200, { ok: true, refundedPoints: Math.abs(redeemTxn.amount) })
  }
  // 核销:店员输码/扫码,一次性,防重复
  if (req.method === 'POST' && path === '/admin/coupons/redeem') {
    const body = await readBody(req)
    const code = String(body.code || '').trim().toUpperCase()
    if (!code) throw apiError(400, 'BAD_REQUEST', '请输入券码。')
    const grant = db.prepare('SELECT g.*, c.name AS coupon_name, c.discount_type, c.amount_cents, c.percent_off, c.min_spend_cents FROM coupon_grants g JOIN coupons c ON c.id = g.coupon_id WHERE g.code = ? AND g.tenant_id = ?').get(code, currentTenantId())
    if (!grant) throw apiError(404, 'NOT_FOUND', '券码不存在(或不属于本店)。')
    if (grant.status === 'used') throw apiError(409, 'ALREADY_USED', `该券已于 ${String(grant.used_at || '').slice(0, 16).replace('T', ' ')} 核销过。`)
    if (grant.expires_at && grant.expires_at < iso(new Date())) {
      db.prepare("UPDATE coupon_grants SET status = 'expired' WHERE id = ?").run(grant.id)
      throw apiError(400, 'EXPIRED', '该券已过期。')
    }
    db.prepare("UPDATE coupon_grants SET status = 'used', used_at = ? WHERE id = ?").run(iso(new Date()), grant.id)
    return json(res, 200, {
      redeemed: {
        couponName: grant.coupon_name,
        discountText: grant.discount_type === 'percent' ? `立减 ${grant.percent_off}%` : `减 $${grant.amount_cents / 100}`,
        minSpendText: grant.min_spend_cents ? `满 $${grant.min_spend_cents / 100} 可用` : '无门槛'
      }
    })
  }
  if (req.method === 'PATCH' && path.startsWith('/admin/coupons/')) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const id = path.split('/')[3]
    const cur = db.prepare('SELECT * FROM coupons WHERE id = ? AND tenant_id = ?').get(id, currentTenantId())
    if (!cur) throw apiError(404, 'NOT_FOUND', 'Coupon not found.')
    const body = await readBody(req)
    db.prepare(`UPDATE coupons SET name = ?, discount_type = ?, amount_cents = ?, percent_off = ?, min_spend_cents = ?, valid_days = ?, total_qty = ?, is_active = ? WHERE id = ?`).run(
      body.name === undefined ? cur.name : String(body.name).trim(),
      body.discountType === undefined ? cur.discount_type : (body.discountType === 'percent' ? 'percent' : 'amount'),
      body.amountCents === undefined ? cur.amount_cents : Math.max(0, Math.round(Number(body.amountCents) || 0)),
      body.percentOff === undefined ? cur.percent_off : Math.max(0, Math.min(100, Math.round(Number(body.percentOff) || 0))),
      body.minSpendCents === undefined ? cur.min_spend_cents : Math.max(0, Math.round(Number(body.minSpendCents) || 0)),
      body.validDays === undefined ? cur.valid_days : Math.max(1, Math.round(Number(body.validDays) || 30)),
      body.totalQty === undefined ? cur.total_qty : Math.max(0, Math.round(Number(body.totalQty) || 0)),
      body.isActive === undefined ? cur.is_active : (body.isActive ? 1 : 0), id)
    return json(res, 200, { coupon: serializeCoupon(db.prepare('SELECT * FROM coupons WHERE id = ?').get(id)) })
  }
  // ===== 平台超管端(platform.html):仅 OWNER_TOKEN 主钥匙可用 =====
  const isPlatform = () => {
    const auth = req.headers.authorization || ''
    return auth === `Bearer ${OWNER_TOKEN}`
  }
  if (req.method === 'GET' && path === '/platform/overview') {
    if (!isPlatform()) throw apiError(401, 'UNAUTHORIZED', 'Platform token required.')
    const monthStart = `${localParts(new Date()).date.slice(0, 7)}-01`
    const monthBookings = db.prepare('SELECT COUNT(*) AS n FROM bookings WHERE appointment_start >= ?').get(iso(localDateTime(monthStart, '00:00'))).n
    const pendingConfig = db.prepare(`SELECT t.id, t.name FROM tenants t WHERE t.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM services s WHERE s.tenant_id = t.id AND s.is_active = 1)`).all()
    return json(res, 200, { monthBookings, pendingConfig: pendingConfig.map((r) => ({ id: r.id, name: r.name })) })
  }
  // ===== 平台端·套餐计费(2026-08-03):档位/到期/订单/申请 一站管理;「标记已收款」=线下收款的正式路径 =====
  if (req.method === 'GET' && path === '/platform/billing') {
    if (!isPlatform()) throw apiError(401, 'UNAUTHORIZED', 'Platform token required.')
    const now = Date.now()
    const tenants = db.prepare('SELECT id, name, plan, status, plan_expires_at, auto_renew FROM tenants ORDER BY rowid ASC').all().map((t) => {
      const ai = aiAddonState(t.id) // AI 智能包状态与基础套餐分开看:套餐自带 / 试用中 / 已订阅 / 待开通 / 未开通
      return {
        id: t.id,
        name: t.name,
        plan: t.plan,
        status: t.status,
        planExpiresAt: t.plan_expires_at,
        autoRenew: Boolean(t.auto_renew),
        daysLeft: t.plan_expires_at ? Math.ceil((new Date(t.plan_expires_at).getTime() - now) / 86400000) : null,
        ai: {
          source: ai.trialPending && ai.source === 'none' ? 'pending' : ai.source,
          enabled: ai.enabled,       // 2026-08-07:平台页此前只给 source,判断「到底开没开」要靠猜
          unlimited: ai.unlimited,   // 长期开通(无到期日)
          expiresAt: ai.expiresAt,
          daysLeft: ai.expiresAt ? Math.ceil((new Date(ai.expiresAt).getTime() - now) / 86400000) : null,
          trialAvailable: ai.trialAvailable,
          usage: aiUsageOf(t.id) // 本月已用/配额/剩余,运营据此判断要不要加量或谈升级
        }
      }
    })
    const pendingOrders = db.prepare("SELECT o.*, t.name AS tenant_name FROM subscription_orders o JOIN tenants t ON t.id = o.tenant_id WHERE o.status = 'pending' ORDER BY o.created_at DESC").all()
      .map((o) => ({ id: o.id, tenantId: o.tenant_id, tenantName: o.tenant_name, plan: o.plan, period: o.period, amountCents: o.amount_cents, createdAt: o.created_at }))
    // 待处理申请:带上联系方式(门店电话 / 老板账号),AI 试用申请需要运营主动联系商家配置
    const planRequests = db.prepare(`SELECT r.*, t.name AS tenant_name,
        (SELECT s.phone FROM stores s WHERE s.tenant_id = r.tenant_id AND s.is_active = 1 AND s.phone IS NOT NULL AND s.phone <> '' LIMIT 1) AS store_phone,
        (SELECT a.username FROM admin_accounts a WHERE a.tenant_id = r.tenant_id AND a.role = 'owner' LIMIT 1) AS owner_username
      FROM plan_change_requests r JOIN tenants t ON t.id = r.tenant_id WHERE r.status = 'PENDING' ORDER BY r.created_at DESC`).all()
      .map((r) => ({ id: r.id, tenantId: r.tenant_id, tenantName: r.tenant_name, currentPlan: r.current_plan, targetPlan: r.target_plan, requestType: r.request_type, note: r.note || '', createdAt: r.created_at, createdBy: r.created_by || '', storePhone: r.store_phone || '', ownerUsername: r.owner_username || '' }))
    const plans = db.prepare('SELECT id, name_zh FROM plans ORDER BY sort_order').all()
      .map((p) => ({ id: p.id, name: p.name_zh, pricing: PLAN_PRICING[p.id] || null, fit: PLAN_FIT[p.id] || '' }))
    return json(res, 200, { tenants, pendingOrders, planRequests, plans })
  }
  if (req.method === 'POST' && /^\/platform\/tenants\/[^/]+\/billing$/.test(path)) {
    if (!isPlatform()) throw apiError(401, 'UNAUTHORIZED', 'Platform token required.')
    const tid = path.split('/')[3]
    if (!db.prepare('SELECT 1 FROM tenants WHERE id = ?').get(tid)) throw apiError(404, 'NOT_FOUND', '租户不存在。')
    const body = await readBody(req)
    const updates = []
    const args = []
    if (body.plan !== undefined) {
      if (!db.prepare('SELECT 1 FROM plans WHERE id = ?').get(String(body.plan))) throw apiError(400, 'BAD_REQUEST', '未知档位。')
      updates.push('plan = ?'); args.push(String(body.plan))
    }
    if (body.planExpiresAt !== undefined) {
      // null=长期授权;YYYY-MM-DD 存为当日门店时区 23:59
      if (body.planExpiresAt === null || body.planExpiresAt === '') { updates.push('plan_expires_at = NULL') }
      else if (/^\d{4}-\d{2}-\d{2}$/.test(String(body.planExpiresAt))) { updates.push('plan_expires_at = ?'); args.push(iso(localDateTime(String(body.planExpiresAt), '23:59'))) }
      else throw apiError(400, 'BAD_REQUEST', '到期日格式应为 YYYY-MM-DD 或 null。')
    }
    if (body.autoRenew !== undefined) { updates.push('auto_renew = ?'); args.push(body.autoRenew ? 1 : 0) }
    if (!updates.length) throw apiError(400, 'BAD_REQUEST', '没有要修改的内容。')
    updates.push('updated_at = ?'); args.push(iso(new Date()), tid)
    db.prepare(`UPDATE tenants SET ${updates.join(', ')} WHERE id = ?`).run(...args)
    return json(res, 200, { ok: true })
  }
  // ===== 平台通用 AI 知识库(2026-08-04):两层知识库的上层,改完对所有商家立即生效 =====
  if (req.method === 'GET' && path === '/platform/kb') {
    if (!isPlatform()) throw apiError(401, 'UNAUTHORIZED', 'Platform token required.')
    seedPlatformKbIfEmpty()
    const rows = db.prepare('SELECT * FROM platform_kb_entries ORDER BY kind ASC, sort_order ASC, rowid ASC').all()
    return json(res, 200, {
      entries: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        intent: r.intent || '',
        question: r.question || '',
        content: r.content || '',
        handoffRequired: Boolean(r.handoff_required),
        handoffType: r.handoff_type || '',
        enabled: Boolean(r.enabled),
        sortOrder: r.sort_order,
        updatedAt: r.updated_at
      })),
      intents: ['pricing', 'booking', 'policy', 'after_sales', 'deposit', 'privacy', 'nail_quote', 'lash_intake'],
      handoffTypes: ['technician', 'frontdesk', 'owner']
    })
  }
  if (req.method === 'POST' && path === '/platform/kb') {
    if (!isPlatform()) throw apiError(401, 'UNAUTHORIZED', 'Platform token required.')
    const body = await readBody(req)
    const kind = body.kind === 'rule' ? 'rule' : 'qa'
    const content = String(body.content || '').trim()
    if (!content) throw apiError(400, 'BAD_REQUEST', kind === 'rule' ? '规则正文必填。' : '回答口径必填。')
    if (kind === 'qa' && !String(body.question || '').trim()) throw apiError(400, 'BAD_REQUEST', '顾客问法必填。')
    const now = iso(new Date())
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS n FROM platform_kb_entries').get().n
    const id = randomId('pkb')
    db.prepare(`INSERT INTO platform_kb_entries (id, kind, intent, question, content, handoff_required, handoff_type, enabled, sort_order, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 'platform', ?, ?)`)
      .run(id, kind, String(body.intent || '').trim() || null, String(body.question || '').trim(), content,
        body.handoffRequired ? 1 : 0, String(body.handoffType || '').trim() || null, maxOrder + 1, now, now)
    return json(res, 201, { ok: true, id })
  }
  if (req.method === 'PATCH' && /^\/platform\/kb\/[^/]+$/.test(path)) {
    if (!isPlatform()) throw apiError(401, 'UNAUTHORIZED', 'Platform token required.')
    const id = decodeURIComponent(path.split('/')[3])
    const cur = db.prepare('SELECT * FROM platform_kb_entries WHERE id = ?').get(id)
    if (!cur) throw apiError(404, 'NOT_FOUND', '条目不存在。')
    const body = await readBody(req)
    db.prepare(`UPDATE platform_kb_entries SET intent = ?, question = ?, content = ?, handoff_required = ?, handoff_type = ?, enabled = ?, updated_by = 'platform', updated_at = ? WHERE id = ?`)
      .run(
        body.intent === undefined ? cur.intent : (String(body.intent).trim() || null),
        body.question === undefined ? cur.question : String(body.question),
        body.content === undefined ? cur.content : String(body.content),
        body.handoffRequired === undefined ? cur.handoff_required : (body.handoffRequired ? 1 : 0),
        body.handoffType === undefined ? cur.handoff_type : (String(body.handoffType).trim() || null),
        body.enabled === undefined ? cur.enabled : (body.enabled ? 1 : 0),
        iso(new Date()), id)
    return json(res, 200, { ok: true })
  }
  if (req.method === 'DELETE' && /^\/platform\/kb\/[^/]+$/.test(path)) {
    if (!isPlatform()) throw apiError(401, 'UNAUTHORIZED', 'Platform token required.')
    db.prepare('DELETE FROM platform_kb_entries WHERE id = ?').run(decodeURIComponent(path.split('/')[3]))
    return json(res, 200, { ok: true })
  }
  if (req.method === 'POST' && path === '/platform/kb/reset') {
    // 恢复出厂:清空后按种子重导(误删/改乱了的退路)
    if (!isPlatform()) throw apiError(401, 'UNAUTHORIZED', 'Platform token required.')
    db.prepare('DELETE FROM platform_kb_entries').run()
    seedPlatformKbIfEmpty()
    return json(res, 200, { ok: true, count: db.prepare('SELECT COUNT(*) AS n FROM platform_kb_entries').get().n })
  }
  // 平台端手动管理某商家的 AI 智能包:发放试用 / 顺延一个月或一年 / 关闭
  if (req.method === 'POST' && /^\/platform\/tenants\/[^/]+\/ai-addon$/.test(path)) {
    if (!isPlatform()) throw apiError(401, 'UNAUTHORIZED', 'Platform token required.')
    const tid = path.split('/')[3]
    if (!db.prepare('SELECT 1 FROM tenants WHERE id = ?').get(tid)) throw apiError(404, 'NOT_FOUND', '租户不存在。')
    const body = await readBody(req)
    const action = String(body.action || '')
    if (action === 'grant_trial') {
      const untilIso = grantAiTrial(tid)
      return json(res, 200, { ok: true, expiresAt: untilIso, ai: aiAddonState(tid) })
    }
    if (action === 'extend') {
      // 2026-08-07:period='unlimited'(或显式 expiresAt:null)= 不限期开通,给体验店/内部店用。
      // 老语义(month/year 顺延)一字未动,不传 period 仍是按年顺延。
      if (body.period === 'unlimited' || (Object.prototype.hasOwnProperty.call(body, 'expiresAt') && body.expiresAt === null)) {
        grantAiAddonUnlimited(tid)
        return json(res, 200, { ok: true, expiresAt: null, unlimited: true, ai: aiAddonState(tid) })
      }
      const untilIso = extendAiAddon(tid, body.period === 'month' ? 'month' : 'year')
      return json(res, 200, { ok: true, expiresAt: untilIso, ai: aiAddonState(tid) })
    }
    if (action === 'revoke') {
      db.prepare('DELETE FROM tenant_entitlements WHERE tenant_id = ? AND feature = ?').run(tid, AI_ADDON.feature)
      return json(res, 200, { ok: true, ai: aiAddonState(tid) })
    }
    if (action === 'add_quota') {
      // 本月临时加量:不动套餐、不动加购包,只给这一个月多批一些(写 ai_usage.bonus)
      const n = Math.max(0, Math.min(100000, Math.round(Number(body.amount || 0))))
      if (!n) throw apiError(400, 'BAD_REQUEST', '加量次数须为 1~100000。')
      db.prepare(`INSERT INTO ai_usage (tenant_id, month, used, bonus, updated_at) VALUES (?, ?, 0, ?, ?)
        ON CONFLICT(tenant_id, month) DO UPDATE SET bonus = bonus + excluded.bonus, updated_at = excluded.updated_at`)
        .run(tid, aiMonthKey(), n, iso(new Date()))
      return json(res, 200, { ok: true, usage: aiUsageOf(tid) })
    }
    throw apiError(400, 'BAD_REQUEST', 'action 应为 grant_trial / extend(period: month|year|unlimited) / revoke / add_quota。')
  }
  if (req.method === 'POST' && /^\/platform\/subscription-orders\/[^/]+\/mark-paid$/.test(path)) {
    // 线下收款确认(转账/e-transfer 到账后平台点这里):标记已支付 + 到期日顺延 max(原到期日,今天)+周期
    if (!isPlatform()) throw apiError(401, 'UNAUTHORIZED', 'Platform token required.')
    const orderId = path.split('/')[3]
    const order = db.prepare('SELECT * FROM subscription_orders WHERE id = ?').get(orderId)
    if (!order) throw apiError(404, 'NOT_FOUND', '订单不存在。')
    if (order.status === 'paid') return json(res, 200, { ok: true, alreadyPaid: true })
    if (order.plan === 'ai_addon') { // AI 智能包订单:顺延 AI 到期日,不动基础套餐
      const aiIso = extendAiAddon(order.tenant_id, order.period)
      db.prepare('UPDATE subscription_orders SET status = ?, paid_at = ?, pay_channel = ?, expires_after = ? WHERE id = ?')
        .run('paid', iso(new Date()), 'offline', aiIso, order.id)
      return json(res, 200, { ok: true, aiExpiresAt: aiIso })
    }
    const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(order.tenant_id)
    const base = new Date(Math.max(Date.now(), tenant?.plan_expires_at ? new Date(tenant.plan_expires_at).getTime() : 0))
    const next = new Date(base)
    if (order.period === 'month') next.setMonth(next.getMonth() + 1)
    else next.setFullYear(next.getFullYear() + 1)
    const nextIso = iso(next)
    db.prepare('UPDATE subscription_orders SET status = ?, paid_at = ?, pay_channel = ?, expires_after = ? WHERE id = ?')
      .run('paid', iso(new Date()), 'offline', nextIso, order.id)
    db.prepare('UPDATE tenants SET plan_expires_at = ?, updated_at = ? WHERE id = ?').run(nextIso, iso(new Date()), order.tenant_id)
    return json(res, 200, { ok: true, expiresAt: nextIso })
  }
  if (req.method === 'POST' && /^\/platform\/plan-requests\/[^/]+\/resolve$/.test(path)) {
    if (!isPlatform()) throw apiError(401, 'UNAUTHORIZED', 'Platform token required.')
    const reqId = path.split('/')[3]
    const body = await readBody(req)
    const status = body.status === 'REJECTED' ? 'REJECTED' : 'DONE'
    const row = db.prepare('SELECT * FROM plan_change_requests WHERE id = ?').get(reqId)
    if (!row) throw apiError(404, 'NOT_FOUND', '申请不存在。')
    db.prepare('UPDATE plan_change_requests SET status = ? WHERE id = ?').run(status, reqId)
    // AI 智能包试用申请:完成=发放 90 天权益并记「已用过试用」,不动基础档位
    if (row.request_type === 'ai_trial') {
      if (status !== 'DONE') return json(res, 200, { ok: true, status })
      const aiIso = grantAiTrial(row.tenant_id)
      return json(res, 200, { ok: true, status, aiExpiresAt: aiIso })
    }
    // 标记完成时若目标档位仍有效,同步改租户档位(到期日不动,由「标记已收款/顺延」另管)
    if (status === 'DONE' && db.prepare('SELECT 1 FROM plans WHERE id = ?').get(row.target_plan)) {
      db.prepare('UPDATE tenants SET plan = ?, updated_at = ? WHERE id = ?').run(row.target_plan, iso(new Date()), row.tenant_id)
    }
    return json(res, 200, { ok: true, status })
  }
  if (req.method === 'GET' && path === '/platform/tenants') {
    if (!isPlatform()) throw apiError(401, 'UNAUTHORIZED', 'Platform token required.')
    const monthStartIso = iso(localDateTime(`${localParts(new Date()).date.slice(0, 7)}-01`, '00:00'))
    const rows = db.prepare(`
      SELECT t.id, t.name, t.plan, t.status, t.plan_expires_at,
        (SELECT COUNT(*) FROM stores s WHERE s.tenant_id = t.id AND s.is_active = 1) AS store_count,
        (SELECT COUNT(*) FROM bookings b WHERE b.tenant_id = t.id) AS booking_count,
        (SELECT COUNT(*) FROM bookings b WHERE b.tenant_id = t.id AND b.appointment_start >= ?) AS month_booking_count,
        (SELECT username FROM admin_accounts a WHERE a.tenant_id = t.id AND a.role = 'owner' LIMIT 1) AS owner_username
      FROM tenants t ORDER BY t.rowid ASC
    `).all(monthStartIso)
    return json(res, 200, { tenants: rows.map((r) => ({ id: r.id, name: r.name, plan: r.plan, status: r.status, planExpiresAt: r.plan_expires_at, storeCount: r.store_count, bookingCount: r.booking_count, monthBookingCount: r.month_booking_count, ownerUsername: r.owner_username || '' })) })
  }
  if (req.method === 'POST' && path === '/platform/tenants') {
    if (!isPlatform()) throw apiError(401, 'UNAUTHORIZED', 'Platform token required.')
    const body = await readBody(req)
    const name = String(body.name || '').trim()
    if (!name) throw apiError(400, 'BAD_REQUEST', '商家名称必填。')
    let id = String(body.id || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
    if (!id) id = `shop-${Math.random().toString(36).slice(2, 8)}`
    if (db.prepare('SELECT id FROM tenants WHERE id = ?').get(id)) throw apiError(409, 'DUPLICATE', `租户 id ${id} 已存在。`)
    const plan = ['free', 'single', 'studio', 'chain', 'custom'].includes(body.plan) ? body.plan : 'single'
    // 首期订阅(2026-08-03 店主定):除内部旗舰店外,所有商家都有到期日——建店即设,默认年付;试用30天用于交付调试期
    const initialTerm = ['trial30', 'month', 'year'].includes(body.initialTerm) ? body.initialTerm : 'year'
    const expiry = new Date()
    if (initialTerm === 'trial30') expiry.setDate(expiry.getDate() + 30)
    else if (initialTerm === 'month') expiry.setMonth(expiry.getMonth() + 1)
    else expiry.setFullYear(expiry.getFullYear() + 1)
    const planExpiresAt = iso(expiry)
    db.prepare("INSERT INTO tenants (id, name, plan, status, plan_expires_at) VALUES (?, ?, ?, 'active', ?)").run(id, name.slice(0, 60), plan, planExpiresAt)
    db.prepare('INSERT INTO stores (id, name, address, phone, timezone, currency, is_active, tenant_id) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
      .run(`store-${id}`, name.slice(0, 60), String(body.city || '').slice(0, 80), String(body.phone || '').slice(0, 30),
        String(body.timezone || APP_TIMEZONE).slice(0, 64), String(body.currency || 'CAD').toUpperCase().slice(0, 6), id)
    invalidateTenantTimezone(id)
    // 老板账号:username 唯一,默认 boss-<id>
    let username = String(body.username || `boss-${id}`).trim().toLowerCase().replace(/[^a-z0-9-]/g, '') || `boss-${id}`
    let suffix = 1
    while (db.prepare('SELECT id FROM admin_accounts WHERE LOWER(username) = ?').get(username)) { suffix += 1; username = `boss-${id}${suffix}` }
    const initialPassword = randomPassword()
    db.prepare(`INSERT INTO admin_accounts (id, tenant_id, username, display_name, role, technician_id, password_hash, must_change_password, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'owner', NULL, ?, 1, 'active', ?, ?)`)
      .run(randomId('acct'), id, username, `${name} Owner`, adminPasswordHash(username, initialPassword), iso(new Date()), iso(new Date()))
    return json(res, 201, {
      tenant: { id, name, plan, status: 'active', planExpiresAt },
      owner: { username, initialPassword, note: '初始密码只显示这一次,请交付商家;首次登录强制改密。' },
      shopEntry: { scene: `t=${id}`, note: '小程序发布后可用此 scene 生成该店专属小程序码。' }
    })
  }
  if (req.method === 'POST' && path.startsWith('/platform/tenants/') && path.endsWith('/toggle')) {
    if (!isPlatform()) throw apiError(401, 'UNAUTHORIZED', 'Platform token required.')
    const id = path.split('/')[3]
    if (id === DEFAULT_TENANT_ID) throw apiError(400, 'BAD_REQUEST', '默认租户不可停用。')
    const cur = db.prepare('SELECT * FROM tenants WHERE id = ?').get(id)
    if (!cur) throw apiError(404, 'NOT_FOUND', 'Tenant not found.')
    const next = cur.status === 'active' ? 'suspended' : 'active'
    db.prepare('UPDATE tenants SET status = ? WHERE id = ?').run(next, id)
    return json(res, 200, { tenant: { id, status: next } })
  }
  // 平台端·会员政策(2026-08-08 从商家侧收回):资格模式 / 门槛 / 有效期 / 等级体系
  if (path.startsWith('/platform/tenants/') && path.endsWith('/membership-config') && (req.method === 'GET' || req.method === 'PUT')) {
    if (!isPlatform()) throw apiError(401, 'UNAUTHORIZED', 'Platform token required.')
    const tenantId = path.split('/')[3]
    if (!db.prepare('SELECT id FROM tenants WHERE id = ?').get(tenantId)) throw apiError(404, 'NOT_FOUND', 'Tenant not found.')
    if (req.method === 'GET') {
      return json(res, 200, { tenantId, config: getMembershipConfig(tenantId), qualifyModes: MEMBER_QUALIFY_MODES })
    }
    const body = await readBody(req)
    return json(res, 200, { tenantId, config: setMembershipConfig(tenantId, body.config && typeof body.config === 'object' ? body.config : body) })
  }
  /* ---- 平台端·顾客批量导入(从美团/大众/老系统迁过来的顾客与期初余额)----
     dryRun 只出报告不写库;执行时以手机号为主键去重,期初余额记 legacy 桶(不进本店财务收入)。 */
  if (req.method === 'POST' && path.startsWith('/platform/tenants/') && path.endsWith('/import/customers')) {
    if (!isPlatform()) throw apiError(401, 'UNAUTHORIZED', 'Platform token required.')
    const tenantId = path.split('/')[3]
    if (!db.prepare('SELECT id FROM tenants WHERE id = ?').get(tenantId)) throw apiError(404, 'NOT_FOUND', 'Tenant not found.')
    const body = await readBody(req)
    return json(res, 200, importTenantCustomers(tenantId, body))
  }
  // ---- 平台端·商家配置(替商家配好入驻资料):门店/营业时间/服务价目/技师/AI知识库 ----
  const platTenantMatch = path.match(/^\/platform\/tenants\/([^/]+)\/(store|business-hours|services|technicians|kb)(?:\/([^/]+))?$/)
  if (platTenantMatch) {
    if (!isPlatform()) throw apiError(401, 'UNAUTHORIZED', 'Platform token required.')
    const tenantId = platTenantMatch[1]
    const section = platTenantMatch[2]
    const subId = platTenantMatch[3] || null
    if (!db.prepare('SELECT id FROM tenants WHERE id = ?').get(tenantId)) throw apiError(404, 'NOT_FOUND', 'Tenant not found.')
    const tenantStore = () => db.prepare('SELECT * FROM stores WHERE tenant_id = ? ORDER BY rowid ASC LIMIT 1').get(tenantId)

    if (section === 'store') {
      const store = tenantStore()
      if (req.method === 'GET') return json(res, 200, { store: store ? { id: store.id, name: store.name, address: store.address || '', phone: store.phone || '', currency: store.currency || '', timezone: store.timezone || '' } : null })
      if (req.method === 'PUT') {
        if (!store) throw apiError(404, 'NOT_FOUND', 'Store not found for tenant.')
        const body = await readBody(req)
        const name = String(body.name ?? store.name).trim() || store.name
        const address = String(body.address ?? store.address ?? '').trim()
        const phone = String(body.phone ?? store.phone ?? '').trim()
        // 币种(2026-08-06):境内体验店是 CNY,加拿大店是 CAD;不传就保持原值
        const currency = String(body.currency ?? store.currency ?? 'CAD').trim().toUpperCase().slice(0, 6) || store.currency
        // 时区(2026-08-07):门店所在地时区,境内店是 Asia/Shanghai;不传就保持原值
        const timezone = String(body.timezone ?? store.timezone ?? 'America/Toronto').trim().slice(0, 64) || store.timezone
        db.prepare('UPDATE stores SET name = ?, address = ?, phone = ?, currency = ?, timezone = ? WHERE id = ?').run(name, address, phone, currency, timezone, store.id)
        invalidateTenantTimezone(tenantId) // 时区改完立刻生效,不等重启
        // 同步进该租户 AI 知识事实(与商家端同规则,AI 回答与系统一致)
        const factStmt = db.prepare(`INSERT INTO tenant_kb_facts (tenant_id, key, value, updated_by, updated_at) VALUES (?, ?, ?, 'platform', ?)
          ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_by = 'platform', updated_at = excluded.updated_at`)
        if (address) factStmt.run(tenantId, 'storeAddress', address, iso(new Date()))
        if (phone) factStmt.run(tenantId, 'storePhone', phone, iso(new Date()))
        return json(res, 200, { store: { id: store.id, name, address, phone, currency, timezone } })
      }
    }

    if (section === 'business-hours') {
      const store = tenantStore()
      if (!store) throw apiError(404, 'NOT_FOUND', 'Store not found for tenant.')
      if (req.method === 'GET') return json(res, 200, { hours: getBusinessHoursRows(store.id).map(serializeBusinessHour) })
      if (req.method === 'PUT') {
        const body = await readBody(req)
        const entries = Array.isArray(body.hours) ? body.hours : []
        if (!entries.length) throw apiError(400, 'BAD_REQUEST', 'hours array is required.')
        const stmt = db.prepare(`INSERT INTO business_hours (store_id, weekday, open_time, close_time, is_closed, updated_at, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, 'platform')
          ON CONFLICT(store_id, weekday) DO UPDATE SET open_time = excluded.open_time, close_time = excluded.close_time, is_closed = excluded.is_closed, updated_at = excluded.updated_at, updated_by = 'platform'`)
        for (const e of entries) stmt.run(store.id, Number(e.weekday), e.openTime || '10:00', e.closeTime || '19:00', e.isClosed ? 1 : 0, iso(new Date()))
        return json(res, 200, { hours: getBusinessHoursRows(store.id).map(serializeBusinessHour) })
      }
    }

    if (section === 'services') {
      if (req.method === 'GET') {
        return json(res, 200, { services: db.prepare('SELECT * FROM services WHERE tenant_id = ? ORDER BY type ASC, sort_order ASC').all(tenantId).map((s) => serializeService(s)) })
      }
      if (req.method === 'POST') {
        const payload = servicePayload(await readBody(req))
        if (!['NAIL', 'LASH', 'CARE', 'OTHER'].includes(payload.type)) throw apiError(400, 'BAD_REQUEST', '服务类型须为 美甲/美睫/护理/其他。')
        if (!payload.nameZh) throw apiError(400, 'BAD_REQUEST', '服务中文名必填。')
        if (!payload.nameEn) payload.nameEn = payload.nameZh
        const id = serviceIdFrom(payload)
        db.prepare(`INSERT INTO services (id, tenant_id, type, category, name_zh, name_en, description_zh, description_en, image_url, price_cents, deposit_cents, base_duration_min, sort_order, is_active, process_json, notice_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, tenantId, payload.type, payload.category, payload.nameZh, payload.nameEn, payload.descriptionZh, payload.descriptionEn, payload.imageUrl, payload.priceCents, payload.depositCents, payload.baseDurationMin, payload.sortOrder, payload.isActive, JSON.stringify(payload.processJson), JSON.stringify(payload.noticeJson))
        upsertServicePrice(tenantId, id, 'list', payload.priceCents) // 与多价位模型的 list 档双写
        // 该租户在职技师自动可做新服务(与商家端一致)
        const assign = db.prepare('INSERT OR IGNORE INTO technician_services (technician_id, service_id) VALUES (?, ?)')
        for (const tech of db.prepare('SELECT id FROM technicians WHERE is_active = 1 AND tenant_id = ?').all(tenantId)) assign.run(tech.id, id)
        return json(res, 201, { service: serializeService(getService(id)) })
      }
      if (req.method === 'PATCH' && subId) {
        const cur = db.prepare('SELECT * FROM services WHERE id = ? AND tenant_id = ?').get(subId, tenantId)
        if (!cur) throw apiError(404, 'NOT_FOUND', 'Service not found in tenant.')
        const payload = servicePayload(await readBody(req), cur)
        db.prepare(`UPDATE services SET type = ?, category = ?, name_zh = ?, name_en = ?, description_zh = ?, description_en = ?, image_url = ?, price_cents = ?, deposit_cents = ?, base_duration_min = ?, is_active = ?, sort_order = ?, process_json = ?, notice_json = ? WHERE id = ?`)
          .run(payload.type, payload.category, payload.nameZh, payload.nameEn, payload.descriptionZh, payload.descriptionEn, payload.imageUrl, payload.priceCents, payload.depositCents, payload.baseDurationMin, payload.isActive, payload.sortOrder, JSON.stringify(payload.processJson), JSON.stringify(payload.noticeJson), subId)
        upsertServicePrice(tenantId, subId, 'list', payload.priceCents) // 同上
        return json(res, 200, { service: serializeService(getService(subId)) })
      }
    }

    if (section === 'technicians') {
      if (req.method === 'GET') {
        return json(res, 200, { technicians: db.prepare('SELECT * FROM technicians WHERE tenant_id = ? ORDER BY name ASC').all(tenantId) })
      }
      if (req.method === 'POST') {
        const body = await readBody(req)
        const name = String(body.name || '').trim()
        if (!name) throw apiError(400, 'BAD_REQUEST', '技师姓名必填。')
        const store = tenantStore()
        if (!store) throw apiError(404, 'NOT_FOUND', 'Store not found for tenant.')
        const id = `tech_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
        db.prepare('INSERT INTO technicians (id, store_id, name, title, is_active, tenant_id) VALUES (?, ?, ?, ?, 1, ?)')
          .run(id, store.id, name.slice(0, 40), String(body.title || '').slice(0, 40), tenantId)
        const assign = db.prepare('INSERT OR IGNORE INTO technician_services (technician_id, service_id) VALUES (?, ?)')
        for (const svc of db.prepare('SELECT id FROM services WHERE tenant_id = ? AND is_active = 1').all(tenantId)) assign.run(id, svc.id)
        return json(res, 201, { technician: db.prepare('SELECT * FROM technicians WHERE id = ?').get(id) })
      }
      if (req.method === 'PATCH' && subId) {
        const cur = db.prepare('SELECT * FROM technicians WHERE id = ? AND tenant_id = ?').get(subId, tenantId)
        if (!cur) throw apiError(404, 'NOT_FOUND', 'Technician not found in tenant.')
        const body = await readBody(req)
        db.prepare('UPDATE technicians SET name = ?, title = ?, is_active = ? WHERE id = ?')
          .run(body.name === undefined ? cur.name : String(body.name).slice(0, 40), body.title === undefined ? cur.title : String(body.title).slice(0, 40), body.isActive === undefined ? cur.is_active : (body.isActive ? 1 : 0), subId)
        return json(res, 200, { technician: db.prepare('SELECT * FROM technicians WHERE id = ?').get(subId) })
      }
    }

    if (section === 'kb') {
      if (req.method === 'GET') {
        const facts = {}
        for (const row of db.prepare('SELECT key, value FROM tenant_kb_facts WHERE tenant_id = ?').all(tenantId)) facts[row.key] = row.value
        const entries = db.prepare('SELECT id, question, keywords, answer_zh, answer_en, enabled FROM tenant_kb_entries WHERE tenant_id = ? ORDER BY updated_at DESC').all(tenantId)
          .map((r) => ({ id: r.id, question: r.question, keywords: r.keywords || '', answerZh: r.answer_zh, answerEn: r.answer_en || '', enabled: Boolean(r.enabled) }))
        return json(res, 200, { facts, entries })
      }
      if (req.method === 'PUT') {
        // 更新品牌事实(AI 口径):brandName/assistantName/storeAddress/depositAmount/currency
        const body = await readBody(req)
        const facts = body.facts && typeof body.facts === 'object' ? body.facts : {}
        const allowed = ['brandName', 'assistantName', 'storeAddress', 'storePhone', 'depositAmount', 'currency']
        const stmt = db.prepare(`INSERT INTO tenant_kb_facts (tenant_id, key, value, updated_by, updated_at) VALUES (?, ?, ?, 'platform', ?)
          ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_by = 'platform', updated_at = excluded.updated_at`)
        for (const key of allowed) if (facts[key] !== undefined) stmt.run(tenantId, key, String(facts[key]), iso(new Date()))
        const out = {}
        for (const row of db.prepare('SELECT key, value FROM tenant_kb_facts WHERE tenant_id = ?').all(tenantId)) out[row.key] = row.value
        return json(res, 200, { facts: out })
      }
      if (req.method === 'POST') {
        // 新增问答条目
        const body = await readBody(req)
        const question = String(body.question || '').trim()
        const answerZh = String(body.answerZh || '').trim()
        if (!question || !answerZh) throw apiError(400, 'BAD_REQUEST', '问题与中文答案必填。')
        const id = randomId('kb')
        db.prepare(`INSERT INTO tenant_kb_entries (id, tenant_id, question, keywords, answer_zh, answer_en, enabled, updated_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 1, 'platform', ?, ?)`)
          .run(id, tenantId, question.slice(0, 200), String(body.keywords || question).slice(0, 300), answerZh.slice(0, 2000), String(body.answerEn || '').slice(0, 2000), iso(new Date()), iso(new Date()))
        return json(res, 201, { entry: { id, question, enabled: true } })
      }
      if (req.method === 'PATCH' && subId) {
        const cur = db.prepare('SELECT * FROM tenant_kb_entries WHERE id = ? AND tenant_id = ?').get(subId, tenantId)
        if (!cur) throw apiError(404, 'NOT_FOUND', 'KB entry not found.')
        const body = await readBody(req)
        db.prepare('UPDATE tenant_kb_entries SET question = ?, keywords = ?, answer_zh = ?, answer_en = ?, enabled = ?, updated_by = ?, updated_at = ? WHERE id = ?')
          .run(body.question === undefined ? cur.question : String(body.question).slice(0, 200),
            body.keywords === undefined ? cur.keywords : String(body.keywords).slice(0, 300),
            body.answerZh === undefined ? cur.answer_zh : String(body.answerZh).slice(0, 2000),
            body.answerEn === undefined ? cur.answer_en : String(body.answerEn).slice(0, 2000),
            body.enabled === undefined ? cur.enabled : (body.enabled ? 1 : 0), 'platform', iso(new Date()), subId)
        return json(res, 200, { ok: true })
      }
      if (req.method === 'DELETE' && subId) {
        const r = db.prepare('DELETE FROM tenant_kb_entries WHERE id = ? AND tenant_id = ?').run(subId, tenantId)
        if (!r.changes) throw apiError(404, 'NOT_FOUND', 'KB entry not found.')
        return json(res, 200, { deleted: subId })
      }
    }
    throw apiError(405, 'METHOD_NOT_ALLOWED', 'Unsupported method for this section.')
  }
  if (req.method === 'GET' && path === '/platform/leads') {
    if (!isPlatform()) throw apiError(401, 'UNAUTHORIZED', 'Platform token required.')
    return json(res, 200, { leads: db.prepare('SELECT * FROM merchant_leads ORDER BY created_at DESC').all().map(serializeMerchantLead) })
  }
  if (req.method === 'PATCH' && path.startsWith('/platform/leads/')) {
    if (!isPlatform()) throw apiError(401, 'UNAUTHORIZED', 'Platform token required.')
    const id = path.split('/')[3]
    const cur = db.prepare('SELECT * FROM merchant_leads WHERE id = ?').get(id)
    if (!cur) throw apiError(404, 'NOT_FOUND', 'Lead not found.')
    const body = await readBody(req)
    const status = ['new', 'contacted', 'onboarded', 'rejected'].includes(body.status) ? body.status : cur.status
    db.prepare('UPDATE merchant_leads SET status = ?, note = ?, updated_at = ? WHERE id = ?')
      .run(status, body.note === undefined ? cur.note : String(body.note).slice(0, 300), iso(new Date()), id)
    return json(res, 200, { lead: serializeMerchantLead(db.prepare('SELECT * FROM merchant_leads WHERE id = ?').get(id)) })
  }
  // 平台运营:商家入驻线索(平台数据,仅默认租户 owner/主钥匙可见)
  if (req.method === 'GET' && path === '/admin/merchant-leads') {
    if (adminSession.role !== 'owner' || currentTenantId() !== DEFAULT_TENANT_ID) throw apiError(403, 'FORBIDDEN', 'Platform permission is required.')
    return json(res, 200, { leads: db.prepare('SELECT * FROM merchant_leads ORDER BY created_at DESC').all().map(serializeMerchantLead) })
  }
  if (req.method === 'PATCH' && path.startsWith('/admin/merchant-leads/')) {
    if (adminSession.role !== 'owner' || currentTenantId() !== DEFAULT_TENANT_ID) throw apiError(403, 'FORBIDDEN', 'Platform permission is required.')
    const id = path.split('/')[3]
    const cur = db.prepare('SELECT * FROM merchant_leads WHERE id = ?').get(id)
    if (!cur) throw apiError(404, 'NOT_FOUND', 'Lead not found.')
    const body = await readBody(req)
    const status = ['new', 'contacted', 'onboarded', 'rejected'].includes(body.status) ? body.status : cur.status
    db.prepare('UPDATE merchant_leads SET status = ?, note = ?, updated_at = ? WHERE id = ?')
      .run(status, body.note === undefined ? cur.note : String(body.note).slice(0, 300), iso(new Date()), id)
    return json(res, 200, { lead: serializeMerchantLead(db.prepare('SELECT * FROM merchant_leads WHERE id = ?').get(id)) })
  }
  // 展示图库(对外):本店所有技师已发布作品(owner+staff 均可读;多租户按店)
  if (req.method === 'GET' && path === '/admin/published-works') {
    // 作品管理:员工只看本技师作品;老板看全店(店主 2026-07-29 反馈)
    const staffOnly = adminSession.role === 'staff' ? ' AND b.technician_id = ?' : ''
    const params = staffOnly ? [currentTenantId(), adminSession.technicianId] : [currentTenantId()]
    const rows = db.prepare(`
      SELECT b.id, b.appointment_start, b.approved_work_images_json, b.service_id, b.technician_id, t.name AS tech_name
      FROM bookings b LEFT JOIN technicians t ON t.id = b.technician_id
      WHERE b.gallery_status = 'approved' AND b.tenant_id = ?${staffOnly}
      ORDER BY b.gallery_locked_at DESC, b.appointment_start DESC
    `).all(...params)
    const works = []
    for (const row of rows) {
      const images = parseJson(row.approved_work_images_json).filter(Boolean)
      if (!images.length) continue
      const svc = row.service_id ? getService(row.service_id) : null
      works.push({
        bookingId: row.id,
        cover: images[0],
        images,
        count: images.length,
        technicianId: row.technician_id,
        technicianName: row.tech_name || '',
        service: svc ? (svc.name_zh || svc.nameZh || '') : '',
        date: localParts(row.appointment_start).date
      })
    }
    return json(res, 200, { works })
  }
  if (req.method === 'PATCH' && path.startsWith('/admin/technicians/') && path.endsWith('/schedule')) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const technicianId = path.split('/')[3]
    if (!db.prepare('SELECT id FROM technicians WHERE id = ? AND tenant_id = ?').get(technicianId, currentTenantId())) throw apiError(404, 'NOT_FOUND', 'Technician not found.')
    const body = await readBody(req)
    if (!body.date) throw apiError(400, 'BAD_REQUEST', 'date is required.')
    db.prepare(`INSERT INTO technician_schedules (technician_id, date, start_time, end_time, is_working)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(technician_id, date) DO UPDATE SET start_time = excluded.start_time, end_time = excluded.end_time, is_working = excluded.is_working`)
      .run(technicianId, body.date, body.startTime || '10:00', body.endTime || '19:00', body.isWorking === undefined ? 1 : Number(Boolean(body.isWorking)))
    return json(res, 200, { schedule: db.prepare('SELECT * FROM technician_schedules WHERE technician_id = ? AND date = ?').get(technicianId, body.date) })
  }
  // 特殊日期:新增/更新(节假日休息或调整时段),立即影响可预约时段与 AI 营业时间回答
  if (req.method === 'POST' && path === '/admin/special-dates') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const body = await readBody(req)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '')) throw apiError(400, 'BAD_REQUEST', 'date must be YYYY-MM-DD.')
    const isClosed = body.isClosed === undefined ? true : Boolean(body.isClosed)
    if (!isClosed && (!/^\d{2}:\d{2}$/.test(body.openTime || '') || !/^\d{2}:\d{2}$/.test(body.closeTime || ''))) {
      throw apiError(400, 'BAD_REQUEST', '调整时段需要提供 openTime/closeTime (HH:MM)。')
    }
    const storeId = body.storeId || defaultStoreId()
    if (!db.prepare('SELECT id FROM stores WHERE id = ? AND tenant_id = ?').get(storeId, currentTenantId())) throw apiError(404, 'NOT_FOUND', 'Store not found.')
    db.prepare(`INSERT INTO store_special_dates (store_id, date, is_closed, open_time, close_time, note)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(store_id, date) DO UPDATE SET is_closed = excluded.is_closed, open_time = excluded.open_time, close_time = excluded.close_time, note = excluded.note`)
      .run(storeId, body.date, Number(isClosed), isClosed ? null : body.openTime, isClosed ? null : body.closeTime, String(body.note || '').slice(0, 100) || null)
    return json(res, 201, { specialDate: db.prepare('SELECT * FROM store_special_dates WHERE store_id = ? AND date = ?').get(storeId, body.date) })
  }
  // 特殊日期:删除(恢复每周固定模式)
  if (req.method === 'DELETE' && path.startsWith('/admin/special-dates/')) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const date = path.split('/')[3]
    const storeId = query.storeId || defaultStoreId()
    if (!db.prepare('SELECT id FROM stores WHERE id = ? AND tenant_id = ?').get(storeId, currentTenantId())) throw apiError(404, 'NOT_FOUND', 'Store not found.')
    const result = db.prepare('DELETE FROM store_special_dates WHERE store_id = ? AND date = ?').run(storeId, date)
    if (!result.changes) throw apiError(404, 'NOT_FOUND', 'Special date not found.')
    return json(res, 200, { deleted: date })
  }
  // 周排班视图:一次取 7 天所有技师的排班 + 店休信息 + 当日预约数(用于冲突提示)
  if (req.method === 'GET' && path === '/admin/schedule-week') {
    const from = query.from && /^\d{4}-\d{2}-\d{2}$/.test(query.from) ? query.from : null
    const base = from ? localDateTime(from, '12:00') : new Date()
    // 对齐到周一
    const monday = new Date(base)
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
    const storeId = query.storeId || defaultStoreId()
    const days = []
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const weekday = localDateTime(dateStr, '12:00').getDay()
      const hours = db.prepare('SELECT * FROM business_hours WHERE store_id = ? AND weekday = ?').get(storeId, weekday)
      const special = specialDateFor(storeId, dateStr)
      days.push({
        date: dateStr,
        weekday,
        isClosed: special ? Boolean(special.is_closed) : (!hours || Boolean(hours.is_closed)),
        openTime: (special && !special.is_closed && special.open_time) || hours?.open_time || '10:00',
        closeTime: (special && !special.is_closed && special.close_time) || hours?.close_time || '19:00',
        specialNote: special?.note || (special ? (special.is_closed ? '特殊休息' : '特殊时段') : '')
      })
    }
    // 排班为团队可见:员工也返回本店全部技师(只读);多租户按店过滤
    const technicians = db.prepare('SELECT * FROM technicians WHERE tenant_id = ? ORDER BY is_active DESC, name ASC').all(currentTenantId())
    const dates = days.map((day) => day.date)
    // 2026-08-07:此前只按日期取,别家店的排班行会一起返回;限定为本店技师
    const techIds = technicians.map((t) => t.id)
    const schedules = (techIds.length ? db.prepare(`SELECT technician_id, date, start_time, end_time, is_working FROM technician_schedules
        WHERE date IN (${dates.map(() => '?').join(',')}) AND technician_id IN (${techIds.map(() => '?').join(',')})`)
      .all(...dates, ...techIds) : [])
      .map((row) => ({ technicianId: row.technician_id, date: row.date, startTime: row.start_time, endTime: row.end_time, isWorking: Boolean(row.is_working) }))
    const bookingCounts = []
    for (const day of days) {
      const dayStart = iso(localDateTime(day.date, '00:00'))
      const dayEnd = iso(addMinutes(localDateTime(day.date, '00:00'), 24 * 60))
      const rows = db.prepare(`SELECT technician_id, COUNT(*) AS n FROM bookings WHERE tenant_id = ? AND status IN ('PENDING_PAYMENT','CONFIRMED') AND appointment_start >= ? AND appointment_start < ? GROUP BY technician_id`).all(currentTenantId(), dayStart, dayEnd)
      for (const row of rows) bookingCounts.push({ technicianId: row.technician_id, date: day.date, count: row.n })
    }
    return json(res, 200, {
      weekStart: days[0].date,
      days,
      technicians: technicians.map((tech) => ({ id: tech.id, name: tech.name, title: tech.title, isActive: Boolean(tech.is_active) })),
      schedules,
      bookingCounts
    })
  }
  // 技师维度·日视图(2026-07-22 P0-①):某天每技师的预约明细,前端画时间轴色块
  if (req.method === 'GET' && path === '/admin/schedule-day') {
    const tid = currentTenantId()
    const date = query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : localParts(new Date()).date
    const storeId = query.storeId || defaultStoreId()
    const weekday = localDateTime(date, '12:00').getDay()
    const hours = db.prepare('SELECT * FROM business_hours WHERE store_id = ? AND weekday = ?').get(storeId, weekday)
    const special = specialDateFor(storeId, date)
    const isClosed = special ? Boolean(special.is_closed) : (!hours || Boolean(hours.is_closed))
    const openTime = (special && !special.is_closed && special.open_time) || hours?.open_time || '10:00'
    const closeTime = (special && !special.is_closed && special.close_time) || hours?.close_time || '19:00'
    const allTechs = db.prepare('SELECT id, name, title, is_active FROM technicians WHERE tenant_id = ? ORDER BY is_active DESC, name ASC').all(tid)
    const dayStart = iso(localDateTime(date, '00:00'))
    const dayEnd = iso(addMinutes(localDateTime(date, '00:00'), 24 * 60))
    const rows = db.prepare(`SELECT * FROM bookings WHERE tenant_id = ? AND status IN ('PENDING_PAYMENT','CONFIRMED','COMPLETED')
      AND appointment_start >= ? AND appointment_start < ? ORDER BY appointment_start ASC`).all(tid, dayStart, dayEnd)
    // 服务分组(色相):足部美甲/护理由名称识别,其余按类型
    const groupOf = (svc) => {
      if (!svc) return 'hand'
      const n = String(svc.name_zh || '') + String(svc.category || '')
      if (/足|美足|pedicure/i.test(n)) return 'foot'
      if (/护理|护|spa/i.test(n)) return 'care'
      const t = String(svc.type).toUpperCase()
      if (t === 'LASH') return 'lash'
      if (t === 'CARE' || t === 'OTHER') return 'care' // 新类型:台面用护理色相
      return 'hand'
    }
    const bookings = rows.map((row) => {
      const svc = row.service_id ? getService(row.service_id) : null
      const u = row.user_id ? db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(row.user_id) : null
      const startLocal = localParts(row.appointment_start)
      const endLocal = localParts(row.appointment_end)
      const arrivalState = row.status === 'COMPLETED' ? 'done' : (row.arrived_at ? 'active' : 'pending')
      // 新客:该顾客在本店有没有更早的单(按 appointment_start)
      const earlier = row.user_id
        ? db.prepare(`SELECT 1 FROM bookings WHERE tenant_id = ? AND user_id = ? AND appointment_start < ?
            AND status IN ('PENDING_PAYMENT','CONFIRMED','COMPLETED') LIMIT 1`).get(tid, row.user_id, row.appointment_start)
        : null
      const custName = u ? (isGenericDisplayName(u.display_name, u.id) ? memberCodeForUserId(u.id) : u.display_name) : '散客'
      return {
        id: row.id,
        publicCode: row.public_code,
        technicianId: row.technician_id,
        userId: row.user_id,
        status: row.status,
        customerName: custName,
        serviceId: row.service_id || '', // 台面点单 → 去结算,结算页要用它预勾预约项目
        serviceName: svc ? svc.name_zh : '服务',
        serviceType: svc ? svc.type : '',
        group: groupOf(svc),
        arrivalState,
        startTime: startLocal.time,
        endTime: endLocal.time,
        durationMin: row.total_duration_min || Math.max(30, Math.round((new Date(row.appointment_end) - new Date(row.appointment_start)) / 60000)),
        isNewCustomer: !earlier,
        isDesignated: /指定|指名|点名/.test(String(row.notes || '')),
        ownerDirect: row.source_channel === 'owner_direct',
        depositUnpaid: Boolean(row.direct_deposit_unpaid)
      }
    })
    const bookingCount = {}
    for (const b of bookings) bookingCount[b.technicianId] = (bookingCount[b.technicianId] || 0) + 1
    // 只显示在岗技师 + 今天有单的技师(避免停用测试技师塞满表头)
    const technicians = allTechs
      .filter((t) => t.is_active || bookingCount[t.id])
      .map((t) => ({ id: t.id, name: t.name, title: t.title, isActive: Boolean(t.is_active), bookingCount: bookingCount[t.id] || 0 }))
    const activeCount = bookings.filter((b) => b.arrivalState === 'active').length
    const pendingCount = bookings.filter((b) => b.arrivalState === 'pending').length
    return json(res, 200, {
      date, weekday, isClosed, openTime, closeTime,
      specialNote: special?.note || '',
      technicians,
      bookings,
      activeCount, pendingCount
    })
  }
  // 排班申请:员工发起(只能为自己),老板审批
  if (req.method === 'POST' && path === '/admin/schedule-requests') {
    const body = await readBody(req)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '')) throw apiError(400, 'BAD_REQUEST', 'date must be YYYY-MM-DD.')
    const technicianId = adminSession.role === 'staff' ? adminSession.technicianId : String(body.technicianId || '')
    if (!technicianId) throw apiError(400, 'BAD_REQUEST', 'technicianId is required.')
    if (adminSession.role === 'staff' && body.technicianId && body.technicianId !== adminSession.technicianId) {
      throw apiError(403, 'FORBIDDEN', '只能为自己发起排班申请。')
    }
    const duplicate = db.prepare("SELECT id FROM schedule_change_requests WHERE technician_id = ? AND date = ? AND status = 'pending'").get(technicianId, body.date)
    if (duplicate) throw apiError(409, 'DUPLICATE', '该日期已有待处理的申请。')
    const id = randomId('schreq')
    db.prepare('INSERT INTO schedule_change_requests (id, technician_id, date, note, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, technicianId, body.date, String(body.note || '').slice(0, 300), 'pending', iso(new Date()))
    return json(res, 201, { request: db.prepare('SELECT * FROM schedule_change_requests WHERE id = ?').get(id) })
  }
  if (req.method === 'GET' && path === '/admin/schedule-requests') {
    const rows = adminSession.role === 'staff'
      ? db.prepare('SELECT r.*, t.name AS tech_name FROM schedule_change_requests r LEFT JOIN technicians t ON t.id = r.technician_id WHERE r.technician_id = ? ORDER BY r.created_at DESC LIMIT 40').all(adminSession.technicianId)
      : db.prepare('SELECT r.*, t.name AS tech_name FROM schedule_change_requests r JOIN technicians t ON t.id = r.technician_id AND t.tenant_id = ? ORDER BY CASE r.status WHEN ? THEN 0 ELSE 1 END, r.created_at DESC LIMIT 60').all(currentTenantId(), 'pending')
    return json(res, 200, {
      requests: rows.map((row) => ({
        id: row.id, technicianId: row.technician_id, technicianName: row.tech_name || row.technician_id,
        date: row.date, note: row.note || '', status: row.status, resolution: row.resolution || '',
        createdAt: row.created_at, resolvedAt: row.resolved_at
      }))
    })
  }
  // 审批:set-off=批准并把当天设为休息;handled=批准(老板已手动调整);reject=拒绝
  const schReqMatch = path.match(/^\/admin\/schedule-requests\/([^/]+)\/(set-off|handled|reject)$/)
  if (req.method === 'POST' && schReqMatch) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const row = db.prepare('SELECT r.* FROM schedule_change_requests r JOIN technicians t ON t.id = r.technician_id AND t.tenant_id = ? WHERE r.id = ?').get(currentTenantId(), schReqMatch[1])
    if (!row) throw apiError(404, 'NOT_FOUND', 'Request not found.')
    if (row.status !== 'pending') throw apiError(400, 'BAD_REQUEST', '该申请已处理过。')
    const action = schReqMatch[2]
    if (action === 'set-off') {
      db.prepare(`INSERT INTO technician_schedules (technician_id, date, start_time, end_time, is_working)
        VALUES (?, ?, '10:00', '19:00', 0)
        ON CONFLICT(technician_id, date) DO UPDATE SET is_working = 0`).run(row.technician_id, row.date)
    }
    db.prepare("UPDATE schedule_change_requests SET status = ?, resolution = ?, resolved_at = ?, resolved_by = ? WHERE id = ?")
      .run(action === 'reject' ? 'rejected' : 'approved', action, iso(new Date()), adminSession.email || 'owner', row.id)
    return json(res, 200, { request: db.prepare('SELECT * FROM schedule_change_requests WHERE id = ?').get(row.id) })
  }
  // 员工自查:预计本月薪酬(底薪+提成×本月完成业绩;以老板月结确认为准,不需要财务钥匙)
  if (req.method === 'GET' && path === '/admin/my-compensation-estimate') {
    const technicianId = adminSession.role === 'staff' ? adminSession.technicianId : query.technicianId
    if (!technicianId) throw apiError(400, 'BAD_REQUEST', 'technicianId is required.')
    const comp = db.prepare('SELECT * FROM staff_compensation WHERE technician_id = ? AND tenant_id = ?').get(technicianId, currentTenantId())
    if (!comp || !comp.active) return json(res, 200, { estimate: null })
    const monthStart = `${localParts(new Date()).date.slice(0, 7)}-01`
    const revenue = db.prepare(`SELECT COALESCE(SUM(service_price_cents), 0) AS total FROM bookings
      WHERE technician_id = ? AND status = 'COMPLETED' AND appointment_start >= ?`).get(technicianId, iso(localDateTime(monthStart, '00:00'))).total
    const commissionCents = Math.round(revenue * comp.commission_rate)
    return json(res, 200, {
      estimate: {
        monthRevenueCents: revenue,
        baseSalaryCents: comp.base_salary_cents,
        commissionRate: comp.commission_rate,
        commissionCents,
        totalCents: comp.base_salary_cents + commissionCents
      }
    })
  }
  // 批量排班:把本周模式应用到未来数周
  if (req.method === 'POST' && path === '/admin/schedule-batch') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const body = await readBody(req)
    const entries = Array.isArray(body.entries) ? body.entries : []
    if (!entries.length) throw apiError(400, 'BAD_REQUEST', 'entries is required.')
    if (entries.length > 400) throw apiError(400, 'BAD_REQUEST', 'Too many entries in one batch.')
    const stmt = db.prepare(`INSERT INTO technician_schedules (technician_id, date, start_time, end_time, is_working)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(technician_id, date) DO UPDATE SET start_time = excluded.start_time, end_time = excluded.end_time, is_working = excluded.is_working`)
    const techOk = db.prepare('SELECT id FROM technicians WHERE id = ? AND tenant_id = ?')
    let applied = 0
    for (const entry of entries) {
      if (!entry.technicianId || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date || '')) continue
      if (!techOk.get(entry.technicianId, currentTenantId())) continue // 多租户:只排本店技师
      stmt.run(entry.technicianId, entry.date, entry.startTime || '10:00', entry.endTime || '19:00', Number(Boolean(entry.isWorking)))
      applied += 1
    }
    return json(res, 200, { applied })
  }
  // 员工管理:添加技师
  if (req.method === 'POST' && path === '/admin/technicians') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const body = await readBody(req)
    const name = String(body.name || '').trim()
    if (!name) throw apiError(400, 'BAD_REQUEST', 'Technician name is required.')
    const id = randomId('tech')
    db.prepare('INSERT INTO technicians (id, store_id, name, title, is_active, tenant_id) VALUES (?, ?, ?, ?, 1, ?)')
      .run(id, body.storeId || defaultStoreId(), name, String(body.title || '').trim() || null, currentTenantId())
    // 默认可做本店所有在售服务(与新增服务时的自动指派保持一致)
    const assign = db.prepare('INSERT OR IGNORE INTO technician_services (technician_id, service_id) VALUES (?, ?)')
    for (const service of db.prepare('SELECT id FROM services WHERE is_active = 1 AND tenant_id = ?').all(currentTenantId())) assign.run(id, service.id)
    return json(res, 201, { technician: db.prepare('SELECT * FROM technicians WHERE id = ?').get(id) })
  }
  // 客户运营字段:标签/备注/生日
  if (req.method === 'PATCH' && path.startsWith('/admin/customers/') && path.endsWith('/profile')) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const userId = path.split('/')[3]
    const current = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    if (!current) throw apiError(404, 'NOT_FOUND', 'Customer not found.')
    const body = await readBody(req)
    const tags = body.tags === undefined
      ? (parseJson(current.tags_json) || [])
      : (Array.isArray(body.tags) ? body.tags : String(body.tags).split(/[,，、]/)).map((tag) => String(tag).trim()).filter(Boolean).slice(0, 12)
    const notes = body.notes === undefined ? (current.notes || '') : String(body.notes).slice(0, 2000)
    const birthday = body.birthday === undefined ? (current.birthday || '') : String(body.birthday).trim()
    if (birthday && !/^(\d{4}-)?\d{2}-\d{2}$/.test(birthday)) throw apiError(400, 'BAD_REQUEST', '生日格式应为 MM-DD 或 YYYY-MM-DD。')
    db.prepare('UPDATE users SET tags_json = ?, notes = ?, birthday = ? WHERE id = ?').run(JSON.stringify(tags), notes, birthday, userId)
    return json(res, 200, { customer: { id: userId, tags, notes, birthday } })
  }
  // 员工管理:改名/职称/在职状态
  if (req.method === 'PATCH' && path.startsWith('/admin/technicians/') && !path.endsWith('/schedule')) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const technicianId = path.split('/')[3]
    const current = db.prepare('SELECT * FROM technicians WHERE id = ? AND tenant_id = ?').get(technicianId, currentTenantId())
    if (!current) throw apiError(404, 'NOT_FOUND', 'Technician not found.')
    const body = await readBody(req)
    const name = String(body.name ?? current.name).trim() || current.name
    const title = body.title === undefined ? current.title : (String(body.title || '').trim() || null)
    const isActive = body.isActive === undefined ? current.is_active : Number(Boolean(body.isActive))
    db.prepare('UPDATE technicians SET name = ?, title = ?, is_active = ? WHERE id = ?').run(name, title, isActive, technicianId)
    return json(res, 200, { technician: db.prepare('SELECT * FROM technicians WHERE id = ?').get(technicianId) })
  }
  if (req.method === 'GET' && path === '/admin/tenant/plan') {
    return json(res, 200, { entitlements: getEntitlements(currentTenantId()) })
  }
  if (req.method === 'GET' && path === '/admin/finance/lock-status') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    return json(res, 200, { configured: financeLockConfigured() })
  }
  if (req.method === 'POST' && path === '/admin/finance/unlock') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const body = await readBody(req)
    const password = String(body.password || '')
    // 开发/测试主钥匙:OWNER_TOKEN 本身即最高信任根,可直接解锁(生产环境该值为保密配置)
    if (password && password === OWNER_TOKEN) {
      return json(res, 200, { financeKey: issueFinanceKey(), configured: financeLockConfigured(), master: true })
    }
    if (!financeLockConfigured()) {
      // 首次设置财务密码
      if (password.length < 4) throw apiError(400, 'BAD_REQUEST', '财务密码至少 4 位。')
      if (password !== String(body.confirmPassword || '')) throw apiError(400, 'BAD_REQUEST', '两次输入的密码不一致。')
      db.prepare('UPDATE tenants SET finance_password_hash = ?, updated_at = ? WHERE id = ?')
        .run(financePasswordHash(password), iso(new Date()), currentTenantId())
      return json(res, 201, { financeKey: issueFinanceKey(), configured: true, created: true })
    }
    const stored = db.prepare('SELECT finance_password_hash FROM tenants WHERE id = ?').get(currentTenantId())?.finance_password_hash
    if (financePasswordHash(password) !== stored) throw apiError(401, 'WRONG_FINANCE_PASSWORD', '财务密码不正确。忘记密码时,可输入启动服务器窗口里显示的 Owner Token 解锁,进入后在「财务设置」里重设密码。')
    return json(res, 200, { financeKey: issueFinanceKey(), configured: true })
  }
  // 修改财务密码:旧密码或 Owner Token(忘记密码时的主钥匙)验证通过后重设
  if (req.method === 'POST' && path === '/admin/finance/change-password') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const body = await readBody(req)
    const current = String(body.currentPassword || '')
    const next = String(body.newPassword || '')
    if (next.length < 4) throw apiError(400, 'BAD_REQUEST', '新财务密码至少 4 位。')
    if (next !== String(body.confirmPassword || '')) throw apiError(400, 'BAD_REQUEST', '两次输入的新密码不一致。')
    const stored = db.prepare('SELECT finance_password_hash FROM tenants WHERE id = ?').get(currentTenantId())?.finance_password_hash
    const authorized = current === OWNER_TOKEN || (stored && financePasswordHash(current) === stored) || !stored
    if (!authorized) throw apiError(401, 'WRONG_FINANCE_PASSWORD', '旧密码不正确(忘记旧密码时可填 Owner Token)。')
    db.prepare('UPDATE tenants SET finance_password_hash = ?, updated_at = ? WHERE id = ?')
      .run(financePasswordHash(next), iso(new Date()), currentTenantId())
    return json(res, 200, { changed: true, financeKey: issueFinanceKey() })
  }
  // 财务数据统一门禁:除解锁/状态接口外,所有财务相关路由都需要有效的财务会话钥匙
  if ((path.startsWith('/admin/finance/') || path.startsWith('/admin/stored-value') || path === '/admin/demo/finance-seed')
    && path !== '/admin/finance/unlock' && path !== '/admin/finance/lock-status' && path !== '/admin/finance/change-password') {
    requireFinanceKey(req)
  }
  if (req.method === 'GET' && path === '/admin/stored-value') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    return json(res, 200, { storedValue: storedValueOverview() })
  }
  if (req.method === 'POST' && (path === '/admin/stored-value/recharge' || path === '/admin/stored-value/consume')) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const isRecharge = path.endsWith('/recharge')
    const body = await readBody(req)
    const userId = String(body.userId || '').trim()
    const user = db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(userId)
    if (!user) throw apiError(404, 'NOT_FOUND', 'Member not found.')
    const amountCents = Math.round(Number(body.amountCents ?? Number(body.amount || 0) * 100))
    if (!Number.isFinite(amountCents) || amountCents <= 0) throw apiError(400, 'BAD_REQUEST', 'A positive amount is required.')
    if (!isRecharge && storedValueBalanceCents(userId) < amountCents) {
      throw apiError(400, 'INSUFFICIENT_BALANCE', '余额不足：耗卡金额不能超过该会员当前储值余额。')
    }
    // 经手技师(可选):这笔充值/耗卡算谁促成,薪资的充值/耗卡提成据此计算
    const svTech = String(body.technicianId || '').trim()
    if (svTech && !db.prepare('SELECT 1 FROM technicians WHERE id = ? AND tenant_id = ?').get(svTech, currentTenantId())) {
      throw apiError(404, 'NOT_FOUND', '经手技师不存在。')
    }
    insertStoredValueTransaction({
      userId,
      type: isRecharge ? 'recharge' : 'consume',
      amountCents,
      payChannel: isRecharge ? String(body.payChannel || 'unknown') : 'stored_value',
      note: String(body.note || ''),
      createdBy: adminSession.email || 'owner',
      technicianId: svTech || null
    })
    if (!isRecharge) {
      // 耗卡即确认收入：支付方式=储值卡
      insertFinanceTransaction({
        type: 'income',
        source: 'stored_value',
        category: '服务收入-耗卡',
        tags: userId,
        amountCents,
        payChannel: 'stored_value',
        occurredOn: localParts(new Date()).date,
        note: String(body.note || `${user.display_name || userId} 耗卡`),
        createdBy: adminSession.email || 'owner'
      })
    }
    return json(res, 201, { storedValue: storedValueOverview(), balanceCents: storedValueBalanceCents(userId) })
  }
  if (req.method === 'POST' && path === '/admin/finance/insights') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    requireAi()
    const month = localParts(new Date()).date.slice(0, 7)
    const progress = computeFinanceProgress(month)
    const byCategory = db.prepare(`
      SELECT category, SUM(amount_cents) AS total FROM finance_transactions
      WHERE tenant_id = ? AND occurred_on >= ? AND occurred_on <= ?
      GROUP BY category ORDER BY ABS(SUM(amount_cents)) DESC LIMIT 8
    `).all(currentTenantId(), `${month}-01`, `${month}-31`)
    const storedValue = storedValueOverview()
    const lines = []
    lines.push(`【${month} 财务解读】收入 ${cadFromCentsText(progress.revenueCents)},支出 ${cadFromCentsText(progress.expenseCents)},净利 ${cadFromCentsText(progress.netCents)}${progress.pendingPayrollCents ? `(计提待结工资后预估 ${cadFromCentsText(progress.estimatedNetCents)})` : ''}。`)
    if (progress.monthRevenueTargetCents > 0) {
      const pct = Math.round((progress.revenueCents / progress.monthRevenueTargetCents) * 100)
      lines.push(`月目标完成 ${pct}%,按当前节奏预计月底 ${cadFromCentsText(progress.paceProjectionCents)}${progress.paceProjectionCents >= progress.monthRevenueTargetCents ? ',有望达标' : `,预计差 ${cadFromCentsText(progress.monthRevenueTargetCents - progress.paceProjectionCents)}`}。`)
      lines.push(progress.revenueCents >= progress.breakEvenRevenueCents ? '本月已越过收支平衡线。' : `距收支平衡还差 ${cadFromCentsText(progress.breakEvenRevenueCents - progress.revenueCents)}。`)
    }
    const topIncome = byCategory.filter((item) => item.total > 0).slice(0, 2)
    const topExpense = byCategory.filter((item) => item.total < 0).slice(0, 2)
    if (topIncome.length) lines.push(`收入主力:${topIncome.map((item) => `${item.category} ${cadFromCentsText(item.total)}`).join('、')}。`)
    if (topExpense.length) lines.push(`支出大头:${topExpense.map((item) => `${item.category} ${cadFromCentsText(-item.total)}`).join('、')}。`)
    if (storedValue.totalBalanceCents > 0) {
      lines.push(`储值负债 ${cadFromCentsText(storedValue.totalBalanceCents)},本月耗卡 ${cadFromCentsText(storedValue.monthConsumeCents)};${storedValue.accounts.filter((item) => item.dormantDays >= 30).length} 张卡超 30 天未动,建议做唤醒营销。`)
    }
    return json(res, 200, { insight: { month, text: lines.join('\n'), generatedAt: iso(new Date()) } })
  }
  if (req.method === 'POST' && path === '/admin/demo/finance-seed') {
    if (adminSession.role !== 'owner' || currentTenantId() !== DEFAULT_TENANT_ID) throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const marker = 'demo-seed'
    const already = db.prepare("SELECT id FROM finance_transactions WHERE tags = ? LIMIT 1").get(marker)
    if (already) return json(res, 200, { seeded: false, message: '演示数据已存在，无需重复填充。' })
    const month = localParts(new Date()).date.slice(0, 7)
    const day = (n) => `${month}-${String(Math.min(n, 28)).padStart(2, '0')}`
    const demoTxns = [
      ['income', '产品销售', 6800, 'wechat', day(2), '护甲油 x2'],
      ['income', '礼品卡', 20000, 'alipay', day(3), '礼品卡售出'],
      ['income', '产品销售', 4500, 'cash', day(8), '手部护理套装'],
      ['income', '其他收入', 3000, 'card', day(12), '教学体验课'],
      ['expense', '耗材采购', 28600, 'wechat', day(4), '甲油胶补货'],
      ['expense', '耗材采购', 9800, 'alipay', day(15), '棉片/酒精/封层'],
      ['expense', '营销推广', 15000, 'card', day(6), '小红书投放'],
      ['expense', '设备', 32000, 'card', day(10), '新美甲灯 x2'],
      ['expense', '平台软件费', 6900, 'card', day(1), '预约系统月费'],
      ['expense', '其他支出', 4200, 'cash', day(18), '店内绿植和杂项']
    ]
    for (const [type, category, amountCents, payChannel, occurredOn, note] of demoTxns) {
      insertFinanceTransaction({ type, category, amountCents, payChannel, occurredOn, note: `${note}（演示）`, tags: marker, source: 'manual', createdBy: 'demo-seed' })
    }
    const hasRule = db.prepare("SELECT id FROM finance_recurring_rules WHERE tenant_id = ? AND name LIKE '%演示%'").get(currentTenantId())
    if (!hasRule) {
      db.prepare(`INSERT INTO finance_recurring_rules (id, tenant_id, name, category, tags, amount_cents, cadence, day_of_month, active, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'monthly', 1, 1, 'demo-seed', ?, ?)`)
        .run(randomId('finrule'), currentTenantId(), '店面房租（演示）', '房租', marker, 420000, iso(new Date()), iso(new Date()))
      db.prepare(`INSERT INTO finance_recurring_rules (id, tenant_id, name, category, tags, amount_cents, cadence, day_of_month, active, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'monthly', 1, 1, 'demo-seed', ?, ?)`)
        .run(randomId('finrule'), currentTenantId(), '水电网（演示）', '水电网', marker, 26000, iso(new Date()), iso(new Date()))
      materializeRecurringTransactions()
    }
    const hasTarget = getFinanceTargets(currentTenantId()).monthTargetCents > 0
    if (!hasTarget) {
      db.prepare(`INSERT INTO finance_targets (tenant_id, target_mode, month_target_cents, year_target_cents, variable_cost_rate, updated_by, updated_at)
        VALUES (?, 'net_profit', 300000, 4000000, 0.25, 'demo-seed', ?)
        ON CONFLICT(tenant_id) DO NOTHING`).run(currentTenantId(), iso(new Date()))
    }
    const demoMembers = db.prepare("SELECT id FROM users ORDER BY rowid ASC LIMIT 3").all()
    const now = Date.now()
    demoMembers.forEach((member, index) => {
      const rechargeAt = new Date(now - (index === 2 ? 65 : 10 + index * 5) * 86400000).toISOString()
      insertStoredValueTransaction({ userId: member.id, type: 'recharge', amountCents: [50000, 30000, 80000][index], payChannel: 'wechat', note: '储值充值（演示）', createdBy: 'demo-seed', createdAt: rechargeAt })
      if (index === 0) {
        insertStoredValueTransaction({ userId: member.id, type: 'consume', amountCents: 16800, note: '经典法式耗卡（演示）', createdBy: 'demo-seed', createdAt: new Date(now - 2 * 86400000).toISOString() })
        insertFinanceTransaction({ type: 'income', source: 'stored_value', category: '服务收入-耗卡', tags: marker, amountCents: 16800, payChannel: 'stored_value', occurredOn: day(20), note: '经典法式耗卡（演示）', createdBy: 'demo-seed' })
      }
    })
    return json(res, 201, { seeded: true, message: '演示数据已填充：本月流水、固定支出规则、默认目标、三个储值账户（含一张沉睡卡）。' })
  }
  // 全页面演示数据:客户/订单/会话/报价任务/储值,一键填充(幂等,正式上线前用重置数据.command清除)
  if (req.method === 'POST' && path === '/admin/demo/full-seed') {
    if (adminSession.role !== 'owner' || currentTenantId() !== DEFAULT_TENANT_ID) throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    if (db.prepare("SELECT id FROM users WHERE id = 'demo-cust-01'").get()) {
      return json(res, 200, { seeded: false, message: '全页面演示数据已存在,无需重复填充。' })
    }
    const storeId = defaultStoreId()
    const techs = db.prepare('SELECT id FROM technicians WHERE is_active = 1 LIMIT 5').all().map((row) => row.id)
    const services = db.prepare('SELECT id, price_cents, base_duration_min FROM services WHERE is_active = 1 LIMIT 8').all()
    if (!techs.length || !services.length) throw apiError(400, 'BAD_REQUEST', '需要至少一名技师和一个在售服务才能填充演示数据。')
    const now = new Date()
    const nowIso = iso(now)
    const dstr = (offsetDays) => {
      const d = new Date(now)
      d.setDate(d.getDate() + offsetDays)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    // 1. 演示客户(带标签/备注/生日,不同消费档)
    const demoCustomers = [
      ['demo-cust-01', '林小雅', '+1 416 555 0101', ['偏好裸色系', '怕痛'], '手部皮肤敏感,建议用温和底胶。', '03-14'],
      ['demo-cust-02', '王梦琪', '+1 416 555 0102', ['对甲油胶过敏'], '只能用低敏产品线!服务前必看。', '08-16'],
      ['demo-cust-03', 'Sophie Chen', '+1 647 555 0103', ['VIP', '介绍朋友多'], '喜欢当季新款,可主动推荐。', '11-02'],
      ['demo-cust-04', '张玲', '+1 437 555 0104', ['美睫常客'], '', '05-30'],
      ['demo-cust-05', 'Emma Liu', '+1 416 555 0105', ['学生', '价格敏感'], '', ''],
      ['demo-cust-06', '陈思思', '+1 647 555 0106', [], '', '12-24'],
      ['demo-cust-07', '李慧', '+1 437 555 0107', ['孕期'], '孕期客人:避免刺激性气味产品,座位调靠窗。', '07-07'],
      ['demo-cust-08', '赵敏', '+1 416 555 0108', [], '', '']
    ]
    const insertUser = db.prepare('INSERT INTO users (id, display_name, phone, email, tags_json, notes, birthday) VALUES (?, ?, ?, ?, ?, ?, ?)')
    for (const [id, name, phone, tags, notes, birthday] of demoCustomers) {
      insertUser.run(id, `${name}（演示）`, phone, `${id}@demo.local`, JSON.stringify(tags), notes, birthday)
    }
    // 2. 订单:过去8周完成单(撑起趋势/技师业绩/客户消费档),今天/未来单,取消单
    const insertBooking = db.prepare(`INSERT INTO bookings
      (id, public_code, user_id, store_id, technician_id, service_id, status, appointment_start, appointment_end, addons_json, reference_images_json, source_channel, notes, service_price_cents, deposit_cents, deposit_required_cents, deposit_waived_cents, deposit_waive_reason, member_level_at_booking, final_due_cents, total_duration_min, payment_expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?, ?, ?, 5000, 5000, 0, NULL, NULL, ?, ?, ?, ?, ?)`)
    const seedBooking = (userIdx, dayOffset, hour, status, svcIdx, techIdx, channel = 'demo-seed') => {
      const service = services[svcIdx % services.length]
      const start = localDateTime(dstr(dayOffset), `${String(hour).padStart(2, '0')}:00`)
      const end = addMinutes(start, service.base_duration_min)
      const price = service.price_cents
      // publicCode 同毫秒批量插入可能撞号,冲突就换号重试
      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          insertBooking.run(
            randomId('booking'), `${publicCode()}${attempt ? Math.floor(Math.random() * 900 + 100) : ''}`, demoCustomers[userIdx % demoCustomers.length][0], storeId,
            techs[techIdx % techs.length], service.id, status, iso(start), iso(end), channel, '演示订单',
            price, price - 5000, service.base_duration_min,
            status === 'PENDING_PAYMENT' ? iso(addMinutes(now, 60)) : null, iso(start), iso(start)
          )
          return price
        } catch (error) {
          if (!String(error.message || '').includes('public_code')) throw error
        }
      }
      throw apiError(500, 'SEED_FAILED', '演示订单编号连续冲突。')
    }
    let seededRevenue = 0
    let bookingCount = 0
    // 过去8周:每周 2-3 单完成
    const pastPlan = [-55, -52, -48, -45, -41, -38, -34, -30, -27, -23, -20, -16, -13, -9, -6, -4, -2, -1]
    pastPlan.forEach((offset, index) => {
      const price = seedBooking(index, offset, 10 + (index % 4) * 2, 'COMPLETED', index, index)
      bookingCount += 1
      // 近30天的完成单同步写进账本收入,让首页营收趋势有型(演示标记,可冲销/重置)
      if (offset >= -28) {
        insertFinanceTransaction({ type: 'income', source: 'booking', category: '服务收入', tags: 'demo-seed-full', amountCents: price, payChannel: index % 2 ? 'wechat' : 'card', occurredOn: dstr(offset), note: '演示订单收入', createdBy: 'demo-seed' })
        seededRevenue += price
      }
    })
    // 今天 2 单已确认、未来 2 确认 + 1 待付定金、昨天 1 取消
    seedBooking(2, 0, 14, 'CONFIRMED', 1, 0); bookingCount += 1
    seedBooking(3, 0, 16, 'CONFIRMED', 3, 1 % techs.length); bookingCount += 1
    seedBooking(4, 2, 11, 'CONFIRMED', 2, 0); bookingCount += 1
    seedBooking(5, 3, 15, 'CONFIRMED', 4, 1 % techs.length); bookingCount += 1
    seedBooking(6, 1, 13, 'PENDING_PAYMENT', 0, 0); bookingCount += 1
    seedBooking(7, -1, 17, 'CANCELLED', 5, 0); bookingCount += 1
    // 3. 会话:一条待人工 + 一条 AI 处理中(绑定到林小雅,演示互链)
    const insertConversation = db.prepare(`INSERT INTO wechat_conversations
      (id, provider, external_user_id, open_kfid, source_channel, status, last_intent, last_message, ai_reply_json, transcript_json, raw_event_json, created_at, updated_at)
      VALUES (?, 'wecom_customer_service', ?, 'demo-kfid', ?, ?, ?, ?, '{}', ?, '{}', ?, ?)`)
    const t1 = new Date(now.getTime() - 25 * 60000)
    insertConversation.run(
      'wecom:demo-chat-01', 'demo-chat-01', '小红书', 'needs_human', 'after_sales_review',
      '我前天做的甲今天掉了一颗,怎么办?',
      JSON.stringify([
        { role: 'customer', content: '我前天做的甲今天掉了一颗,怎么办?', at: iso(t1) },
        { role: 'assistant', content: '不好意思给您添麻烦了!这是售后问题,我已经转给我们的技师,会尽快联系您安排补做。方便的话请发一张现在的照片。', at: iso(new Date(t1.getTime() + 30000)) }
      ]),
      iso(t1), iso(t1)
    )
    const t2 = new Date(now.getTime() - 6 * 60000)
    insertConversation.run(
      'wecom:demo-chat-02', 'demo-chat-02', '微信', 'open', 'price_inquiry',
      '你们家法式美甲多少钱呀?',
      JSON.stringify([
        { role: 'customer', content: '你们家法式美甲多少钱呀?', at: iso(t2) },
        { role: 'assistant', content: '基础法式可以按基础价执行哦,详细价格取决于款式复杂度。您可以发个参考图,我帮您让技师看看准确报价~', at: iso(new Date(t2.getTime() + 20000)) }
      ]),
      iso(t2), iso(t2)
    )
    upsertUserIdentity({ userId: 'demo-cust-01', provider: 'wecom_customer_service', providerUserId: 'demo-chat-01' })
    // 4. 待技师报价任务
    db.prepare(`INSERT INTO quote_requests (id, conversation_id, user_id, source_channel, service_type, status, customer_message, customer_lang, reference_images_json, created_at, updated_at)
      VALUES (?, 'wecom:demo-chat-02', 'demo-cust-02', '微信', 'nail', 'PENDING_STAFF', '想做渐变猫眼加两颗小钻,大概多少钱?', 'zh', '[]', ?, ?)`)
      .run(randomId('quote'), nowIso, nowIso)
    // 5. 储值:两位演示客户(其中一张沉睡卡)
    insertStoredValueTransaction({ userId: 'demo-cust-03', type: 'recharge', amountCents: 100000, payChannel: 'wechat', note: '储值充值（演示）', createdBy: 'demo-seed', createdAt: iso(new Date(now.getTime() - 12 * 86400000)) })
    insertStoredValueTransaction({ userId: 'demo-cust-03', type: 'consume', amountCents: 18800, note: '猫眼美甲耗卡（演示）', createdBy: 'demo-seed', createdAt: iso(new Date(now.getTime() - 5 * 86400000)) })
    insertFinanceTransaction({ type: 'income', source: 'stored_value', category: '服务收入-耗卡', tags: 'demo-seed-full', amountCents: 18800, payChannel: 'stored_value', occurredOn: dstr(-5), note: '猫眼美甲耗卡（演示）', createdBy: 'demo-seed' })
    insertStoredValueTransaction({ userId: 'demo-cust-07', type: 'recharge', amountCents: 50000, payChannel: 'alipay', note: '储值充值（演示）', createdBy: 'demo-seed', createdAt: iso(new Date(now.getTime() - 70 * 86400000)) })
    return json(res, 201, {
      seeded: true,
      message: `全页面演示数据已填充:${demoCustomers.length} 位客户(含标签/生日/储值)、${bookingCount} 个订单(完成/今日/未来/待付/取消)、2 条会话(1条待人工+1条已绑定会员)、1 个待报价任务、近30天账本收入 ${(seededRevenue / 100).toFixed(0)} 加元。正式上线前用 重置数据.command 一键清除。`
    })
  }
  // ===== 套餐与续费(2026-08-03,店主确认设计稿后开工)=====
  // SaaS 服务费:收款主体=平台运营公司(类目含软件/IT服务),与门店经营账分离。
  // v1 支付:未配微信支付参数时订单停在 pending(引导联系客服);WXPAY_MOCK=1(仅本地沙盘)可模拟支付走通全流程。
  if (req.method === 'GET' && path === '/admin/subscription') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可查看套餐。')
    const tid = currentTenantId()
    const ent = getEntitlements(tid)
    const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tid)
    const expiresAt = tenant?.plan_expires_at || null
    const now = Date.now()
    let daysLeft = null
    let status = 'active'
    if (expiresAt) {
      daysLeft = Math.ceil((new Date(expiresAt).getTime() - now) / 86400000)
      if (daysLeft <= 0) status = daysLeft > -7 ? 'grace' : 'suspended'
      else if (daysLeft <= 7) status = 'expiring'
    } else {
      status = 'unlimited' // 长期有效(自有/内部租户)
    }
    const orders = db.prepare('SELECT * FROM subscription_orders WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 20').all(tid)
      .map((o) => ({ id: o.id, plan: o.plan, period: o.period, amountCents: o.amount_cents, status: o.status, createdAt: o.created_at, paidAt: o.paid_at }))
    return json(res, 200, {
      plan: ent.plan,
      planName: ent.planNameZh,
      expiresAt,
      daysLeft,
      status,
      autoRenew: Boolean(tenant?.auto_renew),
      prices: PLAN_PRICING[ent.plan] || null, // 当前档位订阅价;custom/未知=null(续费走客服)
      tiers: db.prepare('SELECT id, name_zh FROM plans ORDER BY sort_order').all().map((p) => ({
        id: p.id,
        name: p.name_zh,
        monthCents: PLAN_PRICING[p.id]?.monthCents ?? null,
        yearCents: PLAN_PRICING[p.id]?.yearCents ?? null,
        fit: PLAN_FIT[p.id] || '',
        note: PLAN_NOTE[p.id] || '',
        current: p.id === ent.plan
      })),
      latestPlanRequest: ent.latestPlanRequest,
      aiAddon: Object.assign({}, aiAddonState(tid), { usage: aiUsageOf(tid) }), // 商家能看到自己本月 AI 用了多少

      mockPay: process.env.WXPAY_MOCK === '1',
      orders
    })
  }
  // AI 智能包:申请 3 个月免费试用(每店一次)。不自动开通——生成申请落到平台后台,由运营配置话术/知识库后再发放。
  if (req.method === 'POST' && path === '/admin/subscription/ai-trial') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可申请。')
    const tid = currentTenantId()
    const st = aiAddonState(tid)
    if (st.includedInPlan) throw apiError(400, 'BAD_REQUEST', '当前套餐已包含 AI 智能包。')
    if (st.trialPending) throw apiError(400, 'BAD_REQUEST', '试用申请已提交,我们会尽快联系您开通。')
    if (!st.trialAvailable) throw apiError(400, 'BAD_REQUEST', '免费试用每店限一次,已使用过。')
    const body = await readBody(req).catch(() => ({}))
    const contact = String(body.contact || '').trim().slice(0, 60)
    const ent = getEntitlements(tid)
    db.prepare(`INSERT INTO plan_change_requests (id, tenant_id, current_plan, target_plan, request_type, note, status, created_by, created_at)
      VALUES (?, ?, ?, 'ai_addon', 'ai_trial', ?, 'PENDING', ?, ?)`)
      .run(randomId('planreq'), tid, ent.plan, contact ? `申请 AI 智能包 ${AI_ADDON.trialDays} 天免费试用 · 联系方式:${contact}` : `申请 AI 智能包 ${AI_ADDON.trialDays} 天免费试用`,
        adminSession.email || adminSession.username || 'owner', iso(new Date()))
    return json(res, 200, { ok: true, pending: true, aiAddon: aiAddonState(tid) })
  }
  // AI 智能包:下单订阅(与基础套餐同一套订单表,plan='ai_addon';平台确认收款后顺延 AI 到期日)
  if (req.method === 'POST' && path === '/admin/subscription/ai-subscribe') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可订阅。')
    const tid = currentTenantId()
    if (aiAddonState(tid).includedInPlan) throw apiError(400, 'BAD_REQUEST', '当前套餐已包含 AI 智能包。')
    const body = await readBody(req)
    const period = body.period === 'month' ? 'month' : 'year'
    const amountCents = period === 'month' ? AI_ADDON.monthCents : AI_ADDON.yearCents
    const id = randomId('sub')
    db.prepare(`INSERT INTO subscription_orders (id, tenant_id, plan, period, amount_cents, status, created_at, expires_before)
      VALUES (?, ?, 'ai_addon', ?, ?, 'pending', ?, ?)`)
      .run(id, tid, period, amountCents, iso(new Date()), aiAddonState(tid).expiresAt)
    return json(res, 200, {
      order: { id, period, amountCents, status: 'pending', plan: 'ai_addon' },
      payment: process.env.WXPAY_MOCK === '1' ? 'mock' : 'unconfigured'
    })
  }
  if (req.method === 'PATCH' && path === '/admin/subscription/auto-renew') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可操作。')
    const body = await readBody(req)
    const enabled = body.enabled ? 1 : 0
    db.prepare('UPDATE tenants SET auto_renew = ?, updated_at = ? WHERE id = ?').run(enabled, iso(new Date()), currentTenantId())
    return json(res, 200, { autoRenew: Boolean(enabled) })
  }
  if (req.method === 'POST' && path === '/admin/subscription/renew') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可续费。')
    const body = await readBody(req)
    const period = body.period === 'month' ? 'month' : 'year'
    const tid = currentTenantId()
    const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tid)
    const pricing = PLAN_PRICING[tenant?.plan || '']
    if (!pricing) throw apiError(400, 'BAD_REQUEST', '定制版为按需报价,续费请联系客服。')
    const amountCents = period === 'month' ? pricing.monthCents : pricing.yearCents
    if (!amountCents) throw apiError(400, 'BAD_REQUEST', '免费版无需续费。')
    const order = {
      id: randomId('sub'),
      tenant_id: tid,
      plan: tenant?.plan || 'chain',
      period,
      amount_cents: amountCents,
      status: 'pending',
      created_at: iso(new Date()),
      expires_before: tenant?.plan_expires_at || null
    }
    db.prepare(`INSERT INTO subscription_orders (id, tenant_id, plan, period, amount_cents, status, created_at, expires_before)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(order.id, order.tenant_id, order.plan, order.period, order.amount_cents, order.status, order.created_at, order.expires_before)
    // TODO(支付接入): 微信支付参数配置化(商户号/密钥),配好后此处返回 JSAPI payParams;当前返回 unconfigured 走客服引导。
    return json(res, 200, {
      order: { id: order.id, period, amountCents, status: 'pending' },
      payment: process.env.WXPAY_MOCK === '1' ? 'mock' : 'unconfigured'
    })
  }
  if (req.method === 'POST' && /^\/admin\/subscription\/orders\/[^/]+\/mock-pay$/.test(path)) {
    // 仅本地沙盘联调用:WXPAY_MOCK=1 时模拟支付成功并顺延到期日;生产不配此变量,接口直接 403
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可操作。')
    if (process.env.WXPAY_MOCK !== '1') throw apiError(403, 'FORBIDDEN', '支付通道尚未开通,请联系客服完成续费。')
    const orderId = path.split('/')[4]
    const tid = currentTenantId()
    const order = db.prepare('SELECT * FROM subscription_orders WHERE id = ? AND tenant_id = ?').get(orderId, tid)
    if (!order) throw apiError(404, 'NOT_FOUND', '订单不存在。')
    if (order.status === 'paid') return json(res, 200, { ok: true, alreadyPaid: true })
    if (order.plan === 'ai_addon') { // AI 智能包订单:顺延 AI 到期日,不动基础套餐
      const aiIso = extendAiAddon(tid, order.period)
      db.prepare('UPDATE subscription_orders SET status = ?, paid_at = ?, pay_channel = ?, expires_after = ? WHERE id = ?')
        .run('paid', iso(new Date()), 'mock', aiIso, order.id)
      return json(res, 200, { ok: true, aiExpiresAt: aiIso })
    }
    const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tid)
    // 顺延规则:以「原到期日」和「今天」的较晚者为基准,+1月/+1年——临期或宽限期内续费都不吃亏
    const base = new Date(Math.max(Date.now(), tenant?.plan_expires_at ? new Date(tenant.plan_expires_at).getTime() : 0))
    const next = new Date(base)
    if (order.period === 'month') next.setMonth(next.getMonth() + 1)
    else next.setFullYear(next.getFullYear() + 1)
    const nextIso = iso(next)
    db.prepare('UPDATE subscription_orders SET status = ?, paid_at = ?, pay_channel = ?, expires_after = ? WHERE id = ?')
      .run('paid', iso(new Date()), 'mock', nextIso, order.id)
    db.prepare('UPDATE tenants SET plan_expires_at = ?, updated_at = ? WHERE id = ?').run(nextIso, iso(new Date()), tid)
    return json(res, 200, { ok: true, expiresAt: nextIso })
  }
  if (req.method === 'GET' && path === '/admin/finance/targets') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    return json(res, 200, { targets: getFinanceTargets(currentTenantId()) })
  }
  if (req.method === 'PUT' && path === '/admin/finance/targets') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const body = await readBody(req)
    const mode = body.targetMode === 'revenue' ? 'revenue' : 'net_profit'
    const monthTargetCents = Math.max(0, Math.round(Number(body.monthTargetCents ?? Number(body.monthTarget || 0) * 100)))
    const yearTargetCents = body.yearTarget === null || body.yearTarget === '' || body.yearTarget === undefined
      ? (body.yearTargetCents !== undefined ? Math.round(Number(body.yearTargetCents)) : null)
      : Math.round(Number(body.yearTarget) * 100)
    const rate = Math.min(0.95, Math.max(0, Number(body.variableCostRate ?? 0.25)))
    db.prepare(`
      INSERT INTO finance_targets (tenant_id, target_mode, month_target_cents, year_target_cents, variable_cost_rate, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET target_mode = excluded.target_mode, month_target_cents = excluded.month_target_cents,
        year_target_cents = excluded.year_target_cents, variable_cost_rate = excluded.variable_cost_rate,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at
    `).run(currentTenantId(), mode, monthTargetCents, yearTargetCents, rate, adminSession.email || 'owner', iso(new Date()))
    return json(res, 200, { targets: getFinanceTargets(currentTenantId()), progress: computeFinanceProgress(localParts(new Date()).date.slice(0, 7)) })
  }
  if (req.method === 'GET' && path === '/admin/finance/progress') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    materializeRecurringTransactions()
    const month = /^\d{4}-\d{2}$/.test(String(query.month || '')) ? query.month : localParts(new Date()).date.slice(0, 7)
    return json(res, 200, { progress: computeFinanceProgress(month) })
  }
  if (path === '/admin/finance/compensation' && (req.method === 'GET' || req.method === 'PUT')) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    if (!checkEntitlement(currentTenantId(), 'staff_schedule')) throw apiError(403, 'PLAN_LIMIT', 'Staff payroll requires a plan with staff features.')
    if (req.method === 'PUT') {
      const body = await readBody(req)
      const technicianId = String(body.technicianId || '').trim()
      if (!db.prepare('SELECT id FROM technicians WHERE id = ?').get(technicianId)) throw apiError(404, 'NOT_FOUND', 'Technician not found.')
      db.prepare(`
        INSERT INTO staff_compensation (technician_id, tenant_id, base_salary_cents, commission_rate, active, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(technician_id) DO UPDATE SET base_salary_cents = excluded.base_salary_cents, commission_rate = excluded.commission_rate,
          active = excluded.active, updated_by = excluded.updated_by, updated_at = excluded.updated_at
      `).run(
        technicianId,
        currentTenantId(),
        Math.max(0, Math.round(Number(body.baseSalaryCents ?? Number(body.baseSalary || 0) * 100))),
        Math.min(0.9, Math.max(0, Number(body.commissionRate || 0))),
        body.active === undefined ? 1 : Number(Boolean(body.active)),
        adminSession.email || 'owner',
        iso(new Date())
      )
    }
    const technicians = db.prepare('SELECT id, name FROM technicians WHERE is_active = 1 AND tenant_id = ? ORDER BY name ASC').all(currentTenantId())
    const comps = db.prepare('SELECT * FROM staff_compensation WHERE tenant_id = ?').all(currentTenantId())
    return json(res, 200, {
      compensation: technicians.map((tech) => {
        const comp = comps.find((item) => item.technician_id === tech.id)
        return {
          technicianId: tech.id,
          technicianName: tech.name,
          baseSalaryCents: comp?.base_salary_cents || 0,
          commissionRate: comp?.commission_rate || 0,
          active: comp ? Boolean(comp.active) : false
        }
      })
    })
  }
  if (req.method === 'GET' && path === '/admin/finance/payroll') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    if (!checkEntitlement(currentTenantId(), 'staff_schedule')) throw apiError(403, 'PLAN_LIMIT', 'Staff payroll requires a plan with staff features.')
    const month = /^\d{4}-\d{2}$/.test(String(query.month || '')) ? query.month : localParts(new Date()).date.slice(0, 7)
    return json(res, 200, { month, drafts: payrollDraftsForMonth(month) })
  }
  if (req.method === 'POST' && path === '/admin/finance/payroll/confirm') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    if (!checkEntitlement(currentTenantId(), 'staff_schedule')) throw apiError(403, 'PLAN_LIMIT', 'Staff payroll requires a plan with staff features.')
    const body = await readBody(req)
    const month = /^\d{4}-\d{2}$/.test(String(body.month || '')) ? body.month : localParts(new Date()).date.slice(0, 7)
    const drafts = payrollDraftsForMonth(month).filter((item) => !item.settled && item.totalCents > 0)
    for (const draft of drafts) {
      insertFinanceTransaction({
        type: 'expense',
        source: 'payroll',
        category: '员工工资',
        tags: draft.marker,
        amountCents: draft.totalCents,
        payChannel: 'unknown',
        occurredOn: localParts(new Date()).date,
        note: `${month} 工资结算：${draft.technicianName}（底薪 ${cadFromCentsText(draft.baseSalaryCents)} + 提成 ${cadFromCentsText(draft.commissionCents)}）`,
        createdBy: adminSession.email || 'owner'
      })
    }
    return json(res, 201, { settled: drafts.length, drafts: payrollDraftsForMonth(month) })
  }
  if (req.method === 'GET' && path === '/admin/finance/verify') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    return json(res, 200, { ledger: verifyFinanceLedger(currentTenantId()) })
  }
  if (req.method === 'GET' && path === '/admin/finance/transactions') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    materializeRecurringTransactions()
    const month = /^\d{4}-\d{2}$/.test(String(query.month || '')) ? query.month : localParts(new Date()).date.slice(0, 7)
    const args = [currentTenantId(), `${month}-01`, `${month}-31`]
    let sql = 'SELECT * FROM finance_transactions WHERE tenant_id = ? AND occurred_on >= ? AND occurred_on <= ?'
    if (query.type) { sql += ' AND type = ?'; args.push(query.type) }
    if (query.category) { sql += ' AND category = ?'; args.push(query.category) }
    sql += ' ORDER BY occurred_on DESC, created_at DESC LIMIT 400'
    const rows = db.prepare(sql).all(...args)
    const summary = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS income_cents,
        COALESCE(SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END), 0) AS expense_cents,
        COALESCE(SUM(amount_cents), 0) AS net_cents
      FROM finance_transactions WHERE tenant_id = ? AND occurred_on >= ? AND occurred_on <= ?
    `).get(currentTenantId(), `${month}-01`, `${month}-31`)
    return json(res, 200, {
      month,
      summary: { incomeCents: summary.income_cents, expenseCents: summary.expense_cents, netCents: summary.net_cents },
      transactions: rows.map(serializeFinanceTransaction)
    })
  }
  if (req.method === 'POST' && path === '/admin/finance/transactions') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const body = await readBody(req)
    const type = body.type === 'expense' ? 'expense' : 'income'
    const amountCents = Math.round(Number(body.amountCents ?? Number(body.amount || 0) * 100))
    if (!Number.isFinite(amountCents) || amountCents <= 0) throw apiError(400, 'BAD_REQUEST', 'A positive amount is required.')
    const category = String(body.category || '').trim()
    if (!category) throw apiError(400, 'BAD_REQUEST', 'category is required.')
    const occurredOn = /^\d{4}-\d{2}-\d{2}$/.test(String(body.occurredOn || '')) ? body.occurredOn : localParts(new Date()).date
    const row = insertFinanceTransaction({
      type,
      source: 'manual',
      category,
      tags: String(body.tags || ''),
      amountCents,
      payChannel: String(body.payChannel || 'unknown'),
      occurredOn,
      note: String(body.note || ''),
      createdBy: adminSession.email || 'owner'
    })
    return json(res, 201, { transaction: serializeFinanceTransaction(row) })
  }
  const financeReverseMatch = path.match(/^\/admin\/finance\/transactions\/([^/]+)\/reverse$/)
  if (req.method === 'POST' && financeReverseMatch) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const txnId = decodeURIComponent(financeReverseMatch[1])
    const original = db.prepare('SELECT * FROM finance_transactions WHERE id = ? AND tenant_id = ?').get(txnId, currentTenantId())
    if (!original) throw apiError(404, 'NOT_FOUND', 'Transaction not found.')
    const alreadyReversed = db.prepare('SELECT id FROM finance_transactions WHERE reversal_of = ?').get(txnId)
    if (alreadyReversed) throw apiError(400, 'BAD_REQUEST', 'Transaction already reversed.')
    const row = insertFinanceTransaction({
      type: original.type,
      source: 'reversal',
      category: original.category,
      tags: original.tags,
      amountCents: -original.amount_cents,
      payChannel: original.pay_channel,
      occurredOn: localParts(new Date()).date,
      note: `冲销：${original.note || original.id}`,
      bookingId: original.booking_id,
      reversalOf: original.id,
      createdBy: adminSession.email || 'owner'
    })
    return json(res, 201, { transaction: serializeFinanceTransaction(row) })
  }
  if (req.method === 'GET' && path === '/admin/finance/recurring') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    return json(res, 200, {
      rules: db.prepare('SELECT * FROM finance_recurring_rules WHERE tenant_id = ? ORDER BY created_at DESC').all(currentTenantId())
        .map((row) => ({ id: row.id, name: row.name, category: row.category, tags: row.tags, amountCents: row.amount_cents, cadence: row.cadence, dayOfMonth: row.day_of_month, active: Boolean(row.active), lastRunOn: row.last_run_on }))
    })
  }
  if (req.method === 'POST' && path === '/admin/finance/recurring') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const body = await readBody(req)
    const name = String(body.name || '').trim()
    const category = String(body.category || '').trim()
    const amountCents = Math.round(Number(body.amountCents ?? Number(body.amount || 0) * 100))
    const dayOfMonth = Math.min(31, Math.max(1, Number(body.dayOfMonth || 1)))
    if (!name || !category || !Number.isFinite(amountCents) || amountCents <= 0) throw apiError(400, 'BAD_REQUEST', 'name, category and positive amount are required.')
    const id = randomId('finrule')
    db.prepare(`
      INSERT INTO finance_recurring_rules (id, tenant_id, name, category, tags, amount_cents, cadence, day_of_month, active, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'monthly', ?, 1, ?, ?, ?)
    `).run(id, currentTenantId(), name, category, String(body.tags || ''), amountCents, dayOfMonth, adminSession.email || 'owner', iso(new Date()), iso(new Date()))
    const generated = materializeRecurringTransactions()
    return json(res, 201, { rule: { id, name, category, amountCents, dayOfMonth }, generated })
  }
  const financeRuleMatch = path.match(/^\/admin\/finance\/recurring\/([^/]+)$/)
  if (req.method === 'PATCH' && financeRuleMatch) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const ruleId = decodeURIComponent(financeRuleMatch[1])
    const current = db.prepare('SELECT * FROM finance_recurring_rules WHERE id = ? AND tenant_id = ?').get(ruleId, currentTenantId())
    if (!current) throw apiError(404, 'NOT_FOUND', 'Rule not found.')
    const body = await readBody(req)
    db.prepare(`
      UPDATE finance_recurring_rules SET
        name = ?, category = ?, tags = ?, amount_cents = ?, day_of_month = ?, active = ?, updated_at = ?
      WHERE id = ?
    `).run(
      String(body.name ?? current.name),
      String(body.category ?? current.category),
      String(body.tags ?? current.tags),
      body.amountCents !== undefined ? Math.round(Number(body.amountCents)) : (body.amount !== undefined ? Math.round(Number(body.amount) * 100) : current.amount_cents),
      body.dayOfMonth !== undefined ? Math.min(31, Math.max(1, Number(body.dayOfMonth))) : current.day_of_month,
      body.active === undefined ? current.active : Number(Boolean(body.active)),
      iso(new Date()),
      ruleId
    )
    return json(res, 200, { updated: true })
  }
  if (req.method === 'GET' && path === '/admin/kb') {
    return json(res, 200, {
      facts: tenantKbFacts(currentTenantId()),
      // 2026-08-06:把"AI 实际拿到的实时事实"一并下发(价目三档价/加项目录/计价规则摘要),
      // 商家与运营可据此核对 AI 口径;只增字段,老前端不受影响。
      liveFacts: liveTenantFacts(),
      entries: db.prepare('SELECT id, question, keywords, answer_zh AS answerZh, answer_en AS answerEn, enabled, updated_at AS updatedAt FROM tenant_kb_entries WHERE tenant_id = ? ORDER BY created_at DESC').all(currentTenantId())
        .map((row) => ({ ...row, enabled: Boolean(row.enabled) })),
      documents: db.prepare('SELECT id, title, length(content) AS size, created_at AS createdAt FROM tenant_kb_documents WHERE tenant_id = ? ORDER BY created_at DESC').all(currentTenantId())
    })
  }
  if (req.method === 'PUT' && path === '/admin/kb/facts') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const body = await readBody(req)
    const facts = body.facts && typeof body.facts === 'object' ? body.facts : {}
    const allowed = ['brandName', 'assistantName', 'storeAddress', 'depositAmount', 'currency']
    const stmt = db.prepare(`
      INSERT INTO tenant_kb_facts (tenant_id, key, value, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at
    `)
    for (const key of allowed) {
      if (facts[key] !== undefined) stmt.run(currentTenantId(), key, String(facts[key]), adminSession.email || 'owner', iso(new Date()))
    }
    return json(res, 200, { facts: tenantKbFacts(currentTenantId()) })
  }
  if (req.method === 'POST' && path === '/admin/kb/import') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const body = await readBody(req)
    const filename = String(body.filename || 'upload.txt').slice(0, 120)
    const content = String(body.content || '').slice(0, 40000)
    if (!content.trim()) throw apiError(400, 'BAD_REQUEST', 'File content is empty.')
    const insertEntry = (entry) => db.prepare(`
      INSERT INTO tenant_kb_entries (id, tenant_id, question, keywords, answer_zh, answer_en, enabled, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(randomId('kb'), currentTenantId(), entry.question.slice(0, 200), String(entry.keywords || entry.question).slice(0, 300), entry.answerZh.slice(0, 2000), String(entry.answerEn || '').slice(0, 2000), adminSession.email || 'owner', iso(new Date()), iso(new Date()))
    // 1) 结构化格式（CSV / 问答体）直接拆条
    const parsed = parseKbEntriesFromText(content)
    if (parsed.length) {
      for (const entry of parsed) insertEntry(entry)
      return json(res, 201, { mode: 'entries', imported: parsed.length })
    }
    // 2) 自由文本：尝试 AI 拆条（需真实模型且需开通 AI 智能包），拆不出则整篇存为知识文档供 AI 参考
    if (hasAi()) countAiUsage()
    const aiExtracted = hasAi() ? await extractKbEntriesFromDocument({ content, filename }).catch(() => null) : null
    const aiEntries = (aiExtracted?.entries || []).filter((entry) => entry?.question && entry?.answerZh)
    if (aiEntries.length) {
      for (const entry of aiEntries) insertEntry(entry)
      return json(res, 201, { mode: 'ai_entries', imported: aiEntries.length })
    }
    db.prepare('INSERT INTO tenant_kb_documents (id, tenant_id, title, content, updated_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(randomId('kbdoc'), currentTenantId(), filename, content, adminSession.email || 'owner', iso(new Date()))
    return json(res, 201, { mode: 'document', imported: 0 })
  }
  const kbDocMatch = path.match(/^\/admin\/kb\/documents\/([^/]+)$/)
  if (req.method === 'DELETE' && kbDocMatch) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    db.prepare('DELETE FROM tenant_kb_documents WHERE id = ? AND tenant_id = ?').run(decodeURIComponent(kbDocMatch[1]), currentTenantId())
    return json(res, 200, { deleted: true })
  }
  if (req.method === 'POST' && path === '/admin/kb/entries') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const body = await readBody(req)
    const question = String(body.question || '').trim()
    const answerZh = String(body.answerZh || '').trim()
    if (!question || !answerZh) throw apiError(400, 'BAD_REQUEST', 'question and answerZh are required.')
    const id = randomId('kb')
    db.prepare(`
      INSERT INTO tenant_kb_entries (id, tenant_id, question, keywords, answer_zh, answer_en, enabled, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(id, currentTenantId(), question, String(body.keywords || question), answerZh, String(body.answerEn || ''), adminSession.email || 'owner', iso(new Date()), iso(new Date()))
    return json(res, 201, { entry: db.prepare('SELECT id, question, keywords, answer_zh AS answerZh, answer_en AS answerEn, enabled FROM tenant_kb_entries WHERE id = ?').get(id) })
  }
  const kbEntryMatch = path.match(/^\/admin\/kb\/entries\/([^/]+)$/)
  if ((req.method === 'PATCH' || req.method === 'DELETE') && kbEntryMatch) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const id = decodeURIComponent(kbEntryMatch[1])
    const current = db.prepare('SELECT * FROM tenant_kb_entries WHERE id = ? AND tenant_id = ?').get(id, currentTenantId())
    if (!current) throw apiError(404, 'NOT_FOUND', 'KB entry not found.')
    if (req.method === 'DELETE') {
      db.prepare('DELETE FROM tenant_kb_entries WHERE id = ?').run(id)
      return json(res, 200, { deleted: true })
    }
    const body = await readBody(req)
    db.prepare(`
      UPDATE tenant_kb_entries SET
        question = ?, keywords = ?, answer_zh = ?, answer_en = ?, enabled = ?, updated_by = ?, updated_at = ?
      WHERE id = ?
    `).run(
      String(body.question ?? current.question),
      String(body.keywords ?? current.keywords),
      String(body.answerZh ?? current.answer_zh),
      String(body.answerEn ?? current.answer_en ?? ''),
      body.enabled === undefined ? current.enabled : Number(Boolean(body.enabled)),
      adminSession.email || 'owner',
      iso(new Date()),
      id
    )
    return json(res, 200, { entry: db.prepare('SELECT id, question, keywords, answer_zh AS answerZh, answer_en AS answerEn, enabled FROM tenant_kb_entries WHERE id = ?').get(id) })
  }
  if (req.method === 'PUT' && path === '/admin/tenant/plan') {
    // 2026-08-04 安全:此前只判断"你是不是老板",于是任何商家老板都能把自己改成连锁版(自带 AI)、
    // 或把到期日设成永久,整套申请/支付/平台开通全被绕过。现在只有平台主钥匙能改;
    // 商家要变档位走 POST /admin/tenant/plan/change-request(申请制,平台审批)。
    if (!isPlatformKey(req)) throw apiError(403, 'FORBIDDEN', '档位调整由平台处理,请在「套餐与续费」里提交申请。')
    const body = await readBody(req)
    const updates = []
    const args = []
    if (body.plan !== undefined) {
      const plan = db.prepare('SELECT id FROM plans WHERE id = ?').get(String(body.plan))
      if (!plan) throw apiError(400, 'BAD_REQUEST', 'Unknown plan id.')
      updates.push('plan = ?')
      args.push(plan.id)
    }
    if (body.planExpiresAt !== undefined) {
      updates.push('plan_expires_at = ?')
      args.push(body.planExpiresAt ? String(body.planExpiresAt) : null)
    }
    if (!updates.length) throw apiError(400, 'BAD_REQUEST', 'Nothing to update.')
    updates.push('updated_at = ?')
    args.push(iso(new Date()), currentTenantId())
    db.prepare(`UPDATE tenants SET ${updates.join(', ')} WHERE id = ?`).run(...args)
    return json(res, 200, { entitlements: getEntitlements(currentTenantId()) })
  }
  if (req.method === 'POST' && path === '/admin/tenant/plan/change-request') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const body = await readBody(req)
    const targetPlan = String(body.targetPlan || '').trim()
    if (!db.prepare('SELECT id FROM plans WHERE id = ?').get(targetPlan)) throw apiError(400, 'BAD_REQUEST', 'Unknown target plan.')
    const entitlements = getEntitlements(currentTenantId())
    const requestType = targetPlan === entitlements.plan ? 'renew' : 'upgrade'
    db.prepare(`
      INSERT INTO plan_change_requests (id, tenant_id, current_plan, target_plan, request_type, note, status, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
    `).run(randomId('planreq'), currentTenantId(), entitlements.plan, targetPlan, requestType, String(body.note || ''), adminSession.email || 'owner', iso(new Date()))
    return json(res, 201, { entitlements: getEntitlements(currentTenantId()) })
  }
  if (req.method === 'PUT' && path === '/admin/tenant/entitlements') {
    // 2026-08-04 安全:此前商家老板可以直接给自己写权限行,等于免费开通 AI 智能包等一切付费功能。
    // 现在只有平台主钥匙能写;商家侧开通一律走订阅接口(试用申请 / 下单付款 / 平台开通)。
    if (!isPlatformKey(req)) throw apiError(403, 'FORBIDDEN', '功能开通由平台处理,请在「套餐与续费」里申请或订阅。')
    const body = await readBody(req)
    const feature = String(body.feature || '').trim()
    if (!feature) throw apiError(400, 'BAD_REQUEST', 'feature is required.')
    const enabled = body.enabled === undefined ? 1 : Number(Boolean(body.enabled))
    const expiresAt = body.expiresAt ? String(body.expiresAt) : null
    const now = iso(new Date())
    if (body.remove) {
      db.prepare('DELETE FROM tenant_entitlements WHERE tenant_id = ? AND feature = ?').run(currentTenantId(), feature)
    } else {
      db.prepare(`
        INSERT INTO tenant_entitlements (id, tenant_id, feature, enabled, expires_at, note, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, feature) DO UPDATE SET enabled = excluded.enabled, expires_at = excluded.expires_at,
          note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at
      `).run(randomId('entitlement'), currentTenantId(), feature, enabled, expiresAt, String(body.note || ''), adminSession.email || 'owner', now, now)
    }
    return json(res, 200, { entitlements: getEntitlements(currentTenantId()) })
  }
  if (req.method === 'GET' && path.startsWith('/admin/users/') && path.endsWith('/identities')) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const userId = decodeURIComponent(path.split('/')[3] || '')
    const user = db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(userId)
    if (!user) throw apiError(404, 'NOT_FOUND', 'User not found.')
    const identities = db.prepare(`
      SELECT provider, provider_user_id AS externalId, union_id AS unionId, email, phone, tenant_id AS tenantId, created_at AS createdAt
      FROM user_identities WHERE user_id = ? ORDER BY created_at ASC
    `).all(userId)
    return json(res, 200, { user: { id: user.id, displayName: user.display_name }, identities })
  }
  if (req.method === 'PUT' && path === '/admin/store-info') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const body = await readBody(req)
    const storeId = body.storeId || defaultStoreId()
    const store = db.prepare('SELECT * FROM stores WHERE id = ? AND tenant_id = ?').get(storeId, currentTenantId())
    if (!store) throw apiError(404, 'NOT_FOUND', 'Store not found.')
    const name = String(body.name ?? store.name).trim() || store.name
    const address = String(body.address ?? store.address ?? '').trim()
    const phone = String(body.phone ?? store.phone ?? '').trim()
    db.prepare('UPDATE stores SET name = ?, address = ?, phone = ? WHERE id = ?').run(name, address, phone, storeId)
    // 地址来源合一:同步进租户知识库事实,AI 回答与订单系统永远一致
    const factStmt = db.prepare(`
      INSERT INTO tenant_kb_facts (tenant_id, key, value, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at
    `)
    if (address) factStmt.run(currentTenantId(), 'storeAddress', address, adminSession.email || 'owner', iso(new Date()))
    if (phone) factStmt.run(currentTenantId(), 'storePhone', phone, adminSession.email || 'owner', iso(new Date()))
    return json(res, 200, { store: db.prepare('SELECT id, name, address, phone FROM stores WHERE id = ?').get(storeId) })
  }
  // 本店时钟(只读):运维/回归用来确认「服务端认为本店现在几号」——按店时区改造后的对外口径
  if (req.method === 'GET' && path === '/admin/store-clock') {
    const tid = currentTenantId()
    const tz = tenantTimezone(tid)
    // ?at=<ISO> 只影响这个只读回显,用来在回归里对固定时刻断言跨日/跨月边界
    const at = query.at && !Number.isNaN(new Date(query.at).getTime()) ? new Date(query.at) : new Date()
    const parts = localParts(at, tz)
    return json(res, 200, {
      tenantId: tid,
      timezone: tz,
      today: parts.date,
      monthKey: monthKeyOf(tid, at),
      localTime: parts.time,
      serverProcessTimezone: APP_TIMEZONE,
      nowUtc: iso(at),
      // 只读运维探针:只报「配没配」,不回显任何密钥值。
      // 用它确认生产的对象存储可用,而不必在真实商户数据里造一张假单去验。
      storage: { cosConfigured: cosConfigured(), snapshotFallback: cosConfigured() ? 'cos' : 'inline' }
    })
  }
  if (req.method === 'GET' && path === '/admin/business-hours') {
    const stores = db.prepare('SELECT id, name, address, phone, currency, timezone FROM stores WHERE is_active = 1 AND tenant_id = ? ORDER BY name ASC').all(currentTenantId())
    return json(res, 200, {
      stores: stores.map((store) => ({
        id: store.id,
        name: store.name,
        address: store.address,
        phone: store.phone,
        // 2026-08-07:老板端要按本店币种/时区显示金额与"今天",这两项以前没下发,前端只能写死 CAD + Toronto
        currency: store.currency || 'CAD',
        timezone: store.timezone || 'America/Toronto',
        hours: getBusinessHoursRows(store.id).map(serializeBusinessHour),
        hoursText: { zh: businessHoursText(store.id, 'zh'), en: businessHoursText(store.id, 'en') },
        specialDates: upcomingSpecialDates(store.id, 366).map((row) => ({
          date: row.date,
          isClosed: Boolean(row.is_closed),
          openTime: row.open_time,
          closeTime: row.close_time,
          note: row.note || ''
        }))
      }))
    })
  }
  if (req.method === 'PUT' && path === '/admin/business-hours') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const body = await readBody(req)
    const storeId = body.storeId || defaultStoreId()
    const store = db.prepare('SELECT * FROM stores WHERE id = ? AND tenant_id = ?').get(storeId, currentTenantId())
    if (!store) throw apiError(404, 'NOT_FOUND', 'Store not found.')
    const entries = Array.isArray(body.hours) ? body.hours : []
    if (!entries.length) throw apiError(400, 'BAD_REQUEST', 'hours array is required.')
    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/
    const seen = new Set()
    for (const entry of entries) {
      const weekday = Number(entry.weekday)
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw apiError(400, 'BAD_REQUEST', 'weekday must be 0-6.')
      if (seen.has(weekday)) throw apiError(400, 'BAD_REQUEST', `duplicate weekday ${weekday}.`)
      seen.add(weekday)
      if (!entry.isClosed) {
        if (!timePattern.test(entry.openTime || '') || !timePattern.test(entry.closeTime || '')) throw apiError(400, 'BAD_REQUEST', 'openTime/closeTime must be HH:MM.')
        if (entry.openTime >= entry.closeTime) throw apiError(400, 'BAD_REQUEST', 'openTime must be earlier than closeTime.')
      }
    }
    const now = iso(new Date())
    const updatedBy = adminSession.email || adminSession.provider || 'owner'
    const stmt = db.prepare(`INSERT INTO business_hours (store_id, weekday, open_time, close_time, is_closed, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(store_id, weekday) DO UPDATE SET open_time = excluded.open_time, close_time = excluded.close_time, is_closed = excluded.is_closed, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    for (const entry of entries) {
      const isClosed = entry.isClosed ? 1 : 0
      stmt.run(storeId, Number(entry.weekday), entry.openTime || '10:00', entry.closeTime || '19:00', isClosed, now, updatedBy)
    }
    return json(res, 200, {
      store: { id: store.id, name: store.name },
      hours: getBusinessHoursRows(storeId).map(serializeBusinessHour),
      hoursText: { zh: businessHoursText(storeId, 'zh'), en: businessHoursText(storeId, 'en') }
    })
  }
  // 老板直接排单(2026-07-22):复用 createBooking → 建单+占 booking_slots,全链路占位(AI 可约/系统显示/技师端同步)。
  if (req.method === 'POST' && path === '/admin/bookings/direct') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可直接排单。')
    const body = await readBody(req)
    const tid = currentTenantId()
    let userId = String(body.userId || '').trim()
    // 新建顾客(老板口头约的客):给个名字即建档
    if (!userId && String(body.newCustomerName || '').trim()) {
      const uid = randomId('user')
      const nm = String(body.newCustomerName).trim().slice(0, 40)
      db.prepare('INSERT INTO users (id, display_name, phone, tenant_id) VALUES (?, ?, NULLIF(?, \'\'), ?)').run(uid, nm, String(body.phone || '').trim(), tid)
      userId = uid
    }
    if (!userId) throw apiError(400, 'BAD_REQUEST', '请选择或新建顾客。')
    const storeId = body.storeId || defaultStoreId()
    const booking = createBooking({
      userId, tenantId: tid, storeId,
      serviceId: body.serviceId, technicianId: body.technicianId,
      date: body.date, time: body.time, durationMin: body.durationMin,
      notes: body.notes || '老板直接排单'
    }, { adminDirect: true, depositPaid: body.depositPaid === true })
    return json(res, 201, { booking })
  }
  // 服务小记(P0-②):写小记(原文 → AI 结构化 → 存);员工/老板均可写。
  if (req.method === 'POST' && path === '/admin/service-notes') {
    const body = await readBody(req)
    const rawText = String(body.rawText || '').trim()
    if (!rawText) throw apiError(400, 'BAD_REQUEST', '小记内容不能为空。')
    let userId = String(body.userId || '').trim()
    const booking = body.bookingId ? db.prepare('SELECT * FROM bookings WHERE id = ? AND tenant_id = ?').get(body.bookingId, currentTenantId()) : null
    if (booking) { assertStaffCanAccessBooking(adminSession, booking); userId = userId || booking.user_id }
    if (!userId) throw apiError(400, 'BAD_REQUEST', '缺少顾客。')
    const svc = booking && booking.service_id ? getService(booking.service_id) : null
    const tech = booking && booking.technician_id ? db.prepare('SELECT name FROM technicians WHERE id = ?').get(booking.technician_id) : null
    const u = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId)
    // AI 结构化(失败自动 fallback,不阻塞保存)。未开通 AI 智能包时**跳过 AI、照常保存原文**——
    // 小记本身是客户档案的地基,不能因为没买 AI 就写不了;只是不再自动拆成 款式/性格/偏好/同行/安全项。
    const emptyStructured = () => ({ summary: rawText.slice(0, 60), safetyFlags: [], styles: [], personality: [], preferences: [], companions: [], other: [] })
    let structured = emptyStructured()
    const aiStructured = hasAi()
    if (aiStructured) {
      countAiUsage()
      try {
        const aiRes = await createServiceNoteInsights({ rawText, serviceName: svc ? svc.name_zh : (body.serviceName || ''), customerName: u ? u.display_name : '' })
        structured = (aiRes && aiRes.data) ? aiRes.data : aiRes // 拆 aiJson 的 {data} 外壳
      } catch (e) { structured = emptyStructured() }
    }
    const id = randomId('snote')
    db.prepare(`INSERT INTO service_notes (id, tenant_id, user_id, booking_id, technician_id, technician_name, service_name, raw_text, structured_json, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, currentTenantId(), userId, booking ? booking.id : null,
      booking ? booking.technician_id : (body.technicianId || null),
      (tech && tech.name) || body.technicianName || (adminSession.email || ''),
      svc ? svc.name_zh : (body.serviceName || ''),
      rawText, JSON.stringify(structured || {}), adminSession.email || 'admin', iso(new Date()))
    return json(res, 201, { note: { id, rawText, structured, createdAt: iso(new Date()) } })
  }
  // 顾客画像 + 小记时间线
  if (req.method === 'GET' && path.match(/^\/admin\/customers\/[^/]+\/notes$/)) {
    const userId = path.split('/')[3]
    const tid = currentTenantId()
    const rows = db.prepare('SELECT * FROM service_notes WHERE user_id = ? AND tenant_id = ? ORDER BY created_at DESC').all(userId, tid)
    const notes = rows.map((r) => ({
      id: r.id, rawText: r.raw_text, structured: parseJson2(r.structured_json),
      serviceName: r.service_name, technicianName: r.technician_name,
      date: localParts(r.created_at).date, createdAt: r.created_at
    }))
    // 汇总画像:标签去重(安全项单列) + 到店统计
    const agg = { styles: new Set(), personality: new Set(), preferences: new Set(), companions: new Set(), safetyFlags: new Set() }
    notes.forEach((n) => { const s = n.structured || {}; ['styles', 'personality', 'preferences', 'companions', 'safetyFlags'].forEach((k) => (s[k] || []).forEach((t) => agg[k].add(t))) })
    const completed = db.prepare("SELECT appointment_start, service_id FROM bookings WHERE user_id = ? AND tenant_id = ? AND status = 'COMPLETED' ORDER BY appointment_start ASC").all(userId, tid)
    const visitCount = completed.length
    let avgIntervalDays = null
    if (completed.length >= 2) {
      const first = new Date(completed[0].appointment_start), last = new Date(completed[completed.length - 1].appointment_start)
      avgIntervalDays = Math.round((last - first) / 86400000 / (completed.length - 1))
    }
    const svcCount = {}; completed.forEach((b) => { const s = getService(b.service_id); if (s) svcCount[s.name_zh] = (svcCount[s.name_zh] || 0) + 1 })
    const topService = Object.keys(svcCount).sort((a, b) => svcCount[b] - svcCount[a])[0] || ''
    const u = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId)
    return json(res, 200, {
      customerName: u ? u.display_name : '顾客',
      profile: {
        styles: [...agg.styles], personality: [...agg.personality], preferences: [...agg.preferences],
        companions: [...agg.companions], safetyFlags: [...agg.safetyFlags],
        visitCount, avgIntervalDays, topService
      },
      notes
    })
  }
  // ===== 预约规则(租户级):线上定金开关——关闭=顾客自约免定金直接确认,适配无支付商户号的商家 =====
  if (req.method === 'GET' && path === '/admin/booking-rules') {
    const row = db.prepare("SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = 'booking_rules'").get(currentTenantId())
    return json(res, 200, { rules: Object.assign({ onlineDeposit: true }, row ? parseJson2(row.value) : {}) })
  }
  if (req.method === 'PUT' && path === '/admin/booking-rules') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可改预约规则。')
    const body = await readBody(req)
    const rules = { onlineDeposit: body.onlineDeposit !== false }
    db.prepare(`INSERT INTO tenant_settings (tenant_id, key, value, updated_at) VALUES (?, 'booking_rules', ?, ?)
      ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(currentTenantId(), JSON.stringify(rules), iso(new Date()))
    return json(res, 200, { rules })
  }
  // ===== 客户分层(P1-③):分层规则(阈值可微调,存租户设置;默认值与前端一致) =====
  if (req.method === 'GET' && path === '/admin/segment-rules') {
    const row = db.prepare("SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = 'segment_rules'").get(currentTenantId())
    const defaults = { aDays: 45, aVisits: 3, aSpendCents: 50000, nDays: 30, sDays: 60 }
    return json(res, 200, { rules: Object.assign(defaults, row ? parseJson2(row.value) : {}) })
  }
  if (req.method === 'PUT' && path === '/admin/segment-rules') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可调整分层规则。')
    const body = await readBody(req)
    const nz = (v, dft, min, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dft }
    const rules = {
      aDays: nz(body.aDays, 45, 1, 365),
      aVisits: nz(body.aVisits, 3, 1, 50),
      aSpendCents: nz(body.aSpendCents, 50000, 0, 100000000),
      nDays: nz(body.nDays, 30, 1, 180),
      sDays: nz(body.sDays, 60, 7, 365)
    }
    db.prepare(`INSERT INTO tenant_settings (tenant_id, key, value, updated_at) VALUES (?, 'segment_rules', ?, ?)
      ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(currentTenantId(), JSON.stringify(rules), iso(new Date()))
    return json(res, 200, { rules })
  }
  // ===== 沉睡召回周报:每周自动准备好「该召回谁+一人一句话术」;老板主页横条展示 =====
  // 懒生成:本周(门店时区,周一为界)首次请求时算一次存 tenant_settings,当周内直接回缓存;通道自动直发待企微
  if (req.method === 'GET' && path === '/admin/recall-digest') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可查看。')
    const tid = currentTenantId()
    // 本周一(门店时区)
    const todayStr = localParts(new Date()).date
    const dow = localDateTime(todayStr, '12:00').getDay() // 0=周日
    const mondayOffset = dow === 0 ? -6 : 1 - dow
    const weekOf = iso(addMinutes(localDateTime(todayStr, '00:00'), mondayOffset * 24 * 60)).slice(0, 10)
    const cached = db.prepare("SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = 'recall_digest'").get(tid)
    const prev = cached ? parseJson2(cached.value) : null
    if (prev && prev.weekOf === weekOf && query.force !== 'true') return json(res, 200, { digest: prev })
    // 生成:按分层规则取沉睡客,按累计消费降序取前5,AI 一人一句(失败落模板)
    const rulesRow = db.prepare("SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = 'segment_rules'").get(tid)
    const rules = Object.assign({ sDays: 60 }, rulesRow ? parseJson2(rulesRow.value) : {})
    const nowMs = Date.now()
    const sleepers = getAdminCustomers()
      .filter((c) => c.completedCount > 0 && c.lastCompletedAt && (nowMs - new Date(c.lastCompletedAt).getTime()) / 86400000 > rules.sDays)
      .sort((a, b) => (b.totalSpentCents || 0) - (a.totalSpentCents || 0))
      .slice(0, 5)
    let digest = { weekOf, generatedAt: iso(new Date()), count: 0, items: [] }
    if (sleepers.length) {
      const customers = sleepers.map((c) => {
        const notes = db.prepare('SELECT structured_json FROM service_notes WHERE user_id = ? AND tenant_id = ?').all(c.id, tid)
        const agg = { styles: new Set(), preferences: new Set(), safetyFlags: new Set() }
        notes.forEach((n) => { const s = parseJson2(n.structured_json); ['styles', 'preferences', 'safetyFlags'].forEach((k) => (s[k] || []).forEach((t) => agg[k].add(t))) })
        const svcRow = db.prepare(`SELECT s.name_zh AS n, COUNT(*) AS c FROM bookings b JOIN services s ON s.id = b.service_id
          WHERE b.user_id = ? AND b.tenant_id = ? AND b.status = 'COMPLETED' GROUP BY b.service_id ORDER BY c DESC LIMIT 1`).get(c.id, tid)
        return {
          userId: c.id, name: c.displayName || '顾客',
          lastVisitDays: Math.floor((nowMs - new Date(c.lastCompletedAt).getTime()) / 86400000),
          topService: svcRow ? svcRow.n : '',
          styles: [...agg.styles].slice(0, 4), preferences: [...agg.preferences].slice(0, 3), safetyFlags: [...agg.safetyFlags].slice(0, 2),
          spendCents: c.totalSpentCents || 0, phone: c.phone || ''
        }
      })
      const store = db.prepare('SELECT name FROM stores WHERE tenant_id = ? AND is_active = 1 LIMIT 1').get(tid)
      // 未开通 AI 智能包:仍然告诉老板「该召回谁」(这是数据分层,不是 AI),只是话术落到通用模板
      let messages = []
      if (hasAi()) {
        countAiUsage()
        try {
          const aiRes = await createRecallMessages({ customers, storeName: store ? store.name : '' })
          const data = (aiRes && aiRes.data) ? aiRes.data : aiRes
          messages = (data && data.messages) || []
        } catch (e) { messages = [] }
      }
      digest.aiCopy = hasAi()
      const byId = {}; messages.forEach((m) => { if (m && m.userId) byId[m.userId] = m.message })
      digest.items = customers.map((c) => ({
        userId: c.userId, name: c.name, phone: c.phone, lastVisitDays: c.lastVisitDays, spendCents: c.spendCents,
        message: byId[c.userId] || `${c.name}好久不见啦~${(c.styles[0] || c.topService) ? `最近店里新到了适合你的${c.styles[0] || c.topService},` : ''}这周约还有小惊喜,回来做美美的!`
      }))
      digest.count = digest.items.length
    }
    db.prepare(`INSERT INTO tenant_settings (tenant_id, key, value, updated_at) VALUES (?, 'recall_digest', ?, ?)
      ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(tid, JSON.stringify(digest), iso(new Date()))
    return json(res, 200, { digest })
  }
  // ===== 客户分层(P1-③):沉睡客 AI 召回话术 =====
  // 一次最多 6 人;每人结合服务小记画像(款式/偏好/安全项)+ 常做项目 + 距上次到店天数,生成一条可直接粘贴发微信的话术;AI 失败落模板
  if (req.method === 'POST' && path === '/admin/ai/recall-copy') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可生成召回话术。')
    requireAi()
    const body = await readBody(req)
    const tid = currentTenantId()
    const userIds = (Array.isArray(body.userIds) ? body.userIds : []).slice(0, 6)
    if (!userIds.length) throw apiError(400, 'BAD_REQUEST', '缺少顾客。')
    const customers = userIds.map((uid) => {
      const u = db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(uid)
      if (!u) return null
      const notes = db.prepare('SELECT structured_json FROM service_notes WHERE user_id = ? AND tenant_id = ?').all(uid, tid)
      const agg = { styles: new Set(), preferences: new Set(), safetyFlags: new Set() }
      notes.forEach((n) => { const s = parseJson2(n.structured_json); ['styles', 'preferences', 'safetyFlags'].forEach((k) => (s[k] || []).forEach((t) => agg[k].add(t))) })
      const last = db.prepare("SELECT MAX(appointment_start) AS t FROM bookings WHERE user_id = ? AND tenant_id = ? AND status = 'COMPLETED'").get(uid, tid)
      const lastDays = last && last.t ? Math.floor((Date.now() - new Date(last.t).getTime()) / 86400000) : 999
      const svcRow = db.prepare(`SELECT s.name_zh AS n, COUNT(*) AS c FROM bookings b JOIN services s ON s.id = b.service_id
        WHERE b.user_id = ? AND b.tenant_id = ? AND b.status = 'COMPLETED' GROUP BY b.service_id ORDER BY c DESC LIMIT 1`).get(uid, tid)
      return {
        userId: uid, name: u.display_name || '顾客', lastVisitDays: lastDays,
        topService: svcRow ? svcRow.n : '',
        styles: [...agg.styles].slice(0, 4), preferences: [...agg.preferences].slice(0, 3), safetyFlags: [...agg.safetyFlags].slice(0, 2)
      }
    }).filter(Boolean)
    if (!customers.length) throw apiError(404, 'NOT_FOUND', '顾客不存在。')
    const store = db.prepare('SELECT name FROM stores WHERE tenant_id = ? AND is_active = 1 LIMIT 1').get(tid)
    let messages = []
    countAiUsage()
    try {
      const aiRes = await createRecallMessages({ customers, storeName: store ? store.name : '' })
      const data = (aiRes && aiRes.data) ? aiRes.data : aiRes
      messages = (data && data.messages) || []
    } catch (e) { messages = [] }
    // 补齐:AI 漏了谁就用模板兜底
    const byId = {}; messages.forEach((m) => { if (m && m.userId) byId[m.userId] = m.message })
    const out = customers.map((c) => ({
      userId: c.userId, name: c.name,
      message: byId[c.userId] || `${c.name}好久不见啦~${(c.styles[0] || c.topService) ? `最近店里新到了适合你的${c.styles[0] || c.topService},` : ''}这周约还有小惊喜,回来做美美的!`
    })).map((m) => ({ ...m, message: withTouchCta(m.message) }))
    return json(res, 200, { messages: out, cta: readTouchRules().ctaText || '' })
  }
  // ===== 触达规则(企微双通道:真人管家=喇叭 / 客服窗口=办事处)=====
  // 每条主动触达文案自动带客服入口,防止顾客回到成员私聊(那条通道我们收不到、AI 接不了)。
  if (req.method === 'GET' && path === '/admin/touch-rules') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可看触达设置。')
    return json(res, 200, { rules: readTouchRules() })
  }
  if (req.method === 'PUT' && path === '/admin/touch-rules') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可改触达设置。')
    const body = await readBody(req)
    const current = readTouchRules()
    const next = {
      kfLink: body.kfLink !== undefined ? String(body.kfLink || '').trim().slice(0, 300) : current.kfLink,
      ctaText: body.ctaText !== undefined ? String(body.ctaText || '').trim().slice(0, 120) : current.ctaText,
      appendCta: body.appendCta !== undefined ? Boolean(body.appendCta) : current.appendCta
    }
    if (next.kfLink && !/^https?:\/\//i.test(next.kfLink)) throw apiError(400, 'BAD_REQUEST', '客服入口链接需以 http(s):// 开头。')
    db.prepare(`INSERT INTO tenant_settings (tenant_id, key, value, updated_at) VALUES (?, 'touch_rules', ?, ?)
      ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(currentTenantId(), JSON.stringify(next), iso(new Date()))
    return json(res, 200, { rules: next })
  }
  // ===== 薪资方案(P1-④) =====
  // 方案列表(owner):全店默认 + 每技师覆盖情况
  if (req.method === 'GET' && path === '/admin/salary-plans') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可看薪资方案。')
    const tid = currentTenantId()
    const dft = db.prepare("SELECT * FROM salary_plans WHERE tenant_id = ? AND technician_id = ''").get(tid)
    const customs = db.prepare("SELECT * FROM salary_plans WHERE tenant_id = ? AND technician_id != ''").all(tid)
    const names = {}
    db.prepare('SELECT id, name FROM technicians WHERE tenant_id = ?').all(tid).forEach((t) => { names[t.id] = t.name })
    return json(res, 200, {
      defaultPlan: serializeSalaryPlan(dft),
      plans: customs.map((r) => Object.assign(serializeSalaryPlan(r), { technicianName: names[r.technician_id] || '' }))
    })
  }
  // 生效方案(owner 任意;员工只能查自己)
  if (req.method === 'GET' && path === '/admin/salary-plans/effective') {
    const techId = String(query.technicianId || '').trim()
    if (adminSession.role !== 'owner' && techId !== adminSession.technicianId) throw apiError(403, 'FORBIDDEN', '只能查看自己的方案。')
    const r = effectiveSalaryPlan(techId, currentTenantId())
    return json(res, 200, r)
  }
  // 保存方案(owner):technicianId 空串=全店默认;每个数字均可改(前端已全 input 化)
  if (req.method === 'PUT' && path === '/admin/salary-plans') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可配置薪资方案。')
    const body = await readBody(req)
    const tid = currentTenantId()
    const techId = String(body.technicianId || '').trim()
    if (techId && !db.prepare('SELECT id FROM technicians WHERE id = ? AND tenant_id = ?').get(techId, tid)) {
      throw apiError(404, 'NOT_FOUND', '技师不存在。')
    }
    const template = ['commission', 'base_ladder', 'base_flat'].includes(body.template) ? body.template : 'base_ladder'
    const nz = (v) => Math.max(0, Math.round(Number(v) || 0))
    const pctOk = (v) => Math.min(100, Math.max(0, Number(v) || 0))
    const ladder = (Array.isArray(body.ladder) ? body.ladder : []).slice(0, 8)
      .map((t) => ({ minCents: nz(t.minCents), maxCents: t.maxCents == null ? null : nz(t.maxCents), pct: pctOk(t.pct) }))
      .sort((a, b) => a.minCents - b.minCents)
    if (template === 'base_ladder' && !ladder.length) throw apiError(400, 'BAD_REQUEST', '阶梯模板至少要有一档。')
    const now = iso(new Date())
    const existing = db.prepare('SELECT id FROM salary_plans WHERE tenant_id = ? AND technician_id = ?').get(tid, techId)
    if (existing) {
      db.prepare(`UPDATE salary_plans SET template = ?, base_salary_cents = ?, handwork_fee_cents = ?, ladder_json = ?, flat_pct = ?, card_pct = ?, recharge_pct = ?, overtime_rate_cents = ?, overtime_unit_min = ?, updated_at = ? WHERE id = ?`)
        .run(template, nz(body.baseSalaryCents), nz(body.handworkFeeCents), JSON.stringify(ladder), pctOk(body.flatPct), pctOk(body.cardPct), pctOk(body.rechargePct), nz(body.overtimeRateCents), body.overtimeUnitMin === 60 ? 60 : 30, now, existing.id)
    } else {
      db.prepare(`INSERT INTO salary_plans (id, tenant_id, technician_id, template, base_salary_cents, handwork_fee_cents, ladder_json, flat_pct, card_pct, recharge_pct, overtime_rate_cents, overtime_unit_min, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(randomId('splan'), tid, techId, template, nz(body.baseSalaryCents), nz(body.handworkFeeCents), JSON.stringify(ladder), pctOk(body.flatPct), pctOk(body.cardPct), pctOk(body.rechargePct), nz(body.overtimeRateCents), body.overtimeUnitMin === 60 ? 60 : 30, now, now)
    }
    return json(res, 200, effectiveSalaryPlan(techId, tid))
  }
  // 删除按人覆盖(恢复跟随全店默认)
  if (req.method === 'DELETE' && path.match(/^\/admin\/salary-plans\/[^/]+$/)) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可配置薪资方案。')
    const techId = path.split('/')[3]
    db.prepare("DELETE FROM salary_plans WHERE tenant_id = ? AND technician_id = ? AND technician_id != ''").run(currentTenantId(), techId)
    return json(res, 200, { ok: true })
  }
  // 月度工资试算(owner,财务门禁):?month=YYYY-MM 默认本月(门店时区)。已锁定的月份返回锁定快照。
  if (req.method === 'GET' && path === '/admin/salary/estimate') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可试算工资。')
    requireFinanceKey(req)
    const tid = currentTenantId()
    const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : localParts(new Date()).date.slice(0, 7)
    const snap = db.prepare('SELECT * FROM salary_payrolls WHERE tenant_id = ? AND month = ? ORDER BY technician_name ASC').all(tid, month)
    if (snap.length) {
      const rows = snap.map((r) => Object.assign(parseJson2(r.breakdown_json), { name: r.technician_name || '', totalCents: r.total_cents }))
      return json(res, 200, {
        month, locked: true, lockedAt: snap[0].locked_at, lockedBy: snap[0].locked_by || '',
        paid: Boolean(snap[0].paid_at), paidAt: snap[0].paid_at || '',
        rows, totalCents: snap.reduce((s, r) => s + (r.total_cents || 0), 0)
      })
    }
    const techs = db.prepare('SELECT id, name, title FROM technicians WHERE tenant_id = ? AND is_active = 1 ORDER BY name ASC').all(tid)
    const rows = techs.map((t) => Object.assign(computeSalaryEstimate(t.id, month, tid), { name: t.name, title: t.title || '' }))
    const totalCents = rows.reduce((s, r) => s + (r.totalCents || 0), 0)
    // 当月带归属备注的单:结算时对照,用±调整修正(不改业绩数字)
    const [ay, am] = month.split('-').map(Number)
    const aStart = iso(localDateTime(`${month}-01`, '00:00'))
    const aEnd = iso(localDateTime(`${am === 12 ? `${ay + 1}-01` : `${ay}-${String(am + 1).padStart(2, '0')}`}-01`, '00:00'))
    const attributionNotes = db.prepare(`SELECT b.public_code AS code, b.attribution_note AS note, b.service_price_cents AS cents,
        (SELECT name FROM technicians WHERE id = b.technician_id) AS tech,
        (SELECT display_name FROM users WHERE id = b.user_id) AS cust
      FROM bookings b WHERE b.tenant_id = ? AND b.attribution_note IS NOT NULL AND b.appointment_start >= ? AND b.appointment_start < ?
      ORDER BY b.appointment_start ASC`).all(tid, aStart, aEnd)
      .map((r) => ({ code: r.code, note: r.note, amountCents: r.cents, technicianName: r.tech || '', customerName: r.cust || '' }))
    return json(res, 200, { month, locked: false, rows, totalCents, attributionNotes })
  }
  // 确认并锁定当月工资表(owner+财务钥匙):按当下数据快照存档;锁定后 estimate 一律返回快照,防事后改数
  if (req.method === 'POST' && path === '/admin/salary/lock') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可锁定工资表。')
    requireFinanceKey(req)
    const body = await readBody(req)
    const tid = currentTenantId()
    const month = /^\d{4}-\d{2}$/.test(body.month || '') ? body.month : localParts(new Date()).date.slice(0, 7)
    if (db.prepare('SELECT 1 FROM salary_payrolls WHERE tenant_id = ? AND month = ? LIMIT 1').get(tid, month)) {
      throw apiError(409, 'ALREADY_LOCKED', `${month} 工资表已锁定;如需重算请先解锁。`)
    }
    const techs = db.prepare('SELECT id, name, title FROM technicians WHERE tenant_id = ? AND is_active = 1 ORDER BY name ASC').all(tid)
    const now = iso(new Date())
    let total = 0, count = 0
    techs.forEach((t) => {
      const est = Object.assign(computeSalaryEstimate(t.id, month, tid), { name: t.name, title: t.title || '' })
      if (est.noPlan) return // 未配方案的不入表(锁定前试算页会提示去配置)
      db.prepare(`INSERT INTO salary_payrolls (id, tenant_id, month, technician_id, technician_name, breakdown_json, total_cents, locked_at, locked_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(randomId('payroll'), tid, month, t.id, t.name, JSON.stringify(est), est.totalCents || 0, now, adminSession.email || 'owner')
      total += est.totalCents || 0; count += 1
    })
    if (!count) throw apiError(400, 'BAD_REQUEST', '没有可锁定的记录:先给员工配置薪资方案。')
    return json(res, 201, { month, locked: true, lockedAt: now, count, totalCents: total })
  }
  // 解锁重算(owner+财务钥匙):删除该月快照,回到实时试算。已入账的月份禁止解锁(账本只追加,先红字冲销)
  if (req.method === 'POST' && path === '/admin/salary/unlock') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可解锁工资表。')
    requireFinanceKey(req)
    const body = await readBody(req)
    const month = /^\d{4}-\d{2}$/.test(body.month || '') ? body.month : ''
    if (!month) throw apiError(400, 'BAD_REQUEST', '缺少月份。')
    const paid = db.prepare('SELECT 1 FROM salary_payrolls WHERE tenant_id = ? AND month = ? AND paid_at IS NOT NULL LIMIT 1').get(currentTenantId(), month)
    if (paid) throw apiError(403, 'ALREADY_PAID', `${month} 工资已入账本,不能解锁;如需更正,先在财务里红字冲销对应支出。`)
    db.prepare('DELETE FROM salary_payrolls WHERE tenant_id = ? AND month = ?').run(currentTenantId(), month)
    return json(res, 200, { month, locked: false })
  }
  // 发放入账(owner+财务钥匙):把已锁定的月度工资表逐人写入账本支出(category=工资,source=payroll);标记 paid。
  // 账本只追加:发错走红字冲销;同月重复发放 409。
  if (req.method === 'POST' && path === '/admin/salary/payout') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可发放工资。')
    requireFinanceKey(req)
    const body = await readBody(req)
    const tid = currentTenantId()
    const month = /^\d{4}-\d{2}$/.test(body.month || '') ? body.month : ''
    if (!month) throw apiError(400, 'BAD_REQUEST', '缺少月份。')
    const rows = db.prepare('SELECT * FROM salary_payrolls WHERE tenant_id = ? AND month = ? ORDER BY technician_name ASC').all(tid, month)
    if (!rows.length) throw apiError(400, 'BAD_REQUEST', '该月工资表未锁定;先在工资试算里「确认并锁定」。')
    if (rows.some((r) => r.paid_at)) throw apiError(409, 'ALREADY_PAID', `${month} 工资已发放入账过。`)
    const now = iso(new Date())
    const today = localParts(new Date()).date
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const r of rows) {
        const txn = insertFinanceTransaction({
          type: 'expense', source: 'payroll', category: '工资',
          tags: r.id, amountCents: r.total_cents, payChannel: 'manual',
          occurredOn: today, note: `${month} 工资 · ${r.technician_name || r.technician_id}(明细见工资表)`,
          createdBy: adminSession.email || 'owner'
        })
        db.prepare('UPDATE salary_payrolls SET paid_at = ?, paid_by = ?, txn_id = ? WHERE id = ?')
          .run(now, adminSession.email || 'owner', txn.id, r.id)
      }
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
    const total = rows.reduce((s, r) => s + (r.total_cents || 0), 0)
    return json(res, 200, { month, paid: true, paidAt: now, count: rows.length, totalCents: total })
  }
  // 待结工资(owner+财务钥匙):已锁定未发放的各月合计(财务页卡片用)
  if (req.method === 'GET' && path === '/admin/salary/pending-payout') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可查看。')
    requireFinanceKey(req)
    const rows = db.prepare(`SELECT month, COUNT(*) AS people, SUM(total_cents) AS total FROM salary_payrolls
      WHERE tenant_id = ? AND paid_at IS NULL GROUP BY month ORDER BY month DESC`).all(currentTenantId())
    return json(res, 200, {
      months: rows.map((r) => ({ month: r.month, people: r.people, totalCents: r.total })),
      totalCents: rows.reduce((s, r) => s + (r.total || 0), 0)
    })
  }
  // 工资手动调整(owner+财务钥匙):补贴+/扣款-,须备注;已锁定的月份不可改(先解锁)
  if (req.method === 'PUT' && path === '/admin/salary/adjust') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可调整。')
    requireFinanceKey(req)
    const body = await readBody(req)
    const tid = currentTenantId()
    const month = /^\d{4}-\d{2}$/.test(body.month || '') ? body.month : ''
    const techId = String(body.technicianId || '').trim()
    if (!month || !techId) throw apiError(400, 'BAD_REQUEST', '缺少月份或技师。')
    if (db.prepare('SELECT 1 FROM salary_payrolls WHERE tenant_id = ? AND month = ? LIMIT 1').get(tid, month)) {
      throw apiError(409, 'ALREADY_LOCKED', `${month} 已锁定,先解锁再调整。`)
    }
    const cents = Math.round(Number(body.adjustCents) || 0)
    const note = String(body.note || '').trim().slice(0, 100)
    if (cents !== 0 && !note) throw apiError(400, 'BAD_REQUEST', '调整必须写备注(如:代班补贴/迟到扣款)。')
    db.prepare(`INSERT INTO salary_adjusts (tenant_id, month, technician_id, adjust_cents, note, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, month, technician_id) DO UPDATE SET adjust_cents = excluded.adjust_cents, note = excluded.note, updated_at = excluded.updated_at`)
      .run(tid, month, techId, cents, note, iso(new Date()))
    return json(res, 200, { ok: true, adjustCents: cents, note })
  }
  // 员工:我的本月预估(自己的数据,无需财务钥匙);附工资表状态(已锁定/已发放)
  if (req.method === 'GET' && path === '/admin/salary/my-estimate') {
    if (!adminSession.technicianId) throw apiError(400, 'BAD_REQUEST', '当前账号未绑定技师。')
    const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : localParts(new Date()).date.slice(0, 7)
    const pr = db.prepare('SELECT total_cents, paid_at FROM salary_payrolls WHERE tenant_id = ? AND month = ? AND technician_id = ?')
      .get(currentTenantId(), month, adminSession.technicianId)
    return json(res, 200, {
      estimate: computeSalaryEstimate(adminSession.technicianId, month, currentTenantId()),
      payrollLocked: Boolean(pr), payrollPaid: Boolean(pr && pr.paid_at),
      payrollTotalCents: pr ? pr.total_cents : null
    })
  }
  // ===== 员工打卡考勤(P1-⑤) =====
  // 规定下班时间:当日技师排班 end_time > 门店当日营业 close_time > 19:00
  const scheduledEndFor = (techId, date, storeId) => {
    const sched = db.prepare('SELECT end_time, is_working FROM technician_schedules WHERE technician_id = ? AND date = ?').get(techId, date)
    if (sched && sched.is_working && sched.end_time) return sched.end_time
    const wd = localDateTime(date, '12:00').getDay()
    const bh = db.prepare('SELECT close_time FROM business_hours WHERE store_id = ? AND weekday = ?').get(storeId || defaultStoreId(), wd)
    return (bh && bh.close_time) || '19:00'
  }
  // 打卡(员工本人):action in|out;WiFi 白名单已配置则校验 BSSID(不匹配 403,提示连店内 WiFi);未配置=放行但标未验证
  if (req.method === 'POST' && path === '/admin/attendance/clock') {
    const techId = adminSession.technicianId
    if (!techId) throw apiError(400, 'BAD_REQUEST', '当前账号未绑定技师,无法打卡。')
    const body = await readBody(req)
    const action = body.action === 'out' ? 'out' : 'in'
    const ssid = String((body.wifi && body.wifi.ssid) || '').slice(0, 60)
    const bssid = String((body.wifi && body.wifi.bssid) || '').toLowerCase().slice(0, 40)
    const tid = currentTenantId()
    const whitelist = db.prepare('SELECT bssid FROM store_wifi WHERE tenant_id = ?').all(tid).map((r) => String(r.bssid).toLowerCase())
    let verified = 0
    if (whitelist.length) {
      if (bssid && whitelist.includes(bssid)) verified = 1
      else throw apiError(403, 'WIFI_REQUIRED', '未连接门店 WiFi,无法打卡。请连上店内 WiFi 再试;确实连不上找老板手动补卡。')
    }
    const now = new Date()
    const lp = localParts(now)
    const date = lp.date
    let rec = db.prepare('SELECT * FROM attendance_records WHERE tenant_id = ? AND technician_id = ? AND work_date = ?').get(tid, techId, date)
    if (action === 'in') {
      if (rec && rec.clock_in_at) throw apiError(409, 'ALREADY_IN', `今天已在 ${localParts(rec.clock_in_at).time} 打过上班卡。`)
      if (!rec) {
        db.prepare(`INSERT INTO attendance_records (id, tenant_id, technician_id, work_date, clock_in_at, in_wifi_ssid, in_wifi_bssid, in_verified, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(randomId('att'), tid, techId, date, iso(now), ssid, bssid, verified, iso(now), iso(now))
      } else {
        db.prepare('UPDATE attendance_records SET clock_in_at = ?, in_wifi_ssid = ?, in_wifi_bssid = ?, in_verified = ?, updated_at = ? WHERE id = ?')
          .run(iso(now), ssid, bssid, verified, iso(now), rec.id)
      }
    } else {
      if (!rec || !rec.clock_in_at) throw apiError(400, 'NOT_CLOCKED_IN', '还没打上班卡,不能打下班卡。')
      if (rec.clock_out_at) throw apiError(409, 'ALREADY_OUT', `今天已在 ${localParts(rec.clock_out_at).time} 打过下班卡。`)
      const schedEnd = scheduledEndFor(techId, date, body.storeId)
      const overtime = Math.max(0, minutesFromTime(lp.time) - minutesFromTime(schedEnd))
      db.prepare('UPDATE attendance_records SET clock_out_at = ?, out_wifi_ssid = ?, out_wifi_bssid = ?, out_verified = ?, overtime_min = ?, updated_at = ? WHERE id = ?')
        .run(iso(now), ssid, bssid, verified, overtime, iso(now), rec.id)
    }
    rec = db.prepare('SELECT * FROM attendance_records WHERE tenant_id = ? AND technician_id = ? AND work_date = ?').get(tid, techId, date)
    return json(res, 200, { record: serializeAttendance(rec) })
  }
  // 今日考勤:员工=本人今日+本周;老板=全员看板(在岗/已下班/超时/休息/未上班)
  if (req.method === 'GET' && path === '/admin/attendance/today') {
    const tid = currentTenantId()
    const today = localParts(new Date()).date
    const nowMin = minutesFromTime(localParts(new Date()).time)
    if (adminSession.role === 'staff') {
      const techId = adminSession.technicianId || ''
      const rec = db.prepare('SELECT * FROM attendance_records WHERE tenant_id = ? AND technician_id = ? AND work_date = ?').get(tid, techId, today)
      const week = db.prepare(`SELECT * FROM attendance_records WHERE tenant_id = ? AND technician_id = ? AND work_date >= ? AND work_date <= ?
        ORDER BY work_date DESC`).all(tid, techId, iso(addMinutes(localDateTime(today, '00:00'), -6 * 24 * 60)).slice(0, 10), today)
      const schedEnd = scheduledEndFor(techId, today, null)
      return json(res, 200, { today: rec ? serializeAttendance(rec) : null, scheduledEnd: schedEnd, week: week.map(serializeAttendance), storeNow: localParts(new Date()).time, storeDate: today })
    }
    const techs = db.prepare('SELECT id, name, title FROM technicians WHERE tenant_id = ? AND is_active = 1 ORDER BY name ASC').all(tid)
    let working = 0, done = 0, over = 0
    const rows = techs.map((t) => {
      const rec = db.prepare('SELECT * FROM attendance_records WHERE tenant_id = ? AND technician_id = ? AND work_date = ?').get(tid, t.id, today)
      const sched = db.prepare('SELECT is_working FROM technician_schedules WHERE technician_id = ? AND date = ?').get(t.id, today)
      const isRest = sched ? !sched.is_working : false
      const schedEnd = scheduledEndFor(t.id, today, null)
      let state = 'none' // none 未上班 | working 在岗 | overtime 超时未走 | done 已下班 | rest 休息
      let workedMin = 0, overtimeMin = 0
      if (rec && rec.clock_in_at) {
        const inMin = minutesFromTime(localParts(rec.clock_in_at).time)
        if (rec.clock_out_at) {
          state = 'done'; done += 1
          workedMin = Math.max(0, minutesFromTime(localParts(rec.clock_out_at).time) - inMin)
          overtimeMin = rec.overtime_min || 0
        } else {
          workedMin = Math.max(0, nowMin - inMin)
          overtimeMin = Math.max(0, nowMin - minutesFromTime(schedEnd))
          if (overtimeMin > 0) { state = 'overtime'; over += 1; working += 1 } else { state = 'working'; working += 1 }
        }
      } else if (isRest) state = 'rest'
      return {
        technicianId: t.id, name: t.name, title: t.title || '', state,
        clockIn: rec && rec.clock_in_at ? localParts(rec.clock_in_at).time : '',
        clockOut: rec && rec.clock_out_at ? localParts(rec.clock_out_at).time : '',
        workedMin, overtimeMin, recordId: rec ? rec.id : '',
        adjusted: Boolean(rec && rec.adjusted_by), verified: rec ? Boolean(rec.in_verified) : false
      }
    })
    return json(res, 200, { date: today, working, done, overtime: over, rows, storeNow: localParts(new Date()).time })
  }
  // 老板修正打卡(补卡/改时刻):传 clockIn/clockOut(HH:mm,当日),自动重算加班
  if (req.method === 'PATCH' && path.match(/^\/admin\/attendance\/[^/]+$/)) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可修正打卡。')
    const id = path.split('/')[3]
    const body = await readBody(req)
    let rec = db.prepare('SELECT * FROM attendance_records WHERE id = ? AND tenant_id = ?').get(id, currentTenantId())
    // 补卡:body.technicianId + body.date 时可新建
    if (!rec && body.technicianId && body.date) {
      const rid = randomId('att')
      db.prepare('INSERT INTO attendance_records (id, tenant_id, technician_id, work_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(rid, currentTenantId(), body.technicianId, body.date, iso(new Date()), iso(new Date()))
      rec = db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(rid)
    }
    if (!rec) throw apiError(404, 'NOT_FOUND', '考勤记录不存在。')
    const upd = {}
    if (body.clockIn && /^\d{2}:\d{2}$/.test(body.clockIn)) upd.clock_in_at = iso(localDateTime(rec.work_date, body.clockIn))
    if (body.clockOut && /^\d{2}:\d{2}$/.test(body.clockOut)) upd.clock_out_at = iso(localDateTime(rec.work_date, body.clockOut))
    if (body.clockOut === null) upd.clock_out_at = null
    if (!Object.keys(upd).length) throw apiError(400, 'BAD_REQUEST', '没有要修正的内容。')
    const inAt = upd.clock_in_at || rec.clock_in_at
    const outAt = 'clock_out_at' in upd ? upd.clock_out_at : rec.clock_out_at
    let overtime = 0
    if (outAt) {
      const schedEnd = scheduledEndFor(rec.technician_id, rec.work_date, null)
      overtime = Math.max(0, minutesFromTime(localParts(outAt).time) - minutesFromTime(schedEnd))
    }
    db.prepare('UPDATE attendance_records SET clock_in_at = ?, clock_out_at = ?, overtime_min = ?, adjusted_by = ?, note = COALESCE(?, note), updated_at = ? WHERE id = ?')
      .run(inAt, outAt, overtime, adminSession.email || 'owner', body.note || null, iso(new Date()), rec.id)
    return json(res, 200, { record: serializeAttendance(db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(rec.id)) })
  }
  // 打卡 WiFi 白名单(老板):列表/添加/删除;员工端把当前连接的 WiFi 上报,老板一键「设为打卡 WiFi」
  if (req.method === 'GET' && path === '/admin/store-wifi') {
    const rows = db.prepare('SELECT * FROM store_wifi WHERE tenant_id = ? ORDER BY created_at DESC').all(currentTenantId())
    return json(res, 200, { wifis: rows.map((r) => ({ id: r.id, ssid: r.ssid || '', bssid: r.bssid })) })
  }
  if (req.method === 'POST' && path === '/admin/store-wifi') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可配置打卡 WiFi。')
    const body = await readBody(req)
    const bssid = String(body.bssid || '').toLowerCase().trim()
    if (!bssid) throw apiError(400, 'BAD_REQUEST', '缺少 WiFi BSSID(需在手机上连着店内 WiFi 操作)。')
    if (db.prepare('SELECT id FROM store_wifi WHERE tenant_id = ? AND bssid = ?').get(currentTenantId(), bssid)) {
      return json(res, 200, { ok: true, deduped: true })
    }
    const id = randomId('wifi')
    db.prepare('INSERT INTO store_wifi (id, tenant_id, store_id, ssid, bssid, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, currentTenantId(), body.storeId || defaultStoreId(), String(body.ssid || '').slice(0, 60), bssid, iso(new Date()))
    return json(res, 201, { id })
  }
  if (req.method === 'DELETE' && path.match(/^\/admin\/store-wifi\/[^/]+$/)) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可配置打卡 WiFi。')
    db.prepare('DELETE FROM store_wifi WHERE id = ? AND tenant_id = ?').run(path.split('/')[3], currentTenantId())
    return json(res, 200, { ok: true })
  }
  // 站内提醒:老板发给某技师(写库);员工端主页拉未读展示横幅,点「知道了」标已读
  if (req.method === 'POST' && path === '/admin/staff-nudges') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可发提醒。')
    const body = await readBody(req)
    const techId = String(body.technicianId || '').trim()
    const message = String(body.message || '').trim().slice(0, 200)
    if (!techId || !message) throw apiError(400, 'BAD_REQUEST', '缺少技师或提醒内容。')
    const tech = db.prepare('SELECT id FROM technicians WHERE id = ? AND tenant_id = ?').get(techId, currentTenantId())
    if (!tech) throw apiError(404, 'NOT_FOUND', '技师不存在。')
    const type = String(body.type || 'service-note').slice(0, 30)
    // 防重复轰炸:同技师同类型已有未读提醒 → 原条更新内容/时间,不再新增(老板连点多次员工也只见一条)
    const existing = db.prepare('SELECT id FROM staff_nudges WHERE tenant_id = ? AND technician_id = ? AND type = ? AND read_at IS NULL').get(currentTenantId(), techId, type)
    if (existing) {
      db.prepare('UPDATE staff_nudges SET message = ?, created_at = ?, created_by = ? WHERE id = ?')
        .run(message, iso(new Date()), adminSession.email || 'owner', existing.id)
      return json(res, 200, { id: existing.id, deduped: true })
    }
    const id = randomId('nudge')
    db.prepare('INSERT INTO staff_nudges (id, tenant_id, technician_id, type, message, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, currentTenantId(), techId, type, message, adminSession.email || 'owner', iso(new Date()))
    return json(res, 201, { id })
  }
  if (req.method === 'GET' && path === '/admin/staff-nudges/mine') {
    if (!adminSession.technicianId) return json(res, 200, { nudges: [] })
    const rows = db.prepare('SELECT * FROM staff_nudges WHERE tenant_id = ? AND technician_id = ? AND read_at IS NULL ORDER BY created_at DESC LIMIT 10')
      .all(currentTenantId(), adminSession.technicianId)
    return json(res, 200, { nudges: rows.map((r) => ({ id: r.id, type: r.type, message: r.message, createdAt: r.created_at })) })
  }
  if (req.method === 'POST' && path.match(/^\/admin\/staff-nudges\/[^/]+\/read$/)) {
    const id = path.split('/')[3]
    db.prepare('UPDATE staff_nudges SET read_at = ? WHERE id = ? AND tenant_id = ? AND technician_id = ?')
      .run(iso(new Date()), id, currentTenantId(), adminSession.technicianId || '')
    return json(res, 200, { ok: true })
  }
  // 待写小记:按「单」判断——某单 COMPLETED 且无对应 service_note = 待写。
  // 员工只见本人技师的单;老板全店(前端按技师分组展示)。?date= 默认今天(门店时区),不传 date 也可 ?days=N 看近 N 天。
  if (req.method === 'GET' && path === '/admin/service-notes/pending') {
    const tid = currentTenantId()
    const date = query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : localParts(new Date()).date
    const days = Math.min(14, Math.max(1, Number(query.days) || 1))
    const rangeStart = iso(addMinutes(localDateTime(date, '00:00'), -(days - 1) * 24 * 60))
    const rangeEnd = iso(addMinutes(localDateTime(date, '00:00'), 24 * 60))
    const staffOnly = adminSession.role === 'staff' ? ' AND b.technician_id = ?' : ''
    const params = [tid, rangeStart, rangeEnd]
    if (staffOnly) params.push(adminSession.technicianId || '')
    const rows = db.prepare(`
      SELECT b.id, b.user_id, b.technician_id, b.service_id, b.appointment_start,
             (SELECT display_name FROM users WHERE id = b.user_id) AS customer_name,
             (SELECT name FROM technicians WHERE id = b.technician_id) AS technician_name
      FROM bookings b
      WHERE b.tenant_id = ? AND b.status = 'COMPLETED' AND b.user_id IS NOT NULL
        AND b.appointment_start >= ? AND b.appointment_start < ?
        AND NOT EXISTS (SELECT 1 FROM service_notes sn WHERE sn.booking_id = b.id)
      ${staffOnly}
      ORDER BY b.appointment_start ASC`).all(...params)
    const items = rows.map((r) => {
      const svc = r.service_id ? getService(r.service_id) : null
      const lp = localParts(r.appointment_start)
      return {
        bookingId: r.id, userId: r.user_id,
        customerName: r.customer_name || '顾客',
        serviceName: svc ? svc.name_zh : '服务',
        technicianId: r.technician_id || '', technicianName: r.technician_name || '技师',
        date: lp.date, time: lp.time
      }
    })
    return json(res, 200, { count: items.length, date, items })
  }
  // 归属备注:技师/老板给某单记「实际谁做/怎么分」;员工限本人单。月底工资试算集中展示,配合±调整,不改业绩数字。
  if (req.method === 'POST' && path.startsWith('/admin/bookings/') && path.endsWith('/attribution-note')) {
    const id = path.split('/')[3]
    const body = await readBody(req)
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND tenant_id = ?').get(id, currentTenantId())
    if (!booking) throw apiError(404, 'NOT_FOUND', '订单不存在。')
    assertStaffCanAccessBooking(adminSession, booking)
    const note = String(body.note || '').trim().slice(0, 120)
    if (!note) throw apiError(400, 'BAD_REQUEST', '备注不能为空。')
    const signed = `${note}(${adminSession.email || 'admin'} ${localParts(new Date()).date})`
    db.prepare('UPDATE bookings SET attribution_note = ?, updated_at = ? WHERE id = ?').run(signed, iso(new Date()), id)
    return json(res, 200, { ok: true, note: signed })
  }
  // 到店打卡:排班台面"进行中"展示态。arrived=true 记到店时间;false 清除(改回未到店)。不改 status、不动财务。
  if (req.method === 'PATCH' && path.startsWith('/admin/bookings/') && path.endsWith('/arrival')) {
    const id = path.split('/')[3]
    const body = await readBody(req)
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id)
    if (!booking) throw apiError(404, 'NOT_FOUND', 'Booking not found.')
    assertStaffCanAccessBooking(adminSession, booking)
    const arrivedAt = body.arrived === false ? null : iso(new Date())
    db.prepare('UPDATE bookings SET arrived_at = ?, updated_at = ? WHERE id = ?').run(arrivedAt, iso(new Date()), id)
    // P1.2 迟到宽限:超过 lateArrivalGraceMin 就提示按爽约处理(是否真的作废由技师点 /no-show 决定,
    // 不在"技师刚说客人到了"的这一刻自动作废订单)。未配置宽限的店(含旗舰店)这段不产出任何字段。
    const arrConfig = getDepositConfig(booking.tenant_id || currentTenantId())
    const graceMin = arrConfig.cancelPolicy.lateArrivalGraceMin
    let lateness = null
    if (graceMin !== null && arrivedAt) {
      const lateMinutes = Math.round((new Date(arrivedAt).getTime() - new Date(booking.appointment_start).getTime()) / 60000)
      lateness = {
        lateMinutes,
        graceMin,
        graceExceeded: lateMinutes > graceMin,
        suggestedAction: lateMinutes > graceMin ? 'no_show' : 'proceed',
        noShowForfeitPct: arrConfig.cancelPolicy.noShowForfeitPct
      }
    }
    return json(res, 200, {
      booking: serializeBooking(db.prepare('SELECT * FROM bookings WHERE id = ?').get(id)),
      ...(lateness ? { lateness } : {})
    })
  }
  // P1.2 改期:合规改期(提前 rescheduleNoticeHours 以上)可把已付定金保留到下一次预约
  if (req.method === 'POST' && path.startsWith('/admin/bookings/') && path.endsWith('/reschedule')) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可改期。')
    const id = path.split('/')[3]
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id)
    if (!booking) throw apiError(404, 'NOT_FOUND', 'Booking not found.')
    assertStaffCanAccessBooking(adminSession, booking)
    if (!['PENDING_PAYMENT', 'CONFIRMED'].includes(booking.status)) throw apiError(400, 'BAD_REQUEST', '该订单当前状态不能改期。')
    const body = await readBody(req)
    const tid = booking.tenant_id || currentTenantId()
    const config = getDepositConfig(tid)
    const cp = config.cancelPolicy
    const hoursBefore = (new Date(booking.appointment_start).getTime() - Date.now()) / 3_600_000
    const compliant = cp.rescheduleNoticeHours === null || hoursBefore >= cp.rescheduleNoticeHours
    // 同一笔定金被保留过几次:看它上一张凭据的计数
    const priorRetain = db.prepare("SELECT MAX(times_used) AS n FROM deposit_retains WHERE tenant_id = ? AND source_booking_id = ?").get(tid, booking.id)?.n || 0
    const nextTimes = priorRetain + 1
    const canRetain = compliant && booking.deposit_cents > 0 && nextTimes <= (cp.depositRetainTimes || 0)
    let retain = null
    const now = iso(new Date())
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare('DELETE FROM booking_slots WHERE booking_id = ?').run(id)
      db.prepare("UPDATE bookings SET status = 'CANCELLED', cancelled_at = ?, cancellation_fee_cents = ?, updated_at = ? WHERE id = ?")
        .run(now, canRetain ? 0 : forfeitedDepositCents(booking, config), now, id)
      db.prepare('INSERT INTO booking_status_history (id, booking_id, from_status, to_status, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomId('hist'), id, booking.status, 'CANCELLED', body.reason || (canRetain ? '合规改期(定金保留)' : '改期'), now)
      if (canRetain) {
        retain = issueDepositRetain({ tenantId: tid, userId: booking.user_id, bookingId: booking.id, amountCents: booking.deposit_cents, timesUsed: nextTimes })
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return json(res, 200, {
      booking: serializeBooking(db.prepare('SELECT * FROM bookings WHERE id = ?').get(id)),
      reschedule: {
        compliant,
        hoursBefore: Math.round(hoursBefore * 10) / 10,
        noticeHours: cp.rescheduleNoticeHours,
        depositRetained: Boolean(retain),
        retainTimesUsed: retain ? retain.times_used : priorRetain,
        retainTimesAllowed: cp.depositRetainTimes || 0,
        retainAmountCents: retain ? retain.amount_cents : 0,
        forfeitedDepositCents: canRetain ? 0 : forfeitedDepositCents(booking, config),
        note: canRetain ? '定金已保留,下次预约自动抵扣。' : '本次改期不满足保留条件,按取消规则处理。'
      }
    })
  }
  // P1.2 爽约:按 noShowForfeitPct 扣定金(迟到超过宽限也走这条)
  if (req.method === 'POST' && path.startsWith('/admin/bookings/') && path.endsWith('/no-show')) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可标记爽约。')
    const id = path.split('/')[3]
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id)
    if (!booking) throw apiError(404, 'NOT_FOUND', 'Booking not found.')
    assertStaffCanAccessBooking(adminSession, booking)
    const nsBody = await readBody(req)
    const tid = booking.tenant_id || currentTenantId()
    const config = getDepositConfig(tid)
    const fee = forfeitedDepositCents(booking, config, { noShow: true })
    const now = iso(new Date())
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare('DELETE FROM booking_slots WHERE booking_id = ?').run(id)
      db.prepare("UPDATE bookings SET status = 'CANCELLED', cancelled_at = ?, cancellation_fee_cents = ?, updated_at = ? WHERE id = ?").run(now, fee, now, id)
      db.prepare('INSERT INTO booking_status_history (id, booking_id, from_status, to_status, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomId('hist'), id, booking.status, 'CANCELLED', String(nsBody.reason || '顾客爽约(或迟到超过宽限)'), now)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    reverseBookingIncome(id, adminSession.email || 'admin')
    return json(res, 200, {
      booking: serializeBooking(db.prepare('SELECT * FROM bookings WHERE id = ?').get(id)),
      noShow: { forfeitedDepositCents: fee, forfeitPct: config.cancelPolicy.noShowForfeitPct }
    })
  }
  if (req.method === 'PATCH' && path.startsWith('/admin/bookings/') && path.endsWith('/status')) {
    const id = path.split('/')[3]
    const body = await readBody(req)
    const status = body.status
    if (!['PENDING_PAYMENT', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'AFTER_SALES'].includes(status)) throw apiError(400, 'BAD_REQUEST', 'Invalid status.')
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id)
    if (!booking) throw apiError(404, 'NOT_FOUND', 'Booking not found.')
    assertStaffCanAccessBooking(adminSession, booking)
    if (['CANCELLED', 'EXPIRED'].includes(status)) db.prepare('DELETE FROM booking_slots WHERE booking_id = ?').run(id)
    db.prepare('UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?').run(status, iso(new Date()), id)
    const updatedBooking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id)
    // 财务自动入账：完成→确认收入；取消/过期→冲销已入账收入
    if (status === 'COMPLETED') recordBookingIncome(updatedBooking, adminSession.email || 'admin')
    if (['CANCELLED', 'EXPIRED'].includes(status)) reverseBookingIncome(id, adminSession.email || 'admin')
    return json(res, 200, { booking: serializeBooking(updatedBooking) })
  }
  if (req.method === 'PATCH' && path.startsWith('/admin/bookings/') && path.endsWith('/work-images')) {
    const id = path.split('/')[3]
    const body = await readBody(req)
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id)
    if (!booking) throw apiError(404, 'NOT_FOUND', 'Booking not found.')
    assertStaffCanAccessBooking(adminSession, booking)
    if (booking.gallery_status === 'approved') throw apiError(409, 'GALLERY_LOCKED', 'This gallery has been approved and locked.')
    db.prepare('UPDATE bookings SET work_images_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(normalizeWorkImages(body.workImages)), iso(new Date()), id)
    return json(res, 200, { booking: serializeBooking(db.prepare('SELECT * FROM bookings WHERE id = ?').get(id)) })
  }
  if (req.method === 'PATCH' && path.startsWith('/admin/bookings/') && path.endsWith('/gallery-approval')) {
    const id = path.split('/')[3]
    const body = await readBody(req)
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id)
    if (!booking) throw apiError(404, 'NOT_FOUND', 'Booking not found.')
    assertStaffCanAccessBooking(adminSession, booking)
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_identities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      union_id TEXT,
      email TEXT,
      phone TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (provider, provider_user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_identities_user_id ON user_identities(user_id);
  `)
} catch (error) {
  if (!String(error.message || '').includes('already exists')) throw error
}
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
try {
  db.exec('ALTER TABLE bookings ADD COLUMN deposit_required_cents INTEGER NOT NULL DEFAULT 5000')
} catch (error) {
  if (!String(error.message || '').includes('duplicate column')) throw error
}
try {
  db.exec('ALTER TABLE bookings ADD COLUMN deposit_waived_cents INTEGER NOT NULL DEFAULT 0')
} catch (error) {
  if (!String(error.message || '').includes('duplicate column')) throw error
}
try {
  db.exec('ALTER TABLE bookings ADD COLUMN deposit_waive_reason TEXT')
} catch (error) {
  if (!String(error.message || '').includes('duplicate column')) throw error
}
try {
  db.exec('ALTER TABLE bookings ADD COLUMN member_level_at_booking TEXT')
} catch (error) {
  if (!String(error.message || '').includes('duplicate column')) throw error
}
try {
  // 到店打卡时间(2026-07-22):排班台面"进行中"展示态,不进主状态机、不碰财务
  db.exec('ALTER TABLE bookings ADD COLUMN arrived_at TEXT')
} catch (error) {
  if (!String(error.message || '').includes('duplicate column')) throw error
}
try {
  // 老板直接排单·未付定金标(2026-07-22):1=老板代排且未收定金,占位但提醒之后收;0=已付/常规
  db.exec('ALTER TABLE bookings ADD COLUMN direct_deposit_unpaid INTEGER NOT NULL DEFAULT 0')
} catch (error) {
  if (!String(error.message || '').includes('duplicate column')) throw error
}
try {
  db.exec('ALTER TABLE business_hours ADD COLUMN updated_at TEXT')
} catch (error) {
  if (!String(error.message || '').includes('duplicate column')) throw error
}
try {
  db.exec('ALTER TABLE business_hours ADD COLUMN updated_by TEXT')
} catch (error) {
  if (!String(error.message || '').includes('duplicate column')) throw error
}
// 多租户地基:核心业务表加 tenant_id。DEFAULT 让 SQLite 自动回填存量行,新行自动继承,无需改任何 INSERT。
for (const table of ['stores', 'services', 'technicians', 'users', 'bookings', 'wechat_conversations', 'quote_requests', 'reminder_tasks', 'user_identities']) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'lucky-luxe'`)
  } catch (error) {
    if (!String(error.message || '').includes('duplicate column')) throw error
  }
}
try {
  db.exec('ALTER TABLE tenants ADD COLUMN plan_expires_at TEXT')
} catch (error) {
  if (!String(error.message || '').includes('duplicate column')) throw error
}
try {
  db.exec('ALTER TABLE tenants ADD COLUMN finance_password_hash TEXT')
} catch (error) {
  if (!String(error.message || '').includes('duplicate column')) throw error
}
// ===== 特殊日期(节假日休息/调整时段):覆盖每周固定营业时间 =====
db.exec(`
  CREATE TABLE IF NOT EXISTS store_special_dates (
    store_id TEXT NOT NULL,
    date TEXT NOT NULL,
    is_closed INTEGER NOT NULL DEFAULT 1,
    open_time TEXT,
    close_time TEXT,
    note TEXT,
    PRIMARY KEY (store_id, date)
  );
`)
// ===== 站内提醒(老板→员工):老板一键提醒,员工端打开小程序即见横幅;先站内,企微落地后可升级直发 =====
db.exec(`
  CREATE TABLE IF NOT EXISTS staff_nudges (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'lucky-luxe',
    technician_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'service-note',
    message TEXT NOT NULL,
    created_by TEXT,
    created_at TEXT NOT NULL,
    read_at TEXT
  );
`)
// ===== 员工打卡考勤(P1-⑤):WiFi BSSID 主判 + 老板手动修正兜底;工时=下班-上班,超排班/营业结束=加班 =====
db.exec(`
  CREATE TABLE IF NOT EXISTS attendance_records (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'lucky-luxe',
    technician_id TEXT NOT NULL,
    work_date TEXT NOT NULL,
    clock_in_at TEXT,
    clock_out_at TEXT,
    in_wifi_ssid TEXT,
    in_wifi_bssid TEXT,
    in_verified INTEGER NOT NULL DEFAULT 0,
    out_wifi_ssid TEXT,
    out_wifi_bssid TEXT,
    out_verified INTEGER NOT NULL DEFAULT 0,
    overtime_min INTEGER NOT NULL DEFAULT 0,
    adjusted_by TEXT,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (tenant_id, technician_id, work_date)
  );
  CREATE TABLE IF NOT EXISTS store_wifi (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'lucky-luxe',
    store_id TEXT,
    ssid TEXT,
    bssid TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`)
// ===== 薪资方案(P1-④):模板化——底薪+手工费+业绩阶梯+卡耗+加班费;全店默认(technician_id空串)+按人覆盖 =====
db.exec(`
  CREATE TABLE IF NOT EXISTS salary_plans (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'lucky-luxe',
    technician_id TEXT NOT NULL DEFAULT '',
    template TEXT NOT NULL DEFAULT 'base_ladder',
    base_salary_cents INTEGER NOT NULL DEFAULT 0,
    handwork_fee_cents INTEGER NOT NULL DEFAULT 0,
    ladder_json TEXT NOT NULL DEFAULT '[]',
    flat_pct REAL NOT NULL DEFAULT 0,
    card_pct REAL NOT NULL DEFAULT 0,
    overtime_rate_cents INTEGER NOT NULL DEFAULT 0,
    overtime_unit_min INTEGER NOT NULL DEFAULT 30,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (tenant_id, technician_id)
  );
`)
try {
  // 充值提成(2026-07-30 店主要求拆开):卖卡/促成充值的提点,与耗卡提点分开配
  db.exec('ALTER TABLE salary_plans ADD COLUMN recharge_pct REAL NOT NULL DEFAULT 0')
} catch (error) {
  if (!String(error.message || '').includes('duplicate column')) throw error
}
// 月度工资表锁定快照:「确认并锁定」后按月按人存明细,防事后改数;解锁=删快照重算(要 owner+财务钥匙)
db.exec(`
  CREATE TABLE IF NOT EXISTS salary_payrolls (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'lucky-luxe',
    month TEXT NOT NULL,
    technician_id TEXT NOT NULL,
    technician_name TEXT,
    breakdown_json TEXT NOT NULL DEFAULT '{}',
    total_cents INTEGER NOT NULL DEFAULT 0,
    adjust_cents INTEGER NOT NULL DEFAULT 0,
    adjust_note TEXT,
    locked_at TEXT NOT NULL,
    locked_by TEXT,
    UNIQUE (tenant_id, month, technician_id)
  );
`)
for (const col of ['paid_at TEXT', 'paid_by TEXT', 'txn_id TEXT']) {
  try {
    // 工资发放入账标记(2026-07-31 财务闭环):paid_at 非空=已写入账本支出;txn_id 关联 finance_transactions
    db.exec(`ALTER TABLE salary_payrolls ADD COLUMN ${col}`)
  } catch (error) {
    if (!String(error.message || '').includes('duplicate column')) throw error
  }
}
try {
  // 储值流水归属技师(2026-08-01):这笔充值/这次耗卡算谁促成——薪资的充值/耗卡提成据此计算
  db.exec('ALTER TABLE stored_value_transactions ADD COLUMN technician_id TEXT')
} catch (error) {
  if (!String(error.message || '').includes('duplicate column')) throw error
}
try {
  // 归属备注(2026-08-02):完成单时随手记「这单实际谁做/怎么分」;月底工资试算集中展示,配合±调整用,不改业绩数字本身
  db.exec('ALTER TABLE bookings ADD COLUMN attribution_note TEXT')
} catch (error) {
  if (!String(error.message || '').includes('duplicate column')) throw error
}
try {
  // 套餐自动续费意向(2026-08-03):v1=到期前自动生成订单+提醒;真免密扣款待微信支付周期扣费资质,届时无缝升级
  db.exec('ALTER TABLE tenants ADD COLUMN auto_renew INTEGER NOT NULL DEFAULT 0')
} catch (error) {
  if (!String(error.message || '').includes('duplicate column')) throw error
}
// 套餐续费订单(2026-08-03):SaaS 服务费,与门店经营账完全分离(不入 finance_transactions)
db.exec(`
  CREATE TABLE IF NOT EXISTS subscription_orders (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    plan TEXT NOT NULL,
    period TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    pay_channel TEXT,
    transaction_id TEXT,
    created_at TEXT NOT NULL,
    paid_at TEXT,
    expires_before TEXT,
    expires_after TEXT
  );
`)
// 工资手动调整(锁定前填,锁定时定格进快照;补贴+/扣款-,须备注)
db.exec(`
  CREATE TABLE IF NOT EXISTS salary_adjusts (
    tenant_id TEXT NOT NULL,
    month TEXT NOT NULL,
    technician_id TEXT NOT NULL,
    adjust_cents INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    updated_at TEXT,
    PRIMARY KEY (tenant_id, month, technician_id)
  );
`)
// ===== 租户级轻量设置(key-value,JSON 值):先用于客户分层规则,后续通用 =====
db.exec(`
  CREATE TABLE IF NOT EXISTS tenant_settings (
    tenant_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT,
    PRIMARY KEY (tenant_id, key)
  );
`)
// ===== 积分商城:积分台账(只追加,记兑换/冲正;赚分由完成单推导,余额=推导+台账)+ 奖品(=一张券+积分价) =====
db.exec(`
  CREATE TABLE IF NOT EXISTS points_transactions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'lucky-luxe',
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    ref_id TEXT,
    note TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_points_user ON points_transactions(tenant_id, user_id);
  CREATE TRIGGER IF NOT EXISTS points_ledger_no_update BEFORE UPDATE ON points_transactions
  BEGIN SELECT RAISE(ABORT, 'points ledger is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS points_ledger_no_delete BEFORE DELETE ON points_transactions
  BEGIN SELECT RAISE(ABORT, 'points ledger is append-only'); END;
  CREATE TABLE IF NOT EXISTS points_prizes (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'lucky-luxe',
    coupon_id TEXT NOT NULL,
    cost_points INTEGER NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    per_user_limit INTEGER NOT NULL DEFAULT 0,
    valid_days INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1,
    redeemed_qty INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`)
// ===== 真实账号体系:老板主账号 + 老板自管员工账号(替换演示白名单,白名单保留兼容) =====
db.exec(`
  CREATE TABLE IF NOT EXISTS admin_accounts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'lucky-luxe',
    username TEXT NOT NULL UNIQUE,
    display_name TEXT,
    role TEXT NOT NULL,
    technician_id TEXT,
    password_hash TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT
  );
  CREATE TABLE IF NOT EXISTS admin_sessions (
    token TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`)

// ===== 会员套餐(充值套餐 / 会员次卡)+ 优惠券 定义 =====
// 仅"定义"层:老板配置售卖内容。顾客购买/发券核销留待客户端阶段(另建 grants 表),此处不触碰财务与储值台账。
db.exec(`
  CREATE TABLE IF NOT EXISTS membership_packages (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'lucky-luxe',
    kind TEXT NOT NULL DEFAULT 'recharge',
    name TEXT NOT NULL,
    price_cents INTEGER NOT NULL DEFAULT 0,
    bonus_cents INTEGER NOT NULL DEFAULT 0,
    times_count INTEGER NOT NULL DEFAULT 0,
    scope TEXT,
    benefits TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS coupons (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'lucky-luxe',
    name TEXT NOT NULL,
    discount_type TEXT NOT NULL DEFAULT 'amount',
    amount_cents INTEGER NOT NULL DEFAULT 0,
    percent_off INTEGER NOT NULL DEFAULT 0,
    min_spend_cents INTEGER NOT NULL DEFAULT 0,
    valid_days INTEGER NOT NULL DEFAULT 30,
    total_qty INTEGER NOT NULL DEFAULT 0,
    issued_qty INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS coupon_grants (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'lucky-luxe',
    coupon_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active',
    expires_at TEXT,
    used_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS service_notes (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'lucky-luxe',
    user_id TEXT NOT NULL,
    booking_id TEXT,
    technician_id TEXT,
    technician_name TEXT,
    service_name TEXT,
    raw_text TEXT NOT NULL,
    structured_json TEXT NOT NULL DEFAULT '{}',
    created_by TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS merchant_leads (
    id TEXT PRIMARY KEY,
    shop_name TEXT NOT NULL,
    contact_name TEXT,
    phone TEXT,
    wechat_id TEXT,
    shop_type TEXT,
    city TEXT,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`)

function serializeMerchantLead(row) {
  return {
    id: row.id,
    shopName: row.shop_name,
    contactName: row.contact_name || '',
    phone: row.phone || '',
    wechatId: row.wechat_id || '',
    shopType: row.shop_type || '',
    city: row.city || '',
    note: row.note || '',
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function serializeMembershipPackage(row) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    priceCents: row.price_cents,
    bonusCents: row.bonus_cents,
    timesCount: row.times_count,
    scope: row.scope || '',
    benefits: row.benefits || '',
    isActive: Boolean(row.is_active),
    sortOrder: row.sort_order
  }
}

function serializeCoupon(row) {
  return {
    id: row.id,
    name: row.name,
    discountType: row.discount_type,
    amountCents: row.amount_cents,
    percentOff: row.percent_off,
    minSpendCents: row.min_spend_cents,
    validDays: row.valid_days,
    totalQty: row.total_qty,
    issuedQty: row.issued_qty,
    isActive: Boolean(row.is_active)
  }
}

function adminPasswordHash(username, password) {
  return createHash('sha256').update(`admin:${String(username).toLowerCase()}:${String(password)}`).digest('hex')
}

function randomPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 10; i += 1) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

// 自举:平台交付的老板主账号。初始密码写入 local-data/初始老板账号.txt,首次改密后自动删除该文件。
const OWNER_CREDENTIALS_FILE = new URL('./local-data/初始老板账号.txt', import.meta.url).pathname
if (!db.prepare("SELECT id FROM admin_accounts WHERE role = 'owner'").get()) {
  const initialPassword = randomPassword()
  db.prepare(`INSERT INTO admin_accounts (id, username, display_name, role, technician_id, password_hash, must_change_password, status, created_at, updated_at)
    VALUES (?, 'boss', 'Lucky Luxe Owner', 'owner', NULL, ?, 1, 'active', ?, ?)`)
    .run(randomId('acct'), adminPasswordHash('boss', initialPassword), iso(new Date()), iso(new Date()))
  try {
    writeFileSync(OWNER_CREDENTIALS_FILE, `Lucky Luxe 老板主账号(首次登录后必须改密码,改完本文件自动删除)\n用户名: boss\n初始密码: ${initialPassword}\n`)
  } catch { /* 写不进就只打日志 */ }
  console.log(`[账号] 老板主账号已创建 用户名: boss 初始密码: ${initialPassword} (也写入 local-data/初始老板账号.txt)`)
}

function issueAdminSession(accountId, rememberDays = 30) {
  const token = `sess_${randomId('tok').slice(4)}_${Math.random().toString(36).slice(2, 10)}`
  const expires = new Date(Date.now() + rememberDays * 86400000)
  db.prepare('INSERT INTO admin_sessions (token, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(token, accountId, iso(expires), iso(new Date()))
  return token
}

function adminFromSessionToken(token) {
  if (!String(token || '').startsWith('sess_')) return null
  const row = db.prepare(`
    SELECT s.token, s.expires_at, a.* FROM admin_sessions s
    JOIN admin_accounts a ON a.id = s.account_id
    WHERE s.token = ?
  `).get(token)
  if (!row) return null
  if (row.expires_at < iso(new Date()) || row.status !== 'active') {
    db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token)
    return null
  }
  return {
    role: row.role,
    email: row.username,
    displayName: row.display_name,
    provider: 'account',
    accountId: row.id,
    technicianId: row.technician_id || null,
    tenantId: row.tenant_id || DEFAULT_TENANT_ID,
    mustChangePassword: Boolean(row.must_change_password)
  }
}

// ===== 排班申请(员工发起,老板审批) =====
db.exec(`
  CREATE TABLE IF NOT EXISTS schedule_change_requests (
    id TEXT PRIMARY KEY,
    technician_id TEXT NOT NULL,
    date TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    resolution TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    resolved_by TEXT
  );
`)
// ===== 图片路径自愈:历史数据里 .png 引用改为实际存在的 .jpg(brand-logo 除外) =====
db.exec(`UPDATE services SET image_url = REPLACE(image_url, '.png', '.jpg')
  WHERE image_url LIKE '/assets/images/%.png' AND image_url NOT LIKE '%brand-logo%'`)
// ===== 客户运营字段(标签/备注/生日,美业刚需:过敏史、偏好、生日营销) =====
for (const sql of [
  "ALTER TABLE users ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'",
  'ALTER TABLE users ADD COLUMN notes TEXT',
  'ALTER TABLE users ADD COLUMN birthday TEXT'
]) {
  try {
    db.exec(sql)
  } catch (error) {
    if (!String(error.message || '').includes('duplicate column')) throw error
  }
}
// ===== 财务账本防篡改(只追加 + 哈希链)=====
try {
  db.exec('ALTER TABLE finance_transactions ADD COLUMN prev_hash TEXT')
} catch (error) {
  if (!String(error.message || '').includes('duplicate column')) throw error
}
try {
  db.exec('ALTER TABLE finance_transactions ADD COLUMN row_hash TEXT')
} catch (error) {
  if (!String(error.message || '').includes('duplicate column')) throw error
}
// 回填历史行的哈希链(需先移除触发器才能 UPDATE,回填后立即重建)
// 演示租户(id 以 demo- 开头)的账本要能整体销毁,所以旧的无条件触发器一律重建为带 WHEN 条件的版本。
db.exec(`DROP TRIGGER IF EXISTS finance_txn_no_update; DROP TRIGGER IF EXISTS finance_txn_no_delete;
  DROP TRIGGER IF EXISTS stored_value_no_update; DROP TRIGGER IF EXISTS stored_value_no_delete;
  DROP TRIGGER IF EXISTS points_ledger_no_update; DROP TRIGGER IF EXISTS points_ledger_no_delete;`)
{
  const unhashed = db.prepare('SELECT COUNT(*) AS n FROM finance_transactions WHERE row_hash IS NULL').get()
  if (unhashed.n > 0) {
    const rows = db.prepare('SELECT rowid, * FROM finance_transactions ORDER BY rowid ASC').all()
    const chains = {}
    const updateStmt = db.prepare('UPDATE finance_transactions SET prev_hash = ?, row_hash = ? WHERE rowid = ?')
    for (const row of rows) {
      const prev = chains[row.tenant_id] || 'genesis'
      const hash = financeRowHash(row, prev)
      updateStmt.run(prev, hash, row.rowid)
      chains[row.tenant_id] = hash
    }
  }
}
// 数据库层强制只追加:任何 UPDATE/DELETE 直接拒绝,纠错只能走红字冲销/调整分录。
// 唯一豁免:演示租户(tenant_id 以 'demo-' 开头)——它们的数据本来就是给店主演示用的、要能一键销毁重建,
// 真实商户(lucky-luxe 及未来所有正式租户)的只追加保证完全不变。
db.exec(`
  CREATE TRIGGER finance_txn_no_update BEFORE UPDATE ON finance_transactions
  WHEN OLD.tenant_id NOT LIKE 'demo-%'
  BEGIN SELECT RAISE(ABORT, 'finance ledger is append-only'); END;
  CREATE TRIGGER finance_txn_no_delete BEFORE DELETE ON finance_transactions
  WHEN OLD.tenant_id NOT LIKE 'demo-%'
  BEGIN SELECT RAISE(ABORT, 'finance ledger is append-only'); END;
  CREATE TRIGGER stored_value_no_update BEFORE UPDATE ON stored_value_transactions
  WHEN OLD.tenant_id NOT LIKE 'demo-%'
  BEGIN SELECT RAISE(ABORT, 'stored value ledger is append-only'); END;
  CREATE TRIGGER stored_value_no_delete BEFORE DELETE ON stored_value_transactions
  WHEN OLD.tenant_id NOT LIKE 'demo-%'
  BEGIN SELECT RAISE(ABORT, 'stored value ledger is append-only'); END;
  CREATE TRIGGER points_ledger_no_update BEFORE UPDATE ON points_transactions
  WHEN OLD.tenant_id NOT LIKE 'demo-%'
  BEGIN SELECT RAISE(ABORT, 'points ledger is append-only'); END;
  CREATE TRIGGER points_ledger_no_delete BEFORE DELETE ON points_transactions
  WHEN OLD.tenant_id NOT LIKE 'demo-%'
  BEGIN SELECT RAISE(ABORT, 'points ledger is append-only'); END;
`)

// 统一身份回填:早期用户只有 users 表字段、没有 user_identities 记录,补齐映射。
db.exec(`
  INSERT OR IGNORE INTO user_identities (id, user_id, provider, provider_user_id, email, created_at, updated_at)
  SELECT 'identity-bf-' || lower(hex(randomblob(6))), id, 'email', lower(email), lower(email), datetime('now'), datetime('now')
  FROM users WHERE email IS NOT NULL AND email != '';
  INSERT OR IGNORE INTO user_identities (id, user_id, provider, provider_user_id, created_at, updated_at)
  SELECT 'identity-bf-' || lower(hex(randomblob(6))), id, 'wechat_miniprogram', wechat_open_id, datetime('now'), datetime('now')
  FROM users WHERE wechat_open_id IS NOT NULL AND wechat_open_id != '';
  INSERT OR IGNORE INTO user_identities (id, user_id, provider, provider_user_id, created_at, updated_at)
  SELECT 'identity-bf-' || lower(hex(randomblob(6))), id, 'google', google_id, datetime('now'), datetime('now')
  FROM users WHERE google_id IS NOT NULL AND google_id != '';
  INSERT OR IGNORE INTO user_identities (id, user_id, provider, provider_user_id, phone, created_at, updated_at)
  SELECT 'identity-bf-' || lower(hex(randomblob(6))), id, 'phone', phone, phone, datetime('now'), datetime('now')
  FROM users WHERE phone IS NOT NULL AND phone != '';
`)
/* ===== P1 结算闭环(2026-08-08 原稿)=====
   一次结算 = 一个 settlement_group;组内一位被服务者一张 settlement(带朋友来就是多张)。
   金额**全部由后端算**,前端只显示返回值 —— 两条恒等式由 assertSettlementInvariants 在
   每次计算后强制校验,算错就直接抛错,不可能悄悄发出去。
   全部表带 tenant_id 且**不给 DEFAULT**(P0.9 纪律)。 */
db.exec(`
  CREATE TABLE IF NOT EXISTS settlement_groups (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    booking_id TEXT,
    card_owner_user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_sign',
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settlements (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    booking_id TEXT,
    user_id TEXT NOT NULL,
    served_person_name TEXT,
    is_proxy_paid INTEGER NOT NULL DEFAULT 0,
    code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending_sign',
    price_tier_used TEXT NOT NULL DEFAULT 'list',
    tier_changed_from TEXT,
    tier_changed_by TEXT,
    tier_changed_at TEXT,
    list_total_cents INTEGER NOT NULL DEFAULT 0,
    subtotal_cents INTEGER NOT NULL DEFAULT 0,
    deposit_deduct_cents INTEGER NOT NULL DEFAULT 0,
    discount_total_cents INTEGER NOT NULL DEFAULT 0,
    total_cents INTEGER NOT NULL DEFAULT 0,
    pay_intent TEXT NOT NULL DEFAULT 'balance_plus_offline',
    signature_data TEXT,
    signed_at TEXT,
    disclaimer_accepted INTEGER NOT NULL DEFAULT 0,
    perf_alloc_status TEXT NOT NULL DEFAULT 'pending',
    aftersales_status TEXT,
    snapshot_url TEXT,
    snapshot_inline TEXT,
    snapshot_storage TEXT,
    snapshot_at TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_settlements_group ON settlements(tenant_id, group_id);
  CREATE TABLE IF NOT EXISTS settlement_items (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    settlement_id TEXT NOT NULL,
    item_no INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'main',
    service_id TEXT,
    name_snapshot TEXT NOT NULL,
    tier_key TEXT NOT NULL DEFAULT 'list',
    unit TEXT NOT NULL DEFAULT 'once',
    qty INTEGER NOT NULL DEFAULT 1,
    list_unit_cents INTEGER NOT NULL DEFAULT 0,
    unit_price_cents INTEGER NOT NULL DEFAULT 0,
    list_amount_cents INTEGER NOT NULL DEFAULT 0,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    rule_applied TEXT,
    is_free INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_settlement_items ON settlement_items(tenant_id, settlement_id, item_no);
  CREATE TABLE IF NOT EXISTS settlement_technicians (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    settlement_id TEXT NOT NULL,
    technician_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'main',
    item_nos_json TEXT NOT NULL DEFAULT '[]',
    share_pct REAL,
    share_cents INTEGER,
    allocated_by TEXT,
    allocated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_settlement_techs ON settlement_technicians(tenant_id, settlement_id);
  CREATE TABLE IF NOT EXISTS settlement_payments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    settlement_id TEXT NOT NULL,
    leg TEXT NOT NULL,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    payer_user_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    note TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_settlement_payments ON settlement_payments(tenant_id, settlement_id);
  CREATE TABLE IF NOT EXISTS settlement_amendments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    settlement_id TEXT NOT NULL,
    before_json TEXT NOT NULL,
    after_json TEXT NOT NULL,
    reason TEXT,
    amount_delta_cents INTEGER NOT NULL DEFAULT 0,
    auto_balance_adjust_cents INTEGER NOT NULL DEFAULT 0,
    amended_by TEXT,
    amended_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_settlement_amendments ON settlement_amendments(tenant_id, settlement_id);
`)
// 已签单据永不修改:更正只能走 amendments。数据库层兜住,不靠人记纪律。
db.exec(`
  DROP TRIGGER IF EXISTS settlements_signed_no_update;
  CREATE TRIGGER settlements_signed_no_update BEFORE UPDATE ON settlements
  WHEN OLD.status = 'signed' AND NEW.status = 'signed'
    AND (OLD.total_cents <> NEW.total_cents OR OLD.subtotal_cents <> NEW.subtotal_cents
      OR OLD.list_total_cents <> NEW.list_total_cents OR OLD.signature_data IS NOT NEW.signature_data
      -- 快照允许写入一次(签署那一刻),之后不可替换
      OR (OLD.snapshot_at IS NOT NULL AND (OLD.snapshot_url IS NOT NEW.snapshot_url OR OLD.snapshot_inline IS NOT NEW.snapshot_inline)))
  BEGIN SELECT RAISE(ABORT, 'signed settlement is immutable; use settlement_amendments'); END;
`)

/* ===== P1.2 定金保留凭据 + 话术模板中心(2026-08-08)=====
   tenant_id 一律不给 DEFAULT(P0.9 立的纪律:默认值会让漏写的 INSERT 悄悄归到旗舰店名下)。 */
db.exec(`
  CREATE TABLE IF NOT EXISTS deposit_retains (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    source_booking_id TEXT,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    times_used INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    consumed_booking_id TEXT,
    consumed_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_deposit_retains_user ON deposit_retains(tenant_id, user_id, status);
  CREATE TABLE IF NOT EXISTS message_templates (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    scene TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    content_en TEXT NOT NULL DEFAULT '',
    variables_json TEXT NOT NULL DEFAULT '[]',
    is_active INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_message_templates_tenant ON message_templates(tenant_id, scene, sort);
`)

/* ===== P0.9 七张子表补 tenant_id(2026-08-07,审计 B-5)=====
   payments / technician_schedules / business_hours / store_special_dates /
   booking_slots / booking_status_history / booking_drafts 一直没有 tenant_id,
   靠父键(booking / technician / store)推导。现状安全,但今后任何直查裸表的报表/清理代码都会跨店。

   两个刻意的设计:
   1. 加列**不带 DEFAULT**(可空)。A-1 的教训:带 DEFAULT 'lucky-luxe' 会让漏写的 INSERT 悄悄
      归到旗舰店名下,代码里根本看不见。留 NULL 反而刺眼,回归里直接断言"零 NULL"。
   2. 新写入靠**数据库触发器**从父表回填,而不是去改 13 个 INSERT 语句 ——
      改语句会漏、以后新增的写入点也会忘;触发器是一次性的、对未来的写入同样生效。
   本批只补列 + 回填 + 新写入带租户,**现有查询的父键条件一律不动**(行为零变化)。 */
for (const sql of [
  'ALTER TABLE payments ADD COLUMN tenant_id TEXT',
  'ALTER TABLE technician_schedules ADD COLUMN tenant_id TEXT',
  'ALTER TABLE business_hours ADD COLUMN tenant_id TEXT',
  'ALTER TABLE store_special_dates ADD COLUMN tenant_id TEXT',
  'ALTER TABLE booking_slots ADD COLUMN tenant_id TEXT',
  'ALTER TABLE booking_status_history ADD COLUMN tenant_id TEXT',
  'ALTER TABLE booking_drafts ADD COLUMN tenant_id TEXT'
]) {
  try {
    db.exec(sql)
  } catch (error) {
    if (!String(error.message || '').includes('duplicate column')) throw error
  }
}
// 存量回填(幂等:只补 NULL 的行)
db.exec(`
  UPDATE payments SET tenant_id = (SELECT b.tenant_id FROM bookings b WHERE b.id = payments.booking_id) WHERE tenant_id IS NULL;
  UPDATE booking_slots SET tenant_id = (SELECT b.tenant_id FROM bookings b WHERE b.id = booking_slots.booking_id) WHERE tenant_id IS NULL;
  UPDATE booking_status_history SET tenant_id = (SELECT b.tenant_id FROM bookings b WHERE b.id = booking_status_history.booking_id) WHERE tenant_id IS NULL;
  UPDATE technician_schedules SET tenant_id = (SELECT t.tenant_id FROM technicians t WHERE t.id = technician_schedules.technician_id) WHERE tenant_id IS NULL;
  UPDATE business_hours SET tenant_id = (SELECT s.tenant_id FROM stores s WHERE s.id = business_hours.store_id) WHERE tenant_id IS NULL;
  UPDATE store_special_dates SET tenant_id = (SELECT s.tenant_id FROM stores s WHERE s.id = store_special_dates.store_id) WHERE tenant_id IS NULL;
  UPDATE booking_drafts SET tenant_id = (SELECT s.tenant_id FROM stores s WHERE s.id = booking_drafts.store_id) WHERE tenant_id IS NULL;
`)
// 父表已被删/悬空的极少数行:回落默认租户,保证"零 NULL"这条纪律始终成立
db.exec(`
  UPDATE payments SET tenant_id = '${DEFAULT_TENANT_ID}' WHERE tenant_id IS NULL;
  UPDATE booking_slots SET tenant_id = '${DEFAULT_TENANT_ID}' WHERE tenant_id IS NULL;
  UPDATE booking_status_history SET tenant_id = '${DEFAULT_TENANT_ID}' WHERE tenant_id IS NULL;
  UPDATE technician_schedules SET tenant_id = '${DEFAULT_TENANT_ID}' WHERE tenant_id IS NULL;
  UPDATE business_hours SET tenant_id = '${DEFAULT_TENANT_ID}' WHERE tenant_id IS NULL;
  UPDATE store_special_dates SET tenant_id = '${DEFAULT_TENANT_ID}' WHERE tenant_id IS NULL;
  UPDATE booking_drafts SET tenant_id = '${DEFAULT_TENANT_ID}' WHERE tenant_id IS NULL;
`)
// 新写入自动带租户:AFTER INSERT 从父表回填(每次启动重建,保证与代码同版本)
db.exec(`
  DROP TRIGGER IF EXISTS payments_tenant_fill;
  DROP TRIGGER IF EXISTS booking_slots_tenant_fill;
  DROP TRIGGER IF EXISTS booking_status_history_tenant_fill;
  DROP TRIGGER IF EXISTS technician_schedules_tenant_fill;
  DROP TRIGGER IF EXISTS business_hours_tenant_fill;
  DROP TRIGGER IF EXISTS store_special_dates_tenant_fill;
  DROP TRIGGER IF EXISTS booking_drafts_tenant_fill;

  CREATE TRIGGER payments_tenant_fill AFTER INSERT ON payments WHEN NEW.tenant_id IS NULL
  BEGIN UPDATE payments SET tenant_id = COALESCE((SELECT b.tenant_id FROM bookings b WHERE b.id = NEW.booking_id), '${DEFAULT_TENANT_ID}') WHERE rowid = NEW.rowid; END;

  CREATE TRIGGER booking_slots_tenant_fill AFTER INSERT ON booking_slots WHEN NEW.tenant_id IS NULL
  BEGIN UPDATE booking_slots SET tenant_id = COALESCE((SELECT b.tenant_id FROM bookings b WHERE b.id = NEW.booking_id), '${DEFAULT_TENANT_ID}') WHERE rowid = NEW.rowid; END;

  CREATE TRIGGER booking_status_history_tenant_fill AFTER INSERT ON booking_status_history WHEN NEW.tenant_id IS NULL
  BEGIN UPDATE booking_status_history SET tenant_id = COALESCE((SELECT b.tenant_id FROM bookings b WHERE b.id = NEW.booking_id), '${DEFAULT_TENANT_ID}') WHERE rowid = NEW.rowid; END;

  CREATE TRIGGER technician_schedules_tenant_fill AFTER INSERT ON technician_schedules WHEN NEW.tenant_id IS NULL
  BEGIN UPDATE technician_schedules SET tenant_id = COALESCE((SELECT t.tenant_id FROM technicians t WHERE t.id = NEW.technician_id), '${DEFAULT_TENANT_ID}') WHERE technician_id = NEW.technician_id AND date = NEW.date; END;

  CREATE TRIGGER business_hours_tenant_fill AFTER INSERT ON business_hours WHEN NEW.tenant_id IS NULL
  BEGIN UPDATE business_hours SET tenant_id = COALESCE((SELECT s.tenant_id FROM stores s WHERE s.id = NEW.store_id), '${DEFAULT_TENANT_ID}') WHERE store_id = NEW.store_id AND weekday = NEW.weekday; END;

  CREATE TRIGGER store_special_dates_tenant_fill AFTER INSERT ON store_special_dates WHEN NEW.tenant_id IS NULL
  BEGIN UPDATE store_special_dates SET tenant_id = COALESCE((SELECT s.tenant_id FROM stores s WHERE s.id = NEW.store_id), '${DEFAULT_TENANT_ID}') WHERE store_id = NEW.store_id AND date = NEW.date; END;

  CREATE TRIGGER booking_drafts_tenant_fill AFTER INSERT ON booking_drafts WHEN NEW.tenant_id IS NULL
  BEGIN UPDATE booking_drafts SET tenant_id = COALESCE((SELECT s.tenant_id FROM stores s WHERE s.id = NEW.store_id), '${DEFAULT_TENANT_ID}') WHERE rowid = NEW.rowid; END;
`)

// ===== AI 纠偏样本的租户归属(2026-08-07)=====
// ai_response_feedback 一直没有 tenant_id,而 ownerApprovedReplyPrompt 会把「最近 10 条已批准样本」
// 无差别塞进每一家店的提示词——旗舰店训练出来的话术(含 CAD 定价、本店政策)因此串到了所有商家。
// 生产实测:小婕店(CNY)问价被真实模型答成「CAD $368」。加列 + 按租户过滤即可,
// DEFAULT 'lucky-luxe' 让存量行自动归旗舰店(它们本来就都是旗舰店产生的),旗舰店行为一字不变。
for (const sql of [
  "ALTER TABLE ai_response_feedback ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'lucky-luxe'"
]) {
  try {
    db.exec(sql)
  } catch (error) {
    if (!String(error.message || '').includes('duplicate column')) throw error
  }
}
db.exec('CREATE INDEX IF NOT EXISTS idx_ai_response_feedback_tenant ON ai_response_feedback(tenant_id, status, updated_at)')

// ===== P0 多价位价格模型(2026-08-06)=====
// 背景:美业真实门店一个项目有多个价位(原价/分享价/会员价/疗程价),还有「按指计费」「足部加收」等行业规则。
// 纪律:services.price_cents 语义不变 = 原价(tier_key='list'),老小程序的 /services、/stores 字段一个不动;
//       新能力全部走增量列 + 新表 + 新端点。
db.exec(`
  CREATE TABLE IF NOT EXISTS service_categories (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'lucky-luxe',
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_bookable INTEGER NOT NULL DEFAULT 1,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_service_categories_key ON service_categories(tenant_id, key);
  CREATE TABLE IF NOT EXISTS service_prices (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'lucky-luxe',
    service_id TEXT NOT NULL,
    tier_key TEXT NOT NULL,
    price_cents INTEGER NOT NULL DEFAULT 0,
    course_times INTEGER,
    UNIQUE (service_id, tier_key)
  );
  CREATE INDEX IF NOT EXISTS idx_service_prices_tenant ON service_prices(tenant_id, service_id);
  CREATE TABLE IF NOT EXISTS pricing_rules (
    tenant_id TEXT NOT NULL,
    key TEXT NOT NULL,
    config_json TEXT NOT NULL DEFAULT '{}',
    is_active INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT,
    PRIMARY KEY (tenant_id, key)
  );
  CREATE TABLE IF NOT EXISTS recharge_tiers (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT 'lucky-luxe',
    amount_cents INTEGER NOT NULL DEFAULT 0,
    gift_json TEXT NOT NULL DEFAULT '{}',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_recharge_tiers_tenant ON recharge_tiers(tenant_id, sort_order);
`)
for (const sql of [
  "ALTER TABLE services ADD COLUMN item_kind TEXT NOT NULL DEFAULT 'main'",
  'ALTER TABLE services ADD COLUMN category_id TEXT',
  "ALTER TABLE services ADD COLUMN unit TEXT NOT NULL DEFAULT 'once'",
  "ALTER TABLE services ADD COLUMN price_rule TEXT NOT NULL DEFAULT 'fixed'",
  'ALTER TABLE services ADD COLUMN price_rule_value REAL NOT NULL DEFAULT 0',
  "ALTER TABLE services ADD COLUMN addon_scope_json TEXT NOT NULL DEFAULT '[]'",
  // 储值分桶:legacy = 从老平台迁移过来的期初余额(不进本店财务收入),normal = 本系统内真实充值
  "ALTER TABLE stored_value_transactions ADD COLUMN bucket TEXT NOT NULL DEFAULT 'normal'",
  'ALTER TABLE users ADD COLUMN is_migrated INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN legacy_total_spend_cents INTEGER NOT NULL DEFAULT 0'
]) {
  try {
    db.exec(sql)
  } catch (error) {
    if (!String(error.message || '').includes('duplicate column')) throw error
  }
}
// 存量项目的原价回填成 list 档,保证「services.price_cents === service_prices(list)」双写口径从第一天成立
db.exec(`INSERT OR IGNORE INTO service_prices (id, tenant_id, service_id, tier_key, price_cents)
  SELECT 'sp-list-' || id, tenant_id, id, 'list', price_cents FROM services`)

seedDatabase()
// 演示环境:铺一批顾客服务小记,让「有小记/无小记」两态在老板端+员工端都能直接看到
if (process.env.ALLOW_DEMO_ADMIN_LOGIN === 'true') {
  try { seedDemoServiceNotes(DEFAULT_TENANT_ID) } catch (e) { /* 忽略 */ }
}

createServer((req, res) => {
  route(req, res).catch((error) => {
    const status = error.status || 500
    if (status === 500) console.error(error)
    json(res, status, {
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.message || 'Unexpected server error.',
        details: error.details || undefined
      }
    })
  })
}).listen(PORT, process.env.HOST || '127.0.0.1', () => {
  // 本机开发默认只绑 127.0.0.1(安全);云端(Railway 等)设 HOST=0.0.0.0 才对外可达
  console.log(`Lucky Luxe local API running at http://localhost:${PORT}`)
  // 2026-08-07 安全:主钥匙绝不进生产日志(Railway Deploy Logs 会长期留存、可被截图外传)。
  // 生产只报「已配置/未配置」;本地开发保留可用性,但也只打印前 8 位做核对。
  if (IS_PRODUCTION) {
    console.log(`Owner API token: [已配置,不在日志中显示](长度 ${OWNER_TOKEN.length})`)
  } else {
    console.log(`Owner API token: ${OWNER_TOKEN.slice(0, 8)}…(本地开发,完整值见 apps/api/.env 的 OWNER_DEMO_TOKEN)`)
  }
})

// ===== 生产环境每日自动备份(BACKUP_ENABLED=true 时开启;快照存进同一持久化卷,保留 30 天) =====
if (process.env.BACKUP_ENABLED === 'true') {
  const backupDir = join(dataDir, 'backups')
  const runBackup = () => {
    try {
      mkdirSync(backupDir, { recursive: true })
      const stamp = localParts(new Date()).date
      const dest = join(backupDir, `lucky-luxe-${stamp}.sqlite`)
      if (!existsSync(dest)) {
        copyFileSync(join(dataDir, 'lucky-luxe.sqlite'), dest)
        console.log(`[backup] 已生成快照 ${stamp}`)
      }
      const keepAfter = new Date(Date.now() - 30 * 86400000)
      for (const file of readdirSync(backupDir)) {
        const match = file.match(/^lucky-luxe-(\d{4}-\d{2}-\d{2})\.sqlite$/)
        if (match && new Date(`${match[1]}T12:00:00`) < keepAfter) {
          unlinkSync(join(backupDir, file))
          console.log(`[backup] 已清理过期快照 ${file}`)
        }
      }
    } catch (error) {
      console.error('[backup] 备份失败:', error.message)
    }
  }
  runBackup()
  setInterval(runBackup, 6 * 3600 * 1000)
}
