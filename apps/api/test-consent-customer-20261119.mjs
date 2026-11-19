import assert from 'node:assert/strict'
import vm from 'node:vm'
import {randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {createCustomerRemarks} from './customer-remarks.mjs'
const error=(status,code,message)=>Object.assign(new Error(message),{status,code})
const db=new DatabaseSync(':memory:')
db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,tenant_id TEXT,display_name TEXT,balance INT);INSERT INTO users VALUES('a','shop-a','自选昵称',100000),('b','shop-b','另店顾客',500)")
const remarks=createCustomerRemarks({db,apiError:error}),owner={role:'owner',accountId:'owner-a'}
assert.equal(remarks.read('shop-a','a'),'')
assert.equal(remarks.save('shop-a','a','  周末常客  ',owner).remarkName,'周末常客')
assert.equal(remarks.read('shop-b','a'),'')
assert.throws(()=>remarks.save('shop-b','a','越店',owner),e=>e.status===404)
assert.throws(()=>remarks.save('shop-a','a','越权',{role:'staff'}),e=>e.status===403)
for(const val of [null,{},'<script>','a\n', '名'.repeat(41)])assert.throws(()=>remarks.save('shop-a','a',val,owner),e=>e.status===400)
remarks.save('shop-a','a','名'.repeat(40),owner)
db.prepare("UPDATE users SET display_name='顾客新昵称' WHERE id='a'").run()
assert.equal(remarks.read('shop-a','a'),'名'.repeat(40))
assert.equal(db.prepare("SELECT balance FROM users WHERE id='a'").get().balance,100000)
assert.equal(createCustomerRemarks({db,apiError:error}).read('shop-a','a'),'名'.repeat(40))
remarks.save('shop-a','a','',owner);assert.equal(remarks.read('shop-a','a'),'')
console.log('ok 1 - merchant remarks: isolation, permissions, validation, clearing, repeat startup, customer identity and balances preserved')
let calls=0,definition;const toasts=[]
const api={adminLogin:async()=>{calls++;return {admin:{}}},submitMerchantLead:async()=>{calls++}}
function page(path){vm.runInNewContext(readFileSync(new URL('../../miniprogram/'+path,import.meta.url),'utf8'),{Page:p=>definition=p,require:()=>api,wx:{showToast:o=>toasts.push(o.title),reLaunch(){},redirectTo(){},navigateTo(){}}});return {...definition,data:structuredClone(definition.data),setData(p){Object.assign(this.data,p)}}}
let p=page('pages/merchant-login/index.js');p.data.username='test';p.data.password=randomUUID()
assert.equal(p.data.consent,false);assert.equal(p.data.remember,false)
await p.login();assert.equal(calls,0)
p.toggleRemember();assert.equal(p.data.consent,false)
p.toggleConsent();await p.login();assert.equal(calls,1)
p.toggleConsent();await p.login();assert.equal(calls,1)
for(let i=0;i<5;i++){p=page('pages/merchant-login/index.js');assert.equal(p.data.consent,false)}
p=page('pages/merchant-apply/index.js');p.data.shopName='隔离店';p.data.phone='13800000000';await p.submit();assert.equal(calls,1);p.toggleConsent();await p.submit();assert.equal(calls,2)
console.log('ok 2 - explicit consent: default off, remember independent, denied login/application sends zero requests, five fresh entries')
p=page('pages/merchant/booking-draft/index.js');p.data.services=[{id:'s1'},{id:'s2'}];p.data.stores=[{id:'shop-a'},{id:'shop-b'}];p.allTechs=[{id:'t1',store_id:'shop-a',serviceIds:['s1']},{id:'t2',store_id:'shop-b',serviceIds:['s2']}]
p.filterTechs();assert.equal(p.data.technicians.length,1)
p.choose({currentTarget:{dataset:{key:'si'}},detail:{value:'1'}});assert.equal(p.data.technicians.length,0);assert.match(p.data.techEmptyReason,/尚未关联/)
p.choose({currentTarget:{dataset:{key:'oi'}},detail:{value:'1'}});assert.equal(p.data.technicians[0].id,'t2');assert.equal(p.data.techEmptyReason,'')
p.allTechs=[];p.filterTechs();assert.match(p.data.techEmptyReason,/账号/)
console.log('ok 3 - booking technician selection: service switch, store isolation, missing assignment and empty roster feedback')
db.close()

const BASE=process.env.TEST_BASE_URL||'http://127.0.0.1:4128'
const {assertTestTarget}=await import('./test-guard.mjs');await assertTestTarget(BASE)
const {requireOwnerToken}=await import('./owner-token.mjs');const token=process.env.TEST_ADMIN_TOKEN||requireOwnerToken()
async function req(path,body,headers={}){const r=await fetch(BASE+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',authorization:'Bearer '+token,...headers},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()}}
const unique=Date.now().toString(36)
const made=await req('/admin/customers',{displayName:'备注隔离'+unique,phone:'139'+String(Date.now()).slice(-8),requestId:'remark-'+unique});assert.equal(made.status,201)
const uid=made.data.customer.id
const patch=async(name,headers={})=>{const r=await fetch(BASE+'/admin/customers/'+encodeURIComponent(uid)+'/remark-name',{method:'PATCH',headers:{'content-type':'application/json',authorization:'Bearer '+token,...headers},body:JSON.stringify({remarkName:name})});return {status:r.status,data:await r.json()}}
assert.equal((await patch('仅本店备注'+unique)).status,200)
const list=await req('/admin/customers?q='+encodeURIComponent('仅本店备注'+unique));const found=list.data.customers.find(c=>c.id===uid);assert.ok(found);assert.equal(found.displayName,'备注隔离'+unique);assert.equal(found.merchantDisplayName,'仅本店备注'+unique)
assert.equal((await patch('非法',{authorization:''})).status,401)
assert.equal((await patch('')).status,200)
const services=await req('/admin/technician-services');assert.equal(services.status,200);assert.ok(Array.isArray(services.data.technicians))
console.log('ok 4 - HTTP remarks persist/search without overwriting nickname; unauthenticated mutation denied; service assignment options load')

// Saving a remark must not make an otherwise unused customer undeletable.
const review=await req('/admin/records/customers/'+uid)
assert.equal(review.status,200);assert.ok(review.data.actions.includes('delete'))
const removed=await req('/admin/records/customers/'+uid,{action:'delete',reason:'隔离回归清理未使用资料',reviewHash:review.data.reviewHash})
assert.equal(removed.status,200)
assert.equal((await patch('已删除')).status,404)
console.log('ok 5 - unused customer with remark can be removed through lifecycle; stale remark cannot recreate customer')
const importTid='import-links-'+unique,otherTid=importTid+'-other'
for(const id of [importTid,otherTid])assert.equal((await req('/platform/tenants',{id,name:'服务分工隔离店',plan:'chain',currency:'CNY',timezone:'Asia/Shanghai'})).status,201)
const ht={'x-admin-tenant-id':importTid,'x-tenant-id':importTid}
const active=(await req('/admin/technicians',{name:'在职技师',isActive:true},ht)).data.technician
const inactive=(await req('/admin/technicians',{name:'停用技师',isActive:false},ht)).data.technician
const other=(await req('/admin/technicians',{name:'其他门店技师',isActive:true},{'x-admin-tenant-id':otherTid,'x-tenant-id':otherTid})).data.technician
assert.ok(active?.id&&inactive?.id&&other?.id)
const imported=await req('/admin/services/import',{dryRun:false,headers:['大类','项目名','价格','加做项'],rows:[['美甲','导入主项目','100','否'],['美甲','导入附加项','20','是']]},ht)
assert.equal(imported.status,200,JSON.stringify(imported.data));assert.equal(imported.data.created,2)
const options=(await req('/admin/technician-services',null,ht)).data
const main=options.services.find(s=>(s.name||s.name_zh)==='导入主项目'),addon=options.services.find(s=>(s.name||s.name_zh)==='导入附加项')
assert.ok(main&&addon)
assert.ok(options.technicians.find(t=>t.id===active.id).serviceIds.includes(main.id))
assert.ok(!options.technicians.find(t=>t.id===active.id).serviceIds.includes(addon.id))
assert.ok(!options.technicians.some(t=>[inactive.id,other.id].includes(t.id)))
const {DatabaseSync:DB}=await import('node:sqlite'),fixtureDb=new DB(process.env.TEST_DB_PATH)
assert.equal(fixtureDb.prepare('SELECT count(*) n FROM technician_services WHERE technician_id IN (?,?) AND service_id IN (?,?)').get(inactive.id,other.id,main.id,addon.id).n,0)
fixtureDb.close()
console.log('ok 6 - imported primary service linked only to active local technician; addon/inactive/other tenant excluded')
