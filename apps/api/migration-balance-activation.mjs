import { makeActorOf } from './actor-name.mjs'
// Activation is deliberately limited to a merchant-verified, unrestricted aggregate.
// Restricted/per-card balances must remain pending until their redemption rules exist.
export function createMigrationBalanceActivation({ db, apiError, randomId, iso, createHash, currentTenantId, tenantCurrencyCodeOrNull }) {
  const actorOf = makeActorOf({apiError})
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  function ensureSchema() {
    db.exec(`CREATE TABLE IF NOT EXISTS migration_balance_activations (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, pending_id TEXT NOT NULL,
      request_id TEXT NOT NULL, request_hash TEXT NOT NULL, source_version TEXT NOT NULL,
      snapshot_amount_cents INTEGER NOT NULL, paid_cents INTEGER NOT NULL CHECK(paid_cents >= 0),
      bonus_cents INTEGER NOT NULL CHECK(bonus_cents >= 0), review_json TEXT NOT NULL,
      actor TEXT NOT NULL, created_at TEXT NOT NULL, result_json TEXT NOT NULL,
      UNIQUE(tenant_id,pending_id), UNIQUE(tenant_id,request_id)
    );
    CREATE TRIGGER IF NOT EXISTS migration_activation_no_update BEFORE UPDATE ON migration_balance_activations
      BEGIN SELECT RAISE(ABORT,'migration confirmation is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS migration_activation_no_delete BEFORE DELETE ON migration_balance_activations
      BEGIN SELECT RAISE(ABORT,'migration confirmation is append-only'); END;`)
  }
  function source(tenantId,userId,pendingId) {
    const pending=db.prepare('SELECT * FROM migration_pending_balances WHERE id=? AND tenant_id=? AND user_id=?').get(pendingId,tenantId,userId)
    if(!pending || !db.prepare('SELECT id FROM users WHERE id=? AND tenant_id=?').get(userId,tenantId)) throw apiError(404,'NOT_FOUND','没有这项待核对余额。')
    const link=db.prepare('SELECT * FROM customer_migration_links WHERE tenant_id=? AND user_id=? AND source_system=? AND source_record_id=?').get(tenantId,userId,pending.source_system,pending.source_record_id)
    const records=db.prepare(`SELECT r.id,r.batch_id,r.mapped_json,r.source_json,r.details_json,b.data_cutoff_at
      FROM customer_migration_records r JOIN migration_batches b ON b.id=r.batch_id AND b.tenant_id=r.tenant_id
      WHERE r.tenant_id=? AND r.user_id=? AND r.source_record_id=? AND b.source_system=?
      ORDER BY b.data_cutoff_at DESC,r.id`).all(tenantId,userId,pending.source_record_id,pending.source_system)
    const assets=db.prepare('SELECT id,raw_json FROM customer_legacy_assets WHERE tenant_id=? AND user_id=? AND source_system=? AND source_record_id=? ORDER BY id').all(tenantId,userId,pending.source_system,pending.source_record_id)
    const currency=tenantCurrencyCodeOrNull(tenantId)
    if(!currency)throw apiError(409,'MIGRATION_CURRENCY_REQUIRED','请先核对门店币种。')
    return {pending,link,records,assets,currency,version:hash({pending,link,records,assets,currency})}
  }
  function preview(tenantId,userId,pendingId) {
    const s=source(tenantId,userId,pendingId)
    const done=db.prepare('SELECT result_json FROM migration_balance_activations WHERE tenant_id=? AND pending_id=?').get(tenantId,pendingId)
    return {id:pendingId,status:s.pending.status,version:s.version,currency:s.currency,
      snapshotAmountCents:s.pending.snapshot_amount_cents,dataCutoffAt:s.records[0]?.data_cutoff_at || s.pending.data_cutoff_at,
      sourceSystem:s.pending.source_system,sourceRecordId:s.pending.source_record_id,assetCount:s.assets.length,
      supportedMode:'unrestricted_aggregate',confirmation:done?JSON.parse(done.result_json):null}
  }
  function activate(tenantId,userId,pendingId,body,actor) {
    if(!body || typeof body!=='object' || Array.isArray(body))throw apiError(400,'BAD_REQUEST','确认内容无效。')
    const text=(v,max)=>typeof v==='string' && v.trim().length<=max?v.trim():''
    if(!text(actor,200))throw apiError(400,'ACTOR_REQUIRED','确认操作必须记录具体操作人。')
    const requestId=text(body.requestId,80),version=text(body.confirmVersion,64)
    if(!/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)||!/^[a-f0-9]{64}$/.test(version))throw apiError(400,'CONFIRM_REQUIRED','请先读取最新核对资料，再确认启用。')
    const paid=body.paidCents,bonus=body.bonusCents
    if(![paid,bonus].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=100000000000)||paid+bonus>100000000000)throw apiError(400,'BAD_AMOUNT','本金和赠送金须为非负整数分，且不能超过金额上限。')
    if(body.mode!=='unrestricted_aggregate'||body.noReliableCardBreakdown!==true||body.unrestricted!==true||body.noExpiry!==true||body.sourceUseStopped!==true)throw apiError(409,'RULES_NOT_SUPPORTED','仅支持已核对、无可靠分卡、无期限且无项目限制的汇总余额；其他旧卡请保持待核对。')
    const evidence=text(body.evidence,1000),reason=text(body.differenceReason,1000),cutoverAt=text(body.cutoverAt,40),currency=text(body.currency,8)
    const day=cutoverAt.slice(0,10),dayTime=Date.parse(day+'T00:00:00Z')
    if(!evidence || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(cutoverAt) || !Number.isFinite(dayTime) || new Date(dayTime).toISOString().slice(0,10)!==day || !Number.isFinite(Date.parse(cutoverAt)) || Date.parse(cutoverAt)>Date.now())throw apiError(400,'CUTOVER_CONFIRM_REQUIRED','请填写核对依据与带时区的实际切换时间，不能使用未来时间。')
    const review={userId,pendingId,version,paidCents:paid,bonusCents:bonus,mode:body.mode,noReliableCardBreakdown:true,unrestricted:true,noExpiry:true,sourceUseStopped:true,evidence,differenceReason:reason,cutoverAt,currency}
    const requestHash=hash(review)
    db.exec('BEGIN IMMEDIATE')
    try {
      const prior=db.prepare('SELECT request_hash,result_json FROM migration_balance_activations WHERE tenant_id=? AND request_id=?').get(tenantId,requestId)
      if(prior){
        if(prior.request_hash!==requestHash)throw apiError(409,'REQUEST_CONFLICT','同一请求编号的确认内容发生变化，请重新核对。')
        db.exec('COMMIT');return {...JSON.parse(prior.result_json),replayed:true}
      }
      const s=source(tenantId,userId,pendingId)
      if(s.pending.status!=='pending'||db.prepare('SELECT id FROM migration_balance_activations WHERE tenant_id=? AND pending_id=?').get(tenantId,pendingId))throw apiError(409,'ALREADY_ACTIVATED','此余额已处理，不能再次入账。')
      if(s.version!==version)throw apiError(409,'SOURCE_CHANGED','原资料或迁移批次已变化，请重新读取并核对。')
      if(!s.link || s.link.opening_balance_applied_cents!==0)throw apiError(409,'OPENING_ALREADY_APPLIED','原余额可能已入账，须先对账，不能再次启用。')
      // Historical imports may predate source links. Never assume an unlinked opening is free to repeat.
      if(db.prepare("SELECT id FROM stored_value_transactions WHERE tenant_id=? AND user_id=? AND (type='migrate_opening' OR (type='bonus' AND bucket='legacy')) LIMIT 1").get(tenantId,userId))throw apiError(409,'EXISTING_LEGACY_BALANCE','此顾客已有历史期初记录，请核对来源，不能叠加同一余额。')
      if(currency!==s.currency)throw apiError(409,'CURRENCY_MISMATCH','确认币种与门店币种不一致，不会自动换算。')
      const cutoff=s.records[0]?.data_cutoff_at||s.pending.data_cutoff_at
      if(Date.parse(cutoverAt)<Date.parse(cutoff))throw apiError(409,'CUTOVER_TOO_EARLY','切换时间早于最新来源资料，请重新核对。')
      if(paid+bonus!==s.pending.snapshot_amount_cents&&!reason)throw apiError(400,'DIFFERENCE_REASON_REQUIRED','当前金额与原快照不同，请写明差额原因和核对依据。')
      const id=randomId('migactivation'),now=iso(new Date()),ledgerIds=[]
      for(const [type,amount] of [['migrate_opening',paid],['bonus',bonus]]) {
        if(!amount)continue
        const ledgerId=randomId('sv');ledgerIds.push(ledgerId)
        db.prepare(`INSERT INTO stored_value_transactions(id,tenant_id,user_id,type,amount_cents,pay_channel,note,created_by,created_at,bucket,paid_part_cents,bonus_part_cents,request_id)
          VALUES(?,?,?,?,?,'migration',?,?,?,'legacy',?,?,?)`).run(ledgerId,tenantId,userId,type,amount,`旧余额确认启用 ${id}`,actor,now,type==='migrate_opening'?amount:0,type==='bonus'?amount:0,id+'-'+type)
      }
      const status=paid+bonus===0?'exhausted':'active'
      const result={id,pendingId,userId,status,paidCents:paid,bonusCents:bonus,activatedCents:paid+bonus,currency,ledgerIds,activatedAt:now,incomeImpactCents:0}
      db.prepare(`INSERT INTO migration_balance_activations(id,tenant_id,user_id,pending_id,request_id,request_hash,source_version,snapshot_amount_cents,paid_cents,bonus_cents,review_json,actor,created_at,result_json)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,tenantId,userId,pendingId,requestId,requestHash,version,s.pending.snapshot_amount_cents,paid,bonus,JSON.stringify(review),actor,now,JSON.stringify(result))
      db.prepare('UPDATE migration_pending_balances SET status=? WHERE id=? AND tenant_id=? AND status=?').run(status,pendingId,tenantId,'pending')
      db.prepare('UPDATE customer_migration_links SET opening_balance_applied_cents=?,updated_at=? WHERE id=? AND tenant_id=?').run(paid+bonus,now,s.link.id,tenantId)
      db.exec('COMMIT');return result
    }catch(e){db.exec('ROLLBACK');throw e}
  }
  async function route({req,res,path,adminSession,readBody,json}) {
    const m=path.match(/^\/admin\/customers\/([^/]+)\/migration-balances\/([^/]+)(\/activate)?$/)
    if(!m)return false
    if(adminSession?.role!=='owner')throw apiError(403,'FORBIDDEN','仅老板可核对并启用旧余额。')
    const tid=currentTenantId(),uid=decodeURIComponent(m[1]),pid=decodeURIComponent(m[2])
    if(req.method==='GET'&&!m[3])json(res,200,preview(tid,uid,pid))
    else if(req.method==='POST'&&m[3])json(res,200,activate(tid,uid,pid,await readBody(req),actorOf(adminSession)))
    else throw apiError(405,'METHOD_NOT_ALLOWED','Method not allowed.')
    return true
  }
  return {ensureSchema,preview,activate,route,source}
}
