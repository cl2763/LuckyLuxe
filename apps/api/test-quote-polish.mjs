// 报价润色回归(2026-07-04 修复锁):
// 1. 润色必须原样包含技师原文,不得改写本意;做不了 → 引导换款,不得说成"需要补充信息"
// 2. 价格识别支持 元/加元/裸数字 等宽格式
// 3. 顾客在询单表用松散格式提过时间(如 7.6 下午3点),报价返回后不得再让顾客重报时间
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const TOKEN = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN_ID = Date.now().toString(36)
const IMAGE_A = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAQAAABp0P2WAAAADUlEQVR42mP8z8BQDwAFgwJ/lmVfWQAAAABJRU5ErkJggg=='

let checks = 0

function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(options.headers || {}) }
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path} -> ${response.status} ${JSON.stringify(data).slice(0, 300)}`)
  return data
}

async function send(externalUserId, message, referenceImages = []) {
  return request('/admin/wechat/mock-chat-message', {
    method: 'POST',
    body: JSON.stringify({ externalUserId, message, customerType: 'new', memberTier: 'silver', lang: 'zh', forceAi: true, referenceImages })
  })
}

async function conversation(externalUserId) {
  const list = (await request('/admin/wechat/conversations')).conversations || []
  return list.find((item) => item.id === `wecom:${externalUserId}`)
}

async function latestQuoteFor(externalUserId) {
  const quotes = (await request('/admin/quote-requests')).quoteRequests || []
  return quotes.find((item) => item.conversationId === `wecom:${externalUserId}`)
}

function latestAssistantText(convo) {
  const assistant = (convo?.transcript || []).filter((item) => item.role === 'assistant')
  return assistant[assistant.length - 1]?.content || ''
}

async function intakeAndQuote(externalUserId, intakeLines) {
  await send(externalUserId, '想做美甲，这款可以做吗，帮我问下价格', [IMAGE_A])
  await send(externalUserId, intakeLines.join('\n'), [IMAGE_A])
  const quote = await latestQuoteFor(externalUserId)
  if (!quote) throw new Error(`quote request not created for ${externalUserId}`)
  return quote
}

async function respond(quoteId, staffMessage) {
  return request(`/admin/quote-requests/${quoteId}/respond`, {
    method: 'POST',
    body: JSON.stringify({ staffMessage })
  })
}

async function main() {
  // 场景 1:做不了 → 原文保留 + 引导换款
  const cannotUser = `polish-cannot-${RUN_ID}`
  const cannotQuote = await intakeAndQuote(cannotUser, [
    '1. 项目类型：美甲',
    '2. 想做日期和时间：',
    '3. 是否需要卸甲：不需要',
    '4. 是否需要延长：本甲',
    '5. 是否有断甲需要修补：没有',
    '6. 是否有参考图：有',
    '7. 其他备注：无'
  ])
  const staffCannotText = '这个款式手绘太复杂做不了，建议选简单一点的贝母款'
  await respond(cannotQuote.id, staffCannotText)
  let convo = await conversation(cannotUser)
  let reply = latestAssistantText(convo)
  check('cannot-do reply contains technician original words', reply.includes('手绘太复杂做不了') && reply.includes('贝母款'), reply.slice(0, 160))
  check('cannot-do reply guides customer to switch style', /换一个|换个|相近风格|简单一些的款式/.test(reply), reply.slice(0, 160))
  check('cannot-do reply does not misstate as needs-info', !/需要再补充信息后判断/.test(reply), reply.slice(0, 160))

  // 场景 2:宽格式价格识别(元 + 裸数字)
  const priceUser = `polish-price-${RUN_ID}`
  const priceQuote = await intakeAndQuote(priceUser, [
    '1. 项目类型：美甲',
    '2. 想做日期和时间：',
    '3. 是否需要卸甲：不需要',
    '4. 是否需要延长：本甲',
    '5. 是否有断甲需要修补：没有',
    '6. 是否有参考图：有',
    '7. 其他备注：无'
  ])
  await respond(priceQuote.id, '可以做 150元 大概两个小时')
  const updatedPriceQuote = await latestQuoteFor(priceUser)
  check('loose price format 150元 recognized into staff price', updatedPriceQuote?.staffPriceCents === 15000, String(updatedPriceQuote?.staffPriceCents))
  convo = await conversation(priceUser)
  reply = latestAssistantText(convo)
  check('price reply keeps technician original words', reply.includes('150元') || reply.includes('可以做 150'), reply.slice(0, 160))

  // 场景 3:询单表松散时间(7.6 下午3点)→ 报价返回后不再重复问时间
  const timeUser = `polish-time-${RUN_ID}`
  const timeQuote = await intakeAndQuote(timeUser, [
    '1. 项目类型：美甲',
    '2. 想做日期和时间：7.6 下午3点',
    '3. 是否需要卸甲：不需要',
    '4. 是否需要延长：本甲',
    '5. 是否有断甲需要修补：没有',
    '6. 是否有参考图：有',
    '7. 其他备注：无'
  ])
  await respond(timeQuote.id, '可以做，本甲130，大概2小时')
  convo = await conversation(timeUser)
  reply = latestAssistantText(convo)
  check('known loose time is not re-asked after quote', !/想预约的日期和时间|请直接回复“日期 \+ 时间”|回复.{0,6}日期和时间/.test(reply), reply.slice(0, 200))
  check('reply references the remembered time', /提到的时间|-07-06|15:00/.test(reply), reply.slice(0, 200))

  /* 屏 6「记为本次已报价」:只记状态,绝不发消息(店主 2026-08-08 裁决)。
     试算器上的一个按钮不能把话直接发给顾客 —— 真正的报价发送归 P4 状态机。 */
  const markUser = `polish-mark-${RUN_ID}`
  const markQuote = await intakeAndQuote(markUser, ['延长：不需要', '卸甲：不需要', '补甲：不需要', '配件：不需要', '手部健康：正常'])
  const beforeConvo = await conversation(markUser)
  const beforeCount = (beforeConvo?.transcript || []).length
  const marked = await request(`/admin/quote-requests/${markQuote.id}/mark-quoted`, {
    method: 'POST', body: JSON.stringify({ priceCents: 123600, note: '试算 ¥1,236' })
  })
  check('mark-quoted 记下报价金额', marked.marked === true && marked.priceCents === 123600, JSON.stringify(marked))
  const afterConvo = await conversation(markUser)
  check('mark-quoted 不给顾客发任何消息(会话条数没变)',
    (afterConvo?.transcript || []).length === beforeCount,
    `${beforeCount} → ${(afterConvo?.transcript || []).length}`)
  const afterQuote = await latestQuoteFor(markUser)
  check('mark-quoted 不改报价单状态(仍待技师处理,发送归 P4)',
    afterQuote.status === markQuote.status, `${markQuote.status} → ${afterQuote.status}`)

  console.log(`[quote-polish] all ${checks} checks passed`)
}

main().catch((error) => {
  console.error('[quote-polish] failed:', error.message)
  process.exit(1)
})
