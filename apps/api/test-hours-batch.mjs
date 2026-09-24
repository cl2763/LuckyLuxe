import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import { HOURS_GATE_TEXT } from './hours-gate.mjs'
import { assertTestTarget } from './test-guard.mjs'
let checks = 0
function check(name, fn) { fn(); console.log(`ok ${++checks} - ${name}`) }
const clone = v => JSON.parse(JSON.stringify(v))
let definition
vm.runInNewContext(readFileSync(new URL('../../miniprogram/components/hours-form/index.js', import.meta.url), 'utf8'), { Component: d => { definition = d } })
function component(initial = null, txt = HOURS_GATE_TEXT) {
  const c = { data: Object.assign(clone(definition.data), { initial, txt, saving: false, saveLabel: '' }), events: [], setData(values) { Object.assign(this.data, values) }, triggerEvent(name, value) { this.events.push({ name, value }) } }
  Object.assign(c, definition.methods); c.rebuild(); return c
}
for (let cycle = 0; cycle < 5; cycle++) {
  const c = component()
  check(`mini cycle ${cycle + 1}: empty has no generated hours`, () => assert(c.data.days.every(d => !d.open && !d.openTime && !d.closeTime)))
  c.pickBatchStart({ detail: { value: '10:00' } }); c.pickBatchEnd({ detail: { value: '18:00' } }); c.applyBatch()
  check('apply is draft only, opens all seven', () => { assert.equal(c.events.length, 0); assert.equal(c.data.days.filter(d => d.open).length, 7); assert(c.data.canSave) })
  c.toggleDay({ currentTarget: { dataset: { i: 6 } } }); c.pickScope({ detail: { value: '1' } }); c.pickBatchStart({ detail: { value: '11:00' } }); c.applyBatch()
  check('open-only preserves Sunday, changes six days', () => { assert(!c.data.days[6].open); assert(c.data.days.slice(0,6).every(d => d.openTime === '11:00')) })
  c.pickOpen({ currentTarget: { dataset: { i: 0 } }, detail: { value: '12:00' } }); c.undoBatch()
  check('undo also restores later individual edit', () => { assert.equal(c.data.days[0].openTime, '10:00'); assert(!c.data.days[6].open) })
  c.save(); const submitted = JSON.stringify(c.events[0].value)
  c.data.saving = true; c.toggleDay({ currentTarget: { dataset: { i: 0 } } }); c.applyBatch(); c.undoBatch(); c.save()
  check('saving blocks mutations and duplicate save', () => { assert.equal(c.events.length, 1); assert.equal(JSON.stringify(c.events[0].value), submitted); assert(c.data.days[0].open) })
  c.data.saving = false; definition.observers.saveError.call(c, 'network'); check('failed save keeps hours and reports error', () => { assert(c.data.error); assert.equal(c.data.days[0].openTime, '10:00') })
}
for (const [start, end] of [['', '18:00'], ['18:00','10:00'], ['10:00','10:00']]) {
  const c = component(); c.data.batchStart = start; c.data.batchEnd = end; c.applyBatch()
  check(`invalid ${start}-${end} changes nothing`, () => { assert(c.data.error); assert(c.data.days.every(d => !d.open)); assert.equal(c._undo, null) })
}
const none = component(); Object.assign(none.data,{batchStart:'10:00',batchEnd:'18:00',scopeIndex:1});none.applyBatch()
check('open-only without open days rejected',()=>assert(none.data.error))
const english=component(null,HOURS_GATE_TEXT.en);Object.assign(english.data,{batchStart:'10:00',batchEnd:'18:00'});english.applyBatch()
check('English labels and feedback',()=>{assert.equal(english.data.days[0].name,'Mon');assert(english.data.message.includes('7 days'))})
// Both backend entry points must reject malformed batches without partial writes.
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
await assertTestTarget(base)
const { requireOwnerToken } = await import('./owner-token.mjs')
const token=process.env.TEST_ADMIN_TOKEN || requireOwnerToken()
async function req(path,body,method=body?'PUT':'GET',tid='lucky-luxe'){
 const r=await fetch(base+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json','x-admin-tenant-id':tid,'x-tenant-id':tid},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}
}
const tid='batch-'+Date.now().toString(36)
let created=await req('/platform/tenants',{id:tid,name:'批量设置隔离店',plan:'chain',currency:'CNY',timezone:'Asia/Shanghai'},'POST')
assert.equal(created.status,201)
const good=[1,2,3,4,5,6,0].map(weekday=>({weekday,isClosed:weekday===0,openTime:'10:00',closeTime:'18:00'}))
for(const path of [`/platform/tenants/${tid}/business-hours`,'/admin/business-hours']){
 assert.equal((await req(path,{hours:good},'PUT',tid)).status,200)
 const before=JSON.stringify((await req(`/platform/tenants/${tid}/business-hours`)).data.hours)
 for(const bad of [null,{weekday:9,isClosed:true},{weekday:1,openTime:'12:00',closeTime:'12:00'},{weekday:2,openTime:'20:00',closeTime:'10:00'}]){
  const r=await req(path,{hours:[{weekday:3,openTime:'09:00',closeTime:'17:00'},bad]},'PUT',tid)
  check(`${path}: reject invalid row before earlier valid row changes`,()=>assert.equal(r.status,400))
  const after=JSON.stringify((await req(`/platform/tenants/${tid}/business-hours`)).data.hours)
  check('failed batch leaves every persisted row unchanged',()=>assert.equal(after,before))
 }
 const dup=await req(path,{hours:[good[0],good[0]]},'PUT',tid);check('duplicate weekdays rejected',()=>assert.equal(dup.status,400))
 const closed=await req(path,{hours:good.map(x=>({...x,isClosed:true}))},'PUT',tid);check('all closed rejected',()=>assert.equal(closed.status,400))
}
console.log(`\n✅ hours-batch ${checks} checks`)
