/* Customer spend and visit facts shared by profile, list and membership qualification.
   Booking list prices are not spending evidence. Opening migrated spend is historical
   consumption (not new points); rolling eligibility excludes this undated opening. */
export function customerSpendCents(db, userId, tenantId, sinceIso = null) {
  if (!userId) return 0
  const signed = db.prepare(`SELECT COALESCE(SUM(subtotal_cents),0) AS cents FROM settlements
    WHERE user_id=? AND tenant_id=? AND status='signed'
    ${sinceIso ? 'AND julianday(signed_at)>=julianday(?)' : ''}`)
    .get(...[userId, tenantId, ...(sinceIso ? [sinceIso] : [])]).cents
  const opening = sinceIso ? 0 : (db.prepare('SELECT legacy_total_spend_cents AS cents FROM users WHERE id=? AND tenant_id=?').get(userId, tenantId)?.cents || 0)
  return signed + opening
}

// A booking reaches the salon through arrived_at, not a synthetic ARRIVED status.
// Keep this fact in one SQL expression for profile dates and dashboard counts.
export const bookingVisitAtSql = () => `CASE
  WHEN status IN ('PENDING_PAYMENT','CONFIRMED','COMPLETED','AFTER_SALES') AND NULLIF(arrived_at,'') IS NOT NULL THEN arrived_at
  WHEN status='COMPLETED' THEN appointment_start ELSE NULL END`

// An early-completed future appointment is an actual visit on arrival/signing day.
// Late signatures still belong to the booked service day. Financial attribution is unchanged.
const firstSignedAtSql = `COALESCE((SELECT s0.signed_at FROM settlements s0
  WHERE s0.booking_id=s.booking_id AND s0.tenant_id=s.tenant_id AND s0.user_id=s.user_id
  AND s0.status IN ('signed','amended') AND s0.signed_at IS NOT NULL
  ORDER BY julianday(s0.signed_at) LIMIT 1),s.signed_at)`
const signedVisitAtSql = `CASE WHEN julianday(b.appointment_start)>julianday(${firstSignedAtSql})
  THEN CASE WHEN julianday(b.arrived_at)<=julianday(${firstSignedAtSql}) THEN b.arrived_at ELSE ${firstSignedAtSql} END
  ELSE COALESCE(b.appointment_start,s.created_at) END`
const signedVisitsSql = `SELECT ${signedVisitAtSql} AS at FROM settlements s
  LEFT JOIN bookings b ON b.id=s.booking_id AND b.tenant_id=s.tenant_id
  WHERE s.user_id=? AND s.tenant_id=? AND s.status IN ('signed','amended')`
const noSignedVisitSql = `NOT EXISTS (SELECT 1 FROM settlements s WHERE s.booking_id=bookings.id
  AND s.tenant_id=bookings.tenant_id AND s.user_id=bookings.user_id AND s.status IN ('signed','amended'))`

export function customerVisitDaysCount(db, userId, tenantId, timezone, localParts, now = new Date()) {
  if (!userId) return 0
  const rows = db.prepare(`SELECT at FROM (
    ${signedVisitsSql} UNION ALL
    SELECT COALESCE(NULLIF(arrived_at,''),appointment_start) AS at FROM bookings
    WHERE user_id=? AND tenant_id=? AND status='COMPLETED' AND ${noSignedVisitSql}
  ) WHERE julianday(at)<=julianday(?)`).all(userId,tenantId,userId,tenantId,now.toISOString())
  return new Set(rows.map(row => localParts(row.at, timezone).date)).size
}

export function lastCustomerVisitAt(db, userId, tenantId, now = new Date()) {
  const row = db.prepare(`SELECT MAX(julianday(at)) AS latest FROM (
      SELECT ${bookingVisitAtSql()} AS at FROM bookings WHERE user_id=? AND tenant_id=? AND ${noSignedVisitSql}
      UNION ALL
      ${signedVisitsSql}
    ) WHERE julianday(at)<=julianday(?)`).get(userId,tenantId,userId,tenantId,now.toISOString())
  return row.latest === null ? null : new Date(Math.round((row.latest-2440587.5)*86400000)).toISOString()
}

export const bindingBadgeText = (bound) => bound ? '' : '未绑定微信'
