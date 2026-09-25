window.FormModal=(()=>{
function open({ title, hint, fields, saveText, onSave, mountContent }, {escapeHtml,toast}) {
  let busy=false
  document.querySelector('.form-modal-overlay')?.remove()
  const overlay = document.createElement('div')
  overlay.className = 'store-switch-overlay form-modal-overlay'
  overlay.innerHTML = `
    <div class="store-switch-panel card form-modal-panel">
      <div class="section-row"><h2>${escapeHtml(title || '')}</h2><button class="ghost slim" data-fm-close type="button">✕</button></div>
      ${hint ? `<p class="subtle" style="margin:4px 0 10px">${hint}</p>` : ''}
      <div class="kb-facts-grid">
        ${fields.map((f) => `<span data-fm-wrap="${f.key}" style="display:contents">${f.type === 'checkbox'
          ? `<label class="fm-check"><input type="checkbox" data-fm-field="${f.key}" ${f.value ? 'checked' : ''}> ${escapeHtml(f.label)}</label>`
          : f.type === 'select'
            ? `<label><span>${escapeHtml(f.label)}</span><select data-fm-field="${f.key}">${(f.options || []).map(([v, l]) => `<option value="${escapeHtml(String(v))}" ${String(v) === String(f.value ?? '') ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select></label>`
            : `<label><span>${escapeHtml(f.label)}</span><input data-fm-field="${f.key}" type="${['number','date','time'].includes(f.type) ? f.type : 'text'}" ${f.type === 'number' ? 'step="0.01" min="0"' : ''} value="${escapeHtml(String(f.value ?? ''))}" placeholder="${escapeHtml(f.placeholder || '')}"></label>`}</span>`).join('')}
      </div>
      ${fields.some((f) => f.hint) ? fields.filter((f) => f.hint).map((f) => `<p class="subtle" style="margin:6px 0 0${f.danger ? ';color:var(--bad);font-weight:700' : ''}">· ${escapeHtml(f.label)}:${escapeHtml(f.hint)}</p>`).join('') : ''}
      <div class="action-row" style="margin-top:14px">
        <button class="primary slim" data-fm-save type="button">${escapeHtml(saveText || '保存')}</button>
        <button class="ghost slim" data-fm-cancel type="button">取消</button>
      </div>
    </div>`
  // showIf 动态显隐:值变化只切 display,不重建 DOM(输入不丢);D50-c② 两态切换靠它
  const readValues = () => {
    const values = {}
    for (const f of fields) {
      const el = overlay.querySelector(`[data-fm-field="${f.key}"]`)
      values[f.key] = f.type === 'checkbox' ? el.checked : el.value
    }
    return values
  }
  const applyVisibility = () => {
    const values = readValues()
    for (const f of fields) {
      if (!f.showIf) continue
      const wrap = overlay.querySelector(`[data-fm-wrap="${f.key}"]`)
      if (wrap) wrap.style.display = f.showIf(values) ? 'contents' : 'none'
    }
  }
  overlay.addEventListener('change', applyVisibility)
  overlay.addEventListener('input', applyVisibility)
  const close = () => { if(busy)return; overlay.remove(); document.removeEventListener('keydown', onKey) }
  const onKey = (e) => { if (e.key === 'Escape') close() }
  document.addEventListener('keydown', onKey)
  overlay.addEventListener('click', async (e) => {
    if (e.target === overlay || e.target.closest('[data-fm-close]') || e.target.closest('[data-fm-cancel]')) { close(); return }
    if (e.target.closest('[data-fm-save]')) {
      if(busy)return;busy=true;const btn=overlay.querySelector('[data-fm-save]');btn.disabled=true
      try { const result=await onSave(readValues());busy=false;if(result!==false)close() } catch (error) { toast(error.message) } finally{busy=false;btn.disabled=false}
    }
  })
  document.body.appendChild(overlay)
  if(mountContent)mountContent(overlay)
  applyVisibility()
  overlay.querySelector('input,select')?.focus()
}

return {open}
})()
