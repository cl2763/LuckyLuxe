import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {createMerchantMessages} from './merchant-messages.mjs'
const db=new DatabaseSync(':memory:')
db.exec(`CREATE TABLE staff_nudges(id TEXT,tenant_id TEXT,technician_id TEXT,type TEXT,message TEXT,created_at TEXT,read_at TEXT);
CREATE TABLE reminder_tasks(id TEXT,tenant_id TEXT,type TEXT,payload_json TEXT,created_at TEXT,booking_id TEXT);
INSERT INTO staff_nudges VALUES('n1','a','t1','duty:2026-10-12','值日','2026-10-12T00:00:00Z',NULL),('n2','a','t2','note','他人','2026-10-12T00:00:00Z',NULL),('n3','b','t1','note','别店','2026-10-12T00:00:00Z',NULL);
INSERT INTO reminder_tasks VALUES('r1','a','booking_created','{"text":"预约已确认"}','2026-10-12T00:00:00Z','b1'),('r2','b','booking_created','{"text":"别店"}','2026-10-12T00:00:00Z','b2');`)
const m=createMerchantMessages({db,apiError:(status,code,text)=>Object.assign(Error(text),{status,code}),json:()=>{},tenantTimezone:()=> 'Asia/Shanghai',localParts:()=>({date:'2026-10-12',time:'08:00'})})
m.ensureSchema();m.ensureSchema()
const owner={role:'owner',accountId:'owner1'}, otherOwner={role:'owner',accountId:'owner2'},staff={role:'staff',accountId:'s1',technicianId:'t1'}
assert.equal(m.list('a',owner).messages.length,1)
assert.equal(m.list('a',staff).messages.length,1)
assert.equal(m.list('a',{...staff,technicianId:null}).messages.length,0)
assert.throws(()=>m.list('a',{role:'customer'}),e=>e.status===403)
assert.throws(()=>m.markRead('a',staff,'nudge:n2'),e=>e.status===404)
assert.throws(()=>m.markRead('a',staff,'nudge:n3'),e=>e.status===404)
assert.throws(()=>m.markRead('a',owner,'booking:r2'),e=>e.status===404)
assert.throws(()=>m.markRead('a',owner,'x'.repeat(201)),e=>e.status===400)
m.markRead('a',owner,'booking:r1');const stamp=m.list('a',owner).messages[0].readAt
m.markRead('a',owner,'booking:r1');assert.equal(m.list('a',owner).messages[0].readAt,stamp)
assert.equal(m.list('a',owner).unreadCount,0);assert.equal(m.list('a',otherOwner).unreadCount,1)
m.markRead('a',staff,'nudge:n1');assert.equal(m.list('a',staff).unreadCount,0)
assert.ok(db.prepare("SELECT read_at FROM staff_nudges WHERE id='n1'").get().read_at)
assert.equal(m.list('a',owner).messages[0].timeText,'2026-10-12 08:00')
assert.equal(db.prepare('SELECT COUNT(*) n FROM reminder_tasks').get().n,2)
console.log('ok - merchant messages: isolation, owner/staff roles, stable reads, legacy nudge parity, empty/error, time-zone checks passed')
db.close()
