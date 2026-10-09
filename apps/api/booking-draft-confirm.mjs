import { createHash } from 'node:crypto'
export const draftScene = id => 'd' + createHash('sha256').update(String(id)).digest('hex').slice(0,24)
export function draftForScene(db, scene) {
  if (!/^d[0-9a-f]{24}$/.test(scene)) return null
  return db.prepare("SELECT id,tenant_id,status,expires_at FROM booking_drafts WHERE status IN ('DRAFT','BOOKING_CREATED')").all().find(r=>draftScene(r.id)===scene) || null
}
// The ordinary booking engine is the only writer. This gate prevents draft reuse
// and edits to a shared draft from silently creating a different appointment.
export function guardDraftBooking({db, input, apiError, serializeBooking}) {
  if (!input.bookingDraftId) return null
  const d=db.prepare('SELECT * FROM booking_drafts WHERE id=? AND tenant_id=?').get(input.bookingDraftId,input.tenantId)
  if (!d) throw apiError(404,'DRAFT_NOT_FOUND','找不到本店的预约草稿。')
  if (d.user_id && d.user_id!==input.userId) throw apiError(403,'DRAFT_CUSTOMER_MISMATCH','这份草稿属于另一位顾客，请联系店员。')
  if (d.status==='BOOKING_CREATED') {
    const b=db.prepare('SELECT * FROM bookings WHERE id=? AND tenant_id=?').get(d.booking_id,input.tenantId)
    if (!b || b.user_id!==input.userId) throw apiError(409,'DRAFT_ALREADY_CONFIRMED','这份草稿已由其他顾客确认，请让店员重新生成。')
    return serializeBooking(b)
  }
  if (d.status!=='DRAFT'||!Number.isFinite(Date.parse(d.expires_at))||Date.parse(d.expires_at)<=Date.now()) throw apiError(410,'DRAFT_EXPIRED','预约草稿已过期，请让店员重新生成。')
  if (d.store_id!==input.storeId||d.service_id!==input.serviceId||d.technician_id!==input.technicianId||d.date!==input.date||d.time!==input.time||JSON.stringify(JSON.parse(d.addons_json||'[]'))!==JSON.stringify(input.addOns||[])) throw apiError(409,'DRAFT_CHANGED','预约内容与草稿不一致，请重新打开草稿确认。')
  return null
}
export function validateManualDraft(body,admin,{db,apiError,currentTenantId}) {
  if (body.sourceChannel!=='admin_manual') return body
  const tid=currentTenantId(), out={sourceChannel:'admin_manual',serviceId:String(body.serviceId||''),storeId:String(body.storeId||''),technicianId:String(body.technicianId||''),date:String(body.date||''),time:String(body.time||''),notes:String(body.notes||'').trim()}
  if(!/^\d{4}-\d{2}-\d{2}$/.test(out.date)||!/^\d{2}:\d{2}$/.test(out.time)||out.notes.length>1000)throw apiError(400,'BAD_MANUAL_DRAFT','请填写日期、时间，备注不超过 1000 字。')
  if(admin.role==='staff') {
    if(out.technicianId&&out.technicianId!==admin.technicianId)throw apiError(403,'STAFF_DRAFT_FORBIDDEN','技师只能为自己生成预约草稿。')
    out.technicianId=admin.technicianId
  }
  for(const [table,id]of [['services',out.serviceId],['stores',out.storeId],['technicians',out.technicianId]]) {
    if(!id||!db.prepare(`SELECT id FROM ${table} WHERE id=? AND tenant_id=? AND is_active=1`).get(id,tid))throw apiError(400,'BAD_DRAFT_SELECTION','请选择本店有效的门店、服务和技师。')
  }
  return out
}
