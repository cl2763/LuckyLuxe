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

  /* 🔴 v1.2 ②(店主 2026-08-27 走查):「应有数」是**一个动作的落点** —— 晚上拿着它去数抽屉。
     原来它跟解释句一样大小混在正文里(她的原话:「根本不让人觉得这是一项操作」)。
     按回执图改成收据式:抬头句 + 大号金额 + 摊开的算式 + 脚注;三小格里退卡单独一格。
     句子与算式行**全部来自后端**(cashDrawer.title/rows/footnote、headline),这里零拼口径。 */
  function cashAndRefundRows(v, { zh, money, escapeHtml }) {
    const d = v.cashDrawer
    if (!d) return ''
    const rows = (d.rows || []).map((r) => `<div class="dc-due-row${r.negative ? ' neg' : ''}"><span>${escapeHtml(r.label)}</span><span>${escapeHtml(r.sign)} ${escapeHtml(r.amountText)}</span></div>`).join('')
    const stats = (v.headline || []).map((h) => `<div class="dc-stat"><div class="l">${escapeHtml(h.label)}</div><div class="v">${escapeHtml(h.value)}</div></div>`).join('')
    return `
      <div class="dc-due">
        <div class="dc-due-lab">${escapeHtml(d.title || d.label)}</div>
        <div class="dc-due-big">${escapeHtml(d.shouldHaveText)}</div>
        <div class="dc-due-calc">
          ${rows}
          <div class="dc-due-row tot"><span>${escapeHtml(d.totalLabel || '')}</span><span>${escapeHtml(d.shouldHaveText)}</span></div>
        </div>
        ${d.footnote ? `<div class="dc-due-aside">${escapeHtml(d.footnote)}</div>` : ''}
      </div>
      ${stats ? `<div class="dc-stats">${stats}</div>` : ''}
      <div class="dc-due-note">${escapeHtml(zh ? '退卡 = 负债减少,不进收入 —— 所以它单独摆一格,不混进营业额。' : 'Refunds reduce liability, not income.')}</div>
    `
  }

  /* 金额更正表单(从 admin.js 搬出,2026-08-27):上半是顾客已签的存档单(只读带锁标),
     下半填改后金额与原因。提交=追加一条更正记录,原签署单永不改动。 */
  function correctionForm(row, zh, { escapeHtml, money }) {
    return `
      <div class="section-row compact-row">
        <h3 style="font-size:15px">${zh ? '金额更正' : 'Amend'} · ${escapeHtml(row.code)}</h3>
        <button class="ghost slim" id="dcCorrectCancel" type="button">${zh ? '返回日结' : 'Back'}</button>
      </div>
      <div class="dc-ro">
        <div class="ro-t"><span>${zh ? '顾客已签存档单(只读)' : 'Signed sheet (read-only)'}</span><span class="lock">${zh ? '不可修改' : 'locked'}</span></div>
        ${escapeHtml(row.servedPersonName || '')}${row.isProxyPaid ? (zh ? '(代付)' : ' (proxy)') : ''} · ${String(row.signedAt || '').slice(0, 16).replace('T', ' ')}
        · ${(row.technicians || []).map((t) => `${escapeHtml(t.name)}(${t.role === 'main' ? (zh ? '主' : 'main') : (zh ? '副' : 'assist')})`).join('/')}<br>
        ${(row.items || []).map((l) => `${String(l.itemNo).padStart(2, '0')} ${escapeHtml(l.name)} ${l.isFree ? (zh ? '免收' : 'free') : money(l.amountCents, 2)}`).join(' · ')}<br>
        ${row.depositDeductCents ? `${zh ? '定金抵扣' : 'Deposit'} −${money(row.depositDeductCents, 2)} · ` : ''}<b>${zh ? '合计' : 'Total'} ${money(row.totalCents, 2)}</b>
      </div>
      <div class="dep-block" style="margin-top:12px">
        <h4>${zh ? '更正内容' : 'Amendment'}</h4>
        <div class="dep-inline" style="margin-top:0">
          <label>${zh ? '更正后合计' : 'New total'}<input id="dcNewTotal" data-money inputmode="decimal" value="${row.totalCents / 100}"></label>
        </div>
        <textarea class="dep-text" id="dcReason" style="min-height:80px;margin-top:10px"
          placeholder="${zh ? '原因(必填):例「实际只补了 1 指,技师勾多了」' : 'Reason (required)'}"></textarea>
        <p class="subtle">${zh
          ? '提交后:① 原签署单保持原样,顾客服务记录追加一条「订单更正记录」(改前/改后/操作人/时间)② 用卡付过的单,储值差额由系统自动补配(人工不可改这笔)③ 更正进当日日结留痕'
          : 'The signed sheet stays untouched; an amendment record is appended.'}</p>
        <button class="primary slim" id="dcCorrectSubmit" type="button">${zh ? '提交更正' : 'Submit'}</button>
      </div>`
  }

  /* 屏 1b 金额更正 + 日结确认/重开的点击处理(2026-08-27 从 admin.js 搬出,公约①②:
     本批动的就是日结这一屏,按「边改边拆」把同屏的行为一起搬过来,admin.js 只留一行分发)。
     返回 true = 这一族接住了这次点击,admin.js 那边就不用再往下找了。 */
  function handleClick(event, ctx) {
    const { state, request, toast, renderDailyClose, loadDailyClose, yuanToCents, zh } = ctx
    const dcCorrect = event.target.closest('[data-dc-correct]')
    if (dcCorrect) {
      const row = (state.view?.settlements || []).find((x) => x.settlementId === dcCorrect.dataset.dcCorrect)
      request(`/settlements/${encodeURIComponent(row.code)}`, { public: true })
        .then((data) => { state.correcting = data.settlement; renderDailyClose() })
        .catch((error) => toast(error.message))
      return true
    }
    if (event.target.closest('#dcCorrectCancel')) { state.correcting = null; renderDailyClose(); return true }
    if (event.target.closest('#dcCorrectSubmit')) {
      const reason = document.querySelector('#dcReason')?.value.trim()
      if (!reason) { toast(zh ? '原因必填' : 'Reason is required'); return true }
      request(`/admin/settlements/${encodeURIComponent(state.correcting.id)}/amend`, {
        method: 'POST',
        body: JSON.stringify({ totalCents: yuanToCents(document.querySelector('#dcNewTotal')?.value), reason })
      }).then((r) => {
        toast(zh ? (r.autoBalanceAdjustCents ? '已更正,储值差额已自动补配' : '已更正,原签署单未改动') : 'Amended')
        state.correcting = null
        return loadDailyClose(state.date)
      }).catch((error) => toast(error.message))
      return true
    }
    if (event.target.closest('#dcConfirm')) {
      request('/admin/daily-close', { method: 'POST', body: JSON.stringify({ date: state.date }) })
        .then(() => { toast(zh ? '日结已确认,业绩定格' : 'Day closed'); return loadDailyClose(state.date) })
        .catch((error) => toast(error.message))
      return true
    }
    if (event.target.closest('#dcReopen')) {
      const reason = window.prompt(zh ? '重开日结必须写原因(会留痕):' : 'Reason (recorded):')
      if (!reason || !reason.trim()) return true
      request('/admin/daily-close/reopen', { method: 'POST', body: JSON.stringify({ date: state.date, reason: reason.trim() }) })
        .then(() => { toast(zh ? '已重开,可以改分成了' : 'Reopened'); return loadDailyClose(state.date) })
        .catch((error) => toast(error.message))
      return true
    }
    return false
  }

  return { targetCellText, cashAndRefundRows, correctionForm, handleClick }
})()
