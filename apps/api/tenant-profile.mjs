/* 「这个人在这家店的档案」· 唯一出口(D127,店主 03u 裁,2026-09-03)

   ══ 为什么有这个模块 ══
   顾客档案在本系统里是**每店一份**:微信登录按 `openid + tenant_id` 找档,
   找不到就在这家店建一份(`local-server` 那段注释写得很清楚:
   「openid 直查同样带租户:不带就会把 A 店那一行认成 B 店顾客(跨店串号根子)」)。

   但**演示邮箱登录**那条老路没有这一步 —— 它注册时不知道自己在哪家店,
   而 `users.tenant_id` 的列定义是:

       tenant_id TEXT NOT NULL DEFAULT 'lucky-luxe'

   于是每个走邮箱注册的顾客都**静默落进旗舰店**,再去别家店下单,
   就生成一行「单属 B 店 / 人属 A 店」的串味数据 —— 正是 D127 那 5 行的同一个形状。
   归族「静默失败器族」:**一个默认值让「没填」看起来像「填对了」**。

   ══ 这个出口做什么 ══
   下单时把两条路对齐:取**这个人在当前这家店**的档案 id。
   先按店找(openid → email → 本人 id),找不到就照微信那套在这店建一份。
   微信路径下第一步必然命中(登录时已建),不会多建;只有邮箱老路会走到建档那一支。

   ══ 一条不许破的规矩 ══
   **不跨店复用档案。** 跨店复用正是 D127 串味的根子:
   一旦复用,`bookings.tenant_id` 与 `users.tenant_id` 就会不一致,
   而读口(serializeBooking)如果不比对租户,就会把别人家顾客的
   姓名/电话/邮箱/openid 整个下发 —— 那正是这次现查抓到的泄露。 */

export function createTenantProfile({ db, validTenantId, randomId, displayNameForUserId, apiError, serializeUser, upsertUserIdentity }) {
  /* 演示邮箱注册/登录(生产恒关)。搬出自 local-server(公约②「动哪个领域就把该领域搬出来」)——
     它与本模块是同一件事:**这个人在这家店的档案**。
     D127 之前它不写 tenant_id,于是人人落进列默认值 lucky-luxe。 */
  function registerEmailUser(body) {
    const email = String(body.email || '').trim().toLowerCase()
    const displayName = String(body.displayName || '').trim() || email.split('@')[0] || 'Lucky Member'
    if (!email || !email.includes('@')) throw apiError(400, 'BAD_REQUEST', 'A valid email is required.')
    /* 同一邮箱在不同店是不同档案(与微信登录同口径:按 openid+租户 找) */
    const tenantId = validTenantId(body.tenantId)
    const existing = db.prepare('SELECT * FROM users WHERE email = ? AND tenant_id = ?').get(email, tenantId)
    if (existing) {
      upsertUserIdentity({ userId: existing.id, provider: 'email', providerUserId: email, email })
      return serializeUser(existing)
    }
    const id = randomId('user')
    db.prepare('INSERT INTO users (id, display_name, email, tenant_id) VALUES (?, ?, ?, ?)').run(id, displayName, email, tenantId)
    upsertUserIdentity({ userId: id, provider: 'email', providerUserId: email, email })
    return serializeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id))
  }

  /* 返回「userId 这个人在 tenantId 这家店」的档案 id。
     取不到本人原始行时原样返回(不猜、不静默改写调用方给的值)。 */
  function profileIdInTenant(userId, tenantId) {
    const tid = validTenantId(tenantId)
    const raw = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    if (!raw) return userId
    if (raw.tenant_id === tid) return raw.id
    const found = (raw.wechat_open_id
      ? db.prepare('SELECT id FROM users WHERE wechat_open_id = ? AND tenant_id = ?').get(raw.wechat_open_id, tid) : null)
      || (raw.email ? db.prepare('SELECT id FROM users WHERE email = ? AND tenant_id = ?').get(raw.email, tid) : null)
    if (found) return found.id
    const id = randomId('user')
    db.prepare('INSERT INTO users (id, display_name, email, phone, wechat_open_id, tenant_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, raw.display_name || displayNameForUserId(id), raw.email || null, raw.phone || null, raw.wechat_open_id || null, tid)
    return id
  }
  return { profileIdInTenant, registerEmailUser }
}
