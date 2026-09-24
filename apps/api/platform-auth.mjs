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
  /* 🔴 交付纪律 8:列一律走 try/catch ALTER —— 只写进 CREATE TABLE 等于只对全新库生效,
     老库(含生产)不会跟上,而这一列正是「重置只生效一次」的判据地基。 */
  try { db.exec('ALTER TABLE platform_accounts ADD COLUMN reset_marker TEXT') } catch (e) { /* 已有 */ }

  /* 🔴 口令由调用方传进来(乙支:来自环境变量,店主亲手灌)。
     **这里不再 `randomPassword()`** —— 不生成,就没有「一次性口令」这个需要找地方放的东西。
     幂等按「建过没有」判(幂等判据律):建过就一个字不动,重启一百次也不换密码。 */
  function bootstrapPlatformAdmin(username = 'platform-admin', initialPassword = '') {
    const had = db.prepare('SELECT id FROM platform_accounts WHERE username = ?').get(username)
    if (had) return { created: false, username, initialPassword: null }
    if (!initialPassword) return { created: false, username, initialPassword: null, reason: 'no-password' }
    const now = iso(new Date())
    db.prepare(`INSERT INTO platform_accounts (id, username, display_name, password_hash, must_change_password, status, created_at, updated_at)
      VALUES (?, ?, '平台运营', ?, 1, 'active', ?, ?)`)
      .run(randomId('pacct'), username, hash(username, initialPassword), now, now)
    return { created: true, username, initialPassword }
  }

  /* ══ 🔴 「以后忘了密码怎么办」(店主 11p §二)—— 同一条路加一把 ══
   *
   * `PLATFORM_ADMIN_RESET=1` + 新口令 ⇒ 重写哈希、首登强制改密、**作废它所有会话**。
   *
   * 🔴 幂等按「**做过没有**」判,不按「现在是什么」判(幂等判据律,店主 08-25 立):
   *    把新口令的 sha256 记进 `reset_marker`,同一个值第二次启动**不再生效** ——
   *    否则店主忘了把 `RESET=1` 删掉,以后每次重启都会把她**自己改过的新密码**打回那一串,
   *    而她完全看不出为什么密码老是变回去。
   * 🔴 记的是 **sha256(值)**,不是值本身:它只用来回答「这次和上次是不是同一串」,
   *    永远不需要读回原文。(值、长度、前缀一律不出现在任何输出里。) */
  function resetPlatformAdmin(username, newPassword, logger = console) {
    const row = db.prepare('SELECT * FROM platform_accounts WHERE username = ?').get(username)
    if (!row) {
      logger.log(`[platform] 重置平台账号:**该账号不存在,未动**(要新建请用 PLATFORM_ADMIN_BOOTSTRAP=1)。`)
      return { created: false, username, initialPassword: null }
    }
    const marker = createHash('sha256').update(String(newPassword)).digest('hex')
    if (row.reset_marker === marker) {
      logger.log('[platform] 重置平台账号:**同一个口令已经生效过,本次不动**(幂等)。'
        + '要再重置请换一串新的;用完记得把 PLATFORM_ADMIN_RESET 删掉。')
      return { created: false, username, initialPassword: null, alreadyApplied: true }
    }
    const now = iso(new Date())
    db.prepare('UPDATE platform_accounts SET password_hash = ?, must_change_password = 1, reset_marker = ?, updated_at = ? WHERE id = ?')
      .run(hash(username, newPassword), marker, now, row.id)
    /* 旧会话一律作废 —— 重置的意义就是「之前登着的那些不算数了」 */
    const gone = db.prepare('DELETE FROM platform_auth_sessions WHERE account_id = ?').run(row.id)
    logger.log(`[platform] 已重置平台账号 ${username}(首登强制改密,吊销旧会话 ${gone.changes} 个)。`
      + '🔴 口令**未输出、也未落盘** —— 它只存在于你设的那个环境变量里。')
    return { created: false, username, initialPassword: null, reset: true, revokedSessions: gone.changes }
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

  function logout(token) { return db.prepare('DELETE FROM platform_auth_sessions WHERE token = ?').run(String(token || '')).changes }

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

  /** 开机自举。**口令一个字符都不进日志。**
   *
   *  🔴 D203(店主 09o 裁,硬挡推):这里原来把一次性口令**明文打进启动日志**。
   *  本机看着没事,**生产不是** —— Railway 的部署日志是留存的、面板上看得到、**事后删不掉**。
   *  而它是**平台级**凭据:一把钥匙,所有店。不可逆 + 平台级 + 这次推夹带进来的,三条占全。
   *  J-53:密钥不进任何输出 —— **包括「只打给人看一眼」这种输出**,因为日志不是「一眼」。
   *
   *  于是口令现在**没有任何出口**。这是有意的,不是漏掉的:
   *  口令有没有出口,取决于这个账号到底用不用(店主 09o §一 的甲/乙二选一),
   *  而那一问要等「平台后台现在走哪条鉴权」答完才定。**在那之前,宁可没人登得上,也不许留在日志里。**
   *  (乙)一旦定下,走的是环境变量那条:店主亲手生成与灌入,代码不生成、不打印、不拷贝,
   *  读不到就拒绝启动、不回落成空 —— 与 `WECHAT_MINI_TOKEN_SECRET` 同族。
   *
   *  幂等按「建过没有」判(幂等判据律):建过就一个字不动,重启一百次也不会换密码。 */
  function bootstrapAndReport(logger = console) {
    /* 🔴 D203 · 甲支(店主 09o §一 预裁:「(甲) 这个账号现在没用 → 那就别在这次推里建它」)。
     *
     * 现查的证据(09m 问 3,见 09o 回执 §一):平台后台三条门
     *   ① `Bearer OWNER_TOKEN`(`local-server.mjs:12713`)
     *   ② `platformAuth.fromSession`(`:12714`)—— 要 `platform_accounts` 里有行
     *   ③ 「记住这台电脑」的 cookie(`:12715`)—— **只能由②换来**(`:13046` 现证)
     * 而**生产库 `platform_accounts` 现在是 0 行** ⇒ ②③ 在线上都无人可用 ⇒ 今天走的就是 ①。
     * **⇒ 甲成立:这个账号现在没用。**
     *
     * 于是自举**默认关掉**,而不是「生产关、别处开」:
     * `scopeOf()` 在生产上返回的是 `'local'`(生产库路径正好以 `local-data` 结尾),
     * 拿它判生产会判反;拿 `NODE_ENV/RAILWAY_ENVIRONMENT` 判则是**漏判即建号**——
     * 朝不安全那边失败(J-68:尺子错要错在保守那一侧)。
     * 默认关 = 漏判也只是「没建」,**没有任何一条路会因此凭空生出一把取不到口令的平台钥匙**。
     *
     * 要开:显式 `PLATFORM_ADMIN_BOOTSTRAP=1`(判据②层就是这么开的)。
     * 乙支真要落地时,连着 D149 密码登录一起设计:口令从环境变量来、店主亲手灌,
     * 代码不生成不打印不拷贝,读不到就拒绝启动。 */
    /* ══ 🔴 乙支落地(店主 11p §二 选的那一支,2026-09-23)══
     *
     * 店主原话:「平台控制台账号密码我找不到了,给我重置,我登不进去。」
     * 现查:**生产库 `platform_accounts` = 0 行** —— 所以这不是「重置」,是**这个账号从来没存在过**。
     * D203 当时把自举默认关了,理由是一次性口令会进 Railway 部署日志且删不掉,
     * 并明写「(乙)一旦定下,走环境变量那条:店主亲手生成与灌入,代码不生成、不打印、不拷贝」。
     * **今天这句话就是选了乙。**
     *
     * 🔴 与 `WECHAT_MINI_TOKEN_SECRET` 同族的三条,一条不减:
     *   ① 口令**只从环境变量来** —— 代码不 `randomPassword()`,不生成就没有「一次性口令」这个东西;
     *   ② **不许回落**:开关开着但没给口令 ⇒ **不建**,不是「那就随机一个」(那等于回到 D203 之前);
     *   ③ 日志只说「建了 / 没建 / 为什么没建」,**值、长度、前缀、哈希一律不出现**。 */
    const BOOT = String(process.env.PLATFORM_ADMIN_BOOTSTRAP || '') === '1'
    const RESET = String(process.env.PLATFORM_ADMIN_RESET || '') === '1'
    const PW = String(process.env.PLATFORM_ADMIN_INITIAL_PASSWORD || '')
    if (!BOOT && !RESET) {
      logger.log('[platform] 自举平台账号:**本次未建**(默认关)。'
        + '要建请显式设 PLATFORM_ADMIN_BOOTSTRAP=1 与 PLATFORM_ADMIN_INITIAL_PASSWORD=<你自己生成的一串>。')
      return { created: false, username: 'platform-admin', initialPassword: null }
    }
    if (!PW) {
      /* 🔴 这一句是乙支的核心:**开关开着、口令没给 ⇒ 什么也不做。**
         不回落成随机口令 —— 随机口令要么进日志(D203 那个病),要么没人拿得到(等于没建)。 */
      logger.log('[platform] 自举/重置平台账号:**缺初始口令,未建也未改**。'
        + '请设 PLATFORM_ADMIN_INITIAL_PASSWORD 后重启(代码不会替你生成一个)。')
      return { created: false, username: 'platform-admin', initialPassword: null }
    }
    try {
      if (RESET) return resetPlatformAdmin('platform-admin', PW, logger)
      const boot = bootstrapPlatformAdmin('platform-admin', PW)
      /* 🔴 只报「建了没有」,不报口令。**连长度、前缀、哈希都不报** ——
         那些都是「拿值去猜值」的入口,而这一行的唯一职责是让人知道这件事发生过。 */
      if (boot.created) {
        logger.log(`[platform] 已建平台账号 ${boot.username}(首登强制改密)。`
          + '🔴 一次性口令**未输出、也未落盘** —— D203:平台级凭据不进任何留存的地方。')
      }
      /* 口令不往外交:调用方拿到的 initialPassword 一律是 null,免得它在别处又被打一遍。 */
      return { ...boot, initialPassword: null }
    } catch (e) {
      /* 🔴 拒绝分支同样不许念钥匙:只交 message,且 message 里不会有值
         —— INSERT 进去的是 hash,不是明文(见 bootstrapPlatformAdmin)。 */
      logger.error('[platform] 自举平台账号失败(不阻塞启动):', e.message)
      return { created: false, username: 'platform-admin', initialPassword: null }
    }
  }

  return { bootstrapPlatformAdmin, bootstrapAndReport, login, fromSession, changePassword, logout, hash, handle }
}
