/* 纠错事由输入 · 网页端唯一出口(D122,店主 03c/03e)

   后端三个纠错口(账本冲销 / 储值冲销 / 现金手记冲销)已一律事由必填。
   前端不许各写一个 prompt —— 那是「每处各写一套」的老毛病;这里一处出口,四个调用点共用。

   句子与后端同源:提示语在这里,后端拒绝时的报错在 correction-reason.mjs,
   两边说的是同一件事(纠错要说明白为什么)。 */
window.CorrectionReason = (() => {
  const MAX = 200
  /* 返回事由字符串;用户取消返回 null(调用方据此中止,不发请求) */
  async function ask(zh, what) {
    const title = zh
      ? `请写明冲销事由(必填,会进账本备注,以后查得到)\n${what || ''}`
      : `Reason for this correction (required, goes into the ledger note)\n${what || ''}`
    const raw = await window.UIDialog.text(title, { placeholder: zh ? '写清为什么要改这一笔' : 'Why this correction' })
    if (raw === null) return null                       // 取消
    const reason = String(raw).trim()
    if (!reason) { await window.UIDialog.alert(zh ? '事由必填 —— 账本只追加,现在不写,以后补不上。' : 'Reason is required.'); return null }
    if (reason.length > MAX) { await window.UIDialog.alert(zh ? `事由太长了,请控制在 ${MAX} 字以内。` : `Max ${MAX} characters.`); return null }
    return reason
  }
  /* 账本冲销的整段动作(D122):从 admin.js 搬出 —— 那个文件是现状冻结候拆的棘轮项,
     加功能就得先腾地方(公约②边改边拆)。事由必填在这里问一次,后端再硬拦一次。 */
  async function reverseFinanceTxn({ id, zh, request, toast, reload }) {
    const why = await ask(zh)
    if (!why) return
    request(`/admin/finance/transactions/${encodeURIComponent(id)}/reverse`, { method: 'POST', body: JSON.stringify({ reason: why }) })
      .then(reload)
      .then(() => toast(zh ? '已生成冲销单' : 'Reversal created'))
      .catch((error) => toast(error.message))
  }

  return { ask, MAX, reverseFinanceTxn }
})()
