/* Approved package gift rows. Call mount() inside the existing package form. */
window.GiftEditor = (() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
  function mount(container, initial = [], currency = '') {
    const section = document.createElement('section')
    section.className = 'gift-editor'
    section.innerHTML = `<style>.gift-editor{margin:18px 0;min-width:0}.gift-editor-row{display:grid;grid-template-columns:minmax(80px,1fr) 62px 100px 30px;gap:8px;align-items:center;margin:10px 0}.gift-editor-row input{min-width:0;width:100%;padding:10px 8px}.gift-editor-row button{padding:6px;width:30px}.gift-editor .gift-head{font-size:12px;color:var(--muted)}.gift-editor h3{margin:0}.gift-editor .subtle{line-height:1.6}@media(max-width:480px){.gift-editor-row{grid-template-columns:minmax(72px,1fr) 48px 76px 26px;gap:5px}}</style><h3>赠送物品 <small class="subtle">选填，可多件</small></h3><div class="gift-editor-row gift-head"><span>物品名称</span><span>数量</span><span>单件价值 ${esc(currency)}</span><span></span></div><div data-gift-rows></div><button type="button" class="ghost slim" data-gift-add>＋ 再加一行</button><p class="subtle">价值用于展示，不计入顾客储值余额、营业收入或技师业绩。物品领取请联系门店，此清单不代表已领取。</p>`
    const rows = section.querySelector('[data-gift-rows]')
    function add(g = {}) {
      if (rows.children.length >= 20) return
      const row = document.createElement('div'); row.className = 'gift-editor-row'
      row.innerHTML = `<input data-gift-name aria-label="赠品名称" maxlength="80" placeholder="物品名称" value="${esc(g.name || '')}"><input data-gift-quantity aria-label="赠品数量" type="number" min="1" max="999" step="1" value="${esc(g.quantity ?? 1)}"><input data-gift-value data-money data-money-strict aria-label="赠品单件价值" type="text" inputmode="decimal" autocomplete="off" placeholder="价值" value="${g.unitValueCents === undefined ? '' : esc(g.unitValueCents / 100)}"><button class="ghost" type="button" data-gift-remove aria-label="删除赠品">×</button>`
      rows.appendChild(row); section.querySelector('[data-gift-add]').disabled = rows.children.length >= 20
    }
    initial.forEach(add)
    section.addEventListener('click', (e) => {
      if (e.target.closest('[data-gift-add]')) { add(); rows.lastElementChild?.querySelector('input').focus() }
      if (e.target.closest('[data-gift-remove]')) { e.target.closest('.gift-editor-row').remove(); section.querySelector('[data-gift-add]').disabled = false }
    })
    container.appendChild(section)
    return { read() { return [...rows.children].map((row, i) => {
      const name = row.querySelector('[data-gift-name]').value.trim(), q = row.querySelector('[data-gift-quantity]').value.trim(), v = row.querySelector('[data-gift-value]').value.trim()
      if (!name || name.length > 80) throw new Error(`第 ${i + 1} 行请填写 1–80 字物品名称`)
      if (!/^\d+$/.test(q) || +q < 1 || +q > 999) throw new Error(`第 ${i + 1} 行数量须为 1–999 的整数`)
      if (!/^\d+(\.\d{1,2})?$/.test(v) || +v > 1000000) throw new Error(`第 ${i + 1} 行请填写非负单件价值（最多两位小数）`)
      return { name, quantity: Number(q), unitValueCents: Math.round(Number(v) * 100) }
    }) }, element: section }
  }
  return { mount }
})()
