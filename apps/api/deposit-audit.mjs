/* 定金守恒 · 定时自检(店主 2026-08-29 两票之一:「deposit-conservation 做成定时自检」)。

   背景:守恒审计口 `/admin/finance/deposit-conservation` 建了却**两端都没入口** ——
   判定表把它列为「漏接,单独裁」,店主选了 B:**不接 UI,做成定时自检**。

   「定时」的落法:**每日日结确认那一刻自动跑一次**(日结每天确认一次,就是每日一次;
   不另起 setInterval —— 常驻计时器在 --watch 重载下会攒出一堆幽灵任务,而且没人守它挂没挂)。
   结果**落库**(daily_closes.deposit_audit_json),不是跑完就丢:
   哪天审的、审出什么,和日结记录钉在一起,可回看。

   显示规矩(店主原话):**平 = 什么都不显示;不平 = 日结页红字「定金对不上,差 $X」。**
   句子后端出(depositAlertOf),两端照渲染 —— 平的日子响应里连字段都没有,不是空字符串。 */
export function createDepositAudit({ db, auditDepositConservation, formatMoneyCents }) {
  /* 日结确认钩子:跑审计、把结果写进当日日结行。失败不许吞(静默失败器族):
     审计挂了要让确认操作者看见,而不是留一个"看起来审过"的空洞。 */
  function runOnConfirm(closeId, tenantId) {
    const broken = auditDepositConservation(tenantId)
    const missingCents = broken.reduce((n, b) => n + Math.max(0, (b.amountCents || 0) - (b.incomeCents || 0)), 0)
    db.prepare('UPDATE daily_closes SET deposit_audit_json = ? WHERE id = ?')
      .run(JSON.stringify({ at: new Date().toISOString(), brokenCount: broken.length, missingCents }), closeId)
    return { brokenCount: broken.length, missingCents }
  }

  /* 日结页那行红字的唯一出口:没审过 / 审过且平 → null(响应里不出现);不平 → 后端出句。 */
  function depositAlertOf(closeRow, tenantId) {
    if (!closeRow || !closeRow.deposit_audit_json) return null
    let audit = null
    try { audit = JSON.parse(closeRow.deposit_audit_json) } catch { return null }
    if (!audit || !audit.brokenCount) return null
    return {
      text: `定金对不上,差 ${formatMoneyCents(audit.missingCents, tenantId, 'auto')}(${audit.brokenCount} 笔)——每一笔已兑现的定金都该有等额收入行,查守恒审计。`,
      missingCents: audit.missingCents,
      brokenCount: audit.brokenCount,
      auditedAt: audit.at
    }
  }

  return { runOnConfirm, depositAlertOf }
}
