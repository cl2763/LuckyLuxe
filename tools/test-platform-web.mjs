import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto'
import {mkdtempSync,openSync,closeSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,''),out=root+'/handoff/12t-web-ready-evidence';
const dir=mkdtempSync('/tmp/ll-ci-data.platform-ui-'),profile=mkdtempSync('/tmp/ll-platform-chrome-'),port=4339,cp=9340,base=`http://127.0.0.1:${port}`;
const owner='p0-ui-owner-test-only',initial='p0-ui-initial-test-only',password=randomBytes(16).toString('hex');
const fd=openSync(dir+'/server.log','w');
const server=spawn(process.execPath,['local-server.mjs'],{cwd:root+'/apps/api',env:{PATH:process.env.PATH,HOME:process.env.HOME,DATA_DIR:dir,HOST:'127.0.0.1',PORT:String(port),OWNER_TOKEN:owner,ALLOW_DEMO_ADMIN_LOGIN:'false',WECHAT_APP_SECRET:'configured-test-placeholder',WECHAT_MINI_TOKEN_SECRET:'p0-ui-mini-test-only',NOTIFY_TICK:'off',PLATFORM_ADMIN_BOOTSTRAP:'1',PLATFORM_ADMIN_INITIAL_PASSWORD:initial},stdio:['ignore',fd,fd]});
const accounts={};
let chrome,ws,dialogTimer,handlingDialog=false,n=0;const failures=[],dialogs=[],errors=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function check(name,ok,detail=''){n++;console.log(`${ok?'ok':'not ok'} ${n} - ${name}${!ok?' :: '+detail:''}`);if(!ok)failures.push(name)}
async function api(path,body,method=body?'POST':'GET'){const r=await fetch(base+path,{method,headers:{authorization:'Bearer '+owner,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}}
let serial=0;const pending=new Map();
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},12000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))});
async function ev(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value}
async function wait(name,expression){for(let i=0;i<80;i++){if(await ev(`Boolean(${expression})`))return;await sleep(100)}throw Error('等待失败 '+name+': '+await ev('document.body.innerText.slice(-600)'))}
async function click(selector){await ev(`document.querySelector(${JSON.stringify(selector)}).click()`)}
async function fill(selector,value){await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`)}
async function shot(name){const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(out+'/'+name+'.png',Buffer.from(r.data,'base64'))}
try{
 for(let i=0;i<80;i++){try{if((await fetch(base+'/health')).ok)break}catch{}await sleep(100)}
 for(const id of ['ui-a','ui-b'])accounts[id]=(await api('/platform/tenants',{id,name:id==='ui-a'?'网页测试甲店':'网页测试乙店',plan:'chain',currency:'CNY',timezone:'Asia/Shanghai'})).data.owner;
 chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',[`--remote-debugging-port=${cp}`,`--user-data-dir=${profile}`,'--headless=new','--no-first-run','--no-default-browser-check','--window-size=1440,1000','about:blank'],{stdio:'ignore'});
 let target;for(let i=0;i<80;i++){try{target=(await fetch(`http://127.0.0.1:${cp}/json/list`).then(r=>r.json())).find(x=>x.type==='page');if(target)break}catch{}await sleep(100)}
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}}else if(m.method==='Page.javascriptDialogOpening'){const answer=dialogs.shift();if(answer===undefined){errors.push('未预期弹窗:'+m.params.message);send('Page.handleJavaScriptDialog',{accept:false}).catch(()=>{})}else{send('Page.handleJavaScriptDialog',{accept:answer!==null,...(typeof answer==='string'?{promptText:answer}:{})}).catch(x=>errors.push(x.message))}}else if(m.method==='Runtime.exceptionThrown'){errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text)}};
 dialogTimer=setInterval(async()=>{if(handlingDialog||!ws||ws.readyState!==1)return;handlingDialog=true;try{const kind=await ev("(()=>{const d=document.querySelector('.ui-dialog-overlay');return d?(d.querySelector('input')?'text':'confirm'):null})()");if(kind&&dialogs.length){const answer=dialogs.shift();if(kind==='text'&&answer!==null)await fill('.ui-dialog-input',String(answer));await click(answer===null?'.ui-dialog-overlay [data-uid=cancel]':'.ui-dialog-overlay [data-uid=ok]')}}catch(e){errors.push(e.message)}finally{handlingDialog=false}},100);
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:base+'/platform'});await wait('登录表单',"document.querySelector('#pfUser')");
 await fill('#pfUser','platform-admin');await fill('#pfPass',initial);dialogs.push(password);await click('#loginWrap button');await wait('首登改密后首页',"!document.querySelector('#app').classList.contains('hidden') && document.querySelector('#quickRows').innerText.includes('网页测试甲店')");
 check('真实网页登录与首登改密进入首页',true);
 await click("#quickRows button[onclick*=\"ui-a\"]");await wait('甲店配置',"document.querySelector('#stName').value==='网页测试甲店' && !document.querySelector('#stName').disabled");
 check('指定店进入配置且五步进度可见',await ev("document.querySelector('#cfgTenant').value==='ui-a'&&document.querySelectorAll('#configSteps button').length===5&&[...document.querySelectorAll('#configSteps b')].map(e=>e.textContent).join(',')==='建店,经营规则,老板账号,企微接入,上线检查'"));
 await fill('#stName','网页测试甲店·新店名');await fill('#stAddr','上海隔离验收路 101 号');await fill('#stPhone','01012345678');await click('#tab-store button');await wait('保存读回',"document.querySelector('#toast').textContent.includes('已保存并同步')");
 let a=(await api('/platform/tenants/ui-a/store')).data.store,b=(await api('/platform/tenants/ui-b/store')).data.store;
 check('网页保存真实写入甲店，乙店保持原样',a.name==='网页测试甲店·新店名'&&a.phone==='01012345678'&&b.name==='网页测试乙店'&&!b.phone);
 check('保存后进度灯即时更新',await ev("!document.querySelector('#configSteps button').innerText.includes('还差')"));
 check('配置卡片宽度不超过900',await ev("document.querySelector('#tab-store').getBoundingClientRect().width<=900"));
 await click("#configSteps button[onclick*=\"wecom\"]");await wait('企微页',"document.querySelector('#tab-wecom').offsetParent!==null");await fill('#cfgKfid','kf-ui-a');await click('#tab-wecom button');await wait('客服号读回',"document.querySelector('#cfgKfid').value==='kf-ui-a'&&!document.querySelector('#cfgKfid').disabled");
 check('进度灯直达客服配置并保存', (await api('/platform/tenants/ui-a/wecom-kfid')).data.openKfid==='kf-ui-a');
 await fill('#cfgTenant','ui-b');await wait('乙店读取完成',"document.querySelector('#stName').value==='网页测试乙店'&&!document.querySelector('#stName').disabled");
 check('换店保留当前标签且不带出前店客服号',await ev("document.querySelector('#tab-wecom').offsetParent!==null&&document.querySelector('#cfgKfid').value===''") );
 await fill('#cfgTenant','ui-a');await wait('回甲店',"document.querySelector('#stName').value==='网页测试甲店·新店名'&&!document.querySelector('#stName').disabled");
 await click("button[data-tab='serviceImport']");const csv='大类,项目名,价格,分享价,会员价,时长\n美甲,网页导入服务,360,320,288,90';await fill('#svcImportText',csv);await click("#tab-serviceImport button[onclick='previewServiceImport()']");await wait('价目试跑',"!document.querySelector('#svcImportExecute').disabled");
 check('网页价目试跑不创建项目',(await api('/platform/tenants/ui-a/services')).data.services.length===0);
 await fill('#svcImportText',csv+'\n');check('编辑价目后必须重新试跑',await ev("document.querySelector('#svcImportExecute').disabled"));
 await click("#tab-serviceImport button[onclick='previewServiceImport()']");await wait('重新试跑',"!document.querySelector('#svcImportExecute').disabled");dialogs.push(true);await click('#svcImportExecute');await wait('价目完成',"document.querySelector('#svcImportReport').innerText.includes('导入完成')");
 check('网页确认导入落库且不串乙店',(await api('/platform/tenants/ui-a/services')).data.services.length===1&&(await api('/platform/tenants/ui-b/services')).data.services.length===0);
 await shot('platform-service-import');
 const untouchedHoursB=JSON.stringify((await api('/platform/tenants/ui-b/business-hours')).data.hours);
 await click("button[data-tab='hours']");
 for(const w of [0,1,2,3,4,5,6]){if(!await ev(`document.querySelector('#hourRows tr[data-w="${w}"] .hopen').checked`))await click(`#hourRows tr[data-w="${w}"] .hopen`);await fill(`#hourRows tr[data-w="${w}"] .hstart`,'08:00');await fill(`#hourRows tr[data-w="${w}"] .hend`,'22:00')}
 await click("button[onclick='saveHours()']");await wait('营业保存',"document.querySelector('#toast').textContent.includes('营业时间已保存')");
 check('网页营业时间保存七天读回且不串店',(await api('/platform/tenants/ui-a/business-hours')).data.hours.every(h=>h.openTime==='08:00'&&h.closeTime==='22:00'&&!h.isClosed)&&JSON.stringify((await api('/platform/tenants/ui-b/business-hours')).data.hours)===untouchedHoursB);
 await click("button[data-tab='techs']");await fill('#techName','网页验收技师');await fill('#techTitle','验收专用');await click("button[onclick='addTech()']");await wait('新增技师读回',"document.querySelector('#techRows').innerText.includes('网页验收技师')&&!document.querySelector('#techName').disabled");
 await click('#techRows button');await wait('技师停用读回',"document.querySelector('#techRows button').innerText==='启用'&&!document.querySelector('#techName').disabled");check('网页停用技师真实生效',(await api('/platform/tenants/ui-a/technicians')).data.technicians[0].is_active===0);
 await click('#techRows button');await wait('技师恢复',"document.querySelector('#techRows button').innerText==='停用'&&!document.querySelector('#techName').disabled");
 await click("button[data-tab='member']");await fill('#mbQualify','total_spend');await fill('#mbQualifyValue','12.50');await click("button[onclick='saveMembership()']");await wait('会员保存',"document.querySelector('#toast').innerText.includes('会员制度已保存')");
 check('会员门槛12.50保存及回显不四舍五入为13',(await api('/platform/tenants/ui-a/membership-config')).data.config.qualifyValueCents===1250&&await ev("document.querySelector('#mbQualifyValue').value==='12.5'"));
 await click("button[data-tab='kb']");await fill('#kbBrand','网页甲店品牌');await fill('#kbAssistant','验收助手');await click("button[onclick='saveFacts()']");await wait('品牌保存',"document.querySelector('#toast').innerText.includes('品牌事实已保存')");
 check('知识库只保存可编辑字段，去掉无效定金币种输入',(await api('/platform/tenants/ui-a/kb')).data.facts.assistantName==='验收助手'&&await ev("!document.querySelector('#kbDeposit')&&!document.querySelector('#kbCurrency')"));
 await fill('#kbQ','验收营业问题');await fill('#kbA','请查看本店营业时间');await click("button[onclick='addEntry()']");await wait('问答新增',"document.querySelector('#kbRows').innerText.includes('验收营业问题')&&!document.querySelector('#kbQ').disabled");
 await click('#kbRows button');await wait('问答停用',"document.querySelector('#kbRows button').innerText==='启用'&&!document.querySelector('#kbQ').disabled");check('知识库问答新增停用实际生效',(await api('/platform/tenants/ui-a/kb')).data.entries[0].enabled===false);
 dialogs.push(true);await click('#kbRows button.d');await wait('问答删除',"document.querySelector('#kbRows').innerText.includes('还没有问答条目')&&!document.querySelector('#kbQ').disabled");
 check('知识库问答删除本店读回为空',(await api('/platform/tenants/ui-a/kb')).data.entries.length===0);
 await click("button[data-tab='cats']");await fill('#catName',"验收'分类");await fill('#catKey','ui-check');await click("button[onclick='addCat()']");await wait('大类新增',"document.querySelector('#catRows').innerText.includes('ui-check')&&!document.querySelector('#catName').disabled");
 dialogs.push(true);await ev("[...document.querySelectorAll('#catRows tr')].find(r=>r.innerText.includes('ui-check')).querySelector('button').click()");await wait('特殊字符分类删除',"!document.querySelector('#catRows').innerText.includes('ui-check')&&!document.querySelector('#catName').disabled");check('大类含单引号仍可弹层确认删除',true);

 await click("button[data-page='merchants']");dialogs.push(null);await ev("[...document.querySelectorAll('#tenantRows tr')].find(r=>r.innerText.includes('ui-a')).querySelector('button[onclick*=setAi]').click()").then(()=>{},e=>{throw e});
 await wait('取消关闭弹层',"!document.querySelector('.ui-dialog-overlay')");
 check('取消关闭AI不改变权限',(await api('/platform/tenants')).data.tenants.find(t=>t.id==='ui-a').aiEnabled===true);
 dialogs.push(true,'网页验收关闭原因');await ev("[...document.querySelectorAll('#tenantRows tr')].find(r=>r.innerText.includes('ui-a')).querySelector('button[onclick*=setAi]').click()");await wait('AI关闭',"[...document.querySelectorAll('#tenantRows tr')].find(r=>r.innerText.includes('ui-a')).innerText.includes('AI 包:未开通')");
 check('网页AI关闭并同步两页',(await api('/platform/billing')).data.tenants.find(t=>t.id==='ui-a').ai.enabled===false);
 dialogs.push('网页验收开启原因','');await ev("[...document.querySelectorAll('#tenantRows tr')].find(r=>r.innerText.includes('ui-a')).querySelector('button[onclick*=setAi]').click()");await wait('AI开启',"[...document.querySelectorAll('#tenantRows tr')].find(r=>r.innerText.includes('ui-a')).innerText.includes('AI 包:已开通')");
 check('网页AI可重新开启且默认长期',(await api('/platform/billing')).data.tenants.find(t=>t.id==='ui-a').ai.expiresAt===null);

 await click("button[data-page='merchants']");await fill('#mName','网页新建丙店');await fill('#mCurrency','CAD');await fill('#mTz','America/Toronto');await fill('#mId','ui-c');await fill('#mTerm','forever');await click("button[onclick='createTenant()']");
 await wait('网页创建丙店',"document.querySelector('#tenantRows').innerText.includes('ui-c')");
 check('网页建店正确带入币种时区与长期授权',(await api('/platform/tenants/ui-c/store')).data.store.currency==='CAD'&&(await api('/platform/tenants/ui-c/store')).data.store.timezone==='America/Toronto'&&(await api('/platform/tenants')).data.tenants.find(t=>t.id==='ui-c').planExpiresAt===null);
 const rowButton=async(id,fn)=>ev(`(()=>{const row=[...document.querySelectorAll('#tenantRows tr')].find(r=>r.innerText.includes(${JSON.stringify(id)}));const b=row.querySelector('button[onclick*="${fn}"]');if(!b.offsetParent)row.querySelector('button[onclick*=toggleMore]').click();b.click()})()`);
 dialogs.push('网页新建丙店','仅隔离环境密码重置验收',true);await rowButton('ui-c','resetOwnerPw');await wait('密码重置回显关闭',"!document.querySelector('.ui-dialog-overlay')&&document.querySelector('#tenantRows').innerText.includes('ui-c')");await sleep(500);
 const proofDb=new DatabaseSync(dir+'/lucky-luxe.sqlite',{readOnly:true});check('平台重置密码完成且有操作记录',dialogs.length===0&&proofDb.prepare("SELECT COUNT(*) n FROM platform_ops_log WHERE tenant_id=? AND action='owner_password_reset'").get('ui-c').n===1);proofDb.close();
 dialogs.push(true);await rowButton('ui-c','toggleTenant');await wait('停用丙店',"[...document.querySelectorAll('#tenantRows tr')].find(r=>r.innerText.includes('ui-c')).querySelector('button[onclick*=toggleTenant]').textContent==='启用'");
 check('网页停用只作用于丙店',(await api('/platform/tenants')).data.tenants.find(t=>t.id==='ui-c').status!=='active'&&(await api('/platform/tenants')).data.tenants.find(t=>t.id==='ui-a').status==='active');
 dialogs.push(true);await rowButton('ui-c','toggleTenant');await wait('恢复丙店',"[...document.querySelectorAll('#tenantRows tr')].find(r=>r.innerText.includes('ui-c')).querySelector('button[onclick*=toggleTenant]').textContent==='停用'");
 await click("button[data-page='billing']");await wait('计费列表',"document.querySelector('#billRows').innerText.includes('ui-c')");
 const bill=()=>"[...document.querySelectorAll('#billRows tr')].find(r=>r.innerText.includes('ui-c'))";
 await ev(`${bill()}.querySelector('input[type=date]').value='2030-10-07';${bill()}.querySelector('input[type=date]').dispatchEvent(new Event('change',{bubbles:true}))`);await wait('计费到期日保存',`${bill()}.querySelector('input[type=date]').value==='2030-10-07'&&document.querySelector('#toast').innerText.includes('到期日已设')`);
 check('计费日期框实际取消长期并保存日期',(await api('/platform/billing')).data.tenants.find(t=>t.id==='ui-c').planExpiresAt==='2030-10-08T03:59:00.000Z');
 dialogs.push(true);await ev(`${bill()}.querySelector('button[onclick*=setPerpetual]').click()`);await wait('计费恢复长期',`${bill()}.innerText.includes('长期')&&!${bill()}.querySelector('input[type=date]').value`);
 check('明确确认后才能恢复长期',(await api('/platform/billing')).data.tenants.find(t=>t.id==='ui-c').planExpiresAt===null);
 await ev(`${bill()}.querySelector('select').value='studio';${bill()}.querySelector('select').dispatchEvent(new Event('change',{bubbles:true}))`);await wait('套餐保存',"document.querySelector('#toast').innerText.includes('档位已更新')");
 check('套餐下拉实际保存到所选店',(await api('/platform/billing')).data.tenants.find(t=>t.id==='ui-c').plan==='studio');
 await click("button[data-page='kb']");await wait('通用知识库载入',"document.querySelector('#kbpCount').innerText.includes('共')");await fill('#kbpKind','rule');await fill('#kbpContent','网页验收独立通用规则');await click("button[onclick='kbpAdd()']");await wait('通用规则新增',"document.querySelector('#kbpRows').innerText.includes('网页验收独立通用规则')");
 const kbRow=()=>"[...document.querySelectorAll('#kbpRows tr')].find(r=>r.innerText.includes('网页验收独立通用规则'))";
 dialogs.push('网页验收独立通用规则改后');await ev(`${kbRow()}.querySelector('button').click()`);await wait('通用规则修改',"document.querySelector('#kbpRows').innerText.includes('网页验收独立通用规则改后')");
 await ev(`${kbRow()}.querySelector('button[onclick*=kbpToggle]').click()`);await wait('通用规则停用',`${kbRow()}.querySelector('button[onclick*=kbpToggle]').innerText==='启用'`);
 check('通用知识库新增修改停用均真实生效',(await api('/platform/kb')).data.entries.some(e=>e.content==='网页验收独立通用规则改后'&&!e.enabled));
 dialogs.push(true);await ev(`${kbRow()}.querySelector('button[onclick*=kbpDel]').click()`);await wait('通用规则删除',"!document.querySelector('#kbpRows').innerText.includes('网页验收独立通用规则')");
 check('通用知识库删除确认后实际移除',!(await api('/platform/kb')).data.entries.some(e=>e.content==='网页验收独立通用规则改后'));
 await click("button[data-page='import']");await fill('#impTenant','ui-a');await fill('#impCsv','姓名,手机号,余额\n网页测试顾客,13800001234,12.50');await click("button[onclick='runImportDry()']");await wait('顾客试跑',"!document.querySelector('#impReportCard').classList.contains('hidden')");await fill('#impTenant','ui-b');
 check('顾客导入换店后旧试跑失效',await ev("document.querySelector('#impReportCard').classList.contains('hidden')&&!document.querySelector('#impConfirm').checked"));
 await fill('#impCsv','姓名,手机号,余额\n网页测试顾客,13800001234,-12.50');await click("button[onclick='runImportDry()']");await wait('负金额明确拒绝',"document.querySelector('#toast').innerText.includes('金额须为非负数')");check('负余额不会静默转换成正数',true);
 await fill('#impTenant','ui-c');await fill('#impCsv','姓名,手机号,余额\n网页导入验收客,13800001235,12.50');await click("button[onclick='runImportDry()']");await wait('丙店顾客试跑',"!document.querySelector('#impReportCard').classList.contains('hidden')");await click('#impConfirm');dialogs.push(true);await click("button[onclick='runImportExec()']");await wait('顾客导入执行成功',"document.querySelector('#impResult').innerText.includes('新建')");
 const importDb=new DatabaseSync(dir+'/lucky-luxe.sqlite',{readOnly:true});check('网页顾客导入确认后写入丙店且不串甲店',importDb.prepare('SELECT COUNT(*) n FROM users WHERE tenant_id=? AND display_name=?').get('ui-c','网页导入验收客').n===1&&importDb.prepare('SELECT COUNT(*) n FROM users WHERE tenant_id=? AND display_name=?').get('ui-a','网页导入验收客').n===0);importDb.close();
 check('加币店顾客导入金额回显使用本店币种',await ev("document.querySelector('#impResult').innerText.includes('12.50')&&!document.querySelector('#impResult').innerText.includes('¥')"));
 await click("button[onclick='logout()']");await wait('退出登录',"document.querySelector('#loginWrap').offsetParent!==null&&!document.querySelector('#pfUser').value");
 await send('Page.reload');await wait('刷新仍未登录',"document.querySelector('#loginWrap')&&document.querySelector('#loginWrap').offsetParent!==null");
 check('记住设备后退出及刷新仍需登录',await ev("document.querySelector('#app').classList.contains('hidden')"));
 // 平台刚配置的同一家店，通过真实商家登录验证订单动作。
 const store=(await api('/platform/tenants/ui-a/store')).data.store;
 const adminApi=async(path,body)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+owner,'x-admin-tenant-id':'ui-a','content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}};

 const svc=(await api('/platform/tenants/ui-a/services')).data.services[0];
 const tech=(await api('/platform/tenants/ui-a/technicians')).data.technicians[0];
 const booking=(await adminApi('/admin/bookings/direct',{newCustomerName:'网页改期验收客',storeId:store.id,serviceId:svc.id,technicianId:tech.id,date:'2030-10-07',time:'10:00'})).data.booking;
 if(!booking)throw Error('网页预约夹具创建失败');
 await send('Page.navigate',{url:base+'/admin'});await wait('商家登录',"document.querySelector('#ownerLoginForm')");
 await fill('#ownerLoginForm input[name=email]',accounts['ui-a'].username);await fill('#ownerLoginForm input[name=password]',accounts['ui-a'].initialPassword);await click('#ownerLoginButton');
 await wait('商家首登改密',"document.querySelector('#forceOldPass')");await fill('#forceOldPass',accounts['ui-a'].initialPassword);await fill('#forceNewPass','P0-merchant-changed-only');await fill('#forceNewPass2','P0-merchant-changed-only');await click('[data-force-pass-submit]');
 await wait('商家首页',"document.querySelector('#sidebarBookings').offsetParent!==null&&!document.querySelector('#forceOldPass')");check('平台配置的店铺可通过真实商家账号进入网页',true);
 await click('#sidebarBookings');await click('#allTab');await fill('#filterDate','2030-10-07');
 const moveSelector=`[data-booking="${booking.id}"][data-booking-action="reschedule"]`;
 await wait('订单改期按钮',`document.querySelector(${JSON.stringify(moveSelector)})`);
 await click(moveSelector);await wait('改期弹层',"document.querySelector('[data-fm-field=time]')");await fill('[data-fm-field=time]','16:00');await click('[data-fm-cancel]');
 let read=(await adminApi('/admin/bookings')).data.bookings.find(b=>b.id===booking.id);
 check('网页取消改期弹层不改变预约',read.appointmentTime==='10:00');
 await click(moveSelector);await wait('重新打开改期',"document.querySelector('[data-fm-field=time]')");await fill('[data-fm-field=time]','16:00');await fill('[data-fm-field=reason]','网页实际点击验收');await click('[data-fm-save]');
 await wait('改期完成',"!document.querySelector('.form-modal-overlay')");
 read=(await adminApi('/admin/bookings')).data.bookings.find(b=>b.id===booking.id);
 check('网页确认改期实际写入同一预约，时长价格不变',read.appointmentTime==='16:00'&&read.totalDurationMin===90&&read.servicePriceCents===booking.servicePriceCents);
 await shot('merchant-reschedule');
 await click('#todayTab');await wait('网页今日台面',"document.querySelector('[data-tb-next]')");await click('[data-tb-next]');await wait('明日空档',"document.querySelector('[data-tb-free]')");await click('[data-tb-free]');await wait('网页直接排单表单',"document.querySelector('[data-tbf-q]')");
 await fill('[data-tbf-q]','网页完整建档排单客');await wait('新客说明',"document.querySelector('.sw-hint-line')?.innerText.includes('网页完整建档排单客')");await click('[data-tbf-submit]');
 await wait('网页排单成功跳转',"!document.querySelector('[data-tbf-submit]')&&document.querySelector('#bookingList').innerText.includes('网页完整建档排单客')");
 const direct=(await adminApi('/admin/bookings')).data.bookings.find(b=>b.user?.display_name==='网页完整建档排单客');
 check('网页直接建新客并排单，平台服务时长与未收定金正确带入',Boolean(direct?.user?.id)&&direct.totalDurationMin===90&&direct.depositCents===0&&direct.status==='CONFIRMED');
 await shot('merchant-new-customer-booking');
 const settleSelector=`[data-settle-booking="${direct.id}"]`;await wait('网页去结算按钮',`document.querySelector(${JSON.stringify(settleSelector)})`);await click(settleSelector);await wait('开单表单',"document.querySelector('[data-sw-submit]')");
 if(!await ev("document.querySelector('[data-sw-tech].on')"))await click('[data-sw-tech]');
 await click('[data-sw-submit]');await wait('生成待签结算单',"document.querySelector('.sw-pending')");
 const settleDb=new DatabaseSync(dir+'/lucky-luxe.sqlite',{readOnly:true});const sheets=settleDb.prepare('SELECT code,status,total_cents FROM settlements WHERE booking_id=?').all(direct.id);check('网页开单真实生成待签单，顾客未签前不标为已签',sheets.length===1&&sheets[0].status==='pending_sign');settleDb.close();await shot('merchant-pending-settlement');


 // 真实页面从商家出链接到顾客笔迹签署；只将已读到的链接映射回同一隔离测试服务。
 if(await ev("Boolean(document.querySelector('[data-sn-close]'))"))await click('[data-sn-close]');
 await click('[data-sw-sign-link]');await wait('商家出示顾客链接',"document.querySelector('[data-sw-sign-url]')");
 const signUrl=await ev("document.querySelector('[data-sw-sign-url]').value");const link=new URL(signUrl);
 check('商家能生成本单顾客链接且不宣称微信已推送',link.pathname==='/sign'&&Boolean(link.searchParams.get('t'))&&await ev("!document.querySelector('#settlementComposer').innerText.includes('已推送到顾客小程序')"));
 await shot('merchant-sign-link');
 await send('Page.navigate',{url:base+'/sign/'+encodeURIComponent(sheets[0].code)+'?actor=merchant'});await wait('顾客签署页',"document.querySelector('#signerConfirmed')&&document.querySelector('#pad')");
 check('商家旧单号入口可凭当前会话自动换签署链接',await ev("Boolean(new URLSearchParams(location.search).get('t'))"));
 check('未绑微信顾客不会被强制绑定拦住',await ev("!document.querySelector('#claimBtn')&&document.body.innerText.includes('签字不会自动绑定微信')"));
 await click('#signBtn');await wait('本人核对提示',"document.querySelector('#signTip').innerText.includes('核对')");
 await click('#signerConfirmed');await click('#disc');
 await ev("document.querySelector('#pad').scrollIntoView({block:'center'})");
 const box=await ev("(()=>{const r=document.querySelector('#pad').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()");
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x:box.x+30,y:box.y+35,button:'left',clickCount:1});
 for(const [dx,dy] of [[55,70],[90,35],[130,85],[170,45]])await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:box.x+dx,y:box.y+dy,button:'left',buttons:1});
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:box.x+170,y:box.y+45,button:'left',clickCount:1});
 await shot('customer-sign-ready');await click('#signBtn');await wait('顾客签署成功',"document.querySelector('.done')?.innerText.includes('签署完成')");
 const signedDb=new DatabaseSync(dir+'/lucky-luxe.sqlite',{readOnly:true});const signedRow=signedDb.prepare('SELECT status,signature_data,snapshot_inline FROM settlements WHERE booking_id=?').get(direct.id);
 check('页面实际手写并签署成功，原预约完成',signedRow.status==='signed'&&Boolean(signedRow.signature_data)&&signedDb.prepare('SELECT status FROM bookings WHERE id=?').get(direct.id).status==='COMPLETED');
 check('网页签字后仍如实未绑定微信',!signedDb.prepare('SELECT wechat_open_id FROM users WHERE id=?').get(direct.user.id).wechat_open_id);
 signedDb.close();await shot('customer-signed');
 await wait('已签笔迹正常显示',"document.querySelector('img.ink')?.naturalWidth>0");
 check('已签凭证和签名图片都用限时只读地址',await ev("document.querySelector('img.ink').src.includes('view=')&&document.querySelector('.done a').href.includes('view=')"));
 await send('Page.navigate',{url:base+'/admin'});await wait('回商家订单入口',"document.querySelector('#sidebarBookings')?.offsetParent!==null");await click('#sidebarBookings');await click('#allTab');
 await fill('#filterDate',direct.appointmentDate);await wait('商家读回已签完成',`document.querySelector("#bk-${direct.id} .status")?.innerText==='已完成'`);check('网页商家返回后可见原单已完成',true);await shot('merchant-after-sign');


 // 老顾客网页旧入口，以及员工真实登录/首登改密/只读客档/服务小记。
 const loginResponse=await fetch(base+'/auth/wechat/mini-login',{method:'POST',headers:{'content-type':'application/json','x-tenant-id':'ui-a'},body:JSON.stringify({code:'stub:web-entry-customer',tenantId:'ui-a'})});const customer=await loginResponse.json();
 const cb=(await adminApi('/admin/bookings/direct',{userId:customer.user.id,serviceId:svc.id,technicianId:tech.id,date:'2030-10-08',time:'10:00'})).data.booking;
 const cs=(await adminApi('/admin/settlements',{cardOwnerUserId:customer.user.id,settlements:[{bookingId:cb.id,tierKey:'list',payIntent:'offline_full',items:[{serviceId:svc.id}],technicians:[{technicianId:tech.id,share:100}]}]})).data.settlements[0];
 await ev(`localStorage.setItem('lucky-web-tenant','ui-a');localStorage.setItem('lucky-web-auth',JSON.stringify({__tenant:'ui-a',__value:${JSON.stringify(customer.auth)}}))`);
 await send('Page.navigate',{url:base+'/sign/'+cs.code});await wait('顾客旧入口',"document.querySelector('#signerConfirmed')");check('网页顾客旧入口用本人会话成功换链接',await ev("location.search.includes('t=')"));
 const staff=(await adminApi('/admin/staff-accounts',{technicianId:tech.id})).data;
 await send('Page.navigate',{url:base+'/admin'});await wait('商家退出按钮',"document.querySelector('#ownerLogout')?.offsetParent!==null");await click('#ownerLogout');await wait('员工登录表单',"document.querySelector('#ownerLoginForm')?.offsetParent!==null");await click('#loginTabStaff');
 await fill('#ownerLoginForm input[name=email]',staff.username);await fill('#ownerLoginForm input[name=password]',staff.initialPassword);await click('#ownerLoginButton');
 await wait('员工首登改密',"document.querySelector('#forceOldPass')");await fill('#forceOldPass',staff.initialPassword);await fill('#forceNewPass','P0-staff-password-test');await fill('#forceNewPass2','P0-staff-password-test');await click('[data-force-pass-submit]');
 await wait('员工菜单',"document.querySelector('#sidebarMyCustomers')?.offsetParent!==null&&!document.querySelector('#forceOldPass')");
 check('员工真实登录改密后隐藏老板财务与配置入口',await ev("['#sidebarFinance','#sidebarStoreSettings','#sidebarMembership'].every(s=>document.querySelector(s).offsetParent===null)"));
 await click('#sidebarMyCustomers');await wait('员工已服务客档',`document.querySelector('[data-my-customer="${direct.user.id}"]')`);await click(`[data-my-customer="${direct.user.id}"]`);await wait('服务小记表单',"document.querySelector('#myNoteBody')");
 check('员工能打开自己服务的顾客，客档无充值退卡按钮',await ev("document.querySelector('#myCustomersPage').innerText.includes('网页完整建档排单客')&&![...document.querySelectorAll('#myCustomersPage button')].some(b=>/充值|退卡|改余额/.test(b.innerText))"));
 await fill('#myNoteBody','网页员工验收：顾客偏好自然短甲。');await click('[data-my-note]');await wait('小记保存读回',"[...document.querySelectorAll('#myCustomersPage .info-card-web p')].some(e=>e.innerText==='网页员工验收：顾客偏好自然短甲。')");check('员工网页可保存服务小记并立即读回',true);
 await click('#sidebarStaffWorkbench');await wait('员工工作台报价项目',"document.querySelector('[data-swb-item]')");await click('[data-swb-item]');await wait('员工试算返回',"document.querySelector('#staffWorkbenchPage').innerText.includes('360')");check('员工工作台可加载自己的排班业绩与服务报价',await ev("document.querySelector('#staffWorkbenchPage').innerText.includes('我的业绩')&&document.querySelector('#staffWorkbenchPage').innerText.includes('我的排班')"));await shot('staff-workbench');

 check('浏览器流程无未处理异常及遗留弹窗',errors.length===0&&dialogs.length===0,JSON.stringify(errors));
}catch(e){check('流程完整执行',false,e.stack)}finally{clearInterval(dialogTimer);ws?.close();chrome?.kill('SIGTERM');server.kill('SIGTERM');await Promise.all([chrome,server].filter(Boolean).map(p=>p.exitCode!==null?Promise.resolve():new Promise(r=>p.once('exit',r))));closeSync(fd);rmSync(profile,{recursive:true,force:true});if(!failures.length)rmSync(dir,{recursive:true,force:true});else console.log('失败现场:'+dir);writeFileSync(out+'/platform-ui-result.json',JSON.stringify({checks:n,failures,errors},null,2))}
console.log(`${n} checks; ${failures.length} failures`);process.exitCode=failures.length?1:0;
