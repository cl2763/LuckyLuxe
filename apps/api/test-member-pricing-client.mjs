import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
const source=readFileSync(new URL('../../miniprogram/utils/member-pricing.js',import.meta.url),'utf8')
assert.equal(source,readFileSync(new URL('../web/member-pricing-shared.js',import.meta.url),'utf8'))
const store=new Map(),ctx={module:{exports:{}},wx:{getStorageSync:k=>store.get(k),setStorageSync:(k,v)=>store.set(k,structuredClone(v)),removeStorageSync:k=>store.delete(k)}}
vm.runInNewContext(source,ctx);const P=ctx.module.exports
assert.equal(P.options[0].rateBps,null);assert.equal(P.options[1].rateBps,10000);assert.equal(P.options[2].rateBps,9900)
const first={beneficiaryKey:'self'},friend={beneficiaryKey:'friend',servedPersonName:'同名'},friend2={beneficiaryKey:'friend2',servedPersonName:'同名'}
assert.equal(P.people([first,first,friend,friend,friend2]).length,3)
let sent
await assert.rejects(()=>P.mutation('u','/recharge',{amountCents:50000},async(path,b)=>{sent=structuredClone(b);throw Error('timeout')}),/待核实/)
assert.equal(P.pending('u').body.operationId,sent.operationId)
await assert.rejects(()=>P.mutation('u','/recharge',{amountCents:100},()=>{throw Error('must not submit')}),/尚未核实/)
await P.mutation('u','',{amountCents:100},async(path,b)=>{assert.equal(path,'/recharge');assert.equal(JSON.stringify(b),JSON.stringify(sent));return {duplicate:true}},true)
assert.equal(P.pending('u'),null)
await assert.rejects(()=>P.mutation('u','/recharge',{amountCents:0},async()=>{throw Object.assign(Error('invalid'),{statusCode:400})}),/invalid/)
assert.equal(P.pending('u'),null)
console.log('ok 1 - shared web/mini wheel contract and same-name beneficiary identity')
console.log('ok 2 - timeout persists exact operation; edited duplicate blocked; retry reuses request; rejected input can be corrected')

const writes=[],alerts=[],daily={module:{exports:{}},require:k=>k==='./api'?{adminPost:async(u,b)=>{writes.push({u,b});return {}}}:{},wx:{showToast:o=>alerts.push(o.title)}}
vm.runInNewContext(readFileSync(new URL('../../miniprogram/utils/dailyclose.js',import.meta.url),'utf8'),daily)
const page={data:{reason:'核对服务金额',correcting:{id:'synthetic',memberDocument:true}},setData(){},loadClose(){}}
for(const invalid of ['', '-1','1.234','abc','1,000','1000001']){page.data.newTotal=invalid;await daily.module.exports.dailyCloseMixin.submitCorrect.call(page)}
assert.equal(writes.length,0);assert.equal(alerts.length,6)
page.data.newTotal='0.00';page.data.amendPreview={serviceTotalCents:0,reviewHash:'zero'};await daily.module.exports.dailyCloseMixin.submitCorrect.call(page);assert.equal(writes[0].b.serviceTotalCents,0)
page.data.newTotal='125.50';page.data.amendPreview={serviceTotalCents:12550,reviewHash:'amount'};await daily.module.exports.dailyCloseMixin.submitCorrect.call(page);assert.equal(writes[1].b.serviceTotalCents,12550)
console.log('ok 3 - whole-document correction rejects blank, negative and malformed amounts while explicit zero remains valid')

// Read models must not truncate a shared-card visit or bypass staff visibility.
const {DatabaseSync}=await import('node:sqlite')
const {memberDocumentSummary}=await import('./member-document-summary.mjs')
const {memberPricingPerformanceDetails}=await import('./member-pricing-performance.mjs')
const db=new DatabaseSync(':memory:')
db.exec(`CREATE TABLE member_service_documents(id TEXT,tenant_id TEXT,user_id TEXT,group_id TEXT,status TEXT,quote_json TEXT,signed_json TEXT,signed_at TEXT);
CREATE TABLE member_document_components(document_id TEXT,settlement_id TEXT);
CREATE TABLE settlements(id TEXT,booking_id TEXT,tenant_id TEXT);
CREATE TABLE settlement_technicians(settlement_id TEXT,tenant_id TEXT,technician_id TEXT);
CREATE TABLE daily_closes(tenant_id TEXT,date TEXT,status TEXT);
CREATE TABLE stored_value_transactions(id TEXT,tenant_id TEXT,technician_id TEXT,type TEXT,amount_cents INTEGER,created_at TEXT);`)
const q={name:'卡主',totalCents:6500,rechargeCents:5000,purchaseCents:0,display:{beneficiaryName:'卡主',customerName:'会员',discountText:'8.5折',lines:[{name:'服务'}]},components:[{totalCents:6500,recharge:{amountCents:5000},technicians:[{technicianId:'t'}],lines:[{name:'服务'}]}]}
const putDoc=(id,tenant,group,status,quote=q)=>db.prepare('INSERT INTO member_service_documents VALUES(?,?,?,?,?,?,?,?)').run(id,tenant,'u',group,status,JSON.stringify(quote),status==='signed'?JSON.stringify(quote):null,'2026-11-14T12:00:00Z')
putDoc('owner','a','g','signed');putDoc('friend','a','g','pending_sign');putDoc('outsider','b','g','signed')
for(const [d,b,t]of[['owner','booking1','a'],['friend','booking2','a'],['outsider','foreign','b']]){db.prepare('INSERT INTO settlements VALUES(?,?,?)').run(d,b,t);db.prepare('INSERT INTO member_document_components VALUES(?,?)').run(d,d);db.prepare('INSERT INTO settlement_technicians VALUES(?,?,?)').run(d,t,'t')}
let summary=memberDocumentSummary(db,'booking1','a',String)
assert.equal(summary.documents.length,2);assert.equal(summary.statusText,'已签 1/2 张');assert.equal(summary.groupId,'g')
db.prepare("UPDATE member_service_documents SET status='voided' WHERE id='friend'").run()
putDoc('replacement','a','newgroup','pending_sign',{...q,replacesDocumentId:'friend'})
summary=memberDocumentSummary(db,'booking2','a',String)
assert.deepEqual(summary.documents.map(x=>x.id),['owner','replacement']);assert.equal(summary.groupId,'g')
assert.equal(memberDocumentSummary(db,'booking1','b',String),null)
db.exec("INSERT INTO daily_closes VALUES('a','2026-11-14','confirmed'); INSERT INTO stored_value_transactions VALUES('r','a','t','recharge',5000,'2026-11-14T12:00:00Z'),('b','a','t','bonus',500,'2026-11-14T12:00:00Z'),('foreign','b','t','recharge',999,'2026-11-14T12:00:00Z'),('othertech','a','other','recharge',999,'2026-11-14T12:00:00Z'),('notclosed','a','t','recharge',999,'2026-11-13T12:00:00Z');")
db.exec('ALTER TABLE stored_value_transactions ADD COLUMN reversal_of TEXT');
const options={tenantId:'a',technicianId:'t',month:'2026-11',view:{hero:{},visibility:'perf_only',displayMode:'with_split'},localDate:s=>s.slice(0,10),money:String}
const details=memberPricingPerformanceDetails(db,options)
assert.equal(details.services.length,1);assert.equal(details.services[0].amountText,'1500');assert.equal(details.services[0].discount,'8.5折');assert.deepEqual(details.recharges.map(x=>x.amountText).sort(),['500','5000'])
assert.equal(memberPricingPerformanceDetails(db,{...options,view:{...options.view,displayMode:'total_only'}}),null)
assert.equal(memberPricingPerformanceDetails(db,{...options,view:{...options.view,visibility:'salary_only'}}),null)
assert.equal(memberPricingPerformanceDetails(db,{...options,technicianId:'nobody'}).services.length,0)
db.exec("INSERT INTO stored_value_transactions VALUES('reverse','a','t','reversal',-5000,'2026-11-14T12:00:00Z','r')");assert.ok(memberPricingPerformanceDetails(db,options).recharges.find(r=>r.id==='r').label.includes('已冲销'))
db.close()
console.log('ok 4 - booking summaries include the complete visit and pending replacements without cross-tenant disclosure')
console.log('ok 5 - performance facts preserve signed discount, exclude recharge from service amounts and honor technician/closed-day/visibility scope')

const customerCtx={window:{}};vm.runInNewContext(readFileSync(new URL('../web/member-pricing-customer.js',import.meta.url),'utf8'),customerCtx)
const C=customerCtx.window.MemberPricingCustomer;let savedUser=null
const customerState={user:{id:'u',balanceCents:0}}
await C.refreshUser(customerState,async path=>{assert.equal(path,'/users/u');return {user:{id:'u',balanceCents:37200,memberLevel:'会员'}}},u=>savedUser=u)
assert.equal(customerState.user.balanceCents,37200);assert.equal(savedUser.balanceCents,37200)
await assert.rejects(()=>C.refreshUser(customerState,async()=>({user:{id:'foreign'}}),()=>assert.fail('must not save mismatched user')),/资料校验失败/)
await assert.rejects(()=>C.refreshUser(customerState,async()=>{throw Error('offline')},()=>assert.fail('must not save failed fetch')),/offline/)
assert.equal(customerState.user.balanceCents,37200)
await C.refreshUser(customerState,async()=>{customerState.user=null;return {user:{id:'u'}}},()=>assert.fail('must not restore logged-out session'))
assert.equal(customerState.user,null)
console.log('ok 6 - profile refresh uses authoritative values, rejects mismatched user and never restores a logged-out session')
const cartState={cart:[{id:'keep',service:{id:'service'},technician:{id:'tech'},date:'2026-11-20',time:'14:00',addOns:[{id:'addon'}],remark:'原备注',referenceImages:['image']}],view:'cart'}
let prepared=0,rendered=0
await C.editCart(cartState,'missing',{prepareBooking:()=>assert.fail('missing item must not navigate')})
await C.editCart(cartState,'keep',{prepareBooking:async mode=>{assert.equal(mode,'cart');prepared++;cartState.selectedSlot='09:00'},loadAvailability:async()=>{assert.equal(cartState.selectedTechId,'tech');assert.equal(cartState.date,'2026-11-20');cartState.selectedSlot='09:30'},render:()=>rendered++,toast:()=>assert.fail('valid draft should open')})
assert.equal(prepared,1);assert.equal(rendered,1);assert.equal(cartState.editCartId,'keep');assert.equal(cartState.selectedSlot,'14:00');assert.equal(cartState.remark,'原备注');assert.equal(cartState.selectedAddOns.has('addon'),true);assert.equal(cartState.cart.length,1)
console.log('ok 7 - cart editing preserves project, date, technician, additions, remark and selected slot across availability reload')

const {storedValueReversalFacts}=await import('./stored-value-reversal-display.mjs')
const receiptDb=new DatabaseSync(':memory:')
receiptDb.exec('CREATE TABLE member_pricing_operations(tenant_id TEXT,user_id TEXT,source TEXT,result_json TEXT);CREATE TABLE stored_value_transactions(id TEXT,tenant_id TEXT,user_id TEXT,type TEXT,amount_cents INTEGER)')
const original={id:'recharge',user_id:'u',type:'recharge',amount_cents:50000}
assert.deepEqual(storedValueReversalFacts(receiptDb,'a',original),{principalCents:50000,bonusCents:null,bonusLinkKnown:false})
receiptDb.prepare('INSERT INTO member_pricing_operations VALUES(?,?,?,?)').run('a','u','recharge',JSON.stringify({rechargeTxnId:'recharge',bonusTxnId:'bonus'}))
receiptDb.exec("INSERT INTO stored_value_transactions VALUES('bonus','b','u','bonus',5000)")
assert.equal(storedValueReversalFacts(receiptDb,'a',original).bonusLinkKnown,false)
receiptDb.exec("INSERT INTO stored_value_transactions VALUES('bonus','a','u','bonus',5000)")
assert.equal(storedValueReversalFacts(receiptDb,'a',original).bonusCents,5000)
assert.equal(storedValueReversalFacts(receiptDb,'b',original).bonusCents,null)
assert.equal(storedValueReversalFacts(receiptDb,'a',{...original,type:'bonus'}),null)
receiptDb.close()
console.log('ok 8 - reversal display only uses explicit same-tenant recharge receipts; unlinked legacy bonus remains unknown')

const checkoutCtx={window:{MemberPricingInput:P}};vm.runInNewContext(readFileSync(new URL('../web/booking-checkout.js',import.meta.url),'utf8'),checkoutCtx)
const B=checkoutCtx.window.BookingCheckout,cs={tenant:'t',user:{id:'checkout-u'},view:'checkout',cart:[{id:'row',selected:true,service:{id:'service'},technician:{id:'tech'},date:'2026-11-20',time:'14:00'}],checkoutUseBalance:true}
let seq=0
await B.preview(cs,async path=>path.includes('preview')?{reviewHash:'hash',display:{offlineText:'CAD 0'}}:{text:{zh:'规则'}},()=>{})
assert.equal(cs.checkoutPreview.reviewHash,'hash')
let checkoutOriginal
await assert.rejects(()=>B.submit(cs,async(path,b)=>{checkoutOriginal=JSON.parse(b.body);throw Error('network timeout')}),/待核实/)
cs.cart[0].time='15:00'
await B.submit(cs,async(path,b)=>{const retry=JSON.parse(b.body);assert.equal(retry.operationId,checkoutOriginal.operationId);assert.equal(retry.items[0].time,'14:00');return {bookings:[{id:'booked'}]}},true)
assert.equal(B.pending(cs),null)
await assert.rejects(()=>B.submit(cs,async()=>assert.fail('changed cart must be re-previewed')),/重新核对/)
console.log('ok 9 - batch checkout persists its exact operation on timeout and retries the original schedule, while edited drafts need a fresh quote')
let cancelBody
await assert.rejects(()=>B.cancel('cancel-u',async(path,b)=>{if(path.endsWith('preview'))return {reviewHash:'cancel-hash',display:{}};cancelBody=JSON.parse(b.body);throw Error('offline')},async()=>true),/待核实/)
await B.cancel('cancel-u',async(path,b)=>{assert.equal(path,'/bookings/cancel-u/cancel');assert.equal(JSON.parse(b.body).reviewHash,cancelBody.reviewHash);return {booking:{id:'cancel-u'}}},async()=>assert.fail('unknown cancellation retries original confirmation'))
console.log('ok 10 - cancellation with unknown result retains its original confirmation and retries without creating a new refund intention')
await assert.rejects(()=>B.cancel('legacy-u',async(path)=>{if(path.endsWith('preview'))return {reviewHash:'legacy',display:{}};throw Error('timeout')},async()=>true),/待核实/)
const legacyResult=await B.cancel('legacy-u',async(path)=>{if(path.endsWith('/cancel'))throw Object.assign(Error('already cancelled'),{status:400});assert.equal(path,'/bookings/legacy-u');return {booking:{id:'legacy-u',status:'cancelled'}}},async()=>assert.fail('must recover original cancellation'))
assert.equal(legacyResult.booking.status,'cancelled')
console.log('ok 11 - legacy cancel timeout recovers confirmed cancelled state instead of reporting a false refund failure')
let miniPage,successModal=null,miniCartCleared=false
const miniStorage={addOrder(){},removeCartItems(){miniCartCleared=true}},miniApi={isLoggedIn:()=>true,getAuth:()=>({userId:'u'}),currentTenantId:()=> 't',submitBookingCheckout:async()=>({bookings:[{id:'saved',service:{name:'s'}}],preview:{}}),refreshMember:async()=>{throw Error('profile offline')}}
const miniCtx={Page:x=>miniPage=x,require:p=>p.endsWith('nav')?{to:(u,f)=>f(),tab(){}}:p.endsWith('storecurrency')?{}:p.endsWith('storage')?miniStorage:p.endsWith('i18n')?{pageCopy:()=>({})}:p.endsWith('member-pricing')?{pending:()=>null,bookingMutation:async(k,p,b,send)=>send(p,b)}:miniApi,wx:{navigateTo:o=>o.fail(),showModal:o=>successModal=o,setStorageSync(){},getStorageSync:()=>({})},setTimeout,clearTimeout}
vm.runInNewContext(readFileSync(new URL('../../miniprogram/pages/checkout/index.js',import.meta.url),'utf8'),miniCtx)
miniPage.data={...miniPage.data,items:[{_id:'row',service:{name:'s'}}],preview:{reviewHash:'h'}};miniPage._payload={items:[{clientItemId:'row'}]};miniPage.setData=x=>Object.assign(miniPage.data,x)
await miniPage.submitOrder();await new Promise(r=>setTimeout(r,0));assert.equal(miniCartCleared,true);assert.equal(successModal.title,'预约已提交');assert.equal(miniPage.data.error,'');assert.equal(miniPage.data.busy,false)
console.log('ok 12 - committed mini checkout stays successful when profile refresh and receipt navigation fail')
for(const status of [401,403]){
 const authState={...cs,user:{id:'auth-'+status},cart:[{...cs.cart[0]}]}
 await B.preview(authState,async path=>path.includes('preview')?{reviewHash:'before-auth'}:{},()=>{})
 let original
 await assert.rejects(()=>B.submit(authState,async(path,b)=>{original=JSON.parse(b.body);throw Error('timeout')}),/待核实/)
 await assert.rejects(()=>B.submit(authState,async()=>{throw Object.assign(Error('login expired'),{status})},true),/待核实/)
 assert.equal(B.pending(authState).body.operationId,original.operationId)
 await B.submit(authState,async(path,b)=>{assert.deepEqual(JSON.parse(b.body),original);return {bookings:[{id:'confirmed'}]}},true)
 assert.equal(B.pending(authState),null)
 const id='auth-cancel-'+status
 await assert.rejects(()=>B.cancel(id,async path=>{if(path.endsWith('preview'))return {reviewHash:'original-cancel',display:{}};throw Error('timeout')},async()=>true),/待核实/)
 const before=P.pending('booking-cancel:'+id)
 await assert.rejects(()=>B.cancel(id,async()=>{throw Object.assign(Error('login expired'),{status})},async()=>assert.fail('must not re-confirm unknown cancellation')),/待核实/)
 assert.equal(P.pending('booking-cancel:'+id).body.operationId,before.body.operationId)
 await B.cancel(id,async(path,b)=>{assert.equal(JSON.parse(b.body).operationId,before.body.operationId);return {booking:{id,status:'cancelled'}}},async()=>assert.fail('must retry original'))
 assert.equal(P.pending('booking-cancel:'+id),null)
}
console.log('ok 13 - booking and cancellation auth expiry after timeout retain exact keys through 401/403 and recover without a duplicate operation')
await assert.rejects(()=>P.bookingMutation('changed-booking','/my/booking-checkout',{reviewHash:'stale'},async()=>{throw Error('timeout')}),/待核实/)
await assert.rejects(()=>P.bookingMutation('changed-booking','',{},async()=>{throw Object.assign(Error('new quote required'),{status:409,code:'CHECKOUT_CHANGED'})},true),/new quote/)
assert.equal(P.pending('changed-booking'),null)
await assert.rejects(()=>P.bookingMutation('invalid-booking','/my/booking-checkout',{},async()=>{throw Object.assign(Error('invalid input'),{statusCode:400})}),/invalid input/)
assert.equal(P.pending('invalid-booking'),null)
console.log('ok 14 - explicit no-write checkout change and initial invalid input still clear pending for a corrected quote')
let authMiniPage
const authMiniApi={...miniApi,getAuth:()=>({userId:'auth-mini'}),submitBookingCheckout:async()=>{throw Error('timeout')}}
vm.runInNewContext(readFileSync(new URL('../../miniprogram/pages/checkout/index.js',import.meta.url),'utf8'),{...miniCtx,Page:x=>authMiniPage=x,require:p=>p.endsWith('nav')?{to:(u,f)=>f(),tab(){}}:p.endsWith('storecurrency')?{}:p.endsWith('storage')?miniStorage:p.endsWith('i18n')?{pageCopy:()=>({})}:p.endsWith('member-pricing')?P:authMiniApi})
authMiniPage.data={...authMiniPage.data,items:[{_id:'mini-original'}],preview:{reviewHash:'mini-hash'}};authMiniPage._payload={items:[{clientItemId:'mini-original'}]};authMiniPage.setData=x=>Object.assign(authMiniPage.data,x)
await authMiniPage.submitOrder();const originalMini=P.pending(authMiniPage.pendingKey()).body.operationId
authMiniApi.submitBookingCheckout=async()=>{throw Object.assign(Error('expired'),{statusCode:401})};await authMiniPage.submitOrder();assert.equal(P.pending(authMiniPage.pendingKey()).body.operationId,originalMini);assert.equal(authMiniPage.data.pending,true)
authMiniApi.submitBookingCheckout=async b=>{assert.equal(b.operationId,originalMini);return {bookings:[{id:'mini-auth-recovered'}],preview:{}}};await authMiniPage.submitOrder();assert.equal(P.pending(authMiniPage.pendingKey()),null)
console.log('ok 15 - mini submit uses the booking-specific auth recovery contract and preserves original item identity')
let cancelMiniPage
const cancelMiniApi={currentTenantId:()=> 't',previewBookingCancel:async()=>({reviewHash:'mini-cancel-hash',display:{}}),cancelBooking:async()=>{throw Error('timeout')},getBookings:async()=>{throw Object.assign(Error('expired'),{statusCode:403})},refreshMember:async()=>null}
vm.runInNewContext(readFileSync(new URL('../../miniprogram/pages/order-detail/index.js',import.meta.url),'utf8'),{Page:x=>cancelMiniPage=x,require:p=>p.endsWith('member-pricing')?P:p.endsWith('api')?cancelMiniApi:p.endsWith('storage')?{setOrders(){}}:p.endsWith('i18n')?{pageCopy:()=>({})}:{},wx:{showModal:o=>o.success?.({confirm:true}),showToast(){}},setTimeout,clearTimeout})
cancelMiniPage.data.order={_id:'mini-auth-cancel'};cancelMiniPage.load=async()=>{};cancelMiniPage.setData=x=>Object.assign(cancelMiniPage.data,x)
let miniCancellation=cancelMiniPage.cancelOrder();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(cancelMiniPage.data.cancelPreview.reviewHash,'mini-cancel-hash');cancelMiniPage.cancelDecision({currentTarget:{dataset:{confirm:false}}});await miniCancellation;assert.equal(P.pending('booking-cancel:t:mini-auth-cancel'),null)
miniCancellation=cancelMiniPage.cancelOrder();await new Promise(resolve=>setTimeout(resolve,0));cancelMiniPage.cancelDecision({currentTarget:{dataset:{confirm:true}}});await miniCancellation;const miniCancelKey='booking-cancel:t:mini-auth-cancel',miniCancelOriginal=P.pending(miniCancelKey).body.operationId
cancelMiniApi.cancelBooking=async()=>{throw Object.assign(Error('expired'),{statusCode:403})};await cancelMiniPage.cancelOrder();assert.equal(P.pending(miniCancelKey).body.operationId,miniCancelOriginal)
cancelMiniApi.cancelBooking=async()=>({booking:{status:'cancelled'}});await cancelMiniPage.cancelOrder();assert.equal(P.pending(miniCancelKey),null)
console.log('ok 16 - mini cancellation retains the original operation when both retry and status lookup lose authorization')
let wheelComponent
vm.runInNewContext(readFileSync(new URL('../../miniprogram/components/discount-wheel/index.js',import.meta.url),'utf8'),{require:()=>P,Component:x=>wheelComponent=x})
const wheel={...wheelComponent.methods,data:{...wheelComponent.data},setData(x){Object.assign(this.data,x)},triggerEvent(n,v){this.emitted=v}}
wheel.sync(null);assert.equal(wheel.data.selectedText,'按门店默认会员价');assert.equal(wheel.data.options.length,100);assert.ok(wheel.data.options.every(o=>o.rateBps!==null));wheel.change({detail:{value:0}});assert.equal(wheel.emitted.rateBps,10000);wheel.change({detail:{value:99}});assert.equal(wheel.emitted.rateBps,100);wheel.change({detail:{value:100}});assert.equal(wheel.emitted.rateBps,100)
console.log('ok 17 - picker preserves historical unset display while offering only no-discount and 0.1–9.9 choices')

const closeCtx={window:{},document:{querySelector:()=>null}};vm.runInNewContext(readFileSync(new URL('../web/daily-close-rows.js',import.meta.url),'utf8'),closeCtx)
const closeState={view:{settlements:[{settlementId:'component',code:'old',serviceDocument:{id:'person-doc'}}]}}
let closeRender=0
assert.equal(await closeCtx.window.DailyCloseRows.handleClick({target:{closest:s=>s==='[data-dc-correct]'?{dataset:{dcCorrect:'component'}}:null}},{state:closeState,request:async path=>{assert.equal(path,'/admin/member-pricing/documents/person-doc');return {id:'person-doc',quote:{display:{beneficiaryName:'顾客',discountText:'8.5折'},components:[{lines:[]}]},correction:{serviceTotalCents:17000}}},toast:assert.fail,renderDailyClose:()=>closeRender++,zh:true}),true)
await new Promise(r=>setTimeout(r,0));assert.equal(closeState.correcting.memberDocument,true);assert.equal(closeState.correcting.totalCents,17000);assert.equal(closeRender,1)
console.log('ok 18 - real daily-close correction click loads the person document and renders without an ASI exception')

let changePreview,previewJob;const amountField={value:'160',addEventListener:(name,fn)=>changePreview=fn},submitField={},previewText={};const previewElements={'#dcNewTotal':amountField,'#dcCorrectSubmit':submitField,'#dcAmendPreview':previewText}
const previewCtx={window:{},document:{querySelector:s=>previewElements[s]},setTimeout:f=>{previewJob=f;return 1},clearTimeout(){}}
vm.runInNewContext(readFileSync(new URL('../web/daily-close-rows.js',import.meta.url),'utf8'),previewCtx)
const previewState={correcting:{id:'person-doc',memberDocument:true}};let requests=0,failPreview=false
previewCtx.window.DailyCloseRows.bindCorrectionPreview(previewState,async(path,body)=>{requests++;assert.ok(path.endsWith('/amend-preview'));assert.equal(JSON.parse(body.body).serviceTotalCents,16000);if(failPreview)throw Error('network');return {reviewHash:'verified',balanceEffectText:'退回储值 CAD $10.00'}})
assert.equal(submitField.disabled,true);await previewJob();assert.equal(submitField.disabled,false);assert.equal(previewState.correcting.amendPreview.reviewHash,'verified');assert.equal(previewText.textContent,'退回储值 CAD $10.00')
amountField.value='';changePreview();await previewJob();assert.equal(submitField.disabled,true);assert.equal(previewState.correcting.amendPreview,null);assert.equal(requests,1)
amountField.value='160';failPreview=true;changePreview();await previewJob();assert.equal(submitField.disabled,true);assert.equal(previewState.correcting.amendPreview,null);assert.match(previewText.textContent,/network/)
console.log('ok 19 - correction preview gates submit until backend verification and blocks invalid input or failed refresh')
await assert.rejects(()=>P.mutation('recharge-auth','/admin/stored-value/recharge',{amountCents:10000},async()=>{throw Error('timeout')}),/待核实/)
const rechargeAuth=P.pending('recharge-auth').body.operationId
await assert.rejects(()=>P.mutation('recharge-auth','',{},async()=>{throw Object.assign(Error('expired'),{status:401})},true),/待核实/)
assert.equal(P.pending('recharge-auth').body.operationId,rechargeAuth)
await P.mutation('recharge-auth','',{},async(path,b)=>{assert.equal(path,'/admin/stored-value/recharge');assert.equal(b.operationId,rechargeAuth);assert.equal(b.amountCents,10000);return {ok:true}},true)
assert.equal(P.pending('recharge-auth'),null)
console.log('ok 20 - ordinary recharge mutation retains its unknown operation through expired authorization')
const {memberDiscountReceipt}=await import('./member-discount-receipt.mjs')
const receiptFactsDb=new DatabaseSync(':memory:')
receiptFactsDb.exec('CREATE TABLE member_pricing_operations(tenant_id TEXT,user_id TEXT,source TEXT,result_json TEXT,created_at TEXT);CREATE TABLE stored_value_transactions(id TEXT,tenant_id TEXT,user_id TEXT,type TEXT,amount_cents INTEGER)')
const receiptResult={rechargeTxnId:'receipt-r',bonusTxnId:'receipt-b',discountReceipt:{before:{rateBps:9000},after:{rateBps:8500,statusText:'有效'},actor:'经手人'}}
receiptFactsDb.prepare('INSERT INTO member_pricing_operations VALUES(?,?,?,?,?)').run('t','u','recharge',JSON.stringify(receiptResult),'2026-11-15T01:30:00Z')
receiptFactsDb.exec("INSERT INTO stored_value_transactions VALUES('receipt-r','t','u','recharge',50000);INSERT INTO stored_value_transactions VALUES('receipt-b','other','u','bonus',5000)")
let receiptFacts=memberDiscountReceipt(receiptFactsDb,'t','u','receipt-r','America/Toronto')
assert.equal(receiptFacts.receiptId,'receipt-r');assert.equal(receiptFacts.principalCents,50000);assert.equal(receiptFacts.bonusCents,null);assert.equal(receiptFacts.bonusLinkKnown,false);assert.equal(receiptFacts.createdText,'2026-11-14 20:30（America/Toronto）');assert.equal(memberDiscountReceipt(receiptFactsDb,'other','u','receipt-r','America/Toronto'),null)
receiptFactsDb.exec("INSERT INTO stored_value_transactions VALUES('receipt-b','t','u','bonus',5000)");receiptFacts=memberDiscountReceipt(receiptFactsDb,'t','u','receipt-r','America/Toronto');assert.equal(receiptFacts.bonusCents,5000);assert.equal(receiptFacts.bonusLinkKnown,true);receiptFactsDb.close()
console.log('ok 21 - recharge receipt uses same-tenant linked gift money and store-local date, with unknown association kept explicit')
let plainBenefits
vm.runInNewContext(readFileSync(new URL('../../miniprogram/pages/member-benefits/index.js',import.meta.url),'utf8'),{Page:x=>plainBenefits=x,require:p=>p.endsWith('api')?{refreshMember:async()=>({tiersEnabled:false,memberLevel:'会员',memberTiers:[]})}:p.endsWith('i18n')?{getLang:()=> 'zh'}:{curOf:()=>({p:'CAD',s:'$'})},wx:{setNavigationBarTitle(){}}})
plainBenefits.setData=x=>Object.assign(plainBenefits.data,x);await plainBenefits.onShow();assert.equal(plainBenefits.data.plainStore,true);assert.equal(plainBenefits.data.isMemberNow,true);assert.equal(plainBenefits.data.benefits.length,0)
console.log('ok 22 - non-tiered store benefits load without dereferencing a missing tier')

let walletHtml='',walletLoaded=0,walletRendered=0,walletConfirmed;const walletStatus={textContent:''},walletButton={dataset:{confirmRecharge:'legacy-recharge'},closest:()=>({querySelector:()=>walletStatus})}
const walletScreen={set innerHTML(v){walletHtml=v},get innerHTML(){return walletHtml},querySelectorAll:()=>walletHtml.includes('data-confirm-recharge="legacy-recharge"')?[walletButton]:[]}
const walletCtx={window:{MemberPricingCustomer:{benefits(){}}},document:{getElementById:()=>({})}};vm.runInNewContext(readFileSync(new URL('../web/customer-wallet.js',import.meta.url),'utf8'),walletCtx)
walletCtx.window.CustomerWallet.renderStoredValue({state:{view:'storedValue',wallet:{balanceCents:50000,txns:[{id:'legacy-recharge',type:'recharge',typeText:'充值到账',amountCents:50000,needsConfirm:true,discountReceipt:null}]}},els:{screen:walletScreen},zh:true,escapeHtml:x=>String(x??''),money:n=>'CAD '+n/100,render:()=>walletRendered++,loadWallet:async()=>walletLoaded++,request:async(path,options)=>{walletConfirmed={path,body:JSON.parse(options.body)}}})
assert.ok(walletHtml.includes('确认已核对'));assert.ok(!walletHtml.includes('本金 / 赠金'));assert.ok(!walletHtml.includes('个人折扣：'))
await walletButton.onclick();assert.equal(walletConfirmed.path,'/my/stored-value/confirm');assert.equal(walletConfirmed.body.id,'legacy-recharge');assert.equal(walletLoaded,1);assert.equal(walletRendered,1)
console.log('ok 23 - old pending recharge without a personal-discount receipt retains real acknowledgement without invented fields')

const eligibilityConfig={active:true,settlementTypes:['list','member','share']},eligibilityGroups=[{tierKey:'list',tierDefault:'list',tierChanged:false}];
assert.equal(P.availableTypes(eligibilityConfig,null,{eligible:false}).some(t=>t.key==='member'),false)
P.syncTier(eligibilityGroups,{eligible:true});assert.equal(eligibilityGroups[0].tierKey,'member');assert.equal(P.availableTypes(eligibilityConfig,{eligible:true},{eligible:false}).some(t=>t.key==='member'),true)
P.syncTier(eligibilityGroups,{eligible:false});assert.equal(eligibilityGroups[0].tierKey,'list');assert.equal(P.availableTypes(eligibilityConfig,{eligible:false},{eligible:true}).some(t=>t.key==='member'),false)
console.log('ok 24 - effective catalog eligibility enables member tier only after recharge preview and removes it when recharge is withdrawn')

const {verifyMemberPricingDOM}=await import('./test-member-pricing-dom.mjs')
await verifyMemberPricingDOM()
console.log('ok 25 - nested picker confirms/cancels only its draft; owner/refund/reversal outer actions validate, commit or cancel independently')
const adminSource=readFileSync(new URL('../web/admin.js',import.meta.url),'utf8'),editorSource=readFileSync(new URL('../web/member-pricing-editors.js',import.meta.url),'utf8')
const catalogContext={pricingState:{items:[{id:'service',categoryId:'nail'}]},cents:x=>String(x/100)}
vm.runInNewContext(adminSource.slice(adminSource.indexOf('function editorFromService('),adminSource.indexOf('// ===== 周排班网格')),catalogContext)
assert.equal(catalogContext.editorFromService({id:'service'}).categoryId,'nail');assert.equal(catalogContext.editorFromService({id:'service',categoryId:'lash'}).categoryId,'lash')
let catalogListHtml='',catalogSaved=20000,catalogReloads=0
const catalogList={before(){},after(){},set innerHTML(v){catalogListHtml=v}},catalogOwner={lang:'zh',services:[{id:'service',nameZh:'项目',priceCents:20000,durationMin:60}],serviceEditor:{id:'service',mode:'edit'}}
const catalogState={items:[{id:'service',categoryId:'nail',displayReference:{prices:{list:{priceCents:20000}}}}],categories:[{id:'nail',name:'美甲'}]}
const editorContext={owner:catalogOwner,pricingState:catalogState,els:{serviceAdminList:catalogList},window:{MemberPricingSettings:{read:()=>({prices:{list:{priceCents:21000}}})}},document:{querySelector:()=>({})},FormData:class{get(k){return {nameZh:'项目',nameEn:'Service',price:'200',duration:'60',deposit:'0',sortOrder:'1',categoryId:'nail'}[k]??''}},dollarsToCents:v=>Number(v)*100,toast(){},t:x=>x,escapeHtml:String,money:x=>String(x/100),request:async(path,options)=>{catalogSaved=JSON.parse(options.body).priceSystemUpdate.prices.list.priceCents},loadAll:async()=>{},loadPricingPage:async()=>{catalogReloads++;catalogState.items[0].displayReference.prices.list.priceCents=catalogSaved;editorContext.renderServices()}}
vm.runInNewContext(editorSource,editorContext);vm.runInNewContext(readFileSync(new URL('../web/service-catalog.js',import.meta.url),'utf8'),editorContext);editorContext.renderServiceEditor=()=>{}
await editorContext.saveServiceEditor({preventDefault(){},target:{dataset:{}}});assert.equal(catalogReloads,1);assert.match(catalogListHtml,/展示原价 210/);assert.doesNotMatch(catalogListHtml,/展示原价 200/)
console.log('ok 26 - service editor preserves category and saved display price is reloaded into the list independently of legacy settlement price')

const accountSource=readFileSync(new URL('../web/account-adjust.js',import.meta.url),'utf8')
let doneCount=0,txnsRefreshed=0,reverseFail=false
const reversalContext={el:()=>null,stateA:{userId:'u',busy:false,month:'2026-11',txns:[{id:'r',amountCents:1000,note:'test'}],pricing:{member:{rateBps:8500,revision:3}},retry:{}},ctx:{zh:true,toast(){},money:String,escapeHtml:String,onDone:x=>{assert.equal(x.reversed,true);doneCount++},request:async()=>({facts:{balanceCents:9000}})},window:{GiftRefundReview:{ask:async()=>({})},UIDialog:{confirm:async()=>true},CorrectionReason:{ask:async()=> '记账错误'},MemberPricingInput:{retryKey:()=> 'op'},MemberPricingMember:{confirm:async()=>({discountConfirmation:{rateBps:9000}}),read:async()=>({active:true,member:{rateBps:9000,revision:4}})}},mount(){},loadTxns:()=>txnsRefreshed++,mutate:async()=>{if(reverseFail)throw Error('rejected')}}
vm.runInNewContext(accountSource.slice(accountSource.indexOf('async function onClick('),accountSource.indexOf('  // 输入时重算')),reversalContext)
const reversalEvent={target:{closest:s=>s==='[data-aa-reverse]'?{dataset:{aaReverse:'r',kind:'sv'}}:null}}
await reversalContext.onClick(reversalEvent);assert.equal(doneCount,1);assert.equal(txnsRefreshed,1);assert.equal(reversalContext.stateA.rateBps,9000);assert.equal(reversalContext.stateA.pricing.member.revision,4);assert.equal(reversalContext.stateA.facts.balanceCents,9000)
reverseFail=true;await reversalContext.onClick(reversalEvent);assert.equal(doneCount,1);assert.equal(txnsRefreshed,1);assert.equal(reversalContext.stateA.busy,false)
console.log('ok 27 - successful reversal refreshes customer list, facts and discount revision; rejected reversal emits no success update')

const {memberDocumentDisplay}=await import('./member-document-display.mjs')
const displayBase={personalDiscount:{eligible:true,effectiveRateBps:8000,current:{balanceCents:0}},beneficiaryKey:'self',listTotalCents:10000,subtotalCents:10000,tierDiscountCents:0,couponDiscountCents:0,depositDeductCents:0,totalCents:10000,rechargeCents:0,purchaseCents:0,expectedBalanceAfterCents:0}
const displayComponent=tier=>({tierKey:tier,lines:[{kind:'main',name:'项目',amountCents:10000,listAmountCents:10000}],technicians:[],payment:{offlineCents:10000,storedUsedCents:0,timecardCoverCents:0}})
for(const [tier,label]of [['list','原价'],['share','分享价'],['course','疗程价']]){const d=memberDocumentDisplay({...displayBase,components:[displayComponent(tier)]},{money:String});assert.equal(d.discountText,label);assert.equal(d.rows[1].label,'价格优惠')}
assert.equal(memberDocumentDisplay({...displayBase,components:[displayComponent('member')]},{money:String}).discountText,'8.0折')
assert.equal(memberDocumentDisplay({...displayBase,components:[displayComponent('member'),displayComponent('list')]},{money:String}).discountText,'按各项目所选价档')
console.log('ok 28 - signed display reports the actual selected price tier; a member using list/share/course is never labelled as a personal discount applied')

let correctionReloads=0,customerReloads=0
const correctionState={date:'2026-11-15',correcting:{id:'doc',memberDocument:true,amendPreview:{serviceTotalCents:16000,reviewHash:'current'}}}
const correctionContext={window:{},document:{querySelector:s=>s==='#dcReason'?{value:'核对收费'}:s==='#dcNewTotal'?{value:'160'}:null}}
vm.runInNewContext(readFileSync(new URL('../web/daily-close-rows.js',import.meta.url),'utf8'),correctionContext)
await correctionContext.window.DailyCloseRows.handleClick({target:{closest:s=>s==='#dcCorrectSubmit'?{}:null}},{state:correctionState,request:async(path,b)=>{assert.equal(path,'/admin/member-pricing/documents/doc/amend');assert.equal(JSON.parse(b.body).reviewHash,'current');return {}},toast(){},loadDailyClose:async()=>correctionReloads++,onAmended:async()=>customerReloads++,yuanToCents:v=>Number(v)*100,zh:true})
await new Promise(r=>setImmediate(r));assert.equal(correctionReloads,1);assert.equal(customerReloads,1);assert.equal(correctionState.correcting,null)
assert.equal(await correctionContext.window.DailyCloseRows.handleClick({target:{closest:()=>null}},{}),false)
console.log('ok 29 - amount correction refreshes both day close and customer balances; unrelated finance actions remain unhandled')
const replacement={id:'new-pending',visitGroupId:'original-visit',groupId:'replacement',status:'pending_sign'},signedCompanion={id:'signed',status:'signed'};const batchAfter={documents:[signedCompanion,replacement]};let batchReads=[],batchRenders=0;
const recheckButton={},batchState={userId:'u',documentGroupId:'original-visit',pendingSheets:[{id:'old-pending',status:'pending_sign'}],_deps:{request:async path=>{batchReads.push(path);return path.endsWith('/review')?{documents:[],reviewHash:'review'}:batchAfter},toast:m=>assert.fail(m)}};
const batchContext={window:{MemberPricingInput:{mutation:async()=>({groupId:'replacement',documents:[replacement]})},UIDialog:{confirm:async()=>true}}};vm.runInNewContext(readFileSync(new URL('../web/member-pricing-composer.js',import.meta.url),'utf8'),batchContext);
batchContext.window.MemberPricingComposer.bind({querySelector:()=>recheckButton,querySelectorAll:()=>[]},batchState,{render:()=>batchRenders++,preview(){},newGroup(){}});await recheckButton.onclick();assert.equal(batchState.documentGroupId,'original-visit');assert.equal(batchState.pendingSheets.length,2);assert.equal(batchState.pendingSheets[0].id,'signed');assert.ok(batchReads.includes('/admin/member-pricing/groups/original-visit'));assert.equal(batchRenders,1);
let settleMixin,loadedVisit;const miniBatchContext={module:{exports:{}},require:p=>p.endsWith('/api')?{adminGet:async()=>({documents:[],reviewHash:'review'})}:{mutation:async()=>({groupId:'replacement',documents:[replacement]}),pending:()=>null},wx:{showModal:o=>o.success({confirm:true}),showToast:o=>assert.fail(o.title)}};vm.runInNewContext(readFileSync(new URL('../../miniprogram/pages/merchant/settlement/member-pricing.js',import.meta.url),'utf8'),miniBatchContext);settleMixin=miniBatchContext.module.exports;await settleMixin.mpRecheck.call({data:{userId:'u',memberDocuments:[{id:'old-pending',status:'pending_sign'}]},mpLoadBatch:async id=>loadedVisit=id});assert.equal(loadedVisit,'original-visit');
console.log('ok 30 - both merchant recheck actions reload the whole original visit, retaining signed companions')

let groupPage
vm.runInNewContext(readFileSync(new URL('../../miniprogram/pages/merchant/settlement/index.js',import.meta.url),'utf8'),{
 Page:p=>groupPage=p,require:p=>p==='../../../utils/member-pricing'?P:{},wx:{showToast:()=>assert.fail('unexpected toast')}
})
for(const active of [true,false]){
 const groups=['self','friend','friend'].map((beneficiaryKey,i)=>({...groupPage.makeGroup('member','nail'),beneficiaryKey,servedPersonName:i?'同名朋友':'',collapsed:true,mainId:'service-'+i,selectedTechs:['tech-'+i]}))
 const page={...groupPage,data:{groups,pricingConfig:{active}},setData(v){Object.assign(this.data,structuredClone(v))},renderGroup:g=>g}
 page.renderAll()
 const shown=()=>page.data.people.flatMap(p=>p.groups).find(g=>g.index===1)
 for(let i=0;i<5;i++){
  page.gToggleCollapse({currentTarget:{dataset:{g:1}}});assert.equal(shown().collapsed,false)
  assert.equal(shown().mainId,'service-1');assert.equal(shown().selectedTechs[0],'tech-1')
  assert.equal(page.data.people.flatMap(p=>p.groups).find(g=>g.index===2).collapsed,true)
  page.gToggleCollapse({currentTarget:{dataset:{g:1}}});assert.equal(shown().collapsed,true)
 }
 assert.equal(page.data.people.length,active?2:3)
}
console.log('ok 31 - reopening a collapsed project updates rendered people for both pricing modes without moving services or technicians')

const customerSource=readFileSync(new URL('../web/customer.js',import.meta.url),'utf8')
const customerFunction=name=>{const start=customerSource.indexOf('async function '+name+'(');return customerSource.slice(start,customerSource.indexOf('\n}\n',start)+3)}
const draftState={view:'checkout',user:null,cart:[{id:'draft',selected:true}],pendingAuth:null},draftEvents=[]
const draftContext={state:draftState,TENANT_ID:'draft-tenant',storeId:'draft-store',els:{authView:{classList:{add(){}}},appView:{classList:{remove(){}}},langZh:{classList:{toggle(){}}},langEn:{classList:{toggle(){}}},tabs:[]},requiresAuth:v=>v==='checkout',requireLogin:p=>{draftState.pendingAuth=p;draftEvents.push('login')},request(){},writeTenantJson(){},toast:assert.fail,render:()=>{assert.ok(draftState.user,'private checkout cannot render anonymously');draftEvents.push('render')},loadUserOrders:async()=>{},localStorage:{removeItem(){}},window:{MemberPricingCustomer:{refreshUser:async()=>draftEvents.push('refresh-user')},BookingCheckout:{preview:s=>{assert.equal(s.tenant,'draft-tenant');assert.equal(s.storeId,'draft-store');draftEvents.push('preview')}}}}
vm.runInNewContext(customerFunction('setView')+'\n'+customerFunction('showApp'),draftContext)
await draftContext.showApp();assert.deepEqual(draftEvents,['login']);assert.equal(draftState.cart[0].id,'draft');assert.equal(draftState.pendingAuth.view,'checkout')
draftState.user={id:'signed-in'};draftEvents.length=0;await draftContext.showApp();assert.deepEqual(draftEvents,['refresh-user','preview','render']);assert.equal(draftState.cart[0].id,'draft')
console.log('ok 32 - direct booking-draft entry preserves cart through login and loads authoritative deposit preview after authentication')

// Regression: a Chinese-only service previously reached the server with an empty
// English name and was rejected despite a visibly completed name field.
let editorInput={nameZh:'  中文护理  ',nameEn:'  ',categoryId:'nail',price:'160',duration:'60',deposit:'0',sortOrder:'1'},submittedService=null,focusedServiceField=''
editorContext.FormData=class{get(k){return editorInput[k]??''}}
editorContext.request=async(path,options)=>{submittedService=JSON.parse(options.body)}
const serviceEvent={preventDefault(){},target:{dataset:{},elements:{nameZh:{focus(){focusedServiceField='nameZh'}},categoryId:{focus(){focusedServiceField='categoryId'}}}}}
for(const mode of ['create','edit']){
 catalogOwner.serviceEditor={id:'service',mode};await editorContext.saveServiceEditor(serviceEvent)
 assert.equal(submittedService.nameZh,'中文护理');assert.equal(submittedService.nameEn,'中文护理')
 catalogOwner.serviceEditor={id:'service',mode};editorInput.nameEn=' Care ';await editorContext.saveServiceEditor(serviceEvent);assert.equal(submittedService.nameEn,'Care');editorInput.nameEn=' '
}
catalogOwner.serviceEditor={id:'service',mode:'create'};editorInput.nameZh='   ';submittedService=null
await assert.rejects(()=>editorContext.saveServiceEditor(serviceEvent),/请填写中文项目名称/);assert.equal(submittedService,null);assert.equal(focusedServiceField,'nameZh');assert.equal(catalogOwner.serviceEditor.mode,'create')
editorInput.nameZh='保留输入';editorInput.categoryId=''
await assert.rejects(()=>editorContext.saveServiceEditor(serviceEvent),/请选择服务大类/);assert.equal(submittedService,null);assert.equal(focusedServiceField,'categoryId')
editorInput.categoryId='nail';editorContext.request=async()=>{throw Error('模拟网络失败')}
await assert.rejects(()=>editorContext.saveServiceEditor(serviceEvent),/模拟网络失败/);assert.equal(catalogOwner.serviceEditor.mode,'create');assert.equal(editorInput.nameZh,'保留输入')
console.log('ok 33 - web service create/edit accepts Chinese-only names, preserves explicit English, blocks blank names/categories and retains failed drafts')
