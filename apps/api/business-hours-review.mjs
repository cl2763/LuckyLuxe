import {bookingWindow,readBookingAcceptance,validateAcceptance} from './booking-window.mjs'
import {validateBusinessHours,businessHoursRevision} from './business-hours-write.mjs'
// Read-only impact review. It deliberately never edits saved shifts or bookings.
export function reviewBusinessHours({db,apiError,localParts,tenantTimezone},tid,storeId,body){
 const store=db.prepare('SELECT id FROM stores WHERE id=? AND tenant_id=?').get(storeId,tid)
 if(!store)throw apiError(404,'NOT_FOUND','Store not found.')
 if(body.expectedConfigRevision!==undefined&&body.expectedConfigRevision!==businessHoursRevision(db,storeId,tid))throw apiError(409,'CONFIG_CHANGED','营业规则已在其他设备修改，当前输入已保留；请先重新核对。')
 validateBusinessHours(body.hours,apiError)
 const current=db.prepare('SELECT * FROM business_hours WHERE store_id=?').all(storeId)
 const merged=current.filter(h=>!body.hours.some(x=>Number(x.weekday)===h.weekday)).concat(body.hours.map(h=>({weekday:Number(h.weekday),is_closed:h.isClosed?1:0,open_time:h.openTime,close_time:h.closeTime})))
 const specials=db.prepare('SELECT * FROM store_special_dates WHERE store_id=?').all(storeId)
 const acceptance=validateAcceptance(body.bookingAcceptance??readBookingAcceptance(db,storeId,tid),merged,specials,apiError),tz=tenantTimezone(tid),today=localParts(new Date(),tz).date
 const day=date=>{const special=specials.find(s=>s.date===date),weekday=new Date(date+'T12:00:00Z').getUTCDay(),h=special||merged.find(h=>h.weekday===weekday);return {dayOpen:h&&!h.is_closed?h.open_time:null,dayClose:h&&!h.is_closed?h.close_time:null,mode:acceptance.mode,latestStartTime:(special?acceptance.special[date]:acceptance.weekly[weekday])||null}}
 const shifts=db.prepare('SELECT s.*,t.name FROM technician_schedules s JOIN technicians t ON t.id=s.technician_id WHERE t.store_id=? AND t.tenant_id=? AND s.date>=? ORDER BY s.date,t.name').all(storeId,tid,today)
 const earlierShifts=shifts.filter(s=>{const h=day(s.date);return s.is_working&&h.dayClose&&s.end_time<(h.mode==='latest_start'?(h.latestStartTime||h.dayClose):h.dayClose)}).map(s=>({date:s.date,technicianId:s.technician_id,name:s.name,startTime:s.start_time,endTime:s.end_time}))
 const rows=db.prepare("SELECT b.id,b.public_code,b.technician_id,b.appointment_start,b.appointment_end,t.name FROM bookings b LEFT JOIN technicians t ON t.id=b.technician_id WHERE b.tenant_id=? AND b.store_id=? AND b.appointment_end>? AND b.status IN ('PENDING_PAYMENT','CONFIRMED','IN_PROGRESS') ORDER BY b.appointment_start").all(tid,storeId,new Date().toISOString())
 const bookings=[]
 for(const b of rows){const start=localParts(b.appointment_start,tz),end=localParts(b.appointment_end,tz),schedule=shifts.find(s=>s.date===start.date&&s.technician_id===b.technician_id),window=bookingWindow({...day(start.date),schedule,durationMin:(Date.parse(b.appointment_end)-Date.parse(b.appointment_start))/60000}),minute=Number(start.time.slice(0,2))*60+Number(start.time.slice(3));if(!window||minute<window.startMin||minute>window.lastStartMin)bookings.push({id:b.id,code:b.public_code,date:start.date,startTime:start.time,endDate:end.date,endTime:end.time,name:b.name})}
 return {configRevision:businessHoursRevision(db,storeId,tid),timezone:tz,mode:acceptance.mode,earlierShifts,bookings,savedShiftCount:shifts.length,note:'默认班次跟随新规则；已保存班次、已有预约及其占位完整保留，不会自动改班、取消或移动预约。'}
}
