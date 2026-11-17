import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createRequire} from 'node:module'
import {DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),{chromium}=require('/Users/changliu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const data=process.env.SETUP_TEST_DATA_DIR||'/Users/changliu/Desktop/有迹管家/Codex/隔离测试/平台代配置_20261116/ll-ci-data.platform-setup',base=process.env.SETUP_TEST_BASE||'http://127.0.0.1:4396',token=process.env.SETUP_TEST_TOKEN||readFileSync(data+'/.owner-token','utf8').trim(),out='handoff/platform-setup-20261116/implementation'
const {assertTestTarget}=await import('../apps/api/test-guard.mjs');await assertTestTarget(base)
const db=new DatabaseSync(data+'/lucky-luxe.sqlite',{readOnly:true})
async function api(path,method='GET',body,headers={}){const r=await fetch(base+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()}}
const id='setup-preview-test',other='setup-other-test'
for(const tid of [id,other])if(!db.prepare('SELECT id FROM tenants WHERE id=?').get(tid)){const r=await api('/platform/tenants','POST',{id:tid,name:tid===id?'平台配置隔离测试店':'另一家隔离店',plan:'single',currency:'CAD'});assert.equal(r.status,201,JSON.stringify(r.data.error))}
if(!db.prepare('SELECT id FROM membership_packages WHERE tenant_id=?').get(id)){const r=await api('/admin/packages','POST',{name:'预览专属套餐',kind:'recharge',priceCents:50000,bonusCents:5000,defaultPersonalDiscount:{expectedRevision:0,rateBps:8500}},{'x-admin-tenant-id':id});assert.equal(r.status,201,JSON.stringify(r.data.error))}
const baseline=()=>Object.fromEntries(['users','bookings','settlements','stored_value_transactions','membership_packages','tenant_settings','services'].map(t=>[t,createHash('sha256').update(JSON.stringify(db.prepare('SELECT * FROM "'+t+'"').all())).digest('hex')]))
const before=baseline(),checks=[],errors=[]
const check=(name,v)=>{assert.ok(v,name);checks.push(name)}
const grant=await api('/platform/tenants/'+id+'/setup-preview','POST',undefined,{'x-preview-role':'owner'});assert.equal(grant.status,201)
const h={authorization:'Bearer '+grant.data.token}
check('预览不能充值',(await api('/admin/packages','POST',{name:'不能创建'},h)).status===403)
check('预览不能读取顾客',(await api('/admin/customers','GET',undefined,h)).status===403)
check('伪造目标门店拒绝',(await api('/admin/packages','GET',undefined,{...h,'x-admin-tenant-id':other})).status===403)
check('预览可读本店真实套餐',(await api('/admin/packages','GET',undefined,h)).data.packages.some(p=>p.name==='预览专属套餐'))
const staff=await api('/platform/tenants/'+id+'/setup-preview','POST',undefined,{'x-preview-role':'staff'})
check('员工预览不能读取老板配置',(await api('/admin/packages','GET',undefined,{authorization:'Bearer '+staff.data.token})).status===403)
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}),page=await browser.newPage({viewport:{width:1440,height:1100}})
page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',route=>route.abort())
try{
 const url=base+'/admin#'+new URLSearchParams({setupPreview:grant.data.token,page:'membership'})
 await page.goto(url);await page.getByText('预览专属套餐',{exact:true}).waitFor({timeout:20000})
 check('网页使用真实套餐数据',await page.getByText('预览专属套餐',{exact:true}).isVisible())
 check('发券操作区不加载顾客数据',!await page.locator('#couponGrantCard').isVisible())
 await page.waitForFunction(()=>[...document.querySelectorAll('#membershipPage, #membershipPage *')].filter(e=>e.getAnimations().some(a=>a.playState==='running')).length===0);await page.screenshot({path:out+'/真实商家预览_会员套餐.png',fullPage:true,animations:'disabled'})
 for(let i=0;i<5;i++){await page.reload();await page.getByText('预览专属套餐',{exact:true}).waitFor();check('真实预览重新进入'+(i+1),await page.getByText('预览专属套餐',{exact:true}).isVisible())}
 check('预览没有写入商家登录凭据',await page.evaluate(()=>!localStorage.getItem('lucky-owner-auth')&&!sessionStorage.getItem('lucky-owner-auth')))
 await Promise.all([page.waitForNavigation(),page.locator('[data-admin-page="storeSettings"]').click()])
 await page.locator('#storeProfileName').waitFor({state:'attached',timeout:20000})
 await page.locator('#storeProfileBody').evaluate(el=>el.closest('details').open=true)
 check('真实门店设置展示本店名称',(await page.locator('#storeProfileName').inputValue())==='平台配置隔离测试店')
 await page.locator('#depositSettingsBody').evaluate(el=>el.closest('details').open=true)
 await page.waitForFunction(()=>document.querySelector('#depositSettingsBody')?.textContent.includes('定金'))
 await page.waitForFunction(()=>[...document.querySelectorAll('#storeSettingsPage, #storeSettingsPage *')].every(e=>!e.getAnimations().some(a=>a.playState==='running')))
 await page.screenshot({path:out+'/真实商家预览_门店设置.png',fullPage:true,animations:'disabled'})
 const ops=db.prepare("SELECT id FROM tenants WHERE id LIKE 'setup-ops-%' ORDER BY rowid DESC LIMIT 1").get().id
 const cases=[['schedule','#scheduleWeekGrid'],['salary','#salaryPlansBody'],['targets','#perfTargetsBody'],['accounts','#staffAccountsBody'],['recurring','#financeRecurringBody'],['customers','#customerList']]
 for(const [key,selector] of cases){
  const g=await api('/platform/tenants/'+ops+'/setup-preview','POST',undefined,{'x-preview-page':key});assert.equal(g.status,201)
  await page.goto('about:blank');await page.goto(base+'/admin#'+new URLSearchParams({setupPreview:g.data.token,page:key}))
  await page.waitForFunction(()=>document.querySelector('body>div[role=status]')?.textContent.includes('商家真实网页'),{},{timeout:20000})
  const locator=page.locator(selector);await locator.waitFor({state:'visible',timeout:20000})
  check('实际商家页面可读 '+key,(await locator.innerText()).trim().length>0)
  if(key==='salary'){await page.locator('[data-sp-plan=""]').click();await page.locator('#salaryPlanPanelBody input').first().waitFor();check('真实薪资编辑器打开',await page.locator('#salaryPlanPanelBody').isVisible());await page.locator('[data-sp-close]').click()}
  if(key==='customers'){await page.locator('[data-rfm-rules]').click();await page.locator('[data-rfm-num="aDays"]').waitFor();check('客户分层实际编辑器可见',await page.locator('[data-rfm-num="aDays"]').isVisible())}
  await page.screenshot({path:out+'/真实商家预览_'+key+'.png',fullPage:true,animations:'disabled'})
 }
 for(const [detail,key,selector] of [
 ['times','membership','[data-member-tab="times"].active'],['coupons','membership','[data-member-tab="coupon"].active'],['points','membership','[data-member-tab="mall"].active'],['membership','membership','[data-member-tab="tiers"].active'],['services','pricing','[data-pricing-module="storefront"].active'],['settlement','pricing','[data-pricing-module="catalog"].active'],['pricingRules','pricing','[data-pricing-tab="rules"].active'],['deposit','storeSettings','#depositSettingsBody'],['hours','storeSettings','#businessHoursEditor'],['notifications','storeSettings','#notifySettingsBody']]){
 const g=await api('/platform/tenants/'+ops+'/setup-preview','POST',undefined,{'x-preview-page':key,'x-preview-detail':detail});assert.equal(g.status,201);await page.goto('about:blank');await page.goto(base+'/admin#'+new URLSearchParams({setupPreview:g.data.token,page:key,section:detail}));await page.waitForFunction(()=>document.querySelector('body>div[role=status]')?.textContent.includes('商家真实网页'));await page.locator(selector).waitFor({state:'visible'});check('预览直接落在实际配置位置 '+detail,await page.locator(selector).isVisible())
 }
 const webOnly=await api('/platform/tenants/'+ops+'/setup-preview','POST',undefined,{'x-preview-page':'storeSettings','x-preview-detail':'knowledge'});check('无原生入口模块不伪造小程序预览',(await api('/platform/tenants/'+ops+'/setup-preview-code','POST',undefined,{'x-preview-ticket':webOnly.data.ticket})).data.error?.code==='WEB_ONLY')
 check('错误模块与页面组合被拒绝',(await api('/platform/tenants/'+ops+'/setup-preview','POST',undefined,{'x-preview-page':'pricing','x-preview-detail':'times'})).status===400)
 await page.goto(base+'/platform');await page.evaluate(async({token,id})=>{TOKEN=token;document.getElementById('loginWrap').classList.add('hidden');document.getElementById('app').classList.remove('hidden');await loadTenants();goConfig(id)},{token,id});await page.getByRole('button',{name:'预览商家端',exact:true}).click();const dialog=page.locator('[data-setup-preview]');await dialog.getByLabel('预览配置页面',{exact:true}).selectOption('membership');await page.frameLocator('iframe[title="商家实际网页只读预览"]').getByText('预览专属套餐',{exact:true}).waitFor();check('平台选择器打开真实商家页面',await dialog.locator('iframe').isVisible());check('预览选择器覆盖9类实际页面',await dialog.locator('[aria-label="预览配置页面"] option').count()===9);await page.screenshot({path:out+'/真实商家预览_选择器.png',animations:'disabled'});await dialog.getByLabel('预览查看方式',{exact:true}).selectOption('mini');await dialog.getByText('预览码只用于当前门店，30分钟内有效；不会赋予真实商家账号权限。',{exact:true}).waitFor();check('小程序模式显示体验成员和配套版本提示',await dialog.getByText('需要包含本次预览功能的体验版。未上传新版时，请勿把无法打开的码用于验收。',{exact:true}).isVisible());check('切换小程序时清空网页会话',await dialog.locator('iframe').getAttribute('src')==='about:blank'&&!await dialog.locator('iframe').isVisible());await page.screenshot({path:out+'/真实小程序预览_扫码入口.png',animations:'disabled'});await dialog.getByLabel('预览身份',{exact:true}).selectOption('staff');await dialog.getByLabel('预览查看方式',{exact:true}).selectOption('web');await dialog.getByText('使用商家网页同一份页面、样式和配置接口。未保存草稿不包含在正式预览中。',{exact:true}).waitFor();await page.frameLocator('iframe[title="商家实际网页只读预览"]').getByText('员工无权查看',{exact:false}).waitFor();check('员工身份不能展示老板配置',!(await dialog.locator('iframe').contentFrame().locator('body').innerText()).includes('预览专属套餐'));await dialog.getByRole('button',{name:'返回配置',exact:true}).click();check('关闭预览移除包含会话的框架',await page.locator('iframe[title="商家实际网页只读预览"]').count()===0)

 const work=page.frameLocator('iframe[title="代配置工作台"]');await work.locator('[data-group=store]').first().click();await work.getByLabel('门店名称',{exact:true}).fill('未保存的预览返回核对');await work.locator('[data-section=store] [data-section-preview]').click();await page.locator('[data-setup-preview]').waitFor();check('预览时原门店切换与编辑控件隐藏',!await page.locator('#cfgTenant').isVisible());check('真实预览在配置页面内展开而非覆盖弹窗',await page.locator('#page-config > section[data-setup-preview]').isVisible()&&await page.locator('dialog[data-setup-preview]').count()===0);await page.locator('[data-setup-preview] [data-close]').click();check('返回配置后保留未保存输入',await work.getByLabel('门店名称',{exact:true}).inputValue()==='未保存的预览返回核对');await work.getByLabel('门店名称',{exact:true}).fill('平台配置隔离测试店');await work.locator('[data-section=store] [data-section-preview]').click();await page.locator('[data-setup-preview]').waitFor();await page.locator('.navbtn[data-page=merchants]').click();await page.locator('[data-setup-preview]').waitFor({state:'detached'});check('离开配置页销毁原门店预览会话',await page.locator('iframe[title="商家实际网页只读预览"]').count()===0)
 check('无页面脚本异常',errors.length===0)
 check('预览前后业务数据逐表一致',JSON.stringify(before)===JSON.stringify(baseline()))
 writeFileSync(out+'/preview-ui-check.json',JSON.stringify({scope:'isolated runtime, actual admin.html and merchant APIs',checks,errors},null,2));console.log(JSON.stringify({checks:checks.length,errors},null,2))
}catch(e){console.error({errors,body:(await page.locator('body').innerText()).slice(-1500)});await page.screenshot({path:out+'/preview-failure.png',fullPage:true,animations:'disabled'});throw e}finally{await browser.close();db.close()}
