import vm from 'node:vm'
import fs from 'node:fs'
import assert from 'node:assert/strict'
const src=fs.readFileSync(new URL('../../miniprogram/pages/merchant/migration-gift/index.js',import.meta.url),'utf8')
function setup(){let page,tid='A',confirm=true,reject=false;const posts=[]
const info={version:'a'.repeat(64),sourceTitle:'护理油',sourceDetails:{},events:[],grant:null}
const api={guardOwner:async()=>true,adminGet:async()=>info,adminPost:async(path,body)=>{posts.push({path,body:JSON.parse(JSON.stringify(body))});if(reject)throw Error('network');return{remaining:2}}}
vm.runInNewContext(src,{require:p=>p.endsWith('/api')?api:{storeMoney:String},wx:{getStorageSync:()=>tid,showToast:()=>{},showModal:o=>o.success({confirm})},Page:p=>page=p})
page.setData=function(d){Object.assign(this.data,d)};page.onLoad({userId:'u',assetId:'a'});page.visible=true
return{page,posts,info,setTenant:v=>tid=v,setConfirm:v=>confirm=v,setReject:v=>reject=v}}
function ready(p){p.setData({title:'护理油',quantity:'3',unitValue:'10.50',reason:'核对记录',agreements:{noExpiry:true,physicalGoodsConfirmed:true,rulesConfirmed:true,sourceUseStopped:true}})}
let n=0;async function check(name,f){await f();console.log('PASS',++n,name)}
await check('rules never selected automatically',async()=>{const {page,posts}=setup();await page.load();assert.equal(Object.keys(page.data.agreements).length,0);page.setData({quantity:'1',reason:'test'});await page.save();assert.equal(posts.length,0)})
await check('invalid quantities blocked before submission',async()=>{for(const q of ['','-1','1.5','1e3','100001']){const {page,posts}=setup();await page.load();ready(page);page.setData({quantity:q});await page.save();assert.equal(posts.length,0)}})
await check('cancel writes nothing',async()=>{const {page,posts,setConfirm}=setup();await page.load();ready(page);setConfirm(false);await page.save();assert.equal(posts.length,0);assert.equal(page.data.saving,false)})
await check('network retry keeps identical request',async()=>{const {page,posts,setReject}=setup();await page.load();ready(page);setReject(true);await page.save();setReject(false);await page.save();assert.deepEqual(posts[0].body,posts[1].body);assert.equal(posts[0].body.unitValueCents,1050);assert.equal(page.data.saving,false)})
await check('store switch clears source and blocks writes',async()=>{const {page,posts,setTenant}=setup();await page.load();ready(page);setTenant('B');await page.save();await page.load();assert.equal(posts.length,0);assert.equal(page.data.info,null)})
await check('return binds original claim and no money payload',async()=>{const {page,posts,info}=setup();info.grant={remaining:0,status:'exhausted',unitValueCents:100};info.events=[{id:'claim1',kind:'claim',returnable:2,created_at:'2026-10-02'}];await page.load();page.setData({quantity:'1',reason:'退回完好赠品'});await page.save();assert.equal(posts[0].body.claimId,'claim1');assert.ok(posts[0].path.endsWith('/return'));assert.equal(posts[0].body.unitValueCents,undefined)})
console.log(n+' mini gift checks passed')
