import {presentGiftItems} from './gifts.mjs'
import {configFingerprint} from './config-fingerprint.mjs'
import {canonicalPackageKind} from './package-kind.mjs'
export function createMembershipPackageSerializer(giftSnapshotOfPackage,discountOf=()=>null) {
  return function serializeMembershipPackage(row) {
  return {
    configRevision:configFingerprint([row,discountOf(row)]),giftItems:presentGiftItems(giftSnapshotOfPackage(row)),
    ...(discountOf(row)?{defaultPersonalDiscount:discountOf(row)}:{}),
    id: row.id,
    kind: canonicalPackageKind(row.kind),
    name: row.name,
    priceCents: row.price_cents,
    bonusCents: row.bonus_cents,
    timesCount: row.times_count,
    scope: row.scope || '',
    benefits: row.benefits || '',
    isActive: Boolean(row.is_active),
    sortOrder: row.sort_order,
    validDays: row.valid_days || null,
    projectGroup: row.project_group || '',
    mallVisible: row.mall_visible === undefined ? true : Boolean(row.mall_visible)
  }
}

}
