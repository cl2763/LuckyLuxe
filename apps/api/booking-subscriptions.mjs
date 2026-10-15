import {randomUUID} from 'node:crypto'
import {SUBSCRIBE_TEMPLATES,subscriptionPayload} from './wechat-subscribe.mjs'
// Separate durable outbox: existing in-app delivery and its immutable history remain unchanged.
export function createBookingSubscriptions({db,apiError,json,readBody,requireCustomer,resolveTenant,localParts,tenantTimezone,send,enabled=false}) {
 let busy=false
 function ensureSchema(){db.exec(`
 CREATE TABLE IF NOT EXISTS booking_subscription_requests(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,booking_id TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,completed_at TEXT);
 CREATE TABLE IF NOT EXISTS booking_subscription_grants(id TEXT PRIMARY KEY,request_id TEXT NOT NULL,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,booking_id TEXT NOT NULL,kind TEXT NOT NULL,created_at TEXT NOT NULL,used_at TEXT,UNIQUE(request_id,kind));
 CREATE TABLE IF NOT EXISTS booking_subscription_events(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,booking_id TEXT NOT NULL,type TEXT NOT NULL,status TEXT NOT NULL,scheduled_at TEXT NOT NULL,dedupe_key TEXT NOT NULL UNIQUE);
 CREATE INDEX IF NOT EXISTS idx_subscription_grants_available ON booking_subscription_grants(tenant_id,user_id,booking_id,kind,used_at);
 CREATE TABLE IF NOT EXISTS booking_subscription_outbox(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,booking_id TEXT NOT NULL,task_id TEXT NOT NULL,kind TEXT NOT NULL,grant_id TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,finished_at TEXT,error_code TEXT,UNIQUE(task_id,kind));
 `)}
 function booking(tid,uid,id){
  const b=db.prepare('SELECT * FROM bookings WHERE id=? AND tenant_id=? AND user_id=?').get(id,tid,uid)
  if(!b)throw apiError(404,'NOT_FOUND','预约不存在或无权查看。')
  return b
 }
 function config(tid,uid,id){
  const b=booking(tid,uid,id)
  if(!enabled)return {enabled:false,reason:'微信提醒尚未开通，预约不受影响。'}
  if(b.status!=='CONFIRMED')return {enabled:false,reason:'预约确认后可订阅微信提醒。'}
  const now=new Date(),requestId=randomUUID()
  db.prepare('INSERT INTO booking_subscription_requests VALUES(?,?,?,?,?,?,NULL)').run(requestId,tid,uid,id,now.toISOString(),new Date(+now+600000).toISOString())
  return {enabled:true,requestId,templates:Object.entries(SUBSCRIBE_TEMPLATES).map(([kind,t])=>({kind,id:t.id})),note:'仅在你同意后发送微信提醒；一次授权不代表持续订阅。拒绝不影响预约。'}
 }
 function consent(tid,uid,body){
  const r=db.prepare('SELECT * FROM booking_subscription_requests WHERE id=? AND tenant_id=? AND user_id=?').get(String(body.requestId||''),tid,uid)
  if(!r)throw apiError(404,'NOT_FOUND','订阅请求不存在。')
  const b=booking(tid,uid,r.booking_id)
  if(r.completed_at)return {ok:true,replayed:true}
  const now=new Date().toISOString()
  if(r.expires_at<now)throw apiError(400,'EXPIRED','订阅页面已过期，请刷新后重试。')
  const results=body.results
  if(!results||typeof results!=='object'||Array.isArray(results))throw apiError(400,'BAD_REQUEST','缺少订阅结果。')
  for(const [id,value] of Object.entries(results))if(!Object.values(SUBSCRIBE_TEMPLATES).some(t=>t.id===id)||!['accept','reject','ban','filter'].includes(value))throw apiError(400,'BAD_REQUEST','无效订阅结果。')
  db.exec('SAVEPOINT subscription_consent')
  try{
   for(const [kind,t] of Object.entries(SUBSCRIBE_TEMPLATES))if(results[t.id]==='accept')db.prepare('INSERT OR IGNORE INTO booking_subscription_grants VALUES(?,?,?,?,?,?,?,NULL)').run(randomUUID(),r.id,tid,uid,r.booking_id,kind,now)
   // A newly authorized confirmation is a new event, never a replay of old notifications.
   if(results[SUBSCRIBE_TEMPLATES.booking_status.id]==='accept' && b.status==='CONFIRMED' && b.appointment_start>now){
    db.prepare("INSERT OR IGNORE INTO booking_subscription_events VALUES(?,?,?,?,?,'SENT',?,?)").run(randomUUID(),tid,uid,b.id,'booking_created',now,tid+'|subscription_confirmation|'+b.id+'|'+b.appointment_start)
   }
   db.prepare('UPDATE booking_subscription_requests SET completed_at=? WHERE id=?').run(now,r.id)
   db.exec('RELEASE subscription_consent')
  }catch(e){db.exec('ROLLBACK TO subscription_consent; RELEASE subscription_consent');throw e}
  return {ok:true}
 }
 async function tick(){
  if(!enabled||busy)return {skipped:true}
  busy=true
  const counts={sent:0,failed:0,cancelled:0}
  try{
   const now=new Date().toISOString()
   // Expired in-flight attempts are uncertain, not safe to automatically resend.
   db.prepare("UPDATE booking_subscription_outbox SET status='UNKNOWN',finished_at=?,error_code='SUBSCRIBE_DELIVERY_UNKNOWN' WHERE status='SENDING' AND created_at<?").run(now,new Date(Date.now()-120000).toISOString())
   // No historical backfill; only events after authorization, at their scheduled time.
   const tasks=db.prepare(`SELECT t.* FROM (SELECT id,tenant_id,user_id,booking_id,type,status,scheduled_at,dedupe_key FROM reminder_tasks WHERE type<>'booking_created' UNION ALL SELECT * FROM booking_subscription_events) t JOIN bookings b ON b.id=t.booking_id AND b.tenant_id=t.tenant_id AND b.user_id=t.user_id WHERE t.status='SENT' AND t.scheduled_at<=?
    AND substr(t.dedupe_key,-length(b.appointment_start)-1)='|'||b.appointment_start
    AND ((t.type='booking_cancelled' AND b.status='CANCELLED') OR (t.type IN ('booking_created','booking_rescheduled') AND b.status='CONFIRMED') OR (t.type='arrival_reminder' AND b.status='CONFIRMED' AND b.arrived_at IS NULL AND b.appointment_start>?)) AND t.type IN ('booking_created','booking_rescheduled','booking_cancelled','arrival_reminder')
    AND NOT EXISTS(SELECT 1 FROM booking_subscription_outbox o WHERE o.task_id=t.id)
    AND EXISTS(SELECT 1 FROM booking_subscription_grants g WHERE g.tenant_id=t.tenant_id AND g.user_id=t.user_id AND g.booking_id=t.booking_id AND g.used_at IS NULL
     AND g.kind=CASE WHEN t.type='arrival_reminder' THEN 'arrival_reminder' ELSE 'booking_status' END AND t.scheduled_at>=g.created_at)
    ORDER BY t.scheduled_at,t.id LIMIT 50`).all(now,now)
   for(const task of tasks){
    const kind=task.type==='arrival_reminder'?'arrival_reminder':'booking_status'
    const b=db.prepare('SELECT * FROM bookings WHERE id=? AND tenant_id=? AND user_id=?').get(task.booking_id,task.tenant_id,task.user_id)
    // Match the event's appointment slot, so delayed delivery never sends a superseded slot.
    if(!b||!String(task.dedupe_key||'').endsWith('|'+b.appointment_start))continue
    if(kind==='arrival_reminder'&&(b.arrived_at||!['CONFIRMED','PENDING_PAYMENT'].includes(b.status)))continue
    if(task.type==='booking_created'&&!['CONFIRMED','PENDING_PAYMENT'].includes(b.status))continue
    const u=db.prepare('SELECT wechat_open_id FROM users WHERE id=? AND tenant_id=?').get(task.user_id,task.tenant_id)
    const store=db.prepare('SELECT name,address FROM stores WHERE tenant_id=? AND id=?').get(task.tenant_id,b.store_id)
    const service=db.prepare('SELECT name_zh FROM services WHERE id=? AND tenant_id=?').get(b.service_id,task.tenant_id)
    const grant=db.prepare('SELECT * FROM booking_subscription_grants WHERE tenant_id=? AND user_id=? AND booking_id=? AND kind=? AND used_at IS NULL AND created_at<=? ORDER BY created_at,id LIMIT 1').get(task.tenant_id,task.user_id,task.booking_id,kind,task.scheduled_at)
    if(!grant)continue
    const id=randomUUID()
    db.exec('SAVEPOINT subscription_claim')
    try{
     const inserted=db.prepare("INSERT OR IGNORE INTO booking_subscription_outbox VALUES(?,?,?,?,?,?,?,'SENDING',?,NULL,NULL)").run(id,task.tenant_id,task.user_id,task.booking_id,task.id,kind,grant.id,now).changes
     if(!inserted){db.exec('RELEASE subscription_claim');continue}
     if(!db.prepare('UPDATE booking_subscription_grants SET used_at=? WHERE id=? AND used_at IS NULL').run(now,grant.id).changes)throw Error('SUBSCRIBE_GRANT_RACE')
     db.exec('RELEASE subscription_claim')
    }catch(e){db.exec('ROLLBACK TO subscription_claim; RELEASE subscription_claim');throw e}
    try{
     const p=localParts(b.appointment_start,tenantTimezone(task.tenant_id))
     const payload=subscriptionPayload({kind,event:task.type,openid:u?.wechat_open_id,tenantId:task.tenant_id,bookingId:b.id,store:store?.name,address:store?.address,service:service?.name_zh,date:p.date,time:p.time})
     await send(payload)
     db.prepare("UPDATE booking_subscription_outbox SET status='SENT',finished_at=? WHERE id=?").run(new Date().toISOString(),id);counts.sent++
    }catch(e){
     const code=/^SUBSCRIBE_[A-Z_0-9]+$/.test(e.message)?e.message:'SUBSCRIBE_DELIVERY_UNKNOWN'
     db.prepare("UPDATE booking_subscription_outbox SET status='FAILED',finished_at=?,error_code=? WHERE id=?").run(new Date().toISOString(),code,id);counts.failed++
    }
   }
   return counts
  }finally{busy=false}
 }
 async function route(req,res,{path,query}){
  const match=path.match(/^\/my\/bookings\/([^/]+)\/subscription$/)
  if(!match&&! (path === '/my/subscription-consent'))return false
  const u=requireCustomer(req),tid=resolveTenant(req,query)
  if(match&&req.method==='GET'){json(res,200,config(tid,u.id,decodeURIComponent(match[1])));return true}
  if(path === '/my/subscription-consent'&&req.method==='POST'){if(!enabled)throw apiError(409,'NOT_READY','微信提醒暂未开通。');json(res,200,consent(tid,u.id,await readBody(req)));return true}
  return false
 }
 return {ensureSchema,config,consent,tick,route}
}
