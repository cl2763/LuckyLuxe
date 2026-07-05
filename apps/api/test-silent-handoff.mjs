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
      sourceChannel: extra.sourceChannel || '小红书',
      customerStage: extra.customerStage || 'new_quote',
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

function transcriptRoles(conversation) {
  return (conversation?.transcript || []).map((item) => item.role)
}

function transcriptText(conversation) {
  return (conversation?.transcript || []).map((item) => `${item.role}:${item.content || ''}`).join('\n')
}

async function main() {
  const unknownCustomer = `silent-unknown-${RUN_ID}`
  console.log(`[silent-handoff] unknownCustomer=${unknownCustomer}`)
  const unknownResult = await send(unknownCustomer, '我刚看完一部电影，你觉得结尾是什么意思', { forceAi: true })
  assert(unknownResult.silentHandoff === true, 'unknown out-of-scope message should return silentHandoff=true')
  assert(!unknownResult.reply, 'unknown out-of-scope message should not return a customer-visible AI reply')

  let conversation = await conversationByExternalId(unknownCustomer)
  assert(conversation, 'silent handoff conversation should exist')
  assert(conversation.status === 'needs_human', `silent handoff should mark status needs_human, got ${conversation.status}`)
  assert(conversation.lastIntent === 'silent_unknown_handoff', `silent handoff should mark lastIntent, got ${conversation.lastIntent}`)
  assert(transcriptRoles(conversation).filter((role) => role === 'assistant').length === 0, 'silent handoff must not append an assistant message')
  assert(transcriptRoles(conversation).filter((role) => role === 'customer').length === 1, 'silent handoff should still record the customer message')

  const knownCustomer = `silent-known-${RUN_ID}`
  console.log(`[silent-handoff] knownCustomer=${knownCustomer}`)
  const knownResult = await send(knownCustomer, '哈喽，想做美甲', { forceAi: true })
  assert(!knownResult.silentHandoff, 'normal nail inquiry should not be silently handed off')
  assert(knownResult.reply, 'normal nail inquiry should receive AI reply')
  conversation = await conversationByExternalId(knownCustomer)
  assert(conversation.status !== 'needs_human', `normal nail inquiry should stay in AI flow, got ${conversation.status}`)
  assert(/预约|报价|项目类型|美甲/.test(transcriptText(conversation)), 'normal nail inquiry should still return the intake/booking context')

  console.log('[silent-handoff] all checks passed')
}

main().catch((error) => {
  console.error('[silent-handoff] failed:', error.message)
  process.exit(1)
})
