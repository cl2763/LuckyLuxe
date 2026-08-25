/* 平台后台「记住这台电脑」(店主 2026-08-25 裁定)。

   店主问的是「平台后台能不能改成密码登录」——裁定是**不改**:
   平台后台是全系统权力最大的门(建店/删店/改归属/重置账本/导顾客/改 AI 口径),
   今天令牌的强度来自三点:长、随机、**不在数据库里**;改成密码就变成"人记得住的字符串",
   还得配重置流程(它本身又是攻击面)。最实在的一条:密码框会被浏览器记住并跨设备同步 ——
   **平台钥匙会散到所有设备与 Google 账号里**(店主已经被自动填的密码骗过一次)。

   正解是"钥匙不换,只是不用每次掏":贴一次令牌 → 勾「记住这台电脑」→
   服务端签一张**长期会话**放进 httpOnly Cookie(前端读不到、也不再往 localStorage 存令牌),
   会话绑这台设备(UA 指纹),30 天到期;平台端另给一个「吊销所有设备」一键。
   凭据强度一分没降,日常麻烦归零。TOTP 现阶段过度(单人单设备、30 天一次),不做。 */
export function createPlatformSessions({ db, randomId, iso, sha256 }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_sessions (
      id TEXT PRIMARY KEY,
      ua_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT
    );
  `)
  const COOKIE = 'll_platform'
  const uaHash = (ua) => sha256(`ua:${String(ua || '')}`).slice(0, 32)

  function parseCookies(header) {
    const out = {}
    for (const part of String(header || '').split(';')) {
      const i = part.indexOf('=')
      if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim()
    }
    return out
  }

  /* 签一张会话。secure:生产(https)必须带 Secure;本机 http 带了浏览器就不存了。
     SameSite=Strict:平台后台全是写操作,跨站根本不该带上这张票(CSRF 从源头掐掉)。 */
  function issue({ userAgent, days = 30, secure }) {
    const id = `pss_${randomId('x').slice(2)}_${randomId('y').slice(2)}`
    const now = new Date()
    const expiresAt = iso(new Date(now.getTime() + days * 86400000))
    db.prepare('INSERT INTO platform_sessions (id, ua_hash, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, uaHash(userAgent), iso(now), expiresAt, iso(now))
    const flags = ['HttpOnly', 'Path=/', `Max-Age=${days * 86400}`, 'SameSite=Strict']
    if (secure) flags.push('Secure')
    return { id, expiresAt, cookie: `${COOKIE}=${id}; ${flags.join('; ')}` }
  }

  /* 校验:票在、没过期、**且是这台设备**。任一条不满足都当没登录(fail-closed)。 */
  function verify({ cookieHeader, userAgent }) {
    const id = parseCookies(cookieHeader)[COOKIE]
    if (!id) return false
    const row = db.prepare('SELECT * FROM platform_sessions WHERE id = ?').get(id)
    if (!row) return false
    if (row.expires_at < iso(new Date())) { db.prepare('DELETE FROM platform_sessions WHERE id = ?').run(id); return false }
    if (row.ua_hash !== uaHash(userAgent)) return false      // 票被搬到别的设备 → 不认
    db.prepare('UPDATE platform_sessions SET last_seen_at = ? WHERE id = ?').run(iso(new Date()), id)
    return true
  }

  function revokeAll() {
    const n = db.prepare('SELECT COUNT(*) n FROM platform_sessions').get().n
    db.exec('DELETE FROM platform_sessions')
    return n
  }

  const list = () => db.prepare('SELECT id, created_at, expires_at, last_seen_at FROM platform_sessions ORDER BY created_at DESC').all()
  const clearCookie = () => `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict`

  return { issue, verify, revokeAll, list, clearCookie, COOKIE }
}
