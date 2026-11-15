// Read projections only. Signed receipts and prior close snapshots are never rewritten.
export function memberDailyServiceAmount(db,row,amendment) {
 const total=amendment.amendedCount?amendment.actualDueCents:row.total_cents
 if(!db.prepare('SELECT 1 FROM member_document_components WHERE settlement_id=?').get(row.id))return total
 return total-(JSON.parse(row.recharge_json||'null')?.amountCents||0)-(JSON.parse(row.purchase_json||'null')?.priceCents||0)
}
export function storefrontWithoutInlineRecharge(db,tenantId,ids) {
 return ids.reduce((sum,id)=>{
  const row=db.prepare('SELECT recharge_json FROM settlements WHERE id=? AND tenant_id=?').get(id,tenantId)
  if(!row)return sum
  const offline=db.prepare("SELECT COALESCE(SUM(amount_cents),0) n FROM settlement_payments WHERE settlement_id=? AND leg='offline'").get(id).n
  // The same principal is already counted from its stored-value recharge receipt.
  return sum+Math.max(0,offline-(JSON.parse(row.recharge_json||'null')?.amountCents||0))
 },0)
}

// New multi-project documents count once in trend and monthly close summaries.
// Legacy rows retain the prior read semantics and are never rewritten.
export function signedServiceRows(db,tenantId,amendmentShape) {
 const groups=new Map()
 const rows=db.prepare("SELECT s.*,c.document_id FROM settlements s LEFT JOIN member_document_components c ON c.settlement_id=s.id AND c.tenant_id=s.tenant_id WHERE s.tenant_id=? AND s.status='signed' AND s.signed_at IS NOT NULL ORDER BY s.rowid").all(tenantId)
 for(const row of rows){const key=row.document_id||row.id,amount=row.document_id?memberDailyServiceAmount(db,row,amendmentShape(row)):row.total_cents;const prior=groups.get(key);if(prior)prior.total_cents+=amount;else groups.set(key,{id:key,signed_at:row.signed_at,total_cents:amount})}
 return [...groups.values()]
}

// Automatic stored-value adjustments settle that portion already. Only the
// remaining offline difference may require a manual cash reconciliation.
export function cashAmendmentDelta(db,tenantId,ids) {
 if(!ids.length)return 0
 return db.prepare(`SELECT COALESCE(SUM(a.amount_delta_cents+COALESCE(a.auto_balance_adjust_cents,0)),0) n FROM settlement_amendments a JOIN settlements s ON s.id=a.settlement_id AND s.tenant_id=a.tenant_id WHERE a.tenant_id=? AND s.id IN (${ids.map(()=>'?').join(',')})`).get(tenantId,...ids).n
}
