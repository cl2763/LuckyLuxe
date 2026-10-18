import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {createBookingSubscriptions} from './booking-subscriptions.mjs'
import {SUBSCRIBE_TEMPLATES} from './wechat-subscribe.mjs'
const db=new DatabaseSync(':memory:')
db.exec(`CREATE TABLE bookings(id,tenant_id,user_id,status,appointment_start,arrived_at,service_id,store_id);
CREATE TABLE users(id,tenant_id,wechat_open_id);CREATE TABLE stores(id,tenant_id,name,address,is_active);CREATE TABLE services(id,tenant_id,name_zh);
CREATE TABLE reminder_tasks(id,tenant_id,user_id,booking_id,type,status,scheduled_at,dedupe_key);
INSERT INTO bookings VALUES('b','a','u','CONFIRMED','2026-12-12T10:00:00Z',NULL,'s','st'),('b2','a','v','CONFIRMED','2026-12-12T10:00:00Z',NULL,'s','st');
INSERT INTO users VALUES('u','a','o-test');INSERT INTO stores VALUES('st','a','店铺','地址',1);INSERT INTO services VALUES('s','a','美甲');`)
let sends=0
const deps={db,enabled:true,apiError:(status,c,text)=>Object.assign(Error(text),{status}),localParts:()=>({date:'2026-12-12',time:'18:00'}),tenantTimezone:()=> 'Asia/Shanghai',send:async()=>{sends++}}
const m=createBookingSubscriptions(deps);m.ensureSchema();m.ensureSchema()
assert.throws(()=>m.config('b','u','b'),e=>e.status===404)
assert.throws(()=>m.config('a','v','b'),e=>e.status===404)
const c=m.config('a','u','b');assert.equal(c.templates.length,2)
assert.throws(()=>m.consent('a','v',{requestId:c.requestId,results:{}}),e=>e.status===404)
assert.throws(()=>m.consent('a','u',{requestId:c.requestId,results:{unknown:'accept'}}),e=>e.status===400)
const results={[SUBSCRIBE_TEMPLATES.arrival_reminder.id]:'accept'}
m.consent('a','u',{requestId:c.requestId,results});m.consent('a','u',{requestId:c.requestId,results})
assert.equal(db.prepare('SELECT COUNT(*) n FROM booking_subscription_grants').get().n,1)
const rejected=m.config('a','u','b');m.consent('a','u',{requestId:rejected.requestId,results:{[SUBSCRIBE_TEMPLATES.arrival_reminder.id]:'reject'}})
assert.equal(db.prepare('SELECT COUNT(*) n FROM booking_subscription_grants').get().n,1)
db.exec("INSERT INTO booking_acceptances VALUES('a','b','2026-01-01','owner')")
const put=db.prepare('INSERT INTO reminder_tasks VALUES(?,?,?,?,?,?,?,?)')
put.run('old','a','u','b','arrival_reminder','SENT','2000-01-01T00:00:00Z','a|arrival_reminder|b|2026-12-12T10:00:00Z')
await m.tick();assert.equal(sends,0)
const now=new Date(Date.now()).toISOString()
put.run('next','a','u','b','arrival_reminder','SENT',now,'a|arrival_reminder|b|2026-12-12T10:00:00Z')
await Promise.all([m.tick(),m.tick()]);assert.equal(sends,1)
await m.tick();assert.equal(sends,1)
assert.equal(db.prepare("SELECT status FROM booking_subscription_outbox WHERE task_id='next'").get().status,'SENT')
db.prepare("INSERT INTO booking_subscription_grants VALUES('g2','r2','a','u','b','booking_status','2000-01-01',NULL)").run()
put.run('change','a','u','b','booking_rescheduled','SENT',now,'a|booking_rescheduled|b|2026-12-12T10:00:00Z')
const failed=createBookingSubscriptions({...deps,send:async()=>{throw Error('network contains private token')}})
await failed.tick();assert.equal(db.prepare("SELECT error_code FROM booking_subscription_outbox WHERE task_id='change'").get().error_code,'SUBSCRIBE_DELIVERY_UNKNOWN')
await failed.tick();assert.equal(db.prepare('SELECT COUNT(*) n FROM booking_subscription_outbox').get().n,2)
assert.equal(createBookingSubscriptions({...deps,enabled:false}).config('a','u','b').enabled,false)
console.log('subscription grants/outbox: ownership, replay, refusal, no historic sends, concurrent tick, dedupe and uncertain delivery tests passed')

db.exec("INSERT INTO booking_acceptances VALUES('a','b2','2026-01-01','owner')")
// Confirmation is queued once only after a customer explicitly accepts its template.
const confirm=m.config('a','v','b2');m.consent('a','v',{requestId:confirm.requestId,results:{[SUBSCRIBE_TEMPLATES.booking_status.id]:'accept'}})
assert.equal(db.prepare('SELECT COUNT(*) n FROM booking_subscription_events').get().n,1)
const again=m.config('a','v','b2');m.consent('a','v',{requestId:again.requestId,results:{[SUBSCRIBE_TEMPLATES.booking_status.id]:'accept'}})
assert.equal(db.prepare('SELECT COUNT(*) n FROM booking_subscription_events').get().n,1)
db.prepare("UPDATE bookings SET status='CANCELLED' WHERE id='b2'").run()
await m.tick();assert.equal(sends,1,'superseded confirmation must not send')
console.log('ok - confirmation opt-in dedupe and stale cancellation guards')

db.prepare("UPDATE bookings SET status='PENDING_PAYMENT' WHERE id='b2'").run()
assert.equal(m.config('a','v','b2').enabled,true,'pending booking may opt in before merchant acceptance')
console.log('ok - pending bookings wait for confirmation before offering subscription')
