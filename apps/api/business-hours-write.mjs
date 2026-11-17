import {beginWriteSavepoint} from './write-savepoint.mjs'
import {configFingerprint} from './config-fingerprint.mjs'
export const businessHoursRevision=(db,storeId,tenantId)=>configFingerprint([db.prepare('SELECT * FROM business_hours WHERE store_id=? ORDER BY weekday').all(storeId),db.prepare('SELECT * FROM store_special_dates WHERE store_id=? ORDER BY date').all(storeId),readBookingAcceptance(db,storeId,tenantId)])
import {readBookingAcceptance,validateAcceptance,writeAcceptance} from './booking-window.mjs'
/* Both platform and merchant hours writes validate the entire request before an atomic update. */
export function validateBusinessHours(entries, apiError) {
  if (!Array.isArray(entries) || !entries.length) throw apiError(400, 'BAD_REQUEST', 'hours array is required.')
  const seen = new Set(), time = /^([01]\d|2[0-3]):[0-5]\d$/
  for (const e of entries) {
    if (!e || typeof e !== 'object') throw apiError(400, 'BAD_REQUEST', 'Each business-hours entry must be an object.')
    if(e.isClosed!==undefined&&typeof e.isClosed!=='boolean')throw apiError(400,'BAD_REQUEST','休息状态须为开关值。')
    const weekday = Number(e.weekday)
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || seen.has(weekday)) throw apiError(400, 'BAD_REQUEST', 'weekday must be unique and within 0-6.')
    seen.add(weekday)
    if (!e.isClosed && (!time.test(e.openTime || '') || !time.test(e.closeTime || ''))) throw apiError(400, 'BAD_REQUEST', 'openTime/closeTime must be HH:MM.')
    if (!e.isClosed && e.openTime >= e.closeTime) throw apiError(400, 'BAD_REQUEST', 'openTime must be earlier than closeTime.')
  }
}
export function writeBusinessHours(db, storeId, entries, updatedBy, now, acceptance, apiError=(status,code,message)=>Object.assign(new Error(message),{status,code}), expectedConfigRevision,tenantId) {
  if(expectedConfigRevision!==undefined&&expectedConfigRevision!==businessHoursRevision(db,storeId,tenantId))throw apiError(409,'CONFIG_CHANGED','营业或接客规则已在其他设备修改，请核对后再保存。')
  const current=db.prepare('SELECT * FROM business_hours WHERE store_id=?').all(storeId)
  const merged=current.filter(r=>!entries.some(e=>Number(e.weekday)===r.weekday)).concat(entries)
  const next=validateAcceptance(acceptance===undefined?readBookingAcceptance(db,storeId,tenantId):acceptance,merged,db.prepare('SELECT * FROM store_special_dates WHERE store_id=?').all(storeId),apiError)
  const stmt = db.prepare(`INSERT INTO business_hours (store_id, weekday, open_time, close_time, is_closed, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(store_id, weekday) DO UPDATE SET open_time = excluded.open_time, close_time = excluded.close_time, is_closed = excluded.is_closed, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
  beginWriteSavepoint(db, 'business_hours_write', 'stores')
  try {
    for (const e of entries) stmt.run(storeId, Number(e.weekday), e.isClosed ? '00:00' : e.openTime, e.isClosed ? '00:00' : e.closeTime, e.isClosed ? 1 : 0, now, updatedBy)
    if(acceptance!==undefined)writeAcceptance(db,storeId,next,now,tenantId)
    db.exec('RELEASE business_hours_write')
  } catch (error) { db.exec('ROLLBACK TO business_hours_write; RELEASE business_hours_write'); throw error }
}
