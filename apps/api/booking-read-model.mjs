export function userBookingStats(db, userId, tenantId) {
  if (!userId) return { total_spent_cents: 0, visits: 0 }
  // 每店独立会员:消费/到店只算这家店(tenant)
  return db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN service_price_cents ELSE 0 END), 0) AS total_spent_cents,
      COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END), 0) AS visits
    FROM bookings
    WHERE user_id = ? AND tenant_id = ?
  `).get(userId, tenantId) || { total_spent_cents: 0, visits: 0 }
}
