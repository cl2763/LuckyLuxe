import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {memberDiscountHistoryDisplay as display} from './member-discount-history-display.mjs'
const db=new DatabaseSync(':memory:')
db.exec('CREATE TABLE member_pricing_operations(tenant_id TEXT,user_id TEXT,operation_id TEXT,source TEXT,result_json TEXT);CREATE TABLE stored_value_transactions(id TEXT,tenant_id TEXT,user_id TEXT,type TEXT,amount_cents INTEGER)')
const event={tenant_id:'a',user_id:'u',source:'recharge',source_id:'op',created_at:'2026-11-14T00:00:00Z',actor:'老板',reason:'核对',before_rate_bps:9000,after_rate_bps:8500}
assert.equal(display(db,event).principalCents,null);assert.equal(display(db,event).bonusCents,null)
const op=(id,receipt)=>db.prepare('INSERT INTO member_pricing_operations VALUES(?,?,?,?,?)').run('a','u',id,'recharge',JSON.stringify(receipt))
op('op',{rechargeTxnId:'paid',bonusTxnId:'bonus'})
db.exec("INSERT INTO stored_value_transactions VALUES('paid','a','u','recharge',50000),('bonus','b','u','bonus',5000)")
let r=display(db,event);assert.equal(r.principalCents,50000);assert.equal(r.bonusCents,null);assert.equal(r.created_at,event.created_at);assert.equal(r.source_id,'op');assert.equal(r.actor,'老板');assert.equal(r.sourceText,'充值确认')
db.exec("INSERT INTO stored_value_transactions VALUES('bonus','a','u','bonus',5000)")
assert.equal(display(db,event).bonusCents,5000)
op('inline:g',{rechargeTxnId:'paid'})
assert.equal(display(db,{...event,source_id:'document-group:g'}).bonusCents,0)
assert.equal(display(db,{...event,tenant_id:'b'}).principalCents,null)
assert.equal(display(db,{...event,user_id:'other'}).principalCents,null)
assert.equal(display(db,{...event,source:'owner'}).sourceText,'独立调整')
console.log('ok 1 - exact recharge/inline receipt joins, full audit fields, unknown legacy amounts, zero bonus, cross-tenant/customer isolation')
db.close()

const {ensureMemberPricingSchema,createMemberPricingPolicy}=await import('./member-pricing-policy.mjs')
const {readFileSync}=await import('node:fs')
const timezoneDb=new DatabaseSync(':memory:')
timezoneDb.exec('CREATE TABLE users(id TEXT,tenant_id TEXT);CREATE TABLE stored_value_transactions(id TEXT,tenant_id TEXT,user_id TEXT,type TEXT,amount_cents INTEGER)')
ensureMemberPricingSchema(timezoneDb)
for(const tenant of ['toronto','shanghai']){
 timezoneDb.prepare('INSERT INTO users VALUES(?,?)').run('u',tenant)
 timezoneDb.prepare('INSERT INTO member_discount_events VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(tenant,tenant,'u',9000,8500,1,'owner','op','老板','核对','2026-11-15T01:30:00Z')
}
const zones={toronto:'America/Toronto',shanghai:'Asia/Shanghai'}
const policy=createMemberPricingPolicy({db:timezoneDb,formatCreatedAt:(at,tid)=>{
 const timeZone=zones[tid],parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(at)),get=k=>parts.find(x=>x.type===k).value
 return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}（${timeZone}）`
}})
const previousTZ=process.env.TZ
try{
 for(const deviceZone of ['Pacific/Honolulu','Asia/Tokyo']){
  process.env.TZ=deviceZone
  assert.equal(policy.history('toronto','u')[0].createdText,'2026-11-14 20:30（America/Toronto）')
  assert.equal(policy.history('shanghai','u')[0].createdText,'2026-11-15 09:30（Asia/Shanghai）')
 }
}finally{if(previousTZ===undefined)delete process.env.TZ;else process.env.TZ=previousTZ}
console.log('ok 2 - policy history formats the tenant date across midnight regardless of device/server timezone')
const server=readFileSync(new URL('./local-server.mjs',import.meta.url),'utf8')
assert.match(server,/createMemberPricingPolicy\(\{[^\n]*formatCreatedAt:\(v,t\)=>\{const p=localParts\(v,tenantTimezone\(t\)\)/)
for(const path of ['../web/member-pricing-member.js','../../miniprogram/components/member-pricing/index.js']){
 const ui=readFileSync(new URL(path,import.meta.url),'utf8');assert.ok(ui.includes('createdText'));assert.ok(!ui.includes('toLocaleString'))
}
console.log('ok 3 - live composition injects the store formatter and both clients only render the backend time text')
timezoneDb.close()
