import {createRequire} from 'node:module'
import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
const require=createRequire(import.meta.url),automator=require('/Users/changliu/ll-mp-tools/node_modules/miniprogram-automator')
const root=process.env.SETUP_TEST_DATA_DIR||'/Users/changliu/Desktop/有迹管家/Codex/隔离测试/平台代配置_20261116/ll-ci-data.platform-setup',base=process.env.SETUP_TEST_BASE||'http://127.0.0.1:4396',token=process.env.SETUP_TEST_TOKEN||readFileSync(root+'/.owner-token','utf8').trim(),tid='setup-preview-test',out='handoff/platform-setup-20261116/implementation'
const {assertTestTarget}=await import('../apps/api/test-guard.mjs');await assertTestTarget(base)
const db=new DatabaseSync(root+'/lucky-luxe.sqlite',{readOnly:true}),ops=db.prepare("SELECT id FROM tenants WHERE id LIKE 'setup-ops-%' ORDER BY rowid DESC LIMIT 1").get().id;db.close()
async function issue(page,tenant=tid){const r=await fetch(base+`/platform/tenants/${tenant}/setup-preview`,{method:'POST',headers:{authorization:'Bearer '+token,'x-preview-page':page}});assert.equal(r.status,201);return r.json()}
console.log('Connecting to isolated mini preview');
const mp=await automator.connect({wsEndpoint:'ws://127.0.0.1:9446'}),checks=[],errors=[]
mp.on('exception',e=>errors.push(String(e.message||e)))
const check=(name,pass)=>{assert.ok(pass,name);checks.push(name);console.log('ok '+name)}
async function storage(){const values=await mp.evaluate(()=>{const ks=['lucky_admin_auth','lucky_admin_role','lucky_tenant','lucky_store_clock','lucky_finance_key','lucky_mini_auth'];return ks.map(k=>[k,wx.getStorageSync(k)])});return createHash('sha256').update(JSON.stringify(values)).digest('hex')}
// The IDE's App.getCurrentPage stalls after an entry page redirects. Read the
// real page stack through the official automator evaluate API instead.
const bounded=(p)=>Promise.race([p,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('微信自动化接口 15 秒未响应')),15000);t.unref()})]);
async function actualPage(){const path=await bounded(mp.evaluate(()=>getCurrentPages().slice(-1)[0]?.route));return {path,data:()=>bounded(mp.evaluate(()=>getCurrentPages().slice(-1)[0]?.data)),setData:data=>bounded(mp.evaluate(data=>getCurrentPages().slice(-1)[0].setData(data),data)),callMethod:name=>bounded(mp.evaluate(name=>getCurrentPages().slice(-1)[0][name](),name))}}
async function waitPage(path,predicate){for(let i=0;i<25;i++){const p=await actualPage();if(p?.path===path&&(!predicate||predicate(await p.data())))return p;await new Promise(r=>setTimeout(r,800))}throw Error('未进入预期页面 '+path)}
try{
 console.log('Connected; reading cache baseline');
 const before=await storage(),grant=await issue('membership')
 console.log('Opening preview entry');
 await mp.evaluate(url=>{wx.redirectTo({url,success:()=>{getApp().globalData.setupNavResult='ok'},fail:e=>{getApp().globalData.setupNavResult=e.errMsg}});return true},'/'+grant.miniPage)
 await new Promise(r=>setTimeout(r,1200)); console.log('Entry opened')
 let page=await waitPage('pages/merchant/member/index',d=>d.recharges?.length>0)
 check('原生会员页面读到本店真实套餐',(await page.data()).recharges.some(p=>p.name==='预览专属套餐'))
 check('只读标记在实际页面显示',(await page.data()).setupPreviewActive===true)
 await bounded(mp.screenshot({path:out+'/真实小程序预览_会员套餐.png'}))
 const p=(await page.data()).recharges[0]
 await mp.evaluate(url=>{wx.navigateTo({url});return true},'/pages/merchant/package-edit/index?id='+p.id+'&kind=recharge');await new Promise(r=>setTimeout(r,1200))
 page=await waitPage('pages/merchant/package-edit/index',d=>!!d.name)
 const name=(await page.data()).name
 const nativeEditor=await bounded(mp.currentPage());await bounded((await nativeEditor.$('input')).input(name+'（不应保存）'));await new Promise(r=>setTimeout(r,400));
 await bounded((await nativeEditor.$('.btn')).tap());await new Promise(r=>setTimeout(r,600));check('预览保存后留在原页面',(await actualPage()).path==='pages/merchant/package-edit/index')
 const r=await fetch(base+'/admin/packages',{headers:{authorization:'Bearer '+token,'x-admin-tenant-id':tid}}),live=await r.json()
 check('真实接口确认预览保存未改套餐',live.packages.find(x=>x.id===p.id).name===name)
 await bounded(mp.screenshot({path:out+'/真实小程序预览_套餐编辑.png'}))
 const storeGrant=await issue('storeSettings');await mp.evaluate(url=>{wx.redirectTo({url,success:()=>{getApp().globalData.setupNavResult='ok'},fail:e=>{getApp().globalData.setupNavResult=e.errMsg}});return true},'/'+storeGrant.miniPage);await new Promise(r=>setTimeout(r,1200))
 page=await waitPage('pages/merchant/store/index',d=>d.loading===false&&!!d.name)
 check('原生门店页读取真实店名',(await page.data()).name==='平台配置隔离测试店')
 await bounded(mp.screenshot({path:out+'/真实小程序预览_门店设置.png'}))
 for(const [key,path,ready] of [
  ['schedule','pages/merchant/staff/index',d=>d.sc?.days?.length>0],
  ['accounts','pages/merchant/staff/index',d=>d.tab==='accounts'&&d.list?.length>0],
  ['targets','pages/merchant/staff/index',d=>d.tab==='targets'&&d.targets?.length>0],
  ['salary','pages/merchant/salary-plan/index',d=>!!d.preview],
  ['customers','pages/merchant/customers/index',d=>d.ruleSheet===true]
 ]){console.log('Checking native '+key);const g=await issue(key,ops);await bounded(mp.evaluate(url=>{wx.redirectTo({url,success:()=>{getApp().globalData.setupNavResult='ok'},fail:e=>{getApp().globalData.setupNavResult=e.errMsg}});return true},'/'+g.miniPage));await new Promise(r=>setTimeout(r,1200));page=await waitPage(path,ready);check('实际小程序页面可读 '+key,(await page.data()).setupPreviewActive===true);await bounded(mp.screenshot({path:out+'/真实小程序预览_'+key+'.png'}))}
 for(let i=0;i<5;i++){const g=await issue('membership');await bounded(mp.evaluate(url=>{wx.redirectTo({url,success:()=>{getApp().globalData.setupNavResult='ok'},fail:e=>{getApp().globalData.setupNavResult=e.errMsg}});return true},'/'+g.miniPage));await new Promise(r=>setTimeout(r,1200));page=await waitPage('pages/merchant/member/index',d=>d.recharges?.length>0);check('原生预览连续进入 '+(i+1),(await page.data()).setupPreviewActive===true)}
 check('预览期间原商家及顾客登录缓存不变',before===await storage())
 await bounded(mp.evaluate(()=>getCurrentPages().slice(-1)[0].selectComponent('#setup-preview-banner').exit()));await new Promise(r=>setTimeout(r,1200))
 check('退出后原商家及顾客登录缓存不变',before===await storage())
 check('无小程序脚本异常',errors.length===0)
 writeFileSync(out+'/mini-preview-check.json',JSON.stringify({scope:'official automator; isolated local API; native pages, actual input/tap for read-only save rejection; QR delivery not verified',checks,errors},null,2));console.log(JSON.stringify({checks:checks.length,errors},null,2))
}catch(e){const failedPage=await actualPage().catch(()=>null);const d=await failedPage?.data().catch(()=>null);console.error({navigation:await bounded(mp.evaluate(()=>getApp().globalData.setupNavResult)).catch(()=>null),page:failedPage?.path,error:d?.error,loading:d?.loading,errors});throw e}finally{mp.disconnect()}
