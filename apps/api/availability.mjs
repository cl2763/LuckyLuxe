/* 可约时段计算(《代码结构公约》② 边改边拆:③ 预约采集动的就是这个领域,顺手搬出来)

   ⚠️ 这是 `/availability` 与 ③ 预约采集**共用的同一个函数** —— 不许并排再写一份。
   AI 回复里出现的每一个时段都必须来自这里的返回集合(图 §三 事实槽那一行)。 */

export function createAvailability(deps) {
  const {
    db, apiError, getService, localDateTime, localParts, totalDuration, specialDateFor,
    iso, addMinutes, minutesFromTime, timeFromMinutes, buildSlotStarts, SLOT_MINUTES,
  } = deps
  for (const [name, v] of Object.entries(deps)) {
    if (v === undefined || v === null) throw new Error(`createAvailability 缺依赖:${name}`)
  }

  function getAvailability(query) {
    const { storeId, serviceId, date, technicianId } = query
    if (!storeId || !serviceId || !date) throw apiError(400, 'BAD_REQUEST', 'storeId, serviceId and date are required.')
    const service = getService(serviceId)
    if (!service) throw apiError(404, 'NOT_FOUND', 'Service not found.')
    const weekday = localDateTime(date, '12:00').getDay()
    const hours = db.prepare('SELECT * FROM business_hours WHERE store_id = ? AND weekday = ?').get(storeId, weekday)
    const extraDurationMin = Math.max(0, Number(query.extraDurationMin || 0))
    const durationMin = totalDuration(service.type, service.base_duration_min, [{ durationMin: extraDurationMin }])
    // 特殊日期优先于每周固定模式
    const special = specialDateFor(storeId, date)
    const closedThatDay = special ? Boolean(special.is_closed) : (!hours || Boolean(hours.is_closed))
    /* 🔴 「店休」和「约满」是两件事,不许说同一句话(D88 一句一因同族)。
       原来两种情况都回 `slots: []`,调用方分不出来,于是 ③ 把店休日答成「这天已经约满了」——
       对顾客说了不实的话。这里如实带上 `closed`,由调用方说对应的那句。 */
    if (closedThatDay) return { date, durationMin, slots: [], closed: true }
    /* 零回落:没真实时段=没有可约,不编 10:00-20:00 给顾客约一家从没设置过营业时间的店 */
    const dayOpen = (special && !special.is_closed && special.open_time) || hours?.open_time || null
    const dayClose = (special && !special.is_closed && special.close_time) || hours?.close_time || null
    if (!dayOpen || !dayClose) return { date, durationMin, slots: [], closed: true }
  
    const techRows = db.prepare(`
      SELECT t.* FROM technicians t
      JOIN technician_services ts ON ts.technician_id = t.id
      WHERE t.store_id = ? AND t.is_active = 1 AND ts.service_id = ? ${technicianId ? 'AND t.id = ?' : ''}
      ORDER BY t.name ASC
    `).all(...(technicianId ? [storeId, serviceId, technicianId] : [storeId, serviceId]))
    const result = []
    for (const tech of techRows) {
      const schedule = db.prepare('SELECT * FROM technician_schedules WHERE technician_id = ? AND date = ?').get(tech.id, date)
      if (schedule && !schedule.is_working) continue
      const openTime = schedule?.start_time || dayOpen
      const closeTime = schedule?.end_time || dayClose
      const dayStart = iso(localDateTime(date, '00:00'))
      const dayEnd = iso(addMinutes(localDateTime(date, '00:00'), 24 * 60))
      const occupiedRows = db.prepare('SELECT starts_at FROM booking_slots WHERE technician_id = ? AND starts_at >= ? AND starts_at < ?').all(tech.id, dayStart, dayEnd)
      const occupied = new Set(occupiedRows.map((row) => row.starts_at))
      const slots = []
      /* D88 同族:今天已过去的时刻不再可约(以前晚上查今天照样列出上午 —— 编出根本约不上的位) */
      const nowA = localParts(new Date())
      const pastMin = date === nowA.date ? minutesFromTime(nowA.time) : -1
      for (let startMin = minutesFromTime(openTime); startMin + durationMin <= minutesFromTime(closeTime); startMin += SLOT_MINUTES) {
        if (startMin < pastMin) continue
        const time = timeFromMinutes(startMin)
        const required = buildSlotStarts(localDateTime(date, time), durationMin).map(iso)
        if (required.every((slot) => !occupied.has(slot))) slots.push(time)
      }
      result.push({ technician: tech, slots })
    }
    return { date, durationMin, slots: result, closed: false }
  }

  return { getAvailability }
}
