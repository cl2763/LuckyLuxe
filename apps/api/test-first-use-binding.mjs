import{mkdtempSync,openSync,closeSync,rmSync,writeFileSync}from'node:fs';import{spawn}from'node:child_process';import{fileURLToPath}from'node:url';import{DatabaseSync}from'node:sqlite';
const dir=mkdtempSync('/tmp/ll-ci-data.first-use-'),port=4362,base=`http://127.0.0.1:${port}`,owner='isolated-first-use-only',fd=openSync(dir+'/server.log','w'),checks=[];
const server=spawn(process.execPath,['--experimental-sqlite','local-server.mjs'],{cwd:fileURLToPath(new URL('.',import.meta.url)),env:{PATH:process.env.PATH,HOME:process.env.HOME,DATA_DIR:dir,PORT:String(port),HOST:'127.0.0.1',OWNER_TOKEN:owner,WECHAT_MINI_TOKEN_SECRET:'binding-isolated-test-only',WECHAT_APP_SECRET:'configured-test-only',ALLOW_DEMO_ADMIN_LOGIN:'false',NOTIFY_TICK:'off'},stdio:['ignore',fd,fd]});let db;
const check=(name,ok,detail)=>{checks.push({name,ok,detail});console.log((ok?'ok ':'FAIL ')+name+(ok?'':' '+JSON.stringify(detail)))};
async function req(path,{body,token=owner,tid='first-use-a',method=body?'POST':'GET'}={}){const r=await fetch(base+path,{method,headers:{'content-type':'application/json','x-admin-tenant-id':tid,'x-tenant-id':tid,...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json()}}
const publicPost=(path,body)=>req(path,{body,token:null});
try{
 for(let n=0;n<100;n++){try{if((await fetch(base+'/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 db=new DatabaseSync(dir+'/lucky-luxe.sqlite');
 for(const id of ['first-use-a','first-use-b'])check('建立独立店 '+id,(await req('/platform/tenants',{body:{id,name:id,plan:'chain',currency:'CNY',timezone:'Asia/Shanghai'}})).status===201);
 await req('/platform/tenants/first-use-a/business-hours',{method:'PUT',body:{hours:Array.from({length:7},(_,weekday)=>({weekday,openTime:'08:00',closeTime:'22:00',isClosed:false}))}});
 const tech=(await req('/platform/tenants/first-use-a/technicians',{body:{name:'测试甲'}})).data.technician;
 const other=(await req('/platform/tenants/first-use-a/technicians',{body:{name:'测试乙'}})).data.technician;
 const svc=(await req('/platform/tenants/first-use-a/services',{body:{type:'NAIL',nameZh:'测试服务',nameEn:'Test',priceCents:19800,baseDurationMin:60}})).data.service;
 let n=0;async function profile(name='同名顾客',phone){const r=await req('/admin/bookings/direct',{body:{newCustomerName:name,phone,serviceId:svc.id,technicianId:tech.id,date:`2030-10-${String(7+n++).padStart(2,'0')}`,time:'10:00'}});if(r.status!==201)throw Error(JSON.stringify(r));return r.data.booking.user.id}
 const mint=async id=>(await req(`/admin/customers/${id}/bind-token`,{body:{}})).data;
 const confirm=(token,openid)=>publicPost(`/bind-tokens/${token}/confirm`,{code:'stub:'+openid});
 const id=await profile(),ticket=await mint(id);check('绑定码含256位随机量',/^bind_[a-f0-9]{64}$/.test(ticket.token));
 check('伪造openid无授权被拒',(await publicPost(`/bind-tokens/${ticket.token}/confirm`,{openid:'forged'})).status===401);
 check('坏微信code被拒',(await publicPost(`/bind-tokens/${ticket.token}/confirm`,{code:'stub-bad'})).status===401);
 const before=db.prepare('select count(*) n from users').get().n;
 const bound=await confirm(ticket.token,'first-person');check('首次无号直接绑定到原档案并发目标会话',bound.status===200&&bound.data.bound&&bound.data.user.id===id&&!!bound.data.auth.accessToken,bound);
 check('绑定会话实际可读取本人受保护档案',(await req('/users/'+id,{token:bound.data.auth.accessToken})).status===200);
 check('绑定不多造顾客',db.prepare('select count(*) n from users').get().n===before);
 check('同本人重复确认幂等',(await confirm(ticket.token,'first-person')).data.alreadyBound===true);
 check('同票据不同微信不可接管',(await confirm(ticket.token,'attacker')).status===409);
 const identity=db.prepare('select wechat_open_id from users where id=?').get(id);check('原微信归属保持',identity.wechat_open_id==='first-person');
 const second=await profile('同名顾客'),t2=await mint(second);const empty=(await publicPost('/auth/wechat/mini-login',{tenantId:'first-use-a',code:'stub:empty-registration'})).data;
 const resumed=await confirm(t2.token,'empty-registration');check('先登录空档再扫码回到指定旧档',resumed.status===200&&resumed.data.user?.id===second,resumed);check('空注册行不残留',!db.prepare('select id from users where id=?').get(empty.user.id));
 check('原空档会话失效',(await req('/users/'+empty.user.id,{token:empty.auth.accessToken})).status===401);
 check('换发会话读取目标档案且不能读取同名他人',(await req('/users/'+second,{token:resumed.data.auth.accessToken})).status===200&&(await req('/users/'+id,{token:resumed.data.auth.accessToken})).status===403);
 const rich=(await publicPost('/auth/wechat/mini-login',{tenantId:'first-use-a',code:'stub:has-booking'})).data;
 await req('/admin/bookings/direct',{body:{userId:rich.user.id,serviceId:svc.id,technicianId:other.id,date:'2030-11-01',time:'10:00'}});
 const third=await profile(),t3=await mint(third),conflict=await confirm(t3.token,'has-booking');check('有业务账户不自动合并',conflict.data.conflict===true&&!!db.prepare('select id from users where id=?').get(rich.user.id));
 check('冲突不消耗票据',db.prepare('select status from archive_bind_tokens where token=?').get(t3.token).status==='active');
 const fresh=await mint(third);check('重发使旧票据失效',(await confirm(t3.token,'person-new')).status===404);
 db.prepare("update archive_bind_tokens set expires_at='2000-01-01T00:00:00.000Z' where token=?").run(fresh.token);check('过期不可绑定',(await confirm(fresh.token,'person-new')).status===410);
 const broken=await profile(),bt=await mint(broken);db.prepare("insert into points_transactions(id,user_id,tenant_id,type,amount,created_at) values('invalid-points',?,'first-use-a','adjust',360,'2026-09-24')").run(broken);
 const login=(await publicPost('/auth/wechat/mini-login',{tenantId:'first-use-a',code:'stub:rollback-person'})).data;
 const failed=await confirm(bt.token,'rollback-person');check('末步积分报错整体回滚',failed.status===500&&!db.prepare('select wechat_open_id from users where id=?').get(broken).wechat_open_id&&!!db.prepare('select id from users where id=?').get(login.user.id)&&db.prepare('select status from archive_bind_tokens where token=?').get(bt.token).status==='active',failed.status);
 for(const v of ['99:99','24:00','14:60','9:00'])check('分界拒绝 '+v,(await req('/admin/schedule-settings',{method:'PUT',body:{afternoonStart:v}})).status===400);
 check('分界正常读写',(await req('/admin/schedule-settings',{method:'PUT',body:{afternoonStart:'14:30'}})).status===200&&(await req('/admin/schedule-settings')).data.afternoonStart==='14:30');
 const usersBefore=db.prepare('select count(*) n from users').get().n;const invalid=await req('/admin/bookings/direct',{body:{newCustomerName:'不应留下孤儿',backfill:true,date:'2099-01-01',time:'10:00',serviceId:svc.id,technicianId:tech.id}});check('失败补录不留下空档',invalid.status===400&&db.prepare('select count(*) n from users').get().n===usersBefore);

 const phoneTarget=await profile('先登录后授权老客','13800005501');
 const phoneSession=(await publicPost('/auth/wechat/mini-login',{tenantId:'first-use-a',code:'stub:phone-person'})).data;
 const ph=await req('/auth/wechat/mini-phone',{token:phoneSession.auth.accessToken,body:{phoneCode:'stub-phone:phone-person:13800005501'}});
 check('先登录后授权手机号认回唯一旧档并换会话',ph.status===200&&ph.data.user?.id===phoneTarget&&!!ph.data.auth?.accessToken,ph);
 const noPhoneTarget=await profile('无号旧档'),nt=await mint(noPhoneTarget);
 const hasPhone=(await publicPost('/auth/wechat/mini-login',{tenantId:'first-use-a',code:'stub:has-phone',phoneCode:'stub-phone:has-phone:13800005502',avatarUrl:'https://example.invalid/avatar.jpg'})).data;
 const np=await confirm(nt.token,'has-phone');check('有号空注册接无号旧档，仅补缺号并保留头像',np.status===200&&np.data.user?.id===noPhoneTarget&&db.prepare('select phone,avatar_url from users where id=?').get(noPhoneTarget).phone==='13800005502'&&db.prepare('select avatar_url from users where id=?').get(noPhoneTarget).avatar_url==='https://example.invalid/avatar.jpg',np.status);
 const blank=await profile('空字符串旧档'),blankTicket=await mint(blank);db.prepare("update users set wechat_open_id='' where id=?").run(blank);
 const blankOut=await confirm(blankTicket.token,'blank-openid');check('空字符串openid正确写入',blankOut.status===200&&db.prepare('select wechat_open_id from users where id=?').get(blank).wechat_open_id==='blank-openid');
 await profile('同号甲','13800005503');await profile('同号乙','13800005503');
 const amb=(await publicPost('/auth/wechat/mini-login',{tenantId:'first-use-a',code:'stub:amb-person'})).data;
 const ambiguous=await req('/auth/wechat/mini-phone',{token:amb.auth.accessToken,body:{phoneCode:'stub-phone:amb-person:13800005503'}});check('同号多档拒绝自动认领',ambiguous.status===409&&ambiguous.data.error?.code==='PROFILE_AMBIGUOUS');
 const account=(await req('/admin/staff-accounts',{body:{technicianId:tech.id}})).data;const staff=(await publicPost('/admin/auth/login',{email:account.username,password:account.initialPassword})).data;
 check('员工伪造同事排班申请被拒',(await req('/admin/schedule-requests',{token:staff.auth.accessToken,body:{date:'2030-10-05',technicianId:other.id,note:'越权'}})).status===403);
}catch(e){check('完整执行',false,e.stack)}finally{db?.close();server.kill('SIGTERM');await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));closeSync(fd);writeFileSync('/tmp/first-use-binding-result.json',JSON.stringify(checks,null,2));if(checks.every(c=>c.ok))rmSync(dir,{recursive:true,force:true});else console.log('现场保留 '+dir)}process.exitCode=checks.some(c=>!c.ok)?1:0;
