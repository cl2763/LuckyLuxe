import {discountLabel} from './member-discount-input.mjs'
import {storedValueReversalFacts} from './stored-value-reversal-display.mjs'
export function memberDiscountReceipt(db,tenantId,userId,txnId,timeZone){
 const txn=db.prepare('SELECT * FROM stored_value_transactions WHERE id=? AND tenant_id=? AND user_id=?').get(txnId,tenantId,userId)
 if(!txn)return null
 const row=db.prepare(`SELECT result_json,created_at FROM member_pricing_operations WHERE tenant_id=? AND user_id=? AND (json_extract(result_json,'$.rechargeTxnId')=? OR json_extract(result_json,'$.txnId')=? OR json_extract(result_json,'$.reversal.id')=?) ORDER BY created_at DESC,rowid DESC LIMIT 1`).get(tenantId,userId,txnId,txnId,txnId)
 if(!row)return null
 const r=JSON.parse(row.result_json).discountReceipt
 if(!r)return null
 const facts=storedValueReversalFacts(db,tenantId,txn)
 const createdText=timeZone?new Intl.DateTimeFormat('sv-SE',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(row.created_at))+'（'+timeZone+'）':null
 return {receiptId:txn.id,kind:txn.type,principalCents:facts?.principalCents??null,bonusCents:facts?.bonusCents??null,bonusLinkKnown:facts?.bonusLinkKnown??false,createdText,beforeText:discountLabel(r.before.rateBps),afterText:discountLabel(r.after.rateBps),statusText:r.after.statusText,actor:r.actor,createdAt:row.created_at}
}
