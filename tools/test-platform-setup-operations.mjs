import {readFileSync,writeFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import {assertTestTarget} from '../apps/api/test-guard.mjs'
const root=process.env.SETUP_TEST_DATA_DIR||'/Users/changliu/Desktop/有迹管家/Codex/隔离测试/平台代配置_20261116/ll-ci-data.platform-setup',base=process.env.SETUP_TEST_BASE||'http://127.0.0.1:4396',token=process.env.SETUP_TEST_TOKEN||readFileSync(root+'/.owner-token','utf8').trim(),stamp=Date.now(),tid='setup-ops-'+stamp,prefix=`/platform/tenants/${tid}/setup`,checks=[]
await assertTestTarget(base)
const db=new DatabaseSync(root+'/lucky-luxe.sqlite',{readOnly:true})
async function api(path,method='GET',body,headers={}){const r=await fetch(base+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()}}
const check=(name,pass)=>{assert.ok(pass,name);checks.push(name)}
const capture=()=>Object.fromEntries(['users','bookings','settlements','stored_value_transactions','finance_transactions','member_timecards','coupon_grants','notification_logs','reminder_tasks','attendance_records'].map(t=>[t,createHash('sha256').update(JSON.stringify(db.prepare('SELECT * FROM "'+t+'"').all())).digest('hex')]))
async function draft(module,body,targetId=null){const s=await api(prefix+'/modules/'+module);assert.equal(s.status,200,module+': '+JSON.stringify(s.data.error));const r=await api(prefix+'/drafts','POST',{module,body,targetId,fingerprint:s.data.fingerprint});assert.equal(r.status,201,module+': '+JSON.stringify(r.data.error));check(module+'草稿不改正式值',(await api(prefix+'/modules/'+module)).data.fingerprint===s.data.fingerprint);return r.data.draft}
async function apply(d){const r=await api(prefix+'/drafts/'+d.id+'/apply','POST',{revision:d.revision,confirm:true});assert.equal(r.status,200,d.module+': '+JSON.stringify(r.data.error));return r.data}
async function preview(d,path){const g=await api(`/platform/tenants/${tid}/setup-preview`,'POST',{}, {'x-setup-draft-id':d.id});assert.equal(g.status,201);const r=await api(path,'GET',undefined,{authorization:'Bearer '+g.data.token});assert.equal(r.status,200,d.module+': '+JSON.stringify(r.data.error));return r.data}
try{
 const created=await api('/platform/tenants','POST',{id:tid,name:'平台配置测试店',plan:'chain'});assert.equal(created.status,201)
 const credentials=created.data.owner,login=await api('/admin/auth/login','POST',{email:credentials.username,password:credentials.initialPassword});assert.equal(login.status,200)
 const pw='Isolated-'+stamp+'A9',auth=login.data.auth.accessToken
 const changed=await api('/admin/auth/change-password','POST',{oldPassword:credentials.initialPassword,newPassword:pw,confirmPassword:pw},{authorization:'Bearer '+auth});assert.equal(changed.status,200)
 const signed=await api('/admin/auth/login','POST',{email:credentials.username,password:pw}),owner=signed.data.auth.accessToken
 const adminHeaders={authorization:'Bearer '+owner},before=capture()
 let d=await draft('staff',{name:'配置测试技师',title:'护理师',isActive:true,serviceIds:[]});const newTech=d.proposed.technicians.find(t=>t.name==='配置测试技师');assert.ok(newTech);let result=await apply(d);const techId=result.draft.result.technician.id
 check('技师分工空选明确不自动分配全部服务',db.prepare('SELECT COUNT(*) n FROM technician_services WHERE technician_id=?').get(techId).n===0)
 d=await draft('accounts',{technicianId:techId,username:'s'+stamp});const draftAccount=(await preview(d,'/admin/staff-accounts')).accounts.find(a=>a.technicianId===techId);check('账号草稿实际预览不含密码',draftAccount&& !('initialPassword' in draftAccount));result=await apply(d);check('账号首次应用返回一次性凭据',result.handoff?.username==='s'+stamp&&result.handoff?.initialPassword?.length>=10)
 const secret=result.handoff.initialPassword;check('草稿和回执没有保存明文密码',!JSON.stringify(db.prepare('SELECT * FROM platform_setup_drafts WHERE id=?').get(d.id)).includes(secret));const again=await apply(d);check('重复应用不再次生成或暴露初始密码',again.alreadyApplied&&!again.handoff)
 d=await draft('visibility',{visibility:'perf_only'});check('员工范围草稿真实预览',(await preview(d,'/admin/staff-visibility')).visibility==='perf_only');await apply(d)
 d=await draft('quote',{gapHours:15,validHours:48});check('报价时限草稿真实预览',(await preview(d,'/admin/quote-settings')).gapHours===15);await apply(d)
 d=await draft('segments',{aDays:50,aVisits:4,nDays:20,sDays:90});check('分层规则草稿真实预览',(await preview(d,'/admin/segment-rules')).rules.aDays===50);await apply(d)
 d=await draft('knowledge',{question:'停车在哪里',keywords:'停车',answerZh:'请停门店右侧指定区域',answerEn:'Use the designated area.',enabled:true});check('知识库草稿实际预览',(await preview(d,'/admin/kb')).entries.some(r=>r.question==='停车在哪里'));await apply(d)
 d=await draft('salary',{technicianId:techId,template:'base_flat',flatPct:12.5,enableBase:false,enableHandwork:false,enableOvertime:false,enableCardCommission:true,firstRechargePct:2,renewRechargePct:1});check('薪资预览使用新方案',(await preview(d,'/admin/salary-plans/effective?technicianId='+techId)).plan.flatPct===12.5)
 check('平台未获老板确认不能应用薪资',(await api(prefix+'/drafts/'+d.id+'/apply','POST',{revision:1,confirm:true})).data.error.code==='OWNER_CONFIRMATION_REQUIRED')
 check('平台主钥匙不能代替老板确认',(await api('/admin/setup-review/'+d.id+'/confirm','POST',{revision:1,confirm:true},{'x-admin-tenant-id':tid})).status===403)
 let review=await api('/admin/setup-review','GET',undefined,adminHeaders);check('老板可见可理解的薪资差异',review.status===200&&review.data.drafts.some(x=>x.id===d.id&&x.changes.some(c=>c.key==='flatPct'&&c.label.includes('服务提成')&&c.after==='12.5%')))
 let confirmed=await api('/admin/setup-review/'+d.id+'/confirm','POST',{revision:1,confirm:true},adminHeaders);assert.equal(confirmed.status,200);await apply(d)
 check('应用薪资不锁工资或发薪',JSON.stringify(capture())===JSON.stringify(before))
 d=await draft('targets',{month:'2035-01',targets:[{technicianId:techId,mode:'split',displayMode:'with_split',perfTargetCents:300000,cardTargetCents:100000,orderTarget:20}]});check('按指定月份预览目标',(await preview(d,'/admin/perf-targets?month=2035-01')).technicians.find(t=>t.technicianId===techId).perfTargetCents===300000);await apply(d)
 const stores=(await api('/admin/business-hours','GET',undefined,adminHeaders)).data.stores;await api('/admin/business-hours','PUT',{storeId:stores[0].id,hours:[{weekday:1,isClosed:false,openTime:'09:00',closeTime:'18:00'}]},adminHeaders)
 d=await draft('schedule',{entries:[{technicianId:techId,date:'2035-01-01',shift:'full'}]});check('未来周真实预览显示草稿班次',(await preview(d,'/admin/schedule-week?from=2035-01-01')).schedules.some(s=>s.technicianId===techId&&s.date==='2035-01-01'&&s.startTime==='09:00'));await apply(d)
 const scheduleCurrent=(await api(prefix+'/modules/schedule')).data;const duplicate=await api(prefix+'/drafts','POST',{module:'schedule',fingerprint:scheduleCurrent.fingerprint,body:{entries:[{technicianId:techId,date:'2035-01-01',shift:'off'}]}});check('已有班表不能被初始配置覆盖',duplicate.status===409)
 d=await draft('recurring',{name:'测试固定费用',category:'房租',amountCents:10000,dayOfMonth:1,effectiveFrom:'2035-01-01'});check('未来费用草稿实际预览',(await preview(d,'/admin/finance/recurring')).rules.some(r=>r.effectiveFrom==='2035-01-01'));confirmed=await api('/admin/setup-review/'+d.id+'/confirm','POST',{revision:1,confirm:true},adminHeaders);assert.equal(confirmed.status,200);await apply(d)
 check('固定费用应用未生成当前或历史账目',JSON.stringify(capture())===JSON.stringify(before))
 check('所有业务历史逐值保留',JSON.stringify(capture())===JSON.stringify(before))
 writeFileSync('handoff/platform-setup-20261116/implementation/setup-operations-check.json',JSON.stringify({scope:'isolated synthetic tenant; real account authorization; no production data',checks},null,2));console.log(JSON.stringify({checks:checks.length},null,2))
}finally{db.close()}
