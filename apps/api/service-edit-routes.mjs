/** Existing service/catalog writes extracted as one atomic metadata + independent-price operation. */
export function createServiceEditRoutes({db,apiError,currentTenantId,servicePayload,assertServicePriceOk,assertCategoryOk,serviceIdFrom,upsertServicePrice,serializeService,getService,pricingItemShape,writePricingItemPrices,serializePricingItem,memberPricing,json,readBody}) {
 function handle(req,res,{path,adminSession},input,json){
  if (req.method === 'GET' && path === '/admin/services') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    return json(res, 200, { services: db.prepare('SELECT * FROM services WHERE tenant_id = ? ORDER BY type ASC, sort_order ASC').all(currentTenantId()).map(serializeService) })
  }
  if (req.method === 'POST' && path === '/admin/services') {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const payload = servicePayload(input)
    if (!['NAIL', 'LASH', 'CARE', 'OTHER'].includes(payload.type)) throw apiError(400, 'BAD_REQUEST', '服务类型须为 美甲/美睫/护理/其他。')
    if (!payload.nameZh || !payload.nameEn) throw apiError(400, 'BAD_REQUEST', 'Service name is required.')
    assertServicePriceOk(payload)                              // 08-28 A5:价格/定金/时长后端兜底(前端拦不算数)
    assertCategoryOk(payload.categoryId, currentTenantId())   // 分类唯一真相律③:上架项目必须挂大类
    const id = serviceIdFrom(payload)
    db.prepare(`INSERT INTO services
      (id, tenant_id, type, category, category_id, name_zh, name_en, description_zh, description_en, image_url, image_view_json, price_cents, deposit_cents, base_duration_min, sort_order, is_active, process_json, notice_json, storefront, is_timecard)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, currentTenantId(), payload.type, payload.category, payload.categoryId, payload.nameZh, payload.nameEn, payload.descriptionZh, payload.descriptionEn, payload.imageUrl, payload.imageViewJson, payload.priceCents, payload.depositCents, payload.baseDurationMin, payload.sortOrder, payload.isActive, JSON.stringify(payload.processJson), JSON.stringify(payload.noticeJson), input.storefront === false ? 0 : 1, 0)
    // 2026-08-06:老「服务管理」页也走多价位模型的 list 档,保证 price_cents 与 service_prices(list) 永不漂移
    upsertServicePrice(currentTenantId(), id, 'list', payload.priceCents)
    const assign = db.prepare('INSERT OR IGNORE INTO technician_services (technician_id, service_id) VALUES (?, ?)')
    for (const tech of db.prepare('SELECT id FROM technicians WHERE is_active = 1 AND tenant_id = ?').all(currentTenantId())) assign.run(tech.id, id)
    return json(res, 201, { service: serializeService(getService(id)) })
  }

  if (req.method === 'PATCH' && path.startsWith('/admin/services/')) {
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
    const id = path.split('/')[3]
    const body = input
    const current = getService(id)
    if (!current || (current.tenant_id && current.tenant_id !== currentTenantId())) throw apiError(404, 'NOT_FOUND', 'Service not found.')
    if (Number(current.is_timecard) === 1) throw apiError(400, 'TIMECARD_MIGRATED', '次卡已迁出「服务与价目」,请在次卡管理中维护。')
    const payload = servicePayload(body, current)
    assertServicePriceOk(payload)                              // 08-28 A5:改价这条路同样兜底(建/改两口都过闸)
    assertCategoryOk(payload.categoryId, currentTenantId())   // 分类唯一真相律③
    db.prepare(`UPDATE services SET
      type = ?, category = ?, category_id = ?, name_zh = ?, name_en = ?, description_zh = ?, description_en = ?, image_url = ?, image_view_json = ?,
      price_cents = ?, deposit_cents = ?, base_duration_min = ?, is_active = ?, sort_order = ?, process_json = ?, notice_json = ?, storefront = ?
      WHERE id = ?`).run(payload.type, payload.category, payload.categoryId, payload.nameZh, payload.nameEn, payload.descriptionZh, payload.descriptionEn, payload.imageUrl, payload.imageViewJson, payload.priceCents, payload.depositCents, payload.baseDurationMin, payload.isActive, payload.sortOrder, JSON.stringify(payload.processJson), JSON.stringify(payload.noticeJson), body.storefront === undefined ? current.storefront : body.storefront ? 1 : 0, id)
    upsertServicePrice(currentTenantId(), id, 'list', payload.priceCents) // 同上:改价即同步 list 档
    return json(res, 200, { service: serializeService(getService(id)) })
  }

  if (path === '/admin/pricing/items' || path.startsWith('/admin/pricing/items/')) {
    const tid = currentTenantId()
    const itemId = path.split('/')[4] || null
    if (req.method === 'GET' && !itemId) {
      const rows = db.prepare('SELECT * FROM services WHERE tenant_id = ? ORDER BY item_kind ASC, sort_order ASC, rowid ASC').all(tid)
      return json(res, 200, { items: rows.map(serializePricingItem) })
    }
    if (req.method === 'POST' && !itemId) {
      const body = input
      const nameZh = String(body.nameZh || body.name || '').trim()
      if (!nameZh) throw apiError(400, 'BAD_REQUEST', '项目名称必填。')
      const id = serviceIdFrom({ type: body.type || 'OTHER', nameEn: body.nameEn, nameZh })
      const shape = pricingItemShape(body, {}, tid)
      const listCents = Math.max(0, Math.round(Number(body.listPriceCents ?? body.priceCents ?? 0) || 0))
      db.prepare(`INSERT INTO services
        (id, tenant_id, type, category, name_zh, name_en, description_zh, description_en, image_url, price_cents, deposit_cents, base_duration_min, sort_order, is_active, process_json, notice_json,
         item_kind, category_id, unit, price_rule, price_rule_value, addon_scope_json, addon_group, storefront, is_timecard, price_mode)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, tid, shape.type, shape.categoryName, nameZh, String(body.nameEn || nameZh), String(body.descriptionZh || ''), String(body.descriptionEn || ''),
        String(body.imageUrl || ''), listCents,   // 同上:加项也不塞默认图
        Math.max(0, Math.round(Number(body.depositCents ?? 0) || 0)),
        Math.max(0, Math.round(Number(body.baseDurationMin ?? 60) || 0)),
        Math.round(Number(body.sortOrder) || 0), body.isActive === false ? 0 : 1, '[]', '[]',
        shape.itemKind, shape.categoryId, shape.unit, shape.priceRule, shape.priceRuleValue, JSON.stringify(shape.addonScope), shape.addonGroup || null,
        shape.itemKind === 'main' ? (body.storefront === false ? 0 : 1) : 0, 0, shape.priceMode)
      writePricingItemPrices(tid, id, body, listCents)
      // 主项目自动分配给全部在职技师(与 /admin/services 同规则);加项不占技师能力位
      if (shape.itemKind === 'main') {
        const assign = db.prepare('INSERT OR IGNORE INTO technician_services (technician_id, service_id) VALUES (?, ?)')
        for (const tech of db.prepare('SELECT id FROM technicians WHERE is_active = 1 AND tenant_id = ?').all(tid)) assign.run(tech.id, id)
      }
      return json(res, 201, { item: serializePricingItem(db.prepare('SELECT * FROM services WHERE id = ?').get(id)) })
    }
    if (req.method === 'PATCH' && itemId) {
      const cur = db.prepare('SELECT * FROM services WHERE id = ? AND tenant_id = ?').get(itemId, tid)
      if (!cur) throw apiError(404, 'NOT_FOUND', 'Item not found.')
      /* S1 合同规则③:次卡不属于服务目录,已迁出本页;编辑一律拒绝,S2 次卡管理接手。 */
      if (Number(cur.is_timecard) === 1) throw apiError(400, 'TIMECARD_MIGRATED', '次卡已迁出「服务与价目」,请在次卡管理中维护。')
      const body = input
      const shape = pricingItemShape(body, cur, tid)
      const listCents = body.listPriceCents === undefined && body.priceCents === undefined
        ? cur.price_cents
        : Math.max(0, Math.round(Number(body.listPriceCents ?? body.priceCents) || 0))
      db.prepare(`UPDATE services SET type = ?, category = ?, name_zh = ?, name_en = ?, price_cents = ?, deposit_cents = ?, base_duration_min = ?,
        sort_order = ?, is_active = ?, storefront = ?, item_kind = ?, category_id = ?, unit = ?, price_rule = ?, price_rule_value = ?, addon_scope_json = ?, addon_group = ?, price_mode = ? WHERE id = ?`).run(
        shape.type, shape.categoryName,
        body.nameZh === undefined ? cur.name_zh : String(body.nameZh).trim().slice(0, 60) || cur.name_zh,
        body.nameEn === undefined ? cur.name_en : String(body.nameEn).trim().slice(0, 80),
        listCents,
        body.depositCents === undefined ? cur.deposit_cents : Math.max(0, Math.round(Number(body.depositCents) || 0)),
        body.baseDurationMin === undefined ? cur.base_duration_min : Math.max(0, Math.round(Number(body.baseDurationMin) || 0)),
        body.sortOrder === undefined ? cur.sort_order : Math.round(Number(body.sortOrder) || 0),
        body.isActive === undefined ? cur.is_active : (body.isActive ? 1 : 0),
        body.storefront === undefined ? (cur.storefront === null ? (cur.item_kind === 'main' && cur.is_active ? 1 : 0) : cur.storefront) : (body.storefront ? 1 : 0),
        shape.itemKind, shape.categoryId, shape.unit, shape.priceRule, shape.priceRuleValue, JSON.stringify(shape.addonScope), shape.addonGroup || null, shape.priceMode, itemId)
      writePricingItemPrices(tid, itemId, body, listCents)
      return json(res, 200, { item: serializePricingItem(db.prepare('SELECT * FROM services WHERE id = ?').get(itemId)) })
    }
    if (req.method === 'DELETE' && itemId) {
      const cur = db.prepare('SELECT * FROM services WHERE id = ? AND tenant_id = ?').get(itemId, tid)
      if (!cur) throw apiError(404, 'NOT_FOUND', 'Item not found.')
      // 有历史订单引用的项目不能物理删(会断掉订单溯源),改为下架
      const used = db.prepare('SELECT COUNT(*) AS n FROM bookings WHERE service_id = ?').get(itemId).n
      if (used > 0) {
        db.prepare('UPDATE services SET is_active = 0 WHERE id = ?').run(itemId)
        return json(res, 200, { deleted: false, disabled: true, reason: `该项目有 ${used} 笔历史订单,已改为下架而非删除。` })
      }
      db.prepare('DELETE FROM service_prices WHERE service_id = ?').run(itemId)
      db.prepare('DELETE FROM technician_services WHERE service_id = ?').run(itemId)
      db.prepare('DELETE FROM services WHERE id = ?').run(itemId)
      return json(res, 200, { deleted: true })
    }
  }

 }
 return async(req,res,ctx)=>{
  if(!((ctx.path==='/admin/services'&&['GET','POST'].includes(req.method))||(/^\/admin\/services\/[^/]+$/.test(ctx.path)&&req.method==='PATCH')||(/^\/admin\/pricing\/items(?:\/[^/]+)?$/.test(ctx.path)&&['GET','POST','PATCH','DELETE'].includes(req.method))))return false;
  const write=['POST','PATCH','DELETE'].includes(req.method);
  if(write&&ctx.adminSession.role!=='owner')throw apiError(403,'FORBIDDEN','仅老板可修改服务与价格。');
  const input=['POST','PATCH'].includes(req.method)?await readBody(req):{};
  const update=input.priceSystemUpdate;
  if(update&&!['display','settlement'].includes(update.system))throw apiError(400,'INVALID_PRICE_SYSTEM','价格体系无效。');
  let output;
  const reply=(_r,status,data,headers)=>{output={status,data,headers}};
  if(write)db.exec('SAVEPOINT service_edit');
  try{
   const id=ctx.path.split('/')[ctx.path.startsWith('/admin/pricing/items')?4:3];
   if(update&&id)memberPricing.setPrices(currentTenantId(),id,update.system,update);
   handle(req,res,ctx,input,reply);
   if(!output)throw apiError(404,'NOT_FOUND','没有这个服务操作。');
   if(update&&!id){const created=output.data.item||output.data.service;memberPricing.setPrices(currentTenantId(),created.id,update.system,update)}
   if(write)db.exec('RELEASE service_edit');
  }catch(e){if(write)db.exec('ROLLBACK TO service_edit; RELEASE service_edit');throw e}
  json(res,output.status,output.data,output.headers);return true
 }
}
