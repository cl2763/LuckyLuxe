// Merchant acknowledgement is separate from payment, arrival and immutable settlement history.
export function ensureBookingAcceptanceSchema(db){db.exec(`CREATE TABLE IF NOT EXISTS booking_acceptances(tenant_id TEXT NOT NULL,booking_id TEXT NOT NULL,confirmed_at TEXT NOT NULL,account_id TEXT NOT NULL,PRIMARY KEY(tenant_id,booking_id))`)}
export function createBookingAcceptance({db,apiError,json,localParts,tenantTimezone,onConfirmed}) {
 function ensureSchema(){ensureBookingAcceptanceSchema(db)}
 function requireOwner(admin){if(admin?.role!=='owner')throw apiError(403,'FORBIDDEN','仅店主可确认预约。')}
 function list(tid,admin){
  requireOwner(admin)
  const rows=db.prepare(`SELECT b.id,b.appointment_start,u.display_name,s.name_zh FROM bookings b LEFT JOIN users u ON u.id=b.user_id AND u.tenant_id=b.tenant_id LEFT JOIN services s ON s.id=b.service_id AND s.tenant_id=b.tenant_id WHERE b.tenant_id=? AND b.status IN ('CONFIRMED','PENDING_PAYMENT') AND b.appointment_start>? AND b.arrived_at IS NULL AND NOT EXISTS(SELECT 1 FROM booking_acceptances a WHERE a.tenant_id=b.tenant_id AND a.booking_id=b.id) ORDER BY b.appointment_start,b.id LIMIT 100`).all(tid,new Date().toISOString())
  return {items:rows.map(r=>{const p=localParts(r.appointment_start,tenantTimezone(tid));return {id:r.id,customer:r.display_name||'顾客',service:r.name_zh||'预约服务',timeText:p.date+' '+p.time,action:{key:'confirmBooking',label:'确认预约'}}}),hint:'待接单预约（最多显示100条）；确认预约不代表到店或已收款。'}
 }
 function confirm(tid,admin,id){
  requireOwner(admin)
  db.exec('SAVEPOINT accept_booking')
  try{
   const b=db.prepare('SELECT * FROM bookings WHERE tenant_id=? AND id=?').get(tid,id)
   if(!b)throw apiError(404,'NOT_FOUND','预约不存在。')
   if(!['CONFIRMED','PENDING_PAYMENT'].includes(b.status)||b.arrived_at||b.appointment_start<=new Date().toISOString())throw apiError(409,'ILLEGAL_TRANSITION','只可确认尚未到店且未结束的未来预约。')
   const now=new Date().toISOString(),result=db.prepare('INSERT OR IGNORE INTO booking_acceptances VALUES(?,?,?,?)').run(tid,id,now,admin.accountId||admin.email||'owner')
   if(result.changes)onConfirmed(tid,b,now)
   db.exec('RELEASE accept_booking');return {ok:true,replayed:!result.changes}
  }catch(e){db.exec('ROLLBACK TO accept_booking; RELEASE accept_booking');throw e}
 }
 async function route(req,res,{path,tid,admin}){
  if(path === '/admin/booking-acceptances'&&req.method==='GET'){json(res,200,list(tid,admin));return true}
  const match=path.match(/^\/admin\/bookings\/([^/]+)\/accept$/)
  if(match&&req.method==='POST'){json(res,200,confirm(tid,admin,decodeURIComponent(match[1])));return true}
  return false
 }
 return {ensureSchema,list,confirm,route}
}
