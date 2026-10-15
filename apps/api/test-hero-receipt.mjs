import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { createStoreContentRoutes } from './store-content-routes.mjs'
import { createHeroSlides, ensureHeroSlidesSchema } from './hero-slides.mjs'
const db=new DatabaseSync(':memory:');ensureHeroSlidesSchema(db);let n=0
const api=createHeroSlides({db,currentTenantId:()=> 'a',apiError:(status,code,message)=>Object.assign(Error(message),{status,code}),iso:d=>d.toISOString(),randomId:()=>String(++n)})
const digest=rows=>createHash('sha256').update(JSON.stringify(rows.map(s=>({image:s.image,labelZh:s.labelZh||'',labelEn:s.labelEn||'',isActive:s.isActive!==false,imageView:s.imageView||{}})))).digest('hex')
for(const count of [0,1,6]){
 const slides=Array.from({length:count},(_,i)=>({image:'data:image/jpeg;base64,'+'A'.repeat(450000),labelZh:String(i),labelEn:'',isActive:i%2===0,imageView:{}}))
 api.replaceHeroSlides(slides);const r=api.receipt();assert.equal(r.savedDigest,digest(slides));assert.equal(r.publicDigest,digest(slides.filter(s=>s.isActive)));assert.equal(r.count,count);assert.ok(JSON.stringify(r).length<300)
 assert.equal(api.receipt('b').count,0)
 if(count){const changed=slides.map(s=>({...s}));changed[0].labelZh='changed';api.replaceHeroSlides(changed);assert.notEqual(api.receipt().savedDigest,r.savedDigest)}
}
const before=api.receipt();assert.throws(()=>api.replaceHeroSlides([{image:'invalid'}]));assert.deepEqual(api.receipt(),before)
console.log('ok 1 - compact receipt 0/1/6 images, visibility, exact content hash, cross-tenant isolation, invalid save atomicity')
let output
const route=createStoreContentRoutes({apiError:(status,code,message)=>Object.assign(Error(message),{status,code}),json:(_,status,data)=>{output={status,data}},readBody:async req=>req.body,heroSlidesApi:api,constants:{},HERO_SLIDE_MAX:6}).route
const slides=[{image:'data:image/jpeg;base64,'+'B'.repeat(450000)}]
await route({method:'PUT',body:{slides,receiptOnly:true}},{},{path:'/admin/hero-slides',query:{},adminSession:{role:'owner'}})
assert.equal(output.status,200);assert.ok(JSON.stringify(output.data).length<300);assert.equal(output.data.savedDigest,digest(slides))
await route({method:'GET'},{},{path:'/admin/hero-slides',query:{receipt:'1'},adminSession:{role:'owner'}})
assert.equal(output.data.savedDigest,digest(slides))
await assert.rejects(()=>route({method:'PUT',body:{slides:[]}},{},{path:'/admin/hero-slides',query:{},adminSession:{role:'staff'}}),e=>e.status===403)
assert.equal(api.receipt().count,1)
await route({method:'GET'},{},{path:'/admin/hero-slides',query:{},adminSession:{role:'owner'}})
assert.equal(output.data.slides[0].image,slides[0].image)
const imageRef=createHash('sha256').update(slides[0].image).digest('hex')
api.replaceHeroSlides([{imageRef,labelZh:'updated'}]);assert.equal(api.listHeroSlides()[0].image,slides[0].image)
assert.throws(()=>api.replaceHeroSlides([{imageRef}],'b'),e=>e.status===409)
assert.throws(()=>api.replaceHeroSlides([{imageRef:'missing'}]),e=>e.status===409)
assert.equal(api.listHeroSlides()[0].labelZh,'updated')
console.log('ok 2 - compact PUT/GET, owner-only, legacy response, existing image reference, foreign/stale reference rejected')
db.close()
