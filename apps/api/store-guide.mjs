import {createHash} from 'node:crypto'
import {createHeroUpload} from './hero-upload.mjs'
// Store-owned arrival directions. No mutations of existing store or ledger records.
export function createStoreGuide({db,apiError}) {
 const uploads=createHeroUpload({apiError}),scope=(tid,sid,admin)=>JSON.stringify([tid,sid,admin.username||admin.id||admin.role])
 function ensureSchema(){db.exec(`CREATE TABLE IF NOT EXISTS store_guides(tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,steps_json TEXT NOT NULL DEFAULT '[]',revision INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(tenant_id,store_id))`)}
 function read(tid,sid){const r=db.prepare('SELECT * FROM store_guides WHERE tenant_id=? AND store_id=?').get(tid,sid);return {steps:r?JSON.parse(r.steps_json):[],revision:r?.revision||0}}
 function presentation(tid,sid){const r=read(tid,sid);return {...r,steps:r.steps.map((s,i)=>({...s,image:'/store-guide/image?tenantId='+encodeURIComponent(tid)+'&storeId='+encodeURIComponent(sid)+'&step='+i+'&revision='+r.revision}))}}
 function imageRoute(req,res,{path,query}){
  if(path!=='/store-guide/image')return false
  if(req.method!=='GET')throw apiError(405,'METHOD','不支持此操作。')
  const r=read(String(query.tenantId||''),String(query.storeId||'')),step=Number(query.step)
  if(!Number.isInteger(step)||step<0||Number(query.revision)!==r.revision||!r.steps[step])throw apiError(404,'NOT_FOUND','图片不存在。')
  const [header,data]=r.steps[step].image.split(',');res.writeHead(200,{'Content-Type':header.slice(5).split(';')[0],'Cache-Control':'private, max-age=300','X-Content-Type-Options':'nosniff'});res.end(Buffer.from(data,'base64'));return true
 }
 function save(tid,sid,{steps,revision}) {
  if(!db.prepare('SELECT id FROM stores WHERE tenant_id=? AND id=?').get(tid,sid))throw apiError(404,'NOT_FOUND','门店不存在。')
  if(!Array.isArray(steps)||steps.length>6||!Number.isInteger(revision)||revision<0)throw apiError(400,'BAD_REQUEST','最多6步，请刷新后重试。')
  const current=read(tid,sid),shown=presentation(tid,sid)
  const clean=steps.map(s=>{
   if(s&&typeof s.image==='string'&&s.image.startsWith('/store-guide/image?')){const i=shown.steps.findIndex(x=>x.image===s.image);if(i>=0)s={...s,image:current.steps[i].image}}

   if(!s||typeof s.description!=='string'||Array.from(s.description).length>50||typeof s.image!=='string'||s.image.length>1400000||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(s.image))throw apiError(400,'BAD_REQUEST','请上传图片，每步描述最多50字，图片需小于1MB。')
   return {image:s.image,description:s.description.trim()}
  })
  db.exec('SAVEPOINT store_guide_save')
  try {
   if(read(tid,sid).revision!==revision)throw apiError(409,'CONFLICT','其他设备已修改指引，请重新加载后编辑。')
   db.prepare('INSERT INTO store_guides VALUES(?,?,?,?) ON CONFLICT(tenant_id,store_id) DO UPDATE SET steps_json=excluded.steps_json,revision=excluded.revision').run(tid,sid,JSON.stringify(clean),revision+1)
   db.exec('RELEASE store_guide_save');return read(tid,sid)
  }catch(e){db.exec('ROLLBACK TO store_guide_save; RELEASE store_guide_save');throw e}
 }
 async function route(req,res,{path,query,admin,tid,json,readBody}) {
  if(!['/admin/store-guide','/admin/store-guide/upload'].includes(path))return false
  if(admin?.role!=='owner')throw apiError(403,'FORBIDDEN','仅店主可编辑到店指引。')
  const body=req.method==='PUT'?await readBody(req):query,sid=String(body.storeId||'')
  if(!db.prepare('SELECT id FROM stores WHERE tenant_id=? AND id=?').get(tid,sid))throw apiError(404,'NOT_FOUND','门店不存在。')
  if(path.endsWith('/upload')){if(req.method!=='PUT'||typeof body.image!=='string'||body.image.length>450000||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(body.image))throw apiError(400,'BAD_REQUEST','图片无效或过大。');const hash=createHash('sha256').update(body.image).digest('hex'),count=Math.ceil(body.image.length/100000);for(let index=0;index<count;index++)uploads.accept(scope(tid,sid,admin),{hash,index,count,chunk:body.image.slice(index*100000,(index+1)*100000)});json(res,200,{uploadRef:hash});return true}
  if(Array.isArray(body.steps))body.steps=body.steps.map(s=>s?.uploadRef?{...s,image:uploads.resolve(scope(tid,sid,admin),s.uploadRef)}:s)
  if(req.method==='GET')json(res,200,presentation(tid,sid));else if(req.method==='PUT'){save(tid,sid,body);json(res,200,presentation(tid,sid))}else throw apiError(405,'METHOD','不支持此操作。')
  return true
 }
 return {ensureSchema,read,save,route,presentation,imageRoute}
}
