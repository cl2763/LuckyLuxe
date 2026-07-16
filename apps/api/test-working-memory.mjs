const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const TOKEN = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN_ID = Date.now().toString(36)
const IMAGE_A = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
const IMAGE_B = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAQAAABp0P2WAAAADUlEQVR42mP8z8BQDwAFgwJ/lmVfWQAAAABJRU5ErkJggg=='

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

// 与 local-server.mjs 的 dateFromMonthDay 同规则:按门店时区取"今天",
// 客人只说月.日(如 7.6)时,若该日期今年已过则理解为明年。
function expectedUpcomingDate(month, day) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date())
  const year = Number(today.slice(0, 4))
  const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return candidate < today ? `${year + 1}${candidate.slice(4)}` : candidate
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
      customerStage: extra.customerStage || 'new_quote',
      customerType: extra.customerType || 'new',
      memberTier: extra.memberTier || 'silver',
      points: extra.points ?? 0,
      referenceImages,
      lang: 'zh',
      forceAi: Boolean(extra.forceAi)
    })
  })
}

async function conversations() {
  return (await request('/admin/wechat/conversations')).conversations || []
}

async function conversationByExternalId(externalUserId) {
  const id = `wecom:${externalUserId}`
  return (await conversations()).find((item) => item.id === id)
}

async function quoteRequests() {
  return (await request('/admin/quote-requests')).quoteRequests || []
}

async function latestQuoteFor(externalUserId) {
  const id = `wecom:${externalUserId}`
  const quotes = await quoteRequests()
  return quotes.find((item) => item.conversationId === id || item.conversation_id === id)
}

function stateOf(conversation) {
  return conversation?.conversationState?.state || {}
}

function memoryQuoteOf(conversation) {
  return stateOf(conversation)?.workingMemory?.quote || {}
}

function transcriptText(conversation) {
  return (conversation?.transcript || []).map((item) => `${item.role}:${item.content || ''}`).join('\n')
}

function latestAssistantText(conversation) {
  const items = conversation?.transcript || []
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.role === 'assistant') return items[index].content || ''
  }
  return ''
}

async function main() {
  const customer = `sim-test-${RUN_ID}`
  console.log(`[working-memory] customer=${customer}`)

  await send(customer, '哈喽，想做美甲', [], { forceAi: true })
  let conversation = await conversationByExternalId(customer)
  let latestAssistant = ''
  assert(conversation, 'conversation should exist after first message')
  assert(/按下面格式|预约\/报价|预约.*信息/.test(transcriptText(conversation)), 'first nail inquiry should return intake template')

  await send(customer, '需要卸甲', [], { forceAi: true })
  conversation = await conversationByExternalId(customer)
  assert(memoryQuoteOf(conversation).removalNeeded === 'yes' || stateOf(conversation).removalNeeded === 'yes', 'working memory should remember removalNeeded=yes across messages')

  await send(customer, [
    '想问价格',
    '1. 项目类型：美甲',
    '2. 想做日期和时间：2026-07-02 14:00',
    '4. 是否需要延长：本甲',
    '5. 是否有断甲需要修补：没有',
    '6. 是否有参考图：有',
    '7. 其他备注：柔和法式'
  ].join('\n'), [IMAGE_A], { forceAi: true })
  conversation = await conversationByExternalId(customer)
  assert(conversation.status === 'needs_human', `quote handoff should mark conversation needs_human, got ${conversation.status}`)
  let quote = await latestQuoteFor(customer)
  assert(quote, 'quote request should be created after enough intake info')
  assert((quote.referenceImages || []).length >= 1, 'quote request should include reference image')
  assert(/需要卸甲|卸甲/.test(quote.customerMessage || ''), 'quote request should include prior customer context, not only latest sentence')

  await send(customer, '我又补一张图，这个细节也想要', [IMAGE_B], { forceAi: false })
  quote = await latestQuoteFor(customer)
  assert((quote.referenceImages || []).length >= 2, `active quote should merge historical and new images, got ${(quote.referenceImages || []).length}`)
  assert(/顾客补充|又补一张图/.test(quote.customerMessage || ''), 'active quote should record customer supplement while waiting staff quote')

  await request(`/admin/quote-requests/${quote.id}/respond`, {
    method: 'POST',
    body: JSON.stringify({
      staffMessage: '可以做，建议 CAD 238，预计 150 分钟。珍珠细节到店再确认数量。'
    })
  })
  conversation = await conversationByExternalId(customer)
  assert(conversation.status === 'ai_replied', `staff quote response should return conversation to ai_replied, got ${conversation.status}`)
  assert(/CAD|238|150/.test(transcriptText(conversation)), 'customer transcript should receive polished staff quote reply')
  assert(/确认预约/.test(transcriptText(conversation)) && /日期和时间|想预约/.test(transcriptText(conversation)), 'staff quote reply should include standardized booking exit with date/time instruction')
  assert(/可以做/.test(memoryQuoteOf(conversation).staffMessage || stateOf(conversation).staffMessage || ''), 'working memory should preserve staff quote text')

  const multiPriceCustomer = `sim-test-multiprice-${RUN_ID}`
  await send(multiPriceCustomer, '哈喽 想约美甲', [IMAGE_A], { forceAi: true })
  await send(multiPriceCustomer, [
    '1. 项目类型：美甲',
    '2. 想做日期和时间：',
    '3. 是否需要卸甲：需要',
    '4. 是否需要延长：不确定，两个都想看',
    '5. 是否有断甲需要修补：没有',
    '6. 是否有参考图：有',
    '7. 其他备注：想同时比较本甲和延长价格'
  ].join('\n'), [], { forceAi: true })
  const multiPriceQuote = await latestQuoteFor(multiPriceCustomer)
  assert(multiPriceQuote, 'ambiguous extension intake should create a quote request')
  await request(`/admin/quote-requests/${multiPriceQuote.id}/respond`, {
    method: 'POST',
    body: JSON.stringify({ staffMessage: '可以做，本甲120，延长200，大概3小时以内' })
  })
  const multiPriceConversation = await conversationByExternalId(multiPriceCustomer)
  const multiPriceTranscript = transcriptText(multiPriceConversation)
  assert(/本甲[^。\n]*120/.test(multiPriceTranscript), 'staff quote reply should preserve natural nail price from free-form staff note')
  assert(/延长[^。\n]*200/.test(multiPriceTranscript), 'staff quote reply should preserve extension price from free-form staff note')
  assert(/3\s*小时|180\s*分钟/.test(multiPriceTranscript), 'staff quote reply should preserve duration from free-form staff note')
  const quotedMultiPrice = await latestQuoteFor(multiPriceCustomer)
  assert(quotedMultiPrice.staffPriceCents === 12000, `multi-option staff price should store first quoted option as 12000 cents, got ${quotedMultiPrice.staffPriceCents}`)
  assert(quotedMultiPrice.staffDurationMin === 180, `multi-option staff duration should parse 3 hours as 180 min, got ${quotedMultiPrice.staffDurationMin}`)

  const noTimeCustomer = `sim-test-notime-${RUN_ID}`
  await send(noTimeCustomer, '想做美甲，问下这个多少钱', [IMAGE_A], { forceAi: true })
  await send(noTimeCustomer, [
    '1. 项目类型：美甲',
    '2. 想做日期和时间：',
    '3. 是否需要卸甲：不用',
    '4. 是否需要延长：本甲',
    '5. 是否有断甲需要修补：没有',
    '6. 是否有参考图：有',
    '7. 其他备注：日式微闪'
  ].join('\n'), [], { forceAi: true })
  const noTimeQuote = await latestQuoteFor(noTimeCustomer)
  assert(noTimeQuote, 'quote without confirmed time should still be allowed for staff pricing')
  await request(`/admin/quote-requests/${noTimeQuote.id}/respond`, {
    method: 'POST',
    body: JSON.stringify({ staffMessage: '可以做，CAD 198，预计 120 分钟。' })
  })
  const noTimeResult = await send(noTimeCustomer, '确认预约', [], { forceAi: true })
  assert(noTimeResult.bookingTimeRequired || /日期|时间|几点/.test(transcriptText(await conversationByExternalId(noTimeCustomer))), 'booking draft should require confirmed date/time before creating link')

  const dateOnlyCustomer = `sim-test-dateonly-${RUN_ID}`
  await send(dateOnlyCustomer, '想做美甲，问这个款可以做吗', [IMAGE_A], { forceAi: true })
  await send(dateOnlyCustomer, [
    '1. 项目类型：美甲',
    '2. 想做日期和时间：2026-07-05',
    '3. 是否需要卸甲：需要',
    '4. 是否需要延长：需要',
    '5. 是否有断甲需要修补：没有',
    '6. 是否有参考图：有',
    '7. 其他备注：图片这种感觉'
  ].join('\n'), [], { forceAi: true })
  const dateOnlyQuote = await latestQuoteFor(dateOnlyCustomer)
  assert(dateOnlyQuote, 'date-only intake should still create a quote request for staff review')
  const dateOnlyIntake = dateOnlyQuote.styleElements?.quoteIntake || {}
  assert(dateOnlyIntake.bookingDate === '2026-07-05', `date-only intake should keep date, got ${dateOnlyIntake.bookingDate}`)
  assert(!dateOnlyIntake.bookingTime, `date-only intake should not invent booking time, got ${dateOnlyIntake.bookingTime}`)
  assert(dateOnlyIntake.completion?.filled < dateOnlyIntake.completion?.total, 'date-only intake should not count date/time as fully complete')
  await request(`/admin/quote-requests/${dateOnlyQuote.id}/respond`, {
    method: 'POST',
    body: JSON.stringify({ staffMessage: '可以做，报价 CAD 238，预计 150 分钟。' })
  })
  const dateOnlyResult = await send(dateOnlyCustomer, '确认预约', [], { forceAi: true })
  conversation = await conversationByExternalId(dateOnlyCustomer)
  latestAssistant = latestAssistantText(conversation)
  const dateOnlyQuoteAfterConfirm = await latestQuoteFor(dateOnlyCustomer)
  assert(dateOnlyResult.bookingTimeRequired, 'date-only confirmed booking should return bookingTimeRequired')
  assert(/具体.*时间|几点|到店时间|14:30|下午两点/.test(latestAssistant), 'date-only confirmed booking should ask for exact time')
  assert(!/草稿链接|预约草稿链接|点击.*链接|booking draft link|draft link/i.test(latestAssistant), 'date-only confirmed booking must not send draft link')
  assert(dateOnlyQuoteAfterConfirm.status !== 'DRAFT_CREATED', `date-only quote should not become DRAFT_CREATED, got ${dateOnlyQuoteAfterConfirm.status}`)

  const unavailableSlotCustomer = `sim-test-unavailable-${RUN_ID}`
  await send(unavailableSlotCustomer, '想做美甲，想问这个款', [IMAGE_A], { forceAi: true })
  await send(unavailableSlotCustomer, [
    '1. 项目类型：美甲',
    '2. 想做日期和时间：2026-07-03 20:00',
    '3. 是否需要卸甲：需要',
    '4. 是否需要延长：需要',
    '5. 是否有断甲需要修补：没有',
    '6. 是否有参考图：有',
    '7. 其他备注：日式长款'
  ].join('\n'), [], { forceAi: true })
  const unavailableQuote = await latestQuoteFor(unavailableSlotCustomer)
  assert(unavailableQuote, 'unavailable-slot customer should still create quote request')
  await request(`/admin/quote-requests/${unavailableQuote.id}/respond`, {
    method: 'POST',
    body: JSON.stringify({ staffMessage: '可以做，CAD 238，预计 150 分钟。' })
  })
  const unavailableResult = await send(unavailableSlotCustomer, '确认预约 2026-07-03 20:00', [], { forceAi: true })
  conversation = await conversationByExternalId(unavailableSlotCustomer)
  latestAssistant = latestAssistantText(conversation)
  assert(unavailableResult.bookingSlotUnavailable, 'unavailable exact time should be returned as bookingSlotUnavailable instead of API failure')
  assert(/营业时间|10:00-19:00|暂时没有可预约排班|最近可约/.test(latestAssistant), 'unavailable exact time should be explained inside chat with business hours/nearest slot')
  const suggestedTime = unavailableResult.suggestedSlot?.time || latestAssistant.match(/(\d{2}:\d{2})/)?.[1] || ''
  assert(suggestedTime, 'unavailable exact time reply should include a suggested replacement time')
  await send(unavailableSlotCustomer, `那就${suggestedTime}吧`, [], { forceAi: true })
  conversation = await conversationByExternalId(unavailableSlotCustomer)
  latestAssistant = latestAssistantText(conversation)
  assert(/预约草稿|bookingDraft=|草稿链接|draft/i.test(latestAssistant), 'accepting suggested available time should create booking draft link')

  const specialCustomer = `sim-test-special-${RUN_ID}`
  await send(specialCustomer, '我还有一个朋友想一起做，可以吗', [], { forceAi: true })
  conversation = await conversationByExternalId(specialCustomer)
  const specialQuote = await latestQuoteFor(specialCustomer)
  assert(conversation.status === 'needs_human', `special arrangement should hand off to human, got ${conversation.status}`)
  assert(specialQuote, 'special arrangement should create a human task')
  assert(specialQuote.styleElements?.quoteIntake?.trigger === 'special_manual_review', `special arrangement trigger should be special_manual_review, got ${specialQuote.styleElements?.quoteIntake?.trigger}`)

  await request(`/admin/quote-requests/${quote.id}/draft`, {
    method: 'POST',
    body: JSON.stringify({ date: '2026-07-02', time: '14:00' })
  })
  conversation = await conversationByExternalId(customer)
  assert(/预约草稿|booking draft|draft/i.test(transcriptText(conversation)), 'confirmed quote with date/time should create and send booking draft link')

  const blankFieldCustomer = `sim-test-blank-${RUN_ID}`
  await send(blankFieldCustomer, '哈喽，想做美甲', [], { forceAi: true })
  await send(blankFieldCustomer, [
    '1. 项目类型：美甲',
    '2. 想做日期和时间：2026-07-03 14:00',
    '3. 是否需要卸甲：需要',
    '4. 是否需要延长：需要',
    '5. 是否有断甲需要修补：',
    '6. 是否有参考图：有的话请直接发图；没有也可以写“无图”',
    '7. 其他备注：贝母款'
  ].join('\n'), [IMAGE_A], { forceAi: true })
  const blankQuote = await latestQuoteFor(blankFieldCustomer)
  assert(blankQuote, 'blank field quote should still create quote request after enough intake info')
  const blankIntake = blankQuote.styleElements?.quoteIntake || {}
  assert(blankQuote.repairNeeded === 'unknown' || blankIntake.repairNeeded === 'unknown', 'blank repair field should stay unknown')
  assert(!blankIntake.noReferenceImage, 'template label should not mark noReferenceImage when image exists')
  conversation = await conversationByExternalId(blankFieldCustomer)
  assert(!/有断甲修补|无参考图/.test(transcriptText(conversation)), 'assistant should not invent blank repair or no-image summary')

  await request(`/admin/quote-requests/${blankQuote.id}/respond`, {
    method: 'POST',
    body: JSON.stringify({ staffMessage: '可以做，报价 CAD 238，预计两个半小时。' })
  })
  const quotedBlank = await latestQuoteFor(blankFieldCustomer)
  assert(quotedBlank.staffPriceCents === 23800, `staff price should parse CAD 238, got ${quotedBlank.staffPriceCents}`)
  assert(quotedBlank.staffDurationMin === 150, `staff duration should parse 两个半小时 as 150, got ${quotedBlank.staffDurationMin}`)

  await send(blankFieldCustomer, '那这周三吧', [], { forceAi: true })
  conversation = await conversationByExternalId(blankFieldCustomer)
  latestAssistant = latestAssistantText(conversation)
  assert(!/项目类型：美甲|按下面格式/.test(latestAssistant), 'date follow-up after quote should not restart quote intake template')
  assert(/时间|几点|预约草稿|空位/.test(latestAssistant), 'date follow-up after quote should continue booking-time flow')

  await send(blankFieldCustomer, '下午两点', [], { forceAi: true })
  conversation = await conversationByExternalId(blankFieldCustomer)
  latestAssistant = latestAssistantText(conversation)
  assert(!/项目类型：美甲|按下面格式/.test(latestAssistant), 'time follow-up after quote should not restart quote intake template')
  assert(/预约草稿|链接|空位|时间/.test(latestAssistant), 'time follow-up after quote should continue booking slot/draft flow')

  const looseDateCustomer = `sim-test-loosedate-${RUN_ID}`
  await send(looseDateCustomer, '想做美甲，问这个款', [IMAGE_A], { forceAi: true })
  await send(looseDateCustomer, [
    '1. 项目类型：美甲',
    '2. 想做日期和时间：7.6 下午3点',
    '3. 是否需要卸甲：不用',
    '4. 是否需要延长：本甲',
    '5. 是否有断甲需要修补：没有',
    '6. 是否有参考图：有',
    '7. 其他备注：想自然一点'
  ].join('\n'), [], { forceAi: true })
  const looseDateQuote = await latestQuoteFor(looseDateCustomer)
  assert(looseDateQuote, 'loose month/day intake should create quote request')
  const looseIntake = looseDateQuote.styleElements?.quoteIntake || {}
  const expectedLooseDate = expectedUpcomingDate(7, 6)
  assert(looseIntake.bookingDate === expectedLooseDate, `loose 7.6 date should parse as ${expectedLooseDate}, got ${looseIntake.bookingDate}`)
  assert(looseIntake.bookingTime === '15:00', `loose 下午3点 should parse as 15:00, got ${looseIntake.bookingTime}`)

  const firstLashCustomer = `sim-test-firstlash-${RUN_ID}`
  await send(firstLashCustomer, '想约美睫，问自然款价格', [], { forceAi: true })
  await send(firstLashCustomer, [
    '1. 项目类型：美睫',
    '2. 想做款式：自然款',
    '3. 是否需要下睫毛：不需要',
    '4. 是否需要卸睫：不需要',
    '5. 想做日期和时间：7.6 13:00',
    '6. 是否第一次做美睫 / 眼睛是否容易敏感：第一次做，没有眼部不适',
    '7. 其他备注：想自然一点'
  ].join('\n'), [], { forceAi: true })
  const firstLashQuote = await latestQuoteFor(firstLashCustomer)
  assert(firstLashQuote, 'first-time lash intake should create quote request')
  const firstLashIntake = firstLashQuote.styleElements?.quoteIntake || {}
  assert(firstLashIntake.firstLashVisit === 'yes' || firstLashQuote.firstLashVisit === 'yes', `first lash visit should be captured, got ${firstLashIntake.firstLashVisit || firstLashQuote.firstLashVisit}`)
  await request(`/admin/quote-requests/${firstLashQuote.id}/respond`, {
    method: 'POST',
    body: JSON.stringify({ staffMessage: '可以做，自然款 CAD 80，大概 120 分钟。' })
  })
  const firstLashConversation = await conversationByExternalId(firstLashCustomer)
  const firstLashTranscript = transcriptText(firstLashConversation)
  assert(/第一次做美睫的小提醒/.test(firstLashTranscript), 'first-time lash staff quote should append first-time lash notice')
  assert(!/美瞳|隐形眼镜|护理盒/.test(firstLashTranscript), 'first-time lash notice should not mention contact lenses or lens case')

  console.log('[working-memory] all regression checks passed')
}

main().catch((error) => {
  console.error('[working-memory] failed:', error.message)
  process.exit(1)
})
