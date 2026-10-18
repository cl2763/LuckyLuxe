import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
let prompt,posted=0,tenant='a';const api={currentTenantId:()=>tenant,getAuth:()=>({accessToken:'t'}),isLoggedIn:()=>true,subscriptionConfig:async()=>({enabled:true,requestId:'r',templates:[{id:'one'},{id:'two'}]}),subscriptionConsent:async body=>{assert.deepEqual(Object.keys(body.results),['one','two']);posted++}}
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
const loginBox={module:{exports:{}},require:()=>box.module.exports}
vm.runInNewContext(readFileSync(new URL('../../miniprogram/utils/login-subscription.js',import.meta.url),'utf8'),loginBox)
const login={...loginBox.module.exports,data:{},setData(x){Object.assign(this.data,x)}}
prompt=undefined
box.wx.requestSubscribeMessage=o=>{prompt=o}
await login.offerSubscription();assert.equal(login.data.subscriptionWelcome,true);assert.equal(prompt,undefined)
login.closeSubscriptionWelcome();assert.equal(login.data.subscriptionWelcome,false)
await login.offerSubscription();login.subscribeBooking();assert.ok(prompt)
login.onHide();await prompt.success({one:'accept',two:'accept'});assert.equal(posted,1,'leaving page must not save stale consent')
console.log('ok 2 - login guidance is skippable, tap-only and ignores stale callbacks after leaving')
