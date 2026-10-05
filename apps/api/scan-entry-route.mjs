import { getMiniCode } from './wechat-mini-code.mjs'
import { randomUUID } from 'node:crypto'

export function createSignTokenHelpers({ db, iso, publicAppUrl, scopeName, appPublicUrl }) {
  function issueSignToken(settlement, { actor = 'admin', ttlHours = 24 } = {}) {
    const now = new Date()
    db.prepare("UPDATE settlement_sign_tokens SET status = 'superseded' WHERE settlement_id = ? AND status = 'active'").run(settlement.id)
    const token = `sg_${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`
    const expiresAt = iso(new Date(now.getTime() + ttlHours * 3_600_000))
    db.prepare(`INSERT INTO settlement_sign_tokens (token, tenant_id, settlement_id, status, expires_at, created_by, created_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?)`).run(token, settlement.tenant_id, settlement.id, expiresAt, actor, iso(now))
    return { token, expiresAt }
  }
  const activeSignToken = (id) => db.prepare("SELECT * FROM settlement_sign_tokens WHERE settlement_id = ? AND status = 'active' ORDER BY created_at DESC, rowid DESC LIMIT 1").get(id) || null
  function signTokenUrl(token) {
    const tid = db.prepare('SELECT tenant_id FROM settlement_sign_tokens WHERE token=?').get(token)?.tenant_id
    // A sandbox token must always return to the same isolated service.
    const base = scopeName === 'sandbox' && appPublicUrl ? appPublicUrl : publicAppUrl(tid)
    return `${base}/sign?t=${encodeURIComponent(token)}`
  }
  return { issueSignToken, activeSignToken, signTokenUrl }
}

// Only short random aliases appear in WeChat codes. Resolve the bearer token
// server-side and recheck its lifetime for every read and claim.
export function createScanEntryRoute({ db, apiError, json, readBody, fetchJsCode2Session,
  claimUserByOpenId, serializeUser, miniAuthFor, appid, secret, scopeName }) {
  function scanToken(scene) {
    if (!/^[sb][0-9a-f]{24}$/.test(String(scene || ''))) throw apiError(404, 'BAD_SCAN_CODE', '这个码无效，请让店员重新出示。')
    const sign = scene[0] === 's'
    const prefix = `${sign ? 'sg_' : 'bind_'}${scene.slice(1)}`
    const table = sign ? 'settlement_sign_tokens' : 'archive_bind_tokens'
    const matches = db.prepare(`SELECT * FROM ${table} WHERE token LIKE ?`).all(`${prefix}%`)
    if (matches.length !== 1) throw apiError(404, 'BAD_SCAN_CODE', '这个码无效，请让店员重新出示。')
    const ticket = matches[0]
    if (ticket.status !== 'active' || ticket.expires_at < new Date().toISOString()) throw apiError(410, 'SCAN_CODE_EXPIRED', '这个码已失效，请让店员重新出示。')
    return { sign, ticket }
  }
  return async function scanEntryRoute(req, res, path) {
    if (req.method === 'GET' && path.startsWith('/mini-code/')) {
      const scene = path.split('/')[2] || ''
      scanToken(scene)
      if (!appid || !secret) throw apiError(503, 'MINI_CODE_NOT_CONFIGURED', '小程序码配置未就绪，请联系平台。')
      const image = await getMiniCode({ appid, secret, scene, envVersion: scopeName === 'production' ? 'release' : 'trial' })
      res.writeHead(200, { 'content-type': image.mimeType, 'content-length': image.bytes.length, 'cache-control': 'no-store' })
      res.end(image.bytes)
      return true
    }
    if (req.method === 'GET' && path.startsWith('/scan/')) {
      const { sign, ticket } = scanToken(path.split('/')[2] || '')
      if (!sign) {
        const u = db.prepare('SELECT display_name FROM users WHERE id=? AND tenant_id=?').get(ticket.user_id, ticket.tenant_id)
        if (!u) throw apiError(404, 'NOT_FOUND', '找不到这份顾客档案。')
        const store = db.prepare('SELECT name FROM stores WHERE tenant_id=? ORDER BY rowid LIMIT 1').get(ticket.tenant_id)
        json(res, 200, { kind: 'bind', token: ticket.token, customerName: u.display_name || '顾客', storeName: store?.name || '' }, { 'cache-control': 'no-store' })
        return true
      }
      const row = db.prepare('SELECT * FROM settlements WHERE id=? AND tenant_id=?').get(ticket.settlement_id, ticket.tenant_id)
      if (!row || row.status !== 'pending_sign') throw apiError(410, 'SETTLEMENT_NOT_PENDING', '这张确认单不能继续签署。')
      const u = db.prepare('SELECT display_name FROM users WHERE id=? AND tenant_id=?').get(row.user_id, row.tenant_id)
      const store = db.prepare('SELECT name FROM stores WHERE tenant_id=? ORDER BY rowid LIMIT 1').get(row.tenant_id)
      json(res, 200, { kind: 'sign', code: row.code, token: ticket.token, customerName: u?.display_name || '顾客', storeName: store?.name || '', tenantId: row.tenant_id }, { 'cache-control': 'no-store' })
      return true
    }
    if (req.method === 'POST' && path.startsWith('/scan/') && path.endsWith('/claim')) {
      const scene = path.split('/')[2] || ''
      const { sign, ticket } = scanToken(scene)
      if (!sign) throw apiError(400, 'WRONG_SCAN_CODE', '绑定码不能当作签署码。')
      const row = db.prepare('SELECT * FROM settlements WHERE id=? AND tenant_id=?').get(ticket.settlement_id, ticket.tenant_id)
      if (!row || row.status !== 'pending_sign') throw apiError(410, 'SETTLEMENT_NOT_PENDING', '这张确认单不能继续签署。')
      const body = await readBody(req)
      const code = String(body.code || '').trim()
      if (!code) throw apiError(401, 'WECHAT_LOGIN_REQUIRED', '请先用微信确认本人身份。')
      const hop = await fetchJsCode2Session({ code, appid, secret, scopeName })
      if (hop.ok === false || hop.data?.errcode || !hop.data?.openid) throw apiError(401, 'WECHAT_LOGIN_FAILED', '微信身份验证失败，请重试。')
      db.exec('BEGIN IMMEDIATE')
      let result
      try {
        scanToken(scene)
        const out = claimUserByOpenId({ tenantId: row.tenant_id, userId: row.user_id, providerUserId: hop.data.openid, unionId: hop.data.unionid || '', settlementCode: row.code, allowEmptyRegistration: true })
        const user = out.bound ? serializeUser(db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id), row.tenant_id) : null
        result = { ...out, sandbox: hop.viaStub === true, tenantId: row.tenant_id, code: row.code,
          ...(user ? { user, auth: miniAuthFor(user, hop.data.openid) } : {}) }
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
      json(res, 200, result, { 'cache-control': 'no-store' })
      return true
    }
    return false
  }
}
