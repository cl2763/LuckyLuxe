import {activeRecords} from './record-lifecycle.mjs'
export function createGiftRoutes({db,currentTenantId,giftEntitlements,apiError,json,readBody,actorOf,assertRecordActive}){
 async function route({req,res,path,adminSession}){
  if(path!=='/admin/gift-entitlements/config'&&!/^\/admin\/customers\/[^/]+\/gift-entitlements(?:\/[^/]+\/(?:claim|return|void))?$/.test(path))return false
  await handle({req,res,path,adminSession});return true
 }
 async function handle({req,res,path,adminSession}){
  if(path==='/admin/gift-entitlements/config'&&req.method==='GET')return json(res,200,{enabled:giftEntitlements.enabled(currentTenantId()),...(adminSession.role==='owner'?{services:activeRecords(db,currentTenantId(),'services',db.prepare('SELECT id,name_zh AS name FROM services WHERE tenant_id=? AND is_active=1 ORDER BY name_zh').all(currentTenantId())),coupons:activeRecords(db,currentTenantId(),'coupons',db.prepare('SELECT id,name FROM coupons WHERE tenant_id=? AND is_active=1 AND is_custom=0 ORDER BY name').all(currentTenantId()))}:{})})
  if(path==='/admin/gift-entitlements/config')throw apiError(405,'METHOD_NOT_ALLOWED','不支持该操作。')
  const giftMatch=path.match(/^\/admin\/customers\/([^/]+)\/gift-entitlements(?:\/([^/]+)\/(claim|return|void))?$/)
  if(giftMatch){
    const tid=currentTenantId(),uid=decodeURIComponent(giftMatch[1])
    if(!db.prepare('SELECT 1 FROM users WHERE id=? AND tenant_id=?').get(uid,tid))throw apiError(404,'NOT_FOUND','找不到本店顾客。')
    if(adminSession.role!=='owner'&&(adminSession.role!=='staff'||!adminSession.technicianId||!db.prepare('SELECT 1 FROM bookings WHERE tenant_id=? AND user_id=? AND technician_id=?').get(tid,uid,adminSession.technicianId)))throw apiError(403,'FORBIDDEN','只能查看自己服务过或被指定服务的顾客。')
    if(req.method==='GET'&&!giftMatch[2])return json(res,200,{enabled:giftEntitlements.enabled(tid),gifts:giftEntitlements.list(tid,uid).map(g=>adminSession.role==='owner'?g:({...g,unitValueCents:undefined,sourceTxnId:undefined}))},{'cache-control':'no-store'})
    if(req.method==='POST'&&giftMatch[3]){
      if(giftMatch[3]!=='claim'&&adminSession.role!=='owner')throw apiError(403,'FORBIDDEN','更正或作废权益需要老板操作。')
      if(giftMatch[3]==='claim')assertRecordActive(db,apiError,tid,'customers',uid)
      return json(res,200,giftEntitlements.physical(tid,uid,decodeURIComponent(giftMatch[2]),giftMatch[3],await readBody(req),actorOf(adminSession)))
    }
    throw apiError(405,'METHOD_NOT_ALLOWED','不支持该操作。')
  }
 }
 return {route}
}
