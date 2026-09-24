// 网页短时链接只授权当前单；长期小程序会话不可放进 URL。
export function createSettlementAccess({db,apiError,requireCustomer,demoAllowed}) {
  function tokenRow(token, row) {
    const tk=db.prepare('SELECT * FROM settlement_sign_tokens WHERE token=?').get(String(token||''))
    if(!tk)throw apiError(401,'SIGN_AUTH_REQUIRED','请使用商家提供的签署链接，或从自己的小程序订单进入。')
    if(tk.status!=='active')throw apiError(410,'SIGN_TOKEN_SUPERSEDED','链接已被替换，请向商家获取最新签署链接。')
    if(!Number.isFinite(Date.parse(tk.expires_at))||Date.parse(tk.expires_at)<=Date.now())throw apiError(410,'SIGN_TOKEN_EXPIRED','签署链接已过期，请商家重新生成。')
    if(tk.settlement_id!==row.id||tk.tenant_id!==row.tenant_id)throw apiError(403,'SIGN_TOKEN_MISMATCH','这份链接不能用于其他单据。')
    if(row.status==='voided')throw apiError(409,'SETTLEMENT_VOIDED','这张结算单已撤回，请联系商家。')
    return tk
  }
  function authorize(req,row,{signing=false,body={}}={}) {
    const token=req.headers['x-settlement-token']
    if(token){
      tokenRow(token,row)
      if(signing&&body.signerConfirmed!==true)throw apiError(400,'SIGNER_CONFIRMATION_REQUIRED','请先核对并确认这是本人的服务单。')
      return {kind:'link'}
    }
    // 历史演示夹具仍可运行；该闸在生产结构性关闭，与微信密钥有无无关。
    if(demoAllowed())return {kind:'demo'}
    const customer=requireCustomer(req)
    const user=db.prepare('SELECT id,tenant_id FROM users WHERE id=?').get(customer.id)
    if(!user||user.id!==row.user_id||user.tenant_id!==row.tenant_id)throw apiError(403,'SETTLEMENT_OWNER_REQUIRED','只能操作本人的服务单。')
    return {kind:'customer',customer}
  }
  function claimIdentity(req,body,tenantId,userId){
    if(demoAllowed())return {sandbox:true,openid:String(body.openid||'').trim()||`demo-openid-${userId}`,unionId:String(body.unionid||'')}
    const customer=requireCustomer(req)
    const verified=db.prepare('SELECT wechat_open_id,tenant_id FROM users WHERE id=?').get(customer.id)
    if(!verified?.wechat_open_id||verified.tenant_id!==tenantId)throw apiError(403,'WECHAT_IDENTITY_REQUIRED','请先用微信完成真实授权。网页签字无需绑定微信。')
    return {sandbox:false,openid:verified.wechat_open_id,unionId:''}
  }
  function assertStaff(admin,row){
    if(admin.role==='staff'&&!db.prepare('SELECT 1 FROM settlement_technicians WHERE settlement_id=? AND tenant_id=? AND technician_id=?').get(row.id,row.tenant_id,admin.technicianId))throw apiError(403,'FORBIDDEN','只能为自己参与服务的单据生成签署链接。')
  }
  return {tokenRow,authorize,claimIdentity,assertStaff}
}
