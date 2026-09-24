/* Both platform and merchant hours writes validate the entire request before an atomic update. */
export function validateBusinessHours(entries, apiError) {
  if (!Array.isArray(entries) || !entries.length) throw apiError(400, 'BAD_REQUEST', 'hours array is required.')
  const seen = new Set(), time = /^([01]\d|2[0-3]):[0-5]\d$/
  for (const e of entries) {
    if (!e || typeof e !== 'object') throw apiError(400, 'BAD_REQUEST', 'Each business-hours entry must be an object.')
    const weekday = Number(e.weekday)
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || seen.has(weekday)) throw apiError(400, 'BAD_REQUEST', 'weekday must be unique and within 0-6.')
    seen.add(weekday)
    if (!e.isClosed && (!time.test(e.openTime || '') || !time.test(e.closeTime || ''))) throw apiError(400, 'BAD_REQUEST', 'openTime/closeTime must be HH:MM.')
    if (!e.isClosed && e.openTime >= e.closeTime) throw apiError(400, 'BAD_REQUEST', 'openTime must be earlier than closeTime.')
  }
}
export function writeBusinessHours(db, storeId, entries, updatedBy, now) {
  const stmt = db.prepare(`INSERT INTO business_hours (store_id, weekday, open_time, close_time, is_closed, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(store_id, weekday) DO UPDATE SET open_time = excluded.open_time, close_time = excluded.close_time, is_closed = excluded.is_closed, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
  db.exec('BEGIN')
  try {
    for (const e of entries) stmt.run(storeId, Number(e.weekday), e.isClosed ? '00:00' : e.openTime, e.isClosed ? '00:00' : e.closeTime, e.isClosed ? 1 : 0, now, updatedBy)
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}
