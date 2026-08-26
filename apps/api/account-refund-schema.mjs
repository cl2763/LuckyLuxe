/* N-5 退卡口的表结构(2026-08-26 从 local-server.mjs 搬出;公约②边改边拆、公约⑧列一律 ALTER)。

   v1.1 ①(店主 08-26):退款要**拆两个分量**入账 —— paid_part / bonus_part,先冲赠送、后冲实付。
   理由:赠送是营销让利;退款先把让利收回,账上「还欠顾客的赠送」才不虚高。
   request_id:幂等按「做过没有」判,**不许拿"余额已经是 0"当判据**(余额会被正常业务消耗)。
   refunded_times:次卡退次单记一列,**绝不写进 used_times** —— 那等于把被有意关掉的
   「手动耗卡」从后门开回来。 */
export function ensureRefundSchema(db) {
  for (const col of ['paid_part_cents INTEGER', 'bonus_part_cents INTEGER', 'request_id TEXT']) {
    try { db.exec(`ALTER TABLE stored_value_transactions ADD COLUMN ${col}`) } catch (error) {
      if (!String(error.message || '').includes('duplicate column')) throw error
    }
  }
  // 同一个请求单号只许有一行;老 sqlite 不支持部分索引就退让,应用层那道判断照样在
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sv_request ON stored_value_transactions(tenant_id, request_id) WHERE request_id IS NOT NULL') } catch (e) { /* 退让 */ }
  try { db.exec('ALTER TABLE member_timecards ADD COLUMN refunded_times INTEGER NOT NULL DEFAULT 0') } catch (error) {
    if (!String(error.message || '').includes('duplicate column')) throw error
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS timecard_refunds (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      times INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      pay_channel TEXT,
      reason TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL
    );
  `)
}
