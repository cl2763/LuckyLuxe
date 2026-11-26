// A dedicated disposable server exercises pilot behavior without changing other suites.
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawn} from 'node:child_process'
import {createServer} from 'node:net'
import {fileURLToPath} from 'node:url'
import {ensurePricingCategory} from './pricing-category-fixture.mjs'
import {assertTestTarget} from './test-guard.mjs'
import assert from 'node:assert/strict'
import {createAndLoginCustomerViaFrontDoor} from './customer-login-fixture.mjs'
if(process.env.CATALOG_HTTP_CHILD!=='1'){
 const dir=mkdtempSync(join(tmpdir(),'ll-ci-data.catalog-http-')),probe=createServer()
 await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r))
 const env={...process.env,PORT:String(port),HOST:'127.0.0.1',DATA_DIR:dir,OWNER_TOKEN:'isolated-catalog-owner',ALLOW_DEMO_ADMIN_LOGIN:process.env.ALLOW_DEMO_ADMIN_LOGIN||'true',MEMBER_PRICING_ALL_STORES:'1',CATALOG_INLINE_TENANTS:'*',NOTIFY_TICK:'off',NODE_OPTIONS:'--experimental-sqlite'}
 const server=spawn(process.execPath,['--experimental-sqlite',fileURLToPath(new URL('./local-server.mjs',import.meta.url))],{env,stdio:['ignore','ignore','pipe']});let logs='';server.stderr.on('data',b=>{logs+=b});const ended=new Promise(r=>server.once('exit',r))
 try{
  let ready=false;for(let i=0;i<120;i++){if(server.exitCode!==null)throw Error('Isolated server startup failed: '+logs);try{ready=(await fetch(`http://127.0.0.1:${port}/health`)).ok}catch{}if(ready)break;await new Promise(r=>setTimeout(r,100))}if(!ready)throw Error('Isolated server startup timed out')
  const child=spawn(process.execPath,['--experimental-sqlite',fileURLToPath(import.meta.url)],{env:{...env,CATALOG_HTTP_CHILD:'1',TEST_BASE_URL:`http://127.0.0.1:${port}`,TEST_ADMIN_TOKEN:env.OWNER_TOKEN},stdio:'inherit'})
  const code=await new Promise(r=>child.once('exit',r));if(code!==0)throw Error('Catalog HTTP checks failed: '+code)
 }finally{if(server.exitCode===null)server.kill('SIGTERM');await ended;rmSync(dir,{recursive:true,force:true})}
}else{
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
/* 测试护栏(裁 C):套件永远不许写进真库 —— 开跑前问服务器「你往哪个库写」 */

/* 07f §五 批量切:token 改成问 helper 要(试点形状,见 owner-token.mjs) */
const { requireOwnerToken } = await import('./owner-token.mjs')
await assertTestTarget(BASE_URL)
const PLATFORM = process.env.TEST_ADMIN_TOKEN || requireOwnerToken()
const RUN_ID = Date.now().toString(36)

let checks = 0
function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

const financeKeys = new Map()
async function request(path, options = {}, token = PLATFORM, extraHeaders = {}) {
  const fk = token ? financeKeys.get(token) : null
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(fk ? { 'x-finance-key': fk } : {}),
      ...extraHeaders,
      ...(options.headers || {})
    }
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, data }
}

/* 分类唯一真相律(店主 2026-08-25):建店即落平台三大类(美甲/美睫/护理·其他),
   所以夹具再建同 key 的大类会撞 409 —— 改成「有就用,没有才建」。判据跟着口径走。 */
async function ensureCategory(token,body){return ensurePricingCategory({base:BASE_URL,platformToken:PLATFORM,merchantToken:token,body})}

async function newShop(label) {
  const id = `p1s-${label}-${RUN_ID}`
  const created = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id, name: `结算店${label}${RUN_ID}`, plan: 'chain' }) })
  if (created.status !== 201) throw new Error(`建店失败: ${JSON.stringify(created.data)}`)
  const { username, initialPassword } = created.data.owner
  const first = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: initialPassword }) }, null)
  const pass = `Pw-${RUN_ID}-${label}9`
  await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: initialPassword, newPassword: pass, confirmPassword: pass }) }, first.data.auth.accessToken)
  const again = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: pass }) }, null)
  const token = again.data.auth.accessToken
  const unlock = await request('/admin/finance/unlock', { method: 'POST', body: JSON.stringify({ password: PLATFORM }) }, token)
  if (unlock.data?.financeKey) financeKeys.set(token, unlock.data.financeKey)
  return { tenantId: id, token }
}


const shop=await newShop('catalog')
const call=(path,body,method='POST',token=shop.token)=>request(path,{method,body:JSON.stringify(body)},token)
const ok=async(p,b,m='POST')=>{const r=await call(p,b,m);assert.ok(r.status<300,`${p}: ${JSON.stringify(r.data)}`);return r.data}

const cat=await ensureCategory(shop.token,{key:'nail',name:'美甲'}),care=await ensureCategory(shop.token,{key:'care',name:'护理'})
const make=async body=>(await ok('/admin/pricing/items',{nameZh:'隔离目录验证',type:'CARE',categoryId:care.id,listPriceCents:10000,...body})).item
const nail=await make({nameZh:'美甲主项目',categoryId:cat.id,itemKind:'main'}),other=await make({nameZh:'护理主项目',itemKind:'main'}),scoped=await make({nameZh:'限定美甲加项',itemKind:'addon',addonScope:[cat.id],listPriceCents:3000}),free=await make({nameZh:'无范围加项',itemKind:'addon',listPriceCents:3000}),pct=await make({nameZh:'按比例加项',itemKind:'addon',unit:'per_finger',priceRule:'pct_of_tier_price',priceRuleValue:10})
const tech=(await ok('/admin/technicians',{name:'隔离技师',isActive:true})).technician
const cust=await createAndLoginCustomerViaFrontDoor({base:BASE_URL,tenantId:shop.tenantId,ownerToken:shop.token,name:'隔离目录顾客',phone:`139${String(Date.now()).slice(-8)}`,serviceId:nail.id,technicianId:tech.id});const uid=cust.userId||cust.body?.user?.id;assert.ok(uid)
const config=(await request('/admin/member-pricing/config',{},shop.token)).data.config;assert.equal(config.catalogInteractionV2,true)
await ok('/admin/pricing/rules',{rules:{single_finger:{isActive:true,config:{pct:10}}}},'PUT')
const preview=ids=>call('/admin/member-pricing/preview',{userId:uid,tierKey:'list',items:ids.map(serviceId=>({serviceId})),payIntent:'offline'})
let r=await preview([nail.id,scoped.id]);assert.equal(r.status,200,JSON.stringify(r.data));check('护理分类加项按所选美甲适用范围正常搭配',r.status===200)
r=await preview([other.id,scoped.id]);assert.equal(r.data.error.code,'ADDON_SCOPE_MISMATCH');check('错配大类由后台拒绝',r.status===400 && r.data.error.code==='ADDON_SCOPE_MISMATCH')
r=await preview([scoped.id]);assert.equal(r.data.error.code,'ADDON_SCOPE_MISMATCH');check('限定范围加项没有主项目时拒绝',r.status===400 && r.data.error.code==='ADDON_SCOPE_MISMATCH')
r=await preview([free.id]);assert.equal(r.status,200,JSON.stringify(r.data));check('旧无范围固定金额加项可单独开单',r.status===200)
r=await preview([pct.id]);assert.equal(r.data.error.code,'ADDON_MAIN_REQUIRED');check('比例加项无主项目不能按零元开单',r.status===400 && r.data.error.code==='ADDON_MAIN_REQUIRED')
r=await preview([nail.id,pct.id]);assert.equal(r.status,200,JSON.stringify(r.data));check('比例加项搭配主项目后正常试算',r.status===200)
const items=(await request('/admin/pricing/items',{},shop.token)).data.items;assert.equal(items.find(i=>i.id===scoped.id).categoryId,care.id);assert.equal(items.find(i=>i.id===scoped.id).itemKind,'addon');check('计算未修改目录分类或主加项属性',items.find(i=>i.id===scoped.id).categoryId===care.id && items.find(i=>i.id===scoped.id).itemKind==='addon')
console.log('all '+checks+' HTTP checks passed; isolated synthetic tenant only')

}
