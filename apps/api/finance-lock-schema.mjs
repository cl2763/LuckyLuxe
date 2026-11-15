// Initialize the old finance-lock migration only when adding its column.
// Existing NULL means disabled at read time; a software restart must not edit it.
export function ensureFinanceLockColumn(db, defaultTenantId) {
  try {
    db.exec('ALTER TABLE tenants ADD COLUMN finance_lock_enabled INTEGER')
  } catch (error) {
    if (!String(error.message || '').includes('duplicate column')) throw error
    return
  }
  db.prepare(`UPDATE tenants SET finance_lock_enabled =
    CASE WHEN id = ? AND finance_password_hash IS NOT NULL AND finance_password_hash != '' THEN 1 ELSE 0 END
    WHERE finance_lock_enabled IS NULL`).run(defaultTenantId)
}
