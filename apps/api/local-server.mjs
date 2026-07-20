import { createServer } from 'node:http'
import { AsyncLocalStorage } from 'node:async_hooks'
import { DatabaseSync } from 'node:sqlite'
import { createDecipheriv, createHash, createHmac } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeReferenceImage, createBookingSummary, createCustomerInsight, createCustomerServiceReply, createDailyBrief, createSocialCopy, extractKbEntriesFromDocument, polishStaffQuoteReply } from './ai-utils.mjs'
import { buildKnowledgeContext } from './kb-utils.mjs'

process.env.TZ = process.env.APP_TIMEZONE || 'America/Toronto'

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
const OWNER_TOKEN = process.env.OWNER_DEMO_TOKEN || 'owner-demo-token'
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

function liveTenantFacts() {
  const facts = tenantKbFacts(currentTenantId())
  return {
    defaultHours: {
      zh: businessHoursText(null, 'zh'),
      en: businessHoursText(null, 'en')
    },
    ...(facts.brandName ? { brandName: facts.brandName } : {}),
    ...(facts.assistantName ? { assistantName: facts.assistantName } : {}),
    ...(facts.storeAddress ? { storeAddress: facts.storeAddress } : {}),
    ...(facts.depositAmount ? { depositAmount: Number(facts.depositAmount) || facts.depositAmount } : {}),
    ...(facts.currency ? { currency: facts.currency } : {})
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
  planStmt.run('solo', '个人美甲师版', 'Solo Artist', JSON.stringify(['booking', 'crm', 'gallery']), JSON.stringify({ maxStores: 1, maxStaff: 1, aiMessagesPerMonth: 0 }), 1)
  planStmt.run('studio', '小型工作室版', 'Studio', JSON.stringify(['booking', 'crm', 'gallery', 'staff_schedule']), JSON.stringify({ maxStores: 1, maxStaff: 8, aiMessagesPerMonth: 0 }), 2)
  planStmt.run('chain', '连锁门店版', 'Chain', JSON.stringify(['booking', 'crm', 'gallery', 'staff_schedule', 'multi_store', 'reports', 'ai_customer_service']), JSON.stringify({ maxStores: 10, maxStaff: 50, aiMessagesPerMonth: 100000 }), 3)
  planStmt.run('custom', '定制企业版', 'Custom Enterprise', JSON.stringify(['booking', 'crm', 'gallery', 'staff_schedule', 'multi_store', 'reports', 'ai_customer_service', 'white_label']), JSON.stringify({ maxStores: 999, maxStaff: 999, aiMessagesPerMonth: 1000000 }), 4)
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
  if (auth === `Bearer ${OWNER_TOKEN}`) return { role: 'owner', provider: 'demo-token', technicianId: null, tenantId: DEFAULT_TENANT_ID }
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
      (id, provider, external_user_id, open_kfid, source_channel, status, last_intent, last_message, ai_reply_json, transcript_json, raw_event_json, created_at, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  return getWecomConversation(conversationId)
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
    VALUES (?, 'lucky-luxe', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

function getAiResponseFeedback({ limit = 40, status = 'approved' } = {}) {
  return db.prepare(`
    SELECT * FROM ai_response_feedback
    WHERE (? = '' OR status = ?)
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(status || '', status || '', Number(limit) || 40).map(serializeAiResponseFeedback)
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
      (id, conversation_id, message_index, customer_message, original_reply, corrected_reply, notes, lang, source_channel, intent, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
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
    adminSession?.email || '',
    now,
    now
  )
  const learningId = randomId('learn')
  db.prepare(`
    INSERT INTO ai_learning_examples
      (id, tenant_id, conversation_id, feedback_id, source, customer_message, original_reply, corrected_reply, context_json, tags_json, status, created_at, updated_at)
    VALUES (?, 'lucky-luxe', ?, ?, 'owner_feedback', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    learningId,
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
    VALUES (?, 'lucky-luxe', ?, NULL, 'workflow_logic_gap', ?, '', ?, ?, ?, 'approved', ?, ?)
  `).run(
    id,
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
      (id, provider, external_user_id, open_kfid, source_channel, status, last_intent, last_message, ai_reply_json, transcript_json, raw_event_json, created_at, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  return lang === 'en'
    ? 'Hello, welcome to Lucky Luxe. I am your booking assistant. You can ask me about nail/lash services, pricing rules, available times, deposits, and aftercare. For complex nail styles, you can also send a reference photo and I will help organize the details first.'
    : '您好欢迎来到 Lucky Luxe，我是您的预约助手。您可以咨询美甲/美睫服务、价格规则、预约时间、定金和护理说明；如果是复杂美甲款式，也可以先发参考图，我会先帮您整理需求。'
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
      return amount ? `${label} CAD $${amount}` : ''
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
    tenantDocuments: tenantKbDocumentsForPrompt(currentTenantId())
  }), inbound.lang || 'zh')
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
      (id, conversation_id, message_index, customer_message, original_reply, corrected_reply, notes, lang, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?)
  `).run(
    feedbackId,
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
    VALUES (?, 'lucky-luxe', ?, ?, 'manual_staff_reply', ?, ?, ?, ?, ?, 'approved', ?, ?)
  `).run(
    randomId('learn'),
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

function appendManualWecomReply(conversationId, body = {}, adminSession = {}) {
  const message = String(body.message || body.content || '').trim()
  if (!message) throw apiError(400, 'MESSAGE_REQUIRED', 'Manual reply message is required.')
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
  return { conversation: getWecomConversation(conversationId) }
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

function formatCadFromCents(value) {
  const centsValue = Number(value || 0)
  if (!Number.isFinite(centsValue) || centsValue <= 0) return ''
  const amount = centsValue / 100
  return Number.isInteger(amount) ? `CAD $${amount}` : `CAD $${amount.toFixed(2)}`
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

function firstActiveStoreId() {
  return db.prepare('SELECT id FROM stores WHERE is_active = 1 ORDER BY name ASC LIMIT 1').get()?.id || 'store-ontario-01'
}

function firstActiveService(serviceType = 'nail') {
  const type = String(serviceType || 'nail').toUpperCase()
  return db.prepare('SELECT * FROM services WHERE is_active = 1 AND type = ? ORDER BY sort_order ASC LIMIT 1').get(type)
    || db.prepare('SELECT * FROM services WHERE is_active = 1 ORDER BY sort_order ASC LIMIT 1').get()
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
  const polished = await polishStaffQuoteReply({
    lang: quoteSnapshot.customerLang || 'zh',
    quote: quoteSnapshot,
    staffMessage
  })
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
      : 'Silver Member pays CAD $50 deposit for each booking.'
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
    points: Math.floor(totalSpentCents / 100),
    couponCount: 0,
    balanceCents: storedValueBalanceCents(user.id, tenantId),
    totalSpentCents,
    visits: Number(stats.visits || 0),
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
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND wechat_open_id = ?').get(data.sub, data.openid)
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
  if (!/^\d{2}:\d{2}$/.test(body.time)) throw apiError(400, 'BAD_REQUEST', 'time must be HH:mm.')
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
    bookingDraftId: body.bookingDraftId || body.draftId || null
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
  // 特殊日期优先于每周固定模式(节假日休息/调整时段)
  const special = specialDateFor(input.storeId, input.date)
  const closedThatDay = special ? Boolean(special.is_closed) : (!hours || Boolean(hours.is_closed))
  if (closedThatDay) throw apiError(400, 'BAD_REQUEST', 'Store is closed on this date.')
  const schedule = db.prepare('SELECT * FROM technician_schedules WHERE technician_id = ? AND date = ?').get(input.technicianId, input.date)
  if (schedule && !schedule.is_working) throw apiError(400, 'BAD_REQUEST', 'Technician is not working on this date.')

  const baseOpen = (special && !special.is_closed && special.open_time) || hours?.open_time || '10:00'
  const baseClose = (special && !special.is_closed && special.close_time) || hours?.close_time || '19:00'
  const openTime = schedule?.start_time || baseOpen
  const closeTime = schedule?.end_time || baseClose
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

function createBooking(body) {
  expireOldHolds()
  const input = validateBookingInput(body)
  const { service, durationMin, start, end } = assertBookable(input)
  const bookingId = randomId('booking')
  const now = iso(new Date())
  const slots = buildSlotStarts(start, durationMin)
  const addOnTotal = input.addOns.reduce((total, item) => total + Number(item.priceCents || 0), 0)
  const servicePriceCents = service.price_cents + addOnTotal
  const user = input.userId ? db.prepare('SELECT * FROM users WHERE id = ?').get(input.userId) : null
  const serializedUser = serializeUser(user, input.tenantId || DEFAULT_TENANT_ID)
  const depositRequiredCents = 5000
  const depositWaivedCents = serializedUser?.depositWaived ? depositRequiredCents : 0
  const depositCents = Math.max(0, depositRequiredCents - depositWaivedCents)
  const status = depositCents > 0 ? 'PENDING_PAYMENT' : 'CONFIRMED'
  const paymentExpiresAt = depositCents > 0 ? iso(addMinutes(new Date(), HOLD_MINUTES)) : null
  const waiveReason = depositWaivedCents > 0 ? `${serializedUser.memberLevel} member deposit waived` : null

  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(`
      INSERT INTO bookings
      (id, tenant_id, public_code, user_id, store_id, technician_id, service_id, status, appointment_start, appointment_end, addons_json, reference_images_json, source_channel, notes, service_price_cents, deposit_cents, deposit_required_cents, deposit_waived_cents, deposit_waive_reason, member_level_at_booking, final_due_cents, total_duration_min, payment_expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(bookingId, input.tenantId || DEFAULT_TENANT_ID, publicCode(), input.userId, input.storeId, input.technicianId, input.serviceId, status, iso(start), iso(end), JSON.stringify(input.addOns), JSON.stringify(input.referenceImages), input.sourceChannel, input.notes, servicePriceCents, depositCents, depositRequiredCents, depositWaivedCents, waiveReason, serializedUser?.memberLevel || null, servicePriceCents - depositCents, durationMin, paymentExpiresAt, now, now)

    const slotStmt = db.prepare('INSERT INTO booking_slots (id, booking_id, technician_id, starts_at) VALUES (?, ?, ?, ?)')
    for (const slot of slots) slotStmt.run(randomId('slot'), bookingId, input.technicianId, iso(slot))

    db.prepare('INSERT INTO payments (id, booking_id, provider, status, amount_cents, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(randomId('pay'), bookingId, 'MOCK', depositCents > 0 ? 'REQUIRES_PAYMENT' : 'PAID', depositCents, 'CAD', now, now)
    db.prepare('INSERT INTO booking_status_history (id, booking_id, to_status, note, created_at) VALUES (?, ?, ?, ?, ?)').run(randomId('hist'), bookingId, status, depositCents > 0 ? 'Booking hold created pending deposit payment.' : 'Booking confirmed with member deposit waiver.', now)
    if (input.bookingDraftId) {
      db.prepare("UPDATE booking_drafts SET status = 'BOOKING_CREATED', booking_id = ?, updated_at = ? WHERE id = ?")
        .run(bookingId, now, input.bookingDraftId)
      db.prepare("UPDATE quote_requests SET draft_booking_id = ?, updated_at = ? WHERE id IN (SELECT quote_request_id FROM booking_drafts WHERE id = ?)")
        .run(bookingId, now, input.bookingDraftId)
    }
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
      COALESCE(SUM(CASE WHEN b.status = 'COMPLETED' THEN b.service_price_cents ELSE 0 END), 0) AS total_spent_cents
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
  return { customer, bookings, services, stores }
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
  return `CAD $${((cents || 0) / 100).toFixed(2)}`
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
    const settled = db.prepare("SELECT id FROM finance_transactions WHERE tags = ? AND reversal_of IS NULL AND NOT EXISTS (SELECT 1 FROM finance_transactions r WHERE r.reversal_of = finance_transactions.id)").get(marker)
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

function insertStoredValueTransaction({ userId, type, amountCents, payChannel = 'unknown', note = '', createdBy = 'system', createdAt = null, tenantId = currentTenantId() }) {
  const id = randomId('sv')
  const signed = type === 'recharge' ? Math.abs(amountCents) : (type === 'consume' ? -Math.abs(amountCents) : Math.round(amountCents))
  db.prepare(`
    INSERT INTO stored_value_transactions (id, tenant_id, user_id, type, amount_cents, pay_channel, note, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, tenantId, userId, type, signed, payChannel, note, createdBy, createdAt || iso(new Date()))
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
  if (req.method === 'GET' && path === '/platform') return serveFile(res, webRoot, 'platform.html')
  if (req.method === 'GET' && path === '/wechat-simulator') return serveFile(res, webRoot, 'wechat-simulator.html')
  if (req.method === 'GET' && path === '/share') return serveFile(res, webRoot, 'share.html')
  if (req.method === 'GET' && path.startsWith('/web/')) return serveFile(res, webRoot, path.replace('/web/', ''))
  if (req.method === 'GET' && path.startsWith('/assets/')) return serveFile(res, assetRoot, path.replace('/assets/', ''))

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
  // 员工账号管理(老板):列表/生成/重置密码/停用启用
  if (req.method === 'GET' && path === '/admin/staff-accounts') {
    const admin = requireAdmin(req)
    if (admin.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
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
  if (req.method === 'GET' && path === '/admin/auth/me') return json(res, 200, { admin: requireAdmin(req) })
  if (req.method === 'GET' && path.startsWith('/users/')) {
    // 隐私:必须登录,且只能查自己的资料(此前任意 id 可读,已修)
    const customer = requireCustomer(req)
    const id = path.split('/')[2]
    if (id !== customer.id) throw apiError(403, 'FORBIDDEN', 'You can only view your own profile.')
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
    if (!user) throw apiError(404, 'NOT_FOUND', 'User not found.')
    return json(res, 200, { user: serializeUser(user, resolveTenant(req, query)) })
  }
  if (req.method === 'GET' && path === '/stores') return json(res, 200, { stores: db.prepare('SELECT * FROM stores WHERE is_active = 1 AND tenant_id = ?').all(resolveTenant(req, query)) })
  if (req.method === 'GET' && path === '/services') {
    const args = [resolveTenant(req, query)]
    let sql = 'SELECT * FROM services WHERE is_active = 1 AND tenant_id = ?'
    if (query.type) {
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
    const rows = db.prepare(`
      SELECT b.*, t.name AS tech_name, t.title AS tech_title
      FROM bookings b
      JOIN technicians t ON t.id = b.technician_id
      WHERE b.gallery_status = 'approved' AND b.tenant_id = ?
      ORDER BY b.gallery_locked_at DESC, b.appointment_start DESC
    `).all(resolveTenant(req, query))
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
    const rows = db.prepare(`
      SELECT t.id, t.name AS tenant_name, s.name AS store_name, s.address, s.phone
      FROM tenants t
      JOIN stores s ON s.tenant_id = t.id AND s.is_active = 1
      WHERE t.status = 'active'
      GROUP BY t.id
      ORDER BY t.name ASC
    `).all()
    return json(res, 200, { shops: rows.map((r) => ({ tenantId: r.id, name: r.tenant_name || r.store_name, storeName: r.store_name, address: r.address || '', phone: r.phone || '' })) })
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
  if (req.method === 'POST' && path === '/ai/customer-service') {
    // 多租户:AI 客服按"顾客当前进的店"取知识/服务/事实回答
    tenantContext.enterWith({ tenantId: resolveTenant(req, query) })
    if (!checkEntitlement(currentTenantId(), 'ai_customer_service')) {
      return json(res, 200, {
        reply: {
          data: {
            intent: 'entitlement_disabled',
            answerZh: '当前时段由人工客服为您服务，请稍等片刻，我们会尽快回复您。',
            answerEn: 'A team member will assist you shortly. Thank you for your patience.',
            handoffRequired: true
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
    return json(res, 200, { feedback: getAiResponseFeedback({ limit: Number(query.limit || 40), status: query.status || 'approved' }) })
  }
  if (req.method === 'POST' && path === '/admin/ai/customer-service/feedback') {
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
    return json(res, 201, appendManualWecomReply(decodeURIComponent(manualReplyMatch[1]), await readBody(req), adminSession))
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
    const bookings = adminSession.role === 'staff'
      ? db.prepare('SELECT * FROM bookings WHERE tenant_id = ? AND technician_id = ? ORDER BY appointment_start DESC LIMIT 60').all(currentTenantId(), adminSession.technicianId).map((booking) => serializeBooking(booking))
      : db.prepare('SELECT * FROM bookings WHERE tenant_id = ? ORDER BY appointment_start DESC LIMIT 60').all(currentTenantId()).map((booking) => serializeBooking(booking))
    const services = db.prepare('SELECT * FROM services WHERE tenant_id = ? ORDER BY type ASC, sort_order ASC').all(currentTenantId()).map(serializeService)
    return json(res, 200, { brief: await createDailyBrief({ ...(await readBody(req)), bookings, customers: adminSession.role === 'owner' ? getAdminCustomers() : [], services }) })
  }
  if (req.method === 'POST' && path === '/admin/ai/booking-summary') {
    const body = await readBody(req)
    const row = db.prepare('SELECT * FROM bookings WHERE id = ?').get(body.bookingId)
    if (!row) throw apiError(404, 'NOT_FOUND', 'Booking not found.')
    assertStaffCanAccessBooking(adminSession, row)
    return json(res, 200, { summary: await createBookingSummary({ lang: body.lang || 'zh', booking: serializeBooking(row, body.lang || 'zh') }) })
  }
  if (req.method === 'POST' && path === '/admin/ai/customer-insight') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const body = await readBody(req)
    const customer = getAdminCustomers().find((item) => item.id === body.customerId)
    if (!customer) throw apiError(404, 'NOT_FOUND', 'Customer not found.')
    const bookings = db.prepare('SELECT * FROM bookings WHERE user_id = ? ORDER BY appointment_start DESC LIMIT 12').all(customer.id).map((booking) => serializeBooking(booking, body.lang || 'zh'))
    return json(res, 200, { insight: await createCustomerInsight({ lang: body.lang || 'zh', customer, bookings }) })
  }
  if (req.method === 'POST' && path === '/admin/ai/social-copy') {
    const body = await readBody(req)
    const row = body.bookingId ? db.prepare('SELECT * FROM bookings WHERE id = ?').get(body.bookingId) : null
    if (row) assertStaffCanAccessBooking(adminSession, row)
    const booking = row ? serializeBooking(row, body.lang || 'zh') : body.booking
    return json(res, 200, { copy: await createSocialCopy({ lang: body.lang || 'zh', image: body.image || '', booking, platform: body.platform || 'xiaohongshu', audience: body.audience || 'staff', avoidCaptions: body.avoidCaptions || [], variantSeed: body.variantSeed || '' }) })
  }
  if (req.method === 'GET' && path === '/admin/services') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    return json(res, 200, { services: db.prepare('SELECT * FROM services WHERE tenant_id = ? ORDER BY type ASC, sort_order ASC').all(currentTenantId()).map(serializeService) })
  }
  if (req.method === 'POST' && path === '/admin/services') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const payload = servicePayload(await readBody(req))
    if (!['NAIL', 'LASH'].includes(payload.type)) throw apiError(400, 'BAD_REQUEST', 'Service type must be NAIL or LASH.')
    if (!payload.nameZh || !payload.nameEn) throw apiError(400, 'BAD_REQUEST', 'Service name is required.')
    const id = serviceIdFrom(payload)
    db.prepare(`INSERT INTO services
      (id, tenant_id, type, category, name_zh, name_en, description_zh, description_en, image_url, price_cents, deposit_cents, base_duration_min, sort_order, is_active, process_json, notice_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, currentTenantId(), payload.type, payload.category, payload.nameZh, payload.nameEn, payload.descriptionZh, payload.descriptionEn, payload.imageUrl, payload.priceCents, payload.depositCents, payload.baseDurationMin, payload.sortOrder, payload.isActive, JSON.stringify(payload.processJson), JSON.stringify(payload.noticeJson))
    const assign = db.prepare('INSERT OR IGNORE INTO technician_services (technician_id, service_id) VALUES (?, ?)')
    for (const tech of db.prepare('SELECT id FROM technicians WHERE is_active = 1 AND tenant_id = ?').all(currentTenantId())) assign.run(tech.id, id)
    return json(res, 201, { service: serializeService(getService(id)) })
  }
  if (req.method === 'GET' && path === '/admin/technicians') {
    const technicians = adminSession.role === 'staff'
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
    return json(res, 200, { service: serializeService(getService(id)) })
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
    const expiresAt = iso(new Date(Date.now() + (coupon.valid_days || 30) * 86400000))
    db.prepare(`INSERT INTO coupon_grants (id, tenant_id, coupon_id, user_id, code, status, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`).run(randomId('grant'), currentTenantId(), couponId, user.id, code, expiresAt, iso(new Date()))
    db.prepare('UPDATE coupons SET issued_qty = issued_qty + 1 WHERE id = ?').run(couponId)
    return json(res, 201, { grant: { code, couponName: coupon.name, userName: user.display_name, expiresAt } })
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
    const plan = ['solo', 'studio', 'chain'].includes(body.plan) ? body.plan : 'studio'
    db.prepare("INSERT INTO tenants (id, name, plan, status) VALUES (?, ?, ?, 'active')").run(id, name.slice(0, 60), plan)
    db.prepare('INSERT INTO stores (id, name, address, phone, timezone, currency, is_active, tenant_id) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
      .run(`store-${id}`, name.slice(0, 60), String(body.city || '').slice(0, 80), String(body.phone || '').slice(0, 30), 'America/Toronto', 'CAD', id)
    // 老板账号:username 唯一,默认 boss-<id>
    let username = String(body.username || `boss-${id}`).trim().toLowerCase().replace(/[^a-z0-9-]/g, '') || `boss-${id}`
    let suffix = 1
    while (db.prepare('SELECT id FROM admin_accounts WHERE LOWER(username) = ?').get(username)) { suffix += 1; username = `boss-${id}${suffix}` }
    const initialPassword = randomPassword()
    db.prepare(`INSERT INTO admin_accounts (id, tenant_id, username, display_name, role, technician_id, password_hash, must_change_password, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'owner', NULL, ?, 1, 'active', ?, ?)`)
      .run(randomId('acct'), id, username, `${name} Owner`, adminPasswordHash(username, initialPassword), iso(new Date()), iso(new Date()))
    return json(res, 201, {
      tenant: { id, name, plan, status: 'active' },
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
      if (req.method === 'GET') return json(res, 200, { store: store ? { id: store.id, name: store.name, address: store.address || '', phone: store.phone || '' } : null })
      if (req.method === 'PUT') {
        if (!store) throw apiError(404, 'NOT_FOUND', 'Store not found for tenant.')
        const body = await readBody(req)
        const name = String(body.name ?? store.name).trim() || store.name
        const address = String(body.address ?? store.address ?? '').trim()
        const phone = String(body.phone ?? store.phone ?? '').trim()
        db.prepare('UPDATE stores SET name = ?, address = ?, phone = ? WHERE id = ?').run(name, address, phone, store.id)
        // 同步进该租户 AI 知识事实(与商家端同规则,AI 回答与系统一致)
        const factStmt = db.prepare(`INSERT INTO tenant_kb_facts (tenant_id, key, value, updated_by, updated_at) VALUES (?, ?, ?, 'platform', ?)
          ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_by = 'platform', updated_at = excluded.updated_at`)
        if (address) factStmt.run(tenantId, 'storeAddress', address, iso(new Date()))
        if (phone) factStmt.run(tenantId, 'storePhone', phone, iso(new Date()))
        return json(res, 200, { store: { id: store.id, name, address, phone } })
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
        if (!['NAIL', 'LASH'].includes(payload.type)) throw apiError(400, 'BAD_REQUEST', 'type must be NAIL or LASH.')
        if (!payload.nameZh) throw apiError(400, 'BAD_REQUEST', '服务中文名必填。')
        if (!payload.nameEn) payload.nameEn = payload.nameZh
        const id = serviceIdFrom(payload)
        db.prepare(`INSERT INTO services (id, tenant_id, type, category, name_zh, name_en, description_zh, description_en, image_url, price_cents, deposit_cents, base_duration_min, sort_order, is_active, process_json, notice_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, tenantId, payload.type, payload.category, payload.nameZh, payload.nameEn, payload.descriptionZh, payload.descriptionEn, payload.imageUrl, payload.priceCents, payload.depositCents, payload.baseDurationMin, payload.sortOrder, payload.isActive, JSON.stringify(payload.processJson), JSON.stringify(payload.noticeJson))
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
    const rows = db.prepare(`
      SELECT b.id, b.appointment_start, b.approved_work_images_json, b.service_id, b.technician_id, t.name AS tech_name
      FROM bookings b LEFT JOIN technicians t ON t.id = b.technician_id
      WHERE b.gallery_status = 'approved' AND b.tenant_id = ?
      ORDER BY b.gallery_locked_at DESC, b.appointment_start DESC
    `).all(currentTenantId())
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
    const schedules = db.prepare(`SELECT technician_id, date, start_time, end_time, is_working FROM technician_schedules WHERE date IN (${dates.map(() => '?').join(',')})`)
      .all(...dates)
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
    insertStoredValueTransaction({
      userId,
      type: isRecharge ? 'recharge' : 'consume',
      amountCents,
      payChannel: isRecharge ? String(body.payChannel || 'unknown') : 'stored_value',
      note: String(body.note || ''),
      createdBy: adminSession.email || 'owner'
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
    const technicians = db.prepare('SELECT id, name FROM technicians WHERE is_active = 1 ORDER BY name ASC').all()
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
    // 2) 自由文本：尝试 AI 拆条（需真实模型），拆不出则整篇存为知识文档供 AI 参考
    const aiExtracted = await extractKbEntriesFromDocument({ content, filename }).catch(() => null)
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
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
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
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
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
  if (req.method === 'GET' && path === '/admin/business-hours') {
    const stores = db.prepare('SELECT id, name, address, phone FROM stores WHERE is_active = 1 AND tenant_id = ? ORDER BY name ASC').all(currentTenantId())
    return json(res, 200, {
      stores: stores.map((store) => ({
        id: store.id,
        name: store.name,
        address: store.address,
        phone: store.phone,
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
db.exec('DROP TRIGGER IF EXISTS finance_txn_no_update; DROP TRIGGER IF EXISTS finance_txn_no_delete;')
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
// 数据库层强制只追加:任何 UPDATE/DELETE 直接拒绝,纠错只能走红字冲销/调整分录
db.exec(`
  CREATE TRIGGER finance_txn_no_update BEFORE UPDATE ON finance_transactions
  BEGIN SELECT RAISE(ABORT, 'finance ledger is append-only'); END;
  CREATE TRIGGER finance_txn_no_delete BEFORE DELETE ON finance_transactions
  BEGIN SELECT RAISE(ABORT, 'finance ledger is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS stored_value_no_update BEFORE UPDATE ON stored_value_transactions
  BEGIN SELECT RAISE(ABORT, 'stored value ledger is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS stored_value_no_delete BEFORE DELETE ON stored_value_transactions
  BEGIN SELECT RAISE(ABORT, 'stored value ledger is append-only'); END;
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
seedDatabase()

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
  console.log(`Owner API token: ${OWNER_TOKEN}`)
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
