import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {customerMessages} from './customer-messages.mjs'
const db=new DatabaseSync(':memory:')
db.exec(`CREATE TABLE users(id TEXT,tenant_id TEXT);INSERT INTO users VALUES('u','a'),('v','a'),('w','b');CREATE TABLE notification_logs(id TEXT,tenant_id TEXT,target_user_id TEXT,channel TEXT,status TEXT,payload_json TEXT,delivered_at TEXT);`)
const put=db.prepare('INSERT INTO notification_logs VALUES(?,?,?,?,?,?,?)')
for(const [id,tid,uid,ch,status,text] of [['mine','a','u','inapp','sent','hello'],['other','a','v','inapp','sent','private'],['cross','b','u','inapp','sent','private'],['failed','a','u','inapp','failed','failed'],['external','a','u','sms','sent','sms']])put.run(id,tid,uid,ch,status,JSON.stringify({text,internalMemo:'not-returned'}),'2026-10-10T00:00:00Z')
let out;const deps={tenantTimezone:()=> 'Asia/Shanghai',localParts:()=>({date:'2026-10-10',time:'08:00'}),db,requireCustomer:()=>({id:'u'}),resolveTenant:()=> 'a',query:{},apiError:(s,c,m)=>Object.assign(new Error(m),{status:s}),json:(_r,_s,b)=>out=b}
customerMessages({}, {},deps);assert.deepEqual(out.messages,[{id:'mine',text:'hello',sentAt:'2026-10-10T00:00:00Z',timeText:'2026-10-10 08:00'}]);console.log('ok 1 - only own delivered in-app text, no extra payload')
assert.throws(()=>customerMessages({}, {},{...deps,resolveTenant:()=> 'b'}),e=>e.status===403);console.log('ok 2 - cross tenant denied')
assert.throws(()=>customerMessages({}, {},{...deps,requireCustomer:()=>{throw Error('unauthorized')}}));console.log('ok 3 - anonymous denied')
put.run('bad','a','u','inapp','sent','{broken','2026-10-10T01:00:00Z');customerMessages({}, {},deps);assert.equal(out.messages.length,1);console.log('ok 4 - malformed record safe')
for(let i=0;i<105;i++)put.run('n'+String(i).padStart(3,'0'),'a','u','inapp','sent',JSON.stringify({text:'n'+i}),'2026-10-10T02:00:00Z')
customerMessages({}, {},deps);assert.equal(out.messages.length,100);assert.equal(out.messages[0].id,'n104');console.log('ok 5 - stable newest first bounded list')
db.close()
