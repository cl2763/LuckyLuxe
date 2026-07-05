const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const TOKEN = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN_ID = Date.now().toString(36)
const IMAGE_A = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAQAAABp0P2WAAAADUlEQVR42mP8z8BQDwAFgwJ/lmVfWQAAAABJRU5ErkJggg=='
const IMAGE_B = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='

let checks = 0

function check(name, condition, detail = '') {
  checks += 1
  if (!condition) {
    throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  }
  console.log(`ok ${checks} - ${name}`)
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
    throw new Error(`${options.method || 'GET'} ${path} failed: ${response.status} ${JSON.stringify(data).slice(0, 600)}`)
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
      customerStage: extra.customerStage || 'unified_test',
      customerType: extra.customerType || 'new',
      memberTier: extra.memberTier || 'silver',
      points: extra.points ?? 0,
      referenceImages: extra.referenceImages || [],
      lang: extra.lang || 'zh',
      forceAi: extra.forceAi !== false
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
  return (await quoteRequests()).find((item) => item.conversationId === id || item.conversation_id === id)
}

function transcriptText(conversation) {
  return (conversation?.transcript || []).map((item) => `${item.role}:${item.content || ''}`).join('\n')
}

function assistantMessages(conversation) {
  return (conversation?.transcript || []).filter((item) => item.role === 'assistant')
}

function latestAssistantText(conversation) {
  return assistantMessages(conversation).at(-1)?.content || ''
}

function stateOf(conversation) {
  return conversation?.conversationState?.state || {}
}

async function manualReply(conversationId, message, releaseToAi = false) {
  return request(`/admin/wechat/conversations/${encodeURIComponent(conversationId)}/manual-reply`, {
    method: 'POST',
    body: JSON.stringify({ message, releaseToAi })
  })
}

async function respondQuote(quoteId, staffMessage) {
  return request(`/admin/quote-requests/${quoteId}/respond`, {
    method: 'POST',
    body: JSON.stringify({ staffMessage })
  })
}

async function main() {
  console.log(`[matrix] run=${RUN_ID}`)

  const staleAftercareGreeting = `matrix-stale-aftercare-${RUN_ID}`
  await send(staleAftercareGreeting, '哈喽', { customerStage: 'aftercare', forceAi: true })
  let conversation = await conversationByExternalId(staleAftercareGreeting)
  check('stale aftercare greeting creates conversation', Boolean(conversation))
  check('stale aftercare greeting is not after-sales handoff', conversation.lastIntent !== 'after_sales_handoff', conversation.lastIntent)
  check('stale aftercare greeting does not mention after-sales in reply', !/售后|返修|补修/.test(transcriptText(conversation)))
  let quote = await latestQuoteFor(staleAftercareGreeting)
  check('stale aftercare greeting does not create after-sales quote task', !quote || quote.styleElements?.workflowType !== 'after_sales')

  const unifiedHello = `matrix-unified-hello-${RUN_ID}`
  await send(unifiedHello, 'hello', { customerStage: 'unified_test', forceAi: true })
  conversation = await conversationByExternalId(unifiedHello)
  check('unified hello creates conversation', Boolean(conversation))
  check('unified hello is not after-sales handoff', conversation.lastIntent !== 'after_sales_handoff', conversation.lastIntent)
  quote = await latestQuoteFor(unifiedHello)
  check('unified hello does not create after-sales task', !quote || quote.styleElements?.workflowType !== 'after_sales')

  const newConflict = `matrix-new-conflict-${RUN_ID}`
  await send(newConflict, '哈喽', { customerType: 'new', memberTier: 'gold', points: 0, forceAi: true })
  conversation = await conversationByExternalId(newConflict)
  check('new customer with conflicting tier creates conversation', Boolean(conversation))
  check('new customer with conflicting tier receives new welcome', /欢迎来到\s*Lucky\s*Luxe|预约助手/.test(transcriptText(conversation)))
  check('new customer with conflicting tier does not receive returning welcome', !/欢迎回来宝/.test(transcriptText(conversation)))

  const nailAfterSales = `matrix-nail-after-sales-${RUN_ID}`
  await send(nailAfterSales, '昨天做的指甲今天开胶了，还有一颗钻掉了', { referenceImages: [IMAGE_A], forceAi: true })
  conversation = await conversationByExternalId(nailAfterSales)
  quote = await latestQuoteFor(nailAfterSales)
  check('nail after-sales routes to human', conversation.status === 'needs_human', conversation.status)
  check('nail after-sales intent is after_sales_handoff', conversation.lastIntent === 'after_sales_handoff', conversation.lastIntent)
  check('nail after-sales task exists', Boolean(quote))
  check('nail after-sales task is nail', quote?.serviceType === 'nail', quote?.serviceType)
  check('nail after-sales keeps image', (quote?.referenceImages || []).length >= 1)
  check('nail after-sales does not restart intake template', !/项目类型：美甲|按下面格式/.test(transcriptText(conversation)))

  const lashAfterSales = `matrix-lash-after-sales-${RUN_ID}`
  await send(lashAfterSales, '睫毛做完眼睛红肿刺痛，不太舒服', { forceAi: true })
  conversation = await conversationByExternalId(lashAfterSales)
  quote = await latestQuoteFor(lashAfterSales)
  check('lash after-sales routes to human', conversation.status === 'needs_human', conversation.status)
  check('lash after-sales intent is after_sales_handoff', conversation.lastIntent === 'after_sales_handoff', conversation.lastIntent)
  check('lash after-sales task exists', Boolean(quote))
  check('lash after-sales task is lash', quote?.serviceType === 'lash', quote?.serviceType)
  check('lash after-sales health category is retained', quote?.styleElements?.afterSales?.category === 'health_or_discomfort', quote?.styleElements?.afterSales?.category)

  const blankRepair = `matrix-blank-repair-${RUN_ID}`
  await send(blankRepair, [
    '1. 项目类型：美甲',
    '2. 想做日期和时间：2026-07-03 14:00',
    '3. 是否需要卸甲：不需要',
    '4. 是否需要延长：本甲',
    '5. 是否有断甲需要修补：',
    '6. 是否有参考图：有'
  ].join('\n'), { referenceImages: [IMAGE_A], forceAi: true })
  conversation = await conversationByExternalId(blankRepair)
  check('blank broken-nail label does not become after-sales', conversation.lastIntent !== 'after_sales_handoff', conversation.lastIntent)
  check('blank broken-nail label does not invent repair needed', !/有断甲修补|需要断甲修补/.test(transcriptText(conversation)))

  const sim027 = `matrix-sim027-new-plus-conflict-${RUN_ID}`
  await send(sim027, '哈喽，想约美甲，这款可以做吗', {
    customerType: 'new',
    memberTier: 'gold',
    points: 0,
    referenceImages: [IMAGE_A],
    forceAi: true
  })
  await send(sim027, [
    '1. 项目类型：美甲',
    '2. 想做日期和时间：2026-07-03 14:00',
    '3. 是否需要卸甲：需要',
    '4. 是否需要延长：需要',
    '5. 是否有断甲需要修补：无',
    '6. 是否有参考图：有的话请直接发图；没有也可以写“无图”',
    '7. 其他备注：'
  ].join('\n'), { customerType: 'new', memberTier: 'gold', points: 0, forceAi: true })
  conversation = await conversationByExternalId(sim027)
  quote = await latestQuoteFor(sim027)
  check('sim027 regression creates staff quote task', Boolean(quote))
  check('sim027 regression keeps service as nail', quote?.serviceType === 'nail', quote?.serviceType)
  check('sim027 regression is not after-sales', conversation.lastIntent !== 'after_sales_handoff', conversation.lastIntent)
  check('sim027 regression normalizes new customer to silver', stateOf(conversation).memberTier === 'silver', JSON.stringify(stateOf(conversation)))
  check('sim027 regression does not unlock technician selection', !/是否指定技师/.test(transcriptText(conversation)))

  const returning = `matrix-returning-${RUN_ID}`
  await send(returning, '想问这个款可以做吗', {
    customerType: 'returning',
    memberTier: 'gold',
    points: 300,
    referenceImages: [IMAGE_A],
    forceAi: true
  })
  conversation = await conversationByExternalId(returning)
  check('returning customer conversation exists', Boolean(conversation))
  check('returning customer gets fixed welcome', /欢迎回来宝/.test(transcriptText(conversation)))
  check('returning customer gets welcome plus contextual reply', assistantMessages(conversation).length >= 2)
  check('returning customer is not after-sales by default', conversation.lastIntent !== 'after_sales_handoff', conversation.lastIntent)

  const lashInquiry = `matrix-lash-inquiry-${RUN_ID}`
  await send(lashInquiry, '想做自然款美睫，价格是多少？下睫毛不用，眼睛没有不舒服', { forceAi: true })
  conversation = await conversationByExternalId(lashInquiry)
  check('lash inquiry is not after-sales', conversation.lastIntent !== 'after_sales_handoff', conversation.lastIntent)
  check('lash inquiry keeps lash context in transcript/state', /美睫|睫毛|lash/i.test(transcriptText(conversation)) || stateOf(conversation).serviceType === 'lash')

  const special = `matrix-special-${RUN_ID}`
  await send(special, '我还有一个朋友想一起做，可以吗', { forceAi: true })
  conversation = await conversationByExternalId(special)
  quote = await latestQuoteFor(special)
  check('special arrangement routes to human', conversation.status === 'needs_human', conversation.status)
  check('special arrangement creates staff task', Boolean(quote))
  check('special arrangement has special review trigger', quote?.styleElements?.quoteIntake?.trigger === 'special_manual_review', quote?.styleElements?.quoteIntake?.trigger)

  const unknown = `matrix-unknown-${RUN_ID}`
  const unknownResult = await send(unknown, '我刚看完一部电影，你觉得结尾是什么意思', { forceAi: true })
  conversation = await conversationByExternalId(unknown)
  check('unknown out-of-scope returns silent handoff flag', unknownResult.silentHandoff === true)
  check('unknown out-of-scope marks needs_human', conversation.status === 'needs_human', conversation.status)
  check('unknown out-of-scope has no assistant message', assistantMessages(conversation).length === 0)

  const quoteFlow = `matrix-quote-flow-${RUN_ID}`
  await send(quoteFlow, '想约美甲，这款可以做吗', { referenceImages: [IMAGE_A], forceAi: true })
  await send(quoteFlow, [
    '1. 项目类型：美甲',
    '2. 想做日期和时间：2026-07-03 14:00',
    '3. 是否需要卸甲：需要',
    '4. 是否需要延长：不确定，两个都想看',
    '5. 是否有断甲需要修补：没有',
    '6. 是否有参考图：有',
    '7. 其他备注：想问本甲和延长两个价格'
  ].join('\n'), { forceAi: true })
  conversation = await conversationByExternalId(quoteFlow)
  quote = await latestQuoteFor(quoteFlow)
  check('quote flow creates pending staff quote', Boolean(quote))
  check('quote flow conversation enters needs_human', conversation.status === 'needs_human', conversation.status)
  check('quote flow carries historical image even when latest message has no image', (quote?.referenceImages || []).length >= 1)
  check('quote flow preserves removal yes', quote?.removalNeeded === 'yes', quote?.removalNeeded)
  check('quote flow preserves extension ambiguity as yes/unknown-like signal', ['yes', 'unknown', 'partial'].includes(quote?.extensionNeeded), quote?.extensionNeeded)

  await send(quoteFlow, '我又补一张图，这张也参考一下', { referenceImages: [IMAGE_B], forceAi: false })
  quote = await latestQuoteFor(quoteFlow)
  check('active quote merges follow-up image while waiting staff', (quote?.referenceImages || []).length >= 2)

  await respondQuote(quote.id, '可以做，本甲120，延长200，大概3小时以内')
  conversation = await conversationByExternalId(quoteFlow)
  const quoteTranscript = transcriptText(conversation)
  check('staff quote returns conversation to AI flow', conversation.status === 'ai_replied', conversation.status)
  check('staff quote preserves natural nail price', /本甲[^。\n]*120/.test(quoteTranscript))
  check('staff quote preserves extension price', /延长[^。\n]*200/.test(quoteTranscript))
  check('staff quote preserves duration', /3\s*小时|180\s*分钟/.test(quoteTranscript))
  check('staff quote gives standardized booking exit', /确认预约/.test(quoteTranscript) && /日期|时间/.test(quoteTranscript))

  const dateOnly = `matrix-date-only-${RUN_ID}`
  await send(dateOnly, '想做美甲，这款问一下价格', { referenceImages: [IMAGE_A], forceAi: true })
  await send(dateOnly, [
    '1. 项目类型：美甲',
    '2. 想做日期和时间：2026-07-05',
    '3. 是否需要卸甲：不需要',
    '4. 是否需要延长：本甲',
    '5. 是否有断甲需要修补：没有',
    '6. 是否有参考图：有',
    '7. 其他备注：日式微闪'
  ].join('\n'), { forceAi: true })
  quote = await latestQuoteFor(dateOnly)
  check('date-only quote can be sent to staff', Boolean(quote))
  check('date-only quote records date', quote?.styleElements?.quoteIntake?.bookingDate === '2026-07-05', quote?.styleElements?.quoteIntake?.bookingDate)
  check('date-only quote does not invent time', !quote?.styleElements?.quoteIntake?.bookingTime, quote?.styleElements?.quoteIntake?.bookingTime)
  await respondQuote(quote.id, '可以做，CAD 198，预计120分钟')
  const dateOnlyResult = await send(dateOnly, '确认预约', { forceAi: true })
  conversation = await conversationByExternalId(dateOnly)
  check('date-only booking confirmation requires time', Boolean(dateOnlyResult.bookingTimeRequired))
  check('date-only booking confirmation asks exact time in chat', /时间|几点|14:30|下午/.test(latestAssistantText(conversation)))
  check('date-only booking confirmation does not create draft link', !/bookingDraft=|预约草稿链接|草稿链接/.test(latestAssistantText(conversation)))

  const unavailable = `matrix-unavailable-${RUN_ID}`
  await send(unavailable, '想做美甲，这款问一下价格', { referenceImages: [IMAGE_A], forceAi: true })
  await send(unavailable, [
    '1. 项目类型：美甲',
    '2. 想做日期和时间：2026-07-03 20:00',
    '3. 是否需要卸甲：不需要',
    '4. 是否需要延长：本甲',
    '5. 是否有断甲需要修补：没有',
    '6. 是否有参考图：有',
    '7. 其他备注：日式微闪'
  ].join('\n'), { forceAi: true })
  quote = await latestQuoteFor(unavailable)
  await respondQuote(quote.id, '可以做，CAD 198，预计120分钟')
  const unavailableResult = await send(unavailable, '确认预约 2026-07-03 20:00', { forceAi: true })
  conversation = await conversationByExternalId(unavailable)
  check('unavailable exact time returns unavailable flag', Boolean(unavailableResult.bookingSlotUnavailable))
  check('unavailable exact time gives nearest slot in chat', /最近可约|营业时间|10:00-19:00|暂时没有可预约/.test(latestAssistantText(conversation)))
  const suggestedTime = unavailableResult.suggestedSlot?.time
  check('unavailable exact time includes suggested time', Boolean(suggestedTime), JSON.stringify(unavailableResult.suggestedSlot || {}))
  await send(unavailable, `那就${suggestedTime}吧`, { forceAi: true })
  conversation = await conversationByExternalId(unavailable)
  check('accepting suggested time creates booking draft link', /bookingDraft=|预约草稿|草稿链接/.test(transcriptText(conversation)))

  const human = `matrix-human-${RUN_ID}`
  await send(human, '哈喽，想做美甲', { forceAi: true })
  conversation = await conversationByExternalId(human)
  const assistantBeforeHuman = assistantMessages(conversation).length
  await manualReply(conversation.id, '我先帮您人工确认一下。', false)
  conversation = await conversationByExternalId(human)
  check('manual reply without release sets human_active', conversation.status === 'human_active', conversation.status)
  await send(human, '好的，那我等你', { forceAi: false })
  conversation = await conversationByExternalId(human)
  check('customer message during human takeover remains human_active', conversation.status === 'human_active', conversation.status)
  check('AI does not reply during human takeover', assistantMessages(conversation).length === assistantBeforeHuman)
  await manualReply(conversation.id, '我确认好了，交回 AI 继续。', true)
  await send(human, '那我继续预约', { forceAi: true })
  conversation = await conversationByExternalId(human)
  check('manual release allows AI reply again', assistantMessages(conversation).length > assistantBeforeHuman)

  check('matrix contains at least 50 regression checks', checks >= 50, `actual=${checks}`)
  console.log(`[matrix] all ${checks} regression checks passed`)
}

main().catch((error) => {
  console.error('[matrix] failed:', error.message)
  process.exit(1)
})
