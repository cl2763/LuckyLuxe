import {beginWriteSavepoint} from './write-savepoint.mjs'
import {assertRecordActive,activeRecords} from './record-lifecycle.mjs'
// Merchant and platform configuration share these definition-only operations.
// Issuing, redeeming and reversing rewards remain in their transaction routes.
export function createMarketingDefinitions({db,apiError,readBody,json,currentTenantId,randomId,iso,serializeCoupon,serializePrize,assertCouponValueOk}) {
 function handle(req,res,{path,adminSession},input,json) {
  // ===== 优惠券 定义 CRUD =====
  if (req.method === 'GET' && path === '/admin/coupons') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    // 特批券是「自定义发放」当场生成的一次性券,不属于券模板 —— 不进模板列表
    return json(res, 200, { coupons: db.prepare('SELECT * FROM coupons WHERE tenant_id = ? AND is_custom = 0 ORDER BY created_at DESC').all(currentTenantId()).filter(r=>activeRecords(db,currentTenantId(),'coupons',[r]).length).map(serializeCoupon) })
  }
  if (req.method === 'POST' && path === '/admin/coupons') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const body = input
    const name = String(body.name || '').trim()
    if (!name) throw apiError(400, 'BAD_REQUEST', '优惠券名称必填。')
    const discountType = body.discountType === 'percent' ? 'percent' : 'amount'
    // 08-28 A3:券面额/折扣的后端闸(实现在 ./write-gates.mjs,前端拦不算数)
    assertCouponValueOk({ discountType, amountCents: Math.round(Number(body.amountCents) || 0), percentOff: Math.round(Number(body.percentOff) || 0) })
    const id = randomId('cpn')
    db.prepare(`INSERT INTO coupons (id, tenant_id, name, discount_type, amount_cents, percent_off, min_spend_cents, valid_days, total_qty, issued_qty, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`).run(
      id, currentTenantId(), name, discountType,
      Math.max(0, Math.round(Number(body.amountCents) || 0)),
      Math.max(0, Math.min(100, Math.round(Number(body.percentOff) || 0))),
      Math.max(0, Math.round(Number(body.minSpendCents) || 0)),
      Math.max(1, Math.round(Number(body.validDays) || 30)),
      Math.max(0, Math.round(Number(body.totalQty) || 0)),
      body.isActive === false ? 0 : 1, iso(new Date()))
    return json(res, 201, { coupon: serializeCoupon(db.prepare('SELECT * FROM coupons WHERE id = ?').get(id)) })
  }

  // ===== 积分商城 · 老板奖品管理 =====
  if (req.method === 'GET' && path === '/admin/points-prizes') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const rows = db.prepare('SELECT * FROM points_prizes WHERE tenant_id = ? ORDER BY created_at DESC').all(currentTenantId())
    return json(res, 200, { prizes: activeRecords(db,currentTenantId(),'points-prizes',rows).map((r) => serializePrize(r)) })
  }
  if (req.method === 'POST' && path === '/admin/points-prizes') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const body = input
    const coupon = db.prepare('SELECT * FROM coupons WHERE id = ? AND tenant_id = ?').get(String(body.couponId || ''), currentTenantId())
    if (!coupon) throw apiError(404, 'NOT_FOUND', '券不存在,先到 会员套餐/券 里建一张。')
    const cost = Math.max(1, Math.round(Number(body.costPoints) || 0))
    const id = randomId('prize')
    const now = iso(new Date())
    db.prepare(`INSERT INTO points_prizes (id, tenant_id, coupon_id, cost_points, stock, per_user_limit, valid_days, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, currentTenantId(), coupon.id, cost,
      Math.max(0, Math.round(Number(body.stock) || 0)),
      Math.max(0, Math.round(Number(body.perUserLimit) || 0)),
      Number(body.validDays) > 0 ? Math.min(365, Math.round(Number(body.validDays))) : null,
      body.isActive === false ? 0 : 1, now, now)
    return json(res, 201, { prize: serializePrize(db.prepare('SELECT * FROM points_prizes WHERE id = ?').get(id)) })
  }
  if (req.method === 'PATCH' && path.match(/^\/admin\/points-prizes\/[^/]+$/)) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const id = path.split('/')[3]
    const r = db.prepare('SELECT * FROM points_prizes WHERE id = ? AND tenant_id = ?').get(id, currentTenantId())
    if (!r) throw apiError(404, 'NOT_FOUND', '奖品不存在。')
    const body = input
    const cost = body.costPoints != null ? Math.max(1, Math.round(Number(body.costPoints) || r.cost_points)) : r.cost_points
    const stock = body.stock != null ? Math.max(0, Math.round(Number(body.stock) || 0)) : r.stock
    const limit = body.perUserLimit != null ? Math.max(0, Math.round(Number(body.perUserLimit) || 0)) : r.per_user_limit
    const vd = body.validDays !== undefined ? (Number(body.validDays) > 0 ? Math.min(365, Math.round(Number(body.validDays))) : null) : r.valid_days
    const active = body.isActive != null ? (body.isActive ? 1 : 0) : r.is_active
    db.prepare('UPDATE points_prizes SET cost_points = ?, stock = ?, per_user_limit = ?, valid_days = ?, is_active = ?, updated_at = ? WHERE id = ?')
      .run(cost, stock, limit, vd, active, iso(new Date()), id)
    return json(res, 200, { prize: serializePrize(db.prepare('SELECT * FROM points_prizes WHERE id = ?').get(id)) })
  }

  if (req.method === 'PATCH' && path.startsWith('/admin/coupons/')) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const id = path.split('/')[3]
    const cur = db.prepare('SELECT * FROM coupons WHERE id = ? AND tenant_id = ?').get(id, currentTenantId())
    if (!cur) throw apiError(404, 'NOT_FOUND', 'Coupon not found.')
    const body = input
    db.prepare(`UPDATE coupons SET name = ?, discount_type = ?, amount_cents = ?, percent_off = ?, min_spend_cents = ?, valid_days = ?, total_qty = ?, is_active = ? WHERE id = ?`).run(
      body.name === undefined ? cur.name : String(body.name).trim(),
      body.discountType === undefined ? cur.discount_type : (body.discountType === 'percent' ? 'percent' : 'amount'),
      body.amountCents === undefined ? cur.amount_cents : Math.max(0, Math.round(Number(body.amountCents) || 0)),
      body.percentOff === undefined ? cur.percent_off : Math.max(0, Math.min(100, Math.round(Number(body.percentOff) || 0))),
      body.minSpendCents === undefined ? cur.min_spend_cents : Math.max(0, Math.round(Number(body.minSpendCents) || 0)),
      body.validDays === undefined ? cur.valid_days : Math.max(1, Math.round(Number(body.validDays) || 30)),
      body.totalQty === undefined ? cur.total_qty : Math.max(0, Math.round(Number(body.totalQty) || 0)),
      body.isActive === undefined ? cur.is_active : (body.isActive ? 1 : 0), id)
    return json(res, 200, { coupon: serializeCoupon(db.prepare('SELECT * FROM coupons WHERE id = ?').get(id)) })
  }
 }
 const matches=(method,path)=>(['GET','POST'].includes(method)&&['/admin/coupons','/admin/points-prizes'].includes(path))||(method==='PATCH'&&/^\/admin\/(coupons|points-prizes)\/[^/]+$/.test(path))
 function configure({method,path,body={},adminSession}){
  if(!matches(method,path))throw apiError(404,'NOT_FOUND','没有这个配置操作。')
  let output
  const reply=(_res,status,data)=>{output={status,data}}
  let scope
  if(path.startsWith('/admin/coupons')&&method!=='GET'&&body.scopeCategoryIds!==undefined){
   if(!Array.isArray(body.scopeCategoryIds)||body.scopeCategoryIds.length>100||body.scopeCategoryIds.some(id=>typeof id!=='string'||!db.prepare('SELECT 1 FROM service_categories WHERE id=? AND tenant_id=?').get(id,currentTenantId())))throw apiError(400,'INVALID_COUPON_SCOPE','请选择本店有效的大类作为适用范围。')
   scope=[...new Set(body.scopeCategoryIds)].sort()
   if(method==='PATCH'){
    const id=path.split('/')[3],cur=db.prepare('SELECT scope_categories_json FROM coupons WHERE id=? AND tenant_id=?').get(id,currentTenantId())
    if(cur&&JSON.stringify(JSON.parse(cur.scope_categories_json||'[]').sort())!==JSON.stringify(scope)&&db.prepare('SELECT 1 FROM coupon_grants WHERE coupon_id=? AND tenant_id=? LIMIT 1').get(id,currentTenantId()))throw apiError(409,'COUPON_ALREADY_ISSUED','这张模板已有发放记录。请复制为新模板，避免改变顾客已持有券的范围。')
   }
  }
  if(method==='PATCH')assertRecordActive(db,apiError,currentTenantId(),path.split('/')[2],path.split('/')[3])
  if(method!=='GET')beginWriteSavepoint(db, 'marketing_definition', 'membership_packages')
  try{
   handle({method},null,{path,adminSession},body,reply)
   if(scope){db.prepare('UPDATE coupons SET scope_categories_json=? WHERE id=? AND tenant_id=?').run(JSON.stringify(scope),output.data.coupon.id,currentTenantId());output.data.coupon=serializeCoupon(db.prepare('SELECT * FROM coupons WHERE id=? AND tenant_id=?').get(output.data.coupon.id,currentTenantId()))}
   if(method!=='GET')db.exec('RELEASE marketing_definition')
  }catch(e){if(method!=='GET')db.exec('ROLLBACK TO marketing_definition; RELEASE marketing_definition');throw e}
  return output
 }
 async function route(req,res,ctx){
  if(!matches(req.method,ctx.path))return false
  const body=req.method==='GET'?{}:await readBody(req)
  const output=configure({method:req.method,path:ctx.path,body,adminSession:ctx.adminSession})
  json(res,output.status,output.data);return true
 }
 return {route,configure}
}
