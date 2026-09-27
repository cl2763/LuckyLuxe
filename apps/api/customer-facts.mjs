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

export function lastCustomerVisitAt(db, userId, tenantId, now = new Date()) {
  const row = db.prepare(`SELECT MAX(julianday(at)) AS latest FROM (
      SELECT ${bookingVisitAtSql()} AS at FROM bookings WHERE user_id=? AND tenant_id=?
      UNION ALL
      SELECT COALESCE(b.appointment_start,s.created_at) AS at FROM settlements s
      LEFT JOIN bookings b ON b.id=s.booking_id AND b.tenant_id=s.tenant_id
      WHERE s.user_id=? AND s.tenant_id=? AND s.status IN ('signed','amended')
    ) WHERE julianday(at)<=julianday(?)`).get(userId,tenantId,userId,tenantId,now.toISOString())
  return row.latest === null ? null : new Date(Math.round((row.latest-2440587.5)*86400000)).toISOString()
}

export const bindingBadgeText = (bound) => bound ? '' : '未绑定微信'
