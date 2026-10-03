/* ===== S2批② B①:次卡持有推导件(状态零列,全部现算)===== */
/* 折算单价(规则⑦:核销按折算单价确认收入计积分/业绩)。
   分币余数末次吃(测试标准点名的边界):第 nth 次(1 起)= 非末次 floor(price/total),末次吃余数。 */
// Shared computed view for every card reader; no persisted values are changed here.
export function createMemberTimecardView({db,todayOf}) {
function timecardUnitCents(card, nth) {
  const base = Math.floor(card.price_cents / card.total_times)
  return nth >= card.total_times ? card.price_cents - base * (card.total_times - 1) : base
}
function timecardExpired(card) {
  return Boolean(card.expires_at && String(card.expires_at).slice(0, 10) < todayOf(card.tenant_id))
}
/* 🔴 N-5:剩余次数**只有这一处算法** —— 总次 − 已核销 − **已退**。
   退掉的次数必须从剩余里扣掉,否则退完还能核销 = 商家真金白银亏钱;
   而退次又不能记进 used_times(那等于把「手动耗卡」从后门开回来),所以独立一列、一处减。 */
function timecardRemainingOf(row) {
  return row.total_times - row.used_times - (row.refunded_times || 0)
}

function serializeMemberTimecard(row) {
  const migratedService=db.prepare("SELECT kind,review_json FROM migration_asset_activations WHERE id=? AND tenant_id=? AND kind IN ('service','paid_service')").get(row.id,row.tenant_id)
  const serviceId=migratedService?JSON.parse(migratedService.review_json).serviceId:null
  const mappedService=serviceId?db.prepare('SELECT name_zh FROM services WHERE id=? AND tenant_id=?').get(serviceId,row.tenant_id):null
  const remaining = timecardRemainingOf(row)
  const expired = timecardExpired(row)
  return {
    id: row.id,
    userId: row.user_id,
    packageId: row.package_id || null,
    name: row.name,
    totalTimes: row.total_times,
    usedTimes: row.used_times,
    refundedTimes: row.refunded_times || 0,
    remaining,
    priceCents: row.price_cents,
    nextUnitCents: remaining > 0 ? timecardUnitCents(row, row.used_times + 1) : 0,
    projectGroup: row.project_group || '',
    // 永久律(08-23):可核销项目**句**后端唯一——前端原来写 `projectGroup || '不限'`,
    // 与商城的「不限项目」措辞分叉,同一事实两处两句话。
    allowedServiceIds: serviceId ? [serviceId] : null,
    projectGroupText: serviceId ? ('仅限 '+(mappedService?.name_zh || '原指定服务')) : row.project_group || '不限项目',
    expiresAt: row.expires_at ? String(row.expires_at).slice(0, 10) : null,
    expired,
    redeemable: remaining > 0 && !expired,
    // 卡片行文案后端给(三端同句,图 B1-4):名称 · 剩 n/N · 有效期;过期置灰由 expired 位驱动
    label: `${row.name} · 剩 ${remaining}/${row.total_times}${row.expires_at ? ` · 至 ${String(row.expires_at).slice(0, 10)}` : ' · 长期有效'}`,
    createdAt: row.created_at
  }
}

return {timecardUnitCents,timecardExpired,timecardRemainingOf,serializeMemberTimecard}
}
