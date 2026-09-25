/* Physical gifts are descriptive snapshots, never money, inventory fulfilment or points. */
export function normalizeGiftItems(value, apiError = (status, code, message) => Object.assign(new Error(message), { status, code })) {
  if (value === undefined) return []
  const fail = (message) => { throw apiError(400, 'INVALID_GIFT_ITEMS', message) }
  if (!Array.isArray(value) || value.length > 20) fail('赠送物品最多 20 行。')
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail(`第 ${index + 1} 行赠品格式不正确。`)
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!name || name.length > 80) fail(`第 ${index + 1} 行赠品名称须为 1–80 字。`)
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) fail(`第 ${index + 1} 行赠品数量须为 1–999 的整数。`)
    if (!Number.isSafeInteger(item.unitValueCents) || item.unitValueCents < 0 || item.unitValueCents > 100000000) fail(`第 ${index + 1} 行赠品单件价值须为非负金额，最多 1,000,000。`)
    return { name, quantity: item.quantity, unitValueCents: item.unitValueCents }
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
export function giftSnapshotOfPackage(row) { return row && row.kind === 'recharge' ? readGiftItems(row) : [] }
