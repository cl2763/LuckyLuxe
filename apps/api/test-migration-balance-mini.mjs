import vm from 'node:vm'
import fs from 'node:fs'
import assert from 'node:assert/strict'
const src=fs.readFileSync(new URL('../../miniprogram/pages/merchant/migration-balance/index.js',import.meta.url),'utf8')
function setup(){
 let page,tid='A',confirm=true,rejectPost=false;const posts=[],messages=[]
 const info={status:'pending',version:'a'.repeat(64),currency:'CNY',snapshotAmountCents:10000,confirmation:null}
 const api={guardOwner:async()=>true,adminGet:async()=>info,adminPost:async(path,body)=>{posts.push({path,body:JSON.parse(JSON.stringify(body))});if(rejectPost)throw new Error('network');return{status:'active'}}}
 vm.runInNewContext(src,{require:p=>p.endsWith('/api')?api:{storeMoney:c=>String(c)},wx:{getStorageSync:()=>tid,showToast:m=>messages.push(m),showModal:o=>o.success({confirm})},Page:p=>page=p})
 page.setData=function(d){Object.assign(this.data,d)};page.onLoad({userId:'u',pendingId:'p'});page.visible=true
 return{page,posts,messages,info,setTenant:v=>tid=v,setConfirm:v=>confirm=v,setReject:v=>rejectPost=v}
}
const ready=page=>{page.setData({paid:'80.00',bonus:'20.00',evidence:'商家已核对'});for(const key of ['noReliableCardBreakdown','unrestricted','noExpiry','sourceUseStopped'])page.toggleCheck({currentTarget:{dataset:{key}}})}
let n=0;async function check(name,fn){await fn();console.log('PASS',++n,name)}
await check('no rule is preselected and incomplete rules cannot submit',async()=>{const {page,posts}=setup();await page.load();assert.equal(page.data.confirmed.length,0);page.setData({paid:'80',bonus:'20',evidence:'test'});await page.save();assert.equal(posts.length,0)})
await check('invalid money and unknown split cannot submit',async()=>{for(const paid of ['','-1','1.111','1e3']){const {page,posts}=setup();await page.load();ready(page);page.setData({paid});await page.save();assert.equal(posts.length,0)}})
await check('confirmation cancel writes nothing',async()=>{const {page,posts,setConfirm}=setup();await page.load();ready(page);setConfirm(false);await page.save();assert.equal(posts.length,0);assert.equal(page.data.saving,false)})
await check('network retry retains the same request key and cutover time',async()=>{const {page,posts,setReject}=setup();await page.load();ready(page);setReject(true);await page.save();setReject(false);await page.save();assert.equal(posts.length,2);assert.deepEqual(posts[0].body,posts[1].body);assert.equal(posts[0].body.paidCents,8000);assert.equal(page.data.saving,false)})
await check('changed review content gets a new request key',async()=>{const {page,posts,setReject}=setup();await page.load();ready(page);setReject(true);await page.save();page.setData({paid:'70',differenceReason:'已核对差额'});await page.save();assert.notEqual(posts[0].body.requestId,posts[1].body.requestId)})
await check('tenant switch prevents confirmation and clears source view on load',async()=>{const {page,posts,setTenant}=setup();await page.load();ready(page);setTenant('B');await page.save();assert.equal(posts.length,0);await page.load();assert.equal(page.data.info,null)})
console.log(n+' mini confirmation checks passed')
