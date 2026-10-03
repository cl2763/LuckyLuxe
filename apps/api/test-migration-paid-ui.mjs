import vm from 'node:vm'
import fs from 'node:fs'
import assert from 'node:assert/strict'
const mini=fs.readFileSync(new URL('../../miniprogram/pages/merchant/migration-reconciliation/index.js',import.meta.url),'utf8')
const web=fs.readFileSync(new URL('../../apps/web/customer-migration-ui.js',import.meta.url),'utf8').split('async function previewCardReconciliation(pendingId) {')[1].split('async function reviewMigrationBalance')[0]
let n=0;async function check(name,f){await f();console.log('ok',++n,name)}
// VM 只运行 JS，不能发现 WXML 闭合错误；对新增迁移页补结构检查。
await check('migration templates have balanced tags and keep confirmation inside themed page', () => {
 for (const page of ['migration-archive','migration-balance','migration-gift','migration-service','migration-reconciliation']) {
  const markup=fs.readFileSync(new URL(`../../miniprogram/pages/merchant/${page}/index.wxml`,import.meta.url),'utf8')
  assert.ok(!/\{\{[^}]*&(?:amp|lt|gt);/.test(markup), `${page}: WXML expressions must use operators, not HTML entities`)
  const stack=[]
  for(const match of markup.matchAll(/<\/?[a-zA-Z][\w:-]*(?:"[^"]*"|'[^']*'|[^'">])*>/g)) {
   const tag=match[0],name=/^<\/?([\w:-]+)/.exec(tag)[1]
   if(tag.startsWith('</'))assert.equal(stack.pop(),name,`${page}: mismatched ${tag}`)
   else if(!tag.endsWith('/>'))stack.push(name)
  }
  assert.deepEqual(stack,[],`${page}: unclosed tags`)
 }
 const markup=fs.readFileSync(new URL('../../miniprogram/pages/merchant/migration-reconciliation/index.wxml',import.meta.url),'utf8')
 assert.match(markup,/^<view class="page {{themeClass}}">/)
 assert.ok(markup.trim().endsWith('</view>'))
})
const card={assetId:'c',kind:'paid_timecard',paidCents:1000,bonusCents:0,remainingTimes:2,serviceId:'svc',noExpiry:true}
function setupMini(){let page,tid='A',confirm=true,fail=false,defer=false,resolve;const posts=[]
 const api={adminPost:async(p,b)=>{posts.push({p,b});if(fail)throw Error('network');return {cards:[{}]}},guardOwner:async()=>true}
 vm.runInNewContext(mini,{Page:p=>page=p,require:p=>p.endsWith('/api')?api:{storeMoney:String},wx:{getStorageSync:()=>tid,showToast:()=>{},showModal:o=>{if(defer)resolve=()=>o.success({confirm});else o.success({confirm})}}})
 page.setData=d=>Object.assign(page.data,d);page.onLoad({userId:'u',pendingId:'p'});page.visible=true;Object.assign(page.data,{loading:false,info:{},result:{eligible:true},evidence:'核对记录',agreements:{sourceUseStopped:true,allBalanceAllocated:true,equalPerUsePrincipal:true}});page.reviewed={cards:[card],currency:'CNY',confirmVersion:'v'}
 return {page,posts,cancel:()=>confirm=false,fail:x=>fail=x,store:x=>tid=x,hold:()=>defer=true,resolve:()=>resolve()}
}
await check('mini requires explicit agreements',async()=>{const x=setupMini();x.page.data.agreements={};await x.page.activate();assert.equal(x.posts.length,0)})
await check('mini cancellation does not activate',async()=>{const x=setupMini();x.cancel();await x.page.activate();assert.equal(x.posts.length,0)})
await check('mini retry preserves request id and cutoff',async()=>{const x=setupMini();x.fail(true);await x.page.activate();x.fail(false);await x.page.activate();assert.equal(x.posts.length,2);assert.equal(x.posts[0].b.requestId,x.posts[1].b.requestId);assert.equal(x.posts[0].b.cutoverAt,x.posts[1].b.cutoverAt);await x.page.activate();assert.equal(x.posts.length,2)})
await check('mini repeated clicks and store change during confirmation cannot post',async()=>{const x=setupMini();x.hold();const pending=x.page.activate();await x.page.activate();x.store('B');x.resolve();await pending;assert.equal(x.posts.length,0)})
await check('mini changed preview cannot activate old values',async()=>{const x=setupMini();x.page.data.cards=[{id:'c'}];x.page.input({currentTarget:{dataset:{index:0,key:'paid'}},detail:{value:'999'}});await x.page.activate();assert.equal(x.posts.length,0)})
function setupWeb(){const forms=[],posts=[];let failure=false;const owner={selectedCustomerId:'u',auth:{admin:{tenantId:'A'}}};let balanced=true
 const ctx={owner,MoneyInput:{strictCentsOf:v=>Number(v)*100},crypto:{randomUUID:()=> 'unique_test_request'},money:String,escapeHtml:String,toast:()=>{},loadMigrationArchive:()=>{},openFormModal:f=>forms.push(f),UIDialog:{alert:async()=>{}},request:async(p,o)=>{if(!o)return p.includes('pricing')?{items:[]}:{cards:[{id:'c',title:'旧卡'}],currency:'CNY',version:'v',snapshotAmountCents:1000};const b=JSON.parse(o.body);posts.push({p,b});if(p.endsWith('activate-timecards')){if(failure)throw Error('network');return{}}return{balanced,paidCents:1000,bonusCents:0,differenceCents:balanced?0:1,issues:[],message:''}}}
 vm.createContext(ctx);vm.runInContext('async function previewCardReconciliation(pendingId) {'+web,ctx)
 return{forms,posts,owner,start:()=>ctx.previewCardReconciliation('p'),fail:x=>failure=x,unbalanced:()=>balanced=false}
}
const values={card0_kind:'paid_timecard',card0_paid:'10',card0_bonus:'0',card0_times:'2',card0_serviceId:'svc',card0_noExpiry:true,card0_expiresOn:''}
const flags={evidence:'核对',sourceUseStopped:true,allBalanceAllocated:true,equalPerUsePrincipal:true}
await check('web calculation never activates without separate confirmation',async()=>{const x=setupWeb();await x.start();await x.forms[0].onSave(values);assert.equal(x.forms.length,2);assert.equal(x.posts.length,1);assert.ok(x.posts[0].p.endsWith('reconciliation'))})
await check('web unbalanced card has no confirmation step',async()=>{const x=setupWeb();x.unbalanced();await x.start();await x.forms[0].onSave(values);assert.equal(x.forms.length,1)})
await check('web incomplete agreements and changed customer cannot activate',async()=>{const x=setupWeb();await x.start();await x.forms[0].onSave(values);await assert.rejects(()=>x.forms[1].onSave({...flags,sourceUseStopped:false}));x.owner.selectedCustomerId='other';await assert.rejects(()=>x.forms[1].onSave(flags));assert.equal(x.posts.length,1)})
await check('web retry preserves exact activation payload',async()=>{const x=setupWeb();await x.start();await x.forms[0].onSave(values);x.fail(true);await assert.rejects(()=>x.forms[1].onSave(flags));x.fail(false);await x.forms[1].onSave(flags);assert.deepEqual(x.posts[1].b,x.posts[2].b);assert.equal(x.posts[2].b.cards[0].paidCents,1000)})
console.log(n+' paid UI checks passed')
