import {randomBytes} from 'node:crypto'
const fixtureAuthorization='Bearer '+randomBytes(24).toString('hex')
import {DatabaseSync} from 'node:sqlite'
import {createServer} from 'node:http'
import assert from 'node:assert/strict'
import {createSetupIntake} from './platform-setup-intake.mjs'
import {allowedSections,validateAnswers} from '../web/setup-intake-schema.mjs'
const db=new DatabaseSync(':memory:')
db.exec("CREATE TABLE tenants(id TEXT PRIMARY KEY); INSERT INTO tenants VALUES('a'),('b'); CREATE TABLE old_balances(id TEXT,amount INTEGER); INSERT INTO old_balances VALUES('existing',25000)")
let full=true,n=0
const ent=id=>({tenantName:id,plan:id==='a'?'single':'free',features:Object.fromEntries((id==='a'&&full?['membership','staff_schedule','ai_customer_service','booking','crm','gallery']:['booking','crm','gallery']).map(f=>[f,{enabled:true}]))})
const apiError=(status,code,message)=>Object.assign(new Error(message),{status,code})
const json=(res,status,value,headers={})=>{res.writeHead(status,{'content-type':'application/json',...headers});res.end(JSON.stringify(value))}
let intake=createSetupIntake({db,apiError,json,getEntitlements:ent})
const server=createServer(async(req,res)=>{try{if(!await intake.route({req,res,path:new URL(req.url,'http://localhost').pathname,isPlatform:()=>req.headers.authorization===fixtureAuthorization}))json(res,404,{})}catch(e){json(res,e.status||500,{error:{code:e.code,message:e.message}})}})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const base=`http://127.0.0.1:${server.address().port}`,p='/platform/tenants/a/setup-intake',auth={authorization:fixtureAuthorization}
async function call(path=p,{method='GET',value,headers=auth,body}={}){const r=await fetch(base+path,{method,headers:{...headers,...(value?{'content-type':'application/json'}:{})},body:value?JSON.stringify(value):body});return {status:r.status,body:r.headers.get('content-type')?.includes('application/json')?await r.json():Buffer.from(await r.arrayBuffer()),headers:r.headers}}
function check(name,condition){assert.ok(condition,name);console.log(`ok ${++n} - ${name}`)}
try{
  let nullTenantRejected=false;try{db.prepare("INSERT INTO platform_setup_intakes(tenant_id,updated_at) VALUES(NULL,'2026-11-16T00:00:00Z')").run()}catch(e){nullTenantRejected=/NOT NULL constraint failed: platform_setup_intakes\.tenant_id/.test(e.message)}check('资料表数据库拒绝空门店归属',nullTenantRejected)
  check('未登录不能读取平台资料',(await call(p,{headers:{}})).status===401)
  check('普通商家会话不能代配',(await call(p,{headers:{authorization:'Bearer merchant'}})).status===401)
  let r=await call();check('初始状态不写入资料表',r.body.revision===0&&db.prepare('SELECT COUNT(*) n FROM platform_setup_intakes').get().n===0)
  check('个人版不要求会员员工资料',!allowedSections(ent('b')).some(s=>['membership','team','salary'].includes(s.id)))
  const answers={basic:{name:'隔离测试店',city:'多伦多',currency:'CAD',contact:'测试联系'},services:{status:'later'},membership:{note:'充值方案待确认'}}
  r=await call(p,{method:'PUT',value:{answers,revision:0,submit:true}});check('基本资料齐全可提交并保留待补项',r.status===200&&r.body.status==='submitted'&&r.body.progress.find(s=>s.id==='services').status==='later')
  r=await call(p,{method:'PUT',value:{answers,revision:0}});check('重复旧版本提交拒绝覆盖',r.status===409)
  r=await call(p,{method:'PUT',value:{answers:{basic:{name:'x'}},revision:1,submit:true}});check('必填内容缺失不能标已提交',r.status===400)
  r=await call(p,{method:'PUT',value:{answers:{notReal:{note:'x'}},revision:1}});check('未知模块拒绝',r.status===400)
  let invalidError;try{validateAnswers({team:{count:'-1'}},allowedSections(ent('a')))}catch(e){invalidError=e}check('负人数拒绝',invalidError instanceof Error)
  invalidError=null;try{validateAnswers({basic:{name:'x'.repeat(201)}},allowedSections(ent('a')))}catch(e){invalidError=e}check('超长字段拒绝',invalidError instanceof Error)
  invalidError=null;try{validateAnswers({membership:{uses:['未知选项']}},allowedSections(ent('a')))}catch(e){invalidError=e}check('未知选项拒绝',invalidError instanceof Error)
  r=await call(p,{method:'PUT',value:{answers,revision:1}});check('草稿正常更新',r.status===200&&r.body.revision===2)
  const outcomes=await Promise.all([call(p,{method:'PUT',value:{answers,revision:2}}),call(p,{method:'PUT',value:{answers,revision:2}})])
  check('并发保存只有一方成功',outcomes.filter(x=>x.status===200).length===1&&outcomes.filter(x=>x.status===409).length===1)
  const link=await call(p+'/link',{method:'POST'}),token=link.body.url.split('#')[1],invite={'x-setup-intake-token':token}
  check('链接只保存摘要',!!token&&!JSON.stringify(db.prepare('SELECT * FROM platform_setup_intake_links').all()).includes(token))
  check('填写链接能读取指定店',(await call('/setup-intake',{headers:invite})).body.tenantId==='a')
  check('填写链接不能读取另一家平台资料',(await call('/platform/tenants/b/setup-intake',{headers:invite})).status===401)
  const upload={method:'POST',headers:{...invite,'x-setup-section':'services','x-file-name':encodeURIComponent('价目表.txt')},body:Buffer.from('卸甲 20 CAD')}
  r=await call('/setup-intake/files',upload);const fileId=r.body.file.id
  check('原文件上传并关联模块',r.status===201&&r.body.file.section==='services')
  r=await call('/setup-intake/files',upload);check('重复上传幂等',r.status===200&&r.body.duplicate&&r.body.file.id===fileId)
  r=await call('/setup-intake/files/'+fileId,{headers:invite});check('原文件字节保持',r.body.equals(upload.body)&&r.headers.get('content-disposition').startsWith('attachment;'))
  const linkB=await call('/platform/tenants/b/setup-intake/link',{method:'POST'}),inviteB={'x-setup-intake-token':linkB.body.url.split('#')[1]}
  check('跨店文件不能下载',(await call('/setup-intake/files/'+fileId,{headers:inviteB})).status===404)
  check('跨店文件不能删除',(await call('/setup-intake/files/'+fileId,{method:'DELETE',headers:inviteB})).status===404)
  check('个人版不能伪造未开通模块',(await call('/setup-intake',{method:'PUT',headers:inviteB,value:{revision:0,answers:{membership:{note:'x'}}}})).status===400)
  check('个人版不能上传到未开通模块',(await call('/setup-intake/files',{...upload,headers:{...inviteB,'x-setup-section':'membership','x-file-name':'rules.txt'}})).status===400)
  check('伪装图片拒绝',(await call('/setup-intake/files',{...upload,headers:{...invite,'x-setup-section':'services','x-file-name':'fake.png'}})).status===400)
  check('SVG主动内容拒绝',(await call('/setup-intake/files',{...upload,headers:{...invite,'x-setup-section':'services','x-file-name':'x.svg'},body:Buffer.from('<svg onload="alert(1)"></svg>')})).status===400)
  check('超大文件拒绝',(await call('/setup-intake/files',{...upload,body:Buffer.alloc(10*1024*1024+1,65)})).status===413)
  const before=db.prepare('SELECT answers_json FROM platform_setup_intakes WHERE tenant_id=?').get('a').answers_json
  full=false;r=await call();check('降级后隐藏复杂模块',!r.body.sections.some(s=>s.id==='membership'))
  r=await call(p,{method:'PUT',value:{revision:r.body.revision,answers:{basic:answers.basic}}});check('降级后保存不删除旧资料',JSON.parse(db.prepare('SELECT answers_json FROM platform_setup_intakes WHERE tenant_id=?').get('a').answers_json).membership.note===JSON.parse(before).membership.note)
  full=true
  await call(p+'/link',{method:'POST'});check('更新链接吊销旧凭据',(await call('/setup-intake',{headers:invite})).status===401)
  await call('/platform/tenants/b/setup-intake/link',{method:'DELETE'});check('停用链接生效',(await call('/setup-intake',{headers:inviteB})).status===401)
  intake=createSetupIntake({db,apiError,json,getEntitlements:ent});check('重复初始化保留资料和文件',(await call()).body.files.length===1)
  check('原有业务字段逐值不变',JSON.stringify(db.prepare('SELECT * FROM old_balances').all())==='[{"id":"existing","amount":25000}]')
  r=await call(p+'/files/'+fileId,{method:'DELETE'});check('删除只影响收集文件',r.status===200&&db.prepare('SELECT COUNT(*) n FROM old_balances').get().n===1)
  console.log(`${n} checks passed; in-memory isolated database only.`)
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close()}
