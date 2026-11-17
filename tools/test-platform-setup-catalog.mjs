import {readFileSync,writeFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
const dir=process.env.SETUP_TEST_DATA_DIR||'/Users/changliu/Desktop/有迹管家/Codex/隔离测试/平台代配置_20261116/ll-ci-data.platform-setup',base=process.env.SETUP_TEST_BASE||'http://127.0.0.1:4396',token=process.env.SETUP_TEST_TOKEN||readFileSync(dir+'/.owner-token','utf8').trim(),tid='setup-catalog-'+Date.now(),checks=[]
const {assertTestTarget}=await import('../apps/api/test-guard.mjs');await assertTestTarget(base)
const db=new DatabaseSync(dir+'/lucky-luxe.sqlite',{readOnly:true});async function api(path,method='GET',body,headers={}){const r=await fetch(base+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()}}
const check=(n,v)=>{assert.ok(v,n);checks.push(n)},h={'x-admin-tenant-id':tid},prefix='/platform/tenants/'+tid+'/setup'
const created=await api('/platform/tenants','POST',{id:tid,name:'价格目录隔离店',plan:'chain',currency:'CAD'});assert.equal(created.status,201)
const cats=(await api('/platform/tenants/'+tid+'/categories')).data.categories,cat=cats[0]
const protectedSnapshot=()=>createHash('sha256').update(JSON.stringify(['users','bookings','settlements','stored_value_transactions','finance_transactions','member_timecards','coupon_grants'].map(t=>db.prepare('SELECT * FROM '+t).all()))).digest('hex'),before=protectedSnapshot()
async function draft(module,body,targetId=null){const c=await api(prefix+'/modules/'+module);assert.equal(c.status,200,module+': '+JSON.stringify(c.data.error));const r=await api(prefix+'/drafts','POST',{module,body,targetId,fingerprint:c.data.fingerprint});assert.equal(r.status,201,module+': '+JSON.stringify(r.data.error));check(module+'草稿不覆盖正式值',(await api(prefix+'/modules/'+module)).data.fingerprint===c.data.fingerprint);return r.data.draft}
async function preview(d,path){const g=await api('/platform/tenants/'+tid+'/setup-preview','POST',undefined,{'x-setup-draft-id':d.id});assert.equal(g.status,201);const r=await api(path,'GET',undefined,{authorization:'Bearer '+g.data.token});assert.equal(r.status,200,path+': '+JSON.stringify(r.data.error));return r.data}
async function apply(d){const r=await api(prefix+'/drafts/'+d.id+'/apply','POST',{revision:1,confirm:true});assert.equal(r.status,200,JSON.stringify(r.data.error));return r.data.draft.result}
try{
 let c=(await api('/admin/member-pricing/config','GET',undefined,h)).data.config;assert.equal((await api('/admin/member-pricing/config','PUT',{active:true,expectedRevision:c.revision,displayTypes:['list','member'],settlementTypes:['list','member']},h)).status,200)
 let d=await draft('services',{nameZh:'独立展示服务',nameEn:'Display service',type:'NAIL',categoryId:cat.id,priceCents:12345,depositCents:0,baseDurationMin:60,priceSystemUpdate:{system:'display',expectedRevision:0,prices:{list:{priceCents:12345},member:{priceCents:10000}}}})
 let p=await preview(d,'/admin/services'),temp=p.services.find(s=>s.nameZh==='独立展示服务');check('新增展示服务在真实预览出现',!!temp)
 let prices=await preview(d,'/admin/member-pricing/services/'+temp.id+'/display');check('新增草稿独立价格详情一致',prices.prices.list.priceCents===12345&&prices.prices.member.priceCents===10000)
 const svc=(await apply(d)).service;check('应用服务通过商家真实接口读取',(await api('/admin/services','GET',undefined,h)).data.services.some(s=>s.id===svc.id))
 const displayBefore=(await api('/admin/member-pricing/services/'+svc.id+'/display','GET',undefined,h)).data
 const settlementBefore=(await api('/admin/member-pricing/services/'+svc.id+'/settlement','GET',undefined,h)).data
 d=await draft('settlement',{priceSystemUpdate:{system:'settlement',expectedRevision:settlementBefore.revision,prices:{list:{priceCents:23456},member:{priceCents:19000}}}},svc.id)
 prices=await preview(d,'/admin/member-pricing/services/'+svc.id+'/settlement');check('结算草稿详情使用新独立价格',prices.prices.list.priceCents===23456)
 await apply(d);check('更改结算价不覆盖展示价',JSON.stringify((await api('/admin/member-pricing/services/'+svc.id+'/display','GET',undefined,h)).data)===JSON.stringify(displayBefore))
 d=await draft('settlement',{nameZh:'按指收费加项',categoryId:cat.id,itemKind:'addon',unit:'per_finger',addonScope:[cat.id],priceCents:500,priceRule:'fixed',priceMode:'fixed',priceSystemUpdate:{system:'settlement',expectedRevision:0,prices:{list:{priceCents:500}}}});p=await preview(d,'/admin/pricing/items');check('收费单位与范围保留',p.items.some(i=>i.nameZh==='按指收费加项'&&i.unit==='per_finger'&&i.addonScope.includes(cat.id)));await apply(d)
 c=(await api(prefix+'/modules/priceTypes')).data.current.config;d=await draft('priceTypes',{expectedRevision:c.revision,displayTypes:['list']});await apply(d);const config=(await api('/admin/member-pricing/config','GET',undefined,h)).data.config;check('展示价格类型与结算相互独立',config.displayTypes.length===1&&config.settlementTypes.includes('member'));check('隐藏展示会员价不删除原有金额',(await api('/admin/member-pricing/services/'+svc.id+'/display','GET',undefined,h)).data.prices.member.priceCents===10000)
 d=await draft('times',{name:'五次护理',priceCents:30000,timesCount:5,projectGroup:cat.name,validDays:180,mallVisible:true});p=await preview(d,'/admin/packages');check('次卡范围与有效期真实预览',p.packages.some(p=>p.name==='五次护理'&&p.projectGroup===cat.name&&p.validDays===180));await apply(d)
 c=await api(prefix+'/modules/times');let bad=await api(prefix+'/drafts','POST',{module:'times',fingerprint:c.data.fingerprint,body:{name:'错误次卡',priceCents:100,timesCount:1,validDays:30,projectGroup:'不存在的范围'}});check('次卡悬空项目组拒绝',bad.status===400)
 d=await draft('pricingRules',{rules:{foot_surcharge:{isActive:true,config:{amountCents:3000}},single_finger:{isActive:true,config:{pct:10}}}});p=await preview(d,'/admin/pricing/rules');check('附加计价使用相同实际接口',p.rules.foot_surcharge.config.amountCents===3000);await apply(d)
 c=await api(prefix+'/modules/pricingRules');bad=await api(prefix+'/drafts','POST',{module:'pricingRules',fingerprint:c.data.fingerprint,body:{rules:{single_finger:{isActive:true,config:{pct:100.1}}}}});check('异常比例拒绝且正式值保留',bad.status===400&&(await api(prefix+'/modules/pricingRules')).data.fingerprint===c.data.fingerprint)
 check('目录配置不改顾客账务或已售权益',protectedSnapshot()===before)
 writeFileSync('handoff/platform-setup-20261116/implementation/setup-catalog-check.json',JSON.stringify({scope:'isolated synthetic tenant; actual catalog and independent-price APIs',checks},null,2));console.log(JSON.stringify({checks:checks.length}))
}finally{db.close()}
