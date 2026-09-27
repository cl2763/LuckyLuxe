// Private order share: the caller must belong to the store and own/access this order.
export function createWorkShare({ db, resolveTenant, tenantContext, requireAdmin, requireCustomer, assertStaffCanAccessBooking, serializeBooking, requireAi, countAiUsage, createSocialCopy, apiError }) {
  function authorize(req, query, id) {
    let admin
    try { admin = requireAdmin(req) } catch (error) { if (error.status !== 401 && error.statusCode !== 401 && error.code !== 'UNAUTHORIZED') throw error }
    const explicitTenant = req.headers?.['x-tenant-id'] || query?.tenant || query?.store
    const tenantId = admin && !explicitTenant ? admin.tenantId : resolveTenant(req, query)
    tenantContext.enterWith({ tenantId })
    const customer = admin ? null : requireCustomer(req)
    if (admin && admin.tenantId !== tenantId) throw apiError(403, 'FORBIDDEN', '请登录这家门店的账户。')
    const row = db.prepare('SELECT * FROM bookings WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    if (!row) throw apiError(404, 'NOT_FOUND', '未找到本店订单。')
    if (admin) assertStaffCanAccessBooking(admin, row)
    else if (row.user_id !== customer.id) throw apiError(403, 'FORBIDDEN', '只能查看自己的订单作品。')
    return { row, audience: admin ? 'staff' : 'customer', tenantId }
  }
  function read(req, query, id, lang = 'zh') {
    const { row, audience, tenantId } = authorize(req, query, id)
    const b = serializeBooking(row, lang)
    const store = db.prepare('SELECT name FROM stores WHERE id = ? AND tenant_id = ?').get(row.store_id, tenantId)
    return { audience, booking: { id: b.id, service: { name: b.service?.name || '' }, technician: { name: b.technician?.name || '' }, store: { name: store?.name || '' }, galleryStatus: b.galleryStatus, hasWorkImages: !!b.workImages?.length, approvedWorkImages: b.galleryStatus === 'approved' ? b.approvedWorkImages || [] : [], appointmentDate: b.appointmentDate } }
  }
  async function generate(req, query, body) {
    const { booking, audience } = read(req, query, body.bookingId, body.lang)
    if (booking.galleryStatus !== 'approved' || !booking.approvedWorkImages.length) throw apiError(409, 'WORK_NOT_READY', '这单还没有审核通过的作品图。')
    if (!['xiaohongshu','douyin','meituan','instagram'].includes(body.platform)) throw apiError(400, 'BAD_REQUEST', '请选择支持的平台。')
    const index = Number(body.imageIndex ?? 0)
    if (!Number.isInteger(index) || index < 0 || index >= booking.approvedWorkImages.length) throw apiError(400, 'BAD_REQUEST', '请选择本单作品图。')
    requireAi(); countAiUsage()
    return { copy: await createSocialCopy({ lang: body.lang === 'en' ? 'en' : 'zh', image: booking.approvedWorkImages[index], booking, brandName: booking.store.name, platform: body.platform, audience }) }
  }
  return { authorize, read, generate }
}
