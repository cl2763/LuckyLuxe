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
    /* 🔴 D131(店主 04b §二):原来不写 tenant_id,靠列默认 `lucky-luxe` 凑对。
       这是**平台首启的旗舰店老板**,租户就该写明白 —— 不许再靠默认值。 */
    db.prepare(`INSERT INTO admin_accounts (id, username, display_name, role, technician_id, password_hash, must_change_password, status, created_at, updated_at, tenant_id)
      VALUES (?, 'boss', '老板', 'owner', NULL, ?, 1, 'active', ?, ?, ?)`)
      .run(randomId('acct'), adminPasswordHash('boss', initialPassword), iso(new Date()), iso(new Date()), defaultTenantId)
    /* 🔴 D203 同类(09o §一 L2 扫尽扫出来的第二处):这里原来**既写文件、又把明文口令打进 console**。
       文件是设计好的交付口(gitignore、改密后自动删);**那行 console 是多出来的一份**,
       而它在生产上会进 Railway 部署日志 —— 留存、删不掉。J-53:密钥不进任何输出。
       改法不是「两个都去掉」:去掉文件就没人拿得到口令了。**留文件、去日志。**
       于是文件从「备份的一份」变成**唯一那一份** —— 所以它写不进去不能再静默吞掉。 */
    let delivered = false
    try {
      writeFileSync(file, `老板主账号(首次登录后必须改密码,改完本文件自动删除)\n用户名: boss\n初始密码: ${initialPassword}\n`)
      delivered = true
    } catch (e) {
      /* 🔴 不许回落成「打日志顶上」—— 那正是要去掉的那条路。只说失败,不说值。 */
      console.error(`[账号] 🔴 老板主账号已建,但初始口令**没能落盘**(${e.message})。`
        + '口令不会打印到日志(D203),所以这一把**已经取不到了** —— 请走平台后台「重置老板密码」重发一次。')
    }
    if (delivered) console.log('[账号] 老板主账号已创建 用户名: boss —— 初始口令已写入 local-data/初始老板账号.txt(不打印;首登改密后该文件自动删除)')
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


  /* 演示令牌(邮箱那条路)——**只在演示开关下有效**,调用方负责判 DEMO_LOGIN_ALLOWED。
     2026-08-26 查明:商家侧 08-07 就上了这道闸,**顾客侧漏了同一刀**,于是知道邮箱
     就能拿 `demo-customer:<email>` 当成那个人(连密码都不用),而且生产上那条路开着。
     令牌本身不带任何签名 —— 这也正是它绝不能出现在生产口径里的原因。 */
  function demoAuthFor(email, scope = 'customer') {
    return { accessToken: `demo-${scope}:${encodeURIComponent(email)}`, refreshToken: null, expiresIn: 3600, tokenType: 'bearer' }
  }

  function demoEmailFromToken(token, scope = 'customer') {
    const prefix = `demo-${scope}:`
    if (!String(token || '').startsWith(prefix)) return ''
    return decodeURIComponent(token.slice(prefix.length)).trim().toLowerCase()
  }

  return { adminPasswordHash, randomPassword, issueAdminSession, adminFromSessionToken, bootstrapOwnerAccount, demoAuthFor, demoEmailFromToken }
}
