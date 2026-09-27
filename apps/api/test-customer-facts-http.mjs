/* Isolated HTTP contract: the same backend facts reach customer, merchant and lookup.
   Temporary fixture DB only; no dependency on a populated demonstration account. */
import assert from 'node:assert/strict'
import { mkdtempSync,openSync,closeSync,rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
const dir=mkdtempSync('/tmp/ll-ci-data.customer-facts-'),port=4367,base=`http://127.0.0.1:${port}`,owner='customer-facts-test-only',fd=openSync(dir+'/server.log','w')
const server=spawn(process.execPath,['local-server.mjs'],{cwd:fileURLToPath(new URL('.',import.meta.url)),env:{...process.env,DATA_DIR:dir,PORT:String(port),HOST:'127.0.0.1',OWNER_TOKEN:owner,ALLOW_DEMO_ADMIN_LOGIN:'false',NOTIFY_TICK:'off',WECHAT_MINI_TOKEN_SECRET:'isolated-test',WECHAT_APP_SECRET:'isolated-test'},stdio:['ignore',fd,fd]})
let db,failed=false,checks=0;const tid='facts-http';const check=(name,fn)=>{fn();console.log(`ok ${++checks} - ${name}`)}
async function req(path,{body,method=body?'POST':'GET',token=owner,tenant=tid}={}){const r=await fetch(base+path,{method,headers:{'content-type':'application/json','x-admin-tenant-id':tenant,'x-tenant-id':tenant,...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json()}}
try {
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(ready,'isolated server starts')
 const health=await (await fetch(base+'/health')).json();assert.equal(health.dataFile,dir+'/lucky-luxe.sqlite','must own the exact temporary database before any write');assert.equal(health.dataScope,'test')
 db=new DatabaseSync(dir+'/lucky-luxe.sqlite')
 assert.equal((await req('/platform/tenants',{body:{id:tid,name:'事实核验',plan:'chain',currency:'CNY',timezone:'Asia/Shanghai'}})).status,201)
 await req('/platform/tenants/'+tid+'/business-hours',{method:'PUT',body:{hours:Array.from({length:7},(_,weekday)=>({weekday,openTime:'08:00',closeTime:'22:00',isClosed:false}))}})
 const tech=(await req('/platform/tenants/'+tid+'/technicians',{body:{name:'核验技师'}})).data.technician
 const svc=(await req('/platform/tenants/'+tid+'/services',{body:{type:'NAIL',nameZh:'核验服务',nameEn:'Check',priceCents:28800,baseDurationMin:60}})).data.service
 const login=await req('/auth/wechat/mini-login',{token:null,body:{tenantId:tid,code:'stub:facts-http-customer',phoneCode:'stub-phone:facts-http-customer:13811112222'}})
 assert.equal(login.status,200);const uid=login.data.user.id,token=login.data.auth.accessToken
 const legacy=await req('/platform/tenants/'+tid+'/import/customers',{body:{dryRun:false,rows:[{phone:'13811112222',totalSpendCents:5000}]}})
 assert.equal(legacy.status,200);assert.equal(legacy.data.users[0].userId,uid)
 const make=await req('/admin/settlements',{body:{userId:uid,settlements:[{payIntent:'offline_full',items:[{serviceId:svc.id,qty:1}],technicians:[{technicianId:tech.id,role:'main',itemNos:[1]}]}]}})
 assert.equal(make.status,201);const sheet=make.data.settlements[0]
 const signed=await req('/settlements/'+sheet.code+'/sign',{token,body:{signerConfirmed:true,disclaimerAccepted:true,signature:'核验本人',strokes:[[{x:1,y:1},{x:22,y:30},{x:10,y:40}]]}})
 assert.equal(signed.status,200)
 const knownAt=new Date(Date.now()-86400000).toISOString()
 db.prepare('UPDATE settlements SET created_at=? WHERE id=?').run(knownAt,sheet.id)
 db.prepare('UPDATE bookings SET appointment_start=? WHERE id=(SELECT booking_id FROM settlements WHERE id=?)').run(knownAt,sheet.id)
 const futureBooking=await req('/admin/bookings/direct',{body:{userId:uid,technicianId:tech.id,serviceId:svc.id,date:'2031-01-02',time:'10:00'}})
 assert.equal(futureBooking.status,201);const bid=futureBooking.data.booking.id
 const anonymousOrder=await req('/bookings/'+bid,{token:null})
 check('旧订单读取旁路匿名401',()=>assert.equal(anonymousOrder.status,401))
 const ownOrder=await req('/bookings/'+bid,{token})
 check('顾客本人旧订单读取完整且可用',()=>{assert.equal(ownOrder.status,200);assert.equal(ownOrder.data.booking.id,bid);assert.ok(ownOrder.data.booking.user)})
 const another=await req('/auth/wechat/mini-login',{token:null,body:{tenantId:tid,code:'stub:facts-http-other',phoneCode:'stub-phone:facts-http-other:13811113333'}})
 const foreignOrder=await req('/bookings/'+bid,{token:another.data.auth.accessToken})
 check('同店其他顾客旧订单读取403',()=>assert.equal(foreignOrder.status,403))
 const anonymousShare=await req('/share/bookings/'+bid,{token:null})
 check('私有作品读取匿名401',()=>assert.equal(anonymousShare.status,401))
 assert.equal((await req('/platform/tenants',{body:{id:'facts-other',name:'外店',plan:'chain',currency:'CNY',timezone:'Asia/Shanghai'}})).status,201)
 const outsideOrder=await req('/bookings/'+bid,{tenant:'facts-other'})
 check('外店老板不能通过旧订单路由取图',()=>assert.equal(outsideOrder.status,404))
 const customers=(await req('/admin/customers')).data.customers;const listed=customers.find(c=>c.id===uid)
 const me=(await req('/users/'+uid,{token}));assert.equal(me.status,200)
 check('商家列表与顾客档案同一消费事实（已签288+历史50）',()=>{assert.equal(listed.totalSpentCents,33800);assert.equal(me.data.user.totalSpentCents,33800)})
 check('未来预约不会覆盖已签服务的最近到店',()=>assert.ok(Math.abs(Date.parse(listed.lastVisitAt)-Date.parse(knownAt))<2))
 check('未来完成记录不计入已到店次数',()=>assert.equal(listed.visitCount,1))
 await req('/platform/tenants/'+tid+'/membership-config',{method:'PUT',body:{config:{memberQualify:'total_spend',qualifyValueCents:33800}}})
 // platform route contract is read from API output rather than assuming acceptance.
 const config=(await req('/admin/membership/config')).data.config
 assert.equal(config.memberQualify,'total_spend')
 const member=(await req('/admin/membership/members?userId='+uid)).data.members.find(x=>x.userId===uid)
 check('客户列表同时下发店内日历日期',()=>assert.equal(listed.lastVisitDate,new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date(knownAt))))
 check('会员门槛与可见累计消费一致',()=>assert.equal(member.isMember,true))
 // Import an old, unbound member through the actual merchant migration route.
 const unbound=await req('/platform/tenants/'+tid+'/import/customers',{body:{dryRun:false,rows:[{name:'未绑定老会员',phone:'13811114444',totalSpendCents:33800}]}})
 assert.equal(unbound.status,200);const unboundId=unbound.data.users[0].userId
 const lookup=(await req('/admin/customers/lookup?userId='+unboundId)).data.hit
 check('老会员未绑定只标微信状态，不会误称新客',()=>{assert.equal(lookup.bound,false);assert.equal(lookup.badgeText,'未绑定微信')})
 const draft=await req('/admin/settlements',{body:{userId:unboundId,settlements:[{payIntent:'offline_full',items:[{serviceId:svc.id,qty:1}],technicians:[{technicianId:tech.id,role:'main',itemNos:[1]}]}]}})
 check('两端共用结算字段同样不误称新客',()=>{assert.equal(draft.status,201);assert.equal(draft.data.settlements[0].bindBadgeText,'未绑定微信')})
 check('未签草稿不会增加已消费',()=>assert.equal((db.prepare("SELECT SUM(subtotal_cents) cents FROM settlements WHERE user_id=? AND status='signed'").get(uid)).cents,28800))
 console.log(`PASS ${checks} HTTP checks`)
} catch(e){failed=true;console.error(e.stack);console.error('Fixture retained:',dir)} finally {db?.close();server.kill('SIGTERM');await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));closeSync(fd);if(!failed)rmSync(dir,{recursive:true,force:true})}
process.exitCode=failed?1:0
