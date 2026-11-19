import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'
import vm from 'node:vm'
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8')
const app=JSON.parse(read('miniprogram/app.json'))
const routes=c=>[...(c.pages||[]),...(c.subPackages||[]).flatMap(s=>s.pages.map(p=>s.root+'/'+p))]
function retired(c){assert.ok(routes(c).every(p=>!p.includes('ai-chat')))}
retired(app)
assert.throws(()=>retired({...app,pages:[...app.pages,'pages/ai-chat/index']}),'Injected main-package resurrection must fail')
assert.throws(()=>retired({...app,subPackages:[...(app.subPackages||[]),{root:'pages',pages:['ai-chat/index']}]}),'Injected sub-package resurrection must fail')
assert.ok(!existsSync(new URL('../../miniprogram/pages/ai-chat',import.meta.url)))
for(const p of ['apps/web/customer.js','miniprogram/utils/api.js'])assert.doesNotMatch(read(p),/aiCustomerService|clientChatId|aiAssistantWidget|sendAiAssistantMessage/)
assert.doesNotMatch(read('apps/web/index.html'),/aiAssistantWidget/)
console.log('ok 1 - retired routes, packaged source, web widget and client calls absent; injected main/subpackage resurrection rejected')
const mini=['merchant/home','merchant/content','merchant/work-detail','merchant/service-note','merchant/customer-profile','merchant/conversation','booking']
for(const p of mini)assert.match(read(`miniprogram/pages/${p}/index.wxml`),/class="ai-generated-label"[^>]*>AI生成/)
for(const p of ['admin.js','ai-review.js','ai-desk.js','dashboard-home.js','customer-notes.js','customer.js','wechat-simulator.js','recall-digest.js'])assert.match(read('apps/web/'+p),/class="ai-generated-label"[^>]*>AI生成/)
assert.match(read('apps/web/share.js'),/AI生成 · 请核对/)
assert.match(read('miniprogram/pages/booking/index.wxml'),/wx:if="\{\{aiReferenceEnabled\}\}"/)
assert.match(read('miniprogram/pages/booking/index.js'),/aiReferenceEnabled:\s*false/)
console.log('ok 2 - all inventoried output views carry visible disclosure; retired reference feature is not re-enabled')
const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
function webFn(file,name,extras={}){const s=read('apps/web/'+file),start=s.indexOf('function '+name+'(');assert.ok(start>=0);const next=s.indexOf('\nfunction ',start+1),src=s.slice(start,next<0?s.length:next);const c={owner:{lang:'zh',wechatChatCustomerId:'fixture'},escapeHtml,t:s=>s,renderAiList:()=>'',linkifyEscapedText:escapeHtml,renderMessageImages:()=>'',renderAiFeedbackEditor:()=>'',storeDisplayName:()=>'',...extras};vm.runInNewContext(src,c);return c[name]}
const copy=webFn('admin.js','renderSocialCopy')
assert.doesNotMatch(copy(null),/ai-generated-label/)
assert.match(copy({titleZh:'<script>bad</script>',captionZh:'生成正文',hashtags:[]}),/ai-generated-label/)
assert.doesNotMatch(copy({titleZh:'<script>bad</script>',hashtags:[]}),/<script>/)
const chat=webFn('ai-desk.js','renderWechatTranscript')
const html=chat([{role:'customer',content:'顾客原文'},{role:'staff',content:'人工原文'},{role:'assistant',content:'自动回复'}])
assert.equal((html.match(/class="ai-generated-label"/g)||[]).length,1)
assert.doesNotMatch(chat([{role:'staff',content:'人工原文'}]),/ai-generated-label/)
assert.doesNotMatch(chat([]),/ai-generated-label/)
console.log('ok 3 - actual web renderers: label only on generated result/assistant, no label on empty/customer/staff, HTML escaped')
let merchant,reads=0,allowed=false
const api={guardMerchant:()=>allowed,adminGet:async()=>{reads++;return{conversations:[{id:'c1',status:'human_active',transcript:[{role:'customer',content:'顾客原文'},{role:'staff',content:'人工原文'},{role:'assistant',content:'自动回复'}]}]}}}
vm.runInNewContext(read('miniprogram/pages/merchant/conversation/index.js'),{Page:p=>merchant=p,require:p=>p.endsWith('/api')?api:p.endsWith('/storeclock')?{storeMoney:()=>''}:{},wx:{getStorageSync:()=>'',setNavigationBarTitle(){},showToast(){}},console})
merchant.data={...merchant.data,id:'c1'};merchant.setData=x=>Object.assign(merchant.data,x)
await merchant.onShow();assert.equal(reads,0)
allowed=true;await merchant.load();assert.deepEqual(Array.from(merchant.data.transcript,x=>x.role),['customer','staff','assistant'])
assert.equal(merchant.data.isHuman,true)
assert.match(read('miniprogram/pages/merchant/conversation/index.wxml'),/item.role==='assistant'/)
assert.match(read('miniprogram/pages/merchant/conversation/index.wxml'),/item.role==='staff'/)
for(const action of ['take-over','release-to-ai','manual-reply'])assert.ok(read('miniprogram/pages/merchant/conversation/index.js').includes(action),action)
console.log('ok 4 - actual mini conversation loader preserves roles, merchant login gate, human-control state and reply actions')
for(const page of ['content','work-detail']){let p,copied='';vm.runInNewContext(read(`miniprogram/pages/merchant/${page}/index.js`),{Page:x=>p=x,require:()=>({}),wx:{setClipboardData:o=>{copied=o.data;o.success?.()},showToast(){}},console});p.data={result:{title:'生成标题',caption:'生成正文',hashtags:'#美甲'}};p.copyAll();assert.match(copied,/^AI生成\n/);assert.ok(copied.includes('生成正文'));p.data.result=null;copied='';p.copyAll();assert.equal(copied,'')}
console.log('ok 5 - actual mini copy actions retain AI disclosure and original text; no copy for empty result')
for(const p of ['apps/web/styles.css','miniprogram/app.wxss']){const rule=read(p).match(/\.ai-generated-label\{[^}]+\}/)?.[0];assert.ok(rule);assert.match(rule,/color:var\(--ink\)/);assert.match(rule,/background:var\(--wall\)/);assert.match(rule,/padding:/)}
console.log('ok 6 - label uses existing light/dark tokens and explicit padding; no theme replacement')
