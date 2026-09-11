/* 预约草稿与门店/服务/技师取件(《代码结构公约》② 边改边拆:③ 预约采集动的就是这块)

   ⚠️ `createBookingDraft` 是**全仓唯一建草稿的地方** —— ③ 预约采集、老板端手工建、
   报价转草稿走的都是它。不许并排再写一个(图 §二「草稿只建一次并复用」靠的就是单一出口)。 */

export function createBookingDraftsModule(deps) {
  const {
    db, apiError, getService, iso, addMinutes, randomId, currentTenantId,
    serializeBookingDraft, serializeQuoteRequest, assertStaffCanAccessQuote,
    wecomRouting, nextBookingDraftSlot, mergeReferenceImages, bookingDraftLink, HOLD_MINUTES,
  } = deps
  for (const [name, v] of Object.entries(deps)) {
    if (v === undefined || v === null) throw new Error(`createBookingDraftsModule 缺依赖:${name}`)
  }

  function firstActiveStoreId() {
    return db.prepare('SELECT id FROM stores WHERE is_active = 1 AND tenant_id = ? ORDER BY name ASC LIMIT 1').get(currentTenantId())?.id || null
  }

  function firstActiveService(serviceType = 'nail') {
    const type = String(serviceType || 'nail').toUpperCase()
    const tid = currentTenantId()
    return db.prepare('SELECT * FROM services WHERE is_active = 1 AND tenant_id = ? AND type = ? ORDER BY sort_order ASC LIMIT 1').get(tid, type)
      || db.prepare('SELECT * FROM services WHERE is_active = 1 AND tenant_id = ? ORDER BY sort_order ASC LIMIT 1').get(tid)
  }

  function firstQualifiedTechnician(storeId, serviceId) {
    return db.prepare(`
      SELECT t.* FROM technicians t
      JOIN technician_services ts ON ts.technician_id = t.id
      WHERE t.store_id = ? AND t.is_active = 1 AND ts.service_id = ?
      ORDER BY t.name ASC
      LIMIT 1
    `).get(storeId, serviceId)
  }

  function getBookingDraftById(id, lang = 'zh') {
    return serializeBookingDraft(db.prepare('SELECT * FROM booking_drafts WHERE id = ?').get(id), lang)
  }

  function createBookingDraft(body = {}, admin = {}) {
    const quoteRow = body.quoteRequestId || body.quote_request_id
      ? db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(body.quoteRequestId || body.quote_request_id)
      : null
    if (quoteRow) assertStaffCanAccessQuote(admin, quoteRow)
    const quote = quoteRow ? serializeQuoteRequest(quoteRow) : null
    const requestedConversationId = quote?.conversationId || body.conversationId || body.conversation_id || null
    const conversationId = requestedConversationId && wecomRouting.conversationRow(requestedConversationId, 'id')
      ? requestedConversationId
      : null
    const service = body.serviceId || body.service_id
      ? getService(body.serviceId || body.service_id)
      : firstActiveService(quote?.serviceType || body.serviceType || 'nail')
    if (!service) throw apiError(404, 'SERVICE_NOT_FOUND', 'No active service is available for the booking draft.')
    const storeId = body.storeId || body.store_id || firstActiveStoreId()
    const requestedTechnicianId = body.technicianId || body.technician_id || quote?.technicianId || null
    const slot = nextBookingDraftSlot({
      storeId,
      serviceId: service.id,
      technicianId: requestedTechnicianId,
      date: body.date || '',
      time: body.time || ''
    })
    const technician = db.prepare('SELECT * FROM technicians WHERE id = ? AND tenant_id = ?').get(slot.technicianId, currentTenantId()) || firstQualifiedTechnician(storeId, service.id)
    if (!technician) throw apiError(404, 'TECHNICIAN_NOT_FOUND', 'No qualified technician is available for this service.')
    const now = iso(new Date())
    const expiresAt = iso(addMinutes(new Date(), HOLD_MINUTES))
    const draftId = body.id || randomId('draft')
    const referenceImages = mergeReferenceImages(
      body.referenceImages || body.images || [],
      quote?.referenceImages || []
    )
    const notes = String(body.notes || body.staffNotes || quote?.staffNotes || quote?.customerMessage || '').trim()
    const linkUrl = bookingDraftLink(draftId)
    db.prepare(`
      INSERT INTO booking_drafts
        (id, quote_request_id, conversation_id, user_id, source_channel, service_id, technician_id, store_id, date, time,
         addons_json, reference_images_json, notes, status, booking_id, link_url, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', NULL, ?, ?, ?, ?)
    `).run(
      draftId,
      quote?.id || body.quoteRequestId || null,
      conversationId,
      quote?.userId || body.userId || null,
      body.sourceChannel || quote?.sourceChannel || 'admin_booking_draft',
      service.id,
      technician.id,
      storeId,
      slot.date,
      slot.time,
      JSON.stringify(Array.isArray(body.addOns) ? body.addOns : []),
      JSON.stringify(referenceImages),
      notes,
      linkUrl,
      expiresAt,
      now,
      now
    )
    const draft = getBookingDraftById(draftId)
    if (quote?.id) {
      db.prepare("UPDATE quote_requests SET status = 'DRAFT_CREATED', expires_at = ?, updated_at = ? WHERE id = ?")
        .run(expiresAt, now, quote.id)
    }
    return draft
  }

  return { firstActiveStoreId, firstActiveService, firstQualifiedTechnician, getBookingDraftById, createBookingDraft }
}
