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
    body: JSON.stringify({ code: `stub:${openid}`, tenantId, phone, ...(phone ? {phoneCode: `stub-phone:${openid}:${phone}`} : {}), displayName }),
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
  let made = await fetch(`${base}/admin/staff-accounts`, { method: 'POST', headers: H, body: JSON.stringify({ technicianId }) })
  let acc = await made.json().catch(() => ({}))
  /* 🔴 **幂等**(夜13 兜底,《幂等判据律》同族)· 这位技师**已经有账号**时,建号会 409 DUPLICATE。
     案由(现测):主档与门关档**跑在同一个库上** —— 主档先建了,门关档再建就撞。
     那不是产品问题,是夹具不幂等。
     治法**不是换个技师**(换了就没有他名下的历史单,下游断言跟着塌),
     是走产品自己那条**重置一次性密码**的路:`POST /admin/staff-accounts/:id/reset-password`。
     ⚠️ 它带 `role = 'staff'` 过滤,**动不到老板账号**(脚本红线第 1 条)。 */
  if (made.status === 409) {
    const list = await fetch(`${base}/admin/staff-accounts`, { headers: H })
    const rows = (await list.json().catch(() => ({}))).accounts || []
    const mine = rows.find((r) => r.technicianId === technicianId)
    if (!mine) return { ok: false, status: 409, body: { err: '409 但列表里找不到这位技师的账号 —— 说不清,不猜', rows: rows.length } }
    made = await fetch(`${base}/admin/staff-accounts/${encodeURIComponent(mine.id)}/reset-password`, { method: 'POST', headers: H, body: '{}' })
    acc = await made.json().catch(() => ({}))
  }
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
  let usedTime = ''
  /* 🔴 07y:原来只对 `REST_DAY` 换日子。现测 `auth-surface` 在**已有真实预约的库**上
   *   撞的是 `SLOT_UNAVAILABLE`(那位技师这个时段被占,而项目要 120 分钟)——
   *   夹具于是红在「这个钟点有人了」上,而不是红在被测的那件事上。
   *   **夹具的噪音会被当成被测对象的信号**(判据律:别让噪音淹信号)。
   *   改成:日子 × 钟点两层都退让,两种「换个时间就行」的错都退让。
   *   调用方钉死 `date`/`time` 的,只在没钉死的那一维上退让。 */
  const TIMES = ['10:30', '13:00', '15:30', '18:00', '11:45', '16:45']
  const RETRY = new Set(['REST_DAY', 'SLOT_UNAVAILABLE', 'OUTSIDE_BUSINESS_HOURS'])
  outer:
  for (let n = 1; n <= 14; n += 1) {
    usedDate = date || dayOf(n)
    for (const t of (time ? [time, ...TIMES.filter((x) => x !== time)] : TIMES)) {
      usedTime = t
      mk = await fetch(`${base}/admin/bookings/direct`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ newCustomerName: name, phone, serviceId, technicianId, date: usedDate, time: usedTime }),
      })
      mkBody = await mk.json().catch(() => ({}))
      if (!RETRY.has(mkBody?.error?.code)) break outer
    }
    if (date) break                       // 调用方钉死了日期就不替它换日子(钟点已经退让过了)
  }
  const userId = mkBody?.booking?.user?.id || mkBody?.booking?.userId || ''
  if (!userId) return { ok: false, status: mk ? mk.status : 0, body: mkBody, usedDate, usedTime }
  /* 用**同一个手机号**从正门登录 —— 严格认人那条正向路在这里被真跑一遍 */
  const login = await loginCustomerViaFrontDoor({ base, tenantId, openid: `stub-openid-${userId}`, phone })
  return { ok: login.ok && login.user?.id === userId, status: login.status, userId, claimedId: login.user?.id, accessToken: login.accessToken, body: login.body, usedDate, usedTime }
}

/* 🔴 J-60 转正门的**共用出口**(店主 07m §七,2026-09-14)
 *
 * 「这个顾客绑了微信」这个状态,原来 32 处夹具里有一大半是**直连库贴**出来的:
 *   `db.prepare('UPDATE users SET wechat_open_id = ? WHERE id = ?')`
 * 真顾客不是这么绑上的。她是拿**自己的手机号**从 `/auth/wechat/mini-login` 进来,
 * 服务端那条**严格认人四条**(本店 + 号完全一致 + 没绑过微信 + **唯一一条**)
 * 把那条轻档案认领走并绑上 —— 贴出来的那个绑**没走过这条路**,
 * 于是认人那一段在这些套件里从来没被跑到过。
 *
 * ⚠️ 用它的前提:那条轻档案**建的时候要带手机号**。没号就认不了(那是设计,不是缺陷)。
 */
export async function bindWechatViaFrontDoor({ base, tenantId, userId, phone, tag }) {
  const r = await loginCustomerViaFrontDoor({ base, tenantId, openid: `stub-openid-${tag}`, phone })
  if (!r.ok || r.user?.id !== userId) {
    throw new Error(`[J-60] 正门绑微信没成(${tag}):status=${r.status} 认成了 ${r.user?.id || '(新建)'} 期望 ${userId}`
      + ' —— 严格认人四条没认上,查:这条轻档案有没有手机号 / 是不是同一家店 / 号是不是撞了第二条')
  }
  return r
}
