import {createHmac,timingSafeEqual} from 'node:crypto'

// 图片/web-view 无法附带会话头：只下发当前单的限时只读凭据，不传播登录令牌。
export function createSettlementReadAccess({secret,apiError,requireAdmin,writeAccess,demoAllowed}) {
  const mac=(code,expires)=>createHmac('sha256',secret).update(`settlement-read-v1:${code}:${expires}`).digest('hex')
  function url(code,kind='snapshot') {
    const expires=Math.floor(Date.now()/1000)+3600
    return `/settlements/${encodeURIComponent(code)}/${kind}?view=${expires}.${mac(code,expires)}`
  }
  function authorize(req,row,query={}) {
    if(query.view){
      const [expires,signature,...extra]=String(query.view).split('.')
      if(extra.length||!/^\d{10}$/.test(expires)||!(/^[a-f0-9]{64}$/.test(signature||''))||Number(expires)<=Date.now()/1000||!timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(mac(row.code,expires),'hex')))throw apiError(401,'DOCUMENT_LINK_INVALID','查看链接已过期或无效，请返回订单重新打开。')
      return
    }
    if(demoAllowed())return
    if(req.headers['x-settlement-token']){writeAccess.tokenRow(req.headers['x-settlement-token'],row);return}
    let admin
    try{admin=requireAdmin(req)}catch(e){if(e.status!==401&&e.statusCode!==401)throw e}
    if(admin){
      if(admin.tenantId!==row.tenant_id)throw apiError(403,'DOCUMENT_FORBIDDEN','只能查看本店的单据。')
      writeAccess.assertStaff(admin,row)
      return
    }
    writeAccess.authorize(req,row)
  }
  return {url,authorize}
}
