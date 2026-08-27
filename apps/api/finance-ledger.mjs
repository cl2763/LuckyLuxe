/* 财务台账的写入口与哈希链 —— 从 local-server.mjs 搬出(公约①②,2026-08-27)。

   这是**账本唯一的写入口**:金额带符号存储(收入为正、支出为负、冲销取反),
   汇总 = 直接求和,永远对得上;防篡改 = 只追加(十二条触发器拒 UPDATE/DELETE)+ 哈希链
   (每笔指纹咬合上一笔,改一行后面全对不上)。
   本批把它挪出来,是因为这一轮动的就是账本这一层(金额更正联动 + 豁免族审计 + 事务扫)。 */
export function createFinanceLedger({ db, createHash, randomId, iso, currentTenantId, localParts, storeIdOfTenant, DEFAULT_TENANT_ID }) {
  // ===== 财务记账底座（阶段3A/3B）=====
  // 金额带符号存储：收入为正、支出为负、冲销取反。汇总 = 直接求和，永远对得上。
  // 防篡改：只追加（触发器拒绝 UPDATE/DELETE）+ 哈希链（每笔指纹咬合上一笔）。
  function financeRowHash(row, prevHash) {
    const canonical = JSON.stringify([
      row.id, row.tenant_id, row.type, row.source, row.category,
      row.amount_cents, row.pay_channel, row.occurred_on,
      row.booking_id || '', row.recurring_rule_id || '', row.reversal_of || '',
      row.created_by || '', row.created_at, prevHash
    ])
    return createHash('sha256').update(canonical).digest('hex')
  }

  function latestFinanceHash(tenantId) {
    const row = db.prepare('SELECT row_hash FROM finance_transactions WHERE tenant_id = ? ORDER BY rowid DESC LIMIT 1').get(tenantId)
    return row?.row_hash || 'genesis'
  }

  function verifyFinanceLedger(tenantId = DEFAULT_TENANT_ID) {
    const rows = db.prepare('SELECT rowid, * FROM finance_transactions WHERE tenant_id = ? ORDER BY rowid ASC').all(tenantId)
    let prev = 'genesis'
    for (const row of rows) {
      if (row.prev_hash !== prev || row.row_hash !== financeRowHash(row, prev)) {
        return { valid: false, count: rows.length, firstBrokenId: row.id, firstBrokenAt: row.created_at }
      }
      prev = row.row_hash
    }
    return { valid: true, count: rows.length, firstBrokenId: null }
  }

  function insertFinanceTransaction({ type, source = 'manual', category, tags = '', amountCents, payChannel = 'unknown', occurredOn, note = '', bookingId = null, recurringRuleId = null, reversalOf = null, keepSign = false, createdBy = 'system', storeId = null, tenantId: tenantIdOverride = '' }) {
    const id = randomId('fin')
    const signed = type === 'expense' ? -Math.abs(amountCents) : Math.abs(amountCents)
    /* 顾客签署页是**公开路由**,没进租户闸门,currentTenantId() 会回落到旗舰店。
       签字时刻写账的调用方必须把单据自己的 tenant_id 传进来,否则钱记到别人家账上。 */
    const tenantId = tenantIdOverride || currentTenantId()
    const createdAt = iso(new Date())
    const record = {
      id,
      tenant_id: tenantId,
      type,
      source,
      category,
      /* keepSign = 金额更正的差额行(店主 08-27 拍板):它是**部分**红字,不是整行冲销 ——
         所以不许挂 reversal_of(那个字段的语义是"这一行作废了",签署入账的防重与手工冲销都读它),
         但金额必须保号(收入 −48 才能让净额跟着单据走)。 */
      amount_cents: (reversalOf || keepSign) ? amountCents : signed,
      pay_channel: payChannel,
      occurred_on: occurredOn || localParts(new Date()).date,
      booking_id: bookingId,
      recurring_rule_id: recurringRuleId,
      reversal_of: reversalOf,
      created_by: createdBy,
      created_at: createdAt
    }
    const prevHash = latestFinanceHash(tenantId)
    const rowHash = financeRowHash(record, prevHash)
    db.prepare(`
      INSERT INTO finance_transactions
        (id, tenant_id, store_id, type, source, category, tags, amount_cents, pay_channel, occurred_on, note, booking_id, recurring_rule_id, reversal_of, created_by, created_at, prev_hash, row_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, storeId || storeIdOfTenant(tenantId), type, source, category, tags, record.amount_cents, payChannel, record.occurred_on, note, bookingId, recurringRuleId, reversalOf, createdBy, createdAt, prevHash, rowHash)
    return db.prepare('SELECT * FROM finance_transactions WHERE id = ?').get(id)
  }

  return { financeRowHash, latestFinanceHash, verifyFinanceLedger, insertFinanceTransaction }
}
