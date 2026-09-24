// 原预约改时段：占位、时间和历史在同一事务内提交；不重新计价，不伪造收退款。
export function rescheduleUseCount(db, booking) {
  const carried = db.prepare('SELECT MAX(times_used) n FROM deposit_retains WHERE tenant_id=? AND (source_booking_id=? OR consumed_booking_id=?)').get(booking.tenant_id, booking.id, booking.id)?.n || 0
  const moved = db.prepare("SELECT COUNT(*) n FROM booking_status_history WHERE booking_id=? AND note LIKE '[改期保留定金] %'").get(booking.id).n
  return carried + moved
}
export function moveBooking({db, booking, body, apiError, validateBookingInput, assertBookable, buildSlotStarts, iso, randomId, localParts, getDepositConfig, activeDepositReceipts, actor}) {
  const input = validateBookingInput({ tenantId:booking.tenant_id, userId:booking.user_id, storeId:booking.store_id, serviceId:booking.service_id, technicianId:booking.technician_id, date:body.date, time:body.time, addOns:JSON.parse(booking.addons_json || '[]') })
  // 时长属于已约定的订单，不能因价目更新而改变；预约校验仍检查营业与排班。
  input.durationMin = booking.total_duration_min
  const {start,end,durationMin} = assertBookable(input, {preserveDuration:true})
  if (localParts(start).date!==body.date || localParts(start).time!==body.time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time)) throw apiError(400,'INVALID_DATE','请选择有效的门店日期和时间。')
  const startIso=iso(start),endIso=iso(end)
  if(start.getTime()<=Date.now())throw apiError(400,'PAST_SLOT','不能改到已经过去的时段。')
  if(startIso===booking.appointment_start)return {unchanged:true}
  if(body.expectedStart && body.expectedStart!==booking.appointment_start)throw apiError(409,'BOOKING_CHANGED','预约已被其他人修改，请刷新后重试。')
  if(db.prepare("SELECT 1 FROM settlements WHERE tenant_id=? AND booking_id=? AND status<>'voided' LIMIT 1").get(booking.tenant_id,booking.id))throw apiError(409,'SETTLEMENT_EXISTS','此预约已有结算单，请先撤回未签单，再修改预约时间。')
  const receipts=activeDepositReceipts(booking.id,booking.tenant_id).filter(r=>!r.settled_settlement_id)
  const paid=receipts.reduce((n,r)=>n+r.amount_cents,0)
  if(paid!==booking.deposit_cents)throw apiError(409,'DEPOSIT_NEEDS_RECONCILIATION','预约定金与收取记录不一致，请先核对定金记录。')
  const cp=getDepositConfig(booking.tenant_id).cancelPolicy,count=rescheduleUseCount(db,booking)
  const compliant=cp.rescheduleNoticeHours===null || (new Date(booking.appointment_start)-Date.now())/3600000>=cp.rescheduleNoticeHours
  if(paid>0&&(!compliant||count>=(cp.depositRetainTimes||0)))throw apiError(409,'DEPOSIT_POLICY_REQUIRED','本次不符合原定金保留规则，请先与顾客确认取消及定金处理，再重新预约；原预约尚未改变。')
  const now=iso(new Date()),prefix=paid>0?'[改期保留定金] ':'[预约改期] '
  db.exec('BEGIN IMMEDIATE')
  try{
    const overlap=db.prepare(`SELECT b.id FROM bookings b WHERE b.technician_id=? AND b.id<>? AND b.appointment_start<? AND b.appointment_end>? AND EXISTS (SELECT 1 FROM booking_slots s WHERE s.booking_id=b.id) LIMIT 1`).get(booking.technician_id,booking.id,endIso,startIso)
    if(overlap)throw apiError(409,'SLOT_UNAVAILABLE','该技师在所选时段已有预约，请选择其他时间；原预约未变。')
    db.prepare('DELETE FROM booking_slots WHERE booking_id=?').run(booking.id)
    const insert=db.prepare('INSERT INTO booking_slots (id,booking_id,technician_id,starts_at) VALUES (?,?,?,?)')
    for(const slot of buildSlotStarts(start,durationMin))insert.run(randomId('slot'),booking.id,booking.technician_id,iso(slot))
    db.prepare('UPDATE bookings SET appointment_start=?,appointment_end=?,updated_at=? WHERE id=?').run(startIso,endIso,now,booking.id)
    const prior=localParts(booking.appointment_start)
    db.prepare('INSERT INTO booking_status_history (id,booking_id,from_status,to_status,note,created_at) VALUES (?,?,?,?,?,?)').run(randomId('hist'),booking.id,booking.status,booking.status,`${prefix}${prior.date} ${prior.time} → ${body.date} ${body.time}；经手人：${actor}；${String(body.reason||'').trim().slice(0,300)}`,now)
    db.exec('COMMIT')
  }catch(e){db.exec('ROLLBACK');throw e}
  return {unchanged:false,depositRetained:paid>0,retainTimesUsed:count+(paid>0?1:0),note:'预约已改期；服务、技师、价格及收取记录保持原约定。'}
}
