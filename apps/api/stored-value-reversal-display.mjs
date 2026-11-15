/** Never infer a gift association from adjacent timestamps in a display receipt. */
export function storedValueReversalFacts(db,tenantId,txn) {
 if(txn.type!=='recharge')return null
 const op=db.prepare("SELECT result_json FROM member_pricing_operations WHERE tenant_id=? AND user_id=? AND source='recharge' AND json_extract(result_json,'$.rechargeTxnId')=?").get(tenantId,txn.user_id,txn.id)
 if(!op)return {principalCents:txn.amount_cents,bonusCents:null,bonusLinkKnown:false}
 const receipt=JSON.parse(op.result_json),bonus=receipt.bonusTxnId?db.prepare("SELECT amount_cents FROM stored_value_transactions WHERE id=? AND tenant_id=? AND user_id=? AND type='bonus'").get(receipt.bonusTxnId,tenantId,txn.user_id):null
 return {principalCents:txn.amount_cents,bonusCents:receipt.bonusTxnId?(bonus?.amount_cents??null):0,bonusLinkKnown:!receipt.bonusTxnId||!!bonus}
}
