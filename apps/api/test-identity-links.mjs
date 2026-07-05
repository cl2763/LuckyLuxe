// 统一身份回归(阶段2-2):
// 1. email/google 登录写入 user_identities,重复登录不产生重复身份
// 2. 历史用户身份回填:所有带 email/openid/google/phone 的用户都有对应 identity 记录
// 3. 身份带 tenant_id;owner 可通过 /admin/users/:id/identities 查看
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

async function main() {
  // 1. email 注册 → identity 记录存在且带租户
  const email = `identity-test-${RUN_ID}@example.com`
  const register = await request('/auth/email/register', {
    method: 'POST',
    body: JSON.stringify({ email, displayName: 'Identity Test' })
  })
  const userId = register.data?.user?.id || register.data?.id
  check('email register returns user id', Boolean(userId), JSON.stringify(register.data).slice(0, 200))

  let identities = await request(`/admin/users/${encodeURIComponent(userId)}/identities`)
  check('identities endpoint returns 200', identities.status === 200)
  const emailIdentity = (identities.data.identities || []).find((item) => item.provider === 'email')
  check('email identity linked', emailIdentity?.externalId === email, JSON.stringify(identities.data.identities))
  check('identity carries tenant id', emailIdentity?.tenantId === 'lucky-luxe', emailIdentity?.tenantId)

  // 2. 重复注册同一 email → 不产生重复身份
  await request('/auth/email/register', { method: 'POST', body: JSON.stringify({ email }) })
  identities = await request(`/admin/users/${encodeURIComponent(userId)}/identities`)
  const emailCount = (identities.data.identities || []).filter((item) => item.provider === 'email').length
  check('repeat login does not duplicate identity', emailCount === 1, String(emailCount))

  // 3. google demo 用户 → google identity
  const googleEmail = `identity-google-${RUN_ID}@example.com`
  const google = await request('/auth/google/demo', {
    method: 'POST',
    body: JSON.stringify({ email: googleEmail, displayName: 'Google Identity Test' })
  })
  const googleUserId = google.data?.user?.id || google.data?.id
  check('google demo returns user id', Boolean(googleUserId), JSON.stringify(google.data).slice(0, 200))
  identities = await request(`/admin/users/${encodeURIComponent(googleUserId)}/identities`)
  check('google identity linked', (identities.data.identities || []).some((item) => item.provider === 'google'), JSON.stringify(identities.data.identities))

  // 4. 不存在的用户 → 404;缺少 owner 权限保护逻辑存在(用坏 token 应 401)
  const missing = await request('/admin/users/no-such-user/identities')
  check('unknown user returns 404', missing.status === 404, String(missing.status))
  const unauthorized = await fetch(`${BASE_URL}/admin/users/${encodeURIComponent(userId)}/identities`, {
    headers: { authorization: 'Bearer wrong-token' }
  })
  check('bad token rejected', unauthorized.status === 401, String(unauthorized.status))

  console.log(`[identity-links] all ${checks} checks passed`)
}

main().catch((error) => {
  console.error('[identity-links] failed:', error.message)
  process.exit(1)
})
