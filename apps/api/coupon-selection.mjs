import {scopedCouponContext} from './member-pricing-coupons.mjs'
export function createCouponSelection({db,iso,formatMoneyCents,couponScopeIds,couponRawDiscountCents,couponSubtitle}){
function evaluateCouponGrant(grant, ctx) {
  const scope = couponScopeIds(grant)
  const minSpend = Math.max(0, Number(grant.min_spend_cents) || 0)
  const base = {
    grantId: grant.id,
    couponId: grant.coupon_id,
    code: grant.code,
    name: grant.name,
    recipientMode: grant.recipient_mode || 'any',
    grantKind: grant.grant_kind || 'template',
    grantReason: grant.grant_reason || '',
    pendingGift:!!grant.pending_gift,
    discountType: grant.discount_type,
    amountCents: grant.amount_cents,
    percentOff: grant.percent_off,
    minSpendCents: minSpend,
    scopeCategoryIds: scope,
    scopeText: scope.length ? scope.map((id) => ctx.categoryNames[id] || id).join('、') : '全部大类',
    expiresAt: grant.expires_at || null,
    // 「满 ¥300 可用 · 2026-09-30 到期」这行小字由 couponSubtitle() 唯一持有(卡包/选券面板/签署页同一句)
    subtitle: (grant.pending_gift?'随单充值赠送 · 先签充值单发放 · ':'')+couponSubtitle(grant, ctx.tenantId),
    usable: false,
    reason: '',
    discountCents: 0,
    discountText: ''
  }
  if(grant.recipient_mode==='friend_original'&&(!ctx.beneficiaryKey||ctx.beneficiaryKey==='self'))return {...base,reason:'仅限同行朋友的服务单，不能用于卡主本人。'}
  if(grant.recipient_mode==='friend_original'&&(!ctx.priceTypes?.length||ctx.priceTypes.some(t=>t!=='list')))return {...base,reason:'请先为这位朋友选择原价，再使用同行券；不叠加会员折扣。'}
  if (grant.is_active === 0) return { ...base, reason: '不可用:该券已停用' }
  if (grant.status === 'used') return { ...base, reason: `不可用:已核销${grant.settlement_code ? `(${grant.settlement_code})` : ''}` }
  if (grant.status === 'revoked') return { ...base, reason: '不可用:已作废' }
  if (grant.status === 'expired' || (grant.expires_at && String(grant.expires_at) < ctx.now)) return { ...base, reason: '不可用:已过期' }
  if (grant.status !== 'active') return { ...base, reason: '不可用:该券当前不可使用' }
  if (minSpend > 0 && ctx.subtotalCents < minSpend) {
    return { ...base, reason: `不可用:未满 ${formatMoneyCents(minSpend, ctx.tenantId, 'auto')}` }
  }
  if (scope.length && !ctx.categoryIds.some((id) => scope.includes(id))) {
    return { ...base, reason: `不可用:仅适用${base.scopeText}` }
  }
  const discount = Math.max(0, Math.min(couponRawDiscountCents(grant, ctx.subtotalCents), Math.max(0, ctx.maxDeductCents)))
  // 拍板(店主 08-21 D55/D56 批):次卡=独立消费不叠优惠——纯次卡单可抵基数为 0 时出专句,不让店员猜
  if (discount <= 0) return { ...base, reason: ctx.noEligibleReason || '不可用:本单已无可抵扣金额' }
  return { ...base, usable: true, discountCents: discount, discountText: formatMoneyCents(discount, ctx.tenantId, 'auto') }
}

// 卡主券包里的全部券(可用在上、不可用在下并带原因),连同选中那张的抵扣额
function couponOptionsFor({ tenantId, userId, subtotalCents, maxDeductCents, categoryIds, selectedGrantId = '', excludeSettlementId = null, noEligibleReason = '', readOnly = false, scopedLines = null, beneficiaryKey = '', priceTypes = [], pendingGrants = [] }) {
  const out = { options: [], selectedGrantId: '', selected: null, discountCents: 0, usableCount: 0 }
  if (!userId) return out
  const now = iso(new Date())
  // 到期的券顺手落地成 expired,和 /my/coupons 同一套口径
  if(!readOnly) db.prepare("UPDATE coupon_grants SET status = 'expired' WHERE user_id = ? AND tenant_id = ? AND status = 'active' AND expires_at IS NOT NULL AND expires_at < ?")
    .run(userId, tenantId, now)
  const categoryNames = {}
  for (const c of db.prepare('SELECT id, name FROM service_categories WHERE tenant_id = ?').all(tenantId)) categoryNames[c.id] = c.name
  const rows = db.prepare(`SELECT g.*, c.name, c.discount_type, c.amount_cents, c.percent_off, c.min_spend_cents,
      c.scope_categories_json, c.is_active, c.recipient_mode
    FROM coupon_grants g JOIN coupons c ON c.id = g.coupon_id
    WHERE g.tenant_id = ? AND g.user_id = ? ORDER BY g.created_at DESC`).all(tenantId, userId)
  for(const r of pendingGrants)if(!rows.some(g=>g.id===r.id))rows.push(r)
  /* 已经挂在别的单上的券(那张单还没签,所以券还是 active)也要置灰 ——
     否则要等点下去才报「一单一张」,不如在面板上就说清楚。 */
  const heldElsewhere = {}
  for (const h of db.prepare('SELECT id, code, coupon_grant_id FROM settlements WHERE tenant_id = ? AND status <> \'voided\' AND coupon_grant_id IS NOT NULL').all(tenantId)) {
    if (h.id !== excludeSettlementId) heldElsewhere[h.coupon_grant_id] = h.code
  }
  const ctx = { tenantId, subtotalCents, maxDeductCents, categoryIds, categoryNames, now, noEligibleReason, beneficiaryKey, priceTypes }
  const evaluated = rows.map((r) => {
    const one = evaluateCouponGrant(r, scopedLines?scopedCouponContext(couponScopeIds(r),ctx,scopedLines):ctx)
    if (one.usable && heldElsewhere[r.id]) {
      return { ...one, usable: false, discountCents: 0, discountText: '', reason: `不可用:已用在服务单 ${heldElsewhere[r.id]} 上(一单一张)` }
    }
    return one
  })
  // 已核销在别的单上的券不进券包列表(免得顾客以为还能选);本单选中的那张要留着
  const visible = evaluated.filter((e) => e.usable || e.grantId === selectedGrantId
    || !(rows.find((r) => r.id === e.grantId) || {}).settlement_id)
  out.options = visible.sort((a, b) => (Number(b.usable) - Number(a.usable)) || (b.discountCents - a.discountCents))
  out.usableCount = out.options.filter((o) => o.usable).length
  const picked = selectedGrantId ? out.options.find((o) => o.grantId === selectedGrantId) : null
  if (picked && picked.usable) {
    out.selectedGrantId = picked.grantId
    out.selected = picked
    out.discountCents = picked.discountCents
  }
  return out
}

return {couponOptionsFor}
}
