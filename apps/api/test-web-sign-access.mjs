// 无演示登录、已配置微信密钥时的网页签署闭环；所有数据均为独立测试夹具。
import {mkdtempSync,openSync,closeSync,rmSync} from 'node:fs'
import {randomBytes} from 'node:crypto'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {DatabaseSync} from 'node:sqlite'
import {createSettlementReadAccess} from './settlement-read-access.mjs'
import {createSettlementAccess} from './settlement-access.mjs'
const dir=mkdtempSync('/tmp/ll-ci-data.web-sign-'),port=Number(process.env.WEB_SIGN_TEST_PORT||4342),base=`http://127.0.0.1:${port}`,owner='web-sign-test-only',fd=openSync(dir+'/server.log','w')
const server=spawn(process.execPath,['local-server.mjs'],{cwd:fileURLToPath(new URL('.',import.meta.url)),env:{PATH:process.env.PATH,HOME:process.env.HOME,DATA_DIR:dir,PORT:String(port),HOST:'127.0.0.1',OWNER_TOKEN:owner,WECHAT_MINI_TOKEN_SECRET:'web-sign-mini-test-only',WECHAT_APP_SECRET:process.env.WEB_SIGN_NO_SECRET==='1'?'':'configured-test-placeholder',ALLOW_DEMO_ADMIN_LOGIN:'false',NOTIFY_TICK:'off'},stdio:['ignore',fd,fd]})
let db,n=0;const fail=[]
const check=(label,ok,detail='')=>{n++;console.log(`${ok?'ok':'not ok'} ${n} - ${label}${ok?'':' :: '+detail}`);if(!ok)fail.push(label)}
async function req(path,{body,token=owner,tid='web-sign-a',signToken,method=body?'POST':'GET'}={}){const r=await fetch(base+path,{method,headers:{'content-type':'application/json','x-admin-tenant-id':tid,'x-tenant-id':tid,...(token?{authorization:'Bearer '+token}:{}),...(signToken?{'x-settlement-token':signToken}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}}
const signBody={signerConfirmed:true,disclaimerAccepted:true,signature:'隔离验收本人',strokes:[[{x:10,y:10},{x:20,y:20},{x:30,y:12}]]}
try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 db=new DatabaseSync(dir+'/lucky-luxe.sqlite',{readOnly:true})
 for(const tid of ['web-sign-a','web-sign-b']){const r=await req('/platform/tenants',{tid,body:{id:tid,name:tid,plan:'chain',currency:'CNY',timezone:'Asia/Shanghai'}});check('建立隔离店 '+tid,r.status===201)}
 const store=(await req('/platform/tenants/web-sign-a/store')).data.store
 await req('/platform/tenants/web-sign-a/business-hours',{method:'PUT',body:{hours:Array.from({length:7},(_,weekday)=>({weekday,openTime:'08:00',closeTime:'22:00',isClosed:false}))}})
 const tech=(await req('/platform/tenants/web-sign-a/technicians',{body:{name:'签署技师'}})).data.technician
 const tech2=(await req('/platform/tenants/web-sign-a/technicians',{body:{name:'其他技师'}})).data.technician
 const svc=(await req('/platform/tenants/web-sign-a/services',{body:{type:'NAIL',nameZh:'签署项目',nameEn:'sign service',priceCents:19800,baseDurationMin:60}})).data.service
 let slot=8
 async function make(userId,technicianId=tech.id){const booking=(await req('/admin/bookings/direct',{body:{...(userId?{userId}:{newCustomerName:'网页未绑客'}),storeId:store.id,serviceId:svc.id,technicianId,date:'2030-10-07',time:String(slot++).padStart(2,'0')+':00'}})).data.booking;if(!booking)throw Error('预约夹具失败');const made=await req('/admin/settlements',{body:{cardOwnerUserId:booking.user.id,settlements:[{bookingId:booking.id,tierKey:'list',payIntent:'offline_full',items:[{serviceId:svc.id}],technicians:[{technicianId,share:100}]}]}});if(!made.data.settlements?.[0])throw Error(JSON.stringify(made));return {booking,sheet:made.data.settlements[0]}}
 const one=await make(),two=await make(),voided=await make()
 const route=one.sheet.code
 const baseline=()=>JSON.stringify({u:db.prepare('SELECT wechat_open_id FROM users WHERE id=?').get(one.booking.user.id),i:db.prepare('SELECT * FROM user_identities WHERE user_id=?').all(one.booking.user.id)})
 const beforeIdentity=baseline(),users=db.prepare('SELECT COUNT(*) n FROM users').get().n
 check('普通未登录不能凭单号签署',(await req(`/settlements/${route}/sign`,{token:null,body:signBody})).status===401)
 check('普通未登录不能凭单号换券',(await req(`/settlements/${route}/coupon`,{token:null,body:{grantId:''}})).status===401)
 check('未登录不能凭单号读取金额与顾客档案',(await req(`/settlements/${route}`,{token:null})).status===401)
 const issued=await req(`/admin/settlements/${one.sheet.id}/sign-token`,{body:{}});const token=issued.data.token
 check('商家可出短时链接且不谎报已推送',issued.status===200&&token.length>=64&&issued.data.pushedToMiniApp===false&&!issued.data.pushedText.includes('已推送'))
 check('跨店商家不能给本店单出链接',(await req(`/admin/settlements/${one.sheet.id}/sign-token`,{tid:'web-sign-b',body:{}})).status===404)
 const read=await req('/settlements/by-token/'+token,{token:null});check('网页链接解析回原单',read.status===200&&read.data.code===route)
 check('持签署链接能读本单，不能读其他单',(await req(`/settlements/${route}`,{token:null,signToken:token})).status===200&&(await req(`/settlements/${two.sheet.code}`,{token:null,signToken:token})).status===403)
 check('确认之前仍未绑定微信',baseline()===beforeIdentity)
 check('有效链接不能签别的单',(await req(`/settlements/${two.sheet.code}/sign`,{token:null,signToken:token,body:signBody})).status===403)
 check('有效链接不能修改别单优惠券',(await req(`/settlements/${two.sheet.code}/coupon`,{token:null,signToken:token,body:{grantId:''}})).status===403)
 check('缺少本人确认被拒',(await req(`/settlements/${route}/sign`,{token:null,signToken:token,body:{...signBody,signerConfirmed:false}})).data.error?.code==='SIGNER_CONFIRMATION_REQUIRED')
 check('伪造openid不能绑定档案',(await req(`/settlements/${route}/claim`,{token:null,signToken:token,body:{openid:'forged-openid'}})).status===401&&baseline()===beforeIdentity)
 const bind=(await req(`/admin/customers/${one.booking.user.id}/bind-token`,{body:{}})).data
 check('档案绑定码不接受伪造openid',(await req(`/bind-tokens/${bind.token}/confirm`,{token:null,body:{openid:'forged-openid'}})).status===401&&baseline()===beforeIdentity)
 check('会员认领码不接受伪造openid',(await req(`/member-code/${issued.data.settlement.memberCode}/claim`,{token:null,body:{openid:'forged-openid'}})).status===401&&baseline()===beforeIdentity)
 const again=await req(`/admin/settlements/${one.sheet.id}/sign-token`,{body:{}});const latest=again.data.token
 check('重发使旧链接失效',(await req('/settlements/by-token/'+token,{token:null})).status===410)
 check('旧页面打开后也不能绕过重发限制签字',(await req(`/settlements/${route}/sign`,{token:null,signToken:token,body:signBody})).status===410)
 const guard=createSettlementAccess({db,apiError:(status,code,message)=>Object.assign(new Error(message),{status,code}),requireCustomer:()=>null,demoAllowed:()=>false});const row=db.prepare('SELECT * FROM settlements WHERE id=?').get(one.sheet.id);const originalNow=Date.now;let expired=false;try{Date.now=()=>originalNow()+2*86400000;guard.tokenRow(latest,row)}catch(e){expired=e.code==='SIGN_TOKEN_EXPIRED'}finally{Date.now=originalNow}check('24小时链接超过期限即拒绝',expired)
 const ledgerBefore=db.prepare('SELECT COUNT(*) n FROM finance_transactions').get().n
 const signed=await req(`/settlements/${route}/sign`,{token:null,signToken:latest,body:signBody});check('有微信密钥且演示门关闭时，未绑顾客也可凭链接签字',signed.status===200,JSON.stringify(signed.data).slice(0,180))
 const doc=(await req(`/settlements/${route}`,{token:null,signToken:latest})).data.settlement
 for(const suffix of ['snapshot?format=svg','signature.png'])check('匿名不能凭单号读 '+suffix,(await fetch(base+`/settlements/${route}/`+suffix)).status===401)
 const docResponse=await fetch(base+doc.snapshot.url+'&format=svg');check('短时只读凭据可打开凭证且禁止公开缓存',docResponse.status===200&&docResponse.headers.get('cache-control').includes('no-store')&&(await docResponse.text()).includes('<svg'))
 check('短时签名图片可实际读取',(await fetch(base+doc.signatureUrl)).status===200)
 const view=new URL(base+doc.snapshot.url).searchParams.get('view')
 check('只读凭据跨单及伪造均被拒',(await req(`/settlements/${two.sheet.code}?view=${view}`,{token:null})).status===401&&(await req(`/settlements/${route}?view=${view.slice(0,-1)}z`,{token:null})).status===401)
 check('只读凭据不能授权签字',(await req(`/settlements/${two.sheet.code}/sign?view=${view}`,{token:null,body:signBody})).status===401)
 const readGuard=createSettlementReadAccess({secret:randomBytes(32).toString('hex'),apiError:(status,code,message)=>Object.assign(new Error(message),{status,code})})
 const readView=new URL('http://localhost'+readGuard.url(route)).searchParams.get('view')
 let expiredRead=false;try{Date.now=()=>originalNow()+3601000;readGuard.authorize({}, {code:route}, {view:readView})}catch(e){expiredRead=e.code==='DOCUMENT_LINK_INVALID'}finally{Date.now=originalNow}
 check('只读凭据超过一小时失效',expiredRead)
 const saved=db.prepare('SELECT status,signed_at,snapshot_inline FROM settlements WHERE id=?').get(one.sheet.id)
 check('真实写入已签状态与签署快照',saved.status==='signed'&&Boolean(saved.signed_at)&&Boolean(saved.snapshot_inline))
 check('签署后原预约完成',db.prepare('SELECT status FROM bookings WHERE id=?').get(one.booking.id).status==='COMPLETED')
 check('签字不伪造微信身份、不新增顾客',baseline()===beforeIdentity&&db.prepare('SELECT COUNT(*) n FROM users').get().n===users)
 const ledgerAfter=db.prepare('SELECT COUNT(*) n FROM finance_transactions').get().n;check('签署才产生财务入账',ledgerAfter>ledgerBefore)
 check('重复签署被拒且不会重复入账',(await req(`/settlements/${route}/sign`,{token:null,signToken:latest,body:signBody})).status===400&&db.prepare('SELECT COUNT(*) n FROM finance_transactions').get().n===ledgerAfter)
 check('已签单不能重新出签署链接',(await req(`/admin/settlements/${one.sheet.id}/sign-token`,{body:{}})).status===400)
 const revokeToken=(await req(`/admin/settlements/${voided.sheet.id}/sign-token`,{body:{}})).data.token
 await req(`/admin/settlements/${voided.sheet.id}/void`,{body:{reason:'隔离测试撤回'}})
 check('已撤回单的旧链接不可用',(await req('/settlements/by-token/'+revokeToken,{token:null})).status===409)
 check('已撤回单不能再出链接',(await req(`/admin/settlements/${voided.sheet.id}/sign-token`,{body:{}})).status===409)
 const customer=(await req('/auth/wechat/mini-login',{token:null,body:{code:'stub:web-sign-owner',tenantId:'web-sign-a'}})).data
 const owned=await make(customer.user.id)
 check('真实顾客会话可换本人单据链接',(await req(`/my/settlements/${owned.sheet.code}/sign-link`,{token:customer.auth.accessToken,body:{}})).status===200)
 check('顾客不能换别人单据链接',(await req(`/my/settlements/${two.sheet.code}/sign-link`,{token:customer.auth.accessToken,body:{}})).status===404)
 check('顾客不能直接签别人的单',(await req(`/settlements/${two.sheet.code}/sign`,{token:customer.auth.accessToken,body:signBody})).status===403)
 check('自己的有效会话仍可从小程序签字',(await req(`/settlements/${owned.sheet.code}/sign`,{token:customer.auth.accessToken,body:signBody})).status===200)
 const apiKey=await req('/admin/staff-accounts',{body:{technicianId:tech2.id}});const account=apiKey.data;const first=(await req('/admin/auth/login',{token:null,body:{email:account.username,password:account.initialPassword}})).data
 check('顾客可换取自己的已签只读链接',(await req(`/my/settlements/${owned.sheet.code}/document-link`,{token:customer.auth.accessToken})).status===200)
 check('顾客不能换取他人的只读链接',(await req(`/my/settlements/${route}/document-link`,{token:customer.auth.accessToken})).status===404)
 const staffOwn=await make(null,tech2.id);check('员工可以为自己参与的服务单出链接',(await req(`/admin/settlements/${staffOwn.sheet.id}/sign-token`,{token:first.auth.accessToken,body:{}})).status===200)
 check('员工通过单号也可生成自己服务的签署链接',(await req(`/admin/settlements/${staffOwn.sheet.code}/sign-token`,{token:first.auth.accessToken,body:{}})).status===200)
 check('员工可以读取自己服务的单据',(await req(`/settlements/${staffOwn.sheet.code}`,{token:first.auth.accessToken})).status===200)
 const noteCount=()=>db.prepare('SELECT COUNT(*) n FROM service_notes').get().n
 const notesBefore=noteCount()
 check('员工不能用本人预约替别的顾客写小记',(await req('/admin/service-notes',{token:first.auth.accessToken,body:{bookingId:staffOwn.booking.id,userId:two.booking.user.id,rawText:'不得落库'}})).data.error?.code==='CUSTOMER_MISMATCH'&&noteCount()===notesBefore)
 check('跨店顾客不能挂到本店小记',(await req('/admin/service-notes',{tid:'web-sign-b',body:{userId:two.booking.user.id,rawText:'不得落库'}})).status===404&&noteCount()===notesBefore)
 check('不存在的预约不能被忽略后继续写小记',(await req('/admin/service-notes',{body:{bookingId:'absent',userId:two.booking.user.id,rawText:'不得落库'}})).status===404&&noteCount()===notesBefore)
 check('员工正常为本人预约保存服务小记',(await req('/admin/service-notes',{token:first.auth.accessToken,body:{bookingId:staffOwn.booking.id,userId:staffOwn.booking.user.id,rawText:'正常服务小记'}})).status===201&&noteCount()===notesBefore+1)
 check('员工不可读取其他技师单据与整组快照',(await req(`/settlements/${two.sheet.code}`,{token:first.auth.accessToken})).status===403&&(await req(`/admin/settlements/${two.sheet.id}/snapshots`,{token:first.auth.accessToken})).status===403)
 check('其他技师不能给非本人服务单出签署链接',(await req(`/admin/settlements/${two.sheet.id}/sign-token`,{token:first.auth.accessToken,body:{}})).status===403)
 check('其他技师不能轮询非本人服务单签署状态',(await req(`/admin/settlements/${two.sheet.id}/sign-state`,{token:first.auth.accessToken})).status===403)
 const group=await req('/admin/settlements',{body:{cardOwnerUserId:two.booking.user.id,settlements:[tech,tech2].map(t=>({tierKey:'list',payIntent:'offline_full',items:[{serviceId:svc.id}],technicians:[{technicianId:t.id,share:100}]}))}})
 const sheets=group.data.settlements;if(sheets?.length!==2)throw Error('多单夹具失败 '+JSON.stringify(group.data))
 const firstLink=(await req(`/admin/settlements/${sheets[0].id}/sign-token`,{body:{}})).data.token
 check('连续签署第一单成功',(await req(`/settlements/${sheets[0].code}/sign`,{token:null,signToken:firstLink,body:signBody})).status===200)
 const continued=(await req('/settlements/by-token/'+firstLink,{token:null})).data
 const nextToken=new URL(continued.nextSignUrl).searchParams.get('t')
 const next=(await req('/settlements/by-token/'+nextToken,{token:null})).data
 check('第一单凭据只续到同顾客同组下一单',next.code===sheets[1].code)
 check('连续签署下一单成功',(await req(`/settlements/${next.code}/sign`,{token:null,signToken:nextToken,body:signBody})).status===200)
 check('全部签完不再给后续链接',!(await req('/settlements/by-token/'+nextToken,{token:null})).data.nextSignUrl)
}catch(e){check('流程完成',false,e.stack)}finally{db?.close();server.kill();if(server.exitCode===null)await new Promise(r=>server.once('exit',r));closeSync(fd);if(!fail.length)rmSync(dir,{recursive:true,force:true});else console.log('失败现场 '+dir)}
console.log(`${n} checks; ${fail.length} failures`);process.exitCode=fail.length?1:0
