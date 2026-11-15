/* 网页顾客端 · 资产页(卡包 / 储值流水)。
   2026-08-25 从 customer.js 搬出(公约①②:新功能一律新模块;动哪个领域就把哪个领域搬出来)。

   N-5 退卡口连带:图 §四 要求「顾客侧能看到这笔退款 —— 他的钱退了,他该知道,藏起来反而像出事」。
   而网页顾客端此前**没有储值流水页**(只有会员卡上一个余额数字),
   所以这里补一张轻页:余额 + 最近流水。类型文案一律用后端下发的 `typeText`,前端零词典。 */
window.CustomerWallet = (function () {
  function renderGifts(items, { zh, escapeHtml, money }) {
    if (!Array.isArray(items) || !items.length) return ''
    return `<div class="gift-list" style="margin:14px 0;padding:14px 0;border-top:1px solid var(--line);min-width:0"><strong>${zh ? '赠送物品' : 'Included gifts'}</strong>${items.map((g) => `<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:8px"><span style="overflow-wrap:anywhere">${escapeHtml(g.name)} × ${Number(g.quantity)}</span><span class="subtle">${zh ? '单件价值' : 'Unit value'} ${escapeHtml(money(g.unitValueCents, 2))}</span></div>`).join('')}<div class="subtle" style="margin-top:10px;line-height:1.6">${zh ? '物品领取请联系门店，此清单不代表已领取。' : 'Contact the store to collect. This list does not confirm collection.'}</div></div>`
  }
  function renderCardPack({ state, els, zh, escapeHtml, render, loadCardPack }) {
    const pack = state.cardPack
    if (!pack) {
      els.screen.innerHTML = `<section class="view-web"><div class="empty-state tall"><strong>${zh ? '加载中…' : 'Loading…'}</strong></div></section>`
      loadCardPack().then(() => { if (state.view === 'cardPack') render() })
      return
    }
    els.screen.innerHTML = `
      <section class="view-web">
        <button class="ghost back-btn" data-me-target="me" type="button">← ${zh ? '我的' : 'Me'}</button>
        <h1>${zh ? '卡包' : 'Card pack'}</h1><button class="ghost" data-me-target="mall" type="button">${zh?'充值套餐与次卡商城':'Recharge packages & passes'}</button>
        ${pack.migration?.hasPending ? `<div class="info-card-web card"><strong>${escapeHtml(pack.migration.title)}</strong><p class="subtle">${escapeHtml(pack.migration.message)}</p></div>` : ''}
        ${pack.emptyText ? `<div class="empty-state tall"><strong>${escapeHtml(pack.emptyText)}</strong>
          <button class="primary" data-me-target="mall" type="button">${zh ? '去看看充值套餐' : 'See packages'}</button></div>` : ''}
        ${pack.timecards.length ? `<div class="section-row compact"><h2>${zh ? '次卡' : 'Passes'}</h2><button class="section-note-btn" data-mall-focus="timecard" type="button">${zh ? '去商城 ›' : 'Shop ›'}</button></div>
          ${pack.timecards.map((c) => `
            <div class="info-card-web card">
              <p><span><strong>${escapeHtml(c.name)}</strong></span><strong>${zh ? '剩' : 'Left'} ${c.remaining}/${c.totalTimes}</strong></p>
              <p class="subtle">${c.expiresAt ? `${escapeHtml(c.expiresAt)} ${zh ? '到期' : 'expires'}` : (zh ? '长期有效' : 'No expiry')}</p>
              ${c.sourceLabel ? `<p class="subtle">${escapeHtml(c.sourceLabel)}</p>` : ''}
            </div>`).join('')}` : ''}
        ${pack.coupons.length ? `<div class="section-row compact"><h2>${zh ? '优惠券' : 'Coupons'}</h2></div>
          ${pack.coupons.map((q) => `
            <div class="info-card-web card">
              <p><span><strong>${escapeHtml(q.name)}</strong></span><strong class="price">${escapeHtml(q.faceText)}</strong></p>
              <p class="subtle">${escapeHtml(q.subtitle)}</p>
              ${q.sourceLabel ? `<p class="subtle">${escapeHtml(q.sourceLabel)}</p>` : ''}
            </div>`).join('')}` : ''}
        ${/* 裁定①(店主 08-23):卡包=券+次卡两类,储值不进卡包(会员卡已直达+自有页,重复即乱) */''}
      </section>`
  }

  /* 储值流水页(N-5 新增):退款、充值、耗卡、赠送都在这儿看得到。
     金额只显示后端给的分,格式化走顾客端那一份 money();类型文案走后端 typeText。 */
  function renderStoredValue({ state, els, zh, escapeHtml, money, render, loadWallet, request }) {
    const w = state.wallet
    if (!w) {
      els.screen.innerHTML = `<section class="view-web"><div class="empty-state tall"><strong>${zh ? '加载中…' : 'Loading…'}</strong></div></section>`
      loadWallet().then(() => { if (state.view === 'storedValue') render() })
      return
    }
    const rows = w.txns || []
    els.screen.innerHTML = `
      <section class="view-web">
        <button class="ghost back-btn" data-me-target="me" type="button">← ${zh ? '我的' : 'Me'}</button>
        <h1>${zh ? '储值' : 'Balance'}</h1><div id="walletPersonalBenefits"></div>
        <div class="info-card-web card">
          <p><span>${zh ? '当前余额' : 'Current balance'}</span><strong class="price">${money(w.balanceCents)}</strong></p>
        </div>
        <div class="section-row compact"><h2>${zh ? '流水' : 'Activity'}</h2></div>
        ${rows.length ? rows.map((t) => `
          <div class="info-card-web card">
            ${/* 负数:负号在最前、币符跟在后面(不能让负号跑到币符后头);币符本身由 money() 按门店币种给 */''}
            <p><span><strong>${escapeHtml(t.typeText || t.type)}</strong></span><strong class="price">${t.amountCents < 0 ? '−' : '+'}${money(Math.abs(t.amountCents))}</strong></p>
            <p class="subtle">${escapeHtml(t.discountReceipt?.createdText||String(t.createdAt || '').slice(0, 16).replace('T', ' '))}${t.note ? ` · ${escapeHtml(t.note)}` : ''}</p>
            ${t.discountReceipt?.kind==='recharge'?`<h3>${zh?'充值回执':'Recharge receipt'} · ${escapeHtml(t.discountReceipt.receiptId)}</h3><p><strong>${zh?'充值已到账':'Recharge credited'}</strong></p><p><span>${zh?'本金 / 赠金':'Principal / bonus'}</span><strong>${t.discountReceipt.principalCents==null?(zh?'未记录':'Not recorded'):money(t.discountReceipt.principalCents,2)} / ${t.discountReceipt.bonusCents==null?(zh?'未记录':'Not recorded'):money(t.discountReceipt.bonusCents,2)}</strong></p>`:''}
            ${t.discountReceipt?`<p>${zh?'个人折扣':'Personal discount'}：${escapeHtml(t.discountReceipt.beforeText)} → ${escapeHtml(t.discountReceipt.afterText)}</p><p class="subtle">${escapeHtml(t.discountReceipt.actor)} · ${escapeHtml(t.discountReceipt.statusText)}</p>`:''}
            ${renderGifts(t.giftItems, { zh, escapeHtml, money })}
            ${t.discountReceipt?.kind==='recharge'||t.type==='recharge'&&t.needsConfirm?`<p class="subtle">${zh?'本笔已到账。请核对充值及权益信息；是否核对不影响余额使用。':'This recharge is credited. Acknowledgement does not affect the available balance.'}</p><div class="inline-actions">${t.needsConfirm?`<button type="button" class="primary slim" data-confirm-recharge="${escapeHtml(t.id)}">${zh?'确认已核对':'Acknowledge receipt'}</button>`:`<span>${zh?'已核对':'Acknowledged'}</span>`}<button type="button" class="ghost slim" data-me-target="store">${zh?'联系门店':'Contact store'}</button></div><p role="status" data-recharge-status></p>`:''}
          </div>`).join('')
        : `<div class="empty-state tall"><strong>${zh ? '还没有储值记录' : 'No activity yet'}</strong></div>`}
      </section>`
    els.screen.querySelectorAll('[data-confirm-recharge]').forEach(button=>button.onclick=async()=>{button.disabled=true;const status=button.closest('.card').querySelector('[data-recharge-status]');try{await request('/my/stored-value/confirm',{method:'POST',body:JSON.stringify({id:button.dataset.confirmRecharge})});await loadWallet();if(state.view==='storedValue')render()}catch(error){status.textContent=error.message||'核对失败，请重试';button.disabled=false}})
    window.MemberPricingCustomer.benefits(document.getElementById('walletPersonalBenefits'),{request,escapeHtml,en:!zh})
  }

  return { renderCardPack, renderStoredValue, renderGifts }
})()
