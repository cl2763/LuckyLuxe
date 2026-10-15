import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {createStoreGuide} from './store-guide.mjs'
const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE stores(id TEXT,tenant_id TEXT);INSERT INTO stores VALUES('a','t1'),('b','t2')")
const m=createStoreGuide({db,apiError:(status,code,msg)=>Object.assign(Error(msg),{status,code})});m.ensureSchema();m.ensureSchema()
const image='data:image/png;base64,iVBORw0KGgo=',steps=[{image,description:'从东门进入'}]
assert.deepEqual(m.read('t1','a'),{steps:[],revision:0})
assert.equal(m.save('t1','a',{steps,revision:0}).revision,1)
assert.deepEqual(m.read('t2','b').steps,[])
assert.throws(()=>m.save('t2','a',{steps,revision:0}),e=>e.status===404)
assert.throws(()=>m.save('t1','a',{steps,revision:0}),e=>e.status===409)
for(const bad of [null,{},[...Array(7)].map(()=>steps[0]),[{image:'javascript:alert(1)',description:''}],[{image,description:'字'.repeat(51)}],[{image,description:null}],[{image:'data:image/svg+xml;base64,PHN2Zz4=',description:''}]])assert.throws(()=>m.save('t1','a',{steps:bad,revision:1}),e=>e.status===400)
assert.deepEqual(m.read('t1','a').steps,steps)
assert.equal(m.save('t1','a',{steps:[],revision:1}).steps.length,0)
assert.equal(m.save('t1','a',{steps:Array(6).fill({image,description:'字'.repeat(50)}),revision:2}).steps.length,6)
for(const role of ['staff',undefined])await assert.rejects(m.route({method:'PUT'},{},{path:'/admin/store-guide',admin:{role},tid:'t1',query:{},readBody:async()=>({storeId:'a',steps:[],revision:3})}),e=>e.status===403)
console.log('ok 1 - arrival guide empty, save/read, six-step boundary, cross-tenant, role, image validation and concurrent revision checks')
const published=m.presentation('t1','a');assert.ok(published.steps.every(s=>s.image.startsWith('/store-guide/image?')),'catalog must not inline photo payloads')
assert.equal(m.save('t1','a',{steps:[published.steps[1]],revision:3}).steps[0].image,image,'own current image can be retained or reordered')
assert.throws(()=>m.save('t2','b',{steps:[published.steps[0]],revision:0}),e=>e.status===400,'foreign image reference refused')
let headers,bytes;const res={writeHead:(status,h)=>{assert.equal(status,200);headers=h},end:b=>{bytes=b}}
assert.equal(m.imageRoute({method:'GET'},res,{path:'/store-guide/image',query:{tenantId:'t1',storeId:'a',step:'0',revision:'4'}}),true)
assert.equal(headers['Content-Type'],'image/png');assert.equal(bytes.toString('base64'),'iVBORw0KGgo=')
assert.throws(()=>m.imageRoute({method:'GET'},res,{path:'/store-guide/image',query:{tenantId:'t1',storeId:'a',step:'0',revision:'3'}}),e=>e.status===404)
console.log('ok 2 - lightweight public image URLs, revision-scoped image serving and no cross-store image reuse')
