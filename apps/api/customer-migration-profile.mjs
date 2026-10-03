// Formal optional customer metadata and owner-only migration archive.
// This module never activates balances, edits source snapshots or writes financial ledgers.
export function validateMigrationProfile(body, apiError) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw apiError(400,'BAD_REQUEST','顾客资料格式无效。')
  const out = {}
  if (body.acquisitionSource !== undefined) {
    if (typeof body.acquisitionSource !== 'string' || body.acquisitionSource.trim().length > 120) throw apiError(400,'INVALID_CUSTOMER_SOURCE','获客来源须为不超过120字的文字。')
    out.acquisitionSource = body.acquisitionSource.trim()
  }
  if (body.originalJoinedDate !== undefined) {
    const value=body.originalJoinedDate
    if (typeof value !== 'string' || (value !== '' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value+'T00:00:00Z')) || new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value))) throw apiError(400,'INVALID_CUSTOMER_DATE','原建档日期须是真实日期，格式 YYYY-MM-DD；未知可留空。')
    out.originalJoinedDate=value
  }
  return out
}
export function createCustomerMigrationProfile({db,apiError,currentTenantId,iso}) {
  function ensureSchema() {
    const columns=new Set(db.prepare('PRAGMA table_info(users)').all().map(r=>r.name))
    if(!columns.has('acquisition_source'))db.exec("ALTER TABLE users ADD COLUMN acquisition_source TEXT NOT NULL DEFAULT ''")
    if(!columns.has('original_joined_date'))db.exec("ALTER TABLE users ADD COLUMN original_joined_date TEXT NOT NULL DEFAULT ''")
    db.exec(`CREATE TABLE IF NOT EXISTS customer_profile_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL,
      actor TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL, created_at TEXT NOT NULL
    )`)
  }
  function get(tenantId,userId) {
    const r=db.prepare('SELECT id,acquisition_source,original_joined_date FROM users WHERE tenant_id=? AND id=?').get(tenantId,userId)
    if(!r)throw apiError(404,'NOT_FOUND','没有这位顾客。')
    return {acquisitionSource:r.acquisition_source||'',originalJoinedDate:r.original_joined_date||''}
  }
  function save(tenantId,userId,body,actor) {
    const before=get(tenantId,userId), fields=validateMigrationProfile(body,apiError), after={...before,...fields}
    db.exec('SAVEPOINT migration_profile')
    try {
      db.prepare('UPDATE users SET acquisition_source=?,original_joined_date=? WHERE id=? AND tenant_id=?').run(after.acquisitionSource,after.originalJoinedDate,userId,tenantId)
      if(JSON.stringify(before)!==JSON.stringify(after))db.prepare('INSERT INTO customer_profile_changes(tenant_id,user_id,actor,before_json,after_json,created_at) VALUES(?,?,?,?,?,?)').run(tenantId,userId,String(actor||'owner'),JSON.stringify(before),JSON.stringify(after),iso(new Date()))
      db.exec('RELEASE migration_profile');return after
    }catch(e){db.exec('ROLLBACK TO migration_profile');db.exec('RELEASE migration_profile');throw e}
  }
  function archive(tenantId,userId,page=0) {
    const profile=get(tenantId,userId)
    const offset=page*30
    const read=(table,order)=>db.prepare(`SELECT * FROM ${table} WHERE tenant_id=? AND user_id=? ORDER BY ${order} LIMIT 31 OFFSET ?`).all(tenantId,userId,offset)
    const records=read('customer_migration_records','created_at DESC,id DESC')
    const transactions=read('customer_legacy_transactions','occurred_at DESC,id DESC')
    const assets=read('customer_legacy_assets','created_at DESC,id DESC')
    const pending=db.prepare("SELECT id,snapshot_amount_cents,data_cutoff_at,status FROM migration_pending_balances WHERE tenant_id=? AND user_id=? ORDER BY created_at DESC").all(tenantId,userId)
    // These raw source fields are owner-only, never reused by the customer API or AI replies.
    return {profile,page,hasMore:[records,transactions,assets].some(a=>a.length>30),
      pendingBalances:pending.map(r=>({id:r.id,amountCents:r.snapshot_amount_cents,cutoff:r.data_cutoff_at,status:r.status})),
      records:records.slice(0,30).map(r=>({id:r.id,sourceRecordId:r.source_record_id,source:JSON.parse(r.source_json||'{}')})),
      transactions:transactions.slice(0,30).map(r=>({id:r.id,date:r.occurred_at,summary:r.summary,details:JSON.parse(r.raw_json||'{}')})),
      assets:assets.slice(0,30).map(r=>({id:r.id,title:r.title,kind:r.asset_kind,details:JSON.parse(r.raw_json||'{}'),status:'archived'}))}
  }
  async function route({req,res,path,query,adminSession,readBody,json}) {
    const m=path.match(/^\/admin\/customers\/([^/]+)\/(migration-profile|migration-archive)$/)
    if(!m)return false
    if(adminSession.role!=='owner')throw apiError(403,'FORBIDDEN','仅老板可核对原系统资料。')
    const tid=currentTenantId(),uid=m[1]
    if(m[2]==='migration-profile'&&req.method==='PATCH')json(res,200,{profile:save(tid,uid,await readBody(req),adminSession.id||adminSession.username||'owner')})
    else if(req.method==='GET') {
      const page=Number(query.page||0)
      if(!Number.isSafeInteger(page)||page<0||page>100000)throw apiError(400,'BAD_REQUEST','页码无效。')
      json(res,200,m[2]==='migration-profile'?{profile:get(tid,uid)}:archive(tid,uid,page))
    } else throw apiError(405,'METHOD_NOT_ALLOWED','Method not allowed.')
    return true
  }
  return {ensureSchema,get,save,archive,route}
}
