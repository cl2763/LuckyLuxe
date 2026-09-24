/* 落单前的两道判断:能不能排(`assertBookable`)、排不下时该说哪句(`slotTakenError`)
   (《代码结构公约》② 边改边拆:05l 并发裁定动的就是这块)

   ⚠️ `slotTakenError` 是「这个时段占了」的**唯一出句处** —— 事务内复查与唯一索引兜底共用它。
   D88 / 01u 裁① / 01w 裁① 三条口径都在里面,措辞**逐字**照原文,一个字都不许顺手改
   (05l 现测:我搬的时候手滑改了三处字,`test-observe-fixes` 三条当场红)。 */

export function createBookingGuards(deps) {
  const {
    db, apiError, getService, localDateTime, localParts, minutesFromTime,
    totalDuration, addMinutes, specialDateFor,
  } = deps
  for (const [name, v] of Object.entries(deps)) {
    if (v === undefined || v === null) throw new Error(`createBookingGuards 缺依赖:${name}`)
  }

  function assertBookable(input, opts = {}) {
    const service = getService(input.serviceId)
    if (!service || !service.is_active) throw apiError(404, 'NOT_FOUND', '该服务不存在或已下架。')
    // 老板直接排单:放宽"技师-服务绑定"(老板可指派任意在岗技师),仍要求技师在职且属本店
    const technician = opts.adminDirect
      ? db.prepare('SELECT * FROM technicians t WHERE t.id = ? AND t.store_id = ? AND t.is_active = 1').get(input.technicianId, input.storeId)
      : db.prepare(`
      SELECT t.* FROM technicians t
      JOIN technician_services ts ON ts.technician_id = t.id
      WHERE t.id = ? AND t.store_id = ? AND t.is_active = 1 AND ts.service_id = ?
    `).get(input.technicianId, input.storeId, input.serviceId)
    if (!technician) throw apiError(404, 'NOT_FOUND', '该技师不在本店或不做这项服务。')

    const weekday = new Date(input.date + 'T12:00:00Z').getUTCDay()
    const hours = db.prepare('SELECT * FROM business_hours WHERE store_id = ? AND weekday = ?').get(input.storeId, weekday)
    // 特殊日期优先于每周固定模式(节假日休息/调整时段)
    const special = specialDateFor(input.storeId, input.date)
    const closedThatDay = special ? Boolean(special.is_closed) : (!hours || Boolean(hours.is_closed))
    // 老板直接排单:放宽"闭店/技师未排班/营业时段"限制(老板当面约的客,可能留晚点/加班);仍占位、仍防时段冲突
    if (closedThatDay && !opts.adminDirect) throw apiError(400, 'BAD_REQUEST', '该日期门店休息。')
    const schedule = db.prepare('SELECT * FROM technician_schedules WHERE technician_id = ? AND date = ?').get(input.technicianId, input.date)
    if (schedule && !schedule.is_working && !opts.adminDirect) throw apiError(400, 'BAD_REQUEST', '该技师这天休息。')

    /* 零回落(图 v1.0 合同三):未设置不许编时段。老板直排(adminDirect)本就跳过边界校验,
       普通预约走到这里必有真实营业行(closedThatDay 已拦) —— 万一没有,按休息拒,不编数。 */
    const baseOpen = (special && !special.is_closed && special.open_time) || hours?.open_time || null
    const baseClose = (special && !special.is_closed && special.close_time) || hours?.close_time || null
    const openTime = schedule?.start_time || baseOpen
    const closeTime = schedule?.end_time || baseClose
    if (!opts.adminDirect && (!openTime || !closeTime)) throw apiError(400, 'BAD_REQUEST', '该日期门店休息。')
    // 老板直接排单可覆盖时长(这次多做/少做);普通预约按服务标准时长
    const durationMin = ((opts.adminDirect || opts.preserveDuration) && input.durationMin) ? input.durationMin : totalDuration(service.type, service.base_duration_min, input.addOns)
    const startMinutes = minutesFromTime(input.time)
    const endMinutes = startMinutes + durationMin
    if (!opts.adminDirect && (startMinutes < minutesFromTime(openTime) || endMinutes > minutesFromTime(closeTime))) {
      throw apiError(400, 'BAD_REQUEST', 'Requested time is outside available working hours.')
    }

    const start = localDateTime(input.date, input.time)
    return { service, technician, durationMin, start, end: addMinutes(start, durationMin) }
  }

  function slotTakenError(input, opts = {}, durationMin = 0) {
    const nowD = localParts(new Date())
    if (!opts.backfill && `${input.date} ${input.time}` < `${nowD.date} ${nowD.time}`) {
      return apiError(409, 'SLOT_UNAVAILABLE', `这个时段已经过去了(门店现在 ${nowD.time}),选一个之后的时段。`)
    }
    if (opts.backfill) {
      return apiError(409, 'SLOT_UNAVAILABLE', `该技师那个时段已经有单了(这一单需 ${durationMin} 分钟)。核对一下当时的实际时间,或换一位技师。`)
    }
    if (opts.adminDirect) {
      return apiError(409, 'SLOT_UNAVAILABLE', `该技师这个时段和已有预约重叠(所选服务需 ${durationMin} 分钟),换个时间或换个更短的项目试试。`)
    }
    return apiError(409, 'SLOT_JUST_TAKEN', '这个时段刚被约走了,换一个时间好吗?')
  }

  return { assertBookable, slotTakenError }
}
