/* 账本冲销 · 从 local-server 搬出(D122,店主 03c;公约②边改边拆)

   为什么搬:巨型文件棘轮钉死在 18243,而这一处要加「事由必填」——
   店主 02v 立的规矩是**只许搬出不许抬,更不许把代码挤成一行迁就棘轮**。

   本次唯一的行为变化:**事由必填**(与金额更正同口径,08-27 起后端硬拦)。
   判词是 Code 自己那句、店主收作 D122 判词的话:
   「同一件事 —— 纠错要说明白为什么 —— 在两个口子上,一个收了一个没收。」 */
import { requireReason, withReason } from './correction-reason.mjs'

export async function reverseFinanceTxn({ txnId, body, adminSession, db, tenantId, apiError, insertFinanceTransaction, serializeFinanceTransaction, occurredOn }) {
  if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
  /* 🔴 D122:事由必填 —— 账本只追加,冲销时没写清为什么,以后**永远补不上**。
     03f 病二:**参数校验排在查库之前**(与现金手记口对齐)——
     原来先查"行存不存在",空事由打不存在的 id 会得到 404,事由闸根本没被踩到。 */
  const reason = requireReason(body, apiError)
  const original = db.prepare('SELECT * FROM finance_transactions WHERE id = ? AND tenant_id = ?').get(txnId, tenantId)
  if (!original) throw apiError(404, 'NOT_FOUND', 'Transaction not found.')
  const already = db.prepare('SELECT id FROM finance_transactions WHERE reversal_of = ?').get(txnId)
  if (already) throw apiError(400, 'BAD_REQUEST', 'Transaction already reversed.')
  const row = insertFinanceTransaction({
    type: original.type,
    source: 'reversal',
    category: original.category,
    tags: original.tags,
    amountCents: -original.amount_cents,
    payChannel: original.pay_channel,
    occurredOn,
    note: withReason(`冲销：${original.note || original.id}`, reason),
    bookingId: original.booking_id,
    reversalOf: original.id,
    createdBy: adminSession.email || 'owner'
  })
  return { transaction: serializeFinanceTransaction(row) }
}
