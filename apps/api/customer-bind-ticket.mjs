// Shared by merchant detail and checkout; no balance or history mutation.
export function createCustomerBindTicket({db,apiError,currentTenantId,isUserBound,iso,randomBytes,publicAppUrl,sceneForToken,WECHAT_MINI_APPID,WECHAT_MINI_SECRET,json,requireActive}) {
 return (req,res,path,adminSession)=>{
    if (adminSession.role !== 'owner' && adminSession.role !== 'staff') throw apiError(403, 'FORBIDDEN', '需要员工或老板权限。')
    const uid = decodeURIComponent(path.split('/')[3])
    const u = db.prepare('SELECT id, display_name, tenant_id FROM users WHERE id = ?').get(uid)
    if (!u || u.tenant_id !== currentTenantId()) throw apiError(404, 'NOT_FOUND', '找不到这份顾客档案。')
    requireActive(currentTenantId(),'customers',uid)
    if (isUserBound(uid)) throw apiError(400, 'ALREADY_BOUND', '这份档案已绑定微信,不需要绑定码。')
    const now = iso(new Date())
    db.prepare("UPDATE archive_bind_tokens SET status = 'superseded' WHERE tenant_id = ? AND user_id = ? AND status = 'active'").run(currentTenantId(), uid)
    const token = 'bind_' + randomBytes(32).toString('hex')
    const expiresAt = iso(new Date(Date.now() + 48 * 3600 * 1000))
    db.prepare(`INSERT INTO archive_bind_tokens (token, tenant_id, user_id, status, expires_at, created_by, created_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?)`).run(token, currentTenantId(), uid, expiresAt, adminSession.email || adminSession.role || 'admin', now)
    return json(res, 201, {
      token, expiresAt,
      url: `${publicAppUrl()}/bind?t=${encodeURIComponent(token)}`,
      pagePath: `/pages/bind/index?token=${encodeURIComponent(token)}`,
      miniCodePath: WECHAT_MINI_APPID && WECHAT_MINI_SECRET ? `/mini-code/${sceneForToken(token)}` : '',
      displayName: u.display_name || '顾客',
      hint: '请顾客扫码完成绑定——只绑定,不会进入签署、看不到结算单'
    })
 }
}
