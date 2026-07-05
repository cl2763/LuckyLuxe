// 套餐开关回归(阶段2-3):
// 1. 默认租户 = 连锁版,AI 客服开通,AI 正常回复
// 2. 覆盖项关闭 AI → 进线照常记录、静默转人工、AI 不回复;网页端返回人工提示
// 3. 试用过期 → 拦截;试用未过期 → 放行
// 4. 移除覆盖项 → 回到套餐默认;owner 权限保护
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
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
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(options.headers || {}) }
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, data }
}

async function chat(externalUserId, message) {
  return request('/admin/wechat/mock-chat-message', {
    method: 'POST',
    body: JSON.stringify({ externalUserId, message, customerType: 'new', memberTier: 'silver', lang: 'zh', forceAi: true })
  })
}

async function setAi({ enabled, expiresAt = null, remove = false }) {
  return request('/admin/tenant/entitlements', {
    method: 'PUT',
    body: JSON.stringify({ feature: 'ai_customer_service', enabled, expiresAt, remove, note: 'regression test' })
  })
}

async function main() {
  try {
    // 1. 默认状态:连锁版,AI 开通,正常回复
    const plan = await request('/admin/tenant/plan')
    check('plan endpoint 200', plan.status === 200)
    check('default tenant on chain plan', plan.data.entitlements?.plan === 'chain', plan.data.entitlements?.plan)
    check('ai enabled by plan', plan.data.entitlements?.features?.ai_customer_service?.enabled === true)

    const before = await chat(`ent-on-${RUN_ID}`, '你好，想了解美甲')
    check('AI replies when entitled', Boolean(before.data?.reply?.data?.answerZh), JSON.stringify(before.data).slice(0, 150))

    // 2. 关闭 AI → 静默转人工
    const disabled = await setAi({ enabled: false })
    check('disable override applied', disabled.data.entitlements?.features?.ai_customer_service?.enabled === false)
    const blocked = await chat(`ent-off-${RUN_ID}`, '你好，想了解美甲')
    check('AI silent when disabled', !blocked.data?.reply, JSON.stringify(blocked.data).slice(0, 200))
    check('blocked flag returned', blocked.data?.entitlementBlocked === true)
    check('customer message still recorded and marked needs_human', blocked.data?.conversation?.status === 'needs_human', blocked.data?.conversation?.status)

    const webBlocked = await request('/ai/customer-service', { method: 'POST', body: JSON.stringify({ lang: 'zh', message: '营业时间？' }) })
    check('web channel returns human notice when disabled', /人工客服/.test(webBlocked.data?.reply?.data?.answerZh || ''), JSON.stringify(webBlocked.data).slice(0, 200))

    // 3. 试用过期 → 拦;试用未过期 → 放
    await setAi({ enabled: true, expiresAt: '2020-01-01T00:00:00.000Z' })
    const expired = await chat(`ent-expired-${RUN_ID}`, '你好')
    check('expired trial blocks AI', expired.data?.entitlementBlocked === true, JSON.stringify(expired.data).slice(0, 150))

    const future = new Date(Date.now() + 30 * 86400000).toISOString()
    const trial = await setAi({ enabled: true, expiresAt: future })
    check('active trial marked as trial source', trial.data.entitlements?.features?.ai_customer_service?.source === 'trial')
    const trialChat = await chat(`ent-trial-${RUN_ID}`, '你好，想了解美睫')
    check('active trial allows AI', Boolean(trialChat.data?.reply?.data?.answerZh), JSON.stringify(trialChat.data).slice(0, 150))

    // 4. 移除覆盖项 → 回套餐默认;权限保护
    const removed = await setAi({ remove: true })
    check('remove override restores plan default', removed.data.entitlements?.features?.ai_customer_service?.source === 'plan')

    // 5. 套餐整体到期 → 功能熄灯 + AI 拦截;恢复长期有效 → 放行
    const expiredPlan = await request('/admin/tenant/plan', { method: 'PUT', body: JSON.stringify({ planExpiresAt: '2020-01-01T00:00:00.000Z' }) })
    check('plan expiry saved', expiredPlan.data.entitlements?.planExpired === true, JSON.stringify(expiredPlan.data.entitlements?.planExpiresAt))
    check('expired plan disables plan features', expiredPlan.data.entitlements?.features?.ai_customer_service?.source === 'plan_expired')
    const planBlockedChat = await chat(`ent-planexp-${RUN_ID}`, '你好')
    check('expired plan blocks AI chat', planBlockedChat.data?.entitlementBlocked === true, JSON.stringify(planBlockedChat.data).slice(0, 150))
    const restoredPlan = await request('/admin/tenant/plan', { method: 'PUT', body: JSON.stringify({ planExpiresAt: null }) })
    check('restore no-expiry re-enables features', restoredPlan.data.entitlements?.features?.ai_customer_service?.enabled === true)

    // 6. 续费/升级申请入口
    const renewReq = await request('/admin/tenant/plan/change-request', { method: 'POST', body: JSON.stringify({ targetPlan: 'chain' }) })
    check('renew request recorded', renewReq.status === 201 && renewReq.data.entitlements?.latestPlanRequest?.requestType === 'renew', JSON.stringify(renewReq.data.entitlements?.latestPlanRequest))
    const upgradeReq = await request('/admin/tenant/plan/change-request', { method: 'POST', body: JSON.stringify({ targetPlan: 'custom' }) })
    check('upgrade request recorded', upgradeReq.data.entitlements?.latestPlanRequest?.requestType === 'upgrade' && upgradeReq.data.entitlements?.latestPlanRequest?.targetPlan === 'custom')
    const badPlan = await request('/admin/tenant/plan/change-request', { method: 'POST', body: JSON.stringify({ targetPlan: 'nonsense' }) })
    check('unknown target plan rejected', badPlan.status === 400, String(badPlan.status))
    const badAuth = await fetch(`${BASE_URL}/admin/tenant/entitlements`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: 'Bearer wrong-token' },
      body: JSON.stringify({ feature: 'ai_customer_service', enabled: false })
    })
    check('bad token rejected', badAuth.status === 401, String(badAuth.status))

    console.log(`[entitlements] all ${checks} checks passed`)
  } finally {
    // 无论成败,确保清掉覆盖项并恢复套餐长期有效,不影响其他测试
    await setAi({ remove: true }).catch(() => {})
    await request('/admin/tenant/plan', { method: 'PUT', body: JSON.stringify({ planExpiresAt: null }) }).catch(() => {})
  }
}

main().catch((error) => {
  console.error('[entitlements] failed:', error.message)
  process.exit(1)
})
