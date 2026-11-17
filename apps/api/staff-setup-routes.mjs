import {beginWriteSavepoint} from './write-savepoint.mjs'
import {assertRecordActive,activeRecords} from './record-lifecycle.mjs'
export function createStaffSetupDefinitions({db,apiError,readBody,json,currentTenantId,defaultStoreId,randomId}){
 function handle(req,res,{path,adminSession},input,json){
  if (req.method === 'POST' && path === '/admin/technicians') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const body = input
    const name = String(body.name || '').trim()
    if (!name) throw apiError(400, 'BAD_REQUEST', 'Technician name is required.')
    const id = randomId('tech')
    db.prepare('INSERT INTO technicians (id, store_id, name, title, is_active, tenant_id) VALUES (?, ?, ?, ?, 1, ?)')
      .run(id, body.storeId || defaultStoreId(), name, String(body.title || '').trim() || null, currentTenantId())
    // 默认可做本店所有在售服务(与新增服务时的自动指派保持一致)
    const assign = db.prepare('INSERT OR IGNORE INTO technician_services (technician_id, service_id) VALUES (?, ?)')
    for (const service of db.prepare('SELECT id FROM services WHERE is_active = 1 AND tenant_id = ?').all(currentTenantId())) assign.run(id, service.id)
    return json(res, 201, { technician: db.prepare('SELECT * FROM technicians WHERE id = ? AND tenant_id = ?').get(id, currentTenantId()) })
  }
  if (req.method === 'PATCH' && path.startsWith('/admin/technicians/') && !path.endsWith('/schedule')) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const technicianId = path.split('/')[3]
    const current = db.prepare('SELECT * FROM technicians WHERE id = ? AND tenant_id = ?').get(technicianId, currentTenantId())
    if (!current) throw apiError(404, 'NOT_FOUND', 'Technician not found.')
    assertRecordActive(db,apiError,currentTenantId(),'technicians',technicianId)
    const body = input
    const name = String(body.name ?? current.name).trim() || current.name
    const title = body.title === undefined ? current.title : (String(body.title || '').trim() || null)
    const isActive = body.isActive === undefined ? current.is_active : Number(Boolean(body.isActive))
    db.prepare('UPDATE technicians SET name = ?, title = ?, is_active = ? WHERE id = ?').run(name, title, isActive, technicianId)
    return json(res, 200, { technician: db.prepare('SELECT * FROM technicians WHERE id = ? AND tenant_id = ?').get(technicianId, currentTenantId()) })
  }
 }
 const matches=(m,p)=>m==='POST'&&p==='/admin/technicians'||m==='PATCH'&&/^\/admin\/technicians\/[^/]+$/.test(p)
 function configure({method,path,body={},adminSession}){
  if(!matches(method,path))throw apiError(404,'NOT_FOUND','技师配置不存在。')
  const tid=currentTenantId();let output
  if(body.storeId&&!db.prepare('SELECT id FROM stores WHERE id=? AND tenant_id=?').get(body.storeId,tid))throw apiError(404,'NOT_FOUND','门店不存在。')
  if(body.serviceIds!==undefined&&(!Array.isArray(body.serviceIds)||body.serviceIds.length>500||body.serviceIds.some(id=>typeof id!=='string'||!db.prepare('SELECT id FROM services WHERE id=? AND tenant_id=?').get(id,tid))))throw apiError(400,'BAD_SERVICES','请选择本店有效的服务项目。')
  beginWriteSavepoint(db, 'technician_config', 'technicians')
  try{handle({method},null,{path,adminSession},body,(_res,status,data)=>{output={status,data}})
   if(method==='POST'&&body.isActive===false){db.prepare('UPDATE technicians SET is_active=0 WHERE id=? AND tenant_id=?').run(output.data.technician.id,tid);output.data.technician.is_active=0}
   if(body.serviceIds!==undefined){const id=output.data.technician.id;db.prepare('DELETE FROM technician_services WHERE technician_id=?').run(id);for(const sid of new Set(body.serviceIds))db.prepare('INSERT INTO technician_services(technician_id,service_id) VALUES(?,?)').run(id,sid)}
   db.exec('RELEASE technician_config');return output
  }catch(e){db.exec('ROLLBACK TO technician_config; RELEASE technician_config');throw e}
 }
 async function route(req,res,ctx){if(!matches(req.method,ctx.path))return false;const r=configure({method:req.method,path:ctx.path,body:await readBody(req),adminSession:ctx.adminSession});json(res,r.status,r.data);return true}
 return {configure,route}
}
