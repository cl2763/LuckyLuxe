import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
let n = 0, failed = 0
function check(name, ok) { console.log(`${ok ? 'ok' : 'not ok'} ${++n} - ${name}`); if (!ok) failed++ }
const policy = JSON.parse(readFileSync(new URL('../../miniprogram/assets/privacy-policy.json', import.meta.url)))
const require = createRequire(import.meta.url)
const packedPolicy = require('../../miniprogram/utils/privacy-policy.js')
check('小程序使用支持的 JavaScript 模块，打包内容与网页政策源逐字段相同', JSON.stringify(packedPolicy) === JSON.stringify(policy))
const source = readFileSync(new URL('../../apps/web/privacy.js', import.meta.url), 'utf8')
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.hidden = false; this.listeners = {} }
  append(...xs) { this.children.push(...xs) }
  replaceChildren(...xs) { this.children = xs }
  setAttribute(k,v) { this.attributes[k] = v }
  addEventListener(k,fn) { this.listeners[k] = fn }
  get content() { return [this.textContent || '', ...this.children.map(x => x.content)].join(' ') }
}
async function web(path, mode, replies) {
  const target = new Element('section'), retry = new Element('button'), toggle = new Element('button'), root = {dataset:{}}
  const calls = []
  vm.runInNewContext(source, {document:{documentElement:root, createElement:tag=>new Element(tag), querySelector:sel=>({'#policy':target,'#retry':retry,'#themeToggle':toggle})[sel]},
    localStorage:{getItem:()=>mode}, matchMedia:()=>({matches:true}), location:{pathname:path}, fetch:async(url,options)=>{calls.push({url,options});const value=replies.shift();if(value instanceof Error) throw value; return {ok:true,json:async()=>value}}})
  await new Promise(r=>setImmediate(r))
  return {target,retry,toggle,root,calls}
}
const rendered = await web('/web/privacy.html','dark',[policy])
check('无登录会话可公开读取真实主体、日期及电话', rendered.target.content.includes(policy.operator) && rendered.target.content.includes(policy.phone) && rendered.target.content.includes('2026-10-07'))
check('正文无需顾客令牌，明确线下收款及绑定不等于会员', rendered.calls[0].options.credentials === undefined && rendered.target.content.includes('不在小程序内执行上述支付') && rendered.target.content.includes('不等于充值'))
check('成功加载结束 aria-busy，不残留重试按钮', rendered.target.attributes['aria-busy']==='false' && rendered.retry.hidden)
check('深色加载和按钮切浅色均有效', rendered.root.dataset.theme==='dark' && (rendered.toggle.listeners.click(),rendered.root.dataset.theme==='light'))
const scoped = await web('/experience/web/privacy.html','system',[policy])
check('体验政策请求保留独立 experience 前缀', scoped.calls[0].url==='/experience/assets/privacy-policy.json')
const fault = await web('/web/privacy.html','light',[Error('offline'),policy])
check('网络失败保留联系电话、失败反馈、重试入口且结束等待', !fault.retry.hidden && fault.target.content.includes(policy.phone) && fault.target.content.includes('加载失败') && fault.target.attributes['aria-busy']==='false')
await fault.retry.listeners.click()
check('网络恢复重试显示正文并隐藏错误入口', fault.calls.length===2 && fault.retry.hidden && fault.target.content.includes(policy.operator))
const incomplete = await web('/web/privacy.html','light',[{sections:[]}])
check('不完整政策不能当成功内容展示', !incomplete.retry.hidden && incomplete.target.content.includes('加载失败'))
let page, phone, toast
const wx = {setNavigationBarTitle(){},makePhoneCall:o=>phone=o,showToast:o=>toast=o}
vm.runInNewContext(readFileSync(new URL('../../miniprogram/pages/privacy/index.js',import.meta.url),'utf8'), {require:()=>packedPolicy,Page:p=>page=p,wx})
page.callPrivacy(); check('小程序客服电话保留国际区号，拨号失败有可用反馈',phone.phoneNumber==='+8618536823102' && (phone.fail(),toast.icon==='none'))
page.openWechatPolicy();check('旧微信无原生隐私接口仍有明确查阅路径',toast.title.includes('设置中查看'))
wx.openPrivacyContract=o=>o.fail();page.openWechatPolicy();check('微信指引打开失败有反馈',toast.title.includes('无法打开'))
check('网页资源采用相对路径，体验页不误取生产的旧脚本',/src="privacy.js"/.test(readFileSync(new URL('../../apps/web/privacy.html',import.meta.url),'utf8')))
console.log(`${failed ? 'FAIL' : 'PASS'} ${n} privacy policy checks`);if(failed)process.exit(1)
