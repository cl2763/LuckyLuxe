/* 夹具建顾客的**唯一出口**:走正门(店主 07i §五,2026-09-13)
 *
 * ══ 为什么只留一条路 ══
 * 主档(演示门开着)那几套建顾客走的是**演示路**,门关档走**正门** ——
 * 就这么留着,两档会变成两条不同的路。**那正是 07d 我自己栽的那一跤:
 * 收敛完又分叉了,而分叉藏在参数顺序里。**
 * 演示登录路在生产上本来就不存在,让它继续在主档里扮演「顾客怎么来的」,
 * 等于让主档永远在测一条不存在的路。
 *
 * ══ 走的是哪条正门 ══
 * `POST /auth/wechat/mini-login` —— 与真顾客一模一样的那条:
 *   code → (ci/sandbox 走替身那一跳) → **响应校验** → **严格认人四条** → **真签发**。
 * 被替的只有「问腾讯这个 code 是谁」;token 是 `signMiniPayload` 真签的,
 * 下游 `customerFromMiniToken` 真验签、真验过期、真对 openid。
 *
 * ⚠️ 这个文件**不叫 `test-*`** —— 那样会被回归当成一支套件去跑。它是夹具,不是判据。
 */

/**
 * 按一个已知 openid 从正门登录,拿真签发的顾客 token。
 * @param {{ base: string, tenantId: string, openid: string, phone?: string, displayName?: string }} o
 * @returns {Promise<{ ok: boolean, status: number, user?: object, accessToken?: string, body?: object }>}
 */
export async function loginCustomerViaFrontDoor({ base, tenantId, openid, phone = '', displayName = '' }) {
  const res = await fetch(`${base}/auth/wechat/mini-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tenant-id': tenantId },
    /* code 里带上要哪个 openid —— **写在请求里,不经环境变量**(裁 #80:没有开关) */
    body: JSON.stringify({ code: `stub:${openid}`, tenantId, phone, displayName }),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, user: body.user, accessToken: body?.auth?.accessToken, body }
}

/* ── 员工登录的**唯一出口**(店主 日班令2 裁 #82,2026-09-13)──
 *
 * ══ 辨病结论:是「人没造」,不是「门挡的」══
 * 三问现查:
 *   ① 员工登录走 `POST /admin/auth/login`(`local-server.mjs:10842`)。
 *      **真实账号那条路完全不被 `DEMO_LOGIN_ALLOWED` 挡**(:10847-10867:查 `admin_accounts`
 *      → 校验密码 → 签发)。被门挡的是**第 2 条回落路** —— 演示白名单(:10869-10871)。
 *   ② 「账号不存在」正是那条回落路在门关时抛的(:10871)。夹具用的
 *      `staff@luckyluxeatelier.com` 是**演示白名单里的邮箱**,不是 `admin_accounts` 里的真账号。
 *      现证:门关档下用正门造一个真员工账号再登 → **通了**(`mode=account · role=staff`)。
 *   ③ 造景那一步在门关档不跑,是因为**它根本没有造景** —— 它一直靠演示白名单顶着。
 * ⇒ **生产上员工登得进来。** 不是第二个 D190。
 *
 * ══ 所以夹具走员工端自己的正门 ══
 * 老板口 `POST /admin/staff-accounts` 建号(它自己发一次性初始密码)→ 用它登录。
 * **没有替身**:员工登录的对端就是我们自己的账号表,没有「够不着的外部」,就没有替身的余地(裁 #82)。
 */
export async function loginStaffViaFrontDoor({ base, tenantId, ownerToken, technicianId }) {
  const H = { 'content-type': 'application/json', 'x-admin-tenant-id': tenantId, authorization: `Bearer ${ownerToken}` }
  const made = await fetch(`${base}/admin/staff-accounts`, { method: 'POST', headers: H, body: JSON.stringify({ technicianId }) })
  const acc = await made.json().catch(() => ({}))
  if (!acc.username || !acc.initialPassword) return { ok: false, status: made.status, body: acc }
  const res = await fetch(`${base}/admin/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: acc.username, password: acc.initialPassword }),
  })
  const body = await res.json().catch(() => ({}))
  /* ⚠️ 初始密码**不回给调用方、不打印** —— 它是一次性的,拿到 token 就够了 */
  return { ok: res.ok, status: res.status, username: acc.username, accessToken: body?.auth?.accessToken, body }
}

/* ── 建顾客 + 登录:**一步走完正门**(日班令2 段 A)──
 *
 * 六套原来用 `/auth/email/register` 建顾客 —— 那条路生产上 403,门一关就断。
 * 正门的等价路**本来就有**,而且就是产品设计的那条:
 *   ① 商家用 `/admin/bookings/direct` 建**轻档案**(有名字有手机号,没绑微信);
 *   ② 顾客拿**同一个手机号**从 `/auth/wechat/mini-login` 登录;
 *   ③ 严格认人四条(本店 + 号完全一致 + 没绑过微信 + **唯一一条**)把两者认成同一个人。
 * 换句话说:这个夹具**顺带把严格认人那条正向路也测了** —— 比原来的邮箱注册测得多。
 */
export async function createAndLoginCustomerViaFrontDoor({ base, tenantId, ownerToken, name, phone, serviceId, technicianId, date, time }) {
  const H = { 'content-type': 'application/json', 'x-admin-tenant-id': tenantId, authorization: `Bearer ${ownerToken}` }
  /* 日期自己挑一个**营业日**:新库里默认有休息日,写死一个日期十有八九撞上 `REST_DAY`
     —— 那会让夹具红在「今天不上班」上,而不是红在被测的那件事上(判据律:别让噪音淹信号)。 */
  const dayOf = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
  let mk = null
  let mkBody = {}
  let usedDate = ''
  for (let n = 1; n <= 10; n += 1) {
    usedDate = date || dayOf(n)
    mk = await fetch(`${base}/admin/bookings/direct`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ newCustomerName: name, newCustomerPhone: phone, phone, serviceId, technicianId, date: usedDate, time }),
    })
    mkBody = await mk.json().catch(() => ({}))
    if (mkBody?.error?.code !== 'REST_DAY') break
    if (date) break                       // 调用方钉死了日期就不替它换
  }
  const userId = mkBody?.booking?.user?.id || mkBody?.booking?.userId || ''
  if (!userId) return { ok: false, status: mk ? mk.status : 0, body: mkBody, usedDate }
  /* 用**同一个手机号**从正门登录 —— 严格认人那条正向路在这里被真跑一遍 */
  const login = await loginCustomerViaFrontDoor({ base, tenantId, openid: `stub-openid-${userId}`, phone })
  return { ok: login.ok && login.user?.id === userId, status: login.status, userId, claimedId: login.user?.id, accessToken: login.accessToken, body: login.body, usedDate }
}
