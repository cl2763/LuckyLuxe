import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createHeroUpload } from './hero-upload.mjs'
import { createStoreContentRoutes } from './store-content-routes.mjs'
const apiError=(status,code,message)=>Object.assign(Error(message),{status,code})
let clock=0
const upload=createHeroUpload({apiError,now:()=>clock,ttl:100})
const image='data:image/jpeg;base64,'+'A'.repeat(220000)
const hash=createHash('sha256').update(image).digest('hex')
const parts=Array.from({length:3},(_,index)=>({hash,index,count:3,chunk:image.slice(index*100000,(index+1)*100000)}))
upload.accept('a',parts[2]);assert.throws(()=>upload.resolve('a',hash),e=>e.status===409)
upload.accept('a',parts[0]);upload.accept('a',parts[0]);upload.accept('a',parts[1]);assert.equal(upload.resolve('a',hash),image)
assert.throws(()=>upload.resolve('b',hash),e=>e.status===409)
assert.throws(()=>upload.accept('a',{...parts[0],chunk:'wrong'}),e=>e.status===409)
for(const bad of [{...parts[0],index:-1},{...parts[0],count:100},{...parts[0],chunk:'x'.repeat(100001)},{...parts[0],hash:'../bad'}])assert.throws(()=>upload.accept('a',bad),e=>e.status===400)
clock=101;assert.throws(()=>upload.resolve('a',hash),e=>e.status===409)
const badHash='0'.repeat(64);for(const part of parts) upload.accept('a',{...part,hash:badHash});assert.throws(()=>upload.resolve('a',badHash),e=>e.code==='UPLOAD_INVALID')
const capped=createHeroUpload({apiError,maxBytes:100});assert.throws(()=>capped.accept('a',parts[0]),e=>e.status===429)
let tenant='a',written=[],output
const route=createStoreContentRoutes({apiError,json:(_,status,data)=>{output={status,data}},readBody:async r=>r.body,currentTenantId:()=>tenant,heroSlidesApi:{replaceHeroSlides:s=>{written=s;return s},receipt:()=>({count:written.length})},constants:{},HERO_SLIDE_MAX:6}).route
const call=(path,body,role='owner',username='boss')=>route({method:'PUT',body},{},{path,query:{},adminSession:{role,username}})
await assert.rejects(()=>call('/admin/hero-slides/upload',parts[0],'staff'),e=>e.status===403)
for(const part of parts) await call('/admin/hero-slides/upload',part)
assert.deepEqual(written,[])
tenant='b';await assert.rejects(()=>call('/admin/hero-slides',{slides:[{uploadRef:hash}]}),e=>e.status===409);tenant='a'
await assert.rejects(()=>call('/admin/hero-slides',{slides:[{uploadRef:hash}]},'owner','other'),e=>e.status===409)
await call('/admin/hero-slides',{slides:[{uploadRef:hash}],receiptOnly:true});assert.equal(written[0].image,image);assert.equal(output.data.count,1)
await assert.rejects(()=>call('/admin/hero-slides',{slides:[{uploadRef:hash,image:'other'}]}),e=>e.status===400)
console.log('ok - segmented image upload: reordered/retried chunks, incomplete/expired, limits, integrity, tenant/actor/owner gates, final commit only')
