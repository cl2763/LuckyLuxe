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

const owner={role:'owner',username:'owner1'}
async function call(path,body,{tid='t1',admin=owner,method='PUT'}={}){
 let output;await m.route({method},{},{path,query:body,tid,admin,readBody:async()=>body,json:(_r,status,data)=>{assert.equal(status,200);output=data}})
 return output
}
const before=m.read('t1','a')
const upload=await call('/admin/store-guide/upload',{storeId:'a',image})
assert.match(upload.uploadRef,/^[a-f0-9]{64}$/)
assert.deepEqual(m.read('t1','a'),before,'staging must not publish or mutate guide')
assert.deepEqual(await call('/admin/store-guide/upload',{storeId:'a',image}),upload,'retry is idempotent')
await assert.rejects(call('/admin/store-guide',{storeId:'b',steps:[{uploadRef:upload.uploadRef,description:''}],revision:0},{tid:'t2'}),e=>e.code==='UPLOAD_INCOMPLETE')
await assert.rejects(call('/admin/store-guide',{storeId:'a',steps:[{uploadRef:upload.uploadRef,description:''}],revision:4},{admin:{role:'owner',username:'other'}}),e=>e.code==='UPLOAD_INCOMPLETE')
for(const bad of ['data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,invalid!','data:image/png;base64,'+'A'.repeat(450000)]){
 await assert.rejects(call('/admin/store-guide/upload',{storeId:'a',image:bad}),e=>e.status===400)
}
await assert.rejects(call('/admin/store-guide/upload',{storeId:'a',image},{admin:{role:'staff'}}),e=>e.status===403)
await assert.rejects(call('/admin/store-guide/upload',{storeId:'b',image}),e=>e.status===404)
await assert.rejects(call('/admin/store-guide',{storeId:'a',steps:[{uploadRef:'missing',description:''}],revision:4}),e=>e.code==='UPLOAD_INCOMPLETE')
await assert.rejects(call('/admin/store-guide',{storeId:'a',steps:[{uploadRef:upload.uploadRef,description:''}],revision:3}),e=>e.status===409)
assert.deepEqual(m.read('t1','a'),before,'failed final save must preserve published guide')
const committed=await call('/admin/store-guide',{storeId:'a',steps:Array(6).fill({uploadRef:upload.uploadRef,description:'入口'}),revision:4})
assert.equal(committed.revision,5);assert.equal(committed.steps.length,6)
assert.ok(committed.steps.every(s=>s.image.startsWith('/store-guide/image?')))
assert.ok(m.read('t1','a').steps.every(s=>s.image===image))
console.log('ok 3 - staged images are private to owner/store; retries, invalid uploads and revision conflicts preserve published guide; six-image final save')
