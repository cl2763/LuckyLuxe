import assert0 from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {guardDraftBooking,validateManualDraft,draftScene,draftForScene} from './booking-draft-confirm.mjs'
let n=0
const assert=new Proxy(assert0,{get(t,k){return typeof t[k]==='function'? (...a)=>{const r=t[k](...a);console.log(`ok ${++n} - ${k}`);return r}:t[k]}})
const db=new DatabaseSync(':memory:')
db.exec("CREATE TABLE booking_drafts(id,tenant_id,user_id,status,expires_at,booking_id,store_id,service_id,technician_id,date,time,addons_json); CREATE TABLE bookings(id,tenant_id,user_id); CREATE TABLE stores(id,tenant_id,is_active); CREATE TABLE services(id,tenant_id,is_active); CREATE TABLE technicians(id,tenant_id,is_active); INSERT INTO stores VALUES('store','a',1); INSERT INTO services VALUES('service','a',1); INSERT INTO technicians VALUES('tech','a',1),('other','b',1)")
const apiError=(status,code,message)=>Object.assign(new Error(message),{status,code}),deps={db,apiError,currentTenantId:()=> 'a'}
const manual={sourceChannel:'admin_manual',storeId:'store',serviceId:'service',technicianId:'tech',date:'2026-10-20',time:'10:00',notes:''}
assert.equal(validateManualDraft(manual,{role:'owner'},deps).serviceId,'service')
assert.equal(validateManualDraft({...manual,userId:'evil'},{role:'staff',technicianId:'tech'},deps).userId,undefined)
for(const bad of [{time:''},{date:'xx'},{notes:'x'.repeat(1001)},{serviceId:'wrong'},{storeId:'wrong'},{technicianId:'other'}])assert.throws(()=>validateManualDraft({...manual,...bad},{role:'owner'},deps))
assert.throws(()=>validateManualDraft({...manual,technicianId:'other'},{role:'staff',technicianId:'tech'},deps),e=>e.status===403)
const input={bookingDraftId:'draft',tenantId:'a',userId:'user',storeId:'store',serviceId:'service',technicianId:'tech',date:'2026-10-20',time:'10:00',addOns:[]}
db.prepare('INSERT INTO booking_drafts VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('draft','a',null,'DRAFT',new Date(Date.now()+60000).toISOString(),null,'store','service','tech',input.date,input.time,'[]')
const guard=i=>guardDraftBooking({db,input:i,apiError,serializeBooking:b=>b})
assert.equal(guard(input),null)
assert.equal(db.prepare('SELECT count(*) AS n FROM bookings').get().n,0)
assert.equal(draftScene('draft').length,25);assert.notEqual(draftScene('draft'),draftScene('other'))
assert.equal(draftForScene(db,draftScene('draft')).tenant_id,'a');assert.equal(draftForScene(db,'s'+'a'.repeat(24)),null)
for(const patch of [{tenantId:'b'},{serviceId:'wrong'},{time:'11:00'},{addOns:[{id:'x'}]}])assert.throws(()=>guard({...input,...patch}))
db.prepare("UPDATE booking_drafts SET user_id='someone'").run();assert.throws(()=>guard(input),e=>e.status===403)
db.prepare("UPDATE booking_drafts SET user_id=NULL,expires_at='2000-01-01'").run();assert.throws(()=>guard(input),e=>e.status===410)
db.prepare("UPDATE booking_drafts SET status='BOOKING_CREATED',booking_id='booking'").run();db.prepare('INSERT INTO bookings VALUES(?,?,?)').run('booking','a','user')
assert.equal(guard(input).id,'booking');assert.equal(guard(input).id,'booking');assert.equal(db.prepare('SELECT count(*) AS n FROM bookings').get().n,1)
assert.throws(()=>guard({...input,userId:'other'}),e=>e.code==='DRAFT_ALREADY_CONFIRMED')
db.close();console.log('PASS manual draft validation, tenant/staff permission, immutable selection, expiry, no pre-confirmation booking and repeat-confirmation idempotency')
