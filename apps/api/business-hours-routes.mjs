/* 营业时间两条路由(GET/PUT /admin/business-hours)—— 2026-08-30 强制设置批从 local-server.mjs
   搬出,**只搬不改**(《棘轮律》+ 公约②边改边拆:动了营业时间域就把该域路由层带走)。
   A2 后端终闸(图 v1.0「至少选择一天营业」)在 PUT 里,与 hours-gate.mjs 的 hoursSavable 同源。
   调用点仍在租户闸门之后(交付纪律 7),门禁扫描器扫全部 *-routes.mjs,本文件天生在面上。 */
export function createBusinessHoursRoutes({ apiError, json, readBody, db, currentTenantId, defaultStoreId, getBusinessHoursRows, serializeBusinessHour, businessHoursText, storeTodayHours, upcomingSpecialDates, iso, hoursSavable, HOURS_GATE_TEXT }) {
  async function route(req, res, ctx) {
    const { path, adminSession } = ctx
  if (req.method === 'GET' && path === '/admin/business-hours') {
    const stores = db.prepare('SELECT id, name, address, phone, currency, timezone FROM stores WHERE is_active = 1 AND tenant_id = ? ORDER BY name ASC').all(currentTenantId())
    json(res, 200, {
      stores: stores.map((store) => ({
        id: store.id,
        name: store.name,
        address: store.address,
        phone: store.phone,
        // 2026-08-07:老板端要按本店币种/时区显示金额与"今天",这两项以前没下发,前端只能写死 CAD + Toronto
        currency: store.currency || 'CAD',
        timezone: store.timezone || 'America/Toronto',
        hours: getBusinessHoursRows(store.id).map(serializeBusinessHour),
        hoursText: { zh: businessHoursText(store.id, 'zh'), en: businessHoursText(store.id, 'en') },
        // 今日营业句/营业中状态:后端唯一出口(特殊日优先、按门店时区),前端零计算
        todayHours: { zh: storeTodayHours(store, 'zh'), en: storeTodayHours(store, 'en') },
        specialDates: upcomingSpecialDates(store.id, 366).map((row) => ({
          date: row.date,
          isClosed: Boolean(row.is_closed),
          openTime: row.open_time,
          closeTime: row.close_time,
          note: row.note || ''
        }))
      }))
    })
    return true
  }
  if (req.method === 'PUT' && path === '/admin/business-hours') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const body = await readBody(req)
    const storeId = body.storeId || defaultStoreId()
    const store = db.prepare('SELECT * FROM stores WHERE id = ? AND tenant_id = ?').get(storeId, currentTenantId())
    if (!store) throw apiError(404, 'NOT_FOUND', 'Store not found.')
    const entries = Array.isArray(body.hours) ? body.hours : []
    if (!entries.length) throw apiError(400, 'BAD_REQUEST', 'hours array is required.')
    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/
    const seen = new Set()
    for (const entry of entries) {
      const weekday = Number(entry.weekday)
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw apiError(400, 'BAD_REQUEST', 'weekday must be 0-6.')
      if (seen.has(weekday)) throw apiError(400, 'BAD_REQUEST', `duplicate weekday ${weekday}.`)
      seen.add(weekday)
      if (!entry.isClosed) {
        if (!timePattern.test(entry.openTime || '') || !timePattern.test(entry.closeTime || '')) throw apiError(400, 'BAD_REQUEST', 'openTime/closeTime must be HH:MM.')
        if (entry.openTime >= entry.closeTime) throw apiError(400, 'BAD_REQUEST', 'openTime must be earlier than closeTime.')
      }
    }
    /* A2 后端终闸(图 v1.0):落库后的合并态必须至少一天营业 —— 前端灰只是体验,这里才是闸 */
    if (!hoursSavable(entries, getBusinessHoursRows(storeId))) {
      throw apiError(400, 'HOURS_ALL_CLOSED', HOURS_GATE_TEXT.saveDisabledNote + '。')
    }
    const now = iso(new Date())
    const updatedBy = adminSession.email || adminSession.provider || 'owner'
    const stmt = db.prepare(`INSERT INTO business_hours (store_id, weekday, open_time, close_time, is_closed, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(store_id, weekday) DO UPDATE SET open_time = excluded.open_time, close_time = excluded.close_time, is_closed = excluded.is_closed, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    for (const entry of entries) {
      const isClosed = entry.isClosed ? 1 : 0
      /* 零回落(合同三):营业行的时间在上方校验里保证存在;休息行 schema NOT NULL,存 '00:00' 哨兵,
         读口全部先看 is_closed,永不消费这两个占位 */
      stmt.run(storeId, Number(entry.weekday), isClosed ? '00:00' : entry.openTime, isClosed ? '00:00' : entry.closeTime, isClosed, now, updatedBy)
    }
    json(res, 200, {
      store: { id: store.id, name: store.name },
      hours: getBusinessHoursRows(storeId).map(serializeBusinessHour),
      hoursText: { zh: businessHoursText(storeId, 'zh'), en: businessHoursText(storeId, 'en') }
    })
    return true
  }
    return false
  }
  return { route }
}
