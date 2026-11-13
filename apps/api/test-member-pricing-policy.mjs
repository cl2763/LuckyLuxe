import {ensureMemberDocumentSchema,createMemberServiceDocuments} from './member-service-documents.mjs'
import {memberDiscountInput} from './member-discount-input.mjs'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { ensureMemberPricingSchema,createMemberPricingPolicy } from './member-pricing-policy.mjs'
const db=new DatabaseSync(':memory:')
db.exec(`CREATE TABLE users(id TEXT,tenant_id TEXT);CREATE TABLE services(id TEXT,tenant_id TEXT,price_cents INTEGER);
 CREATE TABLE service_prices(service_id TEXT,tenant_id TEXT,tier_key TEXT,price_cents INTEGER,course_times INTEGER);
 CREATE TABLE membership_packages(id TEXT,tenant_id TEXT,kind TEXT);
 INSERT INTO users VALUES('u','a'),('u2','b');INSERT INTO services VALUES('s','a',30000),('s2','b',90000);
 INSERT INTO service_prices VALUES('s','a','member',27000,NULL);INSERT INTO membership_packages VALUES('p','a','recharge');`)
const apiError=(status,code,message)=>Object.assign(new Error(message),{status,code})
let eligible=true
const p=createMemberPricingPolicy({db,apiError,isMemberOf:()=>eligible,balanceOf:()=>10000,getMembershipConfig:()=>({})})
ensureMemberPricingSchema(db);ensureMemberPricingSchema(db)
assert.throws(()=>db.prepare('INSERT INTO member_pricing_settings VALUES(?,?,?,?)').run(null,'{}',0,''),/NOT NULL/)
assert.equal(p.config('a').active,false)
p.setConfig('a',{expectedRevision:0,displayTypes:['list'],settlementTypes:['list','member'],active:true})
assert.throws(()=>p.setConfig('a',{expectedRevision:1,settlementTypes:['list']}),{code:'MEMBER_PRICE_REQUIRED'})
assert.throws(()=>p.setConfig('a',{expectedRevision:0,displayTypes:['list']}),{code:'PRICING_CHANGED'})
assert.deepEqual(Object.keys(p.publicPrices('a','s').prices),['list'])
p.setPrices('a','s','display',{expectedRevision:0,prices:{list:{priceCents:35000},member:{priceCents:0}}})
assert.equal(p.prices('a','s','settlement').prices.list.priceCents,30000)
p.setPrices('a','s','settlement',{expectedRevision:1,prices:{list:{priceCents:31000}}})
assert.equal(p.prices('a','s','display').prices.list.priceCents,35000)
assert.equal(p.prices('a','s','display').prices.member.priceCents,0)
assert.throws(()=>p.prices('b','s','display'),{code:'NOT_FOUND'})
assert.throws(()=>p.setPrices('a','s','display',{expectedRevision:1,prices:{list:{priceCents:-1}}}),{code:'INVALID_PRICING_VALUE'})
assert.throws(()=>p.setPrices('a','s','display',{expectedRevision:1,prices:{member:{priceCents:1}}}),{code:'LIST_PRICE_REQUIRED'})
assert.throws(()=>p.rate(8550),{code:'INVALID_PRICING_VALUE'})
assert.equal(p.rate(8500),8500)
assert.equal(p.rate(10000),10000)
assert.equal(p.rate(null),null)
const input={expectedRevision:0,rateBps:8000,reason:'客户约定'}
const actor={role:'owner',actor:'owner-a',sourceId:'op1'}
assert.equal(p.setDiscount('a','u',input,actor).effectiveRateBps,8000)
assert.equal(p.setDiscount('a','u',input,actor).alreadyApplied,true)
assert.equal(p.history('a','u').length,1)
assert.throws(()=>p.setDiscount('a','u',{...input,rateBps:7000},actor),{code:'IDEMPOTENCY_CONFLICT'})
assert.throws(()=>p.setDiscount('a','u',{...input,reason:'不同原因'},actor),{code:'IDEMPOTENCY_CONFLICT'})
assert.throws(()=>p.setDiscount('a','u',{...input,expectedRevision:1},{...actor,role:'staff',sourceId:'op2'}),{code:'FORBIDDEN'})
assert.throws(()=>p.setDiscount('b','u',input,actor),{code:'NOT_FOUND'})
assert.throws(()=>p.setDiscount('a','u',{...input,rateBps:10001},{...actor,sourceId:'op2'}),{code:'INVALID_PRICING_VALUE'})
eligible=false
assert.equal(p.discount('a','u').effectiveRateBps,null)
assert.equal(p.discount('a','u').rateBps,8000)
eligible=true
assert.equal(p.discount('a','u').effectiveRateBps,8000)
p.setPackageDiscount('a','p',{expectedRevision:0,rateBps:9000})
assert.equal(p.discount('a','u').rateBps,8000)
assert.throws(()=>db.exec('DELETE FROM member_discount_events'),/immutable/)
assert.throws(()=>db.exec('UPDATE member_discount_events SET after_rate_bps=9000'),/immutable/)
ensureMemberPricingSchema(db)
assert.equal(p.history('a','u').length,1)
assert.equal(db.prepare('SELECT price_cents FROM services WHERE id=?').get('s').price_cents,30000)
console.log('ok 1 - independent prices, member qualification, rates, tenant isolation, permissions, concurrency, idempotency and retained history')


const wheel=memberDiscountInput()
assert.equal(wheel.options.length,100)
assert.deepEqual(wheel.options[0],{rateBps:10000,label:"无折扣"})
assert.deepEqual(wheel.options[15],{rateBps:8500,label:"8.5折"})
assert.equal(new Set(wheel.options.map(o=>o.rateBps)).size,100)
assert.equal(wheel.options.at(-1).rateBps,100)
assert.equal(wheel.unset.rateBps,null)
console.log('ok 2 - wheel has explicit no-discount and 0.1折 options, distinct from unset default')

ensureMemberDocumentSchema(db)
db.prepare('INSERT INTO member_service_documents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('d','a','g','u','self','signed',null,'{}','hash','{"original":123}','2026-01-01','synthetic','2026-01-01')
assert.throws(()=>db.prepare('UPDATE member_service_documents SET signed_json=? WHERE id=?').run('{}','d'),/immutable/)
assert.throws(()=>db.prepare('DELETE FROM member_service_documents WHERE id=?').run('d'),/immutable/)
ensureMemberDocumentSchema(db)
assert.equal(db.prepare('SELECT signed_json FROM member_service_documents WHERE id=?').get('d').signed_json,'{"original":123}')
assert.throws(()=>p.setPackageDiscount('a','p',null),{code:'INVALID_PRICING_VALUE'})
console.log('ok 3 - signed document snapshots survive repeated schema initialization and reject overwrite/deletion')

// A genuinely old pending row still signs; price changes, not elapsed time, require a new quote.
db.exec(`CREATE TABLE settlements(id TEXT,tenant_id TEXT,code TEXT,status TEXT,booking_id TEXT,deposit_deduct_cents INTEGER,recharge_json TEXT);
 CREATE TABLE settlement_groups(id TEXT,status TEXT,updated_at TEXT);CREATE TABLE bookings(id TEXT,tenant_id TEXT,status TEXT);`)
let ledgerCalls=0,sequence=0
const admin={role:'owner',email:'synthetic-owner'}
const docs=createMemberServiceDocuments({db,policy:p,apiError,currentTenantId:()=> 'a',getPricingRules:()=>({}),
 preview:{prepare:()=>({userId:'u',sheets:[{items:[{serviceId:'s'}]}],context:{oldRevision:p.discount('a','u').revision,eligible:true},
   view:{components:[{amountCents:100}],documents:[{beneficiaryKey:'self',componentIndexes:[0]}],personalDiscount:p.discount('a','u')}})},
 createSettlementGroup:()=>{const groupId=`unit-g-${++sequence}`,id=`unit-c-${sequence}`;db.prepare('INSERT INTO settlement_groups VALUES(?,?,?)').run(groupId,'pending_sign','');db.prepare('INSERT INTO settlements VALUES(?,?,?,?,?,?,?)').run(id,'a',id,'pending_sign',null,0,null);return {groupId,settlements:[{id}]};},
 signLedger:c=>{ledgerCalls++;db.prepare("UPDATE settlements SET status='signed' WHERE id=?").run(c.id);return {}},
 balanceOf:()=>({totalCents:10000}),requireCustomer:()=>({id:'u'}),amendmentShape:()=>({})})
const old=docs.create({operationId:'unit-old'},admin).documents[0]
db.prepare('UPDATE member_service_documents SET created_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z',old.id)
p.setConfig('a',{expectedRevision:1,displayTypes:['list','share']})
assert.equal(docs.shape(docs.get(old.id)).expiresAt,null)
const signature={signature:'synthetic',disclaimerAccepted:true,confirmationHash:old.confirmationHash}
assert.equal(docs.sign(old.id,signature,{headers:{}}).status,'signed')
assert.equal(docs.sign(old.id,signature,{headers:{}}).duplicate,true)
assert.equal(ledgerCalls,1)
const changed=docs.create({operationId:'unit-changed'},admin).documents[0]
p.setPrices('a','s','settlement',{expectedRevision:2,prices:{list:{priceCents:32000}}})
assert.throws(()=>docs.sign(changed.id,{...signature,confirmationHash:changed.confirmationHash},{headers:{}}),{code:'PRICING_CHANGED'})
assert.equal(ledgerCalls,1)
console.log('ok 4 - old unsigned documents have no age expiry; display changes do not invalidate settlement; settlement price changes do')
db.close()
