/* 储值域(2026-08-25 从 local-server.mjs 搬出,公约②:动哪个领域就把哪个领域搬出来)。

   这一批做的是 N-5 退卡口,动的正是这个域 —— 顺手把它整族收在一处:
   写流水 / 算余额 / 分桶(legacy 是老店迁来的期初,不是本店收的钱)/ 类型文案 / 首充判定。

   🔴 口径不动(《财务记账总逻辑》):**充值 = 负债,耗卡才 = 确认收入**。
   所以充值与退卡都**不进财务账本**;进账本的是耗卡那一刻确认的收入。 */
export function createStoredValue({ db, randomId, iso, currentTenantId, localParts, memberCodeForUserId, depositLiabilityCents }) {
  function storedValueBalanceCents(userId, tenantId = currentTenantId()) {
    return db.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS balance FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ?')
      .get(tenantId, userId).balance
  }

  function insertStoredValueTransaction({ userId, type, amountCents, payChannel = 'unknown', note = '', createdBy = 'system', createdAt = null, tenantId = currentTenantId(), technicianId = null, customerConfirmedAt = null }) {
    const id = randomId('sv')
    // N-5:refund(退卡)与 consume 同族都是负数;两者的区别在**收入**上,不在符号上
    const signed = type === 'recharge' ? Math.abs(amountCents)
      : (type === 'consume' || type === 'refund' ? -Math.abs(amountCents) : Math.round(amountCents))
    db.prepare(`
      INSERT INTO stored_value_transactions (id, tenant_id, user_id, type, amount_cents, pay_channel, note, created_by, created_at, technician_id, customer_confirmed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, userId, type, signed, payChannel, note, createdBy, createdAt || iso(new Date()), technicianId || null, customerConfirmedAt || null)
    return db.prepare('SELECT * FROM stored_value_transactions WHERE id = ?').get(id)
  }

  function storedValueOverview() {
    const month = localParts(new Date()).date.slice(0, 7)
    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(amount_cents), 0) AS balance,
        COALESCE(SUM(CASE WHEN type = 'recharge' AND substr(created_at, 1, 7) = ? THEN amount_cents ELSE 0 END), 0) AS month_recharge,
        COALESCE(SUM(CASE WHEN type = 'consume' AND substr(created_at, 1, 7) = ? THEN -amount_cents ELSE 0 END), 0) AS month_consume
      FROM stored_value_transactions WHERE tenant_id = ?
    `).get(month, month, currentTenantId())
    const accounts = db.prepare(`
      SELECT sv.user_id,
        COALESCE(SUM(sv.amount_cents), 0) AS balance,
        MAX(CASE WHEN sv.type = 'consume' THEN sv.created_at END) AS last_consume_at,
        MAX(sv.created_at) AS last_activity_at,
        u.display_name
      FROM stored_value_transactions sv
      LEFT JOIN users u ON u.id = sv.user_id
      WHERE sv.tenant_id = ?
      GROUP BY sv.user_id
      HAVING balance > 0
    `).all(currentTenantId())
    const now = Date.now()
    const list = accounts.map((row) => {
      const lastTouch = row.last_consume_at || row.last_activity_at
      const dormantDays = lastTouch ? Math.floor((now - new Date(lastTouch).getTime()) / 86400000) : 999
      return {
        userId: row.user_id,
        displayName: row.display_name || memberCodeForUserId(row.user_id),
        memberCode: memberCodeForUserId(row.user_id),
        balanceCents: row.balance,
        lastConsumeAt: row.last_consume_at || null,
        dormantDays
      }
    }).sort((a, b) => b.dormantDays - a.dormantDays || b.balanceCents - a.balanceCents)
    return {
      totalBalanceCents: totals.balance,
      // 定金预收(拍板 A · §五):线下收了、还没在单上兑现的定金,与储值同为**负债**
      depositLiabilityCents: depositLiabilityCents(),
      monthRechargeCents: totals.month_recharge,
      monthConsumeCents: totals.month_consume,
      consumeRate: totals.balance + totals.month_consume > 0 ? Math.round((totals.month_consume / (totals.balance + totals.month_consume)) * 1000) / 10 : 0,
      accounts: list
    }
  }

  function storedValueTypeText(type) {
    return {
      recharge: '充值到账', consume: '耗卡', bonus: '充值赠送',
      reversal: '更正冲销', migrate_opening: '期初迁移',
      refund: '退卡退款'          // 退款不是冲销:冲销=我们记错了,退卡=顾客真要退钱走人
    }[String(type || '')] || '账户调整'
  }

  function storedValueBalanceDetail(userId, tenantId = currentTenantId()) {
    const row = db.prepare(`SELECT
        COALESCE(SUM(amount_cents), 0) AS total,
        COALESCE(SUM(CASE WHEN bucket = 'legacy' THEN amount_cents ELSE 0 END), 0) AS legacy
      FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ?`).get(tenantId, userId)
    const totalCents = row.total || 0
    const legacyCents = row.legacy || 0
    return { totalCents, legacyCents, normalCents: totalCents - legacyCents }
  }

  function isFirstRecharge(userId, tenantId = currentTenantId()) {
    const row = db.prepare("SELECT 1 AS hit FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ? AND type = 'recharge' LIMIT 1")
      .get(tenantId, userId)
    return !row
  }

  return { storedValueBalanceCents, insertStoredValueTransaction, storedValueOverview, storedValueTypeText, storedValueBalanceDetail, isFirstRecharge }
}
