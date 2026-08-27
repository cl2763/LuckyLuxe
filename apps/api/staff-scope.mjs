/* 员工能看见的范围(2026-08-27,店主走查回执 ④)。

   她的原话:「之前技师还是可以看到他自己服务的会员的信息的」。
   原来店员端**整个客户档案都没有** —— 过紧了,那是他干活要用的东西。
   但也不能把老板那页整个给他:改余额、退卡这些是老板的口。
   所以给一条**只读、只到自己**的:只列他服务过(且已完成)的客人,不带任何金额编辑入口。

   判据取"这个人是不是他服务过的",不是"他是不是员工" ——
   问别人的客人一律 404:对他来说,那个人本来就不该存在。 */
export function createStaffScope({ db, apiError, currentTenantId, memberCodeForUserId }) {
  const maskPhone = (p) => (p ? String(p).replace(/^(\d{0,3}).*(\d{2})$/, '$1****$2') : '')

  function myCustomers(adminSession, query = {}) {
    const techId = adminSession.role === 'staff' ? String(adminSession.technicianId || '') : String(query.technicianId || '')
    if (!techId) throw apiError(400, 'BAD_REQUEST', '这个账号没有绑定技师,看不到「我的客人」。')
    const rows = db.prepare(`SELECT u.id, u.display_name, u.phone, COUNT(b.id) AS visits, MAX(b.appointment_start) AS last_at
      FROM bookings b JOIN users u ON u.id = b.user_id
      WHERE b.tenant_id = ? AND b.technician_id = ? AND b.status = 'COMPLETED'
      GROUP BY u.id ORDER BY last_at DESC LIMIT 200`).all(currentTenantId(), techId)
    return {
      customers: rows.map((r) => ({
        id: r.id,
        displayName: r.display_name || memberCodeForUserId(r.id),
        memberCode: memberCodeForUserId(r.id),
        phoneMasked: maskPhone(r.phone),
        visits: r.visits,
        lastVisitAt: r.last_at || null
      })),
      readOnly: true,
      note: '只列你服务过的客人 · 只读(改余额、退卡这些是老板的口)'
    }
  }

  function myCustomerDetail(adminSession, userId) {
    const techId = String(adminSession.technicianId || '')
    const served = db.prepare("SELECT 1 AS hit FROM bookings WHERE tenant_id = ? AND technician_id = ? AND user_id = ? AND status = 'COMPLETED' LIMIT 1")
      .get(currentTenantId(), techId, userId)
    if (!served) throw apiError(404, 'NOT_FOUND', '这不是你的客人。')
    const u = db.prepare('SELECT id, display_name, phone FROM users WHERE id = ? AND tenant_id = ?').get(userId, currentTenantId())
    if (!u) throw apiError(404, 'NOT_FOUND', '找不到这位顾客。')
    const bookings = db.prepare(`SELECT id, appointment_start, status FROM bookings
      WHERE tenant_id = ? AND technician_id = ? AND user_id = ? ORDER BY appointment_start DESC LIMIT 20`).all(currentTenantId(), techId, u.id)
    return { customer: { id: u.id, displayName: u.display_name, memberCode: memberCodeForUserId(u.id) }, bookings, readOnly: true }
  }

  return { myCustomers, myCustomerDetail }
}
