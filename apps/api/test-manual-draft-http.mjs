import {mkdtempSync,rmSync,openSync,closeSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawn} from 'node:child_process'
import {DatabaseSync} from 'node:sqlite'
import {loginStaffViaFrontDoor,loginCustomerViaFrontDoor} from './customer-login-fixture.mjs'
const dir=mkdtempSync(join(tmpdir(),'ll-ci-data.manual-draft-')),base='http://127.0.0.1:4338',owner='manual-test-owner',log=openSync(join(dir,'server.log'),'w')
const demoMode=process.env.DEMO_GATE_MODE||'true'
const child=spawn(process.execPath,['local-server.mjs'],{cwd:new URL('.',import.meta.url).pathname,env:{...process.env,DATA_DIR:dir,PORT:'4338',HOST:'127.0.0.1',OWNER_TOKEN:owner,WECHAT_MINI_TOKEN_SECRET:'manual-test-secret',NOTIFY_TICK:'off',ALLOW_DEMO_ADMIN_LOGIN:demoMode},stdio:['ignore',log,log]})
let db,n=0
function check(label,ok){console.log(`${ok?'ok':'not ok'} ${++n} - ${label}`);if(!ok)throw Error(label)}
async function req(path,{token=owner,tid='manual-free',body,method=body?'POST':'GET'}={}){const r=await fetch(base+path,{method,headers:{'content-type':'application/json','x-tenant-id':tid,'x-admin-tenant-id':tid,...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}}
try{
 let up=false;for(let i=0;i<100;i++){try{up=(await fetch(base+'/health')).ok}catch{}if(up)break;await new Promise(r=>setTimeout(r,100))}check('isolated server healthy',up)
 check('isolated server matches declared demo login mode',(await (await fetch(base+'/health')).json()).guestIdUnsigned===(demoMode==='true'))
 check('free personal test shop created',(await req('/platform/tenants',{body:{id:'manual-free',name:'人工预约隔离测试',plan:'free',timezone:'Asia/Shanghai',currency:'CNY'}})).status===201)
 const store=(await req('/admin/business-hours')).data.stores[0]
 check('hours configured',(await req('/admin/business-hours',{method:'PUT',body:{storeId:store.id,hours:Array.from({length:7},(_,weekday)=>({weekday,isClosed:false,openTime:'08:00',closeTime:'22:00'}))}})).status===200)
 const service=(await req('/platform/tenants/manual-free/services',{body:{type:'NAIL',nameZh:'预约测试',nameEn:'Appointment test',priceCents:18000,baseDurationMin:60}})).data.service
 const tech=(await req('/platform/tenants/manual-free/technicians',{body:{name:'测试技师'}})).data.technician
 check('service and technician exist',!!service?.id&&!!tech?.id)
 const staff=await loginStaffViaFrontDoor({base,tenantId:'manual-free',ownerToken:owner,technicianId:tech.id});check('staff real front-door login',staff.ok)
 const opts=await req('/admin/booking-draft-options',{token:staff.accessToken});check('staff sees only own technician',opts.status===200&&opts.data.technicians.length===1&&opts.data.technicians[0].id===tech.id)
 db=new DatabaseSync(join(dir,'lucky-luxe.sqlite'),{readOnly:true});const count=()=>db.prepare('SELECT count(*) n FROM bookings WHERE tenant_id=?').get('manual-free').n
 const body={sourceChannel:'admin_manual',storeId:store.id,serviceId:service.id,technicianId:tech.id,date:'2030-10-07',time:'10:00',notes:'顾客确认后预约'}
 const draft=await req('/admin/booking-drafts',{token:staff.accessToken,body});check('staff creates draft without AI',draft.status===201)
 const d=draft.data.bookingDraft;check('draft written into correct tenant',db.prepare('SELECT tenant_id FROM booking_drafts WHERE id=?').get(d.id).tenant_id==='manual-free');check('no booking before confirmation',count()===0)
 const pub=await req('/booking-drafts/'+d.id,{token:null});check('public draft contains no customer identifiers',pub.status===200&&!('userId' in pub.data.bookingDraft)&&!('conversationId' in pub.data.bookingDraft))
 check('draft link preserves tenant',new URL(d.linkUrl).searchParams.get('store')==='manual-free')
 const scan=await req('/scan/'+d.scene,{token:null,tid:'lucky-luxe'});check('mini code resolves right draft and tenant',scan.status===200&&scan.data.draftId===d.id&&scan.data.tenantId==='manual-free')
 check('cross-shop read refused',(await req('/booking-drafts/'+d.id,{token:null,tid:'lucky-luxe'})).status===404)
 check('anonymous confirmation refused',(await req('/bookings',{token:null,body:{...body,bookingDraftId:d.id}})).status===401)
 const c=await loginCustomerViaFrontDoor({base,tenantId:'manual-free',openid:'manual-customer-one'});check('new customer real signed session issued',c.ok)
 const confirm={...body,bookingDraftId:d.id,addOns:[]}
 check('changed time refused',(await req('/bookings',{token:c.accessToken,body:{...confirm,time:'11:00'}})).status===409)
 const one=await req('/bookings',{token:c.accessToken,body:confirm});check('customer confirmation creates confirmed booking',one.status===201&&one.data.booking.status==='CONFIRMED')
 const repeat=await req('/bookings',{token:c.accessToken,body:confirm});check('repeat returns same booking without duplicate',repeat.status===201&&repeat.data.booking.id===one.data.booking.id&&count()===1)
 const c2=await loginCustomerViaFrontDoor({base,tenantId:'manual-free',openid:'manual-customer-two'});check('other customer cannot reuse confirmed draft',(await req('/bookings',{token:c2.accessToken,body:confirm})).status===409)
 const b=db.prepare('SELECT * FROM bookings WHERE id=?').get(one.data.booking.id);check('offline payment remains uncollected',b.deposit_cents===0&&db.prepare('SELECT count(*) n FROM deposit_receipts WHERE booking_id=?').get(b.id).n===0)
 const ownerList=await req('/admin/bookings'),staffList=await req('/admin/bookings',{token:staff.accessToken});check('owner and staff see confirmed booking',ownerList.data.bookings.some(x=>x.id===b.id)&&staffList.data.bookings.some(x=>x.id===b.id))
 const clash=await req('/admin/booking-drafts',{body});check('taken slot cannot create a fresh draft',clash.status===409)
 const waiting=await req('/admin/booking-drafts',{body:{...body,time:'14:00'}});check('owner creates independent draft',waiting.status===201)
 const blocked=await req('/bookings',{token:c.accessToken,body:{...body,time:'14:00',addOns:[]}});check('competing booking takes slot',blocked.status===201)
 check('confirm rechecks lost slot',(await req('/bookings',{token:c.accessToken,body:{...body,time:'14:00',bookingDraftId:waiting.data.bookingDraft.id,addOns:[]}})).status===409)
 console.log('PASS manual appointment real HTTP: free/no-AI, staff/owner, new customer, web payload, mini scene, tenant isolation, race, idempotency, offline records')
}finally{db?.close();child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));closeSync(log);rmSync(dir,{recursive:true,force:true})}
