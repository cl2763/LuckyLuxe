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
/* 🔴 v1.1 ③(店主 2026-08-26):**退卡是财务动作,与冲销同级。**
   充值是钱进来,退卡是真金出去 —— 出钱的口必须比进钱的口严:
   仅老板(或被授予财务权限的账号),且**必须过已有那道财务密码门**(不新造门);
   员工端连按钮都不渲染(不是点了报错),接口层再拦一道 403。
   门禁本身在 local-server 的 requireRefundRight 里(它要拿 adminSession 与 req)。 */
export function createAccountRefund({ db, apiError, iso, randomId, currentTenantId, insertStoredValueTransaction, storedValueBalanceCents, formatMoneyCents, storeDateOf }) {
  const now = () => iso(new Date())

  /* 退卡屏上那四个参考数(图 §二:少一个商家心里没底,多一个就成了替他算)。
     四个数一处出,前端零计算 —— 顾客可见/商家决策用的数字都后端唯一出口。 */
  function refundFacts(userId, tenantId = currentTenantId()) {
    /* 裁定2(08-30d):冲销红字行按 reversal_of 归位 —— 冲充值的负数进「实付累计」、
       冲赠送的进「赠送累计」,四参考数与余额同步联动(判据⑤) */
    const row = db.prepare(`SELECT
        COALESCE(SUM(CASE WHEN t.type IN ('recharge','migrate_opening') THEN t.amount_cents
                          WHEN t.type = 'reversal' AND o.type IN ('recharge','migrate_opening') THEN t.amount_cents ELSE 0 END), 0) AS paid,
        COALESCE(SUM(CASE WHEN t.type = 'bonus' THEN t.amount_cents
                          WHEN t.type = 'reversal' AND o.type = 'bonus' THEN t.amount_cents ELSE 0 END), 0) AS bonus,
        COALESCE(SUM(CASE WHEN t.type = 'consume' THEN -t.amount_cents ELSE 0 END), 0) AS consumed,
        COALESCE(SUM(CASE WHEN t.type = 'refund' THEN -t.amount_cents ELSE 0 END), 0) AS refunded,
        COALESCE(SUM(t.amount_cents), 0) AS balance
      FROM stored_value_transactions t
      LEFT JOIN stored_value_transactions o ON o.id = t.reversal_of
      WHERE t.tenant_id = ? AND t.user_id = ?`).get(tenantId, userId)
    const money = (c) => formatMoneyCents(c, tenantId, 'auto')
    /* 🔴 v1.1 ①(店主 08-26):余额 = 实付 + 赠送 − 已消费。点「全额退」有可能
       **把本店送出去的钱用现金退给顾客** —— 不加硬拦(每家店规则不一样),但界限要画到屏上。
       bonusRemaining = 还没被退掉的赠送;paidRefundable = 余额里属于顾客自己付过的那部分。 */
    const bonusRefunded = db.prepare("SELECT COALESCE(SUM(bonus_part_cents),0) n FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ? AND type = 'refund'").get(tenantId, userId).n
    const bonusRemaining = Math.max(0, Math.min(row.bonus - bonusRefunded, row.balance))
    const paidRefundable = Math.max(0, row.balance - bonusRemaining)
    return {
      bonusRemainingCents: bonusRemaining, bonusRemainingText: money(bonusRemaining),
      paidRefundableCents: paidRefundable, paidRefundableText: money(paidRefundable),
      // 图 v1.1:当前余额下面那一行(后端出句,前端零拼串)
      splitText: `其中 顾客实付可退 ${money(paidRefundable)} · 本店赠送 ${money(bonusRemaining)}`,
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

  /* 黄条句也**后端唯一出口**(前端零拼串):填的金额越过「顾客实付可退」时才出,
     只提醒不拦 —— 退多少是商家的决定,系统只负责让他知道自己在退什么钱。 */
  function bonusWarningText(userId, amountCents, tenantId = currentTenantId()) {
    const f = refundFacts(userId, tenantId)
    const amount = Math.round(Number(amountCents) || 0)
    if (!Number.isFinite(amount) || amount <= f.paidRefundableCents) return ''
    const over = Math.min(amount, f.balanceCents) - f.paidRefundableCents
    if (over <= 0) return ''
    return `你正在退出赠送部分 ${formatMoneyCents(over, tenantId, 'auto')},这是本店让利,退出去是真金。`
  }

  /* 储值退卡。硬拦三条(图 §四):超余额 / 原因空 / 金额非正。
     账本只许追加:写一行 type='refund' 的负数流水,**绝不改旧行**。 */
  /* 金额校验(图 v1.1 顺带补齐的硬拦):负数 / 0 / 非数字 / 超两位小数一律拒。
     超两位小数单独拒 —— 分是最小单位,0.005 元这种数字进了账本就再也对不平。 */
  function assertAmount(raw, label = '退款金额') {
    const n = Number(raw)
    if (!Number.isFinite(n)) throw apiError(400, 'BAD_AMOUNT', `${label}不是一个数字。`)
    if (Math.abs(n - Math.round(n)) > 1e-9) throw apiError(400, 'BAD_AMOUNT', `${label}最多两位小数(分是最小单位)。`)
    const cents = Math.round(n)
    if (cents <= 0) throw apiError(400, 'BAD_AMOUNT', `${label}必须大于 0。`)
    return cents
  }

  function refundStoredValue({ userId, amountCents, payChannel, reason, operator, requestId, tenantId = currentTenantId() }) {
    const user = db.prepare('SELECT id, display_name FROM users WHERE id = ? AND tenant_id = ?').get(userId, tenantId)
    if (!user) throw apiError(404, 'NOT_FOUND', '找不到这位顾客。')   // 跨店:别家店的顾客在这儿就查不到
    /* 🔴 幂等按「做过没有」判(幂等判据律):同一个请求单号只认第一次。
       **不许拿"余额已经是 0"当判据** —— 余额会被正常业务消耗,拿它当幂等键必然重复执行。 */
    const rid = String(requestId || '').trim().slice(0, 64)
    if (rid) {
      const done = db.prepare("SELECT id, amount_cents FROM stored_value_transactions WHERE tenant_id = ? AND type = 'refund' AND request_id = ?").get(tenantId, rid)
      if (done) {
        return {
          txnId: done.id, userId, refundedCents: Math.abs(done.amount_cents), duplicate: true,
          balanceBeforeCents: storedValueBalanceCents(userId, tenantId), balanceAfterCents: storedValueBalanceCents(userId, tenantId),
          incomeImpactCents: 0, facts: refundFacts(userId, tenantId)
        }
      }
    }
    const amount = assertAmount(amountCents)
    const why = String(reason || '').trim()
    if (!why) throw apiError(400, 'REASON_REQUIRED', '退款原因必填 —— 它会写进这位顾客的账户记录,以后查得到。')
    const before = storedValueBalanceCents(userId, tenantId)
    if (amount > before) {
      throw apiError(400, 'REFUND_EXCEEDS_BALANCE',
        `退款金额 ${formatMoneyCents(amount, tenantId, 'auto')} 超过当前余额 ${formatMoneyCents(before, tenantId, 'auto')} —— 余额不许变负。`)
    }
    /* 🔴 v1.2(店主 2026-08-27 走查第 6 步撞出来,当场改回):拆账**先冲实付、后冲赠送**。
       v1.1 写反了,症状是店主亲眼看到的那一屏:充 1000 送 100、退 150 之后显示
       「实付可退 $950 · 本店赠送 $0」—— 赠送凭空没了,而顾客其实只动了自己的钱。
       改对之后同样这一步显示「实付可退 $850 · 本店赠送 $100」:退的先是顾客自己付的钱,
       赠送留到最后 —— 只有退到超过实付时才会吃到让利,黄条也正是在那一刻才该出。
       恒等式:paid_part + bonus_part ≡ 退款金额(断言守,不是只写在注释里)。 */
    const before0 = refundFacts(userId, tenantId)
    const paidPart = Math.min(amount, before0.paidRefundableCents)
    const bonusPart = amount - paidPart
    /* 一次 INSERT 写全 —— **不许写完再 UPDATE**:账本只许追加,那道触发器会打回来
       (08-26 沙箱真点撞到过:测试库租户被豁免,所以只有真店口径上才现形)。 */
    const txn = insertStoredValueTransaction({
      userId, type: 'refund', amountCents: -Math.abs(amount),
      payChannel: String(payChannel || 'cash'),
      note: `退卡 · ${why}`.slice(0, 200),
      createdBy: operator || 'owner', tenantId,
      paidPartCents: paidPart, bonusPartCents: bonusPart, requestId: rid || null
    })
    const after = storedValueBalanceCents(userId, tenantId)
    return {
      txnId: txn.id, userId, refundedCents: amount, paidPartCents: paidPart, bonusPartCents: bonusPart,
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
    const amount = assertAmount(amountCents, '次卡退款金额')
    /* 🔴 2026-08-27 事务扫查出来的:扣次数与写退款记录原来是**两步裸写,中间没有事务**。
       坏的方向特别难看:次数先扣掉了、退款记录没写进去 —— 顾客的次数没了,
       系统里却查不到"退给过她钱",事后谁也说不清。按《动钱多步写律》包进一个事务。 */
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare('UPDATE member_timecards SET refunded_times = COALESCE(refunded_times, 0) + ? WHERE id = ? AND tenant_id = ?')
        .run(n, cardId, tenantId)
      db.prepare(`INSERT INTO timecard_refunds (id, tenant_id, card_id, user_id, times, amount_cents, pay_channel, reason, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(randomId('tcr'), tenantId, cardId, facts.userId, n, amount, String(payChannel || 'cash'), why.slice(0, 200), operator || 'owner', now())
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
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
  function cashDrawerOf(date, tenantId, { settlementIds = [], notesCents = 0, notesCount = 0, manualCashCents = 0, manualCashCount = 0 } = {}) {
    /* 🔴 08-27 实拍抓到的同屏矛盾:金额更正之后「营业额 CAD $150」而「抽屉里应该有 CAD $198」。
       两个数其实都对 —— 顾客当时**真的付了 198 现金**,差额退没退是门店当场的动作,系统不知道。
       但屏幕不解释就等于自相矛盾(闭环纪律:不许出现找不到上下文的界面状态)。
       所以**算式不动**(不许替她假设钱退了),底下加一句把两个数连起来。 */
    // 到店支付(线下腿 Σ):在这儿算,免得日结那边再拼一段 SQL
    const storefrontCents = settlementIds.length
      ? db.prepare(`SELECT COALESCE(SUM(amount_cents),0) n FROM settlement_payments
          WHERE leg = 'offline' AND settlement_id IN (${settlementIds.map(() => '?').join(',')})`).get(...settlementIds).n
      : 0
    const refunds = refundsOfDay(date, tenantId)
    const isDrawer = (ch) => ['cash', 'offline', 'unknown', ''].includes(String(ch || ''))
    /* 裁定2(08-30d):冲销红字行带原渠道负数,当日抽屉自动 −(充值本就不写账本行,
       抽屉的钱一直从储值行累加 —— 反向行走同一口径;赠送反向 pay_channel=marketing 天然不进抽屉) */
    const svRows = db.prepare(`SELECT amount_cents, pay_channel, created_at, type FROM stored_value_transactions
      WHERE tenant_id = ? AND type IN ('refund', 'recharge', 'reversal')`).all(tenantId)
      .filter((r) => storeDateOf(r.created_at, tenantId) === date)
    const rechargeCash = svRows.filter((r) => (r.type === 'recharge' || r.type === 'reversal') && isDrawer(r.pay_channel))
      .reduce((n, r) => n + r.amount_cents, 0)
    const refundCash = svRows.filter((r) => r.type === 'refund' && isDrawer(r.pay_channel))
      .reduce((n, r) => n + Math.abs(r.amount_cents), 0)
    const tcRows = db.prepare('SELECT amount_cents, pay_channel, created_at FROM timecard_refunds WHERE tenant_id = ?').all(tenantId)
      .filter((r) => storeDateOf(r.created_at, tenantId) === date)
    const tcCash = tcRows.filter((r) => isDrawer(r.pay_channel)).reduce((n, r) => n + r.amount_cents, 0)
    const outCash = refundCash + tcCash
    const outOther = (refunds.totalCents || 0) - outCash
    const money = (c) => formatMoneyCents(c, tenantId, 'auto')
    /* 🔴 D79(店主 2026-08-28)线下现金腿:买材料付的现金、备用金、找零、更正后的现金找补 ——
       这些系统本来一律不知道,于是「应有数」永远等不于抽屉,而店主不会怀疑系统少算一腿,她会怀疑店员。
       手记只加在**现金这一行**:不进损益、不进营业额、不进业绩(incomeImpactCents 仍恒为 0)。 */
    /* 🔴 店主 08-28(六)问的那件:「记一笔」和「现金手记」是不是重叠?——**她是对的,原来是重叠的**。
       裁定:**一个动作一个入口**。买材料付现 50 只走「记一笔(方式=现金)」,
       它**同时**动两处:损益记支出 −50、抽屉减 50。现金手记只管「既不是赚也不是花」的那三种
       (备用金 / 盘点差异 / 更正后现金找补)。
       所以抽屉算式现在有两条手工腿,各管各的,谁也不重复记谁。 */
    const should = storefrontCents + rechargeCash - outCash + manualCashCents + notesCents
    return {
      storefrontCents, storefrontText: money(storefrontCents),
      rechargeCashCents: rechargeCash, rechargeCashText: money(rechargeCash),
      refundOutCents: outCash, refundOutText: money(outCash),
      refundOtherCents: outOther, refundOtherText: money(outOther),
      shouldHaveCents: should, shouldHaveText: money(should),
      incomeImpactCents: 0,
      /* 🔴 v1.2 ②(店主 2026-08-27):这个数是**一个动作的落点** —— 晚上拿着它去数抽屉。
         原来三行同样大小混在正文里,她的原话:「全在上面写成小字,根本不让人觉得这是一项操作」。
         按回执图改成收据式:抬头句 + 大号金额 + 底下摊开算式;走转账/原路退回的降为脚注。
         句子与算式行**全部后端给**,两端照渲染,谁都不许自己拼口径。 */
      title: '今晚数钱按这个数',
      totalLabel: '抽屉里应该有',
      rows: [
        { label: '到店支付', sign: '+', amountCents: storefrontCents, amountText: money(storefrontCents) },
        { label: '现金充值', sign: '+', amountCents: rechargeCash, amountText: money(rechargeCash) },
        { label: '现金退卡', sign: '−', amountCents: outCash, amountText: money(outCash), negative: true },
        ...(manualCashCount ? [{
          label: `记一笔·现金收支(${manualCashCount} 笔)`,
          sign: manualCashCents < 0 ? '−' : '+',
          amountCents: Math.abs(manualCashCents),
          amountText: money(Math.abs(manualCashCents)),
          negative: manualCashCents < 0
        }] : []),
        ...(notesCount ? [{
          label: `现金手记(${notesCount} 笔)`,
          sign: notesCents < 0 ? '−' : '+',
          amountCents: Math.abs(notesCents),
          amountText: money(Math.abs(notesCents)),
          negative: notesCents < 0
        }] : [])
      ],
      label: '到店收的钱 · 应有数',
      // 脚注:那部分钱没经过抽屉,所以**不进算式**,只在底下说一句
      footnote: outOther ? `另有 ${money(outOther)} 退款走转账 / 原路退回 —— 没经过抽屉,不在这个数里` : '',
      // 更正差额:算式不动,只说清"这个数为什么和营业额不一样"
      amendNote: (() => {
        const rows = db.prepare(`SELECT a.amount_delta_cents d FROM settlement_amendments a
          JOIN settlements s ON s.id = a.settlement_id
          WHERE a.tenant_id = ? AND a.amount_delta_cents <> 0 AND s.id IN (${settlementIds.length ? settlementIds.map(() => '?').join(',') : "''"})`)
          .all(tenantId, ...settlementIds)
        const sum = rows.reduce((n, r) => n + r.d, 0)
        if (!sum) return ''
        /* D79 之后这句要分两种情况说,否则会自相矛盾(闭环纪律:屏幕上不许有解释不了的数):
           · 差额**已经**记进现金手记(net 正好等于更正额)→ 抽屉数已经把它算进去了,别再说"实际应是";
           · 还没记 → 照旧告诉她实际应是多少,并指向手记那个口。 */
        if (notesCents === sum) {
          return `今天有金额更正 ${sum < 0 ? '−' : '+'}${money(Math.abs(sum))},差额已经记进下面的现金手记 —— 抽屉这个数已经把它算进去了。`
        }
        const wouldBe = should - notesCents + sum
        return sum < 0
          ? `今天有金额更正 −${money(Math.abs(sum))}:抽屉这个数按**顾客当时实付**算;差额若已当场退给顾客,实际应是 ${money(wouldBe)} —— 在下面「现金手记」里记一笔 −${money(Math.abs(sum))},这个数就自动对上了(D79)。`
          : `今天有金额更正 +${money(sum)}:抽屉这个数按**顾客当时实付**算;补收的差额若已当场收到,实际应是 ${money(wouldBe)} —— 在下面「现金手记」里记一笔 +${money(sum)},这个数就自动对上了(D79)。`
      })(),
      /* 措辞不许说过头(店主 08-25 更正):能保证的是「到店收的钱·应有数」对得上;
         要精确到抽屉里的纸币,得先给线下腿记渠道 —— 那是后续项,不在这批。 */
      hint: (notesCount || manualCashCount)
        ? '到店支付 + 现金充值 − 现金退卡 ± 记一笔的现金收支 ± 现金手记,都算进去了。对账按这个数。'
        : '到店支付 + 现金充值 − 现金退卡,退卡已经扣掉了。对账按这个数。',
      /* 🔴 分工原样写到页面上,不许让商家猜(店主 08-28 六:她问「两个是不是有重叠」)。 */
      splitNote: '「记一笔」管这笔钱是赚了还是花了;「现金手记」管抽屉里的钞票多了还是少了,但既不是赚也不是花。',
      note: '线下腿不分现金与刷卡(表上没有渠道列),所以这是「到店收的钱」的应有数,不是纯钞票数。'
    }
  }

  /* v1.2 ②:日结顶部三小格。**退卡单独一格,不混进营业额** ——
     它是负债减少不是收入,混进去等于把"退给顾客的钱"算成生意做大了。 */
  function headlineOf(date, tenantId = currentTenantId(), { orderCount = 0, revenueCents = 0 } = {}) {
    const rf = refundsOfDay(date, tenantId)
    const m = (c) => formatMoneyCents(c, tenantId, 'auto')
    return [
      { key: 'orders', label: '本日单数', value: String(orderCount) },
      { key: 'revenue', label: '营业额', value: m(revenueCents) },
      { key: 'refund', label: `退卡合计(储值 ${rf.storedCount} 笔${rf.timecardCount ? ` · 次卡 ${rf.timecardCount} 笔` : ''})`, value: m(rf.totalCents) }
    ]
  }

  return { refundFacts, bonusWarningText, headlineOf, refundStoredValue, timecardRefundFacts, refundTimecard, refundsOfDay, cashDrawerOf }
}
