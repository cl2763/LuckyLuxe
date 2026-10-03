import vm from 'node:vm'
import fs from 'node:fs'
import assert from 'node:assert/strict'
const src=fs.readFileSync(new URL('../../miniprogram/pages/merchant/migration-service/index.js',import.meta.url),'utf8')
function setup(){let page,tid='A',confirm=true,reject=false;const posts=[]
const info={version:'a'.repeat(64),sourceTitle:'护理赠卡',sourceDetails:{},events:[],grant:null}
const api={guardOwner:async()=>true,adminGet:async p=>p.includes('/pricing/items')?{items:[{id:'svc',nameZh:'护理',isActive:true,itemKind:'main'}]}:info,adminPost:async(path,body)=>{posts.push({path,body:JSON.parse(JSON.stringify(body))});if(reject)throw Error('network');return{remaining:2}}}
vm.runInNewContext(src,{require:p=>p.endsWith('/api')?api:{storeMoney:String},wx:{getStorageSync:()=>tid,showToast:()=>{},showModal:o=>o.success({confirm})},Page:p=>page=p})
page.setData=function(d){Object.assign(this.data,d)};page.onLoad({userId:'u',assetId:'a'});page.visible=true
return{page,posts,info,setTenant:v=>tid=v,setConfirm:v=>confirm=v,setReject:v=>reject=v}}
function ready(p){p.setData({title:'护理赠卡',quantity:'2',unitValue:'10.50',reason:'核对记录',serviceIndex:1,agreements:{noExpiry:true,serviceGiftConfirmed:true,noCashBalance:true,oneUsePerService:true,rulesConfirmed:true,sourceUseStopped:true}})}
let n=0;async function check(name,f){await f();console.log('ok',++n,name)}
await check('unconfirmed gift and unmapped service cannot submit',async()=>{const {page,posts}=setup();await page.load();assert.equal(Object.keys(page.data.agreements).length,0);ready(page);page.setData({serviceIndex:0});await page.save();assert.equal(posts.length,0)})
await check('fractional counts rejected; zero count accepted as exhausted',async()=>{const {page,posts}=setup();await page.load();ready(page);page.setData({quantity:'1.5'});await page.save();assert.equal(posts.length,0);page.setData({quantity:'0'});await page.save();assert.equal(posts[0].body.quantity,0)})
await check('cancel writes nothing',async()=>{const {page,posts,setConfirm}=setup();await page.load();ready(page);setConfirm(false);await page.save();assert.equal(posts.length,0);assert.equal(page.data.saving,false)})
await check('retry keeps request key and exact mapped service',async()=>{const {page,posts,setReject}=setup();await page.load();ready(page);setReject(true);await page.save();setReject(false);await page.save();assert.deepEqual(posts[0].body,posts[1].body);assert.equal(posts[0].body.serviceId,'svc');assert.ok(posts[0].path.endsWith('/activate-service'))})
await check('tenant switch cannot enable or expose old store snapshot',async()=>{const {page,posts,setTenant}=setup();await page.load();ready(page);setTenant('B');await page.save();await page.load();assert.equal(posts.length,0);assert.equal(page.data.info,null)})
await check('existing physical or service grant cannot activate again',async()=>{for(const kind of ['physical','service']){const {page,posts,info}=setup();info.grant={kind,remaining:2,unitValueCents:100};await page.load();ready(page);await page.save();assert.equal(posts.length,0)}})
console.log(n+' mini service gift checks passed')
