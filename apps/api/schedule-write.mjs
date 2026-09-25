import { isTime, dateValue as checkedDate } from './schedule-input.mjs'
/* Shared write boundary for single/batch shifts and employee requests. No financial writes. */
export function createScheduleWrite({ db, currentTenantId, defaultStoreId, specialDateFor, tenantTimezone, localParts, readBody, json, apiError, randomId, actorOf }) {
  const dateValue=v=>checkedDate(v,apiError)
  const now = () => new Date().toISOString()
  const splitOf = tid => { const r=db.prepare("SELECT value FROM tenant_settings WHERE tenant_id=? AND key='afternoon_start'").get(tid); const v=String(r?.value||'').replace(/"/g,''); return isTime(v)?v:'14:30' }
  function hours(date, tid) {
    const store=db.prepare('SELECT id FROM stores WHERE tenant_id=? AND is_active=1 LIMIT 1').get(tid)?.id || defaultStoreId()
    const special=specialDateFor(store,date)
    const row=special || db.prepare('SELECT * FROM business_hours WHERE store_id=? AND weekday=?').get(store,new Date(`${date}T12:00:00Z`).getUTCDay())
    return { isClosed: !row || !!row.is_closed, openTime: row&&!row.is_closed?row.open_time:null, closeTime: row&&!row.is_closed?row.close_time:null }
  }
  function resolve(input,date,tid) {
    dateValue(date)
    if (input.shift !== undefined && !['full','am','pm','custom','off'].includes(input.shift)) throw apiError(400,'BAD_REQUEST','未知排班类型。')
    if (input.isWorking !== undefined && typeof input.isWorking !== 'boolean') throw apiError(400,'BAD_REQUEST','isWorking 必须为布尔值。')
    const h=hours(date,tid), split=splitOf(tid), shift=input.shift
    const off=shift==='off'||(!shift&&input.isWorking===false)
    // Inactive ranges are storage-only. Midnight placeholders never advertise working hours.
    if(off)return {shift:'off',startTime:isTime(input.startTime)?input.startTime:h.openTime||'00:00',endTime:isTime(input.endTime)?input.endTime:h.closeTime||'00:00',isWorking:false}
    if(['full','am','pm'].includes(shift)&&(!isTime(h.openTime)||!isTime(h.closeTime)||h.openTime>=h.closeTime)) throw apiError(400,'HOURS_UNSET',`${date} 没有可用营业时段。请选择休息，或明确填写自定义排班。`)
    if(['am','pm'].includes(shift)&&!(h.openTime<split&&split<h.closeTime)) throw apiError(400,'SPLIT_OUTSIDE_HOURS',`${date} 分界 ${split} 必须在营业时间 ${h.openTime}–${h.closeTime} 内。`)
    const startTime=shift==='full'||shift==='am'?h.openTime:shift==='pm'?split:input.startTime??h.openTime
    const endTime=shift==='full'||shift==='pm'?h.closeTime:shift==='am'?split:input.endTime??h.closeTime
    if(!isTime(startTime)||!isTime(endTime)||startTime>=endTime)throw apiError(400,'BAD_REQUEST','排班起止必须是有效时间，且结束晚于开始。')
    return {shift:shift||'custom',startTime,endTime,isWorking:true}
  }
  function warningsFor(date,r,tid) { const h=hours(date,tid); if(!r.isWorking)return []; if(h.isClosed)return [{date,message:'当天店休，排班不会自动开放顾客预约。请核对营业设置。'}]; if(r.startTime<h.openTime||r.endTime>h.closeTime)return [{date,message:`排班超出营业时间 ${h.openTime}–${h.closeTime}，顾客预约仍受营业时间限制。`}];return [] }
  function conflictsFor(tech,date,r,tid) {
    const tz=tenantTimezone(tid)
    return db.prepare("SELECT id,public_code,appointment_start,appointment_end,user_id,service_id FROM bookings WHERE tenant_id=? AND technician_id=? AND status IN ('PENDING_PAYMENT','CONFIRMED','IN_PROGRESS')").all(tid,tech).filter(b=>{
      const start=localParts(b.appointment_start,tz), end=localParts(b.appointment_end,tz)
      return start.date===date&&(!r.isWorking||start.time<r.startTime||end.time>r.endTime||end.date!==date)
    }).map(b=>({date,technicianId:tech,bookingId:b.id,code:b.public_code,startTime:localParts(b.appointment_start,tz).time,endTime:localParts(b.appointment_end,tz).time,customerName:db.prepare('SELECT display_name FROM users WHERE id=? AND tenant_id=?').get(b.user_id,tid)?.display_name||'散客',serviceName:db.prepare('SELECT name_zh FROM services WHERE id=? AND tenant_id=?').get(b.service_id,tid)?.name_zh||'服务'}))
  }
  const put=db.prepare('INSERT INTO technician_schedules (technician_id,date,start_time,end_time,is_working) VALUES (?,?,?,?,?) ON CONFLICT(technician_id,date) DO UPDATE SET start_time=excluded.start_time,end_time=excluded.end_time,is_working=excluded.is_working')
  function transaction(fn) {db.exec('BEGIN IMMEDIATE');try{const out=fn();db.exec('COMMIT');return out}catch(e){db.exec('ROLLBACK');throw e}}
  function techExists(id,tid) { if(!db.prepare('SELECT id FROM technicians WHERE id=? AND tenant_id=?').get(id,tid))throw apiError(404,'NOT_FOUND','找不到本店技师。') }
  function apply(entries,tid) {return transaction(()=>{const conflicts=[],warnings=[]; for(const a of entries){conflicts.push(...conflictsFor(a.tech,a.date,a,tid));warnings.push(...warningsFor(a.date,a,tid));put.run(a.tech,a.date,a.startTime,a.endTime,a.isWorking?1:0)}return {conflicts,warnings}})}
  async function route(req,res,{path,adminSession}) {
    const single=path.match(/^\/admin\/technicians\/([^/]+)\/schedule$/), resolution=path.match(/^\/admin\/schedule-requests\/([^/]+)\/(set-off|handled|reject)$/)
    if(!(single&&req.method==='PATCH')&&path!=='/admin/schedule-settings'&&path!=='/admin/schedule-batch'&&path!=='/admin/schedule-requests'&&!(resolution&&req.method==='POST'))return false
    const tid=currentTenantId(), owner=()=>{if(adminSession.role!=='owner')throw apiError(403,'FORBIDDEN','Owner permission is required.')}
    const send=(status,data)=>{json(res,status,data);return true}
    if(single&&req.method==='PATCH') {
      owner();const tech=single[1];techExists(tech,tid);const body=await readBody(req);dateValue(body.date)
      const weeks=body.applyToFollowingWeeks===undefined?0:Number(body.applyToFollowingWeeks)
      if(!Number.isInteger(weeks)||weeks<0||weeks>26)throw apiError(400,'BAD_REQUEST','重复周数必须为 0–26 的整数。')
      const entries=[];for(let i=0;i<=weeks;i++){const d=new Date(`${body.date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+i*7);const date=d.toISOString().slice(0,10);entries.push({date,tech,...resolve(body,date,tid)})}
      const out=apply(entries,tid)
      return send(200,{schedule:db.prepare('SELECT * FROM technician_schedules WHERE technician_id=? AND date=?').get(tech,body.date),shift:entries[0].shift,appliedDates:entries.map(a=>a.date),...out})
    }
    if(path==='/admin/schedule-settings') {
      if(req.method==='GET')return send(200,{afternoonStart:splitOf(tid)})
      if(req.method==='PUT'){owner();const body=await readBody(req);if(!isTime(body.afternoonStart))throw apiError(400,'BAD_REQUEST','上下午分界格式应为有效 HH:MM。');db.prepare("INSERT INTO tenant_settings(tenant_id,key,value,updated_at) VALUES (?,'afternoon_start',?,?) ON CONFLICT(tenant_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(tid,body.afternoonStart,now());return send(200,{afternoonStart:body.afternoonStart})}
    }
    if(path==='/admin/schedule-batch'&&req.method==='POST') {
      owner();const body=await readBody(req)
      if(!Array.isArray(body.entries)||!body.entries.length||body.entries.length>400)throw apiError(400,'BAD_REQUEST','一次需要 1–400 条排班。')
      const entries=body.entries.map(e=>{techExists(e.technicianId,tid);return {tech:e.technicianId,date:dateValue(e.date),...resolve(e,e.date,tid)}})
      return send(200,{applied:entries.length,...apply(entries,tid)})
    }
    if(path==='/admin/schedule-requests') {
      if(req.method==='POST') {
        const body=await readBody(req);dateValue(body.date)
        if(adminSession.role==='staff'&&body.technicianId&&body.technicianId!==adminSession.technicianId)throw apiError(403,'FORBIDDEN','只能为自己发起排班申请。')
        const tech=adminSession.role==='staff'?adminSession.technicianId:String(body.technicianId||'');techExists(tech,tid)
        const note=String(body.note||'').trim();if(note.length>300)throw apiError(400,'BAD_REQUEST','申请留言最多 300 字。')
        const id=transaction(()=>{if(db.prepare("SELECT id FROM schedule_change_requests WHERE technician_id=? AND date=? AND status='pending'").get(tech,body.date))throw apiError(409,'DUPLICATE','该日期已有待处理的申请。');const id=randomId('schreq');db.prepare('INSERT INTO schedule_change_requests(id,technician_id,date,note,status,created_at) VALUES (?,?,?,?,?,?)').run(id,tech,body.date,note,'pending',now());return id})
        return send(201,{request:db.prepare('SELECT * FROM schedule_change_requests WHERE id=?').get(id)})
      }
      if(req.method==='GET') {
        const rows=adminSession.role==='staff'?db.prepare('SELECT r.*,t.name AS tech_name FROM schedule_change_requests r JOIN technicians t ON t.id=r.technician_id AND t.tenant_id=? WHERE r.technician_id=? ORDER BY r.created_at DESC LIMIT 40').all(tid,adminSession.technicianId):db.prepare("SELECT r.*,t.name AS tech_name FROM schedule_change_requests r JOIN technicians t ON t.id=r.technician_id AND t.tenant_id=? ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END,r.created_at DESC LIMIT 60").all(tid)
        return send(200,{requests:rows.map(r=>({id:r.id,technicianId:r.technician_id,technicianName:r.tech_name,date:r.date,note:r.note||'',status:r.status,resolution:r.resolution||'',createdAt:r.created_at,resolvedAt:r.resolved_at}))})
      }
    }
    if(resolution&&req.method==='POST') {
      owner();const id=resolution[1],action=resolution[2]
      const out=transaction(()=>{const row=db.prepare('SELECT r.* FROM schedule_change_requests r JOIN technicians t ON t.id=r.technician_id AND t.tenant_id=? WHERE r.id=?').get(tid,id);if(!row)throw apiError(404,'NOT_FOUND','Request not found.');if(row.status!=='pending')throw apiError(400,'ALREADY_RESOLVED','该申请已处理过。');dateValue(row.date);let conflicts=[];if(action==='set-off'){const resolved=resolve({shift:'off'},row.date,tid);conflicts=conflictsFor(row.technician_id,row.date,resolved,tid);put.run(row.technician_id,row.date,resolved.startTime,resolved.endTime,0)}db.prepare('UPDATE schedule_change_requests SET status=?,resolution=?,resolved_at=?,resolved_by=? WHERE id=?').run(action==='reject'?'rejected':'approved',action,now(),actorOf(adminSession),id);return {request:db.prepare('SELECT * FROM schedule_change_requests WHERE id=?').get(id),conflicts}})
      return send(200,out)
    }
    return false
  }
  return {route}
}
