// 自动归还回归:人工回复后超过冷却时间,AI 自动恢复接待;
// 但"接管未回复"的会话不自动归还(最后一条不是人工消息)。
// 需要以 HUMAN_REPLY_COOLDOWN_MINUTES=0 启动被测服务器,例如:
//   PORT=4129 HUMAN_REPLY_COOLDOWN_MINUTES=0 node apps/api/local-server.mjs
//   TEST_BASE_URL=http://127.0.0.1:4129 node apps/api/test-auto-return.mjs
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4129'
const TOKEN = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN_ID = Date.now().toString(36)

let checks = 0

function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
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
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path} -> ${response.status} ${JSON.stringify(data).slice(0, 300)}`)
  return data
}

async function send(externalUserId, message, forceAi = false) {
  return request('/admin/wechat/mock-chat-message', {
    method: 'POST',
    body: JSON.stringify({ externalUserId, message, customerType: 'new', memberTier: 'silver', lang: 'zh', forceAi })
  })
}

async function conversation(externalUserId) {
  const id = `wecom:${externalUserId}`
  const list = (await request('/admin/wechat/conversations')).conversations || []
  return list.find((item) => item.id === id)
}

function assistantCount(convo) {
  return (convo?.transcript || []).filter((item) => item.role === 'assistant').length
}

async function main() {
  // 场景 1:人工回复后冷却期已过(=0),顾客再发消息时 AI 自动恢复接待
  const autoUser = `auto-return-${RUN_ID}`
  await send(autoUser, '你好，想了解一下美甲', true)
  let convo = await conversation(autoUser)
  check('scenario1: conversation created with AI reply', assistantCount(convo) >= 1)

  await request(`/admin/wechat/conversations/${encodeURIComponent(convo.id)}/manual-reply`, {
    method: 'POST',
    body: JSON.stringify({ message: '你好，我是店主，这边帮你看一下。', releaseToAi: false })
  })
  convo = await conversation(autoUser)
  check('scenario1: manual reply keeps human_active', convo.status === 'human_active', convo.status)
  const beforeCount = assistantCount(convo)

  await send(autoUser, '好的，那我想约下周做美甲')
  convo = await conversation(autoUser)
  check('scenario1: after cooldown elapsed AI auto-returns and replies', assistantCount(convo) > beforeCount, `before=${beforeCount} after=${assistantCount(convo)} status=${convo.status}`)
  check('scenario1: conversation no longer human_active', convo.status !== 'human_active', convo.status)

  // 场景 2:接管但未回复(最后一条不是人工消息)→ 即使冷却=0 也不自动归还
  const holdUser = `hold-human-${RUN_ID}`
  await send(holdUser, '你好，咨询一下美睫', true)
  convo = await conversation(holdUser)
  await request(`/admin/wechat/conversations/${encodeURIComponent(convo.id)}/take-over`, { method: 'POST', body: '{}' })
  convo = await conversation(holdUser)
  check('scenario2: take-over sets human_active', convo.status === 'human_active', convo.status)
  const holdBefore = assistantCount(convo)

  await send(holdUser, '在吗？')
  convo = await conversation(holdUser)
  check('scenario2: AI stays silent after takeover without staff reply', assistantCount(convo) === holdBefore, `before=${holdBefore} after=${assistantCount(convo)}`)
  check('scenario2: conversation remains human_active', convo.status === 'human_active', convo.status)

  console.log(`[auto-return] all ${checks} checks passed`)
}

main().catch((error) => {
  console.error('[auto-return] failed:', error.message)
  process.exit(1)
})
