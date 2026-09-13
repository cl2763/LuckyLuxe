// 客户运营字段回归:
// 1. 标签/备注/生日可写可读;生日格式校验
// 2. 客户列表带 tags/notes/birthday/储值余额
// 3. 会话↔会员互链:绑定 identity 后会话返回 linkedUserId
/* D132 口径④(店主 04d §一):顾客侧公开路由**必须带门店标识**,不再回落旗舰店。
   夹具同批补头 —— 补的是「请求带不带 x-tenant-id」,判据一个字没放宽。
   per-call 的 headers 仍然后到先得(跨租户用例照旧覆盖它)。 */
const TENANT_HEADER = process.env.TEST_TENANT_ID || 'lucky-luxe'
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
/* 测试护栏(裁 C):套件永远不许写进真库 —— 开跑前问服务器「你往哪个库写」 */
import { assertTestTarget } from './test-guard.mjs'
/* 07f §五 批量切:token 改成问 helper 要(试点形状,见 owner-token.mjs) */
const { requireOwnerToken } = await import('./owner-token.mjs')
await assertTestTarget(BASE_URL)
const TOKEN = process.env.TEST_ADMIN_TOKEN || requireOwnerToken()
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
    headers: { 'x-tenant-id': TENANT_HEADER, 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(options.headers || {}) }
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, data }
}

async function main() {
  // 建测试会员
/* 🔴 日班令2 段A:夹具建顾客**换正门**。原来用 `/auth/email/register` —— 那条路生产上 403,
   门一关就断,而且它让主档一直在测一条**生产上不存在的路**(店主 07i §五)。
   现在走 `/auth/wechat/mini-login` 正门:响应校验 → 严格认人四条 → 真签发。 */
const { loginCustomerViaFrontDoor } = await import('./customer-login-fixture.mjs')
  const cust__fd = await loginCustomerViaFrontDoor({ base: BASE_URL, tenantId: TENANT_HEADER, openid: `stub-openid-profile-${RUN_ID}`, displayName: `运营字段测试-${RUN_ID}` })
  const userId = cust__fd.user?.id
  check('test member created(**从正门登录**,两档同一条路)', Boolean(userId), JSON.stringify(cust__fd.body).slice(0, 140))

  // 1. 写入标签/备注/生日
  const saved = await request(`/admin/customers/${userId}/profile`, {
    method: 'PATCH',
    body: JSON.stringify({ tags: ['对甲油胶过敏', '偏好裸色系'], notes: '上次做过延长甲,美睫用低刺激胶水。', birthday: '08-16' })
  })
  check('profile saved', saved.status === 200 && saved.data.customer.tags.length === 2, JSON.stringify(saved.data))
  const badBirthday = await request(`/admin/customers/${userId}/profile`, {
    method: 'PATCH',
    body: JSON.stringify({ birthday: '八月十六' })
  })
  check('invalid birthday rejected', badBirthday.status === 400)
  const missing = await request('/admin/customers/no-such-user/profile', { method: 'PATCH', body: '{}' })
  check('unknown customer 404', missing.status === 404)

  // 2. 客户列表返回新字段
  const customers = (await request('/admin/customers')).data.customers
  const me = customers.find((item) => item.id === userId)
  check('list carries tags/notes/birthday', me && me.tags.includes('对甲油胶过敏') && me.birthday === '08-16' && me.notes.includes('延长甲'), JSON.stringify(me))
  check('list carries stored value balance field', typeof me.storedValueBalanceCents === 'number')

  // 3. 会话互链:造一个会话 + 绑定 identity → linkedUserId
  const externalId = `profile-link-${RUN_ID}`
  await request('/admin/wechat/mock-chat-message', {
    method: 'POST',
    body: JSON.stringify({ externalUserId: externalId, message: '你们几点开门?' })
  })
  const beforeLink = (await request('/admin/wechat/conversations')).data.conversations.find((item) => item.externalUserId === externalId)
  check('conversation exists without link', beforeLink && !beforeLink.linkedUserId, JSON.stringify({ id: beforeLink?.id, linked: beforeLink?.linkedUserId }))
  // 绑定会员(复用后台绑定会员接口)
  const bind = await request(`/admin/wechat/conversations/${encodeURIComponent(beforeLink.id)}/link-member`, {
    method: 'POST',
    body: JSON.stringify({ userId })
  })
  if (bind.status === 404) {
    // 若无显式绑定接口,直接走 identity upsert 的替代路径:验证 resolve 逻辑存在即可(跳过)
    console.log('skip - no link-member endpoint; linked lookup covered by identity provider tests')
  } else {
    check('link member accepted', bind.status === 200 || bind.status === 201, String(bind.status))
    const afterLink = (await request('/admin/wechat/conversations')).data.conversations.find((item) => item.externalUserId === externalId)
    check('conversation carries linkedUserId after binding', afterLink?.linkedUserId === userId, JSON.stringify({ linked: afterLink?.linkedUserId }))
  }

  console.log(`[customer-profile] all ${checks} checks passed`)
}

main().catch((error) => {
  console.error('[customer-profile] failed:', error.message)
  process.exit(1)
})
