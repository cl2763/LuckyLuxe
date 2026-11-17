import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {runInNewContext} from 'node:vm'
import {randomBytes} from 'node:crypto'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),storage={lucky_hours_unset:'1',lucky_hours_gate:'old-text',lucky_admin_role:'staff'},pending=[],redirects=[];let token=randomBytes(24).toString('hex'),unset=false,delay=false,role='owner',n=0
const check=(name,ok)=>{assert.ok(ok,name);console.log(`ok ${++n} - ${name}`)}
const context={module:{exports:{}},getCurrentPages:()=>[{route:'pages/merchant/home/index'}],wx:{getDeviceInfo:()=>({platform:'devtools'}),getStorageSync:k=>storage[k],setStorageSync:(k,v)=>storage[k]=v,removeStorageSync:k=>delete storage[k],request:o=>{const data=o.url.endsWith('/login')?{auth:{accessToken:token,expiresIn:3600},admin:{role,tenantId:token}}:{admin:{role,tenantId:token},hoursUnset:unset,hoursGateText:{ownerTitle:'Current hours'}};const reply=()=>o.success({statusCode:200,data});if(delay&&o.url.endsWith('/me'))pending.push(reply);else reply()}},require:p=>p==='./nav'?{relaunch:url=>redirects.push(url)}:['./setup-preview','./inflight','./public-catalog-cache'].includes(p)?require('../../miniprogram/utils/'+p.slice(2)+'.js'):p==='./devhost'?{port:4396,lanHost:'127.0.0.1'}:p==='./deploy'?{defaultTenantId:''}:{realValue:x=>x}}
runInNewContext(readFileSync(new URL('../../miniprogram/utils/api.js',import.meta.url),'utf8'),context);const api=context.module.exports
await api.adminLogin('isolated-owner',randomBytes(24).toString('hex'))
check('已配置门店登录后刷新旧未设置状态',storage.lucky_hours_unset===''&&storage.lucky_admin_role==='owner')
check('已配置门店不会被旧账号送回设置页',api.guardMerchant()===true&&redirects.length===0)
unset=true;role='staff';token=randomBytes(24).toString('hex');await api.adminLogin('isolated-staff',randomBytes(24).toString('hex'))
check('真正未设置的门店继续强制设置',api.guardMerchant()===false&&redirects[0].includes('hours-setup')&&storage.lucky_admin_role==='staff')
delay=true;const stale=api.adminMe(true).then(()=>false,()=>true);delay=false;unset=false;role='owner';token=randomBytes(24).toString('hex');await api.adminLogin('isolated-new-owner',randomBytes(24).toString('hex'));pending[0]()
check('前账号迟到响应不能覆盖新账号状态',await stale&&storage.lucky_hours_unset===''&&storage.lucky_admin_role==='owner'&&api.guardMerchant())
