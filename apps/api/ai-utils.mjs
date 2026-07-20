const DEFAULT_MODEL = process.env.AI_MODEL || 'mock-affordable-ai'
const DEFAULT_PROVIDER = process.env.AI_PROVIDER || (process.env.AI_API_KEY ? 'openai-compatible' : 'mock')
const AI_BASE_URL = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
const AI_API_KEY = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || ''
const AI_REQUIRE_REAL = process.env.AI_REQUIRE_REAL === 'true'

function clip(value, max = 800) {
  return String(value || '').slice(0, max)
}

function jsonBlock(value) {
  return JSON.stringify(value, null, 2)
}

function bilingual(zh, en, lang = 'zh') {
  return lang === 'en' ? en : zh
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

function imageHints(images = []) {
  if (!images.length) return 'No image was provided.'
  return `${images.length} image(s) were provided. The first image data length is ${String(images[0] || '').length}.`
}

// 单次模型调用超时(毫秒):超时会抛错 → aiJson 落到 fallback,前端不再无限"生成中"
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 45000)
// 附图上限:超大 base64(手机原图动辄数 MB)不塞给模型——文本模型处理不了且会拖死请求;
// 文案生成有 imageHints 文字提示兜底,不影响产出。
const AI_IMAGE_MAX_CHARS = 300000

async function callOpenAICompatible({ system, user, schema, images = [], temperature = 0.4 }) {
  if (!AI_API_KEY) return null
  const content = [{ type: 'text', text: `${user}\n\nReturn compact JSON only. Schema:\n${jsonBlock(schema)}` }]
  // 仅当模型支持视觉(AI_VISION_MODEL=true)才附图:当前 qwen3.6-plus 为纯文本模型,
  // 附 image_url 会被直接拒绝/大图拖死请求;文字侧已有 imageHints 提示,不影响文案产出。
  if (process.env.AI_VISION_MODEL === 'true') {
    for (const image of images.slice(0, 3)) {
      if (typeof image === 'string' && image.startsWith('data:image') && image.length <= AI_IMAGE_MAX_CHARS) {
        content.push({ type: 'image_url', image_url: { url: image } })
      }
    }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)
  let response
  try {
    response = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${AI_API_KEY}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature,
        response_format: { type: 'json_object' },
        // 思考型模型(qwen3 系列)默认会先输出长思考链,拖慢响应且烧 token;
        // 客服/文案类任务不需要,显式关闭(AI_ENABLE_THINKING=true 可重新打开)
        enable_thinking: process.env.AI_ENABLE_THINKING === 'true',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content }
        ]
      })
    })
  } catch (error) {
    throw new Error(error && error.name === 'AbortError' ? `AI provider timeout after ${AI_TIMEOUT_MS}ms` : (error.message || 'AI provider fetch failed'))
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`AI provider failed: ${response.status} ${detail.slice(0, 220)}`)
  }
  const data = await response.json()
  const text = data.choices?.[0]?.message?.content || '{}'
  return JSON.parse(text)
}

async function aiJson({ system, user, schema, images, fallback, temperature }) {
  if (DEFAULT_PROVIDER !== 'mock') {
    try {
      const data = await callOpenAICompatible({ system, user, schema, images, temperature })
      if (data) return { provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL, data }
    } catch (error) {
      if (AI_REQUIRE_REAL) throw error
      return { provider: `${DEFAULT_PROVIDER}-fallback`, model: DEFAULT_MODEL, data: fallback(String(error.message || error)) }
    }
  }
  if (AI_REQUIRE_REAL) {
    throw new Error('AI_REQUIRE_REAL is true, but no real AI provider/API key is configured.')
  }
  return { provider: 'mock', model: DEFAULT_MODEL, data: fallback() }
}

function hashSeed(value = '') {
  let hash = 0
  for (const char of String(value)) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0
  return Math.abs(hash)
}

function includesUsedCopy(variant, used = []) {
  const combined = `${variant.titleZh || ''}\n${variant.captionZh || ''}\n${variant.titleEn || ''}\n${variant.captionEn || ''}`.toLowerCase()
  return used.some((item) => {
    const text = String(item || '').toLowerCase().trim()
    return text && (combined.includes(text.slice(0, 80)) || text.includes(String(variant.titleZh || '').toLowerCase()))
  })
}

function pickUniqueVariant(variants, seed, used = []) {
  const available = variants.filter((variant) => !includesUsedCopy(variant, used))
  const pool = available.length ? available : variants
  return pool[hashSeed(seed || Date.now()) % pool.length]
}

export async function analyzeReferenceImage({ lang = 'zh', images = [], service = {}, notes = '' }) {
  const schema = {
    type: 'nail|lash|unknown',
    styleTags: ['string'],
    complexity: 'low|medium|high',
    estimatedExtraMinutes: 0,
    estimatedPriceCents: 0,
    manualQuoteRequired: false,
    priceMessageZh: 'string',
    priceMessageEn: 'string',
    recommendedServiceNames: ['string'],
    addOnSuggestions: ['string'],
    clientMessageZh: 'string',
    clientMessageEn: 'string',
    technicianNotesZh: 'string',
    technicianNotesEn: 'string'
  }
  return aiJson({
    system: 'You are a bilingual nail and lash atelier assistant. Analyze beauty reference images conservatively. Never promise final pricing.',
    user: `Analyze reference images for a booking. Service: ${jsonBlock(service)}. Notes: ${clip(notes)}. ${imageHints(images)}`,
    schema,
    images,
    fallback: () => ({
      type: String(service.type || '').toLowerCase().includes('lash') ? 'lash' : 'nail',
      styleTags: service.category ? [service.category, bilingual('自然高级', 'soft luxury', lang)] : [bilingual('自然高级', 'soft luxury', lang)],
      complexity: images.length > 1 ? 'medium' : 'low',
      estimatedExtraMinutes: images.length > 1 ? 30 : 0,
      estimatedPriceCents: Number(service.priceCents || 0) + (String(service.type || '').toLowerCase() === 'nail' && images.length > 1 ? 3000 : 0),
      manualQuoteRequired: String(service.type || '').toLowerCase() === 'nail' && images.length > 1,
      priceMessageZh: String(service.type || '').toLowerCase() === 'nail'
        ? (images.length > 1 ? 'AI 认为该款式可能涉及复杂度或加项，建议联系客服人工确认最终报价。' : 'AI 初步判断可从基础价开始，最终是否加项需到店或人工确认。')
        : '美睫为固定报价，当前款式价格加明确加项后即为最终报价。',
      priceMessageEn: String(service.type || '').toLowerCase() === 'nail'
        ? (images.length > 1 ? 'AI suggests this design may need add-ons or manual quote confirmation.' : 'AI suggests this can start from the base price; final add-ons should be confirmed in store or by staff.')
        : 'Lash pricing is fixed. The style price plus selected add-ons is the final quote.',
      recommendedServiceNames: [service.name || service.nameZh || bilingual('推荐同类服务', 'Recommended matching service', lang)],
      addOnSuggestions: images.length > 1 ? [bilingual('建议预留延长服务时间', 'Reserve extra service time', lang)] : [bilingual('到店后由技师确认细节', 'Technician confirms details in store', lang)],
      clientMessageZh: 'AI 初步判断该参考图适合当前服务。最终款式、耗时和加项请以到店沟通为准。',
      clientMessageEn: 'AI suggests this reference fits the selected service. Final design, time, and add-ons will be confirmed in store.',
      technicianNotesZh: '请重点确认图片复杂度、颜色还原和是否需要额外加项时间。',
      technicianNotesEn: 'Confirm complexity, color matching, and whether extra time is needed.'
    })
  })
}

export async function createBookingSummary({ lang = 'zh', booking }) {
  const schema = {
    headlineZh: 'string',
    headlineEn: 'string',
    preparationZh: ['string'],
    preparationEn: ['string'],
    riskLevel: 'low|medium|high',
    risksZh: ['string'],
    risksEn: ['string']
  }
  return aiJson({
    system: 'You summarize beauty bookings for salon owners and technicians. Be practical and concise.',
    user: `Summarize this booking for technician prep:\n${jsonBlock(booking)}`,
    schema,
    images: booking?.referenceImages || [],
    fallback: () => ({
      headlineZh: `${booking?.service?.name || '服务'} · ${booking?.appointmentDate || ''} ${booking?.appointmentTime || ''}`,
      headlineEn: `${booking?.service?.name || 'Service'} · ${booking?.appointmentDate || ''} ${booking?.appointmentTime || ''}`,
      preparationZh: ['确认客户备注与参考图', '预留定金与尾款信息', '服务前再次确认款式细节'],
      preparationEn: ['Review client notes and references', 'Check deposit and final due', 'Confirm design details before service'],
      riskLevel: (booking?.referenceImages || []).length ? 'medium' : 'low',
      risksZh: (booking?.referenceImages || []).length ? ['参考图可能影响实际服务时长'] : ['暂无明显风险'],
      risksEn: (booking?.referenceImages || []).length ? ['Reference image may affect service duration'] : ['No obvious risk']
    })
  })
}

export async function createCustomerInsight({ lang = 'zh', customer, bookings = [] }) {
  const schema = {
    summaryZh: 'string',
    summaryEn: 'string',
    preferenceTags: ['string'],
    nextRecommendationZh: 'string',
    nextRecommendationEn: 'string',
    retentionActionZh: 'string',
    retentionActionEn: 'string',
    churnRisk: 'low|medium|high'
  }
  return aiJson({
    system: 'You analyze salon customer profiles for owner CRM. Keep suggestions ethical and service-oriented.',
    user: `Customer:\n${jsonBlock(customer)}\nBookings:\n${jsonBlock(bookings.slice(0, 8))}`,
    schema,
    fallback: () => ({
      summaryZh: `${customer?.displayName || customer?.email || '该客户'}目前累计到店 ${customer?.visitCount || bookings.length || 0} 次。`,
      summaryEn: `${customer?.displayName || customer?.email || 'This client'} has ${customer?.visitCount || bookings.length || 0} visit(s).`,
      preferenceTags: [...new Set(bookings.map((item) => item.service?.category).filter(Boolean))].slice(0, 4),
      nextRecommendationZh: '建议根据最近一次服务款式推荐同色系或同风格升级项目。',
      nextRecommendationEn: 'Recommend a similar tone or upgraded style based on the latest service.',
      retentionActionZh: bookings.length ? '可在下次到店前 3-4 周发送温和提醒。' : '可发送新人预约提醒或首单优惠说明。',
      retentionActionEn: bookings.length ? 'Send a gentle reminder 3-4 weeks before the next expected visit.' : 'Send a first-booking reminder or intro offer.',
      churnRisk: bookings.length ? 'low' : 'medium'
    })
  })
}

export async function createDailyBrief({ lang = 'zh', bookings = [], customers = [], services = [] }) {
  const schema = {
    headlineZh: 'string',
    headlineEn: 'string',
    actionsZh: ['string'],
    actionsEn: ['string'],
    opportunitiesZh: ['string'],
    opportunitiesEn: ['string'],
    risksZh: ['string'],
    risksEn: ['string']
  }
  return aiJson({
    system: 'You are an operations analyst for a nail and lash atelier. Give concise daily owner actions.',
    user: `Bookings:\n${jsonBlock(bookings.slice(0, 30))}\nCustomers:\n${jsonBlock(customers.slice(0, 20))}\nServices:\n${jsonBlock(services.slice(0, 20))}`,
    schema,
    fallback: () => {
      const pending = bookings.filter((item) => item.status === 'PENDING_PAYMENT').length
      const today = bookings.filter((item) => item.appointmentDate === new Date().toISOString().slice(0, 10)).length
      return {
        headlineZh: `今日 ${today} 个预约，${pending} 个待支付需要跟进。`,
        headlineEn: `${today} booking(s) today, ${pending} pending payment(s) need follow-up.`,
        actionsZh: ['优先检查今日预约的备注和参考图', '确认待支付订单是否需要提醒客户', '检查技师排班是否与服务时长匹配'],
        actionsEn: ['Review today booking notes and references', 'Follow up pending payments if needed', 'Check technician schedule against service duration'],
        opportunitiesZh: ['可把完工作品沉淀到图库并生成社媒文案', '对近期完成服务的客户做复购提醒'],
        opportunitiesEn: ['Archive finished work and generate social captions', 'Send rebooking reminders to recently completed clients'],
        risksZh: pending ? ['待支付订单可能占用时段'] : ['暂无明显运营风险'],
        risksEn: pending ? ['Pending payments may hold time slots'] : ['No obvious operational risk']
      }
    }
  })
}

function sampleTokens(value = '') {
  return new Set(String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 2))
}

function messageSignals(value = '') {
  const lower = String(value || '').toLowerCase()
  return {
    pricing: /价|钱|报价|价格|多少钱|price|quote|cost|how much/.test(lower),
    reference: /图|图片|参考图|款式|复杂|手绘|延长|珍珠|饰品|卸甲|断甲|reference|design|custom|extension|removal|rhinestone|pearl/.test(lower),
    booking: /预约|时间|技师|book|booking|appointment|slot|time|artist|technician/.test(lower),
    policy: /取消|改期|退款|售后|迟到|cancel|reschedule|refund|late|after.?sales/.test(lower),
    store: /地址|电话|营业|门店|where|address|hour|phone|location/.test(lower)
  }
}

function hasSharedSignal(messageSignals, sampleSignals) {
  return Object.keys(messageSignals).some((key) => messageSignals[key] && sampleSignals[key])
}

function isLowSignalMessage(value = '') {
  const compact = String(value || '').trim().toLowerCase().replace(/\s+/g, '')
  if (!compact) return true
  if (/^(hi|hello|hey|哈喽|哈咯|你好|您好|嗨|在吗|hello呀|hi呀|早|早呀|晚上好|下午好)[。.!！?？]*$/.test(compact)) return true
  return compact.length < 4 && !/[价钱图款约改退店址]/.test(compact)
}

function historyLine(item = {}) {
  const role = item.role === 'assistant' ? 'AI' : item.role === 'staff' ? 'Staff' : 'Customer'
  const content = String(item.content || '').trim()
  return content ? `${role}: ${content}` : ''
}

function recentHistoryText(history = [], max = 8) {
  return (history || [])
    .slice(-max)
    .map(historyLine)
    .filter(Boolean)
    .join('\n')
}

function lastCustomerText(history = []) {
  for (let index = (history || []).length - 1; index >= 0; index -= 1) {
    const item = history[index] || {}
    if (item.role !== 'assistant' && String(item.content || '').trim()) return String(item.content || '').trim()
  }
  return ''
}

function isContextualFollowup(value = '') {
  const compact = String(value || '').trim().toLowerCase().replace(/\s+/g, '')
  if (!compact) return false
  return /^(那|这个|这款|刚刚|上面|前面|它|她|他|可以吗|能做吗|多少钱|价格呢|怎么约|多久|需要定金吗|ok|好呀|好的|可以|yes|okey|howmuch|whataboutthis|canidoit)/.test(compact)
}

function bestOwnerApprovedSample(message = '', samples = []) {
  if (isLowSignalMessage(message)) return null
  const messageTokens = sampleTokens(message)
  const currentSignals = messageSignals(message)
  let best = null
  let bestScore = 0
  for (const sample of samples || []) {
    const sampleText = `${sample.customerMessage || ''} ${sample.notes || ''}`
    const sampleSignals = messageSignals(sampleText)
    const tokens = sampleTokens(sampleText)
    let score = 0
    let signalScore = 0
    for (const key of Object.keys(currentSignals)) {
      if (currentSignals[key] && sampleSignals[key]) {
        signalScore += 1
        score += key === 'pricing' || key === 'reference' ? 3 : 2
      }
    }
    for (const token of tokens) {
      if (messageTokens.has(token)) score += 1
    }
    if (!signalScore && !hasSharedSignal(currentSignals, sampleSignals) && score < 5) continue
    if (score > bestScore) {
      best = sample
      bestScore = score
    }
  }
  return bestScore >= 6 ? best : null
}

export async function createCustomerServiceReply({ lang = 'zh', message = '', sampleMatchMessage = message, history = [], customer = null, bookings = [], services = [], stores = [], knowledgeContext = null }) {
  const schema = {
    intent: 'booking|pricing|policy|order|store|portfolio|handoff|unknown',
    answerZh: 'string',
    answerEn: 'string',
    handoffRequired: false,
    handoffReasonZh: 'string',
    handoffReasonEn: 'string',
    suggestedActions: ['string'],
    suggestedQuestionsZh: ['string'],
    suggestedQuestionsEn: ['string']
  }
  const activeServices = services.slice(0, 20).map((service) => ({
    id: service.id,
    type: service.type,
    name: service.name,
    category: service.category,
    priceLabelZh: service.priceLabelZh,
    priceLabelEn: service.priceLabelEn,
    quoteHintZh: service.quoteHintZh,
    quoteHintEn: service.quoteHintEn,
    depositCents: service.depositCents,
    durationMin: service.durationMin,
    requiresManualQuote: service.requiresManualQuote
  }))
  const knowledgePrompt = knowledgeContext
    ? (lang === 'en' ? knowledgeContext.promptTextEn : knowledgeContext.promptTextZh)
    : ''
  const recentChatText = recentHistoryText(history)
  const previousCustomerText = lastCustomerText(history)
  const result = await aiJson({
    system: [
      'You are Lucky Luxe AI customer service for a nail and lash atelier in Ontario.',
      'Answer in the user language. Be concise, warm, and operationally accurate.',
      'Always use Recent chat as short-term conversation memory. If the incoming message is a follow-up such as "那这个呢", "多少钱", "可以吗", or "怎么约", resolve it from the previous customer messages before answering.',
      'If the incoming message includes "Working memory for this exact conversation", treat it as authoritative per-conversation state. Do not ask again for any intake field already marked yes/no/partial in that memory.',
      'If a staff/manual reply appears in Recent chat or Working memory, remember it as part of the conversation and continue from that status after the handoff window.',
      'Never infer facts from blank intake-form labels. If the customer sends "是否有断甲需要修补：" with no answer, that field is unknown, not yes. If images were already received in memory, do not say the customer has no reference image.',
      'If Working memory says quoteStage is quoted or draft_created and the customer sends a date, time, confirmation, or follow-up question, continue the booking-time/draft flow. Do not restart the quote-intake template.',
      'Use the provided knowledge context first. Platform preset knowledge is generic. Exact member rules, deposits, store policies, service prices, staff, and promotions are tenant-private and must not be treated as platform defaults.',
      'Owner-approved examples are style and policy references only. Use them only when the customer message clearly matches the same intent and details; never copy a quote/pricing example for a greeting or low-information message.',
      knowledgePrompt ? `Knowledge context:\n${knowledgePrompt}` : 'No structured knowledge context was provided; answer conservatively and route uncertain business-policy questions to human staff.',
      'Nail pricing has two layers only for now: base price plus technician-confirmed quote, then possible in-store final adjustment. Never give a final AI nail price. For custom/reference-image nail requests, collect key elements and mark handoffRequired true for technician quotation.',
      'For nail quote intake, collect: natural nail vs extension, removal needed, broken nail repair, charms/rhinestones/hand-painting, preferred color/style, reference images, preferred date/time, and notes.',
      'Lash services use fixed prices plus explicit add-ons. Always ask whether lower lashes are needed, and ask about recent eye surgery within 3 months or current eye irritation/conjunctivitis before confirming suitability.',
      'Reschedule/cancellation and after-sales issues must route to human staff. More than 24h before appointment can cancel/reschedule with deposit refund; same-day cancellation/reschedule is not supported in the final policy and deposit is not refunded. Use a gentle tone.',
      'Quote workflow: after enough info is collected, tell the customer a technician normally replies within 10 minutes; once quoted, offer to create a booking draft; draft holds for 30 minutes, with a payment reminder before release.',
      'Do not process real payment or create bookings in this reply. Suggest the next app action instead.'
    ].join('\\n'),
    user: `Incoming message: ${clip(message, 1200)}\nPrevious customer message: ${clip(previousCustomerText, 600)}\nRecent chat:\n${recentChatText || jsonBlock((history || []).slice(-8))}\nCustomer:\n${jsonBlock(customer || {})}\nRecent bookings:\n${jsonBlock((bookings || []).slice(0, 6))}\nServices:\n${jsonBlock(activeServices)}\nStores:\n${jsonBlock((stores || []).slice(0, 3))}`,
    schema,
    temperature: 0.55,
    fallback: () => {
      const approvedSample = bestOwnerApprovedSample(sampleMatchMessage, knowledgeContext?.ownerApprovedSamples || [])
      if (approvedSample?.correctedReply) {
        return {
          intent: approvedSample.intent || 'unknown',
          answerZh: approvedSample.correctedReply,
          answerEn: approvedSample.correctedReply,
          handoffRequired: /转|人工|技师|报价|确认|quote|staff|technician/i.test(approvedSample.correctedReply),
          handoffReasonZh: approvedSample.notes || '',
          handoffReasonEn: approvedSample.notes || '',
          suggestedActions: [],
          suggestedQuestionsZh: ['可以发参考图吗？', '可以帮我创建预约草稿吗？'],
          suggestedQuestionsEn: ['Can I send a reference photo?', 'Can you create a booking draft?']
        }
      }
      const text = String(sampleMatchMessage || message || '').toLowerCase()
      const enrichedText = String(message || '').toLowerCase()
      const memoryText = `${recentChatText}\n${previousCustomerText}\n${message}`.toLowerCase()
      const contextualFollowup = isContextualFollowup(sampleMatchMessage || message)
      const hasPriorReferenceImage = /customer_uploaded_reference_images|顾客已上传|参考图|图片|reference image|reference photo/.test(memoryText)
      const hasReferenceImageContext = /顾客已上传|reference image|reference photo/.test(enrichedText) || (contextualFollowup && hasPriorReferenceImage)
      const asksPrice = /价|钱|报价|price|quote|cost|how much/.test(text)
      const asksBooking = /预约|book|appointment|slot|time/.test(text)
      const asksPolicy = /取消|改期|改时间|换时间|退款|迟到|cancel|reschedule|refund|late/.test(text)
      const asksDeposit = /定金|deposit/.test(text)
      const asksStore = /地址|电话|营业|时间|where|address|hour|phone/.test(text)
      const asksOrder = /订单|order|booking|my appointment/.test(text)
      const memoryMentionsNail = /美甲|甲|nail|法式|贝母|渐变|延长|卸甲|断甲|手绘|饰品/.test(memoryText)
      const memoryMentionsLash = /美睫|睫|lash|下睫毛|嫁接|浓密|自然睫/.test(memoryText)
      const currentMentionsService = /美甲|美睫|nail|lash|法式|贝母|渐变|裸感|自然睫|浓密睫|款式|做这个|做这款/.test(text)
      const nailServices = activeServices.filter((service) => service.type === 'nail')
      const lashServices = activeServices.filter((service) => service.type === 'lash')
      const firstStore = stores[0] || {}
      let answerZh = '我可以帮你查询服务、预约流程、定金规则、取消改期和作品集。你也可以直接告诉我想做美甲还是美睫。'
      let answerEn = 'I can help with services, booking flow, deposit rules, cancellation/reschedule policy, and portfolio questions. You can tell me whether you want nails or lashes.'
      let intent = 'unknown'
      let handoffRequired = false
      let handoffReasonZh = ''
      let handoffReasonEn = ''
      const suggestedActions = []
      if (asksPrice || hasReferenceImageContext || currentMentionsService) {
        intent = 'pricing'
        handoffRequired = hasReferenceImageContext || (memoryMentionsNail && /图|图片|参考图|款式|复杂|手绘|延长|reference|design|custom|可以吗|能做吗/.test(`${text}\n${memoryText}`))
        handoffReasonZh = handoffRequired ? '美甲复杂款式需要根据参考图、材料和加项人工确认最终报价。' : ''
        handoffReasonEn = handoffRequired ? 'Custom nail designs need staff confirmation based on reference, materials, and add-ons.' : ''
        if (memoryMentionsLash && !memoryMentionsNail) {
          answerZh = `我接着你前面说的美睫来回答：美睫是固定价格，选择款式和明确加项后就是最终报价；预约前还需要确认是否需要下睫毛，以及近 3 个月是否有眼部手术、当前是否有眼部不适或结膜炎。新客/Silver 会员预约定金为 CAD $50，Gold 及以上通常可免定金。`
          answerEn = 'For the lash service you mentioned: lash pricing is fixed, and the selected style plus confirmed add-ons is the final quote. We also need to confirm whether you need lower lashes, and whether you had eye surgery in the last 3 months or have current irritation/conjunctivitis. Silver/new customers pay CAD $50 deposit; Gold and above usually have deposit waived.'
        } else if (memoryMentionsNail || hasReferenceImageContext) {
          answerZh = `我接着你前面说的美甲/参考图来回答：美甲可以先参考基础价，但复杂款式、手绘、延长、卸甲、断甲修补、特殊材料或参考图款式都需要技师确认报价，到店后细节仍可能微调。你可以把是否需要延长、卸甲、修补断甲、贴饰品/珍珠/手绘这些信息一起发我，我会整理给技师确认。新客/Silver 会员预约定金为 CAD $50，Gold 及以上通常可免定金。`
          answerEn = 'For the nail/reference style you mentioned: nail services can start from a base price, but custom designs, hand painting, extensions, removal, repairs, special materials, or reference-image styles need a technician quote and may still be adjusted in store. You can tell me whether extensions, removal, broken-nail repair, charms/pearls/hand painting are needed, and I will organize it for the technician. Silver/new customers pay CAD $50 deposit; Gold and above usually have deposit waived.'
        } else {
          answerZh = `美甲可以先参考基础价，但复杂款式、手绘、延长、卸甲、断甲修补、特殊材料或参考图款式都需要技师确认报价，到店后细节仍可能微调。美睫是固定价格，加项确认后就是最终报价；请同时告诉我是否需要下睫毛。新客/Silver 会员预约定金为 CAD $50，Gold 及以上会员通常可免定金。`
          answerEn = 'Nail services show base prices, but custom designs, hand painting, extensions, removal, repairs, special materials, or reference-image styles require a technician quote and may be adjusted in store. Lash services use fixed pricing plus selected add-ons; please also tell us whether you need lower lashes. Silver/new customers pay CAD $50 deposit; Gold and above usually have deposit waived.'
        }
        suggestedActions.push('open_services')
      } else if (asksPolicy) {
        intent = 'policy'
        handoffRequired = true
        handoffReasonZh = '取消、改期和售后需要人工确认具体订单与技师排班。'
        handoffReasonEn = 'Cancellation, rescheduling, and after-sales issues require staff confirmation.'
        answerZh = '改期或取消需要帮您转人工确认订单和技师排班。一般规则是提前 24 小时以上可以免费改期/取消；预约当天不支持取消或改期，迟到 30 分钟会自动取消且定金不退。我会帮您转给工作人员确认。'
        answerEn = 'Rescheduling or cancellation needs staff confirmation for your order and technician schedule. In general, more than 24 hours before the appointment can be changed/cancelled free of charge; same-day changes/cancellations are not supported, and being 30 minutes late cancels the booking with deposit non-refundable. I will route this to staff.'
      } else if (asksDeposit) {
        intent = 'deposit_policy'
        const depositFacts = knowledgeContext?.tenantFacts || {}
        const rawDeposit = depositFacts.depositAmount
        const depositAmount = typeof rawDeposit === 'number' || /^\d+(\.\d+)?$/.test(String(rawDeposit || ''))
          ? `${depositFacts.currency || 'CAD'} $${rawDeposit}`
          : (rawDeposit || 'CAD $50')
        answerZh = `预约需要支付定金哦：新客/Silver 会员定金为 ${depositAmount}，到店消费时可以抵扣尾款；Gold 及以上会员通常可以免定金。预约时间在定金支付成功（或满足免定金条件）后才会正式锁定。`
        answerEn = `A booking deposit is required: new/Silver customers pay ${depositAmount}, which is deducted from the final balance in store; Gold members and above are usually deposit-free. Your slot is locked only after the deposit is paid or a valid waiver applies.`
      } else if (asksBooking) {
        intent = 'booking'
        const serviceContextZh = memoryMentionsLash && !memoryMentionsNail ? '你前面提到的是美睫，' : memoryMentionsNail ? '你前面提到的是美甲，' : ''
        const serviceContextEn = memoryMentionsLash && !memoryMentionsNail ? 'For the lash service you mentioned, ' : memoryMentionsNail ? 'For the nail service you mentioned, ' : ''
        answerZh = `${serviceContextZh}你可以先选择对应服务，再选择日期、时间和技师。一个预约只能包含一个服务；如果同时做美甲和美睫，需要分开下两个订单。预约草稿会锁定 30 分钟；Silver/新客需要支付 CAD $50 定金，Gold 及以上通常可免定金。`
        answerEn = `${serviceContextEn}choose the matching service, then select date, time, and artist. One booking contains one service only; nails and lashes need separate bookings. A booking draft holds for 30 minutes. Silver/new customers pay CAD $50 deposit; Gold and above usually have deposit waived.`
        suggestedActions.push('open_services')
      } else if (asksStore) {
        intent = 'store'
        const tenantFacts = knowledgeContext?.tenantFacts || {}
        const storeAddressUsable = firstStore.address && !/tbd/i.test(firstStore.address) ? firstStore.address : ''
        const address = tenantFacts.storeAddress || storeAddressUsable || firstStore.address || '136 veterans place'
        const hoursFact = tenantFacts.defaultHours
        const liveHoursZh = (hoursFact && typeof hoursFact === 'object' ? hoursFact.zh : hoursFact) || '周二至周日 10:00-19:00，周一休息'
        const liveHoursEn = (hoursFact && typeof hoursFact === 'object' ? hoursFact.en : hoursFact) || 'Tuesday to Sunday 10:00-19:00, Monday closed'
        answerZh = `${firstStore.name || 'Lucky Luxe Ontario'} 营业时间为${liveHoursZh}。当前门店地址先按 ${address}。`
        answerEn = `${firstStore.name || 'Lucky Luxe Ontario'} business hours: ${liveHoursEn}. Current store address: ${address}.`
      } else if (asksOrder) {
        intent = 'order'
        if (customer && bookings.length) {
          const latest = bookings[0]
          answerZh = `我看到你最近的预约是 ${latest.service?.name || '服务'}，时间 ${latest.appointmentDate || ''} ${latest.appointmentTime || ''}，状态是 ${latest.status || '-' }。`
          answerEn = `Your latest booking is ${latest.service?.name || 'service'} on ${latest.appointmentDate || ''} ${latest.appointmentTime || ''}, status ${latest.status || '-'}.`
        } else {
          answerZh = '订单查询需要先登录账号。登录后我可以根据你的预约记录回答。'
          answerEn = 'Order lookup requires sign-in. After login, I can answer based on your booking records.'
          suggestedActions.push('login')
        }
      }
      return {
        intent,
        answerZh,
        answerEn,
        handoffRequired,
        handoffReasonZh,
        handoffReasonEn,
        suggestedActions,
        suggestedQuestionsZh: ['美甲复杂款怎么报价？', '怎么预约？', '取消和改期规则是什么？'],
        suggestedQuestionsEn: ['How are custom nail designs quoted?', 'How do I book?', 'What is the cancellation policy?']
      }
    }
  })
  return { ...result, knowledgeContext }
}

export async function polishStaffQuoteReply({ lang = 'zh', quote = {}, staffMessage = '' }) {
  const schema = {
    canDo: true,
    answerZh: 'string',
    answerEn: 'string',
    extractedPriceCad: 'string',
    extractedDurationMin: 'string',
    suggestedActions: ['string']
  }
  const referenceImageCount = Array.isArray(quote.referenceImages) ? quote.referenceImages.length : 0
  return aiJson({
    system: [
      'You are Lucky Luxe AI customer service.',
      'A technician has replied internally with a free-text note. Your ONLY job is to connect the technician\'s words into warm, fluent, complete sentences.',
      'You must preserve every fact, number, price, duration, condition, and suggestion from the technician message verbatim. Never paraphrase away content, never change the meaning, never drop details, never add facts the technician did not mention.',
      'If the technician says the style CANNOT be done, apologize gently, state it clearly (do not soften it into "needs more information"), and guide the customer to consider a similar or simpler alternative style and send a new reference photo.',
      'If the technician needs more information, relay exactly what is missing.',
      'If styleElements.quoteIntake already contains bookingDate and bookingTime, do NOT ask the customer to repeat the date/time; reference the time they already gave.',
      'Final nail details may still be adjusted in store based on actual nail condition.'
    ].join('\n'),
    user: `Customer quote request:\n${jsonBlock({
      quoteRequestId: quote.id,
      serviceType: quote.serviceType,
      sourceChannel: quote.sourceChannel,
      customerMessage: quote.customerMessage,
      referenceImageCount,
      styleElements: quote.styleElements,
      missingQuestions: quote.missingQuestions
    })}\n\nTechnician internal message:\n${clip(staffMessage, 1200)}\n\nReturn customer-facing bilingual JSON.`,
    schema,
    // Quote polishing only needs the technician's text and quote metadata.
    // Passing customer photos here makes this step slower and can fail when a
    // stored image is too small or in a provider-specific unsupported format.
    images: [],
    temperature: 0.45,
    fallback: () => {
      const text = String(staffMessage || '').trim()
      const canDo = !/(不能|不可|不做|做不了|无法|\bno\b|\bcannot\b|\bcan't\b|\bnot\s+available\b)/i.test(text)
      const priceMatch = text.match(/(?:CAD\s*\$?\s*|\$\s*)(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:cad|加币|刀|块)/i)
      const durationMin = parseDurationMinutesFromText(text)
      const priceValue = priceMatch?.[1] || priceMatch?.[2] || ''
      const priceText = priceValue ? `CAD $${priceValue}` : ''
      const durationText = durationMin ? `${durationMin} 分钟` : ''
      const detailNoteZh = /珍珠|钻|饰品|细节|颜色|到店|确认/.test(text)
        ? '款式细节、饰品数量和实际甲面状态到店前会再帮您确认一次。'
        : '最终细节会根据到店时的实际甲面/睫毛状态确认。'
      const detailNoteEn = /pearl|rhinestone|charm|detail|color|confirm/i.test(text)
        ? 'Design details, charm quantity, and actual nail/lash condition will be confirmed again before service.'
        : 'Final details will be confirmed based on your actual nail/lash condition at the appointment.'
      const answerZh = [
        canDo ? '亲亲，技师确认这款可以做。' : '亲亲，技师确认这款暂时需要再补充信息后判断。',
        priceText ? `参考报价是 ${priceText}。` : '',
        durationText ? `预计服务时长约 ${durationText}。` : '',
        detailNoteZh,
        canDo ? '如果您想继续预约，请先把想约的日期和时间发我；确认时间后我再帮您生成预约草稿链接。' : '如果您愿意，也可以再发更清晰的参考图或调整需求，我再帮您整理给技师确认。'
      ].filter(Boolean).join(' ')
      const answerEn = [
        canDo ? 'The technician has reviewed it and confirmed this style can be done.' : 'The technician reviewed it and this style needs more confirmation.',
        priceText ? `Reference quote: ${priceText}.` : '',
        durationMin ? `Estimated duration: about ${durationMin} min.` : '',
        detailNoteEn,
        canDo ? 'If you would like to continue, please send your preferred date and time first. Once the time is confirmed, I can create the booking draft link.' : 'You can send a clearer reference photo or adjust the request, and I will organize it for the technician again.'
      ].filter(Boolean).join(' ')
      return {
        canDo,
        answerZh,
        answerEn,
        extractedPriceCad: priceText,
        extractedDurationMin: durationMin ? String(durationMin) : '',
        suggestedActions: canDo ? ['create_quote_draft'] : ['request_more_info']
      }
    }
  })
}

export async function extractKbEntriesFromDocument({ content = '', filename = '' }) {
  return aiJson({
    system: [
      'You are a beauty-salon knowledge-base assistant.',
      'The merchant uploaded a document (price list, service rules, FAQ, policies).',
      'Extract self-contained Q&A entries a customer-service AI can answer with.',
      'Each entry: question (short customer phrasing), keywords (comma separated trigger words), answerZh (use the document wording, do not invent), answerEn (translate).',
      'Only extract facts explicitly present in the document. Skip anything ambiguous.'
    ].join('\n'),
    user: `Document filename: ${filename}\n\nDocument content:\n${clip(content, 6000)}\n\nReturn JSON.`,
    schema: { entries: [{ question: 'string', keywords: 'string', answerZh: 'string', answerEn: 'string' }] },
    temperature: 0.2,
    fallback: () => null
  })
}

export async function createSocialCopy({ lang = 'zh', image = '', booking = {}, platform = 'xiaohongshu', audience = 'customer', avoidCaptions = [], variantSeed = '' }) {
  const schema = {
    platform: 'string',
    styleTags: ['string'],
    titleZh: 'string',
    captionZh: 'string',
    titleEn: 'string',
    captionEn: 'string',
    hashtags: ['string'],
    altTextZh: 'string',
    altTextEn: 'string'
  }
  return aiJson({
    system: 'You create tasteful bilingual social media copy for a nail and lash atelier. Adapt tone to each platform: RED should be experience-led and searchable, Douyin should be short with a strong hook, Instagram should be polished and visual-first. Avoid medical claims and exaggerated promises. Never repeat prior captions. Customer-facing copy should feel easy to share; staff-facing copy should help technicians or owners post efficiently.',
    user: `Create ${platform} copy for this finished work. Audience: ${audience}. Unique request seed: ${variantSeed || Date.now()}.\nAvoid reusing these prior captions or title angles:\n${jsonBlock((avoidCaptions || []).slice(-12))}\nBooking:\n${jsonBlock(booking)}\n${imageHints(image ? [image] : [])}`,
    schema,
    images: image ? [image] : [],
    temperature: 0.82,
    fallback: () => {
      const serviceName = booking?.service?.name || 'Lucky Luxe'
      const category = booking?.service?.category || 'soft luxury'
      const techName = booking?.technician?.name || booking?.technicianName || 'Lucky Luxe artist'
      const date = booking?.appointmentDate || ''
      const variants = {
        xiaohongshu: [
          {
            titleZh: `${serviceName}｜温柔高级感可以直接抄作业`,
            captionZh: `这组作品重点是干净、耐看，细节不会抢日常穿搭。\n\n${audience === 'staff' ? `${techName} 完成于 ${date || '本次预约'}，发布时可以强调“自然高级、可日常复制”。` : '喜欢精致但不夸张的客人可以先收藏，预约时直接给技师看。'}\n\n到店会根据肤色、手型或眼型再微调。`,
            titleEn: `${serviceName} | Soft Luxe Reference`,
            captionEn: 'Clean, wearable, and softly detailed. Save this Lucky Luxe look as a reference for your next appointment.',
            hashtags: ['#多伦多美甲', '#美睫分享', '#小红书美甲', '#温柔高级感', '#LuckyLuxe']
          },
          {
            titleZh: `${serviceName}｜低调但很显精致`,
            captionZh: `这类效果最适合想要“看起来很干净，但近看有细节”的客人。\n\n${audience === 'staff' ? '发帖时可以把重点放在质感、留档图和适合人群，减少夸张承诺。' : '如果你平时穿搭偏简约，这组会很适合做长期参考。'}\n\n收藏后下次预约直接带图沟通。`,
            titleEn: `${serviceName} | Quiet Detail`,
            captionEn: 'A refined look with quiet detail. Easy to wear, easy to save, and easy to personalize in studio.',
            hashtags: ['#美甲灵感', '#多伦多美睫', '#通勤美甲', '#LuckyLuxe', '#自然高级']
          },
          {
            titleZh: `${serviceName}｜本次完工留档`,
            captionZh: `完成后越看越耐看的一组。\n\n${audience === 'staff' ? `建议 ${techName} 发布时搭配细节图，突出款式层次和到店调整空间。` : '适合第一次尝试轻奢自然风格、又不想太高调的客人。'}\n\n预约时可以带参考图，我们会根据实际状态调整。`,
            titleEn: `${serviceName} | Finished Archive`,
            captionEn: 'A finished archive with soft detail and a balanced everyday look. Bring it in as a reference and we can tailor the details.',
            hashtags: ['#LuckyLuxeAtelier', '#小红书美甲', '#美甲参考', '#轻奢感', '#TorontoBeauty']
          }
        ],
        douyin: [
          {
            titleZh: `${serviceName} 这组很适合日常`,
            captionZh: `不夸张，但很显精致。\n\n${audience === 'staff' ? '短视频标题可以用“近看有细节，远看很干净”。' : '喜欢自然高级感的可以保存这一组，预约时直接给技师看。'}`,
            titleEn: `${serviceName} | Clean Everyday Finish`,
            captionEn: 'Subtle detail, clean finish, and easy everyday wear. Save this as your next reference.',
            hashtags: ['#今日美甲', '#美睫款式', '#同城美甲', '#变美日记', '#LuckyLuxe']
          },
          {
            titleZh: `${serviceName} 近看细节更好看`,
            captionZh: `镜头里是干净的，实际手上/眼部会更柔和。\n\n${audience === 'staff' ? '适合做前后对比或完工细节短视频。' : '如果你想要自然但有变化，这组可以先收藏。'}`,
            titleEn: `${serviceName} | Detail Close-up`,
            captionEn: 'Clean on camera, softer in person. A simple Lucky Luxe detail worth saving.',
            hashtags: ['#美甲日常', '#美睫分享', '#质感变美', '#LuckyLuxe', '#同城探店']
          },
          {
            titleZh: `${serviceName} 一眼干净的款式`,
            captionZh: `${audience === 'staff' ? '发布时建议把第一秒放在完工主图，文案保持短、干净、直接。' : '想要干净耐看的效果，可以从这一组开始参考。'}\n\n到店后可按个人状态微调。`,
            titleEn: `${serviceName} | Clean First Look`,
            captionEn: 'A clean first look with soft polish. Simple, refined, and ready to save.',
            hashtags: ['#美甲款式', '#美睫日记', '#干净感', '#LuckyLuxe', '#TorontoSalon']
          }
        ],
        instagram: [
          {
            titleZh: `${serviceName}｜Lucky Luxe 作品留档`,
            captionZh: `Soft, clean, and refined from every angle.\n\n${audience === 'staff' ? '可搭配 carousel 发布，第一张主图，后面放细节图。' : '适合日常，也适合镜头记录的一组完工作品。'}`,
            titleEn: `${serviceName} | Lucky Luxe Archive`,
            captionEn: 'Soft, clean, and refined from every angle. A polished Lucky Luxe finish made for everyday wear and a beautiful close-up.',
            hashtags: ['#LuckyLuxeAtelier', '#nailarchive', '#lashstudio', '#torontobeauty', '#softluxury']
          },
          {
            titleZh: `${serviceName}｜Soft Detail`,
            captionZh: `Clean lines, soft mood, polished finish.\n\n${audience === 'staff' ? 'Instagram 文案可突出作品质感和技师审美。' : 'A quiet kind of beauty for your next save.'}`,
            titleEn: `${serviceName} | Soft Detail`,
            captionEn: 'Clean lines, soft mood, polished finish. A quiet kind of beauty for your next save.',
            hashtags: ['#LuckyLuxe', '#torontonails', '#lashartist', '#beautyarchive', '#minimalbeauty']
          },
          {
            titleZh: `${serviceName}｜Artist Pick`,
            captionZh: `${techName} 的本次作品留档。\n\n${audience === 'staff' ? '适合放进技师作品集，作为同风格客户的预约参考。' : 'Save this artist pick for your next Lucky Luxe visit.'}`,
            titleEn: `${serviceName} | Artist Pick`,
            captionEn: `${techName}'s finished archive. Save this artist pick for your next Lucky Luxe visit.`,
            hashtags: ['#LuckyLuxeAtelier', '#artistpick', '#nailinspo', '#lashinspo', '#torontobeauty']
          }
        ]
      }
      const item = pickUniqueVariant(variants[platform] || variants.xiaohongshu, `${variantSeed}:${booking?.id}:${platform}:${audience}:${Date.now()}`, avoidCaptions)
      return {
        platform,
        styleTags: [category, 'clean', platform],
        ...item,
        altTextZh: `${serviceName} 完工作品图`,
        altTextEn: `${serviceName} finished work image`
      }
    }
  })
}
