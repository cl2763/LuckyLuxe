import assert from 'node:assert/strict'
import vm from 'node:vm'
import fs from 'node:fs'
const root=new URL('../../miniprogram/',import.meta.url)
let tenant='store-a',lang='zh'
const api={currentTenantId:()=>tenant};const i18n={getLang:()=>lang,pageCopy:()=>({})}
const context={module:{exports:{}},require:n=>n==='./api'?api:i18n}
vm.runInNewContext(fs.readFileSync(new URL('utils/public-share.js',root),'utf8'),context)
const {share}=context.module.exports
let count=0;const test=(name,fn)=>{fn();console.log(`ok ${++count} - ${name}`)}
test('share restores explicit store and escapes content identifiers',()=>{
 const s=share('service-detail','服务',{id:'a&tenantId=other'})
 const q=new URLSearchParams(s.query);assert.equal(q.get('tenantId'),'store-a');assert.equal(q.get('id'),'a&tenantId=other');assert.equal(q.getAll('tenantId').length,1)
})
test('store switch uses current store, not prior share',()=>{tenant='store-b';assert.match(share('home').path,/tenantId=store-b/)})
test('no chosen store shares neutral public entry',()=>{tenant='';assert.equal(share('home').path,'/pages/entry/index');assert.equal(share('home').query,'')})
test('public share never adds session or private order fields',()=>{tenant='store-a';const q=new URLSearchParams(share('portfolio','作品',{workId:'public-1',tenantId:'other',accessToken:'secret',bookingId:'private'}).query);assert.deepEqual([...q.keys()],['tenantId','workId'])})
for(const page of ['home','services','service-detail','portfolio']){
 test(`${page} friend and timeline callbacks retain matching query`,()=>{
  let opts;vm.runInNewContext(fs.readFileSync(new URL(`pages/${page}/index.js`,root),'utf8'),{Page:o=>opts=o,require:n=>n.includes('public-share')?{share}:n.includes('i18n')?i18n:n.includes('api')?api:{},wx:{}})
  const ctx={data:{lang:'zh',shopName:'门店',service:{name:'服务'},preview:{id:'work-1'}},serviceId:'svc-1'};ctx.onShareAppMessage=opts.onShareAppMessage.bind(ctx)
  const friend=ctx.onShareAppMessage(),timeline=opts.onShareTimeline.call(ctx);assert.equal(friend.query,timeline.query);assert.match(friend.path,/tenantId=store-a/)
 })
}
const web={window:{},URL,URLSearchParams,location:{search:'?publicView=detail&serviceId=svc'}}
vm.runInNewContext(fs.readFileSync(new URL('../web/customer-public-share.js',import.meta.url),'utf8'),web)
test('web link restores existing service',()=>{const st={services:[{id:'svc'}],lang:'zh'};web.window.CustomerPublicShare.restore(st,()=>{});assert.equal(st.service.id,'svc');assert.equal(st.view,'detail')})
test('web missing service returns catalog with feedback',()=>{let tip='';const st={services:[],lang:'zh'};web.window.CustomerPublicShare.restore(st,t=>tip=t);assert.equal(st.view,'services');assert.ok(tip)})
test('web rejects private page from public share parameter',()=>{web.location.search='?publicView=orders';const st={view:'home'};web.window.CustomerPublicShare.restore(st,()=>{});assert.equal(st.view,'home')})
let copyClick, copied
web.location={origin:'https://example.test',pathname:'/',search:'?accessToken=private'}
web.document={createElement:()=>({addEventListener:(_name,fn)=>{copyClick=fn}})}
web.navigator={clipboard:{writeText:async text=>{copied=text}}}
web.window.CustomerPublicShare.render({state:{view:'detail',lang:'zh',service:{id:'svc&other=1'}},root:{prepend(){}},tenant:'store-b',toast(){}})
await copyClick()
test('web copied link is public-only and keeps destination store/service',()=>{const u=new URL(copied);assert.equal(u.searchParams.get('store'),'store-b');assert.equal(u.searchParams.get('serviceId'),'svc&other=1');assert.deepEqual([...u.searchParams.keys()],['store','publicView','serviceId'])})
console.log(`public-share ${count} passed`)
