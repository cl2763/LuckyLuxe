// Customer-safe projection: deliberately exclude raw sources, notes, phones,
// reviewer identities, provisional money amounts and activation evidence.
export function customerMigrationSummary(db, tenantId, userId) {
  const balances=db.prepare("SELECT COUNT(*) n FROM migration_pending_balances WHERE tenant_id=? AND user_id=? AND status='pending'").get(tenantId,userId).n
  const assets=db.prepare(`SELECT COUNT(*) n FROM customer_legacy_assets a
    WHERE a.tenant_id=? AND a.user_id=? AND NOT EXISTS (
      SELECT 1 FROM migration_asset_activations x WHERE x.tenant_id=a.tenant_id AND x.user_id=a.user_id AND x.asset_id=a.id
    )`).get(tenantId,userId).n
  return {hasPending:balances+assets>0,title:'旧权益待门店确认',
    message:balances+assets>0?'门店正在核对原有卡项、赠品或余额。待确认资料尚不能用于支付或核销，也不会额外增加当前余额。到店使用前请联系门店确认。':'',
    status:'pending',redeemable:false}
}
