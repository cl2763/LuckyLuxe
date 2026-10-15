import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
const fixtureSecret=randomBytes(24).toString('hex')
import {subscriptionPayload,createSubscribeSender,SUBSCRIBE_TEMPLATES} from './wechat-subscribe.mjs'
const x={kind:'arrival_reminder',openid:'o-test',tenantId:'a',bookingId:'b',store:'门店',service:'美甲',date:'2026-10-12',time:'17:30',address:'门店地址'}
const p=subscriptionPayload(x)
assert.equal(p.template_id,SUBSCRIBE_TEMPLATES.arrival_reminder.id)
assert.deepEqual(Object.keys(p.data),['thing8','thing7','time2','thing4','thing9'])
assert.equal(p.data.time2.value,'2026-10-12 17:30')
assert.ok(p.page.includes('tenantId=a&id=b'))
for(const [event,status] of [['booking_created','已确认'],['booking_rescheduled','已改期'],['booking_cancelled','已取消']]){
 const s=subscriptionPayload({...x,kind:'booking_status',event})
 assert.equal(s.data.phrase14.value,status);assert.equal(s.data.date3.value,'2026-10-12');assert.ok(s.data.thing8.value.includes('17:30'))
}
assert.throws(()=>subscriptionPayload({...x,address:''}),/MISSING/)
assert.throws(()=>subscriptionPayload({...x,date:'bad'}),/TIME/)
assert.equal(Array.from(subscriptionPayload({...x,store:'甲'.repeat(30)}).data.thing8.value).length,20)
let calls=[]
const sender=createSubscribeSender({appid:'test',secret:fixtureSecret,fetcher:async(url,o)=>{calls.push([url,o]);return {ok:true,json:async()=>url.includes('/token?')?{access_token:'test-token',expires_in:7200}:{errcode:0}}}})
await sender(p);await sender(p);assert.equal(calls.length,3);assert.equal(JSON.parse(calls[1][1].body).touser,'o-test')
const refused=createSubscribeSender({appid:'test',secret:fixtureSecret,fetcher:async url=>({ok:true,json:async()=>url.includes('/token?')?{access_token:'t',expires_in:7200}:{errcode:43101}})})
await assert.rejects(refused(p),/43101/)
await assert.rejects(createSubscribeSender({})(p),/NOT_CONFIGURED/)
console.log('ok 1 - subscription template mapping, formatting, missing fields, transport, token cache and refusal checks passed (stub only)')

assert.throws(()=>createSubscribeSender({miniprogramState:'typo'}),/INVALID_ENVIRONMENT/)
let trialPayload
await createSubscribeSender({appid:'test',secret:fixtureSecret,miniprogramState:'trial',fetcher:async(url,options)=>{
 if(options?.body)trialPayload=JSON.parse(options.body)
 return {ok:true,json:async()=>options?.body?{errcode:0}:{access_token:'stub',expires_in:7200}}
}})(p)
assert.equal(trialPayload.miniprogram_state,'trial')
assert.equal(p.miniprogram_state,'formal')
console.log('ok 2 - explicit trial routing, formal default and invalid environment rejection')
