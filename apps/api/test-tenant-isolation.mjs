// 租户隔离回归(阶段2-5):
// 两个服务器实例共用同一数据库,分别以租户 A(lucky-luxe)和租户 B(tenant-iso-b)运行。
// 断言:A 的知识库/FAQ/套餐操作对 B 完全不可见,反之亦然;AI 直答不跨租户。
// 运行方式:
//   PORT=4128 node apps/api/local-server.mjs                                (租户 A)
//   PORT=4131 DEFAULT_TENANT_ID=tenant-iso-b node apps/api/local-server.mjs (租户 B)
//   node apps/api/test-tenant-isolation.mjs
const URL_A = process.env.TEST_URL_A || 'http://127.0.0.1:4128'
const URL_B = process.env.TEST_URL_B || 'http://127.0.0.1:4131'
const TOKEN = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN_ID = Date.now().toString(36)

let checks = 0

function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(options.headers || {}) }
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, data }
}

async function chat(base, externalUserId, message) {
  return request(base, '/admin/wechat/mock-chat-message', {
    method: 'POST',
    body: JSON.stringify({ externalUserId, message, customerType: 'new', memberTier: 'silver', lang: 'zh', forceAi: true })
  })
}

async function main() {
  let entryAId = ''
  let entryBId = ''
  try {
    // 0. 双实例身份确认
    const planA = await request(URL_A, '/admin/tenant/plan')
    const planB = await request(URL_B, '/admin/tenant/plan')
    check('instance A runs as lucky-luxe', planA.data.entitlements?.tenantId === 'lucky-luxe', planA.data.entitlements?.tenantId)
    check('instance B runs as tenant-iso-b', planB.data.entitlements?.tenantId === 'tenant-iso-b', planB.data.entitlements?.tenantId)

    // 1. A 建 FAQ → B 看不见、B 的 AI 不会用它直答
    const keyword = `隔离暗号${RUN_ID}`
    const createdA = await request(URL_A, '/admin/kb/entries', {
      method: 'POST',
      body: JSON.stringify({ question: keyword, keywords: keyword, answerZh: `这是租户A的私有答案${RUN_ID}` })
    })
    entryAId = createdA.data?.entry?.id || ''
    check('tenant A entry created', Boolean(entryAId))

    const kbB = await request(URL_B, '/admin/kb')
    check('tenant B cannot see tenant A entries', !(kbB.data.entries || []).some((item) => item.id === entryAId))

    const chatB = await chat(URL_B, `iso-b-${RUN_ID}`, `${keyword}是什么`)
    check('tenant B AI does not answer with tenant A knowledge', chatB.data?.reply?.data?.intent !== 'tenant_kb_answer', JSON.stringify(chatB.data?.reply?.data || null).slice(0, 120))

    const chatA = await chat(URL_A, `iso-a-${RUN_ID}`, `${keyword}是什么`)
    check('tenant A AI answers with its own knowledge', chatA.data?.reply?.data?.intent === 'tenant_kb_answer' && chatA.data?.reply?.data?.answerZh?.includes('租户A的私有答案'), JSON.stringify(chatA.data?.reply?.data || null).slice(0, 120))

    // 2. B 建自己的 FAQ → A 看不见
    const createdB = await request(URL_B, '/admin/kb/entries', {
      method: 'POST',
      body: JSON.stringify({ question: `B专属${RUN_ID}`, keywords: `B专属${RUN_ID}`, answerZh: '租户B自己的答案' })
    })
    entryBId = createdB.data?.entry?.id || ''
    const kbA = await request(URL_A, '/admin/kb')
    check('tenant A cannot see tenant B entries', !(kbA.data.entries || []).some((item) => item.id === entryBId))

    // 3. B 关闭 AI 客服 → 只影响 B,A 照常回复
    await request(URL_B, '/admin/tenant/entitlements', {
      method: 'PUT',
      body: JSON.stringify({ feature: 'ai_customer_service', enabled: false })
    })
    const blockedB = await chat(URL_B, `iso-b2-${RUN_ID}`, '你好')
    check('tenant B AI blocked after its own disable', blockedB.data?.entitlementBlocked === true, JSON.stringify(blockedB.data).slice(0, 120))
    const stillA = await chat(URL_A, `iso-a2-${RUN_ID}`, '你好')
    check('tenant A AI unaffected by tenant B disable', Boolean(stillA.data?.reply), JSON.stringify(stillA.data?.reply?.data?.intent || null))

    // 4. 事实隔离:B 改定金不影响 A
    await request(URL_B, '/admin/kb/facts', { method: 'PUT', body: JSON.stringify({ facts: { depositAmount: '999' } }) })
    const factsA = await request(URL_A, '/admin/kb')
    check('tenant A deposit fact unaffected by tenant B change', factsA.data.facts?.depositAmount === '50', factsA.data.facts?.depositAmount)

    console.log(`[tenant-isolation] all ${checks} checks passed`)
  } finally {
    if (entryAId) await request(URL_A, `/admin/kb/entries/${entryAId}`, { method: 'DELETE' }).catch(() => {})
    if (entryBId) await request(URL_B, `/admin/kb/entries/${entryBId}`, { method: 'DELETE' }).catch(() => {})
    await request(URL_B, '/admin/tenant/entitlements', { method: 'PUT', body: JSON.stringify({ feature: 'ai_customer_service', remove: true }) }).catch(() => {})
  }
}

main().catch((error) => {
  console.error('[tenant-isolation] failed:', error.message)
  process.exit(1)
})
