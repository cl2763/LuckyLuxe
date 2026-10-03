import { makeActorOf } from './actor-name.mjs'
// Physical goods are quantity rights, never a cash balance or a service payment.
export function createMigrationGifts({db,apiError,randomId,iso,createHash,currentTenantId,todayOf}) {
 const actorOf=makeActorOf({apiError}),hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex')
 const fail=(status,code,message)=>{throw apiError(status,code,message)}
 const text=(v,max)=>typeof v==='string'&&v.trim().length<=max?v.trim():''
 function ensureSchema(){db.exec(`
 CREATE TABLE IF NOT EXISTS migration_asset_activations (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,asset_id TEXT NOT NULL,kind TEXT NOT NULL,
 source_version TEXT NOT NULL,title TEXT NOT NULL,specification TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>=0),
 unit_value_cents INTEGER NOT NULL CHECK(unit_value_cents>=0),expires_on TEXT,review_json TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,
 UNIQUE(tenant_id,asset_id));
 CREATE TABLE IF NOT EXISTS migration_gift_events (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,grant_id TEXT NOT NULL,kind TEXT NOT NULL,
 delta INTEGER NOT NULL,parent_id TEXT,request_id TEXT NOT NULL,request_hash TEXT NOT NULL,
 reason TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,result_json TEXT NOT NULL,
 UNIQUE(tenant_id,request_id));
 CREATE INDEX IF NOT EXISTS migration_gift_events_grant ON migration_gift_events(tenant_id,grant_id);
 CREATE TRIGGER IF NOT EXISTS migration_asset_no_update BEFORE UPDATE ON migration_asset_activations BEGIN SELECT RAISE(ABORT,'activation is append-only');END;
 CREATE TRIGGER IF NOT EXISTS migration_asset_no_delete BEFORE DELETE ON migration_asset_activations BEGIN SELECT RAISE(ABORT,'activation is append-only');END;
 CREATE TRIGGER IF NOT EXISTS migration_gift_event_no_update BEFORE UPDATE ON migration_gift_events BEGIN SELECT RAISE(ABORT,'gift event is append-only');END;
 CREATE TRIGGER IF NOT EXISTS migration_gift_event_no_delete BEFORE DELETE ON migration_gift_events BEGIN SELECT RAISE(ABORT,'gift event is append-only');END;`)}
 function source(tid,uid,aid){
  const asset=db.prepare('SELECT * FROM customer_legacy_assets WHERE id=? AND tenant_id=? AND user_id=?').get(aid,tid,uid)
  if(!asset||!db.prepare('SELECT id FROM users WHERE id=? AND tenant_id=?').get(uid,tid))fail(404,'NOT_FOUND','没有这项旧赠品。')
  if(asset.asset_kind!=='gift')fail(409,'NOT_PHYSICAL_GIFT_SOURCE','此来源不是赠品记录，请按对应卡项核对。')
  const batches=db.prepare('SELECT id,data_cutoff_at FROM migration_batches WHERE tenant_id=? AND source_system=? ORDER BY data_cutoff_at DESC,id').all(tid,asset.source_system)
  return {asset,version:hash({asset,batches}),cutoff:batches[0]?.data_cutoff_at||null}
 }
 function grantOf(tid,uid,aid){return db.prepare("SELECT * FROM migration_asset_activations WHERE tenant_id=? AND user_id=? AND asset_id=?").get(tid,uid,aid)}
 function balance(tid,grant){if(grant.kind==='service'){const c=db.prepare('SELECT total_times,used_times,refunded_times FROM member_timecards WHERE id=? AND tenant_id=?').get(grant.id,tid);return c?c.total_times-c.used_times-(c.refunded_times||0):0}return grant.quantity+db.prepare('SELECT COALESCE(SUM(delta),0) n FROM migration_gift_events WHERE tenant_id=? AND grant_id=?').get(tid,grant.id).n}
 function summary(tid,g){const remaining=balance(tid,g),expired=!!g.expires_on&&g.expires_on<todayOf(tid);return {id:g.id,kind:g.kind,title:g.title,specification:g.specification,quantity:g.quantity,unitValueCents:g.unit_value_cents,expiresOn:g.expires_on,remaining,status:expired?'expired':remaining?'available':'exhausted'}}
 function preview(tid,uid,aid){const s=source(tid,uid,aid),g=grantOf(tid,uid,aid);return {assetId:aid,version:s.version,sourceTitle:s.asset.title,sourceDetails:JSON.parse(s.asset.raw_json),cutoff:s.cutoff,grant:g?summary(tid,g):null,
  events:g?db.prepare('SELECT id,kind,delta,parent_id,created_at FROM migration_gift_events WHERE tenant_id=? AND grant_id=? ORDER BY created_at DESC,id DESC LIMIT 100').all(tid,g.id).map(e=>({...e,returnable:e.kind==='claim'?Math.max(0,-e.delta-db.prepare("SELECT COALESCE(SUM(delta),0) n FROM migration_gift_events WHERE tenant_id=? AND parent_id=? AND kind='return'").get(tid,e.id).n):0})):[]}}
 function execute(tid,uid,aid,kind,body,actor){
  if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'BAD_REQUEST','请求格式无效。')
  const rid=text(body.requestId,80),reason=text(body.reason,1000)
  if(!/^[a-zA-Z0-9_-]{8,80}$/.test(rid)||!text(actor,200))fail(400,'CONFIRM_REQUIRED','请重新读取并确认操作。')
  const qty=body.quantity
  if(!Number.isSafeInteger(qty)||qty<0||qty>100000||(!['activate','activate-service'].includes(kind)&&qty===0))fail(400,'BAD_QUANTITY','数量须为整数；领取和退回数量必须大于零。')
  if(!reason)fail(400,'REASON_REQUIRED',kind==='claim'?'请记录顾客确认收货的依据。':'请填写核对或退回依据。')
  const payload={uid,aid,kind,quantity:qty,reason}
  if(kind==='activate'||kind==='activate-service'){
   const title=text(body.title,120),specification=text(body.specification,200),expiry=text(body.expiresOn,10),version=text(body.confirmVersion,64)
   if((kind==='activate'&&body.physicalGoodsConfirmed!==true)||body.sourceUseStopped!==true||body.rulesConfirmed!==true)fail(409,'RULES_NOT_CONFIRMED','请确认这是实物、原系统不再重复领取、现有规则能完整承接。服务赠卡不能当作实物领取。')
   if(!title||!Number.isSafeInteger(body.unitValueCents)||body.unitValueCents<0||body.unitValueCents>100000000||!/^[a-f0-9]{64}$/.test(version))fail(400,'BAD_GIFT','请核对名称、单件价值及最新来源。')
   if(body.noExpiry!==true){const time=Date.parse(expiry+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(expiry)||!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==expiry)fail(400,'EXPIRY_REQUIRED','请填写真实有效期，或明确选择无期限。')}
   else if(expiry)fail(400,'EXPIRY_CONFLICT','无期限与到期日期不能同时填写。')
   if(kind==='activate-service'){
    if(body.serviceGiftConfirmed!==true||body.noCashBalance!==true||body.oneUsePerService!==true)fail(409,'SERVICE_RULES_REQUIRED','仅支持独立赠送、无现金余额、每次服务扣一次的赠卡；付费或混合卡请保留待核对。')
    const serviceId=text(body.serviceId,160)
    const service=db.prepare('SELECT id FROM services WHERE tenant_id=? AND id=? AND is_active=1').get(tid,serviceId)
    if(!service)fail(400,'SERVICE_REQUIRED','请选择本店仍在售的具体服务。')
    Object.assign(payload,{serviceId,serviceGiftConfirmed:true,noCashBalance:true,oneUsePerService:true})
   }
   Object.assign(payload,{title,specification,expiresOn:body.noExpiry===true?null:expiry,unitValueCents:body.unitValueCents,version,physicalGoodsConfirmed:kind==='activate',sourceUseStopped:true,rulesConfirmed:true})
  }else if(kind==='return')payload.parentId=text(body.claimId,160)
  else if(kind!=='claim')fail(400,'BAD_ACTION','操作无效。')
  const requestHash=hash(payload)
  db.exec('BEGIN IMMEDIATE')
  try{
   const prior=db.prepare('SELECT request_hash,result_json FROM migration_gift_events WHERE tenant_id=? AND request_id=?').get(tid,rid)
   if(prior){if(prior.request_hash!==requestHash)fail(409,'REQUEST_CONFLICT','同一请求的内容发生变化，请重新核对。');db.exec('COMMIT');return {...JSON.parse(prior.result_json),replayed:true}}
   const s=source(tid,uid,aid);let grant=grantOf(tid,uid,aid);const now=iso(new Date());let delta=0,parent=null
   if(kind==='activate'||kind==='activate-service'){
    if(grant)fail(409,'ALREADY_ACTIVATED','这项旧赠品已启用，不能重复发放。')
    if(s.version!==payload.version)fail(409,'SOURCE_CHANGED','来源或迁移批次已变化，请重新核对。')
    const id=randomId('miggift')
    db.prepare(`INSERT INTO migration_asset_activations(id,tenant_id,user_id,asset_id,kind,source_version,title,specification,quantity,unit_value_cents,expires_on,review_json,actor,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,tid,uid,aid,kind==='activate-service'?'service':'physical',payload.version,payload.title,payload.specification,qty,payload.unitValueCents,payload.expiresOn,JSON.stringify(payload),actor,now)
    if(kind==='activate-service'){
     // Gift reference value is not principal, cash, earned revenue or a refund allowance.
     db.prepare(`INSERT INTO member_timecards(id,tenant_id,user_id,package_id,name,total_times,used_times,price_cents,project_group,expires_at,source_settlement_id,created_at,card_source)
       VALUES(?,?,?,NULL,?,?,0,0,NULL,?,NULL,?,'gift')`).run(id,tid,uid,payload.title,qty,payload.expiresOn,now)
    }
    grant=grantOf(tid,uid,aid)
   }else{
    if(!grant||grant.kind!=='physical')fail(409,'GIFT_NOT_ACTIVE','这项实物赠品尚未启用。')
    if(kind==='claim'){
     if(grant.expires_on&&grant.expires_on<todayOf(tid))fail(409,'GIFT_EXPIRED','赠品已到期，不能领取。')
     if(qty>balance(tid,grant))fail(409,'GIFT_INSUFFICIENT','剩余件数不足，请重新查看。')
     delta=-qty
    }else{
     const claim=db.prepare("SELECT * FROM migration_gift_events WHERE id=? AND tenant_id=? AND user_id=? AND grant_id=? AND kind='claim'").get(payload.parentId,tid,uid,grant.id)
     if(!claim)fail(404,'CLAIM_NOT_FOUND','找不到这笔原领取记录。')
     const returned=db.prepare("SELECT COALESCE(SUM(delta),0) n FROM migration_gift_events WHERE tenant_id=? AND parent_id=? AND kind='return'").get(tid,claim.id).n
     if(qty>-claim.delta-returned)fail(409,'RETURN_EXCEEDS_CLAIM','退回数量超过这笔领取尚可退回的件数。')
     delta=qty;parent=claim.id
    }
   }
   const eventId=randomId('giftevent'),remaining=balance(tid,grant)+delta
   const result={eventId,grantId:grant.id,assetId:aid,kind,quantity:qty,remaining,expiresOn:grant.expires_on,incomeImpactCents:0,createdAt:now}
   db.prepare(`INSERT INTO migration_gift_events(id,tenant_id,user_id,grant_id,kind,delta,parent_id,request_id,request_hash,reason,actor,created_at,result_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(eventId,tid,uid,grant.id,kind,delta,parent,rid,requestHash,reason,actor,now,JSON.stringify(result))
   db.exec('COMMIT');return result
  }catch(e){db.exec('ROLLBACK');throw e}
 }
 async function route({req,res,path,adminSession,readBody,json}){
  const m=path.match(/^\/admin\/customers\/([^/]+)\/migration-gifts\/([^/]+)(?:\/(activate|activate-service|claim|return))?$/)
  if(!m)return false
  if(adminSession?.role!=='owner')fail(403,'FORBIDDEN','仅老板可核对和处理旧赠品。')
  const tid=currentTenantId(),uid=decodeURIComponent(m[1]),aid=decodeURIComponent(m[2])
  if(req.method==='GET'&&!m[3])json(res,200,preview(tid,uid,aid))
  else if(req.method==='POST'&&m[3])json(res,200,execute(tid,uid,aid,m[3],await readBody(req),actorOf(adminSession)))
  else fail(405,'METHOD_NOT_ALLOWED','Method not allowed.')
  return true
 }
 return {ensureSchema,preview,execute,route}
}
