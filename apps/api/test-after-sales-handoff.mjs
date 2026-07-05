const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const TOKEN = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN_ID = Date.now().toString(36)
const IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAQAAABp0P2WAAAADUlEQVR42mP8z8BQDwAFgwJ/lmVfWQAAAABJRU5ErkJggg=='

function assert(condition, message) {
  if (!condition) throw new Error(message)
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
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} failed: ${response.status} ${JSON.stringify(data).slice(0, 500)}`)
  }
  return data
}

async function send(externalUserId, message, referenceImages = [], extra = {}) {
  return request('/admin/wechat/mock-chat-message', {
    method: 'POST',
    body: JSON.stringify({
      externalUserId,
      message,
      sourceChannel: extra.sourceChannel || '小红书',
      customerStage: extra.customerStage || 'aftercare',
      customerType: extra.customerType || 'old',
      memberTier: extra.memberTier || 'silver',
      points: extra.points ?? 100,
      referenceImages,
      lang: 'zh',
      forceAi: Boolean(extra.forceAi)
    })
  })
}

async function conversationByExternalId(externalUserId) {
  const id = `wecom:${externalUserId}`
  const conversations = (await request('/admin/wechat/conversations')).conversations || []
  return conversations.find((item) => item.id === id)
}

async function quoteRequests() {
  return (await request('/admin/quote-requests')).quoteRequests || []
}

async function latestQuoteFor(externalUserId) {
  const id = `wecom:${externalUserId}`
  const quotes = await quoteRequests()
  return quotes.find((item) => item.conversationId === id || item.conversation_id === id)
}

function transcriptText(conversation) {
  return (conversation?.transcript || []).map((item) => `${item.role}:${item.content || ''}`).join('\n')
}

async function main() {
  const nailCustomer = `after-sales-nail-${RUN_ID}`
  console.log(`[after-sales] nailCustomer=${nailCustomer}`)
  await send(nailCustomer, '我的指甲刚做完有点开胶了', [IMAGE], { forceAi: true })
  let conversation = await conversationByExternalId(nailCustomer)
  assert(conversation, 'nail after-sales conversation should exist')
  assert(conversation.status === 'needs_human', `nail after-sales should mark needs_human, got ${conversation.status}`)
  assert(conversation.lastIntent === 'after_sales_handoff', `nail after-sales lastIntent should be after_sales_handoff, got ${conversation.lastIntent}`)
  let text = transcriptText(conversation)
  assert(/售后|返修|工作人员|照片|哪一天/.test(text), 'nail after-sales should acknowledge and ask for photo/service date')
  assert(!/项目类型：美甲|按下面格式|是否需要卸甲/.test(text), 'nail after-sales must not restart quote intake template')
  let quote = await latestQuoteFor(nailCustomer)
  assert(quote, 'nail after-sales should create a staff task')
  assert(quote.serviceType === 'nail', `nail after-sales task should be nail, got ${quote.serviceType}`)
  assert(quote.styleElements?.workflowType === 'after_sales', 'nail after-sales task should be marked workflowType=after_sales')
  assert((quote.referenceImages || []).length >= 1, 'nail after-sales task should include current/historical images')

  const lashCustomer = `after-sales-lash-${RUN_ID}`
  console.log(`[after-sales] lashCustomer=${lashCustomer}`)
  await send(lashCustomer, '我昨天做的睫毛今天眼睛有点红肿刺痛，不舒服', [], { forceAi: true })
  conversation = await conversationByExternalId(lashCustomer)
  assert(conversation, 'lash after-sales conversation should exist')
  assert(conversation.status === 'needs_human', `lash after-sales should mark needs_human, got ${conversation.status}`)
  assert(conversation.lastIntent === 'after_sales_handoff', `lash after-sales lastIntent should be after_sales_handoff, got ${conversation.lastIntent}`)
  text = transcriptText(conversation)
  assert(/红肿|刺痛|过敏|工作人员|照片|哪一天/.test(text), 'lash health after-sales should acknowledge discomfort and ask for photo/service date')
  assert(!/项目类型：美睫|按下面格式|下睫毛/.test(text), 'lash after-sales must not restart lash intake template')
  quote = await latestQuoteFor(lashCustomer)
  assert(quote, 'lash after-sales should create a staff task')
  assert(quote.serviceType === 'lash', `lash after-sales task should be lash, got ${quote.serviceType}`)
  assert(quote.styleElements?.afterSales?.category === 'health_or_discomfort', `lash after-sales category should be health_or_discomfort, got ${quote.styleElements?.afterSales?.category}`)

  const intakeCustomer = `after-sales-intake-${RUN_ID}`
  console.log(`[after-sales] intakeCustomer=${intakeCustomer}`)
  await send(intakeCustomer, [
    '1. 项目类型：美甲',
    '2. 想做日期和时间：2026-07-03 14:00',
    '3. 是否需要卸甲：需要',
    '4. 是否需要延长：本甲',
    '5. 是否有断甲需要修补：没有',
    '6. 是否有参考图：有',
    '7. 其他备注：贝母款'
  ].join('\n'), [IMAGE], { customerStage: 'new_quote', customerType: 'new', points: 0, forceAi: true })
  conversation = await conversationByExternalId(intakeCustomer)
  assert(conversation?.lastIntent !== 'after_sales_handoff', 'normal intake mentioning broken-nail repair label must not be misclassified as after-sales')

  const stagePollutionCustomer = `after-sales-stage-pollution-${RUN_ID}`
  console.log(`[after-sales] stagePollutionCustomer=${stagePollutionCustomer}`)
  await send(stagePollutionCustomer, '哈喽', [], { customerStage: 'aftercare', customerType: 'new', points: 0, forceAi: true })
  conversation = await conversationByExternalId(stagePollutionCustomer)
  assert(conversation, 'stage-pollution greeting conversation should exist')
  assert(conversation.lastIntent !== 'after_sales_handoff', `greeting with aftercare test stage must not become after_sales_handoff, got ${conversation.lastIntent}`)
  assert(conversation.status !== 'needs_human' || !/售后|返修/.test(transcriptText(conversation)), 'greeting with aftercare test stage must not silently become after-sales handoff')
  quote = await latestQuoteFor(stagePollutionCustomer)
  assert(!quote || quote.styleElements?.workflowType !== 'after_sales', 'greeting with stale aftercare stage must not create after-sales task')

  const unifiedGreetingCustomer = `after-sales-unified-greeting-${RUN_ID}`
  console.log(`[after-sales] unifiedGreetingCustomer=${unifiedGreetingCustomer}`)
  await send(unifiedGreetingCustomer, 'hello', [], { customerStage: 'unified_test', customerType: 'new', points: 0, forceAi: true })
  conversation = await conversationByExternalId(unifiedGreetingCustomer)
  assert(conversation, 'unified greeting conversation should exist')
  assert(conversation.lastIntent !== 'after_sales_handoff', `unified greeting must not become after_sales_handoff, got ${conversation.lastIntent}`)

  console.log('[after-sales] all regression checks passed')
}

main().catch((error) => {
  console.error('[after-sales] failed:', error.message)
  process.exit(1)
})
