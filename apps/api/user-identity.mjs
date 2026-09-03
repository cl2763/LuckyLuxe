/* 统一身份表(user_identities)的回填与归属修复 —— D130(店主 04a §二 裁,2026-09-03)

   ══ 病 ══
   `user_identities.tenant_id TEXT NOT NULL DEFAULT 'lucky-luxe'`(与 D126/D128 的 `users` 同一根子),
   而启动回填那四条 `INSERT OR IGNORE` **都不带 tenant_id** —— 每次启动都跑,
   于是别店顾客的身份被一律回填成旗舰店的。本机库现测 **96 行**错标。

   ══ 危害路径(不是「只是标错」)══
   `upsertUserIdentity` 以 `(provider, provider_user_id, ownerTenant)` 找已有行:
   旗舰店一位顾客用手机号 X 绑定 → ownerTenant='lucky-luxe' →
   命中的是**别店顾客那行被错标成 lucky-luxe 的身份** → `UPDATE … SET user_id = 旗舰店顾客`
   → **别店那位的手机号身份被改指给了别人**,她下次用手机号登自己店的小程序就找不到自己。
   唯一键含 tenant_id,所以「正确挂在别店的那行」和「错标这行」并存(本机库 220 行 / 161 人就是这么来的)。

   ══ 为什么搬出来 ══
   代码结构公约:动哪个领域就把该领域从巨型文件搬出来(棘轮:两个巨型文件只许降不许升)。 */

/* 回填:早期用户只有 users 表字段、没有 user_identities 记录,补齐映射。
   ⚠️ tenant_id **跟着这个人自己的 users.tenant_id 走**,不许再靠列默认值(D130 的病根)。 */
export function backfillIdentities(db) {
  db.exec(`
    INSERT OR IGNORE INTO user_identities (id, user_id, provider, provider_user_id, email, created_at, updated_at, tenant_id)
    SELECT 'identity-bf-' || lower(hex(randomblob(6))), id, 'email', lower(email), lower(email), datetime('now'), datetime('now'), tenant_id
    FROM users WHERE email IS NOT NULL AND email != '';
    INSERT OR IGNORE INTO user_identities (id, user_id, provider, provider_user_id, created_at, updated_at, tenant_id)
    SELECT 'identity-bf-' || lower(hex(randomblob(6))), id, 'wechat_miniprogram', wechat_open_id, datetime('now'), datetime('now'), tenant_id
    FROM users WHERE wechat_open_id IS NOT NULL AND wechat_open_id != '';
    INSERT OR IGNORE INTO user_identities (id, user_id, provider, provider_user_id, created_at, updated_at, tenant_id)
    SELECT 'identity-bf-' || lower(hex(randomblob(6))), id, 'google', google_id, datetime('now'), datetime('now'), tenant_id
    FROM users WHERE google_id IS NOT NULL AND google_id != '';
    INSERT OR IGNORE INTO user_identities (id, user_id, provider, provider_user_id, phone, created_at, updated_at, tenant_id)
    SELECT 'identity-bf-' || lower(hex(randomblob(6))), id, 'phone', phone, phone, datetime('now'), datetime('now'), tenant_id
    FROM users WHERE phone IS NOT NULL AND phone != '';
  `)
}

/* 现扫:身份行的 tenant_id 与它主人的 tenant_id 不一致的,逐行带上「目标租户下有没有正确行」。
   两种处置(店主 04a §二 第 3 条定的):
   · 目标租户下**没有**同 (provider, provider_user_id) → 改标(UPDATE tenant_id = 主人的);
   · 目标租户下**已有**正确行 → 删错标行(身份表不是账本,允许删;删前后各报数)。 */
export function scanIdentityMismatch(db) {
  return db.prepare(`
    SELECT x.id, x.tenant_id AS wrong_tenant, u.tenant_id AS owner_tenant, x.provider, x.provider_user_id, x.user_id,
           (SELECT COUNT(*) FROM user_identities y
             WHERE y.tenant_id = u.tenant_id AND y.provider = x.provider AND y.provider_user_id = x.provider_user_id) AS已有
      FROM user_identities x JOIN users u ON u.id = x.user_id
     WHERE x.tenant_id <> u.tenant_id
     ORDER BY x.tenant_id, u.tenant_id, x.provider`).all()
}

/* 排程:**预计与实做必须走同一个出口**,否则演练报的数和真跑的数对不上。
   案由(04a 现测):第一版演练按「扫描时目标租户下有没有正确行」预计 = 改标 113 / 删 0,
   而真跑逐行现查得到的是 改标 55 / 删 58 —— 同一件事两处算法,形状判据当场对不上。
   归族**幂等判据律**:会被同一批里前面几步改掉的量,不能拿来当判据。
   这里用一个「占位集」把冲突模拟出来,顺序与真跑完全一致。 */
export function planIdentityRepair(db, rows) {
  const occupied = new Set(db.prepare('SELECT tenant_id, provider, provider_user_id, id FROM user_identities').all()
    .map((r) => `${r.tenant_id}\u0000${r.provider}\u0000${r.provider_user_id}\u0000${r.id}`))
  const keyTaken = (tenant, provider, pid, selfId) => [...occupied].some((k) => {
    const [t, p, u, id] = k.split('\u0000')
    return t === tenant && p === provider && u === pid && id !== selfId
  })
  const plan = []
  for (const r of rows) {
    const clash = keyTaken(r.owner_tenant, r.provider, r.provider_user_id, r.id)
    if (clash) {
      plan.push({ ...r, 动作: 'delete' })
      occupied.delete(`${r.wrong_tenant}\u0000${r.provider}\u0000${r.provider_user_id}\u0000${r.id}`)
    } else {
      plan.push({ ...r, 动作: 'update' })
      occupied.delete(`${r.wrong_tenant}\u0000${r.provider}\u0000${r.provider_user_id}\u0000${r.id}`)
      occupied.add(`${r.owner_tenant}\u0000${r.provider}\u0000${r.provider_user_id}\u0000${r.id}`)
    }
  }
  return plan
}

/* 修复本体 —— **调用方负责开事务**(动的是归属,属于多步写)。
   按 `planIdentityRepair` 排好的顺序做,并在每一步**再现查一次**冲突:
   排程是模拟,现查是事实;两者不一致就抛错,不许悄悄按模拟走。 */
export function repairIdentityTenant(db, rows) {
  let updated = 0
  let deleted = 0
  const occupied = db.prepare(`SELECT id FROM user_identities
    WHERE tenant_id = ? AND provider = ? AND provider_user_id = ? AND id <> ?`)
  for (const r of planIdentityRepair(db, rows)) {
    const clash = !!occupied.get(r.owner_tenant, r.provider, r.provider_user_id, r.id)
    if (clash !== (r.动作 === 'delete')) {
      throw new Error(`排程与现查不一致(${r.id}):排程说 ${r.动作}、现查说 ${clash ? 'delete' : 'update'}`)
    }
    if (clash) deleted += Number(db.prepare('DELETE FROM user_identities WHERE id = ?').run(r.id).changes || 0)
    else updated += Number(db.prepare('UPDATE user_identities SET tenant_id = ? WHERE id = ?').run(r.owner_tenant, r.id).changes || 0)
  }
  return { updated, deleted }
}

/* 收尾那把尺:①零错标 ②(tenant_id, provider, provider_user_id) 无重复 */
export function identityRulers(db) {
  const mismatch = db.prepare(`SELECT COUNT(*) AS n FROM user_identities x JOIN users u ON u.id = x.user_id
    WHERE x.tenant_id <> u.tenant_id`).get().n
  const dup = db.prepare(`SELECT COUNT(*) AS n FROM (SELECT tenant_id, provider, provider_user_id
    FROM user_identities GROUP BY 1,2,3 HAVING COUNT(*) > 1)`).get().n
  return { mismatch, dup }
}

/* 身份 upsert —— 从 `local-server.mjs` 搬出(公约②:动哪个领域就把该领域搬出来)。
   逻辑一个字没改(店主 04a §二:「`upsertUserIdentity` 逻辑不动」);
   搬出来的目的有二:①巨型文件棘轮 ②**行为判据能直接驱动它**,
   不用在测试里照抄一遍逻辑(照抄=一件事两处真相,正是本仓栽过的那一类)。 */
export function createIdentityUpsert({ db, iso, randomId, currentTenantId }) {
  return function upsertUserIdentity({ userId, provider, providerUserId, unionId = '', email = '', phone = '' }) {
    if (!userId || !provider || !providerUserId) return
    const now = iso(new Date())
    // 一店一行:同一 openid 在每家店各挂一行(唯一键=租户+provider+providerUserId)
    const ownerTenant = (db.prepare('SELECT tenant_id FROM users WHERE id = ?').get(userId) || {}).tenant_id || currentTenantId()
    const existing = db.prepare('SELECT id FROM user_identities WHERE provider = ? AND provider_user_id = ? AND tenant_id = ?').get(provider, providerUserId, ownerTenant)
    if (existing) {
      db.prepare(`
        UPDATE user_identities
        SET user_id = ?, union_id = COALESCE(NULLIF(?, ''), union_id), email = COALESCE(NULLIF(?, ''), email),
            phone = COALESCE(NULLIF(?, ''), phone), updated_at = ?
        WHERE id = ?
      `).run(userId, unionId, email, phone, now, existing.id)
      return
    }
    db.prepare(`
      INSERT INTO user_identities (id, user_id, provider, provider_user_id, union_id, email, phone, created_at, updated_at, tenant_id)
      VALUES (?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?)
    `).run(randomId('identity'), userId, provider, providerUserId, unionId, email, phone, now, now, ownerTenant)
  }
}
