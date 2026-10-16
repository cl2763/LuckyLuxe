import assert from 'node:assert/strict'
import {subscriptionScope} from './subscription-scope.mjs'
import {DatabaseSync} from 'node:sqlite'
import {createBookingSubscriptions} from './booking-subscriptions.mjs'
for(const env of [{},{WECHAT_SUBSCRIBE_ENABLED:'true'},{WECHAT_SUBSCRIBE_ENABLED:'false',WECHAT_SUBSCRIBE_MODE:'all'},{WECHAT_SUBSCRIBE_ENABLED:'true',WECHAT_SUBSCRIBE_MODE:'typo'}])assert.equal(subscriptionScope(env).allowTarget('t','u'),false)
const scope=subscriptionScope({WECHAT_SUBSCRIBE_ENABLED:'true',WECHAT_SUBSCRIBE_TEST_TARGETS:'t:u'})
assert.equal(scope.allowTarget('t','u'),true);assert.equal(scope.allowTarget('t','v'),false);assert.equal(scope.allowTarget('other','u'),false)
const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE bookings(id,tenant_id,user_id,status);INSERT INTO bookings VALUES('b','t','v','CONFIRMED')")
const m=createBookingSubscriptions({db,...scope,apiError:(status,c,m)=>Object.assign(Error(m),{status})});m.ensureSchema()
assert.equal(m.config('t','v','b').enabled,false)
assert.throws(()=>m.consent('t','v',{}),e=>e.status===409)
assert.equal(db.prepare('SELECT COUNT(*) n FROM booking_subscription_requests').get().n,0)
console.log('ok 1 - subscription default-off, explicit test identity, incomplete scope closed, cross-tenant refusal and no unauthorized consent')
const queueDb=new DatabaseSync(':memory:')
queueDb.exec(`CREATE TABLE bookings(id,tenant_id,user_id,status,appointment_start,arrived_at,service_id,store_id);
CREATE TABLE users(id,tenant_id,wechat_open_id);CREATE TABLE stores(id,tenant_id,name,address,is_active);CREATE TABLE services(id,tenant_id,name_zh);
CREATE TABLE reminder_tasks(id,tenant_id,user_id,booking_id,type,status,scheduled_at,dedupe_key);
INSERT INTO users VALUES('u','t','o-test');INSERT INTO stores VALUES('st','t','测试店','测试地址',1);INSERT INTO services VALUES('s','t','美甲');`)
let sent=0
const queue=createBookingSubscriptions({db:queueDb,...scope,apiError:(status,c,m)=>Object.assign(Error(m),{status}),localParts:()=>({date:'2099-12-12',time:'18:00'}),tenantTimezone:()=> 'Asia/Shanghai',send:async()=>{sent++}})
queue.ensureSchema()
for(let i=0;i<55;i++){
 const uid=i===54?'u':'excluded',id='b'+i,at='2099-12-12T10:00:00Z'
 queueDb.prepare('INSERT INTO bookings VALUES(?,?,?,?,?,NULL,?,?)').run(id,'t',uid,'CONFIRMED',at,'s','st')
 queueDb.prepare('INSERT INTO reminder_tasks VALUES(?,?,?,?,?,?,?,?)').run('task'+String(i).padStart(3,'0'),'t',uid,id,'arrival_reminder','SENT','2020-01-01T00:00:00Z','t|arrival_reminder|'+id+'|'+at)
 queueDb.prepare('INSERT INTO booking_subscription_grants VALUES(?,?,?,?,?,?,?,NULL)').run('g'+i,'r'+i,'t',uid,id,'arrival_reminder','2019-01-01')
}
await queue.tick();assert.equal(sent,1,'excluded recipients must not starve the test recipient')
assert.equal(queueDb.prepare('SELECT COUNT(*) n FROM booking_subscription_outbox').get().n,1)
assert.equal(queueDb.prepare("SELECT COUNT(*) n FROM booking_subscription_grants WHERE user_id='excluded' AND used_at IS NOT NULL").get().n,0)
await queue.tick();assert.equal(sent,1)
console.log('ok 2 - 54 excluded recipients cannot starve the allowed recipient; no excluded grant consumed; no duplicate send')
