import {randomBytes} from 'node:crypto'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {createSetupPreview} from './platform-setup-preview.mjs'
const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE tenants(id TEXT PRIMARY KEY,status TEXT); INSERT INTO tenants VALUES('a','active'),('b','active')")
let invalidDraft=false,requests=[],checks=0
const err=(status,code,message)=>Object.assign(Error(message),{status,code})
const deps={db,apiError:err,json:(res,status,body)=>Object.assign(res,{status,body}),getEntitlements:()=>({}),workflow:{preview:()=>{if(invalidDraft)throw err(409,'DRAFT_CONFLICT','草稿已变化');return {draft:{revision:1}}}},previewWechat:{appid:'isolated-preview-test',secret:randomBytes(16).toString('hex'),fetcher:async(url,opt)=>{requests.push({url,body:opt?.body&&JSON.parse(opt.body)});if(url.includes('/token?'))return new Response(JSON.stringify({access_token:'synthetic-token',expires_in:7200}),{headers:{'content-type':'application/json'}});const png=Buffer.alloc(120);Buffer.from('89504e470d0a1a0a','hex').copy(png);return new Response(png,{headers:{'content-type':'image/png'}})}}}
const service=createSetupPreview(deps),route=async(path,headers={},platform=true,method='POST',svc=service)=>{const res={};await svc.route({req:{headers,method},res,path,isPlatform:()=>platform});return res}
const check=(name,ok)=>{assert.ok(ok,name);console.log('ok '+(++checks)+' - '+name)}
async function rejects(name,fn,code){await assert.rejects(fn,e=>e.code===code);check(name,true)}
try{
 const grant=(await route('/platform/tenants/a/setup-preview',{'x-preview-page':'membership'})).body
 check('场景短码格式和原生入口一致',/^pages\/setup-preview\/index\?scene=v[0-9a-f]{24}$/.test(grant.miniPage))
 const claim=(await route('/setup-preview/claim',{'x-preview-ticket':grant.ticket},false)).body
 check('扫码仅取得同店只读预览',claim.tenantId==='a'&&claim.readOnly&&claim.page==='pages/merchant/member/index')
 const code=await route('/platform/tenants/a/setup-preview-code',{'x-preview-ticket':grant.ticket})
 check('二维码响应为体验版图片',code.body.envVersion==='trial'&&code.body.image.startsWith('data:image/png;base64,'))
 const sent=requests.at(-1).body
 check('微信请求指向真实预览页及本次短码',sent.scene==='v'+grant.ticket&&sent.page==='pages/setup-preview/index'&&sent.env_version==='trial'&&sent.check_path===false)
 await rejects('未登录平台不能生成码',()=>route('/platform/tenants/a/setup-preview-code',{'x-preview-ticket':grant.ticket},false),'UNAUTHORIZED')
 await rejects('不能把A店码生成到B店',()=>route('/platform/tenants/b/setup-preview-code',{'x-preview-ticket':grant.ticket}),'PREVIEW_EXPIRED')
 await rejects('伪造短码不能领取',()=>route('/setup-preview/claim',{'x-preview-ticket':'wrong'},false),'PREVIEW_EXPIRED')
 await rejects('领取接口不接受GET',()=>route('/setup-preview/claim',{},false,'GET'),'METHOD_NOT_ALLOWED')
 const web=(await route('/platform/tenants/a/setup-preview',{'x-preview-page':'storeSettings','x-preview-detail':'hero'})).body
 await rejects('仅网页模块不给无效小程序码',()=>route('/platform/tenants/a/setup-preview-code',{'x-preview-ticket':web.ticket}),'WEB_ONLY')
 await rejects('仅网页模块不能从小程序领取',()=>route('/setup-preview/claim',{'x-preview-ticket':web.ticket},false),'WEB_ONLY')
 const staff=(await route('/platform/tenants/a/setup-preview',{'x-preview-role':'staff'})).body
 let staffError;try{service.authorize({headers:{authorization:'Bearer '+staff.token},method:'GET'},'/admin/packages')}catch(e){staffError=e}check('员工码不获得老板配置权限',staffError?.code==='FORBIDDEN')
 let writeError;try{service.authorize({headers:{authorization:'Bearer '+grant.token},method:'POST'},'/admin/packages')}catch(e){writeError=e}check('扫码凭据仍拒绝业务写入',writeError?.code==='PREVIEW_READ_ONLY')
 db.exec("UPDATE tenants SET status='inactive' WHERE id='a'")
 const sentBefore=requests.length
 await rejects('停用门店不能继续生成码',()=>route('/platform/tenants/a/setup-preview-code',{'x-preview-ticket':grant.ticket}),'PREVIEW_UNAVAILABLE')
 await rejects('停用门店旧码不能领取',()=>route('/setup-preview/claim',{'x-preview-ticket':grant.ticket},false),'PREVIEW_UNAVAILABLE')
 check('失效状态在调用微信前拦截',requests.length===sentBefore)
 db.exec("UPDATE tenants SET status='active' WHERE id='a'")
 const draft=(await route('/platform/tenants/a/setup-preview',{'x-setup-draft-id':'draft-a'})).body;invalidDraft=true
 await rejects('变化草稿不能继续生成码',()=>route('/platform/tenants/a/setup-preview-code',{'x-preview-ticket':draft.ticket}),'DRAFT_CONFLICT')
 await rejects('变化草稿旧码不能领取',()=>route('/setup-preview/claim',{'x-preview-ticket':draft.ticket},false),'DRAFT_CONFLICT')
 invalidDraft=false
 const now=Date.now;try{Date.now=()=>now()+31*60000;await rejects('过期码不能领取',()=>route('/setup-preview/claim',{'x-preview-ticket':grant.ticket},false),'PREVIEW_EXPIRED');await rejects('过期码不能重新生成',()=>route('/platform/tenants/a/setup-preview-code',{'x-preview-ticket':grant.ticket}),'PREVIEW_EXPIRED')}finally{Date.now=now}
 await rejects('服务重启后旧内存码失效',()=>route('/setup-preview/claim',{'x-preview-ticket':grant.ticket},false,'POST',createSetupPreview(deps)),'PREVIEW_EXPIRED')
 console.log('All '+checks+' preview-code boundary checks passed; in-memory database and simulated WeChat transport; no real scan claimed.')
}finally{db.close()}
