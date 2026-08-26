/* 日结页的两个小件 —— 2026-08-25 从 admin.js 搬出(公约②:动了日结这个域就把它搬出来)。

   🔴 N-5 复核(店主 08-25):退卡**不进损益**是对的(那笔钱从没被确认成收入),
   但**现金合计必须扣它** —— 不扣的话「今天收现 2000、退顾客 400 → 抽屉实际 1600、
   日结却报 2000」,店主晚上数钱对不上,而她不会怀疑退卡,**她会怀疑店员**。
   三本账:损益不动 / 负债已减 / 现金必须减。
   句子全由后端给(cashDrawer / refunds),这里零计算、零拼口径。 */
window.DailyCloseRows = (function () {
  function targetCellText(t, zh, money) {
    if (!t.target || !t.target.perfTargetCents) return '—'
    const gap = t.target.perfTargetCents - t.perfCents
    return gap <= 0
      ? `<span class="dc-badge ok">${zh ? '达标' : 'Hit'}</span>`
      : `${zh ? '差' : 'Short'} ${money(gap, 2)}`
  }

  function cashAndRefundRows(v, { zh, money, escapeHtml }) {
    const drawer = v.cashDrawer
    const rf = v.refunds
    const row = (inner) => `<div class="section-row compact-row" style="margin-top:2px"><span class="subtle">${inner}</span></div>`
    return [
      drawer ? row(`${escapeHtml(drawer.label)} <strong>${escapeHtml(drawer.shouldHaveText)}</strong>`
        + `${drawer.refundOutCents ? ` · ${zh ? '退卡' : 'Refund'} −${escapeHtml(drawer.refundOutText)}` : ''}`
        + ` <em style="font-style:normal;opacity:.75">${escapeHtml(drawer.hint)}</em>`) : '',
      rf && rf.totalCents ? row(`${escapeHtml(rf.label)} · `
        + `${rf.storedCount ? `${zh ? '储值' : 'Stored'} ${rf.storedCount}${zh ? ' 笔' : ''}` : ''}`
        + `${rf.timecardCount ? ` ${zh ? '次卡' : 'Passes'} ${rf.timecardCount}${zh ? ' 笔' : ''}` : ''}`
        + ` ${zh ? '合计' : 'total'} ${money(rf.totalCents, 2)}`) : ''
    ].filter(Boolean).join('')
  }

  return { targetCellText, cashAndRefundRows }
})()
