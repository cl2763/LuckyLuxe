// One source for web and mini-program empty slots. No financial state is changed.
export function availability({active,schedule,openTime,closeTime,isClosed,date,today,now,bookings=[]}) {
  const working=!!active&&!isClosed&&!!openTime&&!!closeTime&&(!schedule||!!schedule.is_working)
  if(!working)return {isWorking:false,freeSlots:[]}
  const start=schedule&&schedule.start_time>openTime?schedule.start_time:openTime
  const end=schedule&&schedule.end_time<closeTime?schedule.end_time:closeTime
  let cursor=date===today&&now>start?now:start
  const mins=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5))
  const freeSlots=[]
  const add=(a,b)=>{if(a<b&&mins(b)-mins(a)>=30)freeSlots.push({startTime:a,endTime:b})}
  for(const b of [...bookings].sort((a,b)=>a.startTime.localeCompare(b.startTime))){
    if(b.endTime<=cursor||b.startTime>=end)continue
    add(cursor,b.startTime<end?b.startTime:end)
    if(b.endTime>cursor)cursor=b.endTime
  }
  add(cursor,end)
  return {isWorking:start<end,startTime:start,endTime:end,freeSlots}
}
