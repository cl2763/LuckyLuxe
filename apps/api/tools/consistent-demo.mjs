#!/usr/bin/env node
/* Creates a NEW isolated demo, using real local API settlement/recharge/sign/close
 * paths. No production credentials, no replacement of an existing DB, no updates
 * to previously signed documents. Re-running a completed build only audits it.
 * Usage: node apps/api/tools/consistent-demo.mjs --dir=/absolute/new/directory
 */
import {existsSync,mkdirSync,writeFileSync,readFileSync,openSync,closeSync,realpathSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {requireSandbox} from '../../../tools/db-target.mjs';
import {seedDemoWorks} from './consistent-demo-works.mjs';
import {lockDemoPort,assertDemoPortUnused,assertDemoServerTarget,waitForDemoServer} from './demo-server-guard.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const arg=(n)=>process.argv.find(a=>a.startsWith('--'+n+'='))?.slice(n.length+3);
const target=arg('dir');if(!target||!target.startsWith('/'))throw new Error('--dir must be an explicit absolute NEW directory');
const dir=resolve(target), dataDir=resolve(dir,'sandbox-data'), markerPath=resolve(dir,'consistent-demo.json'),dbPath=resolve(dataDir,'lucky-luxe.sqlite');
requireSandbox(dbPath, 'consistent-demo');
const batch='consistent-demo-v1',tid='demo-ai',port=Number(arg('port')||4368),base=`http://127.0.0.1:${port}`,owner='consistent-demo-local-only';
if(!Number.isInteger(port)||port<1024||[4128,4310,4360].includes(port))throw new Error('Dedicated port required; existing user servers forbidden');
function audit(){const d=new DatabaseSync(dbPath,{readOnly:true});const q=(sql)=>d.prepare(sql).all(tid);const scalar=(sql)=>d.prepare(sql).get(tid).n;
 const signed=scalar("SELECT count(*) n FROM settlements WHERE tenant_id=? AND status='signed'");
 const report={database:dbPath,tenant:tid,signed,completedBookings:scalar("SELECT count(*) n FROM bookings WHERE tenant_id=? AND status='COMPLETED'"),missingSigned:scalar("SELECT count(*) n FROM bookings b WHERE b.tenant_id=? AND b.status='COMPLETED' AND NOT EXISTS(SELECT 1 FROM settlements s WHERE s.booking_id=b.id AND s.status='signed')"),unsignedMock:scalar("SELECT count(*) n FROM settlements WHERE tenant_id=? AND (demo_seed IS NULL OR signature_data NOT LIKE '%演示模拟签署%' OR snapshot_inline IS NULL)"),positiveExpenses:scalar("SELECT count(*) n FROM finance_transactions WHERE tenant_id=? AND type='expense' AND amount_cents>=0"),duplicateRechargeIncome:scalar("SELECT count(*) n FROM finance_transactions WHERE tenant_id=? AND (source='stored_value' OR category='储值充值')"),signedServiceCents:scalar("SELECT coalesce(sum(subtotal_cents),0) n FROM settlements WHERE tenant_id=? AND status='signed'"),serviceLedgerCents:scalar("SELECT coalesce(sum(amount_cents),0) n FROM finance_transactions WHERE tenant_id=? AND source='settlement' AND type='income'"),cashIn:scalar("SELECT coalesce(sum(amount_cents),0) n FROM stored_value_transactions WHERE tenant_id=? AND type='recharge'"),cardConsume:scalar("SELECT coalesce(-sum(amount_cents),0) n FROM stored_value_transactions WHERE tenant_id=? AND type='consume'"),cardBalance:scalar("SELECT coalesce(sum(amount_cents),0) n FROM stored_value_transactions WHERE tenant_id=?"),customers:q("SELECT u.id,u.display_name name,(SELECT count(*) FROM settlements s WHERE s.user_id=u.id AND s.status='signed') signedSettlementCount,(SELECT coalesce(sum(s.subtotal_cents),0) FROM settlements s WHERE s.user_id=u.id AND s.status='signed') spendCents,(SELECT coalesce(sum(amount_cents),0) FROM stored_value_transactions v WHERE v.user_id=u.id) balanceCents FROM users u WHERE u.tenant_id=?"),months:q("SELECT substr(occurred_on,1,7) month,sum(case when type='income' then amount_cents else 0 end) incomeCents,sum(case when type='expense' then -amount_cents else 0 end) expenseCents,sum(amount_cents) profitCents FROM finance_transactions WHERE tenant_id=? GROUP BY 1 ORDER BY 1")};
 const timezone=d.prepare('SELECT timezone FROM stores WHERE tenant_id=? ORDER BY rowid LIMIT 1').get(tid)?.timezone;
 if(!timezone)throw new Error('Missing store timezone');
 const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'});
 for(const customer of report.customers){
  const rows=d.prepare(`SELECT appointment_start AS at FROM bookings WHERE user_id=? AND tenant_id=? AND status='COMPLETED'
   UNION ALL SELECT COALESCE(b.appointment_start,s.created_at) AS at FROM settlements s LEFT JOIN bookings b ON b.id=s.booking_id AND b.tenant_id=s.tenant_id
   WHERE s.user_id=? AND s.tenant_id=? AND s.status IN ('signed','amended')`).all(customer.id,tid,customer.id,tid);
  customer.visitDaysCount=new Set(rows.filter(r=>r.at).map(r=>dayFormat.format(new Date(r.at)))).size;
 }
 report.timezone=timezone;
 d.close(); if(report.missingSigned||report.unsignedMock||report.positiveExpenses||report.duplicateRechargeIncome||report.cashIn-report.cardConsume!==report.cardBalance||report.signed!==report.completedBookings||report.signedServiceCents!==report.serviceLedgerCents||report.customers.some(c=>c.balanceCents<0))throw new Error('Reconciliation failed: '+JSON.stringify(report));return report;}
if(existsSync(dbPath)){const m=existsSync(markerPath)&&JSON.parse(readFileSync(markerPath));if(!m||m.generator!=='youji-consistent-demo-v1'||m.state!=='ready')throw new Error('Existing/uncompleted DB is preserved. Use a different NEW directory.');console.log(JSON.stringify(audit(),null,2));process.exit(0);}
if(existsSync(dir)) {const {readdirSync}=await import('node:fs');if(readdirSync(dir).length)throw new Error('Target directory must be empty; will not alter any existing data.');}
const releasePort=lockDemoPort(port);process.once('exit',releasePort);
await assertDemoPortUnused(port);
mkdirSync(dataDir,{recursive:true});if(realpathSync(dataDir)!==dataDir)throw new Error('Symlink target forbidden');

const realNow=new Date(),anchor=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(realNow);
const marker={generator:'youji-consistent-demo-v1',state:'building',dataDir,builtAt:realNow.toISOString(),anchor,batch,port};
writeFileSync(markerPath,JSON.stringify(marker,null,2));
function clock(date,time='12:00'){writeFileSync(resolve(dir,'clock.json'),JSON.stringify({now:`${date}T${time}:00+08:00`}));}
clock(anchor);
const fd=openSync(resolve(dir,'build-server.log'),'w');
const env={PATH:process.env.PATH,HOME:process.env.HOME,DATA_DIR:dataDir,HOST:'127.0.0.1',PORT:String(port),OWNER_TOKEN:owner,ALLOW_DEMO_ADMIN_LOGIN:'true',NOTIFY_TICK:'off',MERGE_WINDOW_MS:'0'};
let server=spawn(process.execPath,['--import',resolve(root,'apps/api/tools/demo-clock.mjs'),resolve(root,'apps/api/local-server.mjs')],{cwd:root,env,stdio:['ignore',fd,fd]});
const request=async(path,{body,token=owner,method=body?'POST':'GET'}={})=>{await assertDemoServerTarget({server,base,dbPath});const res=await fetch(base+path,{method,headers:{'content-type':'application/json','x-admin-tenant-id':tid,'x-tenant-id':tid,'x-demo-seed':batch,...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});const data=await res.json();if(!res.ok)throw new Error(`${path} ${res.status} ${JSON.stringify(data)}`);return data;};
async function createWithCodeRetry(path,options){for(let i=0;i<10;i++){try{return await request(path,options)}catch(e){if(!e.message.includes('UNIQUE constraint failed: bookings.public_code')||i===9)throw e;await new Promise(r=>setTimeout(r,25));}}}
try{
 await waitForDemoServer({server,base,dbPath});
 const seeded=spawnSync(process.execPath,[resolve(root,'apps/api/tools/demo-seed.mjs'),'--reset','--catalog-only','--tenant=demo-ai','--db='+dbPath],{cwd:root,encoding:'utf8'});writeFileSync(resolve(dir,'catalog-build.log'),seeded.stdout+seeded.stderr);if(seeded.status)throw new Error('Catalog seed failed');
 // Only a new catalog was inserted. No legacy ledger is generated or deleted.
 const db=new DatabaseSync(dbPath);db.exec('BEGIN IMMEDIATE');
 db.prepare("UPDATE stores SET name='星野美甲 · 账证一致演示店',timezone='Asia/Shanghai',currency='CNY' WHERE tenant_id=?").run(tid);
 db.prepare("UPDATE tenants SET name='星野美甲（模拟演示）',kind='demo' WHERE id=?").run(tid);
 db.prepare("UPDATE users SET display_name=replace(replace(display_name,'книга','思彤'),'корица','欣妍')||'（演示）',tags_json='[]',notes='本地模拟数据，非真实顾客与交易' WHERE tenant_id=?").run(tid);
 db.prepare("UPDATE coupons SET issued_qty=0 WHERE tenant_id=?").run(tid);
 db.prepare("UPDATE points_prizes SET redeemed_qty=0 WHERE tenant_id=?").run(tid);
 db.prepare("UPDATE membership_packages SET kind='recharge' WHERE tenant_id=? AND kind='stored_value'").run(tid);
 db.prepare("UPDATE business_hours SET is_closed=0 WHERE store_id=?").run(tid+'-store');
 db.prepare("DELETE FROM technician_schedules WHERE technician_id LIKE ?").run(tid+'-%');
 const customers=db.prepare('SELECT id FROM users WHERE tenant_id=? ORDER BY rowid').all(tid),services=db.prepare('SELECT id FROM services WHERE tenant_id=? ORDER BY rowid').all(tid),techs=db.prepare('SELECT id FROM technicians WHERE tenant_id=? ORDER BY rowid').all(tid);
 db.exec('COMMIT');db.close();
 const dates=[];for(let month=6;month>=0;month--){for(const day of [4,11,18,25]){const dt=new Date(anchor+'T00:00:00Z');dt.setUTCDate(1);dt.setUTCMonth(dt.getUTCMonth()-month);dt.setUTCDate(day);const ds=dt.toISOString().slice(0,10);if(ds<anchor)dates.push(ds);}}
 let count=0;const charged=new Set();
 for(const date of dates){
  for(let j=0;j<4;j++){
   clock(date,['10:00','12:00','14:00','16:00'][j]);const idx=(count%3===0?6:count%customers.length),userId=customers[idx].id,techId=techs[j].id;
   const logged=await request('/auth/wechat/mini-login',{token:null,body:{tenantId:tid,demoLogin:true,asUserId:userId}});
   if(idx>=6&&idx<10&&!charged.has(userId)){await request('/member-code/'+logged.user.memberCode+'/claim',{token:logged.auth.accessToken,body:{}});await request('/admin/stored-value/recharge',{body:{userId,amountCents:1500000,payChannel:'cash',technicianId:techId,note:'演示模拟充值，非真实收款'}});charged.add(userId);}
   const opened=await createWithCodeRetry('/admin/settlements',{body:{userId,settlements:[{priceTier:'list',payIntent:charged.has(userId)?'balance_plus_offline':'offline_full',items:[{serviceId:services[count%services.length].id,qty:1}],technicians:[{technicianId:techId,role:'main',itemNos:[1]}]}]}});
   const sheet=opened.settlements[0];await request('/settlements/'+sheet.code+'/sign',{token:logged.auth.accessToken,body:{signerConfirmed:true,disclaimerAccepted:true,signature:'演示模拟签署（非真人授权）',signedBy:'演示模拟顾客',strokes:[[{x:10,y:10},{x:12,y:28},{x:26,y:28},{x:28,y:10},{x:10,y:10}]]}});count++;
  }
  clock(date,'20:00');await request('/admin/daily-close',{body:{date}});
  if(date.endsWith('-04')){await request('/admin/finance/transactions',{body:{type:'expense',category:'房租',amountCents:160000,payChannel:'transfer',occurredOn:date,note:'演示模拟房租'}});await request('/admin/finance/transactions',{body:{type:'expense',category:'材料',amountCents:25000,payChannel:'cash',occurredOn:date,note:'演示模拟材料采购'}});}
  console.log('Generated',date,count,'signed mock settlements');
 }
 clock(anchor,'09:00');
 for(let day=0;day<7;day++){const dt=new Date(anchor+'T00:00:00Z');dt.setUTCDate(dt.getUTCDate()+day);const date=dt.toISOString().slice(0,10);for(let j=0;j<3;j++)await request('/admin/bookings/direct',{body:{userId:customers[(day+j)%customers.length].id,technicianId:techs[j].id,serviceId:services[j].id,date,time:['11:00','14:00','16:00'][j],depositPaid:false}});}
 await seedDemoWorks({dir,owner});
 const report=audit();writeFileSync(resolve(dir,'reconciliation.json'),JSON.stringify(report,null,2));writeFileSync(markerPath,JSON.stringify({...marker,state:'ready',signed:count},null,2));
 const command=`cd '${root}'\nenv DATA_DIR='${dataDir}' HOST=127.0.0.1 PORT=${port} OWNER_TOKEN=${owner} ALLOW_DEMO_ADMIN_LOGIN=true NOTIFY_TICK=off node apps/api/local-server.mjs\n`;
 writeFileSync(resolve(dir,'启动演示.command'),'#!/bin/zsh\n'+command,{mode:0o755});
 writeFileSync(resolve(dir,'README.md'),`# 本机账证一致演示\n\n这是模拟演示；签字为程序模拟，不是真实顾客签名。历史账证均由业务 API 同时生成，非事后拼接。\n\n启动：双击 启动演示.command。\n老板网页：http://127.0.0.1:${port}/admin\n顾客网页：http://127.0.0.1:${port}/?store=demo-ai\n老板：demo-ai-boss / demo1234\n员工：demo-ai-staff1 或 demo-ai-staff2 / demo1234\n财务密码：886688\n小程序 API 根地址：http://127.0.0.1:${port}；演示租户 demo-ai。\n\n生成基准日：${anchor}（北京时间）；历史 ${count} 张已签模拟单，未来 7 天预约；不自动平移历史。\n\n同命令重跑只对账，不重新充值、创建单据或改密码。不用于真实商家。\n`);
 console.log(JSON.stringify(report,null,2));
}finally{if(server.exitCode===null&&server.signalCode===null){server.kill('SIGTERM');await new Promise(r=>(server.exitCode!==null||server.signalCode!==null)?r():server.once('exit',r));}closeSync(fd);releasePort();}
