/* 09-24 批量营业时间：店主已确认新旧图。网页三处共用一个渲染/事件实现；
   后端 hoursGateText 提供中英文字。应用/撤销只改草稿，保存沿用租户和权限校验。 */
window.HoursSetup = (function () {
  const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
  const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const state = { days: null, saving: false }
  const editors = new WeakMap()
  const clone = (v) => JSON.parse(JSON.stringify(v))
  function fresh(rows) {
    const days = {}
    for (const w of DAY_ORDER) days[w] = { open: false, openTime: '', closeTime: '' }
    for (const h of rows || []) if (days[h.weekday]) days[h.weekday] = { open: !h.isClosed, openTime: h.isClosed ? '' : (h.openTime || ''), closeTime: h.isClosed ? '' : (h.closeTime || '') }
    return { acceptance:{mode:'finish_by_close',weekly:{},special:{}},days, saving: false, start: '', end: '', scope: 'all', undo: null, message: '', error: false }
  }
  function text(txt, lang) { return lang === 'en' && txt.en ? txt.en : txt }
  function valid(s) { return DAY_ORDER.some(w => s.days[w].open) && DAY_ORDER.every(w => { const d = s.days[w]; return !d.open || /^([01]\d|2[0-3]):[0-5]\d$/.test(d.openTime) && /^([01]\d|2[0-3]):[0-5]\d$/.test(d.closeTime) && d.openTime < d.closeTime }) }
  function payload(s) { return DAY_ORDER.map(w => { const d = s.days[w]; return d.open ? { weekday: w, openTime: d.openTime, closeTime: d.closeTime, isClosed: false } : { weekday: w, isClosed: true } }) }
  function daysHtml(s, txt, esc, saveLabel) {
    const dis = s.saving ? 'disabled' : ''
    return `${s.impact?`<div class="hsw-bulk" data-hours-impact><strong>这次修改会影响什么</strong><p>${esc(s.impact.note)}</p><p>已保存班次 ${s.impact.savedShiftCount} 个；结束较早 ${s.impact.earlierShifts.length} 个；已有预约落在新时段外 ${s.impact.bookings.length} 单。</p><details><summary>查看受影响班次</summary>${s.impact.earlierShifts.map(x=>`<p>${esc(x.date)} · ${esc(x.name)} · ${esc(x.startTime)}–${esc(x.endTime)}</p>`).join('')||'<p>无</p>'}</details><details><summary>查看预约</summary>${s.impact.bookings.map(x=>`<p>${esc(x.code)} · ${esc(x.date)} ${esc(x.startTime)}–${esc(x.endDate!==x.date?x.endDate+' ':'')}${esc(x.endTime)} · ${esc(x.name)}</p>`).join('')||'<p>无</p>'}</details></div>`:''}<div class="hsw-bulk"><label>预约接客规则 <select data-hsw-mode ${dis}><option value="finish_by_close" ${s.acceptance.mode==='finish_by_close'?'selected':''}>营业结束前完成服务</option><option value="latest_start" ${s.acceptance.mode==='latest_start'?'selected':''}>按最晚开始时间接客</option></select></label><p class="hsw-bulk-hint">${s.acceptance.mode==='latest_start'?'截止时刻可开始，班次结束表示停止接客；服务可跨日完成，仍须避开已有预约。':'根据项目和附加服务总时长倒推最晚开始，服务须在营业及班次结束前完成。'} 已保存的排班和预约不会自动改动。</p></div><div class="hsw-bulk">
      <div class="hsw-bulk-title">${esc(txt.batchTitle || '')}</div>
      <div class="hsw-bulk-times"><input type="time" data-hsw-batch="start" aria-label="${esc(txt.batchStart || '')}" value="${s.start}" ${dis}> – <input type="time" data-hsw-batch="end" aria-label="${esc(txt.batchEnd || '')}" value="${s.end}" ${dis}></div>
      <div class="hsw-bulk-actions"><select data-hsw-scope aria-label="${esc(txt.batchScope || '')}" ${dis}><option value="all" ${s.scope === 'all' ? 'selected' : ''}>${esc(txt.scopeAll || '')}</option><option value="open" ${s.scope === 'open' ? 'selected' : ''}>${esc(txt.scopeOpen || '')}</option></select><button type="button" data-hsw-apply ${dis}>${esc(s.scope === 'all' ? txt.applyAll || '' : txt.applyOpen || '')}</button></div>
      <p class="hsw-bulk-hint">${esc(s.scope === 'all' ? txt.hintAll || '' : txt.hintOpen || '')}<br>${esc(txt.hintDraft || '')}</p>
    </div><div class="hsw-feedback ${s.error ? 'is-error' : ''}" role="status"><span>${esc(s.message || txt.untouched || '')}</span>${s.undo ? `<button type="button" data-hsw-undo ${dis}>${esc(txt.undo || '')}</button>` : ''}</div>
    ${DAY_ORDER.map(w => {
      const d = s.days[w], name = (txt.dayNames || DAY_NAMES)[w]
      return `<div class="hsw-day"><button class="hsw-sw ${d.open ? 'on' : ''}" data-hsw-toggle="${w}" type="button" role="switch" aria-label="${esc(name)}" aria-checked="${d.open}" ${dis}></button><span class="hsw-dn">${esc(name)}</span>${d.open ? `<span class="hsw-times"><input type="time" data-hsw-open="${w}" aria-label="${esc(name + ' ' + (txt.batchStart || ''))}" value="${d.openTime}" ${dis}> – <input type="time" data-hsw-close="${w}" aria-label="${esc(name + ' ' + (txt.batchEnd || ''))}" value="${d.closeTime}" ${dis}></span>` : `<span class="hsw-ph">${esc(txt.closed || txt.timePlaceholder || '')}</span>`}</div>`
    }).join('')}
    ${s.acceptance.mode==='latest_start'?`<div class="hsw-bulk"><strong>每周最晚开始时间</strong>${DAY_ORDER.filter(w=>s.days[w].open).map(w=>`<label class="hsw-day">${esc((txt.dayNames||DAY_NAMES)[w])}<input type="time" data-hsw-latest="${w}" value="${esc(s.acceptance.weekly[w]||'')}" ${dis}><span>留空跟随营业结束 ${esc(s.days[w].closeTime)}</span></label>`).join('')}</div>`:''}
    <button class="hsw-save ${valid(s) ? 'go' : 'dis'}" data-hsw-save type="button" ${valid(s) && !s.saving ? '' : 'disabled'}>${esc(s.saving ? txt.saving || '' : s.reviewRequest?(s.impact?'确认保存营业时间':'核对修改影响'):saveLabel)}</button>
    ${DAY_ORDER.some(w => s.days[w].open) ? '' : `<div class="hsw-note">${esc(txt.saveDisabledNote || '')}</div>`}`
  }
  function bind(container, s, txt, draw, save, current = () => true) {
    container.addEventListener('input',()=>{s.impact=null;const b=container.querySelector('[data-hsw-save]');if(b&&s.reviewRequest)b.textContent='核对修改影响'},{once:true})
    container.querySelector('[data-hsw-mode]')?.addEventListener('change',e=>{if(!s.saving){s.acceptance.mode=e.target.value;s.impact=null;draw()}})
    container.querySelectorAll('[data-hsw-latest]').forEach(el=>el.addEventListener('input',()=>{if(!s.saving)s.acceptance.weekly[el.dataset.hswLatest]=el.value||null}))
    container.querySelectorAll('[data-hsw-batch]').forEach(el => el.addEventListener('input', () => { if (!s.saving) s[el.dataset.hswBatch] = el.value }))
    container.querySelector('[data-hsw-scope]')?.addEventListener('change', e => { if (s.saving) return; s.scope = e.target.value; draw() })
    container.querySelector('[data-hsw-apply]')?.addEventListener('click', () => {
      if (s.saving) return
      const targets = DAY_ORDER.filter(w => s.scope === 'all' || s.days[w].open)
      s.error = true
      if (!s.start || !s.end) s.message = txt.missing
      else if (s.start >= s.end) s.message = txt.order
      else if (!targets.length) s.message = txt.noTargets
      else { s.impact=null;s.undo = clone(s.days); targets.forEach(w => { s.days[w] = { open: true, openTime: s.start, closeTime: s.end } }); s.message = (txt.applied || '').replace('{count}', targets.length); s.error = false }
      draw()
    })
    container.querySelector('[data-hsw-undo]')?.addEventListener('click', () => { if (s.saving || !s.undo) return; s.impact=null;s.days = clone(s.undo); s.undo = null; s.message = txt.undone; s.error = false; draw() })
    container.querySelectorAll('[data-hsw-toggle]').forEach(el => el.addEventListener('click', () => { if (s.saving) return; s.impact=null;const d = s.days[Number(el.dataset.hswToggle)]; d.open = !d.open; draw() }))
    container.querySelectorAll('[data-hsw-open],[data-hsw-close]').forEach(el => el.addEventListener('input', () => {
      if (s.saving) return
      const w = Number(el.dataset.hswOpen ?? el.dataset.hswClose)
      s.days[w][el.dataset.hswOpen !== undefined ? 'openTime' : 'closeTime'] = el.value
      // Do not replace a focused native time input while its segments are being edited.
      const button = container.querySelector('[data-hsw-save]'); if (button) { button.disabled = !valid(s); button.className = 'hsw-save ' + (valid(s) ? 'go' : 'dis') }
    }))
    container.querySelector('[data-hsw-save]')?.addEventListener('click', async () => {
      if (s.saving || !valid(s)) return
      s.saving = true; s.error = false; s.message = txt.saving; draw()
      try { if(s.reviewRequest&&!s.impact){s.impact=await s.reviewRequest(payload(s),s.acceptance);s.configRevision=s.impact.configRevision;s.saving=false;s.message='请核对影响后确认保存；已有预约和班次会保留。';draw();return}await save(payload(s)); if (current()) s.undo = null }
      catch (e) { if (!current()) return; s.saving = false; s.error = true; s.message = e.message || txt.failed; draw() }
    })
  }
  function gate(owner, deps) {
    let el = document.querySelector('#hoursSetupWall')
    if (!owner.hoursUnset) { if (el) el.remove(); state.days = null; return false }
    const key = (owner.auth?.accessToken || owner.token || '') + '|' + (owner.storeName || '')
    if (!state.days || state.key !== key) Object.assign(state, fresh(), { key })
    if (!el) { el = document.createElement('div'); el.id = 'hoursSetupWall'; document.body.appendChild(el) }
    const txt = text(owner.hoursGateText || {}, owner.lang)
    const draw = () => {
      if (state.key !== key || !state.days) return
      if ((owner.role || 'owner') !== 'owner') { el.innerHTML = `<div class="hsw-box hsw-staff"><div class="hsw-title">${deps.escapeHtml(txt.staffTitle || '')}</div><div class="hsw-hint">${deps.escapeHtml(txt.staffHint || '')}</div></div>`; return }
      el.innerHTML = `<div class="hsw-box"><div class="hsw-title">${deps.escapeHtml(txt.ownerTitle || '')}</div><div class="hsw-hint">${deps.escapeHtml(txt.ownerHint || '')}</div>${daysHtml(state, txt, deps.escapeHtml, txt.saveButton || '')}</div>`
      bind(el, state, txt, draw, async hours => {
        await deps.request('/admin/business-hours', { method: 'PUT', body: JSON.stringify({ hours,bookingAcceptance:state.acceptance }) })
        if (state.key !== key) return
        state.saving = false
        await deps.reboot() // authoritative readback decides whether the gate is removed
      }, () => state.key === key)
    }
    draw(); return true
  }
  function mountSettings(container, opts) {
    let s = editors.get(container)
    if (!s || s.key !== opts.storeId || opts.reset) { s = Object.assign(fresh(opts.rows), { key: opts.storeId,configRevision:opts.configRevision,acceptance:clone(opts.bookingAcceptance||{mode:'finish_by_close',weekly:{},special:{}}) }); editors.set(container, s) }
    s.reviewRequest=opts.reviewHours?((hours,acceptance)=>opts.reviewHours(hours,acceptance,s.configRevision)):opts.saveHours?null:(hours,bookingAcceptance)=>opts.request('/admin/business-hours/review',{method:'POST',body:JSON.stringify({storeId:opts.storeId,expectedConfigRevision:s.configRevision,hours,bookingAcceptance})})
    const txt = text(opts.txt || {}, opts.lang)
    const draw = () => {
      if (editors.get(container) !== s) return
      container.innerHTML = `<div class="hsw-settings">${daysHtml(s, txt, opts.escapeHtml, opts.saveLabel || txt.settingsSave || '')}</div>`
      bind(container, s, txt, draw, async hours => {
        if (opts.saveHours) await opts.saveHours(hours,s.acceptance,s.configRevision)
        else await opts.request('/admin/business-hours', { method: 'PUT', body: JSON.stringify({ storeId: opts.storeId,expectedConfigRevision:s.configRevision, hours,bookingAcceptance:s.acceptance }) })
        if (editors.get(container) !== s) return
        await opts.afterSave()
        s.saving = false; s.undo = null
      }, () => editors.get(container) === s)
    }
    draw()
  }
  return { gate, mountSettings, _state: state }
})()
