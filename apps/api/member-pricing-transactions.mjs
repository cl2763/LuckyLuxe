import {makeActorOf} from './actor-name.mjs'
import {pricingDigest} from './member-pricing-calculation.mjs'

/** The monetary write and the confirmed discount are a single synchronous transaction. */
export function createMemberPricingTransactions({db,policy,apiError}) {
  const actorOf=makeActorOf({apiError})
  function run({tenantId,userId,body,admin,source,execute}) {
    if(!policy.config(tenantId).active) {
      if(body.discountConfirmation!==undefined) throw apiError(409,'PRICING_NOT_ENABLED','新版折扣尚未启用。')
      return execute()
    }
    if(source!=='recharge' && admin?.role!=='owner') throw apiError(403,'FORBIDDEN','退款折扣由老板重新确认。')
    if(!['owner','staff'].includes(admin?.role)) throw apiError(403,'FORBIDDEN','需要门店操作权限。')
    const id=String(body.operationId||body.requestId||'').trim()
    if(!/^[\w-]{1,64}$/.test(id)) throw apiError(400,'OPERATION_ID_REQUIRED','本店已启用新版会员折扣。请在网页版办理充值、退款或冲销；新版小程序发布后也可办理。')
    const confirmation=body.discountConfirmation
    if(!confirmation || !Object.hasOwn(confirmation,'rateBps')) throw apiError(400,'DISCOUNT_CONFIRMATION_REQUIRED','请在新版网页确认本次操作后的会员折扣，再办理充值、退款或冲销。')
    policy.rate(confirmation.rateBps)
    const actor=actorOf(admin)
    // Canonical property ordering keeps a retry independent of JSON key order.
    const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v
    const hash=pricingDigest(canonical({userId,source,body,actor}))
    db.exec('BEGIN IMMEDIATE')
    try {
      const old=db.prepare('SELECT * FROM member_pricing_operations WHERE tenant_id=? AND operation_id=?').get(tenantId,id)
      if(old) {
        if(old.payload_hash!==hash) throw apiError(409,'IDEMPOTENCY_CONFLICT','同一操作编号的内容发生变化。')
        db.exec('COMMIT');return {...JSON.parse(old.result_json),duplicate:true}
      }
      const before=policy.discount(tenantId,userId)
      policy.revision(confirmation.expectedRevision,before.revision)
      const packageRate=source==='recharge'&&body.packageId?policy.packageDiscount(tenantId,String(body.packageId)).rateBps:null
      const suggestion=source==='recharge'?{suggestedRateBps:packageRate??before.rateBps,suggestionSource:packageRate!==null?'package':before.rateBps===null?'store-default':'member',packageId:body.packageId||null}:{}
      const result=execute()
      if(result?.duplicate) throw apiError(409,'OPERATION_ALREADY_EXISTS','原退款已办理，不能用原退款编号再次调整折扣。')
      const after=policy.setDiscount(tenantId,userId,{
        rateBps:confirmation.rateBps,expectedRevision:before.revision,
        reason:confirmation.reason||body.reason||'充值确认折扣'
      },{actor,role:admin.role,source,sourceId:id})
      const receipt={...result,discountReceipt:{before,after,...suggestion,actor,source,operationId:id}}
      db.prepare('INSERT INTO member_pricing_operations VALUES(?,?,?,?,?,?,?)').run(tenantId,id,source,userId,hash,JSON.stringify(receipt),new Date().toISOString())
      db.exec('COMMIT');return receipt
    } catch(e) {db.exec('ROLLBACK');throw e}
  }
  function rechargePairFor(tenantId,txnId) {
    const row=db.prepare("SELECT result_json FROM member_pricing_operations WHERE tenant_id=? AND source='recharge' AND json_extract(result_json,'$.rechargeTxnId')=?").get(tenantId,txnId)
    return row ? {bonusId:JSON.parse(row.result_json).bonusTxnId||null} : null
  }
  return {run,rechargePairFor}
}
