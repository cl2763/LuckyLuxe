import {readFileSync,writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {DatabaseSync} from 'node:sqlite'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),{chromium}=require('/Users/changliu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const root=process.env.SETUP_TEST_DATA_DIR||'/Users/changliu/Desktop/有迹管家/Codex/隔离测试/平台代配置_20261116/ll-ci-data.platform-setup',base=process.env.SETUP_TEST_BASE||'http://127.0.0.1:4396',token=process.env.SETUP_TEST_TOKEN||readFileSync(root+'/.owner-token','utf8').trim(),out='handoff/platform-setup-20261116/implementation',tid='setup-preview-test',name='界面核对套餐-'+Date.now()
const {assertTestTarget}=await import('../apps/api/test-guard.mjs');await assertTestTarget(base)
const db=new DatabaseSync(root+'/lucky-luxe.sqlite',{readOnly:true}),checks=[],errors=[]
const browser=await chromium.launch({headless:true,args:['--disable-gpu'],executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}),page=await browser.newPage({viewport:{width:1440,height:1100}})
page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.abort())
const check=(name,pass)=>{assert.ok(pass,name);checks.push(name)}
try{
 await page.goto(base+'/platform')
 await page.evaluate(async({token,tid})=>{TOKEN=token;document.getElementById('loginWrap').classList.add('hidden');document.getElementById('app').classList.remove('hidden');await loadTenants();goConfig(tid)},{token,tid})
 await page.getByRole('button',{name:'配置草稿与核对',exact:true}).click()
 const work=page.frameLocator('iframe[title="代配置工作台"]');await work.locator('button[data-group=membership]').first().click()
 await work.getByRole('button',{name:'充值套餐与礼遇',exact:true}).click()
 await work.getByRole('button',{name:'新增',exact:true}).click()
 await work.getByLabel('套餐名称',{exact:true}).fill(name)

 await work.locator('[data-group=store]').first().click();await page.locator('.ui-dialog-overlay').getByRole('button',{name:'取消',exact:true}).click();check('取消切换模块保留未保存套餐名称',await work.getByLabel('套餐名称',{exact:true}).inputValue()===name);check('取消切换后导航仍指向当前会员模块',await work.locator('[data-group=membership][aria-current=true]').count()===1)
 await work.getByLabel('充值金额 · CAD',{exact:true}).fill('100')
 await work.getByLabel('赠送卡金 · CAD',{exact:true}).fill('20')
 await work.locator('[data-open]').click();await work.getByRole('option',{name:'8.5折',exact:true}).click();await work.locator('[data-selected]').filter({hasText:'8.5折'}).waitFor();const wheelBounds=await work.getByRole('button',{name:'确认选择',exact:true}).boundingBox();check('长配置页折扣确认按钮完整位于可见视口',!!wheelBounds&&wheelBounds.y>=0&&wheelBounds.y+wheelBounds.height<=1100);await work.getByRole('button',{name:'确认选择',exact:true}).click()
 await page.screenshot({path:out+'/代配置_充值编辑.png',fullPage:true})
 await work.getByRole('button',{name:'保存草稿并核对',exact:true}).click()
 const card=work.locator('section.intake-card').filter({hasText:name});await card.waitFor()
 check('核对只展示本次套餐而非整个目录',!(await card.innerText()).includes('预览专属套餐'));check('核对折扣使用中文说明',!(await card.innerText()).includes('rateBps')&&(await card.innerText()).includes('8.5折'));
 await page.screenshot({path:out+'/代配置_草稿核对.png',fullPage:true,animations:'disabled'});
 check('界面保存后只产生草稿',!db.prepare('SELECT id FROM membership_packages WHERE tenant_id=? AND name=?').get(tid,name))
 await card.getByRole('button',{name:'预览草稿效果',exact:true}).click()
 const preview=page.frameLocator('iframe[title="商家实际网页只读预览"]')
 await preview.getByText(name,{exact:true}).waitFor()
 check('真实商家页面呈现草稿套餐',await preview.getByText(name,{exact:true}).isVisible())
 const previewDialog=page.locator('[data-setup-preview]');await previewDialog.locator('[data-diff]>summary').click();check('真实预览同时可核对本次字段变化',await previewDialog.locator('[data-diff]').getByText('8.5折',{exact:false}).isVisible());await previewDialog.locator('[data-diff]>summary').click();await previewDialog.getByRole('button',{name:'正式／草稿并排',exact:true}).click();const formal=page.frameLocator('iframe[title="商家当前正式配置对照"]');await formal.getByText('预览专属套餐',{exact:true}).waitFor();await preview.getByText(name,{exact:true}).waitFor();check('并排预览正式侧不包含草稿套餐',await formal.getByText(name,{exact:true}).count()===0);check('并排预览草稿侧保留拟新增内容',await preview.getByText(name,{exact:true}).isVisible());await page.screenshot({path:out+'/真实商家预览_正式草稿并排.png',fullPage:false,animations:'disabled'});await previewDialog.getByLabel('预览身份',{exact:true}).selectOption('staff');await previewDialog.getByText('员工没有配置草稿的查看权限。',{exact:false}).waitFor();check('切换无权身份后清空原老板预览',await page.locator('iframe[title="商家实际网页只读预览"]').getAttribute('src')==='about:blank')
 await previewDialog.getByRole('button',{name:'返回配置',exact:true}).click()
 await card.locator('[data-confirm-draft]').check();await card.getByRole('button',{name:'应用这份草稿',exact:true}).click()
 await work.getByText('这份配置已应用。商家端将读取新配置；历史业务记录未改动。',{exact:true}).waitFor()
 const row=db.prepare('SELECT * FROM membership_packages WHERE tenant_id=? AND name=?').get(tid,name)
 check('应用后真实配置持久保存',row.price_cents===10000&&row.bonus_cents===2000)
 const discount=db.prepare('SELECT * FROM recharge_package_discounts WHERE tenant_id=? AND package_id=?').get(tid,row.id)
 check('滚轮选择的8.5折写入配置',discount.rate_bps===8500)
 check('历史记录默认收起且可展开查看',!(await work.locator('[data-review-history]').evaluate(e=>e.open)));await work.locator('[data-review-history]>summary').click();const history=work.locator('[data-history-draft]').filter({hasText:name}).first();await history.locator('summary').first().click();check('历史回执可查看实际应用操作记录',await history.getByText('应用配置',{exact:true}).isVisible());check('历史详情保留本次应用值',await history.getByText(name,{exact:true}).isVisible());await work.locator('[data-review-history]>summary').click();
 await page.waitForFunction(()=>{const f=document.querySelector('iframe[title="代配置工作台"]');return Math.abs(parseFloat(f.style.height)-Math.max(700,Math.ceil(f.contentDocument.getElementById('root').getBoundingClientRect().height)))<2});await page.screenshot({path:out+'/代配置_应用回执.png',fullPage:true})
 const mutate=async(path,method,body)=>{const r=await fetch(base+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json','x-admin-tenant-id':tid},body:body?JSON.stringify(body):undefined});const d=await r.json();assert.ok(r.ok,JSON.stringify(d.error));return d};const prefix='/platform/tenants/'+tid+'/setup';const snap=await mutate(prefix+'/modules/recharge','GET');await mutate(prefix+'/drafts','POST',{module:'recharge',targetId:row.id,body:{name:name+'待覆盖'},fingerprint:snap.fingerprint});await mutate('/admin/packages/'+row.id,'PATCH',{name:name+'商家已修改'});await work.locator('[data-review]').first().click();const conflict=work.locator('section.intake-card').filter({hasText:name+'待覆盖'});await conflict.locator('[data-confirm-draft]').check();await conflict.getByRole('button',{name:'应用这份草稿',exact:true}).click();await work.locator('#status.error').waitFor();check('并发变化时显示错误且不覆盖商家修改',db.prepare('SELECT name FROM membership_packages WHERE id=?').get(row.id).name===name+'商家已修改');await page.screenshot({path:out+'/代配置_并发冲突.png',fullPage:true,animations:'disabled'});
 for(const key of ['serviceImport','store','cats','kb','wecom','owner','launch']){await work.locator('[data-overview]').click();await work.locator('[data-existing-tools]>summary').click();await work.locator('[data-existing="'+key+'"]').click();await page.locator('#tab-'+key).waitFor({state:'visible'});check('既有配置入口正常且保留当前店 '+key,await page.locator('#cfgTenant').inputValue()===tid);await page.getByRole('button',{name:'配置草稿与核对',exact:true}).click();await work.locator('[data-overview]').waitFor()}
 await work.locator('[data-existing-tools]>summary').click();await work.locator('[data-migration]').click();await page.locator('#page-import').waitFor({state:'visible'});check('顾客旧权益迁移入口保留当前门店',await page.locator('#impTenant').inputValue()===tid)
 check('无页面脚本异常',errors.length===0)
 writeFileSync(out+'/workbench-ui-check.json',JSON.stringify({scope:'isolated actual platform -> draft -> real merchant preview -> apply',checks,errors},null,2));console.log(JSON.stringify({checks:checks.length,errors},null,2))
}catch(e){console.error({errors,body:(await page.locator('body').innerText()).slice(-800),frames:await Promise.all(page.frames().slice(1).map(f=>f.locator('body').innerText().then(s=>s.slice(-1800)).catch(()=>'')))});await page.screenshot({path:out+'/workbench-failure.png',fullPage:true});throw e}finally{await browser.close();db.close()}
