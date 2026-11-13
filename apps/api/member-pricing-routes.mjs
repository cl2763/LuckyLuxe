import {memberDiscountInput} from './member-discount-input.mjs'
import {makeActorOf} from './actor-name.mjs'
/** Versioned endpoints for the approved future clients. Mounted after the admin tenant gate. */
export function createMemberPricingRoutes({db,policy,preview,apiError,json,readBody,currentTenantId,isPlatformKey}) {
  const readInput=async req=>{const value=await readBody(req);if(!value||typeof value!=='object'||Array.isArray(value))throw apiError(400,'BAD_REQUEST','请求内容须为对象。');return value}
  const actorOf=makeActorOf({apiError})
  const owner = admin => {if(admin?.role!=='owner') throw apiError(403,'FORBIDDEN','仅老板可修改这项设置。')}
  return async function memberPricingRoute(req,res,{path,adminSession}) {
    if(!path.startsWith('/admin/member-pricing/')) return false
    if(!adminSession || !['owner','staff'].includes(adminSession.role)) throw apiError(403,'FORBIDDEN','需要门店员工身份。')
    const tid=currentTenantId(),method=req.method
    if(path==='/admin/member-pricing/preview'&&method==='POST') {json(res,200,preview(tid,await readInput(req),adminSession));return true}
    if(path==='/admin/member-pricing/discount-input'&&method==='GET'){json(res,200,memberDiscountInput());return true}
    if(path==='/admin/member-pricing/config') {
      if(method==='GET'){json(res,200,{config:policy.config(tid)});return true}
      if(method==='PUT'){owner(adminSession);const input=await readInput(req);if(input.membershipEnabled!==undefined&&input.membershipEnabled!==policy.config(tid).membershipEnabled&&!isPlatformKey(req))throw apiError(403,'PLATFORM_MANAGED','会员制度开关由平台按门店配置。');json(res,200,{config:policy.setConfig(tid,input)});return true}
    }
    const receiptMatch=path.match(/^\/admin\/member-pricing\/operations\/([^/]+)$/)
    if(receiptMatch&&method==='GET') {
      const receipt=db.prepare('SELECT result_json FROM member_pricing_operations WHERE tenant_id=? AND operation_id=?').get(tid,decodeURIComponent(receiptMatch[1]))
      if(!receipt)throw apiError(404,'NOT_FOUND','没有这笔操作回执。')
      json(res,200,JSON.parse(receipt.result_json));return true
    }
    let match=path.match(/^\/admin\/member-pricing\/services\/([^/]+)\/(display|settlement)$/)
    if(match) {
      const id=decodeURIComponent(match[1]),system=match[2]
      if(method==='GET'){json(res,200,policy.prices(tid,id,system));return true}
      if(method==='PUT'){owner(adminSession);json(res,200,policy.setPrices(tid,id,system,await readInput(req)));return true}
    }
    match=path.match(/^\/admin\/member-pricing\/packages\/([^/]+)$/)
    if(match) {
      const id=decodeURIComponent(match[1])
      if(method==='GET'){json(res,200,policy.packageDiscount(tid,id));return true}
      if(method==='PUT'){owner(adminSession);json(res,200,policy.setPackageDiscount(tid,id,await readInput(req)));return true}
    }
    match=path.match(/^\/admin\/member-pricing\/members\/([^/]+)(\/history)?$/)
    if(match) {
      const id=decodeURIComponent(match[1])
      if(method==='GET'){json(res,200,match[2]?{events:policy.history(tid,id)}:policy.discount(tid,id));return true}
      if(method==='PUT'&&!match[2]) {
        owner(adminSession)
        const b=await readInput(req)
        json(res,200,policy.setDiscount(tid,id,b,{role:'owner',source:'owner',sourceId:b.operationId,actor:actorOf(adminSession)}));return true
      }
    }
    throw apiError(404,'NOT_FOUND','没有这个价格配置接口。')
  }
}
