/* 储值行冲销(店主 2026-08-30d 裁定2 准开口,合同五条照办)。

   合同对照:
   ① 适用面:仅冲「错记的充值(+其随笔赠送)」;顾客真要退钱走退卡口,两口不许混。
   ② 前置闸(后端终闸):该笔的实付与赠送**分毫未被消费**才许整笔冲销。
      储值是池式记账(不分笔),可证版口径=该笔之后这位顾客**零消费/零退款流水**;
      动过一分钱就拒 →「已产生消费,请走退卡。」
   ③ 账务一刀双行(同一事务):储值充值行反向(负债−)+ 赠送行反向(若有);
      **充值本就不写账本收款行** —— 抽屉「现金应有数」的 rechargeCash 口径直接累加储值行,
      反向行带原 pay_channel 的负数,当日抽屉自动 −(损益从头到尾不动)。
      原两行经 reversal_of 反查标「已冲销」,永久保留。
   ④ 入口:客户档案→账户调整→冲销 tab(储值行与账本行同列一表);两端同批。
   ⑤ 判据:冲销后 四参考数/余额/抽屉/流水标记 全联动断言;变异刀=抽屉不联动→必红。 */
export function createStoredValueReversal({ db, apiError, insertStoredValueTransaction }) {
  function reverseRechargeTxn({ txnId, tenantId, operator }) {
    const txn = db.prepare('SELECT * FROM stored_value_transactions WHERE id = ? AND tenant_id = ?').get(txnId, tenantId)
    if (!txn) throw apiError(404, 'NOT_FOUND', '没有这笔储值流水。')
    if (txn.type === 'bonus') throw apiError(400, 'BAD_REQUEST', '赠送随它那笔充值一起冲 —— 请对充值行点冲销。')
    if (txn.type !== 'recharge') throw apiError(400, 'BAD_REQUEST', '只能冲销「错记的充值」;顾客要退钱请走退卡。')
    if (db.prepare('SELECT 1 FROM stored_value_transactions WHERE tenant_id = ? AND reversal_of = ? LIMIT 1').get(tenantId, txn.id)) {
      throw apiError(400, 'ALREADY_REVERSED', '这笔已冲销过(红字反向记录在流水里)。')
    }
    /* 同一刀的赠送行:充值与赠送在同一事务背靠背写入。
       🔴 刀A 挨刀时咬出:按 created_at 逐字相等找,两行差 1ms 就静默丢赠送(静默失败器族)——
       加固为 2 秒窗内最近一条,且窗内不得夹另一笔充值(防错认别笔的赠送)。 */
    const winEnd = new Date(new Date(txn.created_at).getTime() + 2000).toISOString()
    const bonus = db.prepare(`SELECT * FROM stored_value_transactions
      WHERE tenant_id = ? AND user_id = ? AND type = 'bonus' AND created_at >= ? AND created_at <= ?
      ORDER BY created_at ASC LIMIT 1`).get(tenantId, txn.user_id, txn.created_at, winEnd)
    if (bonus && db.prepare(`SELECT 1 FROM stored_value_transactions
      WHERE tenant_id = ? AND user_id = ? AND type = 'recharge' AND created_at > ? AND created_at <= ? LIMIT 1`)
      .get(tenantId, txn.user_id, txn.created_at, bonus.created_at)) {
      throw apiError(400, 'BONUS_AMBIGUOUS', '这笔充值与赠送的归属存在歧义(相邻另一笔充值),请在财务页人工核对后处理。')
    }
    /* ② 前置闸(裁定A 08-30f 放宽为「双水位证明」):
       实付余额 ≥ 该笔实付 且 赠送余额 ≥ 该笔赠送 —— 两侧各自足额,证明这笔钱还整个躺在池里,
       冲掉不可能把任何一侧打负;任一侧不足即拒。水位口径=refundFacts 同源(paidRefundable/bonusRemaining)。 */
    const w = db.prepare(`SELECT
        COALESCE(SUM(CASE WHEN t.type = 'bonus' THEN t.amount_cents
                          WHEN t.type = 'reversal' AND o.type = 'bonus' THEN t.amount_cents ELSE 0 END), 0) AS bonus,
        COALESCE(SUM(t.amount_cents), 0) AS balance,
        COALESCE(SUM(CASE WHEN t.type = 'refund' THEN t.bonus_part_cents ELSE 0 END), 0) AS bonus_refunded
      FROM stored_value_transactions t LEFT JOIN stored_value_transactions o ON o.id = t.reversal_of
      WHERE t.tenant_id = ? AND t.user_id = ?`).get(tenantId, txn.user_id)
    const bonusRemaining = Math.max(0, Math.min(w.bonus - (w.bonus_refunded || 0), w.balance))
    const paidRefundable = Math.max(0, w.balance - bonusRemaining)
    if (paidRefundable < txn.amount_cents || bonusRemaining < (bonus ? bonus.amount_cents : 0)) {
      throw apiError(400, 'CONSUMED_NO_REVERSAL', '余额已不足以证明这笔未消费,请走退卡。')
    }
    db.exec('BEGIN IMMEDIATE')
    try {
      const rev = insertStoredValueTransaction({
        tenantId, userId: txn.user_id, type: 'reversal',
        amountCents: -txn.amount_cents,
        payChannel: txn.pay_channel,   // 带原渠道:抽屉 rechargeCash 口径把这行负数一并累加=当日现金−
        note: `冲销:错记充值${txn.note ? ' · ' + txn.note : ''}`.slice(0, 200),
        createdBy: operator, reversalOf: txn.id
      })
      let revBonus = null
      if (bonus && !db.prepare('SELECT 1 FROM stored_value_transactions WHERE tenant_id = ? AND reversal_of = ? LIMIT 1').get(tenantId, bonus.id)) {
        revBonus = insertStoredValueTransaction({
          tenantId, userId: txn.user_id, type: 'reversal',
          amountCents: -bonus.amount_cents,
          payChannel: 'marketing',       // 赠送不是钱进抽屉,反向也不动抽屉
          note: `冲销:错记赠送${bonus.note ? ' · ' + bonus.note : ''}`.slice(0, 200),
          createdBy: operator, reversalOf: bonus.id
        })
      }
      db.exec('COMMIT')
      return { reversal: rev, bonusReversal: revBonus, reversedAmountCents: txn.amount_cents, reversedBonusCents: bonus ? bonus.amount_cents : 0 }
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  return { reverseRechargeTxn }
}
