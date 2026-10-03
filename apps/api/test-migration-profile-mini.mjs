import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
const src=readFileSync(new URL('../../miniprogram/pages/merchant/migration-archive/index.js',import.meta.url),'utf8')
function setup(){
 let page,tid='A';const pending=[],toasts=[]
 const api={guardOwner:async()=>true,adminGet:()=>new Promise((resolve,reject)=>pending.push({resolve,reject})),adminPatch:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))}
 vm.runInNewContext(src,{require:p=>p.endsWith('/api')?api:{storeMoney:c=>String(c)},wx:{getStorageSync:()=>tid,showToast:t=>toasts.push(t)},Page:p=>page=p})
 page.setData=function(p){for(const [key,value] of Object.entries(p)){const parts=key.split('.');if(parts.length===2)this.data[parts[0]][parts[1]]=value;else this.data[key]=value}}
 page.onLoad({userId:'customer'});page.visible=true
 return{page,pending,toasts,tenant:t=>tid=t}
}
const response={profile:{acquisitionSource:'old',originalJoinedDate:''},records:[],transactions:[],assets:[],pendingBalances:[],hasMore:false}
let count=0
async function check(name,fn){await fn();console.log('PASS',++count,name)}
await check('late page response cannot replace newer page',async()=>{const {page,pending}=setup();const a=page.load(0),b=page.load(1);pending[1].resolve(response);await b;pending[0].resolve({...response,profile:{acquisitionSource:'stale'}});await a;assert.equal(page.data.page,1);assert.equal(page.data.profile.acquisitionSource,'old')})
await check('tenant switch drops in-flight private data and blocks saves',async()=>{const {page,pending,tenant}=setup();const a=page.load(0);tenant('B');pending[0].resolve(response);await a;assert.equal(page.data.profile.acquisitionSource,'');await page.save();assert.equal(pending.length,1);await page.load(0);assert.equal(page.data.rows.length,0);assert.ok(page.data.error.includes('门店'))})
await check('pagination preserves unsaved fields',async()=>{const {page,pending}=setup();page.source({detail:{value:'draft'}});const a=page.load(1);pending[0].resolve(response);await a;assert.equal(page.data.profile.acquisitionSource,'draft')})
await check('save response does not overwrite edits made while saving',async()=>{const {page,pending,toasts}=setup();page.data.loading=false;page.source({detail:{value:'first'}});const a=page.save();page.source({detail:{value:'second'}});pending[0].resolve({profile:response.profile});await a;assert.equal(page.data.profile.acquisitionSource,'second');assert.equal(page.dirty,true);assert.equal(toasts.length,1);assert.equal(page.data.saving,false)})
await check('closed page ignores late responses',async()=>{const {page,pending}=setup();const a=page.load(0);page.onUnload();pending[0].resolve(response);await a;assert.equal(page.data.profile.acquisitionSource,'')})
await check('invalid customer is an explicit error instead of endless spinner',async()=>{const {page,pending}=setup();page.userId='';await page.load(0);assert.equal(page.data.loading,false);assert.equal(pending.length,0);assert.ok(page.data.error)})
console.log(count+' mini lifecycle checks passed')
