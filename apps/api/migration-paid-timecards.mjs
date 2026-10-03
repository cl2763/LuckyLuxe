import {makeActorOf} from './actor-name.mjs'
import {reconcileMigrationCards} from './migration-card-reconciliation.mjs'
export function createMigrationPaidTimecards({db,apiError,createHash,randomId,iso,currentTenantId,balanceSource}){
 const actorOf=makeActorOf({apiError}),hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex')
 const fail=(status,code,message)=>{throw apiError(status,code,message)}
 function ensureSchema(){db.exec(`CREATE TABLE IF NOT EXISTS migration_timecard_refund_receipts(
 tenant_id TEXT NOT NULL,request_id TEXT NOT NULL,payload_json TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id,request_id));
 CREATE TRIGGER IF NOT EXISTS migration_tc_refund_no_update BEFORE UPDATE ON migration_timecard_refund_receipts BEGIN SELECT RAISE(ABORT,'receipt immutable');END;
 CREATE TRIGGER IF NOT EXISTS migration_tc_refund_no_delete BEFORE DELETE ON migration_timecard_refund_receipts BEGIN SELECT RAISE(ABORT,'receipt immutable');END;`)}
 function activate(tid,uid,pid,body,actor){
  if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'BAD_REQUEST','核对内容无效。')
  if(!/^[a-zA-Z0-9_-]{8,80}$/.test(body.requestId||'')||!actor)fail(400,'CONFIRM_REQUIRED','请重新核对本次确认。')
  if(body.sourceUseStopped!==true||body.allBalanceAllocated!==true||body.equalPerUsePrincipal!==true)fail(409,'RULES_REQUIRED','须确认旧系统停止使用、总余额全部分配为本批次数卡、每次扣减相同本金。')
  const evidence=typeof body.evidence==='string'?body.evidence.trim():''
  if(!evidence||evidence.length>1000)fail(400,'EVIDENCE_REQUIRED','请填写核对依据，最多1000字。')
  const cutover=body.cutoverAt,t=Date.parse(cutover),day=String(cutover).slice(0,10),dayTime=Date.parse(day+'T00:00:00Z')
  if(typeof cutover!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(cutover)||!Number.isFinite(dayTime)||new Date(dayTime).toISOString().slice(0,10)!==day||!Number.isFinite(t)||t>Date.now())fail(400,'CUTOVER_REQUIRED','请提供非未来的、带时区的实际切换时间。')
  const review={uid,pid,confirmVersion:body.confirmVersion,currency:body.currency,cards:body.cards,sourceUseStopped:true,allBalanceAllocated:true,equalPerUsePrincipal:true,evidence,cutoverAt:cutover,mode:'paid_timecards'}
  const requestHash=hash(review)
  db.exec('BEGIN IMMEDIATE')
  try{
   const old=db.prepare('SELECT request_hash,result_json FROM migration_balance_activations WHERE tenant_id=? AND request_id=?').get(tid,body.requestId)
   if(old){if(old.request_hash!==requestHash)fail(409,'REQUEST_CONFLICT','同一请求的内容已变化。');db.exec('COMMIT');return{...JSON.parse(old.result_json),replayed:true}}
   const source=balanceSource(tid,uid,pid)
   if(source.pending.status!=='pending'||db.prepare('SELECT 1 FROM migration_balance_activations WHERE tenant_id=? AND pending_id=?').get(tid,pid))fail(409,'ALREADY_ACTIVATED','此来源已处理，不能重复分卡启用。')
   if(source.version!==body.confirmVersion)fail(409,'SOURCE_CHANGED','来源已经变化，请重新核对。')
   if(!source.link||source.link.opening_balance_applied_cents!==0||db.prepare("SELECT 1 FROM stored_value_transactions WHERE tenant_id=? AND user_id=? AND (type='migrate_opening' OR (type='bonus' AND bucket='legacy')) LIMIT 1").get(tid,uid))fail(409,'EXISTING_LEGACY_BALANCE','已有旧余额入账，不可再启用同一批付费卡。')
   const cutoff=source.records[0]?.data_cutoff_at||source.pending.data_cutoff_at
   if(!Number.isFinite(Date.parse(cutoff))||t<Date.parse(cutoff))fail(409,'CUTOVER_TOO_EARLY','请核对最新来源截止后的业务。')
   const assets=db.prepare("SELECT id,title,raw_json FROM customer_legacy_assets WHERE tenant_id=? AND user_id=? AND source_system=? AND source_record_id=? AND asset_kind='card' ORDER BY id").all(tid,uid,source.pending.source_system,source.pending.source_record_id)
   const result=reconcileMigrationCards({snapshotAmountCents:source.pending.snapshot_amount_cents,assets,currency:source.currency},body,apiError)
   if(!result.balanced)fail(409,'NOT_BALANCED','全部分卡必须明确，并与旧总余额完全对平；差额不得自动补齐。')
   for(const c of result.cards){
    if(c.kind!=='paid_timecard'||c.bonusCents!==0||c.remainingTimes<=0||c.paidCents<=0||c.paidCents%c.remainingTimes!==0)fail(409,'CARD_RULES_UNSUPPORTED','本入口仅支持纯本金、每次金额相同、无赠送金的付费次数卡；混合、零次或分币不均卡继续待核对。')
    if(!db.prepare('SELECT 1 FROM services WHERE tenant_id=? AND id=? AND is_active=1').get(tid,c.serviceId))fail(400,'SERVICE_REQUIRED','请选择本店在售的指定服务。')
    if(db.prepare('SELECT 1 FROM migration_asset_activations WHERE tenant_id=? AND asset_id=?').get(tid,c.assetId))fail(409,'ASSET_ALREADY_ACTIVE','同一旧卡已经启用，不能重复。')
   }
   const id=randomId('migpaid'),now=iso(new Date()),cards=[]
   for(const c of result.cards){
    const cardId=randomId('migtcard'),a=assets.find(a=>a.id===c.assetId),title=String(a.title||'迁入付费次卡').slice(0,120)
    db.prepare(`INSERT INTO migration_asset_activations(id,tenant_id,user_id,asset_id,kind,source_version,title,specification,quantity,unit_value_cents,expires_on,review_json,actor,created_at) VALUES(?,?,?,?,'paid_service',?,?,?,?,?,?,?,?,?)`).run(cardId,tid,uid,c.assetId,source.version,title,'',c.remainingTimes,c.paidCents/c.remainingTimes,c.expiresOn,JSON.stringify({...c,confirmationId:id}),actor,now)
    db.prepare(`INSERT INTO member_timecards(id,tenant_id,user_id,package_id,name,total_times,used_times,price_cents,project_group,expires_at,source_settlement_id,created_at,card_source) VALUES(?,?,?,NULL,?,?,0,?,NULL,?,NULL,?,'migration')`).run(cardId,tid,uid,title,c.remainingTimes,c.paidCents,c.expiresOn,now)
    cards.push({cardId,assetId:c.assetId,paidCents:c.paidCents,remainingTimes:c.remainingTimes,serviceId:c.serviceId})
   }
   const receipt={id,pendingId:pid,userId:uid,mode:'paid_timecards',status:'allocated',cards,paidCents:result.paidCents,bonusCents:0,activatedCents:result.paidCents,currency:source.currency,ledgerIds:[],activatedAt:now,incomeImpactCents:0,storedValueAddedCents:0}
   db.prepare(`INSERT INTO migration_balance_activations(id,tenant_id,user_id,pending_id,request_id,request_hash,source_version,snapshot_amount_cents,paid_cents,bonus_cents,review_json,actor,created_at,result_json) VALUES(?,?,?,?,?,?,?,?,?,0,?,?,?,?)`).run(id,tid,uid,pid,body.requestId,requestHash,source.version,source.pending.snapshot_amount_cents,result.paidCents,JSON.stringify(review),actor,now,JSON.stringify(receipt))
   db.prepare("UPDATE migration_pending_balances SET status='allocated' WHERE id=? AND tenant_id=?").run(pid,tid)
   db.prepare('UPDATE customer_migration_links SET opening_balance_applied_cents=?,updated_at=? WHERE id=? AND tenant_id=?').run(result.paidCents,now,source.link.id,tid)
   db.exec('COMMIT');return receipt
  }catch(e){db.exec('ROLLBACK');throw e}
 }
 async function route({req,res,path,adminSession,readBody,json}){
  const m=path.match(/^\/admin\/customers\/([^/]+)\/migration-balances\/([^/]+)\/activate-timecards$/)
  if(!m)return false
  if(adminSession?.role!=='owner')fail(403,'FORBIDDEN','仅老板可确认旧付费卡。')
  if(req.method!=='POST')fail(405,'METHOD_NOT_ALLOWED','Method not allowed.')
  json(res,200,activate(currentTenantId(),decodeURIComponent(m[1]),decodeURIComponent(m[2]),await readBody(req),actorOf(adminSession)));return true
 }
 return{activate,ensureSchema,route}
}
