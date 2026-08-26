/* 退卡口(N-5,店主 2026-08-25 拍板;图=合同「退卡口设计图」)。

   🔴 动手前必须分清的一件事:**退卡不是手动耗卡。**
   系统里**故意没有「手动耗卡」按钮** —— 手动扣 = 账目风险口:
   它会**凭空确认一笔收入**(而那次服务并没有真的发生,没有签署单、没有顾客签字)。
   退卡不碰收入:
     · 手动耗卡 = 余额减少 **+ 确认收入**            → 永远不开
     · 退卡     = 余额减少 **+ 负债减少 + 现金流出** → 可以开
   因为「充值 = 负债,耗卡才 = 确认收入」—— 卡里那笔钱从来没被确认成收入,退掉自然不该碰收入。

   店主口径:**系统不替商家算该退多少**。每家店的会员规则不一样,只给口,他填多少就是多少;
   系统只做两件事:把该看的数摆在他面前(不让他瞎填)、把不该发生的事拦住(拦不住就是账错)。

   为什么不复用 reversal(冲销):**冲销 = 我们记错了,红字改正;退卡 = 顾客真要退钱走人。**
   挤一个类型,以后就分不清「我们记错过多少」和「顾客退过多少钱」——
   一个衡量团队,一个衡量生意。 */
export function createAccountRefund({ db, apiError, iso, randomId, currentTenantId, insertStoredValueTransaction, storedValueBalanceCents, formatMoneyCents, storeDateOf }) {
  const now = () => iso(new Date())

  /* 退卡屏上那四个参考数(图 §二:少一个商家心里没底,多一个就成了替他算)。
     四个数一处出,前端零计算 —— 顾客可见/商家决策用的数字都后端唯一出口。 */
  function refundFacts(userId, tenantId = currentTenantId()) {
    const row = db.prepare(`SELECT
        COALESCE(SUM(CASE WHEN type IN ('recharge','migrate_opening') THEN amount_cents ELSE 0 END), 0) AS paid,
        COALESCE(SUM(CASE WHEN type = 'bonus' THEN amount_cents ELSE 0 END), 0) AS bonus,
        COALESCE(SUM(CASE WHEN type = 'consume' THEN -amount_cents ELSE 0 END), 0) AS consumed,
        COALESCE(SUM(CASE WHEN type = 'refund' THEN -amount_cents ELSE 0 END), 0) AS refunded,
        COALESCE(SUM(amount_cents), 0) AS balance
      FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ?`).get(tenantId, userId)
    const money = (c) => formatMoneyCents(c, tenantId, 'auto')
    return {
      paidCents: row.paid, paidText: money(row.paid),
      bonusCents: row.bonus, bonusText: money(row.bonus),
      consumedCents: row.consumed, consumedText: money(row.consumed),
      refundedCents: row.refunded, refundedText: money(row.refunded),
      balanceCents: row.balance, balanceText: money(row.balance),
      // 图上那句话:这四个数只是参考,退多少由商家按本店会员规则决定
      hint: '这四个数只是给你参考。退多少由你按本店会员规则决定,系统不替你算。',
      incomeImpactText: money(0)            // 「本店收入影响 $0.00」——后端出句,前端不许自己写 0
    }
  }

  /* 储值退卡。硬拦三条(图 §四):超余额 / 原因空 / 金额非正。
     账本只许追加:写一行 type='refund' 的负数流水,**绝不改旧行**。 */
  function refundStoredValue({ userId, amountCents, payChannel, reason, operator, tenantId = currentTenantId() }) {
    const user = db.prepare('SELECT id, display_name FROM users WHERE id = ? AND tenant_id = ?').get(userId, tenantId)
    if (!user) throw apiError(404, 'NOT_FOUND', '找不到这位顾客。')
    const amount = Math.round(Number(amountCents) || 0)
    if (!Number.isFinite(amount) || amount <= 0) throw apiError(400, 'BAD_REQUEST', '退款金额必须大于 0。')
    const why = String(reason || '').trim()
    if (!why) throw apiError(400, 'REASON_REQUIRED', '退款原因必填 —— 它会写进这位顾客的账户记录,以后查得到。')
    const before = storedValueBalanceCents(userId, tenantId)
    if (amount > before) {
      throw apiError(400, 'REFUND_EXCEEDS_BALANCE',
        `退款金额 ${formatMoneyCents(amount, tenantId, 'auto')} 超过当前余额 ${formatMoneyCents(before, tenantId, 'auto')} —— 余额不许变负。`)
    }
    const txn = insertStoredValueTransaction({
      userId, type: 'refund', amountCents: -Math.abs(amount),
      payChannel: String(payChannel || 'cash'),
      note: `退卡 · ${why}`.slice(0, 200),
      createdBy: operator || 'owner', tenantId
    })
    const after = storedValueBalanceCents(userId, tenantId)
    return {
      txnId: txn.id, userId, refundedCents: amount,
      balanceBeforeCents: before, balanceAfterCents: after,
      incomeImpactCents: 0,                // 恒 0 —— 这行不是装饰,是约束:不是 0 就是账记错了
      facts: refundFacts(userId, tenantId)
    }
  }

  /* 次卡退次。单位是**次**不是钱(图 §三);退多少钱商家自己填,折算单价只给参考。
     🔴 退次数**不写 used_times** —— 那等于把"手动耗卡"从后门开回来。另记 refunded_times。 */
  function timecardRefundFacts(cardId, tenantId = currentTenantId()) {
    const c = db.prepare('SELECT * FROM member_timecards WHERE id = ? AND tenant_id = ?').get(cardId, tenantId)
    if (!c) throw apiError(404, 'NOT_FOUND', '找不到这张次卡。')
    const refunded = c.refunded_times || 0
    const remaining = Math.max(0, c.total_times - c.used_times - refunded)
    const unit = c.total_times > 0 ? Math.round(c.price_cents / c.total_times) : 0
    const money = (x) => formatMoneyCents(x, tenantId, 'auto')
    return {
      cardId: c.id, userId: c.user_id, name: c.name,
      priceCents: c.price_cents, priceText: money(c.price_cents),
      totalTimes: c.total_times, usedTimes: c.used_times, refundedTimes: refunded, remainingTimes: remaining,
      unitCents: unit, unitText: money(unit),
      hint: `折算单价 ${money(unit)}/次 — 仅供参考,退款金额由你填。`,
      incomeImpactText: money(0)
    }
  }

  function refundTimecard({ cardId, times, amountCents, payChannel, reason, operator, tenantId = currentTenantId() }) {
    const facts = timecardRefundFacts(cardId, tenantId)
    const n = Math.round(Number(times) || 0)
    if (!Number.isFinite(n) || n <= 0) throw apiError(400, 'BAD_REQUEST', '退卡次数必须大于 0。')
    if (n > facts.remainingTimes) {
      throw apiError(400, 'REFUND_EXCEEDS_TIMES', `退 ${n} 次超过剩余 ${facts.remainingTimes} 次。`)
    }
    const why = String(reason || '').trim()
    if (!why) throw apiError(400, 'REASON_REQUIRED', '退卡原因必填。')
    const amount = Math.round(Number(amountCents) || 0)
    if (amount < 0) throw apiError(400, 'BAD_REQUEST', '退款金额不能是负数。')
    db.prepare('UPDATE member_timecards SET refunded_times = COALESCE(refunded_times, 0) + ? WHERE id = ? AND tenant_id = ?')
      .run(n, cardId, tenantId)
    db.prepare(`INSERT INTO timecard_refunds (id, tenant_id, card_id, user_id, times, amount_cents, pay_channel, reason, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomId('tcr'), tenantId, cardId, facts.userId, n, amount, String(payChannel || 'cash'), why.slice(0, 200), operator || 'owner', now())
    const after = timecardRefundFacts(cardId, tenantId)
    return {
      cardId, userId: facts.userId, refundedTimes: n, refundedCents: amount,
      remainingTimes: after.remainingTimes,
      voided: after.remainingTimes === 0,           // 退完剩 0 次 = 这张卡作废
      incomeImpactCents: 0,
      facts: after
    }
  }

  /* 当日日结留痕(图 §四「记进当日日结留痕」)。
     注意它**既不进收入也不进支出** —— 退的是负债,不是经营损益;
     日结上单独一行,让当天的人看得见"今天退过卡",而不是把利润做歪。 */
  function refundsOfDay(dateStr, tenantId = currentTenantId()) {
    /* 🔴 时区红线:「当天」按**门店时区**算,不能拿 created_at 的 UTC 前 10 位截 ——
       多伦多下午 8 点之后 UTC 已经是第二天,那样退的卡会掉到明天的日结里。 */
    const sameDay = (at) => storeDateOf(at, tenantId) === dateStr
    const sv = db.prepare(`SELECT id, user_id, amount_cents, pay_channel, note, created_at, created_by
      FROM stored_value_transactions WHERE tenant_id = ? AND type = 'refund' ORDER BY created_at ASC`).all(tenantId).filter((r) => sameDay(r.created_at))
    const tc = db.prepare(`SELECT id, card_id, user_id, times, amount_cents, pay_channel, reason, created_at, created_by
      FROM timecard_refunds WHERE tenant_id = ? ORDER BY created_at ASC`).all(tenantId).filter((r) => sameDay(r.created_at))
    const storedCents = sv.reduce((n, r) => n + Math.abs(r.amount_cents), 0)
    const timecardCents = tc.reduce((n, r) => n + r.amount_cents, 0)
    return {
      storedCount: sv.length, storedCents,
      timecardCount: tc.length, timecardCents, timecardTimes: tc.reduce((n, r) => n + r.times, 0),
      totalCents: storedCents + timecardCents,
      incomeImpactCents: 0,
      label: '退卡(负债减少 · 不进收入)',
      rows: [
        ...sv.map((r) => ({ kind: 'stored', at: r.created_at, userId: r.user_id, amountCents: Math.abs(r.amount_cents), note: r.note || '', by: r.created_by })),
        ...tc.map((r) => ({ kind: 'timecard', at: r.created_at, userId: r.user_id, times: r.times, amountCents: r.amount_cents, note: r.reason || '', by: r.created_by }))
      ].sort((a, b) => String(a.at).localeCompare(String(b.at)))
    }
  }

  /* 🔴 店主 08-25 复核抓出的那一半:**钱真的出去了。**
     退卡不进损益(对:那笔钱从没被确认成收入)—— 但**现金合计也没扣它**,
     于是「今天收现 2000、退顾客 400 → 抽屉实际 1600,日结却报 2000」,
     店主晚上数钱对不上,而她不会怀疑退卡,**她会怀疑店员**。

     三本账:损益不动 / 负债已减 / **现金必须减** —— 这里补的是第三本。

     ⚠️ 口径说明(如实写在这儿,别让人以为比实际更精确):
     `settlement_payments` 的线下腿(leg='offline')**不分现金还是刷卡**,表上没有渠道列。
     所以这个数是「**到店收的钱**(现金+刷卡)应有数」;要精确到钱柜里的纸币,
     得先给线下腿记渠道 —— 那是另一件事,没在这批里做。
     退款这一侧是分渠道的:现金/到店退才从这个数里扣,转账与原路退回单列(它们走银行,不出抽屉)。 */
  function cashDrawerOf(date, tenantId, { settlementIds = [] } = {}) {
    // 到店支付(线下腿 Σ):在这儿算,免得日结那边再拼一段 SQL
    const storefrontCents = settlementIds.length
      ? db.prepare(`SELECT COALESCE(SUM(amount_cents),0) n FROM settlement_payments
          WHERE leg = 'offline' AND settlement_id IN (${settlementIds.map(() => '?').join(',')})`).get(...settlementIds).n
      : 0
    const refunds = refundsOfDay(date, tenantId)
    const isDrawer = (ch) => ['cash', 'offline', 'unknown', ''].includes(String(ch || ''))
    const svRows = db.prepare(`SELECT amount_cents, pay_channel, created_at, type FROM stored_value_transactions
      WHERE tenant_id = ? AND type IN ('refund', 'recharge')`).all(tenantId)
      .filter((r) => storeDateOf(r.created_at, tenantId) === date)
    const rechargeCash = svRows.filter((r) => r.type === 'recharge' && isDrawer(r.pay_channel))
      .reduce((n, r) => n + r.amount_cents, 0)
    const refundCash = svRows.filter((r) => r.type === 'refund' && isDrawer(r.pay_channel))
      .reduce((n, r) => n + Math.abs(r.amount_cents), 0)
    const tcRows = db.prepare('SELECT amount_cents, pay_channel, created_at FROM timecard_refunds WHERE tenant_id = ?').all(tenantId)
      .filter((r) => storeDateOf(r.created_at, tenantId) === date)
    const tcCash = tcRows.filter((r) => isDrawer(r.pay_channel)).reduce((n, r) => n + r.amount_cents, 0)
    const outCash = refundCash + tcCash
    const outOther = (refunds.totalCents || 0) - outCash
    const money = (c) => formatMoneyCents(c, tenantId, 'auto')
    const should = storefrontCents + rechargeCash - outCash
    return {
      storefrontCents, storefrontText: money(storefrontCents),
      rechargeCashCents: rechargeCash, rechargeCashText: money(rechargeCash),
      refundOutCents: outCash, refundOutText: money(outCash),
      refundOtherCents: outOther, refundOtherText: money(outOther),
      shouldHaveCents: should, shouldHaveText: money(should),
      incomeImpactCents: 0,
      label: '到店收的钱 · 应有数',
      /* 措辞不许说过头(店主 08-25 更正):能保证的是「**到店收的钱**·应有数」对得上;
         要精确到抽屉里的纸币,得先给线下腿记渠道 —— 那是后续项,不在这批。 */
      hint: '到店支付 + 现金充值 − 现金退卡,退卡已经扣掉了。对账按这个数。'
        + (outOther ? `另有 ${money(outOther)} 退款走转账/原路退回,不从这里出。` : ''),
      note: '线下腿不分现金与刷卡(表上没有渠道列),所以这是「到店收的钱」的应有数,不是纯钞票数。'
    }
  }

  return { refundFacts, refundStoredValue, timecardRefundFacts, refundTimecard, refundsOfDay, cashDrawerOf }
}
