/* D149 · 平台运营控制台改「用户名 + 密码」登录(店主 05q §三,她提过两次)

   现状的问题,照店主的话:**令牌不是密码**。`/platform` 现在要在登录框里贴 `OWNER_TOKEN` ——
   那是一串开发主钥匙,既不好记、又不该在浏览器里传来传去,而且**一把钥匙开所有门**:
   谁拿到它,连脚本口一起拿走了。

   裁法(05q §三):
   · 新增 `platform_accounts` / `platform_auth_sessions`,与商家后台**同一套哈希与会话机制**;

   🔴 表名为什么不叫 `platform_sessions`(现踩的坑,记在这儿):全仓**早就有**一张同名表
   (`platform-sessions.mjs` 的「记住这台电脑」cookie),字段完全不同。
   我写的 `CREATE TABLE IF NOT EXISTS` **一声不吭地什么都没建**,登录当场 500
   —— 这正是 CLAUDE.md 点名的静默失败器族(「表在但结构不同 → 悄悄不建 → 接口 500」),
   08-27 `service_notes` 那次一模一样。改法不是把建表写小心一点,是**换个名字**:
   账号会话(`platform_auth_sessions`)和设备 cookie(`platform_sessions`)本来就是两件事。
   · `OWNER_TOKEN` **只留给脚本 / API**(`Authorization: Bearer`),网页登录框不再收它;
   · 第一个账号 `platform-admin` 由启动时自举,一次性密码只写**本地**文件,首登强制改密;
   · 生产上店主自己设(入上线批,这里不建)。

   为什么单独成件:密码与会话是一个域(商家侧已经有 `admin-auth.mjs` 这个先例),
   平台侧再往巨型文件里塞一份就是「一件事两处住址」。两边的哈希前缀故意不同
   (`platform:` vs `admin:`)—— **同名同密码的商家账号不许当平台账号用**。 */

export function createPlatformAuth({ db, randomId, iso, createHash }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_accounts (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT,
      password_hash TEXT NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    );
    CREATE TABLE IF NOT EXISTS platform_auth_sessions (
      token TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `)

  /* 前缀 `platform:` 与商家侧的 `admin:` 故意不同 —— 同名同密码也算两个人 */
  const hash = (username, password) =>
    createHash('sha256').update(`platform:${String(username).toLowerCase()}:${String(password)}`).digest('hex')

  function randomPassword() {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
    let out = ''
    for (let i = 0; i < 12; i += 1) out += chars[Math.floor(Math.random() * chars.length)]
    return out
  }

  /** 自举第一个平台账号。**幂等按「建过没有」判**(幂等判据律:不看密码还对不对)。
   *  @returns {{ created: boolean, username: string, initialPassword: string|null }} */
  function bootstrapPlatformAdmin(username = 'platform-admin') {
    const had = db.prepare('SELECT id FROM platform_accounts WHERE username = ?').get(username)
    if (had) return { created: false, username, initialPassword: null }
    const initialPassword = randomPassword()
    const now = iso(new Date())
    db.prepare(`INSERT INTO platform_accounts (id, username, display_name, password_hash, must_change_password, status, created_at, updated_at)
      VALUES (?, ?, '平台运营', ?, 1, 'active', ?, ?)`)
      .run(randomId('pacct'), username, hash(username, initialPassword), now, now)
    return { created: true, username, initialPassword }
  }

  /** 用户名 + 密码换一张会话。密码不对一律 401,**不告诉对方错在用户名还是密码**。 */
  function login(username, password, rememberDays = 30) {
    const row = db.prepare("SELECT * FROM platform_accounts WHERE username = ? AND status = 'active'")
      .get(String(username || '').trim())
    if (!row) return null
    if (row.password_hash !== hash(row.username, password)) return null
    const token = `psess_${randomId('tok').slice(4)}_${Math.random().toString(36).slice(2, 10)}`
    const days = Math.max(1, Math.min(30, Number(rememberDays) || 30))
    db.prepare('INSERT INTO platform_auth_sessions (token, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(token, row.id, iso(new Date(Date.now() + days * 86400000)), iso(new Date()))
    db.prepare('UPDATE platform_accounts SET last_login_at = ? WHERE id = ?').run(iso(new Date()), row.id)
    return { token, username: row.username, displayName: row.display_name, mustChangePassword: row.must_change_password === 1 }
  }

  /** 认会话。过期/停用当场删掉那一行,不留着骗人。 */
  function fromSession(token) {
    if (!String(token || '').startsWith('psess_')) return null
    const row = db.prepare(`SELECT s.token, s.expires_at, a.* FROM platform_auth_sessions s
      JOIN platform_accounts a ON a.id = s.account_id WHERE s.token = ?`).get(token)
    if (!row) return null
    if (row.expires_at < iso(new Date()) || row.status !== 'active') {
      db.prepare('DELETE FROM platform_auth_sessions WHERE token = ?').run(token)
      return null
    }
    return { username: row.username, displayName: row.display_name, mustChangePassword: row.must_change_password === 1 }
  }

  /** 改密(首登强制改密走的也是这条)。改完**把这个人的旧会话全吊销**。 */
  function changePassword(username, oldPassword, newPassword) {
    const row = db.prepare("SELECT * FROM platform_accounts WHERE username = ? AND status = 'active'").get(String(username || '').trim())
    if (!row || row.password_hash !== hash(row.username, oldPassword)) return { ok: false, reason: 'BAD_CREDENTIALS' }
    const pwd = String(newPassword || '')
    if (pwd.length < 8) return { ok: false, reason: 'TOO_SHORT' }
    if (pwd === String(oldPassword)) return { ok: false, reason: 'SAME_AS_OLD' }
    db.prepare('UPDATE platform_accounts SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?')
      .run(hash(row.username, pwd), iso(new Date()), row.id)
    db.prepare('DELETE FROM platform_auth_sessions WHERE account_id = ?').run(row.id)
    return { ok: true }
  }

  /** 三条路由收在这儿(与 `conversation-routes.mjs` 同姿态:巨型文件只留一行分发)。
   *  @returns {Promise<boolean>} 认不认这条路;false = 继续往下匹配,不吞别人的路由。 */
  async function handle(req, res, path, { readBody, json, apiError }) {
    const bearer = () => {
      const a = req.headers.authorization || ''
      return a.startsWith('Bearer ') ? a.slice(7) : ''
    }
    if (req.method === 'POST' && path === '/platform/auth/login') {
      const b = await readBody(req).catch(() => ({}))
      /* 🔴 网页登录框**不收令牌**:这条路只认账号密码。令牌照旧能打 API,
         但拿它当密码贴进来会 401 ——「令牌不是密码」这句话得在代码里成立,不只是写在文档里。 */
      const out = login(b.username, b.password, b.remember === false ? 1 : 30)
      if (!out) throw apiError(401, 'UNAUTHORIZED', '用户名或密码不对。')
      json(res, 200, { session: out })
      return true
    }
    if (req.method === 'POST' && path === '/platform/auth/change-password') {
      const b = await readBody(req).catch(() => ({}))
      const r = changePassword(b.username, b.oldPassword, b.newPassword)
      if (!r.ok) {
        const msg = r.reason === 'TOO_SHORT' ? '新密码至少 8 位。' : r.reason === 'SAME_AS_OLD' ? '新密码不能和旧的一样。' : '用户名或旧密码不对。'
        throw apiError(400, r.reason, msg)
      }
      json(res, 200, { ok: true })
      return true
    }
    if (req.method === 'GET' && path === '/platform/auth/me') {
      const me = fromSession(bearer())
      if (!me) throw apiError(401, 'UNAUTHORIZED', '请先登录。')
      json(res, 200, { account: me })
      return true
    }
    return false
  }

  /** 开机自举 + 把一次性密码打给人看。**只打日志、不写任何文件** ——
   *  它要落的那份 `handoff/本地自查账号.txt` 是 gitignore 的本地件,由人抄进去;
   *  脚本自己去写它,等于多一处存密码的地方(而且那一处还会被别的批次覆盖)。
   *  幂等按「建过没有」判(幂等判据律):建过就一个字不动,重启一百次也不会换密码。 */
  function bootstrapAndReport(logger = console) {
    try {
      const boot = bootstrapPlatformAdmin('platform-admin')
      if (boot.created) logger.log(`[platform] 已建平台账号 ${boot.username},一次性密码:${boot.initialPassword}(首登强制改密;请抄进 handoff/本地自查账号.txt)`)
      return boot
    } catch (e) {
      logger.error('[platform] 自举平台账号失败(不阻塞启动):', e.message)
      return { created: false, username: 'platform-admin', initialPassword: null }
    }
  }

  return { bootstrapPlatformAdmin, bootstrapAndReport, login, fromSession, changePassword, hash, handle }
}
