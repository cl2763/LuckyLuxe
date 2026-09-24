import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {randomBytes} from 'node:crypto'
const source=readFileSync(new URL('../../miniprogram/pages/sign/index.js',import.meta.url),'utf8')
let n=0;const fails=[]
const check=(name,ok)=>{console.log(`${ok?'ok':'not ok'} ${++n} - ${name}`);if(!ok)fails.push(name)}
function setup({sandbox=false,fail=false}={}){
 let page;const calls=[],modals=[],titles=[],toasts=[]
 const api={SANDBOX:sandbox,API_BASE:'http://127.0.0.1:4349',getDocumentLink:async code=>({url:'/settlements/'+encodeURIComponent(code)+'/snapshot?view=read-only'}),adminPost:async path=>{calls.push(path);return {url:'https://app.example.test/sign?t=merchant-test-token'}},getSignLink:async code=>{calls.push(code);if(fail)throw Error('找不到本人的服务单');return {url:'https://app.example.test/sign?t=short-lived-test-token'}}}
 vm.runInNewContext(source,{require:()=>api,Page:p=>{page=p},wx:{showModal:o=>modals.push(o),showToast:o=>toasts.push(o),setNavigationBarTitle:o=>titles.push(o)}})
 page.data={...page.data};page.setData=v=>Object.assign(page.data,v)
 return {page,calls,modals,titles,toasts}
}
let t=setup();await t.page.onLoad({code:'A%2F01'})
check('小程序按本人单号换取短时链接',t.calls[0]==='A/01'&&t.page.data.url==='https://app.example.test/sign?t=short-lived-test-token')
check('正式环境保留后端给出的门店域名',t.titles[0]?.title==='服务确认单'&&!t.page.data.url.includes('127.0.0.1'))
t=setup({sandbox:true});await t.page.onLoad({code:'A'})
check('沙箱只替换域名并保留签署凭据',t.page.data.url==='http://127.0.0.1:4349/sign?t=short-lived-test-token')
t=setup({fail:true});await t.page.onLoad({code:'not-owned'})
check('跨顾客或接口失败明确提示且不打开旧单号地址',!t.page.data.url&&t.modals[0]?.content==='找不到本人的服务单')
t.modals[0].fail();check('错误弹窗失败仍有提示',t.toasts[0]?.title==='签署页暂时打不开，请重试')
t=setup();await t.page.onLoad({snapshot:'A%2F01'})
check('历史凭证入口继续只读、不重新出签署链接',!t.calls.length&&t.page.data.url.endsWith('/settlements/A%2F01/snapshot?view=read-only')&&t.titles[0]?.title==='签署单凭证')
t=setup();await t.page.onLoad({code:'A%2F01',merchant:'1'});check('商家入口使用商家会话按单号出链接',t.calls[0]==='/admin/settlements/A%2F01/sign-token'&&t.page.data.url.endsWith('merchant-test-token'))
t=setup();await t.page.onLoad({})
check('无单号不请求接口、显示原因',!t.calls.length&&!t.page.data.url&&t.toasts[0]?.title==='缺少服务单号')
// 使用真正的 API 模块，验证长期会话只走请求头，未进入 URL 或请求体。
const sessionToken=randomBytes(24).toString('hex');const requests=[],storage={lucky_tenant:'mini-sign-test',lucky_mini_auth:{accessToken:sessionToken,_tenant:'mini-sign-test'}}
const context={module:{exports:{}},require:p=>p.includes('devhost')?{port:4349,lanHost:'127.0.0.1'}:p.includes('deploy')?{defaultTenantId:''}:{realValue:x=>x},wx:{getDeviceInfo:()=>({platform:'devtools'}),getStorageSync:k=>storage[k],request:o=>{requests.push(o);o.success({statusCode:200,data:{url:'https://app.example.test/sign?t=short'}})}}}
vm.runInNewContext(readFileSync(new URL('../../miniprogram/utils/api.js',import.meta.url),'utf8'),context)
await context.module.exports.getSignLink('A/01');const request=requests[0]
check('API 请求用会话头和门店头，不泄露长期令牌到地址',request.method==='POST'&&request.url.endsWith('/my/settlements/A%2F01/sign-link')&&request.header.authorization===`Bearer ${sessionToken}`&&request.header['x-tenant-id']==='mini-sign-test'&&!JSON.stringify([request.url,request.data]).includes(sessionToken))
console.log(`${n} checks; ${fails.length} failures`);process.exitCode=fails.length?1:0
