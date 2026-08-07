import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PHASE1_KB_PATH = join(__dirname, 'data', 'ai-customer-service', 'phase1-kb.seed.json')

let cachedKnowledgeBase = null

const INTENT_KEYWORDS = {
  pricing: ['价', '价格', '报价', '多少钱', '费用', 'price', 'quote', 'cost', 'how much'],
  deposit: ['定金', 'deposit', '押金', '预付', '免定金', 'waive'],
  booking: ['预约', '下单', '时间', '日期', '技师', 'booking', 'appointment', 'slot', 'schedule'],
  policy: ['取消', '改期', '退款', '迟到', '售后', 'cancel', 'reschedule', 'refund', 'late', 'complaint'],
  order: ['订单', '记录', '预约记录', 'order', 'my booking', 'record'],
  store: ['地址', '电话', '营业', '门店', 'where', 'address', 'hour', 'phone', 'store'],
  lash_intake: ['美睫', '睫毛', '下睫毛', '眼睛', 'lash', 'lashes', 'lower lash', 'eye'],
  nail_quote: ['美甲', '款式', '参考图', '延长', '卸甲', '断甲', '手绘', 'nail', 'reference', 'extension', 'removal', 'design'],
  after_sales: ['售后', '返修', '补修', '开胶', '起翘', '翘边', '掉甲', '掉钻', '掉色', '色差', '不满意', '掉睫', '红肿', '过敏', '刺痛', 'after-sales', 'repair', 'lifting', 'fallout', 'discomfort'],
  privacy: ['照片', '图片', '删除', '隐私', 'photo', 'image', 'delete', 'privacy']
}

function compactText(value = '', max = 420) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value || '')
  }
}

export function loadCustomerServiceKnowledgeBase() {
  if (!cachedKnowledgeBase) {
    cachedKnowledgeBase = JSON.parse(readFileSync(PHASE1_KB_PATH, 'utf8'))
  }
  return cachedKnowledgeBase
}

export function inferCustomerServiceIntents(message = '') {
  const text = String(message || '').toLowerCase()
  const intents = Object.entries(INTENT_KEYWORDS)
    .filter(([, keywords]) => keywords.some((keyword) => text.includes(keyword.toLowerCase())))
    .map(([intent]) => intent)
  // Nail quote intake is not always pricing. A customer can ask "can you do this"
  // or send a reference image before asking price, so pricing must stay explicit.
  if (intents.includes('lash_intake') && !intents.includes('pricing') && /价|price|quote|cost|多少钱/.test(text)) intents.unshift('pricing')
  return [...new Set(intents.length ? intents : ['unknown'])]
}

function scoreKnowledgeItem(item, message, intents) {
  const haystack = `${item.id || ''} ${item.intent || ''} ${safeJson(item)}`.toLowerCase()
  if (haystack.includes('nail') && !intents.includes('nail_quote') && !intents.includes('after_sales')) return 0
  if (haystack.includes('lash') && !intents.includes('lash_intake') && !intents.includes('after_sales')) return 0
  let score = 0
  if (item.intent && intents.includes(item.intent)) score += 8
  if (item.id?.includes('deposit') && intents.includes('deposit')) score += 7
  if (item.id?.includes('quote.nail') && intents.includes('nail_quote')) score += 7
  if (item.id?.includes('quote.lash') && intents.includes('lash_intake')) score += 7
  if (item.id?.includes('lash') && intents.includes('lash_intake')) score += 7
  if (item.id?.includes('after_sales') && intents.includes('after_sales')) score += 8
  if (item.id?.includes('policy') && intents.includes('policy')) score += 7
  for (const intent of intents) {
    for (const keyword of INTENT_KEYWORDS[intent] || []) {
      if (message.toLowerCase().includes(keyword.toLowerCase()) && haystack.includes(keyword.toLowerCase())) score += 2
    }
  }
  return score
}

// 种子条目自带 scope 标记(platform=平台通用 / tenant=旗舰店私有),但原先没人读它,
// 结果旗舰店的定金金额、会员等级等私有规则被发给了所有租户。非旗舰租户只保留 platform 层。
function seedScopeFilter(allowSeedTenantLayer) {
  return (item) => allowSeedTenantLayer || item.scope !== 'tenant'
}

function selectRules(kb, message, intents, allowSeedTenantLayer = false) {
  const rules = (kb.businessRules || []).filter(seedScopeFilter(allowSeedTenantLayer))
  const alwaysRelevantIds = ['booking.one_service']
  const scored = rules
    .map((rule) => ({
      ...rule,
      score: alwaysRelevantIds.includes(rule.id) ? 2 : scoreKnowledgeItem(rule, message, intents)
    }))
    .filter((rule) => rule.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
  return scored.map(({ score, ...rule }) => rule)
}

function selectQaEntries(kb, message, intents, allowSeedTenantLayer = false) {
  const entries = (kb.qaEntries || []).filter(seedScopeFilter(allowSeedTenantLayer))
  return entries
    .map((entry) => ({ ...entry, score: scoreKnowledgeItem(entry, message, intents) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ score, ...entry }) => entry)
}

function selectHandoffRules(kb, message, intents, matchedQa) {
  const requiredTypes = new Set(matchedQa.map((entry) => entry.handoffType).filter(Boolean))
  const lowerMessage = message.toLowerCase()
  return (kb.handoffRules || [])
    .map((rule) => {
      let score = requiredTypes.has(rule.type) ? 8 : 0
      for (const trigger of rule.triggers || []) {
      if (lowerMessage.includes(String(trigger).toLowerCase())) score += 5
      }
      if (rule.type === 'technician' && (intents.includes('pricing') || intents.includes('nail_quote') || intents.includes('lash_intake'))) score += 3
      if (rule.type === 'frontdesk' && (intents.includes('policy') || intents.includes('booking'))) score += 2
      if (rule.type === 'frontdesk' && intents.includes('after_sales')) score += 4
      if (rule.type === 'owner' && intents.includes('after_sales') && /红肿|过敏|刺痛|不舒服|complaint|allergy|pain|discomfort/i.test(lowerMessage)) score += 4
      if (rule.type === 'owner' && (intents.includes('privacy') || intents.includes('policy'))) score += 2
      return { ...rule, score }
    })
    .filter((rule) => rule.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ score, ...rule }) => rule)
}

// 静态种子里的 tenantPrivate 是旗舰店口径。非旗舰租户只认自己库里的实时值,
// 宁可这一项留空(AI 会说"需要确认"),也不能把别家门店的价格/地区/会员方案念出去。
function mergeTenantFacts(tenant, live) {
  const seed = live.allowSeedFallback ? tenant : {}
  return {
    brandName: live.brandName || seed.brandName,
    assistantName: live.assistantName || seed.assistantName,
    currency: live.currency || seed.currency,
    region: live.region || seed.region,
    storeAddress: live.storeAddress || seed.storeAddress,
    storePhone: live.storePhone || undefined,
    defaultHours: live.defaultHours || seed.defaultHours,
    depositAmount: live.depositAmount ?? seed.depositAmount,
    memberLevels: live.memberLevels || seed.memberLevels,
    priceList: live.priceList || seed.priceList,
    // 2026-08-08:这个白名单是「哪些事实进提示词」的闸门。P0 加的加项目录/计价规则、
    // P1.2 加的定金政策此前都被它悄悄挡在外面 —— 生产实测里 AI 因此把小婕店的定金答成 0。
    addonList: live.addonList || undefined,
    pricingRules: live.pricingRules || undefined,
    depositPolicy: live.depositPolicy || undefined,
    technicians: live.technicians || undefined
  }
}

function buildPromptText({ kb, intents, matchedRules, matchedQa, matchedHandoffRules, context }) {
  const tenant = kb.layers?.tenantPrivate || {}
  const platform = kb.layers?.platformPreset || {}
  const live = context.liveTenantFacts || {}
  const platformNoteZh = '平台预置知识只包含通用美业流程、话术模板和转人工边界；具体会员等级、定金减免、价格、门店与技师规则必须以当前租户私有知识为准。结构化实时设置（如营业时间）优先级高于任何静态知识文本。'
  const platformNoteEn = 'Platform preset knowledge only covers generic beauty workflows, tone templates, and handoff boundaries; exact member tiers, deposit waivers, pricing, stores, and staff rules must come from current tenant-private knowledge. Structured live settings (such as business hours) always override static knowledge text.'
  const base = {
    version: kb.version,
    platformScope: platform.description,
    // 2026-08-07:此前恒等于种子里的 'luckyluxe',等于告诉每一家店的模型「你是旗舰店」
    tenantId: live.tenantId || kb.tenantId,
    tenantFacts: mergeTenantFacts(tenant, live),
    platformBoundaryZh: platformNoteZh,
    platformBoundaryEn: platformNoteEn,
    tenantDocuments: Array.isArray(context.tenantDocuments) && context.tenantDocuments.length
      ? context.tenantDocuments
      : undefined,
    currentContext: {
      intents,
      customerStage: context.customerStage || '',
      sourceChannel: context.sourceChannel || '',
      referenceImageCount: context.referenceImages?.length || 0
    },
    matchedRules,
    matchedQa,
    matchedHandoffRules
  }
  return {
    zh: [
      '请严格参考以下客服知识库上下文作答。',
      platformNoteZh,
      safeJson(base)
    ].join('\n'),
    en: [
      'Use the following customer-service knowledge context strictly.',
      platformNoteEn,
      safeJson(base)
    ].join('\n')
  }
}

// 平台通用层(上层)以数据库为准:平台后台改完立即生效;表为空时自动回落到静态种子。
// 只替换 scope==='platform' 的条目,种子里 scope==='tenant' 的(旗舰店私有)原样保留,
// 是否发给当前租户仍由下面的 seedScopeFilter 决定。
function applyPlatformOverride(kb, override) {
  if (!override) return kb
  const keepTenant = (list) => (list || []).filter((e) => e.scope === 'tenant')
  return {
    ...kb,
    qaEntries: [...(override.qaEntries || []), ...keepTenant(kb.qaEntries)],
    businessRules: [...(override.businessRules || []), ...keepTenant(kb.businessRules)]
  }
}

export function buildKnowledgeContext(input = {}) {
  const kb = applyPlatformOverride(loadCustomerServiceKnowledgeBase(), input.platformKb)
  const message = compactText(input.message || '')
  const intents = inferCustomerServiceIntents(message)
  // 只有旗舰店能吃种子里的 tenant 层(那本来就是它自己的资料)
  const allowSeedTenantLayer = Boolean(input.liveTenantFacts && input.liveTenantFacts.allowSeedFallback)
  const matchedRules = selectRules(kb, message, intents, allowSeedTenantLayer)
  const matchedQa = selectQaEntries(kb, message, intents, allowSeedTenantLayer)
  const matchedHandoffRules = selectHandoffRules(kb, message, intents, matchedQa)
  const promptText = buildPromptText({
    kb,
    intents,
    matchedRules,
    matchedQa,
    matchedHandoffRules,
    context: input
  })
  const tenant = kb.layers?.tenantPrivate || {}
  const live = input.liveTenantFacts || {}
  return {
    version: kb.version,
    // 2026-08-07:返回给上层(会写进会话记录/调试面板)的 tenantId 也要是真实租户
    tenantId: live.tenantId || kb.tenantId,
    platformPreset: {
      categories: kb.layers?.platformPreset?.categories || [],
      memberOperationsTemplateOnly: true
    },
    tenantFacts: mergeTenantFacts(tenant, live),
    intents,
    customerStage: input.customerStage || '',
    sourceChannel: input.sourceChannel || '',
    referenceImageCount: input.referenceImages?.length || 0,
    matchedRules,
    matchedQa,
    matchedHandoffRules,
    promptTextZh: promptText.zh,
    promptTextEn: promptText.en
  }
}
