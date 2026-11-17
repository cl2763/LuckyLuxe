import {readFileSync,writeFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
const root='/Users/changliu/Desktop/有迹管家/Codex/隔离测试/平台代配置_20261116/ll-ci-data.platform-setup',base='http://127.0.0.1:4396',token=readFileSync(root+'/.owner-token','utf8').trim(),tid='setup-preview-test',prefix=`/platform/tenants/${tid}/setup`,stamp=Date.now()
const db=new DatabaseSync(root+'/lucky-luxe.sqlite',{readOnly:true}),checks=[]
async function api(path,method='GET',body,headers={}){const r=await fetch(base+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()}}
const capture=()=>Object.fromEntries(['users','bookings','settlements','stored_value_transactions','finance_transactions','member_timecards','coupon_grants','notification_logs','reminder_tasks'].filter(t=>db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(t)).map(t=>[t,createHash('sha256').update(JSON.stringify(db.prepare('SELECT * FROM "'+t+'"').all())).digest('hex')]))
const check=(name,pass)=>{assert.ok(pass,name);checks.push(name)}
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6X1IAAAAASUVORK5CYII='
async function exercise(module,body,previewPath){
 const current=await api(prefix+'/modules/'+module);assert.equal(current.status,200,JSON.stringify(current.data.error))
 const created=await api(prefix+'/drafts','POST',{module,body,fingerprint:current.data.fingerprint});assert.equal(created.status,201,module+': '+JSON.stringify(created.data.error));const draft=created.data.draft
 const unchanged=await api(prefix+'/modules/'+module);check(module+'保存草稿不改变正式配置',unchanged.data.fingerprint===current.data.fingerprint)
 const grant=await api(`/platform/tenants/${tid}/setup-preview`,'POST',undefined,{'x-setup-draft-id':draft.id});assert.equal(grant.status,201,module+': '+JSON.stringify(grant.data.error))
 const p=await api(previewPath,'GET',undefined,{authorization:'Bearer '+grant.data.token});check(module+'真实商家接口可预览草稿',p.status===200)
 const applied=await api(prefix+'/drafts/'+draft.id+'/apply','POST',{revision:1,confirm:true});assert.equal(applied.status,200,module+': '+JSON.stringify(applied.data.error));check(module+'核对后应用成功',applied.data.draft.status==='applied')
 const live=await api(previewPath,'GET',undefined,{'x-admin-tenant-id':tid});check(module+'商家端可读取已应用配置',live.status===200)
 return applied.data.draft.result
}
try{
 const protectedBefore=capture()
 await exercise('store',{address:'隔离测试地址 '+stamp,phone:'测试联络'},'/admin/business-hours')
 await exercise('hours',{hours:[{weekday:1,isClosed:false,openTime:'09:00',closeTime:'20:00'}]},'/admin/business-hours')
 await exercise('specialDates',{date:'2030-01-01',isClosed:true,note:'测试休息'},'/admin/business-hours')
 await exercise('booking',{onlineDeposit:false},'/admin/booking-rules')
 await exercise('deposit',{mode:'fixed',fixedAmountCents:3400},'/admin/deposit-config')
 const guide=(await api(prefix+'/modules/guide')).data.current.config;const sid=db.prepare('SELECT id FROM stores WHERE tenant_id=? ORDER BY name ASC').get(tid).id
 await exercise('guide',{steps:[{image:png,description:'测试指引'}],revision:guide.revision},'/admin/store-guide?storeId='+sid)
 await exercise('hero',{slides:[{image:png,labelZh:'隔离测试照片',isActive:true}]},'/admin/hero-slides')
 await exercise('notifications',{rules:[{type:'birthday',enabled:false,templateText:'测试问候{顾客名}'}]},'/admin/notify/rules')
 const coupon=await exercise('coupons',{name:'代配券-'+stamp,discountType:'amount',amountCents:1000,minSpendCents:2000,validDays:30,totalQty:20,scopeCategoryIds:[]},'/admin/coupons')
 await exercise('points',{couponId:coupon.coupon.id,costPoints:100,stock:5,perUserLimit:1,isActive:true},'/admin/points-prizes')
 // A hidden historical tier remains stored when unrelated settings are saved.
 let r=await api(`/platform/tenants/${tid}/membership-config`,'PUT',{tiersEnabled:false,tiers:[{key:'old',label:'历史等级',minRechargeCents:12345}],keepMemberAfterRefund:'keep'});assert.equal(r.status,200)
 const rawBefore=JSON.parse(db.prepare("SELECT value FROM tenant_settings WHERE tenant_id=? AND key='membership_config'").get(tid).value)
 await exercise('membership',{keepMemberAfterRefund:'drop'},'/admin/membership/config')
 const rawAfter=JSON.parse(db.prepare("SELECT value FROM tenant_settings WHERE tenant_id=? AND key='membership_config'").get(tid).value)
 check('关闭分级时保存其他设置仍保留历史等级',JSON.stringify(rawBefore.tiers)===JSON.stringify(rawAfter.tiers))
 check('所有配置操作未改动原有顾客业务和通知记录',JSON.stringify(protectedBefore)===JSON.stringify(capture()))
 writeFileSync('handoff/platform-setup-20261116/implementation/setup-modules-check.json',JSON.stringify({scope:'isolated runtime and synthetic tenant only',checks},null,2));console.log(JSON.stringify({checks:checks.length},null,2))
}finally{db.close()}
