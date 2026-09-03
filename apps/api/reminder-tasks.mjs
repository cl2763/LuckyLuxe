/* 提醒任务域 + 「租户来源三选一必须一致」的判断(D131,店主 04b §二,2026-09-03 搬出)

   ══ 为什么在一起 ══
   `scheduleReminderTask` 是 D131 两处红线之一;它与 `tenantForSideEffect` 是同一件事的两半:
   **一个副作用要记在哪家店**。搬出来一是走公约②(动哪个领域就把该领域搬出去),
   二是巨型文件棘轮只许降。

   ══ 病(修前)══
   这条 INSERT 不带 `tenant_id` → 落列默认 `lucky-luxe`,
   于是别店顾客的提醒挂到旗舰店名下,而调度器逐租户扫 —— 挂错店就永远轮不到它。 */
export function createReminderTasks({ db, iso, randomId, apiError, currentTenantId, parseJson }) {
  /* 🔴 D131 红线一(店主 04b §二):这条 INSERT 原来**不带 tenant_id**,落列默认 `lucky-luxe` ——
     于是别店顾客的提醒挂到旗舰店名下,而调度器按租户取(`notify-scheduler` 逐租户扫)。
     租户来源三选一必须**一致**:请求上下文 / 顾客档案 / 会话。
     不一致就抛错 —— **一个字段只回答一个问题**,不许"取到哪个算哪个"。 */
    function tenantForSideEffect(kind, { userId = null, conversationId = null, quoteRequestId = null } = {}) {
    const ctx = currentTenantId()
    const claims = [{ 来源: '请求上下文', tid: ctx }]
    const push = (来源, tid) => { if (tid) claims.push({ 来源, tid }) }
    if (userId) push('顾客档案', (db.prepare('SELECT tenant_id FROM users WHERE id = ?').get(userId) || {}).tenant_id)
    if (conversationId) push('会话', (db.prepare('SELECT tenant_id FROM wechat_conversations WHERE id = ?').get(conversationId) || {}).tenant_id)
    if (quoteRequestId) push('报价单', (db.prepare('SELECT tenant_id FROM quote_requests WHERE id = ?').get(quoteRequestId) || {}).tenant_id)
    const distinct = [...new Set(claims.map((c) => c.tid))]
    if (distinct.length > 1) {
      throw apiError(500, 'TENANT_MISMATCH',
        `${kind} 的租户来源不一致:${claims.map((c) => `${c.来源}=${c.tid}`).join(' / ')}`)
    }
    return ctx
  }

    function scheduleReminderTask({ userId = null, bookingId = null, quoteRequestId = null, conversationId = null, type, channel = 'mock', scheduledAt, payload = {} }) {
    const id = randomId('reminder')
    const now = iso(new Date())
    const tid = tenantForSideEffect('提醒任务', { userId, conversationId, quoteRequestId })
    db.prepare(`
      INSERT INTO reminder_tasks (id, user_id, booking_id, quote_request_id, conversation_id, type, channel, status, scheduled_at, payload_json, created_at, updated_at, tenant_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?)
    `).run(id, userId, bookingId, quoteRequestId, conversationId, type, channel, iso(scheduledAt || new Date()), JSON.stringify(payload), now, now, tid)
    return id
  }

  /* 🔴 D131 红线二(店主 04b §二):这条 INSERT 原来**不带 tenant_id**,落列默认 `lucky-luxe`。
     而 AI 报价状态机**按租户读**(`quote-state.mjs:86/124`)、报价台也按租户列
     (`getAdminQuoteRequests`)—— 于是:
     · 非默认租户的顾客提一次报价 → 单落在旗舰店名下 → 自己的状态机**永远找不到自己刚建的单**;
     · 旗舰店的报价台**列得出别店顾客的报价**(跨租户泄露)。
     这两条正卡在 AI 12 场景要走的那条路上,所以先修再跑。 */
    function getAdminReminderTasks(admin) {
    const rows = admin.role === 'staff'
      ? db.prepare(`
        SELECT rt.* FROM reminder_tasks rt
        LEFT JOIN quote_requests qr ON qr.id = rt.quote_request_id
        WHERE rt.tenant_id = ? AND (qr.technician_id = ? OR qr.technician_id IS NULL)
        ORDER BY rt.scheduled_at ASC
        LIMIT 160
      `).all(currentTenantId(), admin.technicianId)
      : db.prepare('SELECT * FROM reminder_tasks WHERE tenant_id = ? ORDER BY scheduled_at ASC LIMIT 160').all(currentTenantId())
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      bookingId: row.booking_id,
      quoteRequestId: row.quote_request_id,
      conversationId: row.conversation_id,
      type: row.type,
      channel: row.channel,
      status: row.status,
      scheduledAt: row.scheduled_at,
      sentAt: row.sent_at,
      payload: parseJson(row.payload_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  }

  /* 🔴 04b 现扫补的一处(读写两道闸律的第六案):按 id 改状态**原来不验租户** ——
     别店的提醒任务,知道 id 就能被标成已发。写口收了,这一侧也得收。 */
    function markReminderTask(id, status = 'SENT') {
    const valid = ['PENDING', 'SENT', 'SKIPPED', 'FAILED'].includes(status) ? status : 'SENT'
    const sentAt = valid === 'SENT' ? iso(new Date()) : null
    const tid = currentTenantId()
    db.prepare('UPDATE reminder_tasks SET status = ?, sent_at = COALESCE(?, sent_at), updated_at = ? WHERE id = ? AND tenant_id = ?').run(valid, sentAt, iso(new Date()), id, tid)
    const row = db.prepare('SELECT * FROM reminder_tasks WHERE id = ? AND tenant_id = ?').get(id, tid)
    if (!row) throw apiError(404, 'NOT_FOUND', 'Reminder task not found.')
    return row
  }

  return { tenantForSideEffect, scheduleReminderTask, getAdminReminderTasks, markReminderTask }
}
