import { createRequire } from 'node:module'
const realRequire = createRequire(import.meta.url)
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {randomBytes} from 'node:crypto'
const source=readFileSync(new URL('../../miniprogram/pages/sign/index.js',import.meta.url),'utf8')
let n=0;const fails=[]
const check=(name,ok)=>{console.log(`${ok?'ok':'not ok'} ${++n} - ${name}`);if(!ok)fails.push(name)}
function setup({sandbox=false,fail=false,scene='',base='http://127.0.0.1:4349',link='https://app.example.test/sign?t=short-lived-test-token'}={}){
 let page;const calls=[],modals=[],titles=[],toasts=[],redirects=[]
 const api={SANDBOX:sandbox,API_BASE:base,getDocumentLink:async code=>({url:'/settlements/'+encodeURIComponent(code)+'/snapshot?view=read-only'}),adminPost:async path=>{calls.push(path);return {url:'https://app.example.test/sign?t=merchant-test-token'}},getSignLink:async code=>{calls.push(code);if(fail)throw Error('找不到本人的服务单');return {url:link,scene}}}
 vm.runInNewContext(source,{require:p=>p.endsWith('/theme')?{chromeOf:()=>({eff:'dark'})}:api,Page:p=>{page=p},wx:{showModal:o=>modals.push(o),showToast:o=>toasts.push(o),setNavigationBarTitle:o=>titles.push(o),redirectTo:o=>redirects.push(o)}})
 page.data={...page.data};page.setData=v=>Object.assign(page.data,v)
 return {page,calls,modals,titles,toasts,redirects}
}
let t=setup();await t.page.onLoad({code:'A%2F01'})
check('小程序按本人单号换取短时链接',t.calls[0]==='A/01'&&t.page.data.url==='https://app.example.test/sign?t=short-lived-test-token&theme=dark')
check('正式环境保留后端给出的门店域名',t.titles[0]?.title==='服务确认单'&&!t.page.data.url.includes('127.0.0.1'))
for (const host of ['www.luckyluxeatelier.com','app.jingshengyouji.com']) {
 t=setup({base:'https://api.jingshengyouji.com',link:'https://'+host+'/sign?t=short'});await t.page.onLoad({code:'A'});check('正式签署使用已验证业务域名 '+host,t.page.data.url==='https://api.jingshengyouji.com/sign?t=short&theme=dark')
}
t=setup({sandbox:true});await t.page.onLoad({code:'A'})
check('沙箱只替换域名并保留签署凭据',t.page.data.url==='http://127.0.0.1:4349/sign?t=short-lived-test-token&theme=dark')
t=setup({sandbox:true,base:'https://api.jingshengyouji.com/experience',link:'https://api.jingshengyouji.com/experience/sign?t=short-lived-test-token'});await t.page.onLoad({code:'A'})
check('独立体验签署链接不重复 /experience 前缀',t.page.data.url==='https://api.jingshengyouji.com/experience/sign?t=short-lived-test-token&theme=dark')
t=setup({sandbox:true,scene:'s123456789012345678901234'});await t.page.onLoad({code:'A'})
check('顾客待签订单先进入微信扫码认领，再打开 web-view',t.redirects[0]?.url==='/pages/scan-entry/index?scene=s123456789012345678901234'&&!t.page.data.url)
t=setup({fail:true});await t.page.onLoad({code:'not-owned'})
check('跨顾客或接口失败明确提示且不打开旧单号地址',!t.page.data.url&&t.modals[0]?.content==='找不到本人的服务单')
t.modals[0].fail();check('错误弹窗失败仍有提示',t.toasts[0]?.title==='签署页暂时打不开，请重试')
t=setup();await t.page.onLoad({snapshot:'A%2F01'})
check('历史凭证入口继续只读、不重新出签署链接',!t.calls.length&&t.page.data.url.endsWith('/settlements/A%2F01/snapshot?view=read-only&theme=dark')&&t.titles[0]?.title==='签署单凭证')
t=setup();await t.page.onLoad({code:'A%2F01',merchant:'1'});check('商家入口使用商家会话按单号出链接',t.calls[0]==='/admin/settlements/A%2F01/sign-token'&&t.page.data.url.endsWith('merchant-test-token&theme=dark'))
t=setup();await t.page.onLoad({})
check('无单号不请求接口、显示原因',!t.calls.length&&!t.page.data.url&&t.toasts[0]?.title==='缺少服务单号')
// 使用真正的 API 模块，验证长期会话只走请求头，未进入 URL 或请求体。
const sessionToken=randomBytes(24).toString('hex');const requests=[],storage={lucky_tenant:'mini-sign-test',lucky_mini_auth:{accessToken:sessionToken,_tenant:'mini-sign-test'}}
const context={module:{exports:{}},require:p=>p.includes('public-catalog-cache')?realRequire('../../miniprogram/utils/public-catalog-cache.js'):p.includes('devhost')?{port:4349,lanHost:'127.0.0.1'}:p.includes('deploy')?{defaultTenantId:''}:{realValue:x=>x},wx:{getDeviceInfo:()=>({platform:'devtools'}),getStorageSync:k=>storage[k],request:o=>{requests.push(o);o.success({statusCode:200,data:{url:'https://app.example.test/sign?t=short'}})}}}
vm.runInNewContext(readFileSync(new URL('../../miniprogram/utils/api.js',import.meta.url),'utf8'),context)
await context.module.exports.getSignLink('A/01');const request=requests[0]
check('API 请求用会话头和门店头，不泄露长期令牌到地址',request.method==='POST'&&request.url.endsWith('/my/settlements/A%2F01/sign-link')&&request.header.authorization===`Bearer ${sessionToken}`&&request.header['x-tenant-id']==='mini-sign-test'&&!JSON.stringify([request.url,request.data]).includes(sessionToken))
context.wx.setStorageSync=(k,v)=>{storage[k]=v};context.wx.removeStorageSync=k=>{delete storage[k]}
storage.lucky_cart=[{from:'previous-store'}]
const boundSession={tenantId:'bound-test-store',auth:{accessToken:'isolated-bound-session'},user:{id:'bound-customer',displayName:'隔离普通顾客',memberCode:'isolated-code',memberTier:'guest',memberLevel:'顾客',isMember:false}}
context.module.exports.acceptCustomerSession(boundSession)
check('绑定成功保存真实会话和本店顾客资料，清除上一店的购物车',storage.lucky_tenant==='bound-test-store'&&storage.lucky_mini_auth?.accessToken==='isolated-bound-session'&&storage.lucky_member?._tenant==='bound-test-store'&&storage.lucky_member?.nickname==='隔离普通顾客'&&!storage.lucky_cart)
check('普通顾客绑定后不被提升为会员',storage.lucky_member?.memberLevel==='顾客'&&storage.lucky_member?.memberTier==='guest')
let badSession=false;try{context.module.exports.acceptCustomerSession({tenantId:'other-store'})}catch{badSession=true}
check('不完整绑定结果被拒，保留已验证的本店会话',badSession&&storage.lucky_tenant==='bound-test-store'&&storage.lucky_mini_auth?.accessToken==='isolated-bound-session')
let bindPage;const bindTimers=[],bindNav=[],accepted=[],bindToasts=[];let bindOut=boundSession
vm.runInNewContext(readFileSync(new URL('../../miniprogram/pages/bind/index.js',import.meta.url),'utf8'),{Page:p=>bindPage=p,require:p=>p.endsWith('/api')?{API_BASE:'http://isolated.test',acceptCustomerSession:o=>accepted.push(o)}:p.endsWith('/nav')?{tab:u=>bindNav.push(u)}:{begin:()=>()=>{}},setTimeout:(f,ms)=>{bindTimers.push({f,ms});return bindTimers.length},clearTimeout:()=>{},wx:{login:o=>o.success({code:'isolated-wechat-code'}),request:o=>o.success({statusCode:200,data:bindOut}),showToast:o=>bindToasts.push(o)}})
bindPage.data={...bindPage.data,token:'isolated-bind-token'};bindPage.setData=v=>Object.assign(bindPage.data,v)
const binding=bindPage.confirm();await bindPage.confirm();await binding
check('顾客绑定成功明确显示完成，并防止双击重复保存会话',bindPage.data.state==='done'&&accepted.length===1&&bindTimers[0]?.ms===1500)
bindTimers[0].f();check('绑定页完成后的自动返回确实进入我的',bindNav[0]==='/pages/me/index')
bindPage.goMe();check('绑定页主动返回按钮同样进入我的',bindNav[1]==='/pages/me/index')
bindOut={conflict:true};await bindPage.confirm()
check('另一档案冲突明确报错，不保存覆盖会话也不跳走',bindPage.data.state==='error'&&bindPage.data.errText.includes('没有覆盖原档案')&&accepted.length===1&&bindNav.length===2)
// 执行签署前置判定与返回动作；接口通过不能代替这两个页面行为。
const html=readFileSync(new URL('../../apps/web/sign.html',import.meta.url),'utf8')
const fn=name=>html.match(new RegExp('function '+name+'\\(\\) \\{[\\s\\S]*?\\n\\}'))?.[0]
let elements={},signState={signToken:'short',hasInk:false,document:{getElementById:id=>elements[id]}}
vm.createContext(signState);vm.runInContext(fn('missingStep'),signState)
elements={claimBtn:{},signerConfirmed:{checked:false},disc:{checked:false}}
check('未绑定时先提示认领档案，不要求点击被锁定的 checkbox',signState.missingStep().key==='claim')
delete elements.claimBtn
check('已绑定后先提示本人服务单声明',signState.missingStep().key==='signerConfirmed')
elements.signerConfirmed.checked=true
check('本人声明通过后仍须勾选账单确认',signState.missingStep().key==='disc')
elements.disc.checked=true
check('两个声明通过但没有笔迹时禁止提交',signState.missingStep().key==='ink')
signState.hasInk=true
check('声明与笔迹完整才允许签署',signState.missingStep()===null)
const switched=[],alerts=[],assigned=[]
const returnState={wx:{miniProgram:{switchTab:o=>switched.push(o)}},window:{},toast:t=>alerts.push(t),location:{assign:u=>assigned.push(u)},signScopePath:p=>'/experience'+p}
returnState.window.wx=returnState.wx;vm.createContext(returnState);vm.runInContext(fn('returnToMe'),returnState);returnState.returnToMe()
check('小程序签完返回顾客我的页',switched[0]?.url==='/pages/me/index')
switched[0].fail();check('返回失败也给出明确反馈',alerts.length===1)
returnState.window.wx=null;returnState.returnToMe()
check('网页签完返回当前环境我的页',assigned[0]==='/experience/?tab=me')
let merchant,timers=[],navs=[],status={state:'signed',text:'已签署'}
const merchantApi={adminGet:async()=>status}
vm.runInNewContext(readFileSync(new URL('../../miniprogram/pages/merchant/settlement/index.js',import.meta.url),'utf8'),{Page:p=>merchant=p,require:p=>p.endsWith('/nav')?{relaunch:u=>navs.push(u)}:p.endsWith('/api')?merchantApi:{},setTimeout:(f,ms)=>{timers.push({f,ms});return timers.length},clearTimeout:()=>{},wx:{showToast:()=>{}}})
merchant.data={qr:{settlementId:'isolated-test'}};merchant.setData=v=>Object.assign(merchant.data,v)
merchant.pollQr();await timers.shift().f();await timers.shift().f()
check('商家收到最终已签状态直接回今日台面',navs[0]==='/pages/merchant/orders/index'&&merchant.data.qr===null)
timers=[];navs=[];merchant.data.qr={settlementId:'isolated-group'};status={state:'signed',nextPendingId:'second'};merchant.openQr=o=>navs.push(o)
merchant.pollQr();await timers.shift().f();await timers.shift().f()
check('多份服务单先接下一份，不提前返回丢失待签单',navs[0]?.id==='second')
// 售后详情中的订单操作必须保留原订单上下文并复用全订单入口。
let orders;const orderToasts=[]
vm.runInNewContext(readFileSync(new URL('../../miniprogram/pages/merchant/orders/index.js',import.meta.url),'utf8'),{Page:p=>orders=p,require:p=>p.endsWith('/storeclock')?{storeToday:()=> '2030-10-07'}:{},wx:{showToast:o=>orderToasts.push(o)}})
const asBooking={id:'as-own',status:'COMPLETED',user:{id:'as-customer',displayName:'原顾客'},service:{id:'as-service',name:'原项目'},technician:{name:'原技师'},afterSalesStatus:'pending'}
orders.data={raw:[asBooking],asPanel:{bookingId:asBooking.id}};orders.setData=v=>Object.assign(orders.data,v)
let actionDataset;orders.orderActions=async e=>{actionDataset=e.currentTarget.dataset}
await orders.afterSalesOrderActions()
check('售后详情直接复用订单操作，保持顾客/项目/状态上下文',orders.data.asPanel===null&&actionDataset.id===asBooking.id&&actionDataset.userid==='as-customer'&&actionDataset.serviceid==='as-service'&&actionDataset.status==='COMPLETED')
orders.data.asPanel={bookingId:'deleted'};actionDataset=null;await orders.afterSalesOrderActions()
check('售后订单已消失时提示刷新，不能误打开别的订单',actionDataset===null&&orderToasts[0]?.title.includes('刷新'))
let detail,footerHeight=112,footerCallback
const query={in:()=>query,select:()=>query,boundingClientRect:f=>{footerCallback=f;return query},exec:()=>footerCallback({height:footerHeight})}
vm.runInNewContext(readFileSync(new URL('../../miniprogram/pages/order-detail/index.js',import.meta.url),'utf8'),{Page:p=>detail=p,require:p=>p.endsWith('/i18n')?{pageCopy:()=>({})}:{},wx:{createSelectorQuery:()=>query}})
detail.data={order:{actions:[{key:'afterSales'}]},bottomInset:0};detail.setData=v=>Object.assign(detail.data,v)
detail.measureBottomBar();check('订单底部留白包含实际底栏与额外间隔，安全区不遮住原件',detail.data.bottomInset>footerHeight)
footerHeight=180;detail.onResize();check('字体缩放或屏幕旋转后按新高度重算留白',detail.data.bottomInset>footerHeight)
detail.data.order.actions=[];detail.measureBottomBar();check('没有底栏动作时清除旧留白',detail.data.bottomInset===0)
let accountPage, accountRole='staff', settingsFail=false;const accountReads=[],accountToasts=[],accountSheets=[]
vm.runInNewContext(readFileSync(new URL('../../miniprogram/pages/merchant/me/index.js',import.meta.url),'utf8'),{Page:p=>accountPage=p,require:p=>p.endsWith('/api')?{adminMe:async()=>({role:accountRole,username:'isolated-account'}),adminGet:async path=>{accountReads.push(path);if(settingsFail)throw Error('offline');return {enabled:true,status:'active',expiresAt:'2030-01-01'}}}:{},wx:{showToast:o=>accountToasts.push(o),showActionSheet:o=>accountSheets.push(o)}})
accountPage.data={...accountPage.data};accountPage.setData=v=>Object.assign(accountPage.data,v)
await accountPage.load();await accountPage.finance()
check('员工账号页不请求老板财务设置，直接调用也明确拒绝',accountReads.length===0&&!accountPage.data.isOwnerRole&&accountToasts[0]?.title==='仅老板可管理财务密码')
accountRole='owner';await accountPage.load()
check('老板账号页读取实际财务启用状态',accountReads.includes('/admin/finance/lock-settings')&&accountPage.data.financeSettingsLoaded&&accountPage.data.financeLockEnabled)
settingsFail=true;await accountPage.load();await accountPage.finance()
check('财务设置读取失败保留未知状态，不能展示默认关闭或启用菜单',!accountPage.data.financeSettingsLoaded&&accountSheets.length===0&&accountToasts.at(-1)?.title==='财务设置读取失败，请重试')
const themeContext={module:{exports:{}},wx:{setStorageSync:()=>{},setNavigationBarColor:o=>themeContext.chrome=o}}
vm.runInNewContext(readFileSync(new URL('../../miniprogram/utils/theme.js',import.meta.url),'utf8'),themeContext)
themeContext.module.exports.setTheme('light')
check('站内切换浅色立即同步原生导航栏，无需离页再进入',themeContext.chrome?.backgroundColor===themeContext.module.exports.CHROME.light.backgroundColor&&themeContext.chrome.frontColor==='#000000')
console.log(`${n} checks; ${fails.length} failures`);process.exitCode=fails.length?1:0
