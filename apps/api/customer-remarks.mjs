// Merchant-only labels; never change customer identity or signed documents.
export function createCustomerRemarks({db,apiError}) {
  db.exec(`CREATE TABLE IF NOT EXISTS customer_remarks (
    tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, remark_name TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL, updated_by TEXT NOT NULL, PRIMARY KEY(tenant_id,user_id))`)
  function read(tenantId,userId) { return db.prepare('SELECT remark_name FROM customer_remarks WHERE tenant_id=? AND user_id=?').get(tenantId,userId)?.remark_name || '' }
  function save(tenantId,userId,value,actor) {
    if(actor?.role!=='owner')throw apiError(403,'FORBIDDEN','仅老板可修改顾客备注名。')
    if(!db.prepare('SELECT id FROM users WHERE id=? AND tenant_id=?').get(userId,tenantId))throw apiError(404,'NOT_FOUND','找不到本店顾客。')
    if(typeof value!=='string'||[...value.trim()].length>40||/[<>\x00-\x1f\x7f]/.test(value))throw apiError(400,'BAD_REMARK_NAME','备注名最多40个字符，不支持控制符或尖括号。')
    const name=value.trim(),at=new Date().toISOString()
    db.prepare(`INSERT INTO customer_remarks(tenant_id,user_id,remark_name,updated_at,updated_by) VALUES(?,?,?,?,?)
      ON CONFLICT(tenant_id,user_id) DO UPDATE SET remark_name=excluded.remark_name,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
      .run(tenantId,userId,name,at,actor.accountId||actor.email||'owner')
    return {remarkName:name}
  }
  function names(tenantId,userId,displayName) { const remarkName=read(tenantId,userId); return {displayName,remarkName,merchantDisplayName:remarkName || displayName} }
  return {read,save,names}
}
