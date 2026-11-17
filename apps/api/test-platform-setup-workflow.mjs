import {randomBytes} from 'node:crypto'
const fixtureAuthorization='Bearer '+randomBytes(24).toString('hex')
import {DatabaseSync} from 'node:sqlite'
import {createServer} from 'node:http'
import {AsyncLocalStorage} from 'node:async_hooks'
import assert from 'node:assert/strict'
import {createSetupWorkflow} from './platform-setup-workflow.mjs'
const db=new DatabaseSync(':memory:'),tenantContext=new AsyncLocalStorage()
db.exec("CREATE TABLE tenants(id TEXT PRIMARY KEY,status TEXT);INSERT INTO tenants VALUES('a','active'),('b','active');CREATE TABLE settings(tenant TEXT PRIMARY KEY,value TEXT);INSERT INTO settings VALUES('a','original'),('b','other');CREATE TABLE history(id TEXT PRIMARY KEY,amount INTEGER);INSERT INTO history VALUES('old',15000)")
let needsOwner=false,metadataVersion=0
const getSetupAdapters=()=>({test:{conflictData:d=>({value:d.value}),ownerConfirmation:needsOwner,title:'Test',fields:['value'],previewPath:'/admin/config-test',read:tid=>({metadataVersion,value:db.prepare('SELECT value FROM settings WHERE tenant=?').get(tid).value}),write:(tid,b)=>{assert.equal(tenantContext.getStore().tenantId,tid);if(typeof b.value!=='string')throw Object.assign(new Error('invalid value'),{status:400});db.prepare('UPDATE settings SET value=? WHERE tenant=?').run(b.value,tid);return {value:b.value}}}})
const json=(res,status,v,h={})=>{res.writeHead(status,{'content-type':'application/json',...h});res.end(JSON.stringify(v))},apiError=(status,code,message)=>Object.assign(new Error(message),{status,code})
let workflow=createSetupWorkflow({db,apiError,json,tenantContext,getSetupAdapters,getEntitlements:()=>({features:{}})})
const server=createServer(async(req,res)=>{try{if(await workflow.merchantRoute(req,res,{path:new URL(req.url,'http://local').pathname,adminSession:{role:req.headers['x-test-role']||'owner',provider:req.headers['x-test-provider']||'account',tenantId:req.headers['x-test-tenant']||'a'}}))return;if(!await workflow.route({req,res,path:new URL(req.url,'http://local').pathname,isPlatform:()=>req.headers.authorization===fixtureAuthorization}))json(res,404,{})}catch(e){json(res,e.status||500,{error:{code:e.code,message:e.message}})}})
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/platform/tenants/`,checks=[]
async function api(path='a/setup',method='GET',body,authorized=true){const r=await fetch(base+path,{method,headers:authorized?{authorization:fixtureAuthorization,'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}}
function check(name,pass){assert.ok(pass,name);checks.push(name);console.log('ok '+checks.length+' - '+name)}
try{
 check('未登录拒绝',(await api('a/setup','GET',null,false)).status===401)
 let current=(await api('a/setup/modules/test')).data
 let r=await api('a/setup/drafts','POST',{module:'test',body:{value:'proposed'},sourceNote:'资料第2页，商家确认180天',fingerprint:current.fingerprint});check('草稿保存成功',r.status===201);const draft=r.data.draft
 check('保留资料页码与确认说明',draft.sourceNote==='资料第2页，商家确认180天')
 const platformReview=(await api('a/setup')).data.drafts.find(d=>d.id===draft.id);const merchantReview=await (await fetch(base.replace('/platform/tenants/','')+'/admin/setup-review')).json();check('平台和老板核对使用一致的实际变更说明',JSON.stringify(platformReview.changes)===JSON.stringify(merchantReview.drafts.find(d=>d.id===draft.id).changes)&&platformReview.changes.length===1&&platformReview.changes[0].before==='original'&&platformReview.changes[0].after==='proposed')
 check('草稿验证不改变正式配置',db.prepare("SELECT value FROM settings WHERE tenant='a'").get().value==='original')
 check('草稿预览带真实验证结果',workflow.preview('a',draft.id).data.value==='proposed')
 metadataVersion++;check('不相关元数据变化不误判业务配置冲突',workflow.preview('a',draft.id).data.value==='proposed')
 check('越权草稿读取拒绝',(await api('b/setup/drafts/'+draft.id)).status===404)
 check('应用前必须确认',(await api('a/setup/drafts/'+draft.id+'/apply','POST',{revision:1})).status===400)
 r=await api('a/setup/drafts/'+draft.id+'/apply','POST',{revision:1,confirm:true});check('核对后应用',r.status===200&&r.data.draft.status==='applied')
 check('实际配置更新且另一店保持',db.prepare("SELECT value FROM settings WHERE tenant='a'").get().value==='proposed'&&db.prepare("SELECT value FROM settings WHERE tenant='b'").get().value==='other')
 r=await api('a/setup/drafts/'+draft.id+'/apply','POST',{revision:1,confirm:true});check('重复应用幂等',r.status===200&&r.data.alreadyApplied)
 check('审计只留一次应用',db.prepare("SELECT COUNT(*) n FROM platform_setup_events WHERE action='applied'").get().n===1)
 check('应用后草稿预览失效',(await api('a/setup/drafts/'+draft.id+'/preview')).status===409)
 check('过期正式版本不能建草稿',(await api('a/setup/drafts','POST',{module:'test',body:{value:'stale'},fingerprint:current.fingerprint})).status===409)
 current=(await api('a/setup/modules/test')).data
 r=await api('a/setup/drafts','POST',{module:'test',body:{value:'next'},fingerprint:current.fingerprint});const conflict=r.data.draft
 db.prepare("UPDATE settings SET value='merchant-change' WHERE tenant='a'").run()
 check('商家改动后应用阻止覆盖',(await api('a/setup/drafts/'+conflict.id+'/apply','POST',{revision:1,confirm:true})).status===409)
 check('商家改动后草稿预览要求核对',(await api('a/setup/drafts/'+conflict.id+'/preview')).status===409)
 check('商家原改动保持',db.prepare("SELECT value FROM settings WHERE tenant='a'").get().value==='merchant-change')
 current=(await api('a/setup/modules/test')).data
 check('超长确认说明拒绝',(await api('a/setup/drafts','POST',{module:'test',body:{value:'x'},sourceNote:'x'.repeat(2001),fingerprint:current.fingerprint})).status===400)
 check('非法字段拒绝',(await api('a/setup/drafts','POST',{module:'test',body:{unknown:'x'},fingerprint:current.fingerprint})).status===400)
 check('共享业务验证拒绝异常值',(await api('a/setup/drafts','POST',{module:'test',body:{value:12},fingerprint:current.fingerprint})).status===400)
 workflow=createSetupWorkflow({db,apiError,json,tenantContext,getSetupAdapters,getEntitlements:()=>({features:{}})})
 check('重复初始化不删草稿',db.prepare('SELECT COUNT(*) n FROM platform_setup_drafts').get().n===2)
 check('历史金额逐值保持',db.prepare("SELECT amount FROM history WHERE id='old'").get().amount===15000)
 needsOwner=true;current=(await api('a/setup/modules/test')).data
 r=await api('a/setup/drafts','POST',{module:'test',body:{value:'approved-rule'},fingerprint:current.fingerprint});const approval=r.data.draft
 check('敏感配置明确需要老板确认',approval.needsOwnerConfirmation&&!approval.ownerConfirmed)
 check('平台勾选不能代替老板确认',(await api('a/setup/drafts/'+approval.id+'/apply','POST',{revision:1,confirm:true})).data.error.code==='OWNER_CONFIRMATION_REQUIRED')
 async function review(id,action,headers={},feedback='请调整金额后重新发来核对'){const r=await fetch(base.replace('/platform/tenants/','')+'/admin/setup-review/'+id+'/'+action,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({revision:1,confirm:true,feedback})});return {status:r.status,data:await r.json()}}
 check('平台主钥匙不能冒充老板确认',(await review(approval.id,'confirm',{'x-test-provider':'demo-token'})).status===403)
 check('普通员工不能确认',(await review(approval.id,'confirm',{'x-test-role':'staff'})).status===403)
 check('另一店老板不能确认',(await review(approval.id,'confirm',{'x-test-tenant':'b'})).status===404)
 check('本店老板可确认且不立即应用',(await review(approval.id,'confirm')).data.draft.ownerConfirmed&&db.prepare("SELECT value FROM settings WHERE tenant='a'").get().value==='merchant-change')
 check('重复老板确认幂等',(await review(approval.id,'confirm')).status===200&&db.prepare("SELECT COUNT(*) n FROM platform_setup_events WHERE draft_id=? AND action='owner_confirmed'").get(approval.id).n===1)
 check('老板确认后可应用',(await api('a/setup/drafts/'+approval.id+'/apply','POST',{revision:1,confirm:true})).status===200)
 current=(await api('a/setup/modules/test')).data;r=await api('a/setup/drafts','POST',{module:'test',body:{value:'rejected'},fingerprint:current.fingerprint});const rejected=r.data.draft
 check('退回说明必须填写',(await review(rejected.id,'reject',{},'')).status===400)
 check('退回说明不能超长',(await review(rejected.id,'reject',{},'x'.repeat(2001))).status===400)
 check('老板退回只撤回草稿',(await review(rejected.id,'reject')).data.draft.status==='discarded')
 check('平台可读到老板退回意见',(await api('a/setup/drafts/'+rejected.id)).data.draft.ownerFeedback==='请调整金额后重新发来核对')
 check('被退回草稿不能继续应用',(await api('a/setup/drafts/'+rejected.id+'/apply','POST',{revision:1,confirm:true})).status===409)
 check('被退回草稿不能继续预览',(await api('a/setup/drafts/'+rejected.id+'/preview')).status===409)
 let immutable=false;try{db.prepare('DELETE FROM platform_setup_events').run()}catch{immutable=true}check('审计记录不可删除',immutable)
 check('仍有未处理草稿不能标完成',(await api('a/setup/reviews/test','POST',{status:'verified',note:'已核对',revision:0})).status===409)
 await api('a/setup/drafts/'+conflict.id+'/discard','POST',{revision:1})
 check('缺资料原因必填',(await api('a/setup/reviews/test','POST',{status:'needs_materials',note:'',revision:0})).status===400)
 check('实际核对可以保存',(await api('a/setup/reviews/test','POST',{status:'verified',note:'网页与小程序对应字段已人工核对',revision:0})).status===200)
 check('并发旧版本核对拒绝',(await api('a/setup/reviews/test','POST',{status:'skipped',note:'不应覆盖',revision:0})).status===409)
 check('核对状态不串店',(await api('b/setup')).data.reviews.length===0)
 db.prepare("UPDATE settings SET value='changed-after-review' WHERE tenant='a'").run()
 check('配置改变后自动要求重核',(await api('a/setup')).data.reviews[0].stale===true)
 current=(await api('a/setup/modules/test')).data
 r=await api('a/setup/drafts','POST',{module:'test',body:{value:'replacement-first'},fingerprint:current.fingerprint});const previous=r.data.draft
 r=await api('a/setup/drafts','POST',{module:'test',body:{value:'replacement-edited'},fingerprint:current.fingerprint,replacesDraftId:previous.id,replacesRevision:1});const replaced=r.data.draft
 check('继续编辑生成新版本且撤回旧稿',r.status===201&&(await api('a/setup/drafts/'+previous.id)).data.draft.status==='discarded')
 check('已撤回的旧稿不能应用',(await api('a/setup/drafts/'+previous.id+'/apply','POST',{revision:1,confirm:true})).status===409)
 check('修改草稿后需要老板重新确认',!replaced.ownerConfirmed)
 const inboxOwner={role:'owner',provider:'account',tenantId:'a'}
 const inbox=workflow.inbox('a',inboxOwner)
 check('老板消息包含待核对及已应用配置',inbox.some(x=>x.title==='平台配置待核对')&&inbox.some(x=>x.title==='平台配置已应用'))
 check('消息只提供入口和模块说明不泄露草稿',inbox.every(x=>x.action==='setup_review'&&!('body' in x)&&!('proposed' in x)))
 check('消息不含退回和被替代的旧草稿',!inbox.some(x=>x.id==='setup:'+db.prepare("SELECT id FROM platform_setup_events WHERE draft_id=? AND action='draft_saved'").get(previous.id).id)&&!inbox.some(x=>x.id==='setup:'+db.prepare("SELECT id FROM platform_setup_events WHERE draft_id=? AND action='draft_saved'").get(rejected.id).id))
 check('老板消息不能跨店读取',workflow.inbox('b',inboxOwner).length===0&&workflow.inbox('b',{...inboxOwner,tenantId:'b'}).length===0)
 check('员工和预览或演示登录不返回配置通知',[{...inboxOwner,role:'staff'},{...inboxOwner,preview:true},{...inboxOwner,provider:'demo-token'}].every(a=>workflow.inbox('a',a).length===0))
 await review(replaced.id,'confirm')
 const replacedEvent=db.prepare("SELECT id FROM platform_setup_events WHERE draft_id=? AND action='draft_saved'").get(replaced.id).id
 check('老板确认后不再显示待核对消息',!workflow.inbox('a',inboxOwner).some(x=>x.id==='setup:'+replacedEvent))
 console.log(`${checks.length} workflow checks passed (in-memory isolated database)`)
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));db.close()}
