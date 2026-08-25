/* 客户档案 →「账户调整」弹层(N-5 退卡口,图=合同「退卡口设计图」)。
   2026-08-25 新建模块(公约①:新功能一律新模块;admin.js 早已超 1,500 行红线)。

   🔴 这个口开的是**退卡**,不是「手动耗卡」——
   手动耗卡会凭空确认一笔收入(服务并没发生),系统里故意没有那个按钮;
   退卡只动负债与现金,收入一分不碰。所以屏上那行「本店收入影响 $0.00」不是装饰:
   对商家是定心丸(退了钱月底报表不会乱),对系统是约束(它要是哪天不是 0,就是账记错了)。

   店主口径:**系统不替商家算该退多少**。四个参考数只是不让他瞎填,退多少他自己定。 */
window.AccountAdjust = (function () {
  let ctx = null            // { request, money, toast, escapeHtml, onDone, zh }
  /* 输入值放 state,不从 DOM 里现读:弹层每次重画都会重建 input,
     从 DOM 读就会出现"点了全额退、结算块显示 804、输入框却是空的"(实测撞到过)。 */
  let stateA = { userId: '', name: '', facts: null, tab: 'refund', cards: [], cardId: '', amount: '', times: '', busy: false }

  const el = () => document.querySelector('#accountAdjustOverlay')
  function close() { const o = el(); if (o) o.remove(); stateA.facts = null }

  async function open({ userId, name, meta, request, money, toast, escapeHtml, onDone, zh = true }) {
    ctx = { request, money, toast, escapeHtml, onDone, zh }
    stateA = { userId, name: name || '', meta: meta || '', facts: null, tab: 'refund', cards: [], cardId: '', amount: '', times: '', busy: false }
    mount()
    try {
      const [f, pack] = await Promise.all([
        request(`/admin/account-adjust/facts?userId=${encodeURIComponent(userId)}`),
        request(`/admin/customers/${encodeURIComponent(userId)}/timecards`).catch(() => ({ timecards: [] }))
      ])
      stateA.facts = f.facts
      stateA.cards = (pack.timecards || []).filter((c) => c.remaining > 0)
    } catch (e) { toast(e.message) }
    mount()
  }

  function mount() {
    let o = el()
    if (!o) {
      o = document.createElement('div')
      o.id = 'accountAdjustOverlay'
      o.className = 'store-switch-overlay'
      document.body.appendChild(o)
      o.addEventListener('click', onClick)
    }
    o.innerHTML = render()
  }

  function render() {
    const { escapeHtml, money, zh } = ctx
    const f = stateA.facts
    const seg = [['recharge', zh ? '充值' : 'Recharge'], ['bonus', zh ? '赠送' : 'Bonus'], ['refund', zh ? '退卡' : 'Refund'], ['reversal', zh ? '冲销' : 'Reversal']]
    return `
      <div class="store-switch-panel account-adjust-panel">
        <div class="aa-head">
          <strong>${escapeHtml(stateA.name)}</strong>
          <span class="subtle">${escapeHtml(stateA.meta || '')}</span>
          <button class="ghost slim" data-aa-close type="button">✕</button>
        </div>
        ${f ? `
        <div class="aa-facts">
          <div class="aa-fact"><span>${zh ? '顾客实付累计' : 'Paid'}</span><strong>${escapeHtml(f.paidText)}</strong></div>
          <div class="aa-fact"><span>${zh ? '赠送累计' : 'Bonus'}</span><strong>${escapeHtml(f.bonusText)}</strong></div>
          <div class="aa-fact"><span>${zh ? '已消费' : 'Consumed'}</span><strong>${escapeHtml(f.consumedText)}</strong></div>
          <div class="aa-fact hi"><span>${zh ? '当前余额' : 'Balance'}</span><strong>${escapeHtml(f.balanceText)}</strong></div>
        </div>
        <p class="aa-hint">${escapeHtml(f.hint)}</p>` : `<p class="aa-hint">${zh ? '读取中…' : 'Loading…'}</p>`}
        <div class="aa-seg">${seg.map(([k, label]) => `<button class="aa-seg-btn${stateA.tab === k ? ' on' : ''}" data-aa-tab="${k}" type="button">${label}</button>`).join('')}</div>
        ${stateA.tab === 'refund' ? renderRefund() : renderElsewhere()}
      </div>`
  }

  /* 充值 / 赠送 / 冲销三段都已经有各自的正式入口 —— 这里只做**去那儿**,
     不在弹层里再造一份写口(同一件事两处写口 = 迟早分叉)。 */
  function renderElsewhere() {
    const { zh } = ctx
    const where = {
      recharge: zh ? '充值走「会员与营销 → 充值」那条正式入口(含套餐、赠送、经手技师)。' : 'Use Membership → Recharge.',
      bonus: zh ? '赠送跟着充值一起记(充 X 赠 Y),在「会员与营销 → 充值」里填赠送额。' : 'Bonus is recorded with a recharge.',
      reversal: zh ? '冲销是「我们记错了」的红字改正,不是退钱给顾客;在财务页对那笔流水做冲销。' : 'Reversal corrects our own mistake — not a customer refund.'
    }[stateA.tab]
    return `<div class="aa-elsewhere"><p>${ctx.escapeHtml(where)}</p>
      <div class="aa-btns"><button class="ghost" data-aa-goto="${stateA.tab}" type="button">${zh ? '去那个入口' : 'Go there'}</button></div></div>`
  }

  function renderRefund() {
    const { escapeHtml, money, zh } = ctx
    const f = stateA.facts
    if (!f) return ''
    const amountCents = Math.round(Number(stateA.amount || 0) * 100)
    const after = Math.max(0, f.balanceCents - (Number.isFinite(amountCents) ? amountCents : 0))
    return `
      <div class="aa-sub">
        <button class="aa-sub-btn${stateA.cardId ? '' : ' on'}" data-aa-card="" type="button">${zh ? '退储值' : 'Stored value'}</button>
        ${/* 过期卡也列出来:退不退是商家的决定(顾客可能就是因为过期才要退),
             但**必须标出来**,不然商家以为它还能用。 */''}
        ${stateA.cards.map((c) => `<button class="aa-sub-btn${stateA.cardId === c.id ? ' on' : ''}" data-aa-card="${escapeHtml(c.id)}" type="button">${escapeHtml(c.name)} · ${zh ? '剩' : 'left'} ${c.remaining}${c.expired ? (zh ? ' · 已过期' : ' · expired') : ''}</button>`).join('')}
      </div>
      ${stateA.cardId ? renderCardRefund() : `
      <label class="aa-field"><span>${zh ? '退款金额' : 'Refund amount'}</span>
        <input id="aaAmount" type="number" min="0" step="0.01" placeholder="0.00" value="${escapeHtml(String(stateA.amount || ''))}">
        <em>${zh ? `不得超过当前余额 ${f.balanceText}。` : `Not more than ${f.balanceText}.`} <button class="aa-link" data-aa-all type="button">${zh ? '全额退(清空)' : 'Refund all'}</button></em>
      </label>
      <label class="aa-field"><span>${zh ? '退款方式' : 'Method'}</span>
        <select id="aaChannel">
          <option value="cash">${zh ? '现金' : 'Cash'}</option>
          <option value="transfer">${zh ? '转账' : 'Transfer'}</option>
          <option value="original">${zh ? '原路退回' : 'Original channel'}</option>
          <option value="other">${zh ? '其它' : 'Other'}</option>
        </select>
      </label>
      <label class="aa-field"><span>${zh ? '原因(必填)' : 'Reason (required)'}</span>
        <input id="aaReason" type="text" maxlength="200" placeholder="${zh ? '例:顾客搬去外地,不再来店' : 'e.g. moved away'}">
        <em>${zh ? '会写进这位顾客的账户记录,以后查得到。' : 'Kept on the customer record.'}</em>
      </label>
      <div class="aa-calc">
        <div><span>${zh ? '退款金额' : 'Refund'}</span><span>−${money(Number.isFinite(amountCents) ? amountCents : 0)}</span></div>
        <div><span>${zh ? '本店收入影响' : 'Impact on income'}</span><span>${escapeHtml(f.incomeImpactText)}</span></div>
        <div class="tot"><span>${zh ? '退款后余额' : 'Balance after'}</span><span>${money(after)}</span></div>
      </div>
      <div class="aa-btns">
        <button class="primary" data-aa-submit type="button" ${stateA.busy ? 'disabled' : ''}>${zh ? '确认退款' : 'Confirm refund'}</button>
        <button class="ghost" data-aa-close type="button">${zh ? '取消' : 'Cancel'}</button>
      </div>`}`
  }

  function renderCardRefund() {
    const { escapeHtml, money, zh } = ctx
    const c = stateA.cards.find((x) => x.id === stateA.cardId)
    if (!c) return ''
    const unit = c.totalTimes > 0 ? Math.round(c.priceCents / c.totalTimes) : 0
    const times = Math.round(Number(stateA.times || 0))
    const left = Math.max(0, c.remaining - (Number.isFinite(times) ? times : 0))
    return `
      <div class="aa-facts">
        <div class="aa-fact"><span>${zh ? '卡名' : 'Card'}</span><strong style="font-size:14px">${escapeHtml(c.name)}</strong></div>
        <div class="aa-fact"><span>${zh ? '购卡价' : 'Price'}</span><strong>${money(c.priceCents)}</strong></div>
        <div class="aa-fact"><span>${zh ? '已核销' : 'Used'}</span><strong>${c.usedTimes} ${zh ? '次' : ''}</strong></div>
        <div class="aa-fact hi"><span>${zh ? '剩余' : 'Left'}</span><strong>${c.remaining} ${zh ? '次' : ''}</strong></div>
      </div>
      <p class="aa-hint">${zh ? `折算单价 ${ctx.money(unit)}/次 — 仅供参考,退款金额由你填。` : `Unit ${ctx.money(unit)} — reference only.`}</p>
      <label class="aa-field"><span>${zh ? '退多少次' : 'Times to refund'}</span>
        <input id="aaTimes" type="number" min="1" step="1" max="${c.remaining}" placeholder="0" value="${escapeHtml(String(stateA.times || ''))}">
        <em>${zh ? `不得超过剩余 ${c.remaining} 次。退完剩 0 次 = 这张卡作废。` : `Max ${c.remaining}.`}</em>
      </label>
      <label class="aa-field"><span>${zh ? '退款金额' : 'Refund amount'}</span><input id="aaCardAmount" type="number" min="0" step="0.01" placeholder="0.00"></label>
      <label class="aa-field"><span>${zh ? '原因(必填)' : 'Reason (required)'}</span><input id="aaReason" type="text" maxlength="200" placeholder="${zh ? '例:顾客要求全退' : 'e.g. customer asked'}"></label>
      <div class="aa-calc">
        <div><span>${zh ? '本店收入影响' : 'Impact on income'}</span><span>${escapeHtml(stateA.facts.incomeImpactText)}</span></div>
        <div class="tot"><span>${zh ? '退款后剩余' : 'Times after'}</span><span>${left} ${zh ? '次' : ''}${left === 0 ? (zh ? '(卡作废)' : ' (void)') : ''}</span></div>
      </div>
      <div class="aa-btns">
        <button class="primary" data-aa-card-submit type="button" ${stateA.busy ? 'disabled' : ''}>${zh ? '确认退卡' : 'Confirm refund'}</button>
        <button class="ghost" data-aa-close type="button">${zh ? '取消' : 'Cancel'}</button>
      </div>`
  }

  async function onClick(event) {
    const { request, toast, zh } = ctx
    if (event.target.closest('[data-aa-close]') || event.target === el()) { close(); return }
    const tab = event.target.closest('[data-aa-tab]')
    if (tab) { stateA.tab = tab.dataset.aaTab; mount(); return }
    const card = event.target.closest('[data-aa-card]')
    if (card) { stateA.cardId = card.dataset.aaCard || ''; mount(); return }
    if (event.target.closest('[data-aa-all]')) {
      if (stateA.facts) { stateA.amount = (stateA.facts.balanceCents / 100).toFixed(2); mount() }
      return
    }
    const goto = event.target.closest('[data-aa-goto]')
    if (goto) { close(); ctx.onDone({ goto: goto.dataset.aaGoto, userId: stateA.userId }); return }
    if (event.target.closest('[data-aa-submit]')) {
      const amount = Math.round(Number(stateA.amount || 0) * 100)
      const reason = String(document.querySelector('#aaReason')?.value || '').trim()
      const payChannel = String(document.querySelector('#aaChannel')?.value || 'cash')
      if (!reason) { toast(zh ? '退款原因必填' : 'Reason required'); return }
      stateA.busy = true; mount()
      try {
        const r = await request('/admin/stored-value/refund', { method: 'POST', body: JSON.stringify({ userId: stateA.userId, amountCents: amount, payChannel, reason }) })
        toast(zh ? `已退款 ${ctx.money(r.refundedCents)},余额 ${ctx.money(r.balanceAfterCents)}` : 'Refunded')
        close(); ctx.onDone({ refunded: true })
      } catch (e) { stateA.busy = false; mount(); toast(e.message) }
      return
    }
    if (event.target.closest('[data-aa-card-submit]')) {
      const times = Math.round(Number(stateA.times || 0))
      const amount = Math.round(Number(document.querySelector('#aaCardAmount')?.value || 0) * 100)
      const reason = String(document.querySelector('#aaReason')?.value || '').trim()
      if (!reason) { toast(zh ? '退卡原因必填' : 'Reason required'); return }
      stateA.busy = true; mount()
      try {
        const r = await request(`/admin/timecards/${encodeURIComponent(stateA.cardId)}/refund`, { method: 'POST', body: JSON.stringify({ times, amountCents: amount, reason, payChannel: 'cash' }) })
        toast(zh ? `已退 ${r.refundedTimes} 次${r.voided ? '(卡作废)' : ''}` : 'Refunded')
        close(); ctx.onDone({ refunded: true })
      } catch (e) { stateA.busy = false; mount(); toast(e.message) }
    }
  }

  // 输入时重算那三行(退款后余额 / 剩余次数)——只重画,不发请求
  // 输入时把值存进 state 再重画那三行(退款后余额 / 剩余次数),重画后光标回到原处
  document.addEventListener('input', (e) => {
    if (!el()) return
    if (e.target.id === 'aaAmount') stateA.amount = e.target.value
    else if (e.target.id === 'aaTimes') stateA.times = e.target.value
    else return
    const id = e.target.id
    mount()
    const again = document.querySelector('#' + id)
    if (again) { again.focus(); const n = again.value.length; try { again.setSelectionRange(n, n) } catch (err) { /* number 输入框不支持就算了 */ } }
  })

  /* 客户档案上那个「账户调整」按钮的点击处理 —— 连同"充值/赠送/冲销去哪儿"的跳转,
     整块住在这里,admin.js 那边只剩一行调用(它早已超 1,500 行红线,只许搬出)。 */
  function handleClick(event, deps) {
    const hit = event.target.closest('[data-account-adjust]')
    if (!hit) return false
    const uid = hit.dataset.accountAdjust
    const c = (deps.owner.customers || []).find((x) => x.id === uid) || {}
    open({
      userId: uid,
      name: deps.customerName(c),
      meta: `${deps.owner.lang === 'zh' ? '到店' : 'Visits'} ${c.visitCount || 0}${c.lastVisitAt ? ` · ${deps.dateOnly(c.lastVisitAt)}` : ''}`,
      request: deps.request, money: deps.money, toast: deps.toast, escapeHtml: deps.escapeHtml,
      zh: deps.owner.lang === 'zh',
      onDone: (r) => {
        if (r && r.goto) {
          // 充值/赠送/冲销都有各自的正式入口 —— 这里只把人送过去,不在弹层里再造一份写口
          deps.membershipData.prefillUserId = r.userId
          deps.membershipData.tab = 'recharge'
          deps.owner.adminPage = r.goto === 'reversal' ? 'finance' : 'membership'
          if (deps.owner.adminPage === 'membership') deps.loadMembershipPage().catch((e) => deps.toast(e.message))
          deps.render()
          return
        }
        // 退完刷新客户列表(余额/会员标都可能变)——走既有的整表刷新口,不另造一个
        deps.request('/admin/customers').then((d) => { deps.owner.customers = d.customers; deps.renderCustomers() }).catch(() => {})
      }
    })
    return true
  }

  return { open, close, handleClick }
})()
