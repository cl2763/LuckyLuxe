const DEFAULT_MODEL = process.env.AI_MODEL || 'mock-affordable-ai'
const DEFAULT_PROVIDER = process.env.AI_PROVIDER || (process.env.AI_API_KEY ? 'openai-compatible' : 'mock')
const AI_BASE_URL = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
const AI_API_KEY = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || ''

function clip(value, max = 800) {
  return String(value || '').slice(0, max)
}

function jsonBlock(value) {
  return JSON.stringify(value, null, 2)
}

function bilingual(zh, en, lang = 'zh') {
  return lang === 'en' ? en : zh
}

function imageHints(images = []) {
  if (!images.length) return 'No image was provided.'
  return `${images.length} image(s) were provided. The first image data length is ${String(images[0] || '').length}.`
}

async function callOpenAICompatible({ system, user, schema, images = [] }) {
  if (!AI_API_KEY) return null
  const content = [{ type: 'text', text: `${user}\n\nReturn compact JSON only. Schema:\n${jsonBlock(schema)}` }]
  for (const image of images.slice(0, 3)) {
    if (typeof image === 'string' && image.startsWith('data:image')) {
      content.push({ type: 'image_url', image_url: { url: image } })
    }
  }
  const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${AI_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content }
      ]
    })
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`AI provider failed: ${response.status} ${detail.slice(0, 220)}`)
  }
  const data = await response.json()
  const text = data.choices?.[0]?.message?.content || '{}'
  return JSON.parse(text)
}

async function aiJson({ system, user, schema, images, fallback }) {
  if (DEFAULT_PROVIDER !== 'mock') {
    try {
      const data = await callOpenAICompatible({ system, user, schema, images })
      if (data) return { provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL, data }
    } catch (error) {
      return { provider: `${DEFAULT_PROVIDER}-fallback`, model: DEFAULT_MODEL, data: fallback(String(error.message || error)) }
    }
  }
  return { provider: 'mock', model: DEFAULT_MODEL, data: fallback() }
}

export async function analyzeReferenceImage({ lang = 'zh', images = [], service = {}, notes = '' }) {
  const schema = {
    type: 'nail|lash|unknown',
    styleTags: ['string'],
    complexity: 'low|medium|high',
    estimatedExtraMinutes: 0,
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

export async function createSocialCopy({ lang = 'zh', image = '', booking = {}, platform = 'xiaohongshu' }) {
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
    system: 'You create tasteful bilingual social media copy for a nail and lash atelier. Avoid medical claims and exaggerated promises.',
    user: `Create ${platform} copy for this finished work. Booking:\n${jsonBlock(booking)}\n${imageHints(image ? [image] : [])}`,
    schema,
    images: image ? [image] : [],
    fallback: () => {
      const serviceName = booking?.service?.name || 'Lucky Luxe'
      return {
        platform,
        styleTags: [booking?.service?.category || 'soft luxury', 'clean', 'atelier'],
        titleZh: `${serviceName}｜温柔高级感`,
        captionZh: `这组作品保留了干净、精致和日常高级感。适合喜欢低调但有质感效果的客人。\n\n预约前可以带参考图，我们会根据手型、肤色和日常习惯调整细节。`,
        titleEn: `${serviceName} | Soft Luxe Finish`,
        captionEn: 'A clean, polished look with a soft luxury finish. Bring your reference image and we will adjust the details to your hands, tone, and lifestyle.',
        hashtags: ['#LuckyLuxe', '#nailatelier', '#naildesign', '#lashartist', '#torontobeauty'],
        altTextZh: `${serviceName} 完工作品图`,
        altTextEn: `${serviceName} finished work image`
      }
    }
  })
}
