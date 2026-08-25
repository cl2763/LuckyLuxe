/* 商家端账号与会话(2026-08-25 从 local-server.mjs 搬出,公约②)。

   这一批动的正是"密码与会话"这个领域(平台侧新增了**重置商家老板密码**:
   真商户忘密码是必然事件,此前平台端没有任何口)。按边改边拆,把这一族先搬出来:
   口令哈希 / 一次性口令 / 签会话 / 认会话,四件事凑一处,以后加登录方式只动这一个文件。
   搬家只挪位置,一行逻辑没改 —— 判据见 test-admin-accounts 与 test-auth-surface 两套件。 */
export function createAdminAuth({ db, randomId, iso, createHash, defaultTenantId }) {
  /* 自举:平台交付的老板主账号。初始密码写进 local-data/初始老板账号.txt,首次改密后自动删除该文件。
     返回那个文件路径 —— 改密路由要用它删文件。 */
  function bootstrapOwnerAccount({ writeFileSync }) {
    const file = new URL('./local-data/初始老板账号.txt', import.meta.url).pathname
    if (db.prepare("SELECT id FROM admin_accounts WHERE role = 'owner'").get()) return file
    const initialPassword = randomPassword()
    db.prepare(`INSERT INTO admin_accounts (id, username, display_name, role, technician_id, password_hash, must_change_password, status, created_at, updated_at)
      VALUES (?, 'boss', 'Lucky Luxe Owner', 'owner', NULL, ?, 1, 'active', ?, ?)`)
      .run(randomId('acct'), adminPasswordHash('boss', initialPassword), iso(new Date()), iso(new Date()))
    try {
      writeFileSync(file, `Lucky Luxe 老板主账号(首次登录后必须改密码,改完本文件自动删除)\n用户名: boss\n初始密码: ${initialPassword}\n`)
    } catch { /* 写不进就只打日志 */ }
    console.log(`[账号] 老板主账号已创建 用户名: boss 初始密码: ${initialPassword} (也写入 local-data/初始老板账号.txt)`)
    return file
  }

  function adminPasswordHash(username, password) {
    return createHash('sha256').update(`admin:${String(username).toLowerCase()}:${String(password)}`).digest('hex')
  }

  function randomPassword() {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
    let out = ''
    for (let i = 0; i < 10; i += 1) out += chars[Math.floor(Math.random() * chars.length)]
    return out
  }

  function issueAdminSession(accountId, rememberDays = 30) {
    const token = `sess_${randomId('tok').slice(4)}_${Math.random().toString(36).slice(2, 10)}`
    const expires = new Date(Date.now() + rememberDays * 86400000)
    db.prepare('INSERT INTO admin_sessions (token, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(token, accountId, iso(expires), iso(new Date()))
    return token
  }

  function adminFromSessionToken(token) {
    if (!String(token || '').startsWith('sess_')) return null
    const row = db.prepare(`
      SELECT s.token, s.expires_at, a.* FROM admin_sessions s
      JOIN admin_accounts a ON a.id = s.account_id
      WHERE s.token = ?
    `).get(token)
    if (!row) return null
    if (row.expires_at < iso(new Date()) || row.status !== 'active') {
      db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token)
      return null
    }
    return {
      role: row.role,
      email: row.username,
      displayName: row.display_name,
      provider: 'account',
      accountId: row.id,
      technicianId: row.technician_id || null,
      tenantId: row.tenant_id || defaultTenantId,
      mustChangePassword: Boolean(row.must_change_password)
    }
  }

  return { adminPasswordHash, randomPassword, issueAdminSession, adminFromSessionToken, bootstrapOwnerAccount }
}
