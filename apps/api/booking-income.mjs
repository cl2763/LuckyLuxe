/* 订单入账触点(从 local-server.mjs 原样搬出,行为一字未改 —— 公约②「边改边拆」)。

   这一域现在只有两个触点:订单完成 → 确认收入;订单取消/过期 → 红字冲销。
   🔴 终局(店主 08-24 拍板 A 案):**入账唯一路径 = 签署**,按钮入账路径退役 ——
   到那一刀,recordBookingIncome 会从"按钮触发"变成"签署触发",这个模块就是那次改动的落点。
   现在先原样搬:同一批里搬和改分两个提交,万一行为改出问题能干净回滚到"只搬没改"。 */

export function createBookingIncome({ db, getService, insertFinanceTransaction, localParts }) {
  function bookingIncomeCategory(booking) {
    const service = booking.service_id ? getService(booking.service_id) : null
    if (service?.type === 'LASH') return '服务收入-美睫'
    if (service?.type === 'NAIL') return '服务收入-美甲'
    return '服务收入-其他'
  }

  // 订单完成 → 自动确认收入（按订单幂等：已有未被冲销的收入则跳过）
  function recordBookingIncome(booking, createdBy = 'system') {
    if (!booking?.id || !booking.service_price_cents) return null
    /* 🩹 D70 止血:幂等要认「签署收入」——只认 source='booking' 会让已签署入账的单再点一次
       「已完成」按标价再记一笔(同一单两笔收入)。白名单只放这两个:爽约没收/守恒回填记的不是这单服务收入。
       终局是 A 案(入账唯一路径=签署),详见 handoff/D70查明_订单动作按钮与售后态_2026-08-24.md */
    const existing = db.prepare(`
      SELECT t.* FROM finance_transactions t
      WHERE t.booking_id = ? AND t.type = 'income' AND t.source IN ('booking', 'settlement')
        AND NOT EXISTS (SELECT 1 FROM finance_transactions r WHERE r.reversal_of = t.id)
      ORDER BY t.created_at DESC LIMIT 1
    `).get(booking.id)
    if (existing) return existing
    return insertFinanceTransaction({
      type: 'income',
      source: 'booking',
      category: bookingIncomeCategory(booking),
      tags: booking.technician_id || '',
      amountCents: booking.service_price_cents,
      payChannel: 'in_store',
      occurredOn: localParts(new Date()).date,
      note: `订单 ${booking.public_code || booking.id} 完成自动入账`,
      bookingId: booking.id,
      createdBy
    })
  }

  // 已入账订单被取消 → 自动红字冲销(这里按 source='booking' 找原始行是**对的**:
  // 冲销的就是那笔按钮入账;止血那条判据第一版全文搜就误伤过这个函数)
  function reverseBookingIncome(bookingId, createdBy = 'system') {
    const original = db.prepare(`
      SELECT t.* FROM finance_transactions t
      WHERE t.booking_id = ? AND t.source = 'booking'
        AND NOT EXISTS (SELECT 1 FROM finance_transactions r WHERE r.reversal_of = t.id)
      ORDER BY t.created_at DESC LIMIT 1
    `).get(bookingId)
    if (!original) return null
    return insertFinanceTransaction({
      type: original.type,
      source: 'reversal',
      category: original.category,
      tags: original.tags,
      amountCents: -original.amount_cents,
      payChannel: original.pay_channel,
      occurredOn: localParts(new Date()).date,
      note: `冲销：${original.note || original.id}`,
      bookingId,
      reversalOf: original.id,
      createdBy
    })
  }

  return { bookingIncomeCategory, recordBookingIncome, reverseBookingIncome }
}
