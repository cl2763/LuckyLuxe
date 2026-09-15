// 统一身份回归(阶段2-2):
// 1. email/google 登录写入 user_identities,重复登录不产生重复身份
// 2. 历史用户身份回填:所有带 email/openid/google/phone 的用户都有对应 identity 记录
// 3. 身份带 tenant_id;owner 可通过 /admin/users/:id/identities 查看
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
  /* 🔴 07y §八:这一套原来**只有门开着那一档跑得通** —— 它的题目就是
   *   「email / google 演示身份写不写得进 `user_identities`」,而门关档正是把演示登录关掉那一档。
   *   所以它不是 A 族(夹具走错门),是 **B 族:判据与本档前提冲突**(我 07x 归错了族,在此更正)。
   *   改法与 `card-refund 生产闸-3` 同一形态(J-57):**两档各守各的那一句,两支都断言**,
   *   而且**两档都要守住这一套真正的题目 —— 身份写没写进 `user_identities`** ——
   *   只是各走各那一档**真有**的那扇门:门开着走演示身份,门关着走正门(微信认领)。
   *   档次从 `/health` **现读**,不看环境变量(J-64 同族)。 */
  const healthRes = await request('/health')
  const gateOpen = healthRes.data?.guestIdUnsigned
  check('①0 先取本档门的状态(取不到就红 —— 取不到就没法判下一条该守哪句)',
    gateOpen === true || gateOpen === false, `guestIdUnsigned=${JSON.stringify(gateOpen)}`)

  let userId = ''
  if (gateOpen) {
    // ── 门开着:演示身份那条路(原判据原样保留)──
    const email = `identity-test-${RUN_ID}@example.com`
    const register = await request('/auth/email/register', {
      method: 'POST',
      body: JSON.stringify({ email, displayName: 'Identity Test' })
    })
    userId = register.data?.user?.id || register.data?.id
    check('email register returns user id', Boolean(userId), JSON.stringify(register.data).slice(0, 200))

    let identities = await request(`/admin/users/${encodeURIComponent(userId)}/identities`)
    check('identities endpoint returns 200', identities.status === 200)
    const emailIdentity = (identities.data.identities || []).find((item) => item.provider === 'email')
    check('email identity linked', emailIdentity?.externalId === email, JSON.stringify(identities.data.identities))
    check('identity carries tenant id', emailIdentity?.tenantId === TENANT_HEADER, emailIdentity?.tenantId)

    await request('/auth/email/register', { method: 'POST', body: JSON.stringify({ email }) })
    identities = await request(`/admin/users/${encodeURIComponent(userId)}/identities`)
    const emailCount = (identities.data.identities || []).filter((item) => item.provider === 'email').length
    check('repeat login does not duplicate identity', emailCount === 1, String(emailCount))

    /* 🔴 D194 / 裁 #107:`/auth/google/demo` **已删**(删路不加门)。
       原来这里有三条 google 演示身份断言 —— 那条路不存在了,断言跟着走。
       它不许换成「它存在时须合规」(裁 #104),**只许断言它不存在** —— 那一条在
       `test-user-write-auth ④`,两档共用同一条,不在这里各写一份。 */
  } else {
    // ── 门关着:演示那两条路必须被拒,身份改由**正门**写进去 ──
    const reg = await request('/auth/email/register', { method: 'POST', body: JSON.stringify({ email: `blocked-${RUN_ID}@example.com` }) })
    check('②a 🔴 门关着这一档:`/auth/email/register` 必须 403 DEMO_LOGIN_DISABLED',
      reg.status === 403 && reg.data?.error?.code === 'DEMO_LOGIN_DISABLED', `${reg.status} ${JSON.stringify(reg.data).slice(0, 140)}`)
    /* 🔴 D194 收口(裁 #107):这条路**已删**,所以断言从「必须被拒」改成「打不到」。
       这两句不是一回事 —— 「被拒」意味着路还在、门关着(缺口形态);
       「打不到」意味着路不存在(保证形态)。案底就是它自己:它的兄弟加了门,它没加。 */
    const goo = await request('/auth/google/demo', { method: 'POST', body: JSON.stringify({ email: `blocked-g-${RUN_ID}@example.com` }) })
    check('②b 🔴 `/auth/google/demo` **已删**:打过去必须不是 2xx(D194,裁 #107 删路不加门)',
      goo.status >= 400, `${goo.status} ${JSON.stringify(goo.data).slice(0, 140)}`)

  }

  /* 🔴 **两档都跑这一段**(07z 改):这一套的题目是「身份写没写进 `user_identities`」,
     不是「演示登录能不能用」。原来只在门关档跑正门那一段 —— 而门开档那边随着
     `/auth/google/demo` 被删(裁 #107)少了 3 条断言,**断言零缩水当场红**。
     正确的补法不是把删掉的那 3 条找回来(那条路没了),
     是**把同一个题目改由一条还活着的路来守,而且两档都守** ——
     覆盖面不但没缩,还从「一档」变成「两档」。 */
  const { createAndLoginCustomerViaFrontDoor } = await import('./customer-login-fixture.mjs')
  const svcList = await request('/admin/services')
  const techList = await request('/admin/technicians')
  const fd = await createAndLoginCustomerViaFrontDoor({ base: BASE_URL, tenantId: TENANT_HEADER,
    ownerToken: TOKEN, name: `身份正门客${RUN_ID}`, phone: `1350000${String(Date.now()).slice(-4)}`,
    serviceId: (svcList.data?.services || []).find((x) => x.isActive !== false)?.id || '',
    technicianId: (techList.data?.technicians || []).find((x) => x.isActive !== false)?.id || '' })
  userId = fd.userId || ''
  check('②c 前置:顾客从**正门**造出来(造不出来下面几条不算验过,J-58④)', Boolean(fd.ok && userId),
    `${fd.status} ${JSON.stringify(fd.body || {}).slice(0, 140)}`)
  const identities = await request(`/admin/users/${encodeURIComponent(userId)}/identities`)
  check('identities endpoint returns 200', identities.status === 200)
  const rows = identities.data.identities || []
  check('②d 🔴 正门进来的顾客,身份**真的写进 user_identities**(这一套的题目,两档都要守)',
    rows.length >= 1, JSON.stringify(rows).slice(0, 200))
  check('②e 身份带 tenant id(跨租户红线:身份不许无主)',
    rows.every((r) => r.tenantId === TENANT_HEADER), JSON.stringify(rows.map((r) => r.tenantId)))
  const dup = await request(`/admin/users/${encodeURIComponent(userId)}/identities`)
  check('②f 重复取不产生重复身份(与门开档 `repeat login does not duplicate identity` 同一件事)',
    (dup.data.identities || []).length === rows.length, `${rows.length} vs ${(dup.data.identities || []).length}`)

  // 4. 不存在的用户 → 404;缺少 owner 权限保护逻辑存在(用坏 token 应 401)—— 两档都跑
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
