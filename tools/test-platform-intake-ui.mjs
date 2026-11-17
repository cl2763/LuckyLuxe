import {randomBytes} from 'node:crypto'
const fixtureAuthorization='Bearer '+randomBytes(24).toString('hex')
import {createRequire} from 'node:module'
import {createServer} from 'node:http'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve,extname} from 'node:path'
import {createSetupIntake} from '../apps/api/platform-setup-intake.mjs'
const require=createRequire(import.meta.url),{chromium}=require('/Users/changliu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE tenants(id TEXT PRIMARY KEY); INSERT INTO tenants VALUES('solo'),('team')")
const getEntitlements=id=>({tenantName:id==='solo'?'个人工作室（隔离测试）':'团队门店（隔离测试）',plan:id==='solo'?'free':'single',planNameZh:id==='solo'?'个人版':'单店版',features:Object.fromEntries((id==='solo'?['booking','crm','gallery']:['booking','crm','gallery','membership','staff_schedule','ai_customer_service']).map(f=>[f,{enabled:true}]))})
const json=(res,status,v,h={})=>{res.writeHead(status,{'content-type':'application/json',...h});res.end(JSON.stringify(v))}
const intake=createSetupIntake({db,getEntitlements,json,apiError:(status,code,message)=>Object.assign(new Error(message),{status,code})})
const root=resolve('apps/web'),out=resolve('handoff/platform-setup-20261116/implementation');mkdirSync(out,{recursive:true})
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;if(path.startsWith('/web/')){const file=resolve(root,path.slice(5));if(!file.startsWith(root+'/'))throw Error('invalid');const data=readFileSync(file);res.writeHead(200,{'content-type':({'.mjs':'application/javascript','.js':'application/javascript','.html':'text/html','.css':'text/css'})[extname(file)]||'application/octet-stream'});return res.end(data)}if(!await intake.route({req,res,path,isPlatform:()=>req.headers.authorization===fixtureAuthorization}))json(res,404,{})}catch(e){json(res,e.status||500,{error:{message:e.message}})}})
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`
const browser=await chromium.launch({headless:true,args:['--disable-gpu'],executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message))
const check=(name,pass)=>{if(!pass)throw Error(name);checks.push(name)}
async function link(t){const r=await fetch(base+`/platform/tenants/${t}/setup-intake/link`,{method:'POST',headers:{authorization:fixtureAuthorization}});return base+(await r.json()).url}
try{
 const solo=await link('solo');await page.goto(solo);await page.getByText('个人版',{exact:true}).waitFor()
 check('个人版隐藏会员和员工模块',await page.locator('[data-intake-section="membership"],[data-intake-section="team"]').count()===0)
 await page.getByLabel('门店／工作室名称').fill('单人工作室');await page.getByLabel('所在城市').fill('Toronto');await page.getByLabel('联系电话或微信').fill('测试联系');await page.getByLabel('经营币种').selectOption('CAD')
 await page.getByLabel('服务与价格准备情况').selectOption('later')
 await page.getByLabel('服务与价格上传文件').setInputFiles({name:'服务价目.txt',mimeType:'text/plain',buffer:Buffer.from('基础美甲 30 CAD')})
 await page.locator('.file-info').filter({hasText:'服务价目.txt'}).waitFor();check('上传不会丢失未保存文字',await page.getByLabel('门店／工作室名称').inputValue()==='单人工作室')
 await page.getByRole('button',{name:'提交现有资料',exact:true}).click();await page.getByText('已提交现有资料。缺少的内容会由平台集中与你确认。',{exact:true}).waitFor()
 for(let i=0;i<5;i++){await page.goto(solo);await page.getByText('已提交给平台，可继续补充',{exact:true}).waitFor();check('个人资料进出稳定'+(i+1),await page.getByLabel('门店／工作室名称').inputValue()==='单人工作室')}
 await page.screenshot({path:out+'/资料表_个人版_网页.png',fullPage:true})
 await page.setViewportSize({width:390,height:844});await page.reload();await page.getByText('个人版',{exact:true}).waitFor();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.screenshot({path:out+'/资料表_个人版_手机.png',fullPage:true})
 check('手机无横向溢出',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
 const team=await link('team');await page.goto(team);await page.getByText('单店版',{exact:true}).waitFor();await page.locator('[data-intake-section="membership"] summary').click()
 await page.getByLabel('会员、充值与次卡准备情况').selectOption('unused')
 await page.getByRole('button',{name:'保存，稍后继续',exact:true}).click();await page.getByText('已保存，可以稍后继续填写。',{exact:true}).waitFor()
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:out+'/资料表_团队版_网页.png',fullPage:true})
 check('照片与文件入口独立',await page.locator('input[type=file]').count()>=8)
 await page.locator('[data-intake-section="branding"] summary').click()
 const tiny=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRtEAAAAASUVORK5CYII=','base64')
 await page.getByLabel('门店照片与到店指引上传文件').setInputFiles({name:'门店.png',mimeType:'image/png',buffer:tiny});await page.locator('.intake-files img').waitFor();check('上传照片显示真实缩略图',await page.locator('.intake-files img').evaluate(img=>img.complete&&img.naturalWidth>0))
 await page.getByRole('button',{name:'移除门店.png',exact:true}).click();await page.getByText('已移除这份收集材料；正式门店配置不受影响。',{exact:true}).waitFor();check('照片移除有效',await page.locator('.intake-files img').count()===0)
 await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:out+'/资料表_深色_网页.png',fullPage:true});check('资料表跟随深色且输入框使用配对令牌',await page.locator('input').first().evaluate(el=>getComputedStyle(el).backgroundColor==='rgb(42, 34, 28)'&&getComputedStyle(el).color==='rgb(240, 231, 218)'))
 check('无浏览器异常',errors.length===0)
 writeFileSync(out+'/intake-ui-check.json',JSON.stringify({scope:'Isolated in-memory API, actual application form',checks,errors},null,2));console.log(JSON.stringify({checks:checks.length,errors},null,2))
}catch(e){console.error((await page.locator('body').innerText()).slice(-2500));await page.screenshot({path:out+'/intake-failure.png',fullPage:true});throw e}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));db.close()}
