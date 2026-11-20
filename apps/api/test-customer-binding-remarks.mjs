import{mkdtempSync,openSync,closeSync,rmSync,writeFileSync}from'node:fs';import{spawn}from'node:child_process';import{fileURLToPath}from'node:url';import{DatabaseSync}from'node:sqlite';
const dir=mkdtempSync('/tmp/ll-ci-data.customer-links-'),port=4377,base=`http://127.0.0.1:${port}`,owner='isolated-customer-links-only',fd=openSync(dir+'/server.log','w'),checks=[];
const server=spawn(process.execPath,['--experimental-sqlite','local-server.mjs'],{cwd:fileURLToPath(new URL('.',import.meta.url)),env:{PATH:process.env.PATH,HOME:process.env.HOME,DATA_DIR:dir,PORT:String(port),HOST:'127.0.0.1',OWNER_TOKEN:owner,WECHAT_MINI_TOKEN_SECRET:'binding-isolated-test-only',WECHAT_APP_SECRET:'configured-test-only',ALLOW_DEMO_ADMIN_LOGIN:'false',NOTIFY_TICK:'off'},stdio:['ignore',fd,fd]});let db;
const check=(name,ok,detail)=>{checks.push({name,ok,detail});console.log((ok?'ok ':'FAIL ')+name+(ok?'':' '+JSON.stringify(detail)))};
async function req(path,{body,token=owner,tid='first-use-a',method=body?'POST':'GET'}={}){const r=await fetch(base+path,{method,headers:{'content-type':'application/json','x-admin-tenant-id':tid,'x-tenant-id':tid,...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json()}}
const publicPost=(path,body)=>req(path,{body,token:null});
try{
 for(let n=0;n<100;n++){try{if((await fetch(base+'/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 db=new DatabaseSync(dir+'/lucky-luxe.sqlite');
 for(const id of ['first-use-a','first-use-b'])check('建立隔离店 '+id,(await req('/platform/tenants',{body:{id,name:id,plan:'chain',currency:'CNY',timezone:'Asia/Shanghai'}})).status===201);
 const made=await req('/admin/customers',{body:{displayName:'未命名',requestId:'customer-link-test'}});if(made.status!==201)throw Error(JSON.stringify(made));const uid=made.data.customer.id;
 const other=await req('/admin/customers',{tid:'first-use-b',body:{displayName:'未命名',requestId:'other-link-test'}}),otherId=other.data.customer.id;
 const original=db.prepare('select * from users where id=?').get(uid);
 for(let i=0;i<5;i++){
  const name='美团顾客 '+i;
  check('保存备注 '+i,(await req('/admin/customers/'+uid+'/remark-name',{method:'PATCH',body:{remarkName:name}})).status===200);
  const list=(await req('/admin/customers')).data.customers.find(c=>c.id===uid),records=(await req('/admin/records/customers?summary=1')).data.records.find(c=>c.id===uid),review=(await req('/admin/records/customers/'+uid)).data,lookup=(await req('/admin/customers/lookup?userId='+uid)).data.hit;
  check('详情/目录/核对/选择顾客一致 '+i,[list.merchantDisplayName,records.name,review.name,lookup.merchantDisplayName].every(n=>n===name)&&records.displayName==='未命名');
 }
 check('原顾客字段未改写',JSON.stringify(original)===JSON.stringify(db.prepare('select * from users where id=?').get(uid)));
 const outside=(await req('/admin/records/customers?summary=1',{tid:'first-use-b'})).data.records;
 check('其他门店无备注泄漏',outside.find(x=>x.id===otherId).name==='未命名'&&!outside.some(x=>x.id===uid));
 const review=(await req('/admin/records/customers/'+uid)).data;
 check('归档成功',(await req('/admin/records/customers/'+uid,{body:{action:'archive',reason:'隔离测试',reviewHash:review.reviewHash}})).status===200);
 check('归档目录仍显示备注',(await req('/admin/records/customers?archived=1')).data.records.find(x=>x.id===uid).name==='美团顾客 4');
 check('归档档案不出绑定码',(await req('/admin/customers/'+uid+'/bind-token',{body:{}})).status===409);
 const archived=(await req('/admin/records/customers/'+uid)).data;await req('/admin/records/customers/'+uid,{body:{action:'restore',reason:'隔离测试恢复',reviewHash:archived.reviewHash}});
 await req('/admin/customers/'+uid+'/remark-name',{method:'PATCH',body:{remarkName:''}});
 check('清除备注恢复原昵称',(await req('/admin/records/customers?summary=1')).data.records.find(x=>x.id===uid).name==='未命名');
 await req('/admin/customers/'+uid+'/remark-name',{method:'PATCH',body:{remarkName:'仅商家可见'}});
 const ticket=(await req('/admin/customers/'+uid+'/bind-token',{body:{}})).data;
 check('跨店不能出码',(await req('/admin/customers/'+uid+'/bind-token',{tid:'first-use-b',body:{}})).status===404);
 const publicCard=(await req('/bind-tokens/'+ticket.token,{token:null})).data;
 check('顾客绑定确认不泄漏商家备注',publicCard.displayName==='未命名'&&!JSON.stringify(publicCard).includes('仅商家可见'));
 const bind=await publicPost('/bind-tokens/'+ticket.token+'/confirm',{code:'stub:remark-bind-person'});
 check('顾客本人确认绑定原档案',bind.data.bound&&bind.data.user.id===uid&&!JSON.stringify(bind.data.user).includes('仅商家可见'));
 check('商家读取最新已绑定状态',(await req('/admin/customers/lookup?userId='+uid)).data.hit.bound===true);
 check('已绑定不可重发',(await req('/admin/customers/'+uid+'/bind-token',{body:{}})).status===400);
 check('绑定不改历史余额',db.prepare('select count(*) n from stored_value_transactions where user_id=?').get(uid).n===0);
}catch(e){check('完整执行',false,e.stack)}finally{db?.close();server.kill('SIGTERM');await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));closeSync(fd);writeFileSync('/tmp/customer-links-result.json',JSON.stringify(checks,null,2));if(checks.every(c=>c.ok))rmSync(dir,{recursive:true,force:true});else console.log('现场保留 '+dir)}process.exitCode=checks.some(c=>!c.ok)?1:0;
