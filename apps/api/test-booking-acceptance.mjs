import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {createBookingAcceptance} from './booking-acceptance.mjs'
import {createBookingSubscriptions} from './booking-subscriptions.mjs'
import {SUBSCRIBE_TEMPLATES} from './wechat-subscribe.mjs'
const db=new DatabaseSync(':memory:')
db.exec(`CREATE TABLE bookings(id,tenant_id,user_id,status,appointment_start,arrived_at,service_id,store_id);
CREATE TABLE users(id,tenant_id,wechat_open_id,display_name); CREATE TABLE stores(id,tenant_id,name,address); CREATE TABLE services(id,tenant_id,name_zh);
CREATE TABLE reminder_tasks(id,tenant_id,user_id,booking_id,type,status,scheduled_at,dedupe_key);
INSERT INTO bookings VALUES('b','a','u','PENDING_PAYMENT','2099-12-12T10:00:00Z',NULL,'s','st');
INSERT INTO users VALUES('u','a','test-open-id','Test'); INSERT INTO stores VALUES('st','a','Test store','Test address'); INSERT INTO services VALUES('s','a','Test service');`)
const deps={db,apiError:(status,code,text)=>Object.assign(Error(text),{status,code}),localParts:()=>({date:'2099-12-12',time:'18:00'}),tenantTimezone:()=> 'Asia/Shanghai'}
let sent=0
const subs=createBookingSubscriptions({...deps,enabled:true,allowTarget:(tid,uid)=>tid==='a'&&uid==='u',send:async()=>{sent++}});subs.ensureSchema()
const m=createBookingAcceptance({...deps,onConfirmed:(...args)=>subs.confirmed(...args)});m.ensureSchema();m.ensureSchema()
const owner={role:'owner',accountId:'owner'}
const before=db.prepare('SELECT * FROM bookings').all()
assert.equal(m.list('a',owner).items.length,1)
assert.equal(m.list('other',owner).items.length,0)
assert.throws(()=>m.confirm('a',{role:'staff'},'b'),e=>e.status===403)
assert.throws(()=>m.confirm('other',owner,'b'),e=>e.status===404)
// Login subscription exists before any booking-specific subscription; one credit only.
const c=subs.config('a','u','');subs.consent('a','u',{requestId:c.requestId,results:{[SUBSCRIBE_TEMPLATES.booking_status.id]:'accept'}})
assert.equal(db.prepare('SELECT COUNT(*) n FROM booking_subscription_events').get().n,0)
assert.equal(subs.config('other','u','').enabled,false)
assert.equal(m.confirm('a',owner,'b').replayed,false)
assert.equal(m.confirm('a',owner,'b').replayed,true)
assert.equal(m.list('a',owner).items.length,0)
assert.deepEqual(db.prepare('SELECT * FROM bookings').all(),before,'acceptance must not change payment, arrival or original status')
assert.equal(db.prepare('SELECT COUNT(*) n FROM booking_subscription_events').get().n,1)
await Promise.all([subs.tick(),subs.tick()]);assert.equal(sent,1)
await subs.tick();assert.equal(sent,1)
// Merchant may confirm before the customer opts in: re-arm the same unsent event.
db.exec("DELETE FROM booking_subscription_outbox; DELETE FROM booking_subscription_grants; UPDATE booking_subscription_events SET scheduled_at='2000-01-01T00:00:00.000Z'")
const late=subs.config('a','u','b');subs.consent('a','u',{requestId:late.requestId,results:{[SUBSCRIBE_TEMPLATES.booking_status.id]:'accept'}})
await subs.tick();assert.equal(sent,2,'late consent must deliver an unsent confirmation')
const again=subs.config('a','u','b');subs.consent('a','u',{requestId:again.requestId,results:{[SUBSCRIBE_TEMPLATES.booking_status.id]:'accept'}})
await subs.tick();assert.equal(sent,2,'delivered confirmation must not repeat after new consent')
db.exec("UPDATE bookings SET status='CANCELLED'")
assert.throws(()=>m.confirm('a',owner,'b'),e=>e.status===409)
for(const [status,arrival,at] of [['COMPLETED',null,'2099-12-12T10:00:00Z'],['CONFIRMED','2026-01-01','2099-12-12T10:00:00Z'],['CONFIRMED',null,'2000-01-01T10:00:00Z']]){
 db.prepare('UPDATE bookings SET status=?,arrived_at=?,appointment_start=?').run(status,arrival,at)
 assert.throws(()=>m.confirm('a',owner,'b'),e=>e.status===409)
}
db.exec("UPDATE bookings SET status='CONFIRMED',arrived_at=NULL,appointment_start='2099-12-12T10:00:00Z'; DELETE FROM booking_acceptances")
const broken=createBookingAcceptance({...deps,onConfirmed:()=>{throw Error('test failure')}})
assert.throws(()=>broken.confirm('a',owner,'b'),/test failure/)
assert.equal(db.prepare('SELECT COUNT(*) n FROM booking_acceptances').get().n,0,'failed callback rolls acknowledgement back')
console.log('ok 1 - role and tenant isolation; repeat confirmation is idempotent; booking row unchanged')
console.log('ok 2 - login subscription followed by merchant acceptance sends once and consumes one credit')
