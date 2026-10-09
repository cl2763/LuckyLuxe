import { isWechatLoginProvider } from './identity-kinds.mjs'
import { releaseEmptyRegistration } from './archive-binding.mjs'

// Demo fixtures may carry invalid mailbox identities and synthetic OpenIDs.
// They are never proof that the phone's WeChat owns the profile. Scope and
// tenant kind both have to match; real merchant identities keep their guard.
export function createScanIdentity({ db, scopeName, apiError, resolveUserByUnionId,
  randomId, iso, memberCodeForUserId, upsertUserIdentity, requireCustomer }) {
  const demoTenant = tenantId => (scopeName === 'sandbox' || scopeName === 'ci')
    && db.prepare("SELECT kind FROM tenants WHERE id=?").get(tenantId)?.kind === 'demo'
  const demoOpenId = (tenantId, openId) => demoTenant(tenantId)
    && /^demo-openid-[a-z0-9-]+$/i.test(String(openId || ''))
  const demoEmail = (target, identity) => demoTenant(target.tenant_id)
    && identity.provider === 'email' && /^demo\d+@example\.invalid$/i.test(String(target.email || ''))
    && identity.provider_user_id === target.email

  function isUserBound(userId) {
    if (!userId) return false
    const u = db.prepare('SELECT wechat_open_id, tenant_id FROM users WHERE id=?').get(userId)
    if (u?.wechat_open_id && !demoOpenId(u.tenant_id, u.wechat_open_id)) return true
    return db.prepare("SELECT provider_user_id FROM user_identities WHERE user_id=? AND provider LIKE 'wechat%'").all(userId)
      .some(i => !demoOpenId(u?.tenant_id, i.provider_user_id))
  }

  // A signed mini token is trusted only if its OpenID still matches the same
  // real row. A sandbox preview token must never skip the confirmation card.
  function verifiedCustomerForScan(req) {
    try {
      const user = requireCustomer(req)
      const token = String(req.headers.authorization || '').replace(/^Bearer /, '')
      const openId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).openid
      const row = db.prepare('SELECT tenant_id,wechat_open_id FROM users WHERE id=?').get(user.id)
      return row?.wechat_open_id === openId && !demoOpenId(row.tenant_id, openId)
        ? { id:user.id, tenantId:row.tenant_id } : null
    } catch (e) { return null }
  }

  function claimUserByOpenId({ tenantId, userId, provider = 'wechat_miniprogram', providerUserId,
    settlementCode = '', unionId = '', allowEmptyRegistration = false }) {
    const target = db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=?').get(userId, tenantId)
    if (!target) throw apiError(404, 'NOT_FOUND', '找不到这份顾客档案。')
    if (target.wechat_open_id && target.wechat_open_id !== providerUserId && !demoOpenId(tenantId,target.wechat_open_id))
      throw apiError(409, 'PROFILE_ALREADY_BOUND', '这份档案已被其他微信绑定，请联系门店核对。')
    const occupied = db.prepare('SELECT provider,provider_user_id FROM user_identities WHERE user_id=?').all(userId)
    if (occupied.some(i => isWechatLoginProvider(i.provider) && !(i.provider === provider && i.provider_user_id === providerUserId)
      && !demoEmail(target,i) && !(i.provider === 'wechat_miniprogram' && demoOpenId(tenantId,i.provider_user_id))))
      throw apiError(409, 'PROFILE_ALREADY_BOUND', '这份档案已有登录身份，请联系门店核对。')
    let boundRow = db.prepare('SELECT ui.user_id FROM user_identities ui JOIN users u ON u.id=ui.user_id WHERE ui.provider=? AND ui.provider_user_id=? AND u.tenant_id=?').get(provider,providerUserId,tenantId)
      || db.prepare('SELECT id AS user_id FROM users WHERE wechat_open_id=? AND tenant_id=?').get(providerUserId,tenantId)
    if (!boundRow && unionId) { const unionUser=resolveUserByUnionId(unionId,tenantId); if (unionUser) boundRow={user_id:unionUser.id} }
    if (allowEmptyRegistration && boundRow?.user_id !== userId && boundRow?.user_id
      && releaseEmptyRegistration(db,boundRow.user_id,target,providerUserId)) boundRow=null
    if (boundRow?.user_id && boundRow.user_id !== userId) {
      const other = db.prepare('SELECT tenant_id FROM users WHERE id=?').get(boundRow.user_id)
      if (other?.tenant_id === tenantId) {
        db.prepare(`INSERT INTO identity_merge_queue (id,tenant_id,provider,provider_user_id,bound_user_id,target_user_id,settlement_code,status,note,created_at)
          VALUES (?,?,?,?,?,?,?,'open',?,?)`)
          .run(randomId('mrg'),tenantId,provider,providerUserId,boundRow.user_id,userId,settlementCode,
            '该微信已绑本店另一档案,不覆盖;签字照走,等人工合并',iso(new Date()))
        return {bound:false,conflict:true,mergeQueued:true,memberCode:memberCodeForUserId(userId)}
      }
    }
    if (boundRow?.user_id === userId)
      return {bound:true,conflict:false,alreadyBound:true,memberCode:memberCodeForUserId(userId)}
    // Only a verified claim can replace this demo profile's fake identity.
    // No balance, order, or signed-history record is changed.
    if (demoOpenId(tenantId,target.wechat_open_id)) {
      db.prepare("DELETE FROM user_identities WHERE user_id=? AND provider='wechat_miniprogram' AND provider_user_id=?")
        .run(userId,target.wechat_open_id)
      db.prepare('UPDATE users SET wechat_open_id=NULL WHERE id=? AND wechat_open_id=?').run(userId,target.wechat_open_id)
    }
    db.prepare("UPDATE users SET wechat_open_id=COALESCE(NULLIF(wechat_open_id,''),?) WHERE id=?").run(providerUserId,userId)
    upsertUserIdentity({userId,provider,providerUserId,unionId,phone:target.phone||''})
    return {bound:true,conflict:false,memberCode:memberCodeForUserId(userId)}
  }
  return {isUserBound,verifiedCustomerForScan,claimUserByOpenId}
}
