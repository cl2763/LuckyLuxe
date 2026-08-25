/* AI 报价域 · 序列化(从 local-server.mjs 搬出,2026-08-25 丁线第一步)。
   公约①②:AI 报价这一域正好与甲线拆前端 AI/客服域配对;**行为一字未改**,整段原样搬,
   依赖由调用方注入(与 after-sales.mjs / order-badges.mjs 同一模式,避免循环引用)。

   这块干的事只有一件:把 quote_requests 的一行**原样翻成对外字段名**,不做任何口径判断。 */
export function createQuoteSerialize({ db, parseJson, normalizeQuoteFlag, cents }) {
  function serializeQuoteRequest(row) {
    if (!row) return null
    const styleElements = parseJson(row.style_elements_json)
    return {
      id: row.id,
      conversationId: row.conversation_id,
      userId: row.user_id,
      sourceChannel: row.source_channel,
      serviceType: row.service_type,
      serviceId: row.service_id,
      technicianId: row.technician_id,
      status: row.status,
      customerMessage: row.customer_message,
      customerLang: row.customer_lang,
      referenceImages: parseJson(row.reference_images_json),
      styleElements,
      missingQuestions: parseJson(row.missing_questions_json),
      extensionNeeded: row.extension_needed,
      removalNeeded: row.removal_needed,
      repairNeeded: row.repair_needed,
      charmsNeeded: row.charms_needed,
      firstLashVisit: normalizeQuoteFlag(styleElements?.quoteIntake?.firstLashVisit ?? styleElements?.firstLashVisit),
      lowerLashRequested: row.lower_lash_requested,
      healthCheckClear: row.health_check_clear,
      staffCanDo: row.staff_can_do === null || row.staff_can_do === undefined ? null : Boolean(row.staff_can_do),
      staffPriceCents: row.staff_price_cents,
      staffPrice: row.staff_price_cents === null || row.staff_price_cents === undefined ? null : cents(row.staff_price_cents),
      staffDurationMin: row.staff_duration_min,
      staffNotes: row.staff_notes,
      aiReply: parseJson(row.ai_reply_json),
      draftBookingId: row.draft_booking_id,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  function getQuoteRequestById(id) {
    return serializeQuoteRequest(db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(id))
  }

  return { serializeQuoteRequest, getQuoteRequestById }
}
