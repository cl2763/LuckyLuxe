import { assertTestTarget } from './test-guard.mjs'
import { requireOwnerToken } from './owner-token.mjs'
import { imageView, ensureServiceImageViewSchema } from './image-view.mjs'
import { ensureHeroSlidesSchema } from './hero-slides.mjs'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:4128';await assertTestTarget(base)
const token=process.env.TEST_ADMIN_TOKEN||requireOwnerToken(),run=Date.now().toString(36),a='frame-a-'+run,b='frame-b-'+run
let n=0;function check(name,ok){if(!ok)throw Error(name);console.log(`ok ${++n} - ${name}`)}
async function req(path,body,tid=a,method=body?'PUT':'GET',auth=token){const r=await fetch(base+path,{method,headers:{'content-type':'application/json','x-admin-tenant-id':tid,'x-tenant-id':tid,...(auth?{authorization:'Bearer '+auth}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}}
for(const id of [a,b])check('test tenant '+id,(await req('/platform/tenants',{id,name:id,plan:'chain',currency:'CNY',timezone:'Asia/Shanghai'},id,'POST')).status===201)
const src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const view={desktop:{x:0,y:100,zoom:3},mobile:{x:40,y:60,zoom:1.5},mini:{x:100,y:0,zoom:2}}
for(const count of [0,1,2,6]){const slides=Array.from({length:count},(_,i)=>({image:src,labelZh:String(i),imageView:view}));check('save '+count,(await req('/admin/hero-slides',{slides})).status===200);const pub=(await req('/stores',null,a,'GET',null)).data.heroSlides;check('public count, order, independent views '+count,pub.length===count&&pub.every((s,i)=>s.labelZh===String(i)&&JSON.stringify(s.imageView)===JSON.stringify(view)))}
check('other tenant stays empty',(await req('/stores',null,b,'GET',null)).data.heroSlides.length===0)
for(const bad of [{desktop:{x:-1,y:50,zoom:1}},{desktop:{x:50,y:101,zoom:1}},{desktop:{x:50,y:50,zoom:3.01}},{desktop:{x:'50',y:50,zoom:1}},{desktop:{x:null,y:50,zoom:1}},{surprise:{x:50,y:50,zoom:1}},[],{desktop:{x:50,y:50,zoom:1,tenantId:b}}]){check('invalid range rejected atomically',(await req('/admin/hero-slides',{slides:[{image:src,imageView:bad}]})).status===400);check('rejection keeps previous 6',(await req('/stores',null,a,'GET',null)).data.heroSlides.length===6)}
check('7 rejected',(await req('/admin/hero-slides',{slides:Array(7).fill({image:src})})).status===400)
check('unauth denied',(await req('/admin/hero-slides',{slides:[]},a,'PUT',null)).status===401)
check('legacy centered',(await req('/admin/hero-slides',{slides:[{image:src}]})).data.slides[0].imageView&&Object.keys((await req('/stores',null,a,'GET',null)).data.heroSlides[0].imageView).length===0)
const svcView={card:{x:10,y:90,zoom:2},detail:{x:80,y:20,zoom:1.4}}
let s=await req(`/platform/tenants/${a}/services`,{type:'NAIL',nameZh:'取景测试',nameEn:'Frame test',priceCents:10000,depositCents:1000,baseDurationMin:60,imageUrl:src,imageView:svcView},a,'POST')
check('platform service creates with crop',s.status===201&&JSON.stringify(s.data.service.imageView)===JSON.stringify(svcView));const id=s.data.service.id
check('merchant preserves crop on unrelated patch',(await req('/admin/services/'+id,{priceCents:12000},a,'PATCH')).data.service.imageView.card.x===10)
check('service crop public',(await req('/services',null,a,'GET',null)).data.services.some(s=>s.id===id&&s.imageView.detail.x===80))
check('cross tenant service forbidden',[403,404].includes((await req('/admin/services/'+id,{imageView:{}},b,'PATCH')).status))
check('invalid service crop rejected',(await req('/admin/services/'+id,{imageView:{card:{x:0,y:0,zoom:0}}},a,'PATCH')).status===400)
check('new service image resets old crop',(await req('/admin/services/'+id,{imageUrl:src+'#new'},a,'PATCH')).data.service.imageView&&Object.keys((await req('/admin/services',null,a)).data.services.find(s=>s.id===id).imageView).length===0)
const old=new DatabaseSync(':memory:');old.exec("CREATE TABLE services(id TEXT PRIMARY KEY);CREATE TABLE hero_slides(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,image TEXT NOT NULL,label_zh TEXT NOT NULL DEFAULT '',label_en TEXT NOT NULL DEFAULT '',sort_order INTEGER NOT NULL DEFAULT 0,is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);INSERT INTO services VALUES('existing')")
for(let i=0;i<2;i++){ensureServiceImageViewSchema(old);ensureHeroSlidesSchema(old)}
check('old schema migrates twice preserving existing row',old.prepare("SELECT * FROM services WHERE id='existing'").get().image_view_json==='{}');old.close()
const require=createRequire(import.meta.url),core=require('../../miniprogram/utils/image-view-core.js')
check('web and mini same crop math bytes',readFileSync(new URL('../web/image-view-core.js',import.meta.url),'utf8')===readFileSync(new URL('../../miniprogram/utils/image-view-core.js',import.meta.url),'utf8'))
for(const [iw,ih] of [[1600,900],[900,1600]])for(const [w,h] of [[640,520],[345,260],[355,250],[168,150],[1180,360]])for(const x of [0,50,100]){const g=core.geometry(iw,ih,w,h,{x,y:100-x,zoom:2});check('no exposed border for aspect/focus '+[iw,ih,w,h,x],g.left<=.001&&g.top<=.001&&g.left+g.width>=w-.001&&g.top+g.height>=h-.001)}
for(const v of [NaN,Infinity]){let rejected=false;try{imageView({card:{x:v,y:0,zoom:1}})}catch{rejected=true}check('nonfinite rejected '+v,rejected)}
