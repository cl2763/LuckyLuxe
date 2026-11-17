/* 可约时段计算(《代码结构公约》② 边改边拆:③ 预约采集动的就是这个领域,顺手搬出来)

   ⚠️ 这是 `/availability` 与 ③ 预约采集**共用的同一个函数** —— 不许并排再写一份。
   AI 回复里出现的每一个时段都必须来自这里的返回集合(图 §三 事实槽那一行)。 */

import {dateValue} from './schedule-input.mjs'
import {bookingWindow,acceptanceForDate} from './booking-window.mjs'
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
    dateValue(date,apiError)
    const service = getService(serviceId)
    if (!service || !service.is_active) throw apiError(404, 'NOT_FOUND', 'Service not found.')
    const weekday = new Date(date + 'T12:00:00Z').getUTCDay()
    const hours = db.prepare('SELECT * FROM business_hours WHERE store_id = ? AND weekday = ?').get(storeId, weekday)
    const extraDurationMin = Math.max(0, Number(query.extraDurationMin || 0))
    const durationMin = totalDuration(service.type, service.base_duration_min, [{ durationMin: extraDurationMin }])
    // 特殊日期优先于每周固定模式
    const special = specialDateFor(storeId, date)
    const closedThatDay = special ? Boolean(special.is_closed) : (!hours || Boolean(hours.is_closed))
    /* 🔴 「店休」和「约满」是两件事,不许说同一句话(D88 一句一因同族)。
       原来两种情况都回 `slots: []`,调用方分不出来,于是 ③ 把店休日答成「这天已经约满了」——
       对顾客说了不实的话。这里如实带上 `closed`,由调用方说对应的那句。 */
    if (closedThatDay) return { date, durationMin, slots: [], closed: true,reason:!special&&!hours?'HOURS_UNSET':'STORE_CLOSED' }
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
    const acceptance=acceptanceForDate(db,storeId,date,Boolean(special),service.tenant_id)
    const result = []
    for (const tech of techRows) {
      const schedule = db.prepare('SELECT * FROM technician_schedules WHERE technician_id = ? AND date = ?').get(tech.id, date)
      if (schedule && !schedule.is_working) continue
      const window=bookingWindow({dayOpen,dayClose,schedule,...acceptance,durationMin})
      if(!window)continue
      const occupied = db.prepare('SELECT b.appointment_start,b.appointment_end FROM bookings b WHERE b.technician_id=? AND EXISTS (SELECT 1 FROM booking_slots bs WHERE bs.booking_id=b.id)').all(tech.id)
      const slots = [],slotDetails=[]
      /* D88 同族:今天已过去的时刻不再可约(以前晚上查今天照样列出上午 —— 编出根本约不上的位) */
      const nowA = localParts(new Date())
      const pastMin = date === nowA.date ? minutesFromTime(nowA.time) : -1
      for (let startMin = window.startMin; startMin <= window.lastStartMin; startMin += SLOT_MINUTES) {
        if (date < nowA.date || startMin < pastMin) continue
        const time = timeFromMinutes(startMin)
        const localStart=localDateTime(date,time);const normalized=localParts(localStart);if(normalized.date!==date||normalized.time!==time)continue
        const start=iso(localStart),end=iso(addMinutes(localStart,durationMin)),finish=localParts(end)
        if (!occupied.some(b=>b.appointment_start<end && b.appointment_end>start)){slots.push(time);slotDetails.push({time,endTime:finish.time,endDate:finish.date,endLabel:(finish.date>date?(Math.round((Date.parse(finish.date)-Date.parse(date))/86400000)===1?'次日 ':finish.date+' '):'')+finish.time})}
      }
      result.push({ technician: tech, slots,slotDetails,window:{startTime:timeFromMinutes(window.startMin),latestStartTime:window.lastStartMin>=window.startMin?timeFromMinutes(window.lastStartMin):null,acceptUntil:timeFromMinutes(window.endMin)} })
    }
    return { date, durationMin,dayOpen,dayClose, slots: result, closed: false,bookingMode:acceptance.mode,latestStartTime:acceptance.latestStartTime||dayClose,reason:!techRows.length?'NO_TECHNICIAN':!result.length?'TECHNICIAN_OFF':!result.some(r=>r.slots.length)?'NO_AVAILABLE_SLOT':null }
  }

  return { getAvailability }
}
