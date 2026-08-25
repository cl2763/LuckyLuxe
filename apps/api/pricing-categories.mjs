/* 大类字典 CRUD(从 local-server.mjs 搬出,2026-08-25 S13)。

   为什么搬:同一套增删改**原来写了两遍** —— 商家线 /admin/pricing/categories 一份,
   S13② 新加的平台线 /platform/tenants/:id/categories 又一份。两份迟早各自长歪。
   现在一处实现两条线共用:门禁各自在路由上判(商家=老板,平台=isPlatform),
   业务规则(名称必填 / key 唯一 / 有项目不许删)只有这一份。 */
export function createPricingCategories({ db, apiError, randomId, iso, serialize, listOf }) {
  function list(tenantId) {
    return listOf(tenantId).map(serialize)
  }

  function create(tenantId, body = {}) {
    const name = String(body.name || '').trim()
    if (!name) throw apiError(400, 'BAD_REQUEST', '大类名称必填。')
    const key = String(body.key || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || `cat-${name.length}${Date.now().toString(36).slice(-4)}`
    if (db.prepare('SELECT id FROM service_categories WHERE tenant_id = ? AND key = ?').get(tenantId, key)) throw apiError(409, 'DUPLICATE', `大类标识 ${key} 已存在。`)
    const id = randomId('cat')
    db.prepare(`INSERT INTO service_categories (id, tenant_id, key, name, sort_order, is_bookable, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, tenantId, key, name.slice(0, 40),
      Math.round(Number(body.sortOrder) || 0), body.isBookable === false ? 0 : 1, String(body.note || '').slice(0, 200) || null, iso(new Date()))
    return serialize(db.prepare('SELECT * FROM service_categories WHERE id = ?').get(id))
  }

  function patch(tenantId, catId, body = {}) {
    const cur = db.prepare('SELECT * FROM service_categories WHERE id = ? AND tenant_id = ?').get(catId, tenantId)
    if (!cur) throw apiError(404, 'NOT_FOUND', 'Category not found.')
    db.prepare('UPDATE service_categories SET name = ?, sort_order = ?, is_bookable = ?, note = ? WHERE id = ?').run(
      body.name === undefined ? cur.name : String(body.name).trim().slice(0, 40) || cur.name,
      body.sortOrder === undefined ? cur.sort_order : Math.round(Number(body.sortOrder) || 0),
      body.isBookable === undefined ? cur.is_bookable : (body.isBookable ? 1 : 0),
      body.note === undefined ? cur.note : (String(body.note).slice(0, 200) || null), catId)
    return serialize(db.prepare('SELECT * FROM service_categories WHERE id = ?').get(catId))
  }

  /* 删除保护:该大类下还有项目就不许删 —— 两条线同一条规则,不因为在平台后台就放松。 */
  function remove(tenantId, catId) {
    const cur = db.prepare('SELECT * FROM service_categories WHERE id = ? AND tenant_id = ?').get(catId, tenantId)
    if (!cur) throw apiError(404, 'NOT_FOUND', 'Category not found.')
    const used = db.prepare('SELECT COUNT(*) AS n FROM services WHERE tenant_id = ? AND category_id = ?').get(tenantId, catId).n
    if (used > 0) throw apiError(409, 'CATEGORY_IN_USE', `该大类下还有 ${used} 个项目,请先移走或删除项目。`)
    db.prepare('DELETE FROM service_categories WHERE id = ?').run(catId)
    return { deleted: true }
  }

  /* 🔴 分类唯一真相律③(店主 2026-08-25):**建店时默认落平台三大类**。
     不铺的话新店一开就是"零大类",项目挂不上大类 → 上架被拦 → 看起来像功能坏了。
     平台三类是**起点不是上限**:商家可以细分(小婕就细成六类:美甲单色/简单款式/复杂款式/美睫/护理/卸甲)。
     幂等:已经有大类的店一行不动。 */
  function seedDefaults(tenantId, platformCats) {
    const has = db.prepare('SELECT COUNT(*) n FROM service_categories WHERE tenant_id = ?').get(tenantId).n
    if (has > 0) return { seeded: 0, skipped: true }
    let n = 0
    for (const [i, c] of (platformCats || []).entries()) {
      try { create(tenantId, { name: c.nameZh, key: c.key, sortOrder: i }); n += 1 } catch (e) { /* 撞名跳过 */ }
    }
    return { seeded: n, skipped: false }
  }

  return { list, create, patch, remove, seedDefaults }
}
