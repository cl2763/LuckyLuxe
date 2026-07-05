const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const TOKEN = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN_ID = Date.now().toString(36)

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

async function send(externalUserId, message, extra = {}) {
  return request('/admin/wechat/mock-chat-message', {
    method: 'POST',
    body: JSON.stringify({
      externalUserId,
      message,
      sourceChannel: '小红书',
      customerStage: 'new_quote',
      customerType: extra.customerType || 'new',
      memberTier: extra.memberTier || 'silver',
      points: extra.points ?? 0,
      referenceImages: extra.referenceImages || [],
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

function assistantCount(conversation) {
  return (conversation?.transcript || []).filter((item) => item.role === 'assistant').length
}

function latestAssistantText(conversation) {
  const items = conversation?.transcript || []
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.role === 'assistant') return items[index].content || ''
  }
  return ''
}

async function manualReply(conversationId, message, releaseToAi = false) {
  return request(`/admin/wechat/conversations/${encodeURIComponent(conversationId)}/manual-reply`, {
    method: 'POST',
    body: JSON.stringify({ message, releaseToAi })
  })
}

async function main() {
  const customer = `handoff-test-${RUN_ID}`
  console.log(`[human-handoff] customer=${customer}`)

  await send(customer, '哈喽，想问这款美甲可以做吗', { forceAi: true })
  let conversation = await conversationByExternalId(customer)
  assert(conversation, 'conversation should exist')
  const firstAssistantCount = assistantCount(conversation)
  assert(firstAssistantCount >= 1, 'first message should receive AI reply')

  await manualReply(conversation.id, '可以的，我先帮你看一下技师时间。', false)
  conversation = await conversationByExternalId(customer)
  assert(conversation.status === 'human_active', `manual keep-human reply should set human_active, got ${conversation.status}`)
  const countAfterStaff = assistantCount(conversation)

  await send(customer, '好的，那我想下午来', { forceAi: false })
  conversation = await conversationByExternalId(customer)
  assert(conversation.status === 'human_active', `customer message during human takeover should stay human_active, got ${conversation.status}`)
  assert(assistantCount(conversation) === countAfterStaff, 'AI must not reply while human takeover is active')
  assert(/下午来/.test((conversation.transcript || []).at(-1)?.content || ''), 'latest customer message should be recorded')

  await send(customer, '请 AI 继续接待', { forceAi: true })
  conversation = await conversationByExternalId(customer)
  assert(conversation.status !== 'human_active', `explicit forceAi should return to AI flow, got ${conversation.status}`)
  assert(assistantCount(conversation) > countAfterStaff, 'AI should reply after explicit return-to-AI')

  await manualReply(conversation.id, '我已经确认好了，后续让 AI 继续协助。', true)
  conversation = await conversationByExternalId(customer)
  assert(conversation.status === 'ai_replied', `releaseToAi manual reply should set ai_replied, got ${conversation.status}`)

  const oldCustomer = `handoff-old-${RUN_ID}`
  await send(oldCustomer, '想问下这个款', {
    forceAi: true,
    customerType: 'old',
    points: 100,
    referenceImages: []
  })
  conversation = await conversationByExternalId(oldCustomer)
  const transcript = (conversation?.transcript || []).map((item) => `${item.role}:${item.content || ''}`).join('\n')
  assert(/欢迎回来宝/.test(transcript), 'returning customer should receive fixed welcome message')
  assert((conversation?.transcript || []).filter((item) => item.role === 'assistant').length >= 2, 'returning customer should receive welcome plus contextual reply')
  assert(latestAssistantText(conversation) && !/^欢迎回来宝/.test(latestAssistantText(conversation)), 'latest assistant reply should be contextual, not only welcome')

  console.log('[human-handoff] all regression checks passed')
}

main().catch((error) => {
  console.error('[human-handoff] failed:', error.message)
  process.exit(1)
})
