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

async function callOpenAICompatible({ system, user, schema, images = [], temperature = 0.4 }) {
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
      temperature,
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

async function aiJson({ system, user, schema, images, fallback, temperature }) {
  if (DEFAULT_PROVIDER !== 'mock') {
    try {
      const data = await callOpenAICompatible({ system, user, schema, images, temperature })
      if (data) return { provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL, data }
    } catch (error) {
      return { provider: `${DEFAULT_PROVIDER}-fallback`, model: DEFAULT_MODEL, data: fallback(String(error.message || error)) }
    }
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
