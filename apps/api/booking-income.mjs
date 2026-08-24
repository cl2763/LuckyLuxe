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

  /* ⚰️ recordBookingIncome 已退役(店主 08-24 拍 A 案:入账唯一路径=签署)。
     函数整体删除而不是留着不调用 —— 留着就是"看到有现成的就接上去"把旧路径复活的种子。
     签署入账那一刀写在 local-server.mjs 的 signSettlement 里(按结算单到店应收,不是预约标价);
     D70 那个"已签署单再点已完成会重复入账"的口子,随这条路径消失而根除。
     入账触点现在只剩下面这一个:取消/过期 → 红字冲销。 */

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

  return { bookingIncomeCategory, reverseBookingIncome }
}
