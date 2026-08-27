/* 员工能看见的范围(2026-08-27,店主走查回执 ④)。

   她的原话:「之前技师还是可以看到他自己服务的会员的信息的」。
   原来店员端**整个客户档案都没有** —— 过紧了,那是他干活要用的东西。
   但也不能把老板那页整个给他:改余额、退卡这些是老板的口。
   所以给一条**只读、只到自己**的:只列他服务过(且已完成)的客人,不带任何金额编辑入口。

   判据取"这个人是不是他服务过的",不是"他是不是员工" ——
   问别人的客人一律 404:对他来说,那个人本来就不该存在。 */
export function createStaffScope({ db, apiError, currentTenantId, memberCodeForUserId, bookingStatusText, storeTimeText }) {
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
    /* 服务历史带上项目名(技师要看的是"上次给她做的什么"),但**一个金额字段都不下发** ——
       余额/实付/优惠这些是老板的口径,这一页碰都不碰。 */
    const bookings = db.prepare(`SELECT b.id, b.appointment_start, b.status, b.after_sales_status, s.name_zh AS service_name
      FROM bookings b LEFT JOIN services s ON s.id = b.service_id
      WHERE b.tenant_id = ? AND b.technician_id = ? AND b.user_id = ? ORDER BY b.appointment_start DESC LIMIT 20`)
      .all(currentTenantId(), techId, u.id)
    /* 🔴 公约④「动手前先搜复用」的现场:我第一版**新建了一张 service_notes 表**,
       结果全仓早就有一张同名的(服务小记 P0-②,还带 AI 结构化)—— `CREATE TABLE IF NOT EXISTS`
       悄悄什么也没做,查询立刻 `no such column: kind`。改成接现有那一张:
       小记 = raw_text,偏好 = AI 拆出来的 structured.preferences,不再并排造第二份真相。 */
    const noteRows = db.prepare(`SELECT id, raw_text, structured_json, service_name, technician_name, created_at
      FROM service_notes WHERE tenant_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 50`).all(currentTenantId(), u.id)
    const parse = (t) => { try { return JSON.parse(t || '{}') } catch { return {} } }
    const notes = noteRows.map((r) => ({
      id: r.id, body: r.raw_text, serviceName: r.service_name || '',
      technicianName: r.technician_name || '', createdText: storeTimeText(r.created_at)
    }))
    const preferences = [...new Set(noteRows.flatMap((r) => {
      const st = parse(r.structured_json)
      return [...(st.preferences || []), ...(st.styles || [])]
    }))]
    const safetyFlags = [...new Set(noteRows.flatMap((r) => parse(r.structured_json).safetyFlags || []))]
    let tags = []
    try { tags = JSON.parse(db.prepare('SELECT tags_json FROM users WHERE id = ?').get(u.id)?.tags_json || '[]') } catch { tags = [] }
    return {
      customer: {
        id: u.id, displayName: u.display_name, memberCode: memberCodeForUserId(u.id),
        phoneMasked: maskPhone(u.phone), tags
      },
      /* 状态词与时间都**后端出句**:前端零词典、零时区推算。
         状态走全仓唯一出口 bookingStatusText(小程序那套已拍的词),
         时间走门店时区(裸 ISO 直渲会把多伦多下午 4 点显示成 UTC 晚上 8 点 —— 08-27 实拍就撞了)。 */
      bookings: bookings.map((b) => ({
        id: b.id, at: b.appointment_start, atText: storeTimeText(b.appointment_start),
        statusText: bookingStatusText(b), serviceName: b.service_name || ''
      })),
      notes,
      preferences,
      safetyFlags,
      readOnly: true,
      canWriteNote: true,   // 写口复用现有的 POST /admin/service-notes(员工/老板均可写)
      note: '看得到你服务过的记录,能写服务小记;余额、充值、退卡这些是老板的口。'
    }
  }

  return { myCustomers, myCustomerDetail }
}
