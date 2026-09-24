// 服务小记的授权、校验和落库集中在这里，路由仅负责读写 HTTP。
export async function writeServiceNote({body,adminSession,db,apiError,currentTenantId,assertStaffCanAccessBooking,getService,hasAi,countAiUsage,createServiceNoteInsights,randomId,iso}) {
  const rawText = String(body.rawText || '').trim()
  if (!rawText) throw apiError(400, 'BAD_REQUEST', '小记内容不能为空。')
  let userId = String(body.userId || '').trim()
  const booking = body.bookingId ? db.prepare('SELECT * FROM bookings WHERE id = ? AND tenant_id = ?').get(body.bookingId, currentTenantId()) : null
  if (body.bookingId && !booking) throw apiError(404, 'NOT_FOUND', '没有这条预约。')
  if (booking) {
    assertStaffCanAccessBooking(adminSession, booking)
    if (userId && userId !== booking.user_id) throw apiError(400, 'CUSTOMER_MISMATCH', '小记顾客与预约不一致。')
    userId = booking.user_id
  }
  if (!userId) throw apiError(400, 'BAD_REQUEST', '缺少顾客。')
  /* 🔴 08-27 补的越权闸:不带 bookingId 时,这条口原来**谁的顾客都能写** ——
     读那一侧(GET /admin/customers/:id/notes)早就限死"只看自己服务过的",写这一侧漏了同一刀。
     员工写别人的顾客一律 404(与读口同一措辞:那个人对他不该存在)。 */
  if (!booking && adminSession.role !== 'owner') {
    const mine = db.prepare('SELECT 1 AS hit FROM bookings WHERE tenant_id = ? AND technician_id = ? AND user_id = ? LIMIT 1')
      .get(currentTenantId(), adminSession.technicianId || '', userId)
    if (!mine) throw apiError(404, 'NOT_FOUND', '没有这位顾客的记录。')
  }
  const svc = booking && booking.service_id ? getService(booking.service_id) : null
  const tech = booking && booking.technician_id ? db.prepare('SELECT name FROM technicians WHERE id = ? AND tenant_id = ?').get(booking.technician_id, booking.tenant_id) : null
  const u = db.prepare('SELECT display_name FROM users WHERE id = ? AND tenant_id = ?').get(userId, currentTenantId())
  if (!u) throw apiError(404, 'NOT_FOUND', '没有这位顾客的记录。')
  // AI 结构化(失败自动 fallback,不阻塞保存)。未开通 AI 智能包时**跳过 AI、照常保存原文**——
  // 小记本身是客户档案的地基,不能因为没买 AI 就写不了;只是不再自动拆成 款式/性格/偏好/同行/安全项。
  const emptyStructured = () => ({ summary: rawText.slice(0, 60), safetyFlags: [], styles: [], personality: [], preferences: [], companions: [], other: [] })
  let structured = emptyStructured()
  const aiStructured = hasAi()
  if (aiStructured) {
    countAiUsage()
    try {
      const aiRes = await createServiceNoteInsights({ rawText, serviceName: svc ? svc.name_zh : (body.serviceName || ''), customerName: u ? u.display_name : '' })
      structured = (aiRes && aiRes.data) ? aiRes.data : aiRes // 拆 aiJson 的 {data} 外壳
    } catch (e) { structured = emptyStructured() }
  }
  /* 小记图片(08-30f 合同):≤9 张,只收 data:image/(图库同款通道);随小记只追加,不可删改。
     后端终闸:超 9 或非图形 → 400(前端拦只算体验) */
  const images = Array.isArray(body.images) ? body.images : []
  if (images.length > 9) throw apiError(400, 'BAD_REQUEST', '单条小记最多 9 张图片。')
  if (images.some((im) => typeof im !== 'string' || !im.startsWith('data:image/'))) {
    throw apiError(400, 'BAD_REQUEST', '图片格式不对(只收拍照/相册上传的图)。')
  }
  const id = randomId('snote')
  db.prepare(`INSERT INTO service_notes (id, tenant_id, user_id, booking_id, technician_id, technician_name, service_name, raw_text, structured_json, created_by, created_at, images_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, currentTenantId(), userId, booking ? booking.id : null,
    booking ? booking.technician_id : (body.technicianId || null),
    (tech && tech.name) || body.technicianName || (adminSession.email || ''),
    svc ? svc.name_zh : (body.serviceName || ''),
    rawText, JSON.stringify(structured || {}), adminSession.email || 'admin', iso(new Date()),
    images.length ? JSON.stringify(images) : null)
  return { note: { id, rawText, structured, images, createdAt: iso(new Date()) } }
}
