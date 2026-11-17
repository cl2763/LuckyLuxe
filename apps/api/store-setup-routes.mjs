import {beginWriteSavepoint} from './write-savepoint.mjs'
import {readBookingAcceptance,validateAcceptance,writeAcceptance} from './booking-window.mjs'
import {businessHoursRevision} from './business-hours-write.mjs'
// Configuration-only writes shared by merchants and platform drafts.
export function createStoreSetupDefinitions({db,apiError,readBody,json,currentTenantId,defaultStoreId,iso,parseJson2,specialDateInput,getDepositConfig,setDepositConfig}) {
 function handle(req,res,{path,adminSession},input,json) {
  if (req.method === 'PUT' && path === '/admin/store-info') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const body = input
    const storeId = body.storeId || defaultStoreId()
    const store = db.prepare('SELECT * FROM stores WHERE id = ? AND tenant_id = ?').get(storeId, currentTenantId())
    if (!store) throw apiError(404, 'NOT_FOUND', 'Store not found.')
    const name = String(body.name ?? store.name).trim() || store.name
    const address = String(body.address ?? store.address ?? '').trim()
    const phone = String(body.phone ?? store.phone ?? '').trim()
    db.prepare('UPDATE stores SET name = ?, address = ?, phone = ? WHERE id = ?').run(name, address, phone, storeId)
    // 地址来源合一:同步进租户知识库事实,AI 回答与订单系统永远一致
    const factStmt = db.prepare(`
      INSERT INTO tenant_kb_facts (tenant_id, key, value, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at
    `)
    if (address) factStmt.run(currentTenantId(), 'storeAddress', address, adminSession.email || 'owner', iso(new Date()))
    if (phone) factStmt.run(currentTenantId(), 'storePhone', phone, adminSession.email || 'owner', iso(new Date()))
    return json(res, 200, { store: db.prepare('SELECT id, name, address, phone FROM stores WHERE id = ? AND tenant_id = ?').get(storeId, currentTenantId()) })
  }
  if (req.method === 'POST' && path === '/admin/special-dates') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const body = input
    const isClosed = specialDateInput(body,apiError)
    const storeId = body.storeId || defaultStoreId()
    if (!db.prepare('SELECT id FROM stores WHERE id = ? AND tenant_id = ?').get(storeId, currentTenantId())) throw apiError(404, 'NOT_FOUND', 'Store not found.')
    beginWriteSavepoint(db, 'special_date_write', 'stores')
    try {
      if(body.expectedConfigRevision!==undefined&&body.expectedConfigRevision!==businessHoursRevision(db,storeId,currentTenantId()))throw apiError(409,'CONFIG_CHANGED','营业规则已在其他设备更新，请核对后再保存。')
      const acceptance=readBookingAcceptance(db,storeId,currentTenantId())
      if(Object.hasOwn(body,'latestStartTime'))acceptance.special[body.date]=isClosed?null:body.latestStartTime||null
      const next={date:body.date,isClosed,openTime:body.openTime,closeTime:body.closeTime}
      const specials=db.prepare('SELECT * FROM store_special_dates WHERE store_id=? AND date<>?').all(storeId,body.date).concat(next)
      validateAcceptance(acceptance,db.prepare('SELECT * FROM business_hours WHERE store_id=?').all(storeId),specials,apiError)
      db.prepare(`INSERT INTO store_special_dates (store_id, date, is_closed, open_time, close_time, note)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(store_id, date) DO UPDATE SET is_closed = excluded.is_closed, open_time = excluded.open_time, close_time = excluded.close_time, note = excluded.note`)
        .run(storeId, body.date, Number(isClosed), isClosed ? null : body.openTime, isClosed ? null : body.closeTime, String(body.note || '').slice(0, 100) || null)
      if(Object.hasOwn(body,'latestStartTime'))writeAcceptance(db,storeId,acceptance,iso(new Date()),currentTenantId())
      db.exec('RELEASE special_date_write')
    }catch(e){db.exec('ROLLBACK TO special_date_write; RELEASE special_date_write');throw e}
    return json(res, 201, { specialDate: db.prepare('SELECT * FROM store_special_dates WHERE store_id = ? AND date = ?').get(storeId, body.date),configRevision:businessHoursRevision(db,storeId,currentTenantId()) })
  }
  if(req.method==='DELETE'&&path.startsWith('/admin/special-dates/')){
    if(adminSession.role!=='owner')throw apiError(403,'FORBIDDEN','Owner permission is required.')
    const date=path.split('/')[3],storeId=input.storeId||defaultStoreId()
    if(!db.prepare('SELECT id FROM stores WHERE id=? AND tenant_id=?').get(storeId,currentTenantId()))throw apiError(404,'NOT_FOUND','Store not found.')
    beginWriteSavepoint(db, 'special_date_delete', 'stores')
    try{
      if(input.expectedConfigRevision!==undefined&&input.expectedConfigRevision!==businessHoursRevision(db,storeId,currentTenantId()))throw apiError(409,'CONFIG_CHANGED','营业规则已更新，请重新核对。')
      const result=db.prepare('DELETE FROM store_special_dates WHERE store_id=? AND date=?').run(storeId,date)
      if(!result.changes)throw apiError(404,'NOT_FOUND','Special date not found.')
      const acceptance=readBookingAcceptance(db,storeId,currentTenantId())
      if(Object.hasOwn(acceptance.special,date)){delete acceptance.special[date];writeAcceptance(db,storeId,acceptance,iso(new Date()),currentTenantId())}
      db.exec('RELEASE special_date_delete')
    }catch(e){db.exec('ROLLBACK TO special_date_delete; RELEASE special_date_delete');throw e}
    return json(res,200,{deleted:date,configRevision:businessHoursRevision(db,storeId,currentTenantId())})
  }

  if (req.method === 'GET' && path === '/admin/booking-rules') {
    const row = db.prepare("SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = 'booking_rules'").get(currentTenantId())
    return json(res, 200, { rules: {...(row ? parseJson2(row.value) : {}),onlineDeposit:getDepositConfig(currentTenantId()).enabled} })
  }
  if (req.method === 'PUT' && path === '/admin/booking-rules') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可改预约规则。')
    const body = input
    if(typeof body.onlineDeposit!=='boolean')throw apiError(400,'BAD_REQUEST','定金开关须为开启或关闭。')
    if(body.onlineDeposit&&!getDepositConfig(currentTenantId()).enabled)throw apiError(409,'DEPOSIT_SWITCH_MOVED','请到“定金与取消规则”开启本店预约定金。')
    const config=setDepositConfig(currentTenantId(),{enabled:body.onlineDeposit})
    return json(res, 200, { rules:{onlineDeposit:config.enabled} })
  }
 }
 const matches=(m,p)=>m==='DELETE'&&/^\/admin\/special-dates\/[^/]+$/.test(p)||m==='PUT'&&p==='/admin/store-info'||m==='POST'&&p==='/admin/special-dates'||['GET','PUT'].includes(m)&&p==='/admin/booking-rules'
 function configure({method,path,body={},adminSession}){let result
  if(!matches(method,path))throw apiError(404,'NOT_FOUND','配置操作不存在。')
  handle({method},null,{path,adminSession},body,(_res,status,data)=>{result={status,data}});return result
 }
 async function route(req,res,ctx){if(!matches(req.method,ctx.path))return false
  const result=configure({method:req.method,path:ctx.path,body:req.method==='GET'?{}:req.method==='DELETE'?(ctx.query||{}):await readBody(req),adminSession:ctx.adminSession});json(res,result.status,result.data);return true
 }
 return {configure,route}
}
