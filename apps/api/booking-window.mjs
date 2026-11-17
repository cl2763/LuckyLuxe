// Shared by availability, final booking validation and management views.
const mins=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5))
const clock=/^([01]\d|2[0-3]):[0-5]\d$/
export function bookingWindow({dayOpen,dayClose,schedule,mode='finish_by_close',latestStartTime=null,durationMin}) {
  if(!dayOpen||!dayClose||schedule&&!schedule.is_working)return null
  const start=Math.max(mins(dayOpen),mins(schedule?.start_time||dayOpen))
  const dayEnd=mode==='latest_start'?(latestStartTime||dayClose):dayClose
  const end=Math.min(mins(dayEnd),mins(schedule?.end_time||dayEnd))
  return {startMin:start,lastStartMin:mode==='latest_start'?end:end-durationMin,endMin:end,mode}
}
export function readBookingAcceptance(db,storeId,tenantId) {
  assertStoreScope(db,storeId,tenantId)
  const row=db.prepare("SELECT value FROM tenant_settings WHERE key=? AND tenant_id=?").get('booking_acceptance:'+storeId,tenantId)
  const value=row?JSON.parse(row.value):{}
  return {mode:value.mode==='latest_start'?'latest_start':'finish_by_close',weekly:value.weekly||{},special:value.special||{}}
}
export function acceptanceForDate(db,storeId,date,hasSpecial=false,tenantId) {
  const config=readBookingAcceptance(db,storeId,tenantId)
  const weekday=new Date(date+'T12:00:00Z').getUTCDay()
  return {mode:config.mode,latestStartTime:(hasSpecial?config.special[date]:config.weekly[weekday])||null}
}
export function validateAcceptance(value,hours,specials,apiError) {
  const fail=m=>{throw apiError(400,'INVALID_BOOKING_WINDOW',m)}
  if(!value||!['finish_by_close','latest_start'].includes(value.mode))fail('请选择营业结束前完成或最晚开始模式。')
  for(const [kind,map]of [['weekly',value.weekly||{}],['special',value.special||{}]]){
    if(!map||typeof map!=='object'||Array.isArray(map))fail('接客截止配置格式不正确。')
    if(Object.keys(map).length>366)fail('接客截止配置过多。')
    for(const [key,time]of Object.entries(map)){
      if(kind==='weekly'&&!/^[0-6]$/.test(key)||kind==='special'&&!/^\d{4}-\d{2}-\d{2}$/.test(key))fail('接客截止日期不正确。')
      if(time===null||time==='')continue
      if(!clock.test(time))fail('最晚开始时间须为HH:MM。')
      const h=kind==='weekly'?hours.find(h=>Number(h.weekday)===Number(key)):specials.find(h=>h.date===key)
      if(!h)fail('请先设置该日营业时间，再设置最晚开始时间。')
      if(!(h.isClosed??h.is_closed)&&time<(h.openTime||h.open_time))fail('最晚开始时间不能早于营业开始。')
    }
  }
  return {mode:value.mode,weekly:value.weekly||{},special:value.special||{}}
}
export function writeAcceptance(db,storeId,value,now,tenantId) {
  assertStoreScope(db,storeId,tenantId)
  db.prepare('INSERT INTO tenant_settings(tenant_id,key,value,updated_at) VALUES(?,?,?,?) ON CONFLICT(tenant_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(tenantId,'booking_acceptance:'+storeId,JSON.stringify(value),now)
}

function assertStoreScope(db,storeId,tenantId){
 if(!tenantId||!db.prepare('SELECT id FROM stores WHERE id=? AND tenant_id=?').get(storeId,tenantId))throw Object.assign(new Error('Store not found in this tenant.'),{status:404,code:'NOT_FOUND'})
}
