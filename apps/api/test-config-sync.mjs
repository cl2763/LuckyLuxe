import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFileSync} from 'node:fs'
let checks=0;const ok=(name)=>console.log(`ok ${++checks} - ${name}`),flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve()}
const timers=new Map(),events=new Map();let n=0,pending=[],refreshes=0,key='shop-a';const status=[]
const element=()=>({style:{},children:[],setAttribute(){},append(x){this.children.push(x)},replaceChildren(){this.children=[]},contains(){return false},remove(){this.removed=true},textContent:''})
const document={hidden:false,createElement:element,body:{prepend:e=>status.push(e)},addEventListener(k,v){events.set(k,v)},removeEventListener(k,v){if(events.get(k)===v)events.delete(k)}}
const ctx={window:{},document,Date,setTimeout:f=>{timers.set(++n,f);return n},clearTimeout:id=>timers.delete(id)}
vm.runInNewContext(readFileSync(new URL('../web/config-sync.js',import.meta.url),'utf8'),ctx)
const launch=()=>ctx.window.ConfigSync.start({request:()=>new Promise((resolve,reject)=>pending.push({resolve,reject})),path:'/revision',context:()=>key,refresh:async()=>{refreshes++}})
const tick=async()=>{const entry=timers.entries().next().value;assert.ok(entry);timers.delete(entry[0]);entry[1]();await flush()}
let watcher=launch();pending.shift().resolve({revision:'a1'});await flush();events.get('input')({target:{}});await tick();pending.shift().resolve({revision:'a2'});await flush();assert.equal(refreshes,0);assert.match(status.at(-1).children[0].textContent,/输入已保留/);ok('网页编辑中发现新版本保留输入，不自动覆盖')
await tick();pending.shift().reject(Error('offline'));await flush();assert.match(status.at(-1).children[0].textContent,/无法核对/);ok('网络失败显示未核对而非虚假成功')
watcher.stop();assert.equal(timers.size,0);assert.equal(events.size,0);ok('停止网页同步清理全部定时器及事件监听')
watcher=launch();watcher.stop();pending.shift().resolve({revision:'late'});await flush();assert.equal(timers.size,0);assert.equal(refreshes,0);ok('关闭后晚到的请求不能重启轮询')
watcher=launch();key='shop-b';pending.shift().resolve({revision:'shop-a-late'});await flush();assert.equal(status.at(-1).children.length,0);await tick();pending.shift().resolve({revision:'b1'});await flush();assert.equal(refreshes,0);ok('切店时丢弃上一门店延迟结果')
document.hidden=true;await tick();assert.equal(pending.length,0);document.hidden=false;events.get('visibilitychange')();assert.equal(pending.length,1);pending.shift().resolve({revision:'b2'});await flush();assert.equal(refreshes,1);watcher.stop();ok('后台不请求，恢复前台立即核对并刷新')
let mod={exports:{}},miniPending=[],miniTimers=new Map(),auth={accessToken:'token-a',tenantId:'shop-a'},changes=[],reloads=0;const api={getAdminAuth:()=>auth,adminGet:()=>new Promise(resolve=>miniPending.push(resolve)),currentTenantId:()=>auth.tenantId};
vm.runInNewContext(readFileSync(new URL('../../miniprogram/utils/config-sync.js',import.meta.url),'utf8'),{module:mod,Date,require:p=>p==='./api'?api:p==='./setup-preview'?{active:()=>false}:{clear(){}},setTimeout:f=>{miniTimers.set(++n,f);return n},clearTimeout:id=>miniTimers.delete(id)})
const page={route:'pages/merchant/package-edit/index',setData:d=>changes.push(d)};mod.exports.start(page);mod.exports.stop(page);miniPending.shift()({revision:'late'});await flush();assert.equal(miniTimers.size,0);assert.equal(changes.length,0);ok('小程序页面退出后晚到响应不更新页面也不重启检查')
mod.exports.start(page);miniPending.shift()({revision:'a1'});await flush();const f=miniTimers.values().next().value;miniTimers.clear();f();auth={accessToken:'token-b',tenantId:'shop-b'};miniPending.shift()({revision:'a2'});await flush();assert.ok(!changes.some(x=>x.configSyncChanged));mod.exports.stop(page);ok('小程序商家换店会话阻止上一店响应覆盖')
console.log(`PASS ${checks} configuration synchronization lifecycle checks`)
