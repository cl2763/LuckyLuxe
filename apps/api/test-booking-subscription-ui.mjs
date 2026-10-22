import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
let prompt,posted=0,tenant='a';const api={currentTenantId:()=>tenant,getAuth:()=>({accessToken:'t',user:{id:'u'}}),isLoggedIn:()=>true,subscriptionConfig:async()=>({enabled:true,requestId:'r',templates:[{id:'one'},{id:'two'}]}),subscriptionConsent:async body=>{assert.deepEqual(Object.keys(body.results),['one','two']);posted++}}
const box={module:{exports:{}},require:()=>api,wx:{requestSubscribeMessage:o=>{prompt=o}}}
vm.runInNewContext(readFileSync(new URL('../../miniprogram/utils/booking-subscription.js',import.meta.url),'utf8'),box)
const page={...box.module.exports,data:{},setData(x){Object.assign(this.data,x)}}
await page.loadSubscription('b');assert.equal(prompt,undefined,'no prompt without tap')
page.subscribeBooking();await prompt.success({one:'reject',two:'ban',errMsg:'ok'});assert.equal(posted,1);assert.match(page.data.subscriptionFeedback,/不受影响/);assert.equal(page._subscribing,false)
await page.loadSubscription('b');page.subscribeBooking();tenant='other';await prompt.success({one:'accept',two:'accept'});assert.equal(posted,1);assert.equal(page._subscribing,false)
tenant='a';await page.loadSubscription('b');box.wx.requestSubscribeMessage=()=>{throw Error('unsupported')};page.subscribeBooking();assert.equal(page._subscribing,false);assert.match(page.data.subscriptionFeedback,/不受影响/)
console.log('ok 1 - consent tap-only, refusal safe, tenant switch guard and unsupported API recovery')
// Login guidance presents a choice; native authorization remains an explicit tap.
api.subscriptionOnboarding=api.subscriptionConfig
const seen=new Map();const loginBox={module:{exports:{}},require:p=>p==='./api'?api:box.module.exports,wx:{getStorageSync:k=>seen.get(k),setStorageSync:(k,v)=>seen.set(k,v)}}
vm.runInNewContext(readFileSync(new URL('../../miniprogram/utils/login-subscription.js',import.meta.url),'utf8'),loginBox)
const login={...loginBox.module.exports,data:{},setData(x){Object.assign(this.data,x)}}
prompt=undefined
box.wx.requestSubscribeMessage=o=>{prompt=o}
await login.offerSubscription();assert.equal(login.data.subscriptionWelcome,true);assert.equal(prompt,undefined)
login.closeSubscriptionWelcome();assert.equal(login.data.subscriptionWelcome,false)
await login.offerSubscription();assert.equal(login.data.subscriptionWelcome,false,'same account is not prompted at every login')
await login.openSubscriptionSettings();login.subscribeBooking();assert.ok(prompt)
login.onHide();await prompt.success({one:'accept',two:'accept'});assert.equal(posted,1,'leaving page must not save stale consent')
console.log('ok 2 - login guidance is skippable, tap-only and ignores stale callbacks after leaving')

tenant='new-store';await login.offerSubscription();assert.equal(login.data.subscriptionWelcome,true,'different store has its own onboarding');login.closeSubscriptionWelcome()
api.getAuth=()=>({accessToken:'t',user:{id:'other'}});await login.offerSubscription();assert.equal(login.data.subscriptionWelcome,true,'different account is not suppressed')

let destination,confirms=0
const merchantBox={module:{exports:{}},require:p=>p.endsWith('/nav')?{to:url=>{destination=url}}:{adminPost:async()=>{confirms++}},wx:{navigateTo:o=>{destination=o.url}}}
vm.runInNewContext(readFileSync(new URL('../../miniprogram/pages/merchant/home/acceptance.js',import.meta.url),'utf8'),merchantBox)
merchantBox.module.exports.openPendingBooking({currentTarget:{dataset:{id:'booking/a'}}})
assert.equal(destination,'/pages/merchant/orders/index?bookingId=booking%2Fa')
assert.equal(confirms,0,'opening details must not confirm or mutate a booking')
console.log('ok 3 - pending booking detail navigates to exact booking without confirming it')

const flightBox={module:{exports:{}},Map,Promise};vm.runInNewContext(readFileSync(new URL('../../miniprogram/utils/inflight.js',import.meta.url),'utf8'),flightBox)
const flight=flightBox.module.exports;let requests=0,finish
const load=()=>{requests++;return new Promise(r=>{finish=r})}
const first=flight.run('tenant:a:user:a',true,load),second=flight.run('tenant:a:user:a',true,load)
assert.equal(requests,1);assert.equal(first,second)
finish(1);await first;const fresh=flight.run('tenant:a:user:a',true,load);assert.equal(requests,2,'completed reads must not be cached');finish(2);await fresh
const old=flight.run('tenant:a:user:a',true,load),finishOld=finish
await flight.run('write',false,async()=>{})
const after=flight.run('tenant:a:user:a',true,load),finishAfter=finish
assert.notEqual(old,after,'read after mutation must not join old request');finishOld(3);await old
assert.equal(flight.run('tenant:a:user:a',true,load),after,'old completion must not clear new request');finishAfter(4);await after
await assert.rejects(flight.run('bad',true,()=>Promise.reject(Error('offline'))));assert.equal(await flight.run('bad',true,async()=>5),5)
assert.notEqual(flight.run('a',true,async()=>1),flight.run('b',true,async()=>1),'identities do not share reads')
let writes=0;await Promise.all([flight.run('w',false,async()=>writes++),flight.run('w',false,async()=>writes++)]);assert.equal(writes,2)
console.log('ok 4 - concurrent read merging, fresh reads, write boundaries, rejection recovery and identity isolation')
