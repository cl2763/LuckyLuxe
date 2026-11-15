/** Display-only enrichment: match immutable operation identity, never nearby ledger timestamps. */
export function memberDiscountHistoryDisplay(db,event) {
 const result={...event,sourceText:({owner:'独立调整',recharge:'充值确认',refund:'充值退款',reversal:'充值冲销'})[event.source]||'权益调整'}
 if(event.source!=='recharge')return result
 result.principalCents=null;result.bonusCents=null
 const operationId=event.source_id.startsWith('document-group:')?'inline:'+event.source_id.slice('document-group:'.length):event.source_id
 const operation=db.prepare("SELECT result_json FROM member_pricing_operations WHERE tenant_id=? AND user_id=? AND operation_id=? AND source='recharge'").get(event.tenant_id,event.user_id,operationId)
 if(!operation)return result
 const receipt=JSON.parse(operation.result_json)
 const get=(id,type)=>id?db.prepare('SELECT amount_cents FROM stored_value_transactions WHERE id=? AND tenant_id=? AND user_id=? AND type=?').get(id,event.tenant_id,event.user_id,type):null
 result.principalCents=get(receipt.rechargeTxnId,'recharge')?.amount_cents??null
 result.bonusCents=receipt.bonusTxnId?(get(receipt.bonusTxnId,'bonus')?.amount_cents??null):0
 return result
}
