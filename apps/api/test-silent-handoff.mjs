const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
/* 测试护栏(裁 C):套件永远不许写进真库 —— 开跑前问服务器「你往哪个库写」 */
import { assertTestTarget } from './test-guard.mjs'
await assertTestTarget(BASE_URL)
const TOKEN = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN_ID = Date.now().toString(36)

/* 🔴 店主 02s 裁定一:这四套用自有输出格式、不打 ok 行,断言基线的尺子看不见它们
   (02r 落刀当天现扫出的覆盖面洞:66/70)。店主原话:「"数不到"和"改造它们"之间还有第三条路:
   **让它们说出自己有多少条**」——所以只改这一个助手,**断言逻辑与 66 项 matrix 一行不动**,
   过一条就打一行 ok。覆盖面 66/70 → 70/70。 */
let asserted = 0
function assert(condition, message) {
  if (!condition) throw new Error(message)
  asserted += 1
  console.log(`ok ${asserted} - ${message}`)
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
  const conversations = (await request('/admin/wechat/conversations')).conversations || []
  return conversations.find((item) => item.externalUserId === externalUserId)
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
  /* 🔴 **口径已换**(Cowork 05f §一 2「达标即换」,2026-09-04):默认门从关键词门换成模型门。
     三跑取中位:范围内 91.2%(≥90)· 无关句实质作答 0.0%(≤2)· 安全四线三轮 0 破口。

     所以这里**明改**成新口径,旧口径断言不留(Cowork 原话):
     · 范围外(3a)→ **有礼貌回复,不静默,不转人工**;
     · 范围内但 AI 不该答(3b)→ 有回复 **+ 转人工**;
     · D133 反面:范围外那句之后,**会话不锁死**,下一句业务问题照常答。
     回滚开关 `AI_GATE=keyword` 仍在;旧门本身由 `test-ai-gate` 两档一起验。 */
  assert(Boolean(unknownResult.reply), '范围外必须给一句礼貌回复(3a:有回复,不静默)')
  assert(unknownResult.reply?.data?.tier === '3a', `范围外应落 tier=3a,实际 ${unknownResult.reply?.data?.tier}`)
  assert(unknownResult.reply?.data?.handoffRequired === false,
    '3a **不转人工** —— 顾客问宠物店,把它转给同事没有任何意义,只是占用人手')
  assert(!unknownResult.silentHandoff, '3a 不是静默')

  let conversation = await conversationByExternalId(unknownCustomer)
  assert(conversation, 'silent handoff conversation should exist')
  /* 3a **不转人工**,所以会话状态是 `ai_replied` 而不是 `needs_human` —— 这正是换门要的:
     顾客问一句店外的事,不该把整通对话挂到同事名下等人接。 */
  assert(conversation.status === 'ai_replied', `3a 之后会话应为 ai_replied(不转人工),实际 ${conversation.status}`)
  assert(conversation.lastIntent === 'out_of_scope', `3a 应落 lastIntent=out_of_scope,实际 ${conversation.lastIntent}`)
  /* 3a **有回复**,所以 transcript 里就该有助手消息。写成**白名单**:
     助手侧只允许「首次接触欢迎语」与「3a 礼貌拒绝句」两种,
     模型哪天真去答宠物店在哪,那句落不进白名单,立刻红。 */
  const asst = (conversation.transcript || []).filter((m) => m.role === 'assistant')
  const okLine = (c) => /欢迎来到|预约助手/.test(c) || /帮不上|店里预约、价格、营业时间/.test(c)
  assert(asst.length >= 1, '3a 应留下那句礼貌拒绝,实际一句助手消息都没有')
  const strays = asst.filter((m) => !okLine(m.content || ''))
  assert(strays.length === 0, `范围外不许出现实质回答,越界句:${strays.map((m) => String(m.content).slice(0, 40)).join(' | ')}`)
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
  console.log(`[silent-handoff] all regression checks passed(${asserted} 项断言)`)
}

main().catch((error) => {
  console.error('[silent-handoff] failed:', error.message)
  process.exit(1)
})
