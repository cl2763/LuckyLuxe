import {createHash,randomUUID} from 'node:crypto'
const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code})}
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
/** Called inside the existing refund/reversal transaction. Never derives money from gift value. */
export function createGiftRefunds({db,gifts}){
 function review(tid,uid,sourceTxnId=null){
  const items=gifts.enabled(tid)?gifts.list(tid,uid).filter(g=>!sourceTxnId||g.sourceTxnId===sourceTxnId):[]
  return {items,reviewHash:digest(items),sourceTxnId,required:items.length>0}
 }
 function apply(tid,uid,body,actor,sourceTxnId=null){
  const fresh=review(tid,uid,sourceTxnId);if(!fresh.required)return {reviewed:0}
  const confirmation=body.giftReview
  if(!confirmation||confirmation.reviewHash!==fresh.reviewHash)fail(409,'GIFT_REVIEW_REQUIRED','请重新核对退款关联的赠送权益及实物处理方式。')
  if(!Array.isArray(confirmation.items)||confirmation.items.length!==fresh.items.length||new Set(confirmation.items.map(i=>i.id)).size!==fresh.items.length)fail(400,'GIFT_REVIEW_INCOMPLETE','请逐项确认赠送权益的保留或作废方式。')
  const requestId=body.operationId||body.requestId,reason=String(body.reason||'退款权益确认').trim(),results=[]
  if(!requestId)fail(400,'OPERATION_ID_REQUIRED','缺少退款操作编号。')
  const event=(g,action,quantity,delta,payload)=>{
   const result={grantId:g.id,action,quantity,...payload},id=randomUUID(),rid='refund-'+digest([requestId,g.id,action]).slice(0,40),hash=digest(result)
   db.prepare('INSERT INTO recharge_gift_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,tid,uid,g.id,action,quantity,delta,null,rid,hash,reason,actor,new Date().toISOString(),JSON.stringify(result));results.push(result)
  }
  for(const g of fresh.items){
   const choice=confirmation.items.find(i=>i.id===g.id)
   if(!choice||!['keep','void'].includes(choice.action))fail(400,'GIFT_REVIEW_INCOMPLETE','请选择保留或作废未使用权益。')
   const returned=choice.returnQuantity??0
   if(!Number.isSafeInteger(returned)||returned<0||returned>(g.kind==='physical'?g.claimed:0)||returned&&choice.action!=='void')fail(400,'GIFT_RETURN_INVALID','实物退回数量无效；退回后作废，不能自动恢复成可领取。')
   if(choice.action==='keep'){event(g,'refund_keep',1,0,{sourceTxnId:g.sourceTxnId});continue}
   if(g.kind==='physical'){
    let left=returned
    for(const claim of g.events.filter(e=>e.action==='claim'&&e.returnable>0)){
     const quantity=Math.min(left,claim.returnable);if(!quantity)continue
     gifts.physical(tid,uid,g.id,'return',{quantity,claimId:claim.id,reason,requestId:'rf-return-'+digest([requestId,g.id,claim.id]).slice(0,40)},actor);left-=quantity
    }
    const remaining=g.remaining+returned
    if(remaining>0)gifts.physical(tid,uid,g.id,'void',{quantity:remaining,reason,requestId:'rf-void-'+digest([requestId,g.id]).slice(0,40)},actor)
    event(g,'refund_review',1,0,{returnedQuantity:returned,keptQuantity:g.claimed-returned,voidedQuantity:remaining})
   }else if(g.timecardId){
    if(g.remaining>0){db.prepare('UPDATE member_timecards SET refunded_times=COALESCE(refunded_times,0)+? WHERE id=? AND tenant_id=? AND user_id=?').run(g.remaining,g.timecardId,tid,uid);event(g,'void',g.remaining,0,{sourceTxnId:g.sourceTxnId})}
    else event(g,'refund_review',1,0,{sourceTxnId:g.sourceTxnId})
   }else if(g.couponGrantId){
    const rows=db.prepare("SELECT id FROM coupon_grants WHERE tenant_id=? AND user_id=? AND coupon_id=? AND status IN ('active','expired')").all(tid,uid,g.id+'_template')
    for(const r of rows){db.prepare("UPDATE coupon_grants SET status='revoked' WHERE id=? AND tenant_id=?").run(r.id,tid);db.prepare('INSERT INTO coupon_grant_logs(id,tenant_id,grant_id,action,detail,actor,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),tid,r.id,'revoked',reason,actor,new Date().toISOString())}
    if(rows.length)event(g,'void',rows.length,0,{sourceTxnId:g.sourceTxnId});else event(g,'refund_review',1,0,{sourceTxnId:g.sourceTxnId})
   }
  }
  return {reviewed:fresh.items.length,events:results}
 }
 function execute(tid,uid,body,actor,sourceTxnId,write){
  db.exec('SAVEPOINT gift_refund');try{const result=write();if(!result.duplicate)result.giftReview=apply(tid,uid,body,actor,sourceTxnId);db.exec('RELEASE gift_refund');return result}catch(e){db.exec('ROLLBACK TO gift_refund; RELEASE gift_refund');throw e}
 }
 return {review,apply,execute}
}
