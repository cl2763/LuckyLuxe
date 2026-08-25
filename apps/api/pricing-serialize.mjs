/* 价目表序列化与入参整形(从 local-server.mjs 搬出,2026-08-25)。

   本批动的就是这一域(【分类唯一真相律】改了 pricingItemShape 的分类判定),
   按公约②「边改边拆」整域搬出;**行为一字未改**,依赖注入。

   这里住着分类唯一真相律的两条实现细节:
     · 写入只认 categoryId,自由文本 category 一律不接受;
     · 主项目要上架就必须挂大类,不挂即拒(CATEGORY_REQUIRED)。 */
export function createPricingSerialize({ db, apiError, currentTenantId, cents, formatMoneyCents, categoryNameOf, timecardUnitCents, servicePriceMap, startingPriceCentsOf }) {
  function pricingCategories(tenantId = currentTenantId()) {
    return db.prepare('SELECT * FROM service_categories WHERE tenant_id = ? ORDER BY sort_order ASC, rowid ASC').all(tenantId)
  }

  function pricingItemShape(body = {}, cur = {}, tenantId = currentTenantId()) {
    const itemKind = body.itemKind === undefined ? (cur.item_kind || 'main') : (body.itemKind === 'addon' ? 'addon' : 'main')
    /* 🔴 分类唯一真相律(店主 2026-08-25 立):
       ① 写入路径**不再接受** body.category 那个自由文本 —— 传了也不看(不报错,直接忽略,
          免得老前端/老脚本一升级就整批失败);真相只认 categoryId。
       ② 主项目**必须挂一个大类才准上架** —— 不挂即拒,不许悄悄留空。
          (加项/次卡不在此列:它们不进顾客端橱窗,没有分组问题。) */
    const categoryId = body.categoryId === undefined ? (cur.category_id || null) : (String(body.categoryId || '').trim() || null)
    let categoryName = ''
    if (categoryId) {
      const cat = db.prepare('SELECT * FROM service_categories WHERE id = ? AND tenant_id = ?').get(categoryId, tenantId)
      if (!cat) throw apiError(400, 'BAD_REQUEST', '大类不存在或不属于本店。')
      categoryName = cat.name
    }
    const wantsStorefront = body.storefront === undefined
      ? (cur.storefront === null ? (cur.item_kind === 'main' && cur.is_active) : Boolean(cur.storefront))
      : Boolean(body.storefront)
    if (itemKind === 'main' && wantsStorefront && !categoryId) {
      throw apiError(400, 'CATEGORY_REQUIRED',
        '这个项目还没挂大类,不能上架 —— 顾客端按大类分组,不挂就会变成一个人一组。请先在「大类」里选一个。')
    }
    const type = String(body.type || cur.type || 'OTHER').toUpperCase()
    let addonScope = []
    if (Array.isArray(body.addonScope)) addonScope = body.addonScope.map((item) => String(item))
    else { try { addonScope = JSON.parse(cur.addon_scope_json || '[]') } catch { addonScope = [] } }
    return {
      itemKind,
      categoryId,
      categoryName,
      unit: ['once', 'per_finger', 'per_session'].includes(body.unit) ? body.unit : (cur.unit || 'once'),
      priceRule: ['fixed', 'pct_of_tier_price'].includes(body.priceRule) ? body.priceRule : (cur.price_rule || 'fixed'),
      priceRuleValue: body.priceRuleValue === undefined ? (cur.price_rule_value || 0) : (Number(body.priceRuleValue) || 0),
      addonScope,
      // 加项组名:商家自填(如「延长类」「补甲类」「卸甲类」);留空 = 归「其他加项」
      addonGroup: body.addonGroup === undefined ? (cur.addon_group || '') : String(body.addonGroup || '').trim().slice(0, 20),
      type: ['NAIL', 'LASH', 'CARE', 'OTHER'].includes(type) ? type : 'OTHER'
    }
  }

  function serializePricingCategory(row) {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      sortOrder: row.sort_order,
      isBookable: Boolean(row.is_bookable),
      note: row.note || '',
      itemCount: db.prepare('SELECT COUNT(*) AS n FROM services WHERE tenant_id = ? AND category_id = ?').get(row.tenant_id, row.id).n
    }
  }

  function serializePricingItem(row) {
    const prices = servicePriceMap(row.id)
    let addonScope = []
    try { addonScope = JSON.parse(row.addon_scope_json || '[]') } catch { addonScope = [] }
    return {
      id: row.id,
      nameZh: row.name_zh,
      nameEn: row.name_en || '',
      type: row.type,
      itemKind: row.item_kind || 'main',
      categoryId: row.category_id || null,
      category: categoryNameOf(row),   // 分类唯一真相律:派生自 category_id,不读自由文本列
      unit: row.unit || 'once',
      priceRule: row.price_rule || 'fixed',
      priceRuleValue: row.price_rule_value || 0,
      addonScope,
      addonGroup: row.addon_group || '',
      baseDurationMin: row.base_duration_min,
      depositCents: row.deposit_cents,
      sortOrder: row.sort_order,
      isActive: Boolean(row.is_active),
      storefront: Boolean(row.storefront),
      isTimecard: Boolean(row.is_timecard),
      startingPriceCents: startingPriceCentsOf(row.id, row.price_cents),
      priceCents: row.price_cents,
      listPriceCents: prices.list ? prices.list.priceCents : row.price_cents,
      sharePriceCents: prices.share ? prices.share.priceCents : null,
      memberPriceCents: prices.member ? prices.member.priceCents : null,
      coursePriceCents: prices.course ? prices.course.priceCents : null,
      courseTimes: prices.course ? prices.course.courseTimes : null
    }
  }


  return { pricingCategories, serializePricingCategory, serializePricingItem, pricingItemShape }
}
