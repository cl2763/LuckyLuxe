/* 网页商家后台 · 「记一笔」表单(2026-08-29 从 admin.js 搬出,付款方式收窄同批)。

   店主 08-29 收窄:**付款方式的唯一作用 = 判断动不动抽屉。**
   下拉选项与那句分工话都由后端 entryConfig 唯一出口下发(与小程序同一份)——
   这里零写死、零回落:接口没给就没有选项,不许前端编一份默认的。
   「储值卡」已退役:顾客用储值卡消费走结算单签署,储值动账在会员界面,不在记一笔里记。 */
window.FinanceEntryForm = (function () {
  function render(mount, fin, { zh, expenseOptions, escapeHtml, storeToday }) {
    if (!mount) return
    const cfg = fin.data?.entryConfig || {}
    const channelOptions = (cfg.channels || []).map((c) => `<option value="${c.id}">${c.label}</option>`).join('')
    mount.innerHTML = `
    <div class="finance-quick-grid">
      <label><span>${zh ? '类型' : 'Type'}</span>
        <select id="finType">
          <option value="expense">${zh ? '支出' : 'Expense'}</option>
          <option value="income">${zh ? '收入' : 'Income'}</option>
        </select>
      </label>
      <label><span>${zh ? '类别' : 'Category'}</span><select id="finCategory">${expenseOptions}</select></label>
      <label><span>${zh ? '金额 (CAD)' : 'Amount (CAD)'}</span><input id="finAmount" data-money type="text" inputmode="decimal" autocomplete="off" placeholder="0.00"></label>
      <label><span>${zh ? '付款方式' : 'Channel'}</span><select id="finChannel">${channelOptions}</select></label>
      <label><span>${zh ? '日期' : 'Date'}</span><input id="finDate" type="date" value="${storeToday()}"></label>
      <label><span>${zh ? '标签(可选)' : 'Tags'}</span><input id="finTags" placeholder="${zh ? '如:6月采购' : 'optional'}"></label>
    </div>
    ${cfg.note ? `<p class="subtle finance-entry-note">${escapeHtml(cfg.note)}</p>` : ''}
    <label class="finance-note-field"><span>${zh ? '备注' : 'Note'}</span><input id="finNote" placeholder="${zh ? '例如:超市买棉片和酒精' : ''}"></label>
    <button class="primary slim" data-fin-submit type="button">${zh ? '记账' : 'Record'}</button>
    <p class="subtle">${zh ? '服务收入由订单完成自动入账,不需要手记。账本只追加:记错了用流水里的"冲销"纠正。' : 'Service income auto-posts on booking completion. The ledger is append-only; correct mistakes via reversal.'}</p>
  `
  }

  async function submit({ request, toast, zh }) {
    const type = document.querySelector('#finType')?.value || 'expense'
    const amount = Number(document.querySelector('#finAmount')?.value || 0)
    if (!amount || amount <= 0) {
      toast(zh ? '请填写正确的金额' : 'Enter a valid amount')
      return
    }
    await request('/admin/finance/transactions', {
      method: 'POST',
      body: JSON.stringify({
        type,
        category: document.querySelector('#finCategory')?.value || '其他支出',
        amount,
        /* 不带 || 'unknown' 兜底:没选出来就交空串让后端 400 —— 后端是最终闸,前端别替它圆 */
        payChannel: document.querySelector('#finChannel')?.value || '',
        occurredOn: document.querySelector('#finDate')?.value || '',
        tags: document.querySelector('#finTags')?.value.trim() || '',
        note: document.querySelector('#finNote')?.value.trim() || ''
      })
    })
    toast(zh ? '已入账（账本只追加，不可修改）' : 'Recorded (append-only).')
  }

  return { render, submit }
})()
