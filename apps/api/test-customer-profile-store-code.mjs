import nativeAssert from 'node:assert/strict'
let checked = 0
const assert = new Proxy(nativeAssert, { get(target, key) { const fn = target[key]; if (typeof fn !== 'function') return fn; return (...args) => { const result = fn(...args); if (result?.then) return result.then(value => { console.log('ok ' + (++checked) + ' - ' + String(key)); return value }); console.log('ok ' + (++checked) + ' - ' + String(key)); return result } } })
import { DatabaseSync } from 'node:sqlite'
import { Readable } from 'node:stream'
import { customerProfileRoute, validateAvatar } from './customer-profile-route.mjs'
import { storeCodeInfo,storeScene,storeForScene } from './store-code.mjs'
import { createRequire } from 'node:module'
const require=createRequire(import.meta.url), scan=require('../../miniprogram/utils/scan-code.js')
const db=new DatabaseSync(':memory:')
db.exec("CREATE TABLE users(id TEXT,tenant_id TEXT,display_name TEXT,avatar_url TEXT,balance INT); INSERT INTO users VALUES('one','a','A','',600),('two','b','B','',900); CREATE TABLE tenants(id TEXT,name TEXT,kind TEXT,status TEXT); INSERT INTO tenants VALUES('a','A','real','active'),('b','B','real','active'),('demo','D','demo','active'),('off','O','real','disabled')")
const apiError=(status,code,message)=>Object.assign(new Error(message),{status,code})
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZXsAAAAASUVORK5CYII='
const res={};let payload
const deps={db,apiError,requireCustomer:()=>({id:'one'}),resolveTenant:()=> 'a',query:{},json:(_r,_s,b)=>payload=b,serializeUser:r=>r}
const req=body=>Object.assign(Readable.from([JSON.stringify(body)]),{headers:{}})
await customerProfileRoute(req({displayName:'新昵称',avatarData:image}),res,deps)
assert.equal(payload.user.avatar_url,image);assert.equal(payload.user.balance,600)
assert.equal(db.prepare("SELECT avatar_url FROM users WHERE id='two'").get().avatar_url,'')
await assert.rejects(customerProfileRoute(req({displayName:'Wrong'}),res,{...deps,resolveTenant:()=> 'b'}),e=>e.status===403)
for(const value of ['wxfile://tmp/a.png','https://foreign.invalid/avatar.png','data:image/svg+xml;base64,PHN2Zz4=',image.replace('iVBORw0KGgo','AAAAAAAABBB'),'x'.repeat(360001)]) assert.throws(()=>validateAvatar(value,apiError))
await assert.rejects(customerProfileRoute(req({displayName:'<script>'}),res,deps),e=>e.code==='BAD_NAME')
await assert.rejects(customerProfileRoute(req({avatarData:'x'.repeat(390000)}),res,deps),e=>e.status===413)
assert.equal(db.prepare("SELECT display_name FROM users WHERE id='one'").get().display_name,'新昵称')
const a=storeCodeInfo(db,'a','sandbox',apiError),b=storeCodeInfo(db,'b','sandbox',apiError)
assert.notEqual(a.scene,b.scene);assert.equal(a.scene.length,25);assert.equal(a.envVersion,'trial')
assert.equal(storeForScene(db,a.scene,'sandbox').id,'a');assert.equal(storeCodeInfo(db,'a','production',apiError).envVersion,'release')
assert.equal(storeForScene(db,storeScene('demo'),'production'),null)
assert.throws(()=>storeCodeInfo(db,'off','sandbox',apiError))
assert.equal(scan.sceneFromScan({path:'pages/scan-entry/index?scene='+a.scene}),a.scene)
assert.equal(scan.memberCodeFromScan(a.scene),'')
assert.equal(storeForScene(db,'s'+'a'.repeat(24),'sandbox'),null)
db.close()
console.log('PASS: avatar persistence, isolation, file validation and unchanged balances; store scene uniqueness, routing, disabled/demo rejection and trial/release separation')

const {effectivePlanPolicy} = await import('./free-personal-policy.mjs')
const oldLimits={maxOrdersPerMonth:50};const free=effectivePlanPolicy('free',['booking'],oldLimits)
assert.equal(free.limits.maxOrdersPerMonth,100)
assert.equal(oldLimits.maxOrdersPerMonth,50)
assert.equal(free.features.includes('crm'),true)
assert.equal(free.features.includes('membership'),false)
assert.equal(effectivePlanPolicy('single',['custom'],oldLimits).limits,oldLimits)
