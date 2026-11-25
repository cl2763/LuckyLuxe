import {isRechargePackage} from './package-kind.mjs'
/* Legacy untyped items remain descriptive; typed items are fulfilled only by new recharge transactions. */
export function normalizeGiftItems(value, apiError = (status, code, message) => Object.assign(new Error(message), { status, code })) {
  if (value === undefined) return []
  const fail = (message) => { throw apiError(400, 'INVALID_GIFT_ITEMS', message) }
  if (!Array.isArray(value) || value.length > 20) fail('赠送物品最多 20 行。')
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail(`第 ${index + 1} 行赠品格式不正确。`)
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!name || name.length > 80) fail(`第 ${index + 1} 行赠品名称须为 1–80 字。`)
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) fail(`第 ${index + 1} 行赠品数量须为 1–999 的整数。`)
    if (item.unitValueCents != null && (!Number.isSafeInteger(item.unitValueCents) || item.unitValueCents < 0 || item.unitValueCents > 100000000)) fail(`第 ${index + 1} 行赠品单件价值须为非负金额，最多 1,000,000。`)
    const result = { name, quantity: item.quantity, unitValueCents: item.unitValueCents ?? null }
    if (item.kind !== undefined) {
      if (!['physical','coupon','service_voucher','service_timecard'].includes(item.kind)) fail(`第 ${index + 1} 行请选择有效的赠送类别。`)
      result.kind=item.kind
      const reference=key=>{if(typeof item[key]!=='string'||!item[key].trim()||item[key].length>160)fail(`第 ${index+1} 行请选择对应的服务或优惠券。`);result[key]=item[key].trim()}
      if(item.kind==='coupon')reference('couponId')
      if(item.kind.startsWith('service_'))reference('serviceId')
      if(item.validDays!==undefined&&item.validDays!==null&&(!Number.isSafeInteger(item.validDays)||item.validDays<1||item.validDays>3650))fail(`第 ${index+1} 行有效期须为1至3650天或留空。`)
      result.validDays=item.validDays??null
    }
    return result
  })
}
export function readGiftItems(row) {
  if (!row || !row.gift_items_json) return []
  return normalizeGiftItems(JSON.parse(row.gift_items_json))
}
export function ensureGiftSchema(db) {
  for (const table of ['membership_packages', 'stored_value_transactions']) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all()
    if (columns.length && !columns.some((c) => c.name === 'gift_items_json')) ({membership_packages:()=>db.exec("ALTER TABLE membership_packages ADD COLUMN gift_items_json TEXT NOT NULL DEFAULT '[]'"),stored_value_transactions:()=>db.exec("ALTER TABLE stored_value_transactions ADD COLUMN gift_items_json TEXT NOT NULL DEFAULT '[]'")})[table]()
  }
}
/* Caller must select the active package inside the current tenant. */
export function giftSnapshotOfPackage(row) { return isRechargePackage(row) ? readGiftItems(row) : [] }

// Presentation only. Never write these labels into the immutable gift snapshot.
export function presentGiftItems(items){
 const labels={physical:'实物领取',coupon:'优惠券',service_voucher:'服务兑换券',service_timecard:'服务次卡'}
 return items.map(g=>g.kind?({...g,kindLabel:labels[g.kind],unitLabel:g.kind==='physical'?'件':g.kind==='service_timecard'?'次':'张',expiryText:g.validDays?'发放后 '+g.validDays+' 天有效':g.kind==='coupon'?'有效期沿用券模板':'长期有效'}):g)
}
