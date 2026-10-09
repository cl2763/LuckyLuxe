import nativeAssert from 'node:assert/strict'
let checked = 0
const assert = new Proxy(nativeAssert, { get(target, key) { const fn = target[key]; if (typeof fn !== 'function') return fn; return (...args) => { const result = fn(...args); if (result?.then) return result.then(value => { console.log('ok ' + (++checked) + ' - ' + String(key)); return value }); console.log('ok ' + (++checked) + ' - ' + String(key)); return result } } })
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const require = createRequire(import.meta.url)
const values = new Map([['lucky_tenant','demo-ai'],['lucky_lang','zh']])
const calls = []
global.wx = { getStorageSync:k=>values.get(k),setStorageSync:(k,v)=>values.set(k,v),removeStorageSync:k=>values.delete(k),getDeviceInfo:()=>({platform:'devtools'}),request:o=>calls.push(o),showNavigationBarLoading(){},hideNavigationBarLoading(){},reLaunch(){},login:o=>o.success({code:'test-code'}) }
const api = require('../../miniprogram/utils/api.js')
function respond(call, data, statusCode=200) { call.success({statusCode,data});call.complete?.() }
const tick = () => new Promise(r=>setImmediate(r))
values.set('lucky_mini_auth',{_tenant:'demo-ai',tenantId:'demo-ai',accessToken:'stale'})
const requests=[api.getStores(),api.getHeroSlides('zh'),api.getStoreCurrency()]
await tick()
assert.equal(calls.length,1,'parallel stores/hero/currency must share one HTTP request')
assert.equal(calls[0].header.authorization,undefined,'public homepage cannot be blocked by customer session')
assert.equal(calls[0].timeout,15000)
respond(calls[0],{stores:[{id:'store-a'}],heroSlides:[],currency:'CAD'})
await Promise.all(requests)
await api.getStores()
assert.equal(calls.length,1,'short public cache prevents repeated return navigation queries')
api.onStoreSwitched();values.set('lucky_tenant','other')
const swapped=api.getStores();await tick();assert.equal(calls.length,2)
values.set('lucky_tenant','third');respond(calls[1],{stores:[{id:'wrong-store'}]})
await assert.rejects(swapped,e=>e.code==='STORE_CHANGED')
assert.notEqual(values.get('lucky_store_id::third'),'wrong-store')
values.set('lucky_mini_auth',{_tenant:'third',apiBase:'https://old.example.invalid',accessToken:'old'})
assert.equal(api.getAuth(),null,'old environment auth is discarded')
const failed=api.getStores();await tick();respond(calls[2],{error:{message:'down'}},503)
await assert.rejects(failed,e=>e.statusCode===503)
const retry=api.getStores();await tick();assert.equal(calls.length,4,'errors are never cached');respond(calls[3],{stores:[]});await retry
const portfolio=api.getPortfolioWall();respond(calls[4],{error:{message:'down'}},503);await assert.rejects(portfolio)
const latest=require('../../miniprogram/utils/recent-orders.js').latest
assert.deepEqual(latest([{id:'future',createdAt:'2025-01-01',appointment:'2030-01-01'},{id:'recent',updatedAt:'2026-10-08T12:00:00Z'},{id:'older',updatedAt:'2026-10-07T12:00:00Z'},{id:'unknown'}]).map(x=>x.id),['recent','older'])
assert.deepEqual(latest([]),[])
function page(file, apiStub={}) {
  let def
  vm.runInNewContext(readFileSync(new URL('../../miniprogram/pages/'+file+'/index.js',import.meta.url),'utf8'),{Page:x=>def=x,wx:global.wx,require:p=>p.endsWith('/api')?apiStub:p.endsWith('/storecurrency')?{curOf:()=>({}),ensureCurrencyCached(){},refreshStoreCurrency:async()=>{},money:()=>''}:p.endsWith('/i18n')?{pageCopy:()=>({}),statusText:x=>x,getLang:()=> 'zh',applyTabBar(){},setTitle(){},localizeServices:x=>x,localizeService:x=>x}:p.endsWith('/storage')?{setOrders(){}}:{update(){}},setTimeout,clearTimeout})
  const instance={...def,data:JSON.parse(JSON.stringify(def.data)),setData(p,cb){Object.assign(this.data,p);cb?.()}}
  return instance
}
const svc=page('services',{getServiceCatalog:async()=>({services:[{_id:'a',type:'nail'},{_id:'b',type:'lash'}],platformCategories:[{key:'nail',nameZh:'美甲'},{key:'lash',nameZh:'美睫'}]})})
await svc.refresh();assert.equal(svc.data.activeCat,'all');assert.equal(svc.data.serviceList.length,2)
svc.switchCat({currentTarget:{dataset:{cat:'lash'}}});assert.equal(svc.data.serviceList[0]._id,'b')
let queryCount=0, fulfill
const orders=page('orders',{isLoggedIn:()=>true,getBookings:()=>{queryCount++;return new Promise(r=>fulfill=r)},getMyPendingSign:async()=>({pendingSign:[]})})
const loading=orders.refresh();assert.equal(orders.data.loading,true)
fulfill([{status:'completed',serviceInfo:{serviceName:'a'}},{status:'cancelled',serviceInfo:{serviceName:'b'}}]);await loading
orders.switchStatus({currentTarget:{dataset:{status:'completed'}}});assert.equal(queryCount,1);assert.equal(orders.data.orders.length,1);assert.equal(orders.data.loading,false)
const mall=page('mall',{getMall:async()=>({filters:[{key:'all'},{key:'timecard'}],sections:[{key:'topup',kind:'stored'},{key:'pass',kind:'timecard'}],items:[{id:'a',section:'topup'},{id:'b',section:'pass'}]})})
await mall.load();assert.equal(mall.data.filter,'all');assert.equal(mall.data.visibleSections.length,2)
mall.pickFilter({currentTarget:{dataset:{k:'timecard'}}});assert.equal(mall.data.visibleSections.length,1)
console.log('PASS: public startup isolation/coalescing, environment + shop races, retry, portfolio failure, recent ordering, service All, loading and local order filter, mall default')
const webSource=readFileSync(new URL('../web/customer.js',import.meta.url),'utf8')
let webResolve, webCalls=0
const webState={user:{id:'u'},lang:'zh',orders:[],view:'orders'}
const webContext={state:webState,request:path=>{webCalls++;return path.startsWith('/bookings')?new Promise(r=>webResolve=r):Promise.resolve({pendingSign:[]})},writeTenantJson(){},Promise}
vm.createContext(webContext)
vm.runInContext(webSource.slice(webSource.indexOf('let userOrdersPending = null'),webSource.indexOf('function customerLoadState')),webContext)
const w1=webContext.loadUserOrders(),w2=webContext.loadUserOrders()
assert.equal(webState.ordersLoading,true);assert.equal(webCalls,2,'two callers share bookings and pending-sign requests')
webResolve({bookings:[{id:'real'}]});await Promise.all([w1,w2]);assert.equal(webState.ordersLoading,false);assert.equal(webState.orders[0].id,'real')
webContext.request=async()=>{throw Error('offline')}
await assert.rejects(webContext.loadUserOrders());assert.equal(webState.ordersLoading,false);assert.equal(webState.ordersError,'offline')
const mallContext={state:{mall:null,mallError:'offline',lang:'zh'},els:{screen:{innerHTML:''}},customerLoadState:e=>'error:'+e,loadMall:()=>{throw Error('failure must not auto-loop')},render(){}}
vm.createContext(mallContext)
vm.runInContext(webSource.slice(webSource.indexOf('function renderMallWeb()'),webSource.indexOf('\nasync function ',webSource.indexOf('function renderMallWeb()'))),mallContext)
mallContext.renderMallWeb();assert.equal(mallContext.els.screen.innerHTML,'error:offline')
