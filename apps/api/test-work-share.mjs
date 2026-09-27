import assert from 'node:assert/strict'
import { createWorkShare } from './work-share.mjs'
import { createSocialCopy } from './ai-utils.mjs'
const error = (status, code, message) => Object.assign(new Error(message), {status,code})
let context, calls=0
const rows = new Map([['a',{id:'a',tenant_id:'shop-a',user_id:'u1',store_id:'store-a'}],['b',{id:'b',tenant_id:'shop-b',user_id:'u2'}],['pending',{id:'pending',tenant_id:'shop-a',user_id:'u1',store_id:'store-a'}]])
const deps = { db:{prepare(sql){return {get(id,tid){if(sql.includes('FROM bookings')){const r=rows.get(id);return r?.tenant_id===tid?r:undefined}return {name:'测试门店'}}}}}, resolveTenant:req=>req.tenant,tenantContext:{enterWith:x=>context=x.tenantId},requireAdmin:req=>{if(!req.admin)throw error(401,'UNAUTHORIZED','login');return req.admin},requireCustomer:req=>{if(!req.customer)throw error(401,'UNAUTHORIZED','login');return req.customer},assertStaffCanAccessBooking:(a,b)=>{if(a.role==='staff'&&a.technicianId!==b.technician_id)throw error(403,'FORBIDDEN','own work only')},serializeBooking:row=>({id:row.id,service:{name:'日式基础款'},technician:{name:'Kiki'},galleryStatus:row.id==='pending'?'draft':'approved',workImages:['private-draft'],approvedWorkImages:['approved-a','approved-b']}),requireAi:()=>{},countAiUsage:()=>calls++,createSocialCopy:async args=>args,apiError:error }
const share=createWorkShare(deps), owner={tenant:'shop-a',headers:{'x-tenant-id':'shop-a'},admin:{role:'owner',tenantId:'shop-a'}},customer={tenant:'shop-a',customer:{id:'u1'}}
assert.equal(share.read(owner,{},'a').booking.store.name,'测试门店')
assert.equal(context,'shop-a')
assert.equal(share.read(customer,{},'a').audience,'customer')
console.log('ok 1 - owner and the booking customer receive server-derived shop context')
for(const req of [{tenant:'shop-a'}, {tenant:'shop-a',customer:{id:'u2'}},{tenant:'shop-a',headers:{'x-tenant-id':'shop-a'},admin:{role:'owner',tenantId:'shop-b'}},{tenant:'shop-a',admin:{role:'staff',tenantId:'shop-a',technicianId:'other'}}])assert.throws(()=>share.read(req,{},'a'))
assert.throws(()=>share.read(owner,{},'b'))
assert.throws(()=>share.read(owner,{},'missing'))
console.log('ok 2 - anonymous, other customer, cross-tenant, other staff and missing records are denied')
assert.deepEqual(share.read(owner,{},'pending').booking.approvedWorkImages,[])
assert.equal(share.read(owner,{},'pending').booking.hasWorkImages,true)
console.log('ok 3 - pending images remain private despite the presence of work images')
for(const body of [{bookingId:'pending',platform:'meituan'},{bookingId:'a',platform:'unknown'},{bookingId:'a',platform:'meituan',imageIndex:99},{bookingId:'a',platform:'meituan',imageIndex:-1}])await assert.rejects(()=>share.generate(owner,{},body))
assert.equal(calls,0)
console.log('ok 4 - pending work, invalid platforms and out-of-range image indexes never invoke AI')
const result=await share.generate(owner,{}, {bookingId:'a',platform:'meituan',imageIndex:1,image:'attacker-image',booking:{service:{name:'forged'}}})
assert.equal(result.copy.image,'approved-b');assert.equal(result.copy.booking.service.name,'日式基础款');assert.equal(result.copy.brandName,'测试门店');assert.equal(calls,1)
console.log('ok 5 - generated copy uses the approved image and server booking, ignoring forged client context')
const actual=await createSocialCopy({platform:'meituan',brandName:'测试北京店',booking:{service:{name:'基础款'},technician:{name:'小林'}}})
const copy=actual.data||actual
assert.match(copy.captionZh,/小林/);assert.match(copy.titleZh,/测试北京店/);assert.doesNotMatch(JSON.stringify(copy),/Toronto|多伦多|五星|好评/)
console.log('ok 6 - Meituan copy uses the actual Chinese shop and technician without fabricated review claims')
console.log('PASS work-share: auth/tenant/ownership, empty/pending, image validation, server-derived context, Meituan bilingual copy')
