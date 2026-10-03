import vm from 'node:vm'
import fs from 'node:fs'
import assert from 'node:assert/strict'
const src=fs.readFileSync(new URL('../../miniprogram/pages/merchant/migration-reconciliation/index.js',import.meta.url),'utf8')
function setup(){let page,tid='A',resolvePost;const posts=[];let defer=false
const api={guardOwner:async()=>true,adminGet:async p=>p.includes('pricing/items')?{items:[]}:{version:'v',currency:'CNY',snapshotAmountCents:100,cards:[{id:'c',title:'旧卡'}]},adminPost:async(p,b)=>{posts.push({p,b});if(defer)return new Promise(r=>resolvePost=r);return{balanced:false,paidCents:0,bonusCents:0,differenceCents:100,issues:[],canActivate:false}}}
vm.runInNewContext(src,{require:p=>p.endsWith('/api')?api:{storeMoney:String},wx:{getStorageSync:()=>tid},Page:p=>page=p});page.setData=function(d){Object.assign(this.data,d)};page.onLoad({userId:'u',pendingId:'p'});page.visible=true
return{page,posts,store:x=>tid=x,hold:()=>defer=true,resolve:()=>resolvePost({paidCents:0,bonusCents:0,differenceCents:0,issues:[]})}}
let n=0;async function check(s,f){await f();console.log('PASS',++n,s)}
await check('unknown card is not initialized with invented zero amounts',async()=>{const {page,posts}=setup();await page.load();assert.equal(page.data.cards[0].paid,'');await page.calculate();assert.equal(posts[0].b.cards[0].kind,'unresolved');assert.equal(posts[0].b.cards[0].paidCents,undefined)})
await check('known card missing amounts never submits',async()=>{const {page,posts}=setup();await page.load();page.data.cards[0].kindIndex=2;await page.calculate();assert.equal(posts.length,0);assert.equal(page.data.saving,false)})
await check('preview only endpoint used and cents stay exact',async()=>{const {page,posts}=setup();await page.load();Object.assign(page.data.cards[0],{kindIndex:2,paid:'0.99',bonus:'0.01',noExpiry:true});await page.calculate();assert.equal(posts[0].b.cards[0].paidCents,99);assert.equal(posts[0].b.cards[0].bonusCents,1);assert.ok(posts[0].p.endsWith('/reconciliation'))})
await check('store switch clears sensitive source context',async()=>{const {page,posts,store}=setup();await page.load();store('B');await page.calculate();await page.load();assert.equal(posts.length,0);assert.equal(page.data.info,null)})
await check('response after leaving cannot update screen',async()=>{const {page,hold,resolve}=setup();await page.load();hold();const task=page.calculate();page.onHide();resolve();await task;assert.equal(page.data.result,null)})
console.log(n+' reconciliation mini checks passed')
