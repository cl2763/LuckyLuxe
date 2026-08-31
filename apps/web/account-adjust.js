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
  let stateA = { userId: '', name: '', facts: null, tab: 'recharge', cards: [], cardId: '', amount: '', times: '', cardAmount: '', warning: '', busy: false, bound: true, rvPkgs: [], rvPkgId: '', rvAmount: '', rvBonus: '', roster: [], month: '', txns: [], bookingIds: null }

  const el = () => document.querySelector('#accountAdjustOverlay')
  function close() { const o = el(); if (o) o.remove(); stateA.facts = null }

  async function open({ userId, name, meta, request, money, toast, escapeHtml, onDone, zh = true, bookings = [], technicians = [] }) {
    ctx = { request, money, toast, escapeHtml, onDone, zh }
    stateA = { userId, name: name || '', meta: meta || '', facts: null, tab: 'recharge', cards: [], cardId: '', amount: '', times: '', cardAmount: '', warning: '', busy: false,
      bound: true, rvPkgs: [], rvPkgId: '', rvAmount: '', rvBonus: '', roster: technicians, month: '', txns: [],
      bookingIds: new Set(bookings.filter((b) => b.user?.id === userId).map((b) => b.id)) }
    mount()
    try {
      const [f, pack, lk, pkgs] = await Promise.all([
        request(`/admin/account-adjust/facts?userId=${encodeURIComponent(userId)}`),
        request(`/admin/customers/${encodeURIComponent(userId)}/timecards`).catch(() => ({ timecards: [] })),
        request(`/admin/customers/lookup?userId=${encodeURIComponent(userId)}`).catch(() => null),
        request('/admin/recharge-packages').catch(() => ({ packages: [] }))
      ])
      stateA.facts = f.facts
      stateA.cards = (pack.timecards || []).filter((c) => c.remaining > 0)
      stateA.bound = lk && lk.hit ? lk.hit.bound !== false : true
      stateA.rvPkgs = pkgs.packages || []
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
        ${/* 🔴 图 v1.1 ①:当前余额下面那一行 —— 界限画到屏上(句子后端给,前端零拼串) */''}
        <p class="aa-split">${escapeHtml(f.splitText || '')}</p>
        <p class="aa-hint">${escapeHtml(f.hint)}</p>` : `<p class="aa-hint">${zh ? '读取中…' : 'Loading…'}</p>`}
        <div class="aa-seg">${seg.map(([k, label]) => `<button class="aa-seg-btn${stateA.tab === k ? ' on' : ''}" data-aa-tab="${k}" type="button">${label}</button>`).join('')}</div>
        ${stateA.tab === 'refund' ? renderRefund() : (stateA.tab === 'reversal' ? renderReversal() : renderRecharge())}
      </div>`
  }

  /* 入口总收敛(店主 08-30c 裁):充值/赠送/冲销**内嵌**在本弹层 —— 调的仍是各自既有唯一写口
     (/admin/stored-value/recharge 与 /admin/finance/transactions/:id/reverse),后端路由一个不加一个不改;
     UI 从「去那个入口」改为表单就地填 —— 同一件事仍只有一个写口,只是入口并到了这里。 */
  function renderRecharge() {
    const { escapeHtml, zh } = ctx
    const isBonusTab = stateA.tab === 'bonus'
    return `
      ${isBonusTab ? `<p class="aa-hint">${zh ? '赠送=营销让利,跟充值一起记(充 X 赠 Y):入储值负债、明细单独列示,不算实收、不计业绩与积分。' : 'Bonus posts together with a recharge.'}</p>` : ''}
      ${stateA.bound ? '' : `<div class="aa-warn">${zh ? '该档案未绑定微信 —— 请先让顾客扫码绑定(会员码/签署码)再充值。' : 'Customer not bound yet.'}</div>`}
      ${stateA.rvPkgs.length ? `<label class="aa-field"><span>${zh ? '按套餐(可选,点选自动填金额与赠送)' : 'Package (optional)'}</span>
        <div class="aa-sub">${stateA.rvPkgs.map((p) => `<button class="aa-sub-btn${stateA.rvPkgId === p.id ? ' on' : ''}" data-aa-pkg="${escapeHtml(p.id)}" type="button">${escapeHtml(p.label)}</button>`).join('')}</div></label>` : ''}
      <label class="aa-field"><span>${zh ? '充值金额' : 'Amount'}</span>${window.MoneyInput.field({ id: 'aaRvAmount', value: escapeHtml(String(stateA.rvAmount || '')) })}</label>
      <label class="aa-field"><span>${zh ? '赠送(可空)' : 'Bonus (optional)'}</span>${window.MoneyInput.field({ id: 'aaRvBonus', value: escapeHtml(String(stateA.rvBonus || '')) })}</label>
      <label class="aa-field"><span>${zh ? '付款方式' : 'Channel'}</span>
        <select id="aaRvChannel">
          <option value="cash">${zh ? '现金' : 'Cash'}</option>
          <option value="card">${zh ? '刷卡' : 'Card'}</option>
          <option value="transfer">${zh ? '转账' : 'Transfer'}</option>
          <option value="unknown">${zh ? '其他' : 'Other'}</option>
        </select>
      </label>
      <label class="aa-field"><span>${zh ? '经手技师' : 'Technician'}</span>
        <select id="aaRvTech"><option value="">${zh ? '店里直收' : 'Direct'}</option>${stateA.roster.map((t2) => `<option value="${escapeHtml(t2.id)}">${escapeHtml(t2.name)}</option>`).join('')}</select>
        <em>${zh ? '这笔充值算谁促成,充值提成据此计算。' : 'Attribution for commission.'}</em>
      </label>
      <div class="aa-btns">
        <button class="primary" data-aa-rv-submit type="button" ${stateA.busy ? 'disabled' : ''}>${stateA.busy ? (zh ? '提交中…' : '…') : (zh ? '确认到账' : 'Confirm')}</button>
        <button class="ghost" data-aa-close type="button">${zh ? '取消' : 'Cancel'}</button>
      </div>`
  }

  function renderReversal() {
    const { escapeHtml, money, zh } = ctx
    if (!stateA.month) return `<p class="aa-hint">${zh ? '读取中…' : 'Loading…'}</p>`
    return `
      <p class="aa-hint">${zh ? '冲销是「我们记错了」的红字改正,不是退钱给顾客;点「冲销」生成等额反向记录纠错,原始记录永远保留。' : 'Reversal corrects our own mistake.'}</p>
      <div class="aa-mrow"><button class="ghost slim" data-aa-month="-1" type="button">‹</button><strong>${stateA.month}</strong><button class="ghost slim" data-aa-month="1" type="button">›</button></div>
      ${stateA.txns.length ? stateA.txns.map((x) => `
        <div class="aa-txn${x.isReversal ? ' rev' : ''}">
          <div class="aa-txn-info"><span class="subtle">${x.occurredOn}${x.isReversal ? (zh ? ' · 冲销单' : ' · reversal') : ''}${x.reversed ? (zh ? ' · 已冲销' : ' · reversed') : ''}</span><span>${escapeHtml(x.note)}</span></div>
          <strong${x.negative ? ' class="neg"' : ''}>${x.negative ? '−' : ''}${money(Math.abs(x.amountCents))}</strong>
          ${x.canReverse ? `<button class="ghost slim" data-aa-reverse="${escapeHtml(x.id)}" data-kind="${x.kind}" type="button">${zh ? '冲销' : 'Reverse'}</button>` : ''}
        </div>`).join('') : `<p class="aa-hint">${zh ? `${stateA.month} 没有与这位顾客订单关联的账本流水。` : 'No linked ledger rows this month.'}</p>`}`
  }

  function curMonth() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  async function loadTxns(month) {
    stateA.month = month
    try {
      /* 裁定2(08-30d):储值行与账本行同列一表 —— 两读口合流,行尾同一个「冲销」钮。
         储值行冲的是「错记的充值」(合同①);账本行冲的是记错的收支(既有口)。 */
      const [r, sv] = await Promise.all([
        ctx.request(`/admin/finance/transactions?month=${month}&userId=${encodeURIComponent(stateA.userId)}`),
        ctx.request(`/admin/stored-value/txns?month=${month}`).catch(() => ({ txns: [] }))
      ])
      const all = r.transactions || []
      const reversedSet = new Set(all.filter((t2) => t2.reversalOf).map((t2) => t2.reversalOf))
      const finRows = all
        .filter((t2) => t2.bookingId && stateA.bookingIds.has(t2.bookingId))
        .map((t2) => ({ id: t2.id, kind: 'fin', occurredOn: t2.occurredOn, note: t2.note || t2.category || t2.source, amountCents: t2.amountCents, negative: t2.amountCents < 0, isReversal: t2.source === 'reversal', reversed: reversedSet.has(t2.id), canReverse: t2.source !== 'reversal' && !reversedSet.has(t2.id) }))
      const SV_LABEL = { recharge: '储值充值', bonus: '充值赠送', reversal: '储值冲销单', consume: '储值消费' }
      const svRows = (sv.txns || [])
        .filter((t2) => t2.userId === stateA.userId && t2.type !== 'consume')
        .map((t2) => ({ id: t2.id, kind: 'sv', occurredOn: t2.occurredOn, note: `${SV_LABEL[t2.type] || t2.type}${t2.note ? ' · ' + t2.note : ''}`, amountCents: t2.amountCents, negative: t2.amountCents < 0, isReversal: t2.type === 'reversal', reversed: Boolean(t2.reversed), canReverse: t2.type === 'recharge' && !t2.reversed }))
      stateA.txns = finRows.concat(svRows).sort((a, b2) => String(b2.occurredOn).localeCompare(String(a.occurredOn)))
    } catch (e) { ctx.toast(e.message); stateA.txns = [] }
    mount()
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
        ${window.MoneyInput.field({ id: 'aaAmount', value: escapeHtml(String(stateA.amount || '')) })}
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
      ${/* 🔴 图 v1.1 ①:越过「顾客实付可退」出黄条 —— **只提醒,不拦**(退多少是商家的决定)。
             句子由后端给(bonusWarningText),前端不自己算"退了多少赠送"。 */''}
      ${stateA.warning ? `<div class="aa-warn">${escapeHtml(stateA.warning)}</div>` : ''}
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
        <input id="aaTimes" type="text" inputmode="numeric" autocomplete="off" placeholder="0" value="${escapeHtml(String(stateA.times || ''))}">
        <em>${zh ? `不得超过剩余 ${c.remaining} 次。退完剩 0 次 = 这张卡作废。` : `Max ${c.remaining}.`}</em>
      </label>
      <label class="aa-field"><span>${zh ? '退款金额' : 'Refund amount'}</span>${window.MoneyInput.field({ id: 'aaCardAmount', value: escapeHtml(String(stateA.cardAmount || '')) })}</label>
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
    if (tab) {
      stateA.tab = tab.dataset.aaTab
      if (stateA.tab === 'reversal' && !stateA.month) { loadTxns(curMonth()); return }
      mount(); return
    }
    const card = event.target.closest('[data-aa-card]')
    if (card) { stateA.cardId = card.dataset.aaCard || ''; mount(); return }
    if (event.target.closest('[data-aa-all]')) {
      if (stateA.facts) {
        stateA.amount = (stateA.facts.balanceCents / 100).toFixed(2)
        const box = document.querySelector('#aaAmount')
        if (box) box.value = stateA.amount        // 就地填,不重画(重画就是那个"框是空的"老病)
        patchCalc()
        ctx.request(`/admin/account-adjust/facts?userId=${encodeURIComponent(stateA.userId)}&amountCents=${window.MoneyInput.centsOf(stateA.amount)}`)
          .then((r) => { if (el()) { stateA.warning = r.bonusWarning || ''; patchWarning() } }).catch(() => {})
      }
      return
    }
    const pkgBtn = event.target.closest('[data-aa-pkg]')
    if (pkgBtn) {
      const id = pkgBtn.dataset.aaPkg
      if (stateA.rvPkgId === id) { stateA.rvPkgId = '' } else {
        const p = stateA.rvPkgs.find((x) => x.id === id)
        if (p) {
          stateA.rvPkgId = id
          stateA.rvAmount = (p.priceCents / 100).toFixed(2)
          stateA.rvBonus = p.bonusCents ? (p.bonusCents / 100).toFixed(2) : ''
        }
      }
      mount(); return
    }
    if (event.target.closest('[data-aa-rv-submit]')) {
      const cents = window.MoneyInput.centsOf(stateA.rvAmount)
      const bonus = window.MoneyInput.centsOf(stateA.rvBonus)
      if (!(cents > 0)) { toast(zh ? '充值金额要大于 0(赠送随充值一起记)' : 'Amount required'); return }
      stateA.busy = true; mount()
      try {
        await request('/admin/stored-value/recharge', { method: 'POST', body: JSON.stringify({
          userId: stateA.userId, amountCents: cents, bonusCents: bonus,
          payChannel: document.querySelector('#aaRvChannel')?.value || 'unknown',
          ...(document.querySelector('#aaRvTech')?.value ? { technicianId: document.querySelector('#aaRvTech').value } : {})
        }) })
        toast(zh ? `已到账 ${ctx.money(cents)}${bonus ? ` 赠 ${ctx.money(bonus)}` : ''}` : 'Recharged')
        stateA.busy = false; stateA.rvAmount = ''; stateA.rvBonus = ''; stateA.rvPkgId = ''
        /* 四个参考数=真值重拉,不前端加减 */
        const f = await request(`/admin/account-adjust/facts?userId=${encodeURIComponent(stateA.userId)}`).catch(() => null)
        if (f) stateA.facts = f.facts
        mount(); ctx.onDone({ recharged: true })
      } catch (e) { stateA.busy = false; mount(); toast(e.message) }
      return
    }
    const mBtn = event.target.closest('[data-aa-month]')
    if (mBtn) {
      const [y, mo] = stateA.month.split('-').map(Number)
      const t2 = new Date(y, mo - 1 + Number(mBtn.dataset.aaMonth), 1)
      loadTxns(`${t2.getFullYear()}-${String(t2.getMonth() + 1).padStart(2, '0')}`)
      return
    }
    const revBtn = event.target.closest('[data-aa-reverse]')
    if (revBtn) {
      const row = stateA.txns.find((x) => x.id === revBtn.dataset.aaReverse)
      if (!confirm(zh ? `确认冲销?将生成一条等额红字反向记录纠错,原始记录保留:${row ? row.note : ''}` : 'Reverse this entry?')) return
      stateA.busy = true; mount()
      try {
        const url2 = revBtn.dataset.kind === 'sv'
          ? `/admin/stored-value/txns/${encodeURIComponent(revBtn.dataset.aaReverse)}/reverse`
          : `/admin/finance/transactions/${encodeURIComponent(revBtn.dataset.aaReverse)}/reverse`
        await request(url2, { method: 'POST' })
        toast(zh ? '已冲销(红字反向记录已生成)' : 'Reversed')
        stateA.busy = false
        const f2 = await request(`/admin/account-adjust/facts?userId=${encodeURIComponent(stateA.userId)}`).catch(() => null)
        if (f2) stateA.facts = f2.facts   // 判据⑤:四参考数联动=真值重拉
        loadTxns(stateA.month)
      } catch (e) { stateA.busy = false; mount(); toast(e.message) }
      return
    }
    if (event.target.closest('[data-aa-submit]')) {
      const amount = window.MoneyInput.centsOf(stateA.amount)
      const reason = String(document.querySelector('#aaReason')?.value || '').trim()
      const payChannel = String(document.querySelector('#aaChannel')?.value || 'cash')
      if (!reason) { toast(zh ? '退款原因必填' : 'Reason required'); return }
      stateA.busy = true; mount()
      try {
        // 幂等单号:同一次点击只认一次(连点两下不会退两笔)
        stateA.requestId = stateA.requestId || `rf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
        const r = await request('/admin/stored-value/refund', { method: 'POST', body: JSON.stringify({ userId: stateA.userId, amountCents: amount, payChannel, reason, requestId: stateA.requestId }) })
        toast(zh ? `已退款 ${ctx.money(r.refundedCents)},余额 ${ctx.money(r.balanceAfterCents)}` : 'Refunded')
        close(); ctx.onDone({ refunded: true })
      } catch (e) { stateA.busy = false; mount(); toast(e.message) }
      return
    }
    if (event.target.closest('[data-aa-card-submit]')) {
      const times = Math.round(Number(stateA.times || 0))
      const amount = window.MoneyInput.centsOf(stateA.cardAmount)
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
  /* 🔴 v1.2 ③(店主 2026-08-27 走查撞到):**敲的过程中不许重画整屏。**
     原来每敲一个字符就 mount() 一次 —— 框被重建,打了 1 就丢了后面的 5 和 0。
     现在只**就地改那几行文字**(退款金额/退款后余额/剩余次数/黄条),输入框本身一个字节不动。 */
  function patchCalc() {
    const o = el()
    if (!o || !stateA.facts) return
    const money = ctx.money
    const zh = ctx.zh
    if (stateA.cardId) {
      const c = stateA.cards.find((x) => x.id === stateA.cardId)
      const times = Math.round(Number(stateA.times || 0))
      const left = c ? Math.max(0, c.remaining - (Number.isFinite(times) ? times : 0)) : 0
      const tot = o.querySelector('.aa-calc .tot span:last-child')
      if (tot) tot.textContent = `${left} ${zh ? '次' : ''}${left === 0 ? (zh ? '(卡作废)' : ' (void)') : ''}`
      return
    }
    const cents = window.MoneyInput.centsOf(stateA.amount)
    const rows = o.querySelectorAll('.aa-calc div')
    if (rows[0]) rows[0].querySelector('span:last-child').textContent = `−${money(cents)}`
    if (rows[2]) rows[2].querySelector('span:last-child').textContent = money(Math.max(0, stateA.facts.balanceCents - cents))
  }

  function patchWarning() {
    const o = el()
    if (!o) return
    let bar = o.querySelector('.aa-warn')
    if (!stateA.warning) { if (bar) bar.remove(); return }
    if (!bar) {
      bar = document.createElement('div')
      bar.className = 'aa-warn'
      const calc = o.querySelector('.aa-calc')
      if (calc) calc.parentNode.insertBefore(bar, calc)
    }
    bar.textContent = stateA.warning
  }

  document.addEventListener('input', (e) => {
    if (!el()) return
    if (e.target.id === 'aaAmount') {
      stateA.amount = e.target.value                    // 存值,**不重画**
      patchCalc()
      const cents = window.MoneyInput.centsOf(stateA.amount)
      ctx.request(`/admin/account-adjust/facts?userId=${encodeURIComponent(stateA.userId)}&amountCents=${cents}`)
        .then((r) => { if (el()) { stateA.warning = r.bonusWarning || ''; stateA.facts = r.facts || stateA.facts; patchWarning() } })
        .catch(() => {})
    } else if (e.target.id === 'aaTimes') {
      stateA.times = e.target.value
      patchCalc()
    } else if (e.target.id === 'aaCardAmount') {
      stateA.cardAmount = e.target.value
    } else if (e.target.id === 'aaRvAmount') {
      stateA.rvAmount = e.target.value; stateA.rvPkgId = ''
    } else if (e.target.id === 'aaRvBonus') {
      stateA.rvBonus = e.target.value; stateA.rvPkgId = ''
    }
  })

  /* 客户档案那个「账户调整」按钮的点击处理 —— 连同"充值/赠送/冲销去哪儿"的跳转,
     整块住在这里,admin.js 那边只剩一行调用(它早已超行数红线,只许搬出)。
     ⚠️ 08-27 教训:上一版做输入框改造时,这个函数**连同那段一起被替换掉了**,
     而 return 里还引着它 —— 模块整个初始化失败,`window.AccountAdjust` 是 undefined,
     点按钮毫无反应;而代码行断言照样绿。**真点一下才看得见。** */
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
      bookings: deps.owner.bookings || [], technicians: deps.owner.technicians || [],
      /* 入口总收敛(08-30c):goto 指路分支已死 —— 充值/赠送/冲销都内嵌本弹层 */
      onDone: () => {
        deps.request('/admin/customers').then((d) => { deps.owner.customers = d.customers; deps.renderCustomers() }).catch(() => {})
      }
    })
    return true
  }

  return { open, close, handleClick }
})()
