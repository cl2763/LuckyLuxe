import {createHash, randomUUID} from 'node:crypto'
import {recordIsArchived} from './record-lifecycle.mjs'
import {normalizeGiftItems} from './gifts.mjs'

export const giftEntitlementsEnabled = tid => String(process.env.GIFT_ENTITLEMENTS_TENANTS || '').split(',').map(v=>v.trim()).some(v=>v==='*'||v===tid)
const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code})}
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
const idFor=(source,index,part='')=>'gift_'+digest([source,index,part]).slice(0,32)
const eventLabels={claim:'领取',return:'退回',void:'作废',refund_keep:'退款后保留权益',refund_review:'退款权益核对'}
const kinds={physical:'实物领取',coupon:'优惠券',service_voucher:'服务兑换券',service_timecard:'服务次卡'}
export function createGiftEntitlements({db,todayOf=()=>new Date().toISOString().slice(0,10),enabled=giftEntitlementsEnabled,dateOf=(_tid,value)=>String(value).slice(0,10),timeText=(_tid,value)=>String(value).replace('T',' ').slice(0,16)}) {
 function ensureSchema(){
  db.exec(`CREATE TABLE IF NOT EXISTS recharge_gift_grants (
   id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,source_txn_id TEXT NOT NULL,
   item_index INTEGER NOT NULL,kind TEXT NOT NULL,name TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),
   unit_value_cents INTEGER,service_id TEXT,coupon_grant_id TEXT,timecard_id TEXT,expires_on TEXT,
   snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(tenant_id,source_txn_id,item_index)
  );
  CREATE INDEX IF NOT EXISTS recharge_gift_owner ON recharge_gift_grants(tenant_id,user_id);
  CREATE TABLE IF NOT EXISTS recharge_gift_events (
   id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,grant_id TEXT NOT NULL,
   action TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),delta INTEGER NOT NULL,
   parent_id TEXT,request_id TEXT NOT NULL,payload_hash TEXT NOT NULL,reason TEXT NOT NULL,
   actor TEXT NOT NULL,created_at TEXT NOT NULL,result_json TEXT NOT NULL,UNIQUE(tenant_id,request_id)
  );
  CREATE TRIGGER IF NOT EXISTS recharge_gift_grants_no_update BEFORE UPDATE ON recharge_gift_grants BEGIN SELECT RAISE(ABORT,'gift grant is immutable');END;
  CREATE TRIGGER IF NOT EXISTS recharge_gift_grants_no_delete BEFORE DELETE ON recharge_gift_grants BEGIN SELECT RAISE(ABORT,'gift grant is immutable');END;
  CREATE TRIGGER IF NOT EXISTS recharge_gift_events_no_update BEFORE UPDATE ON recharge_gift_events BEGIN SELECT RAISE(ABORT,'gift event is append-only');END;
  CREATE TRIGGER IF NOT EXISTS recharge_gift_events_no_delete BEFORE DELETE ON recharge_gift_events BEGIN SELECT RAISE(ABORT,'gift event is append-only');END;`)
  for(const column of ["recipient_mode TEXT NOT NULL DEFAULT 'any'"]){try{db.exec(`ALTER TABLE coupons ADD COLUMN ${column}`)}catch(e){if(!e.message.includes('duplicate column'))throw e}}
 }
 function validate(tid,items){
  const normalized=normalizeGiftItems(items)
  if(normalized.some(g=>g.kind)&&!enabled(tid))fail(409,'GIFT_FEATURE_NOT_ENABLED','本店尚未启用新版赠送权益。')
  for(const g of normalized){
   if(g.serviceId&&(recordIsArchived(db,tid,'services',g.serviceId)||!db.prepare('SELECT 1 FROM services WHERE tenant_id=? AND id=? AND is_active=1').get(tid,g.serviceId)))fail(400,'GIFT_SERVICE_NOT_FOUND','请选择本店在售的具体服务。')
   if(g.couponId&&(recordIsArchived(db,tid,'coupons',g.couponId)||!db.prepare('SELECT 1 FROM coupons WHERE tenant_id=? AND id=? AND is_active=1 AND is_custom=0').get(tid,g.couponId)))fail(400,'GIFT_COUPON_NOT_FOUND','请选择本店有效的优惠券模板。')
  }
  return normalized
 }
 // No backfill: called only from a newly committed recharge, in its transaction.
 function issueUnsafe({tenantId:tid,userId:uid,sourceTxnId,giftItems,actor,createdAt=new Date().toISOString()}){
  if(!enabled(tid))return []
  const items=validate(tid,giftItems),out=[]
  if(!db.prepare("SELECT 1 FROM stored_value_transactions WHERE id=? AND tenant_id=? AND user_id=? AND type='recharge'").get(sourceTxnId,tid,uid))fail(409,'GIFT_RECHARGE_REQUIRED','权益发放必须关联已生效充值。')
  for(const [index,g] of items.entries()){
   if(!g.kind)continue // Descriptive legacy snapshots are not new entitlements.
   const prior=db.prepare('SELECT * FROM recharge_gift_grants WHERE tenant_id=? AND source_txn_id=? AND item_index=?').get(tid,sourceTxnId,index)
   if(prior){if(prior.snapshot_json!==JSON.stringify(g))fail(409,'GIFT_SOURCE_CHANGED','同一笔充值的赠送内容不一致。');out.push(prior.id);continue}
   const id=idFor(sourceTxnId,index),days=g.validDays||null,day=todayOf(tid),expiresOn=days?new Date(Date.parse(day+'T12:00:00Z')+days*86400000).toISOString().slice(0,10):null
   let couponId=null,cardId=null
   if(g.kind==='coupon'){
    const c=db.prepare('SELECT * FROM coupons WHERE id=? AND tenant_id=?').get(g.couponId,tid)
    if(c.total_qty>0&&c.issued_qty+g.quantity>c.total_qty)fail(409,'GIFT_COUPON_STOCK','赠送券模板剩余发放量不足，请先调整套餐。')
    // Private immutable-in-practice template freezes issued rights when a public template changes.
    const snapshotId=id+'_template'
    db.prepare(`INSERT INTO coupons(id,tenant_id,name,discount_type,amount_cents,percent_off,min_spend_cents,valid_days,total_qty,issued_qty,is_active,created_at,scope_categories_json,is_custom,recipient_mode) VALUES(?,?,?,?,?,?,?,?,0,?,1,?,?,1,?)`).run(snapshotId,tid,c.name,c.discount_type,c.amount_cents,c.percent_off,c.min_spend_cents,c.valid_days,g.quantity,createdAt,c.scope_categories_json||'[]',c.recipient_mode||'any')
    const expiresAt=new Date(Date.parse(createdAt)+(days||c.valid_days||30)*86400000).toISOString()
    for(let n=0;n<g.quantity;n++){
     const gid=idFor(sourceTxnId,index,'coupon'+n);couponId=couponId||gid
     db.prepare(`INSERT INTO coupon_grants(id,tenant_id,coupon_id,user_id,code,status,expires_at,created_at,grant_source,granted_by,grant_reason) VALUES(?,?,?,?,?,'active',?,?,'gift',?,?)`).run(gid,tid,snapshotId,uid,'G-'+gid.slice(5),expiresAt,createdAt,actor,'充值赠送 · '+g.name)
     db.prepare('INSERT INTO coupon_grant_logs(id,tenant_id,grant_id,action,detail,actor,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),tid,gid,'granted','充值赠送',actor,createdAt)
    }
    db.prepare('UPDATE coupons SET issued_qty=issued_qty+? WHERE id=? AND tenant_id=?').run(g.quantity,c.id,tid)
   }
   if(g.kind==='service_voucher'||g.kind==='service_timecard'){
    cardId=id
    db.prepare(`INSERT INTO member_timecards(id,tenant_id,user_id,package_id,name,total_times,used_times,price_cents,project_group,expires_at,created_at,card_source) VALUES(?,?,?,NULL,?,?,0,0,NULL,?,?,'gift')`).run(cardId,tid,uid,g.name,g.quantity,expiresOn,createdAt)
   }
   db.prepare('INSERT INTO recharge_gift_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,tid,uid,sourceTxnId,index,g.kind,g.name,g.quantity,g.unitValueCents,g.serviceId||null,couponId,cardId,expiresOn,JSON.stringify(g),createdAt)
   out.push(id)
  }
  return out
 }
 function issue(args){db.exec('SAVEPOINT gift_issue');try{const result=issueUnsafe(args);db.exec('RELEASE gift_issue');return result}catch(e){db.exec('ROLLBACK TO gift_issue; RELEASE gift_issue');throw e}}
 function planned(tid,uid,items,draftKey){
  if(!enabled(tid)||!items.some(g=>g.kind))return null
  if(typeof draftKey!=='string'||! /^[\w-]{1,64}$/.test(draftKey))fail(400,'GIFT_DRAFT_REQUIRED','请刷新开单页后重新选择充值套餐。')
  const normalized=validate(tid,items),sourceTxnId='sv_gift_'+digest([tid,uid,draftKey,normalized]).slice(0,32)
  const coupons=[]
  for(const [i,g] of normalized.entries())if(g.kind==='coupon'){
   const c=db.prepare('SELECT * FROM coupons WHERE tenant_id=? AND id=?').get(tid,g.couponId),id=idFor(sourceTxnId,i)
   for(let n=0;n<g.quantity;n++)coupons.push({...c,id:idFor(sourceTxnId,i,'coupon'+n),coupon_id:id+'_template',user_id:uid,status:'active',code:'待充值发放',expires_at:null,grant_reason:'本次随单充值赠送，先签含充值的服务单',pending_gift:true})
  }
  return {sourceTxnId,coupons}
 }
 function get(tid,uid,id){const r=db.prepare('SELECT * FROM recharge_gift_grants WHERE tenant_id=? AND user_id=? AND id=?').get(tid,uid,id);if(!r)fail(404,'GIFT_NOT_FOUND','找不到这项赠送权益。');return r}
 function usageRecords(g){
  const tid=g.tenant_id,uid=g.user_id
  const records=g.timecard_id?db.prepare("SELECT id, signed_at AS createdAt FROM settlements WHERE tenant_id=? AND user_id=? AND timecard_id=? AND signed_at IS NOT NULL ORDER BY signed_at DESC").all(tid,uid,g.timecard_id).map(r=>({...r,label:'服务单签署核销'})):g.coupon_grant_id?db.prepare("SELECT l.id,l.action,l.created_at AS createdAt FROM coupon_grant_logs l JOIN coupon_grants c ON c.id=l.grant_id AND c.tenant_id=l.tenant_id WHERE l.tenant_id=? AND c.user_id=? AND c.coupon_id=? AND l.action IN ('redeemed','released','revoked') ORDER BY l.created_at DESC").all(tid,uid,g.id+'_template').map(r=>({...r,label:({redeemed:'优惠券核销',released:'优惠券退回',revoked:'优惠券作废'})[r.action]})):[]
  return records.map(r=>({...r,createdText:timeText(tid,r.createdAt)}))
 }
 function shape(g){
  const events=db.prepare('SELECT * FROM recharge_gift_events WHERE tenant_id=? AND grant_id=? ORDER BY rowid').all(g.tenant_id,g.id)
  let remaining=g.quantity+events.reduce((n,e)=>n+e.delta,0),used=g.quantity-remaining,voided=events.filter(e=>e.action==='void').reduce((n,e)=>n+e.quantity,0)
  if(g.timecard_id){const c=db.prepare('SELECT * FROM member_timecards WHERE id=? AND tenant_id=?').get(g.timecard_id,g.tenant_id);if(c){remaining=c.total_times-c.used_times-(c.refunded_times||0);used=c.used_times;voided=c.refunded_times||0}}
  if(g.coupon_grant_id){const rows=db.prepare('SELECT status,expires_at FROM coupon_grants WHERE tenant_id=? AND user_id=? AND coupon_id=?').all(g.tenant_id,g.user_id,g.id+'_template');remaining=rows.filter(c=>c.status==='active'&&(!c.expires_at||c.expires_at>new Date().toISOString())).length;used=rows.filter(c=>c.status==='used').length;voided=rows.filter(c=>c.status==='revoked').length}
  const couponExpiry=g.coupon_grant_id?db.prepare('SELECT expires_at FROM coupon_grants WHERE id=? AND tenant_id=?').get(g.coupon_grant_id,g.tenant_id)?.expires_at:null
  const expiresOn=couponExpiry?dateOf(g.tenant_id,couponExpiry):g.expires_on
  const expired=couponExpiry?couponExpiry<=new Date().toISOString():Boolean(expiresOn&&expiresOn<todayOf(g.tenant_id))
  return {id:g.id,kind:g.kind,kindLabel:kinds[g.kind],name:g.name,quantity:g.quantity,remaining,used,voided,claimed:Math.max(0,g.kind==='physical'?used-voided:used),unitValueCents:g.unit_value_cents,serviceId:g.service_id,couponGrantId:g.coupon_grant_id,timecardId:g.timecard_id,sourceTxnId:g.source_txn_id,expiresOn,expired,canClaim:g.kind==='physical'&&!expired&&remaining>0,records:usageRecords(g),events:events.map(e=>({returnable:e.action==='claim'?Math.max(0,e.quantity-events.filter(r=>r.action==='return'&&r.parent_id===e.id).reduce((n,r)=>n+r.quantity,0)):0,label:eventLabels[e.action]||'权益记录',quantityText:['claim','return','void'].includes(e.action)?String(e.quantity)+(g.kind==='physical'?' 件':g.kind==='service_timecard'?' 次':' 张'):'',id:e.id,action:e.action,quantity:e.quantity,reason:e.reason,actor:e.actor,createdAt:e.created_at,createdText:timeText(g.tenant_id,e.created_at),parentId:e.parent_id})),createdAt:g.created_at}
 }
 function list(tid,uid){return db.prepare('SELECT * FROM recharge_gift_grants WHERE tenant_id=? AND user_id=? ORDER BY rowid DESC').all(tid,uid).map(shape)}
 // Customer read model: inactive gifts remain visible without entering usable-card counts.
 function customerPack(tid,uid){
  if(!enabled(tid))return {physical:[],history:[]}
  const rows=list(tid,uid).map(({sourceTxnId,unitValueCents,events,...g})=>({...g,sourceLabel:'充值赠送',events:events.map(({actor,reason,...e})=>e)}))
  const history=rows.filter(g=>g.kind!=='physical'&&(g.used>0||g.voided>0||g.expired||g.remaining===0)).map(g=>{
   return {...g,statusText:g.expired?'已过期':g.remaining>0?'部分使用':g.voided>0?'剩余权益已作废':'已用完'}
  })
  return {physical:rows.filter(g=>g.kind==='physical'),history}
 }
 function physical(tid,uid,id,action,body,actor){
  if(!enabled(tid))fail(409,'GIFT_FEATURE_NOT_ENABLED','本店尚未启用新版赠送权益。')
  if(!['claim','return','void'].includes(action))fail(400,'GIFT_ACTION_INVALID','操作无效。')
  const qty=body.quantity,rid=body.requestId,reason=String(body.reason||'').trim()
  if(!Number.isSafeInteger(qty)||qty<1||qty>999)fail(400,'GIFT_QUANTITY_INVALID','请输入1至999的整数件数。')
  if(typeof rid!=='string'||! /^[\w-]{1,100}$/.test(rid))fail(400,'REQUEST_ID_REQUIRED','缺少本次操作编号。')
  if((action!=='claim'&&!reason)||reason.length>300)fail(400,'REASON_REQUIRED','请填写更正或作废原因，最多300字。')
  const payload={uid,id,action,qty,reason,claimId:body.claimId||null,actor},hash=digest(payload)
  db.exec('SAVEPOINT gift_claim')
  try{
   // Establish the writer lock before re-reading quantities or idempotency state.
   db.prepare('UPDATE recharge_gift_events SET id=id WHERE 0').run()
   const prior=db.prepare('SELECT * FROM recharge_gift_events WHERE tenant_id=? AND request_id=?').get(tid,rid)
   if(prior){if(prior.payload_hash!==hash)fail(409,'REQUEST_CONFLICT','同一操作编号的内容发生变化。');db.exec('RELEASE gift_claim');return {...JSON.parse(prior.result_json),duplicate:true}}
   const g=get(tid,uid,id);if(g.kind!=='physical')fail(400,'GIFT_NOT_PHYSICAL','服务权益请通过服务单核销。')
   const current=shape(g);let delta=-qty
   if(action==='claim'&&current.expired)fail(409,'GIFT_EXPIRED','这项赠品已到期。')
   if(action==='return'){
    const claim=db.prepare("SELECT * FROM recharge_gift_events WHERE tenant_id=? AND user_id=? AND grant_id=? AND id=? AND action='claim'").get(tid,uid,id,body.claimId||'')
    if(!claim)fail(404,'CLAIM_NOT_FOUND','找不到原领取记录。')
    const returned=db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM recharge_gift_events WHERE tenant_id=? AND parent_id=? AND action='return'").get(tid,claim.id).n
    if(qty>claim.quantity-returned)fail(409,'RETURN_EXCEEDS_CLAIM','退回件数超过这笔领取尚可退回的数量。')
    delta=qty
   }else if(qty>current.remaining)fail(409,'GIFT_INSUFFICIENT','剩余件数不足，请重新查看。')
   const eventId=randomUUID(),createdAt=new Date().toISOString(),result={eventId,grantId:id,remaining:current.remaining+delta,quantity:qty,action,createdAt}
   db.prepare('INSERT INTO recharge_gift_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(eventId,tid,uid,id,action,qty,delta,body.claimId||null,rid,hash,reason,actor,createdAt,JSON.stringify(result))
   db.exec('RELEASE gift_claim');return result
  }catch(e){db.exec('ROLLBACK TO gift_claim; RELEASE gift_claim');throw e}
 }
 function serviceFor(tid,cardId){return db.prepare('SELECT service_id,kind FROM recharge_gift_grants WHERE tenant_id=? AND timecard_id=?').get(tid,cardId)}
 function assertService(tid,cardId,serviceId){const gift=serviceFor(tid,cardId);if(gift&&gift.service_id!==serviceId)fail(409,'GIFT_SERVICE_MISMATCH','这项赠送权益只能核销指定服务，请重新选择。');return gift}
 return {ensureSchema,validate,issue,list,physical,serviceFor,assertService,enabled,planned,customerPack}
}
