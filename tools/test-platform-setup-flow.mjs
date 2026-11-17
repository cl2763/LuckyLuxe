import {readFileSync,writeFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
const root='/Users/changliu/Desktop/有迹管家/Codex/隔离测试/平台代配置_20261116/ll-ci-data.platform-setup',base='http://127.0.0.1:4396',token=readFileSync(root+'/.owner-token','utf8').trim(),tid='setup-preview-test'
const db=new DatabaseSync(root+'/lucky-luxe.sqlite',{readOnly:true}),checks=[]
async function api(path,method='GET',body,headers={}){const r=await fetch(base+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();return {status:r.status,data}}
const path=`/platform/tenants/${tid}/setup`
const protectedTables=['users','bookings','settlements','stored_value_transactions','finance_transactions','member_timecards','coupon_grants'].filter(t=>db.prepare("SELECT name FROM sqlite_master WHERE name=?").get(t))
const capture=()=>Object.fromEntries(protectedTables.map(t=>[t,createHash('sha256').update(JSON.stringify(db.prepare('SELECT * FROM "'+t+'"').all())).digest('hex')]))
function check(name,pass){assert.ok(pass,name);checks.push(name)}
try{
 const before=capture(),r=await api(path);assert.equal(r.status,200,JSON.stringify(r.data.error));check('配置总览可读取',r.data.modules.length>=7)
 let current=(await api(path+'/modules/recharge')).data
 const target=current.current.packages.find(p=>p.kind==='recharge'),value=target.priceCents===50000?55000:50000
 let draft=await api(path+'/drafts','POST',{module:'recharge',targetId:target.id,body:{priceCents:value},fingerprint:current.fingerprint});assert.equal(draft.status,201,JSON.stringify(draft.data.error));draft=draft.data.draft
 check('验证草稿不更改套餐金额',db.prepare('SELECT price_cents FROM membership_packages WHERE id=?').get(target.id).price_cents===target.priceCents)
 const grant=await api(`/platform/tenants/${tid}/setup-preview`,'POST',undefined,{'x-setup-draft-id':draft.id})
 assert.equal(grant.status,201,JSON.stringify(grant.data.error))
 const preview=await api('/admin/packages','GET',undefined,{authorization:'Bearer '+grant.data.token})
 check('实际商家读取口可预览草稿值',preview.data.packages.find(p=>p.id===target.id).priceCents===value)
 check('预览后正式值仍保持',db.prepare('SELECT price_cents FROM membership_packages WHERE id=?').get(target.id).price_cents===target.priceCents)
 let applied=await api(path+'/drafts/'+draft.id+'/apply','POST',{revision:1,confirm:true});assert.equal(applied.status,200,JSON.stringify(applied.data.error))
 check('应用结果与草稿价格一致',db.prepare('SELECT price_cents FROM membership_packages WHERE id=?').get(target.id).price_cents===value)
 check('商家实际接口读到应用后值',(await api('/admin/packages','GET',undefined,{'x-admin-tenant-id':tid})).data.packages.find(p=>p.id===target.id).priceCents===value)
 check('重复应用返回原回执',(await api(path+'/drafts/'+draft.id+'/apply','POST',{revision:1,confirm:true})).data.alreadyApplied===true)
 check('已应用的草稿预览令牌不能继续当未应用草稿使用',(await api('/admin/packages','GET',undefined,{authorization:'Bearer '+grant.data.token})).status===409)
 current=(await api(path+'/modules/recharge')).data
 let conflict=await api(path+'/drafts','POST',{module:'recharge',targetId:target.id,body:{bonusCents:1234},fingerprint:current.fingerprint});conflict=conflict.data.draft
 assert.equal((await api('/admin/packages/'+target.id,'PATCH',{scope:'商家在另一端修改-'+Date.now()},{'x-admin-tenant-id':tid})).status,200)
 check('商家自行修改后旧草稿应用拒绝',(await api(path+'/drafts/'+conflict.id+'/apply','POST',{revision:1,confirm:true})).status===409)
 check('历史账务与已售权益逐字段未变',JSON.stringify(before)===JSON.stringify(capture()))
 writeFileSync('handoff/platform-setup-20261116/implementation/setup-flow-check.json',JSON.stringify({scope:'isolated runtime, actual shared package writer',checks,protectedTables},null,2));console.log(JSON.stringify({checks:checks.length,protectedTables},null,2))
}finally{db.close()}
