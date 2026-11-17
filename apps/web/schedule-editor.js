/* Approved 2026-09-26: a shift is a saved time range; changing the split never rewrites it. */
window.ScheduleEditor = (() => {
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
  const time = v => /^([01]\d|2[0-3]):[0-5]\d$/.test(v || '')
  async function open({ request, lang, day, technician, state, onSaved }) {
    if (document.querySelector('.shift-editor-mask')) return
    const zh = lang !== 'en', t = (a,b) => zh ? a : b
    const settings = await request('/admin/schedule-settings')
    const latestMode=day.bookingAcceptance?.mode==='latest_start',shiftEnd=latestMode?(day.bookingAcceptance.latestStartTime||day.closeTime):day.closeTime
    let split = settings.afternoonStart, busy = false,reviewed=null
    let kind = !state.working ? 'off' : state.start === day.openTime && state.end === shiftEnd ? 'full' : state.start === day.openTime && state.end === split ? 'am' : state.start === split && state.end === shiftEnd ? 'pm' : 'custom'
    const before = document.activeElement, mask = document.createElement('div')
    mask.className = 'shift-editor-mask'
    mask.innerHTML = `<section class="shift-editor" role="dialog" aria-modal="true" aria-labelledby="shiftEditorTitle"><div class="shift-editor-head"><h3 id="shiftEditorTitle">${esc(technician.name)} · ${esc(day.date)}</h3><button type="button" data-close aria-label="${t('关闭','Close')}">×</button></div><label class="shift-split">${t('上下午分界','Afternoon starts')}<input type="time" data-split value="${esc(split)}"><button type="button" data-save-split>${t('保存分界','Save split')}</button></label><p class="shift-note">${t('修改分界仅影响之后选择，不改写已保存排班。','Changing the split applies to future selections, not saved shifts.')}</p><p class="shift-note">${latestMode?t('本店按最晚开始时间接客。班次结束是停止接客时间，服务可以延长至次日。','Shift end is the last start time; services may finish the next day.'):t('本店要求服务在营业及班次结束前完成。','Services must finish before closing and shift end.')}</p><div class="shift-note" data-current-rules><strong>当天规则</strong><p>门店营业：${day.isClosed?'休息':esc(day.openTime)+'–'+esc(day.closeTime)}${latestMode?' · 最晚开始：'+esc(shiftEnd):''}</p><p>技师原班次：${state.working?esc(state.start)+'–'+esc(state.end):'休息'}。已保存班次不会随营业时间延长自动延长。</p><button type="button" data-fill-hours ${day.isClosed?'disabled':''}>按当天营业${latestMode?'／接客':''}时间填入</button><p>填入后仍需保存，不会同时改动其他日期。</p></div><div class="shift-kinds">${[['full','全天','Full day'],['am','上午','Morning'],['pm','下午','Afternoon'],['off','休息','Off'],['custom','自定义','Custom']].map(([k,a,b]) => `<button type="button" data-kind="${k}">${t(a,b)}</button>`).join('')}</div><p data-range></p><div class="shift-times"><label>${t('开始','Start')}<input type="time" data-start value="${esc(state.start || day.openTime || '')}"></label><label>${t('结束','End')}<input type="time" data-end value="${esc(state.end || shiftEnd || '')}"></label></div><p class="shift-note">${day.isClosed ? t('当天店休。若确需排班，请选自定义；排班不会改变门店营业设置。','Store closed. Use custom hours if needed; store opening hours remain unchanged.') : t('上午、下午以当天营业时间及分界计算。','Half-day shifts use this date’s opening hours and the split.')} ${t('已有预约不会自动取消；保存后会列出冲突。','Existing bookings are not cancelled; conflicts are listed after saving.')}</p><div class="shift-note"><strong>顾客时段预览</strong><label>示例总时长（分钟）<input type="text" inputmode="numeric" data-duration value="120" min="1" max="2880"></label><button type="button" data-preview>核对接客范围与冲突</button><div data-preview-result></div></div><div data-feedback role="status" aria-live="polite" aria-atomic="true" tabindex="-1"></div><button class="primary full" type="button" data-save>${t('保存排班','Save shift')}</button></section>`
    document.body.append(mask)
    const box = mask.firstElementChild, feedback = mask.querySelector('[data-feedback]')
    function close() { if (busy) return; document.removeEventListener('keydown', key); mask.remove(); before?.focus() }
    function key(e) { if (e.key === 'Escape') e.preventDefault(); if(e.key === 'Tab') { const list=[...box.querySelectorAll('button,input')].filter(x=>!x.disabled&&x.getClientRects().length); if(e.shiftKey&&document.activeElement===list[0]) {e.preventDefault();list.at(-1)?.focus()} else if(!e.shiftKey&&document.activeElement===list.at(-1)) {e.preventDefault();list[0]?.focus()} } }
    function lock(value) { busy=value; box.querySelectorAll('button,input').forEach(x=>x.disabled=value); box.setAttribute('aria-busy', String(value)) }
    function report(state, html) {
      feedback.className = `shift-result ${state}`
      feedback.innerHTML = html
      feedback.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
    function render() {
      box.querySelectorAll('[data-kind]').forEach(b=>{b.classList.toggle('on',b.dataset.kind===kind);b.setAttribute('aria-pressed',String(b.dataset.kind===kind))})
      box.querySelector('.shift-times').hidden=kind!=='custom'
      const range=kind==='am'?[day.openTime,split]:kind==='pm'?[split,shiftEnd]:[day.openTime,shiftEnd]
      box.querySelector('[data-range]').textContent=kind==='off'?t('当天不接预约','Not available that day'):kind==='custom'?t('选择开始与结束时间','Choose start and end times'):range.every(time)?range.join('–'):t('当天没有营业时段，请选自定义或休息。','No opening hours. Choose custom or off.')
    }
    function draft(){return {technicianId:technician.id,date:day.date,durationMin:Number(box.querySelector('[data-duration]').value),...(kind==='custom'?{startTime:box.querySelector('[data-start]').value,endTime:box.querySelector('[data-end]').value,isWorking:true}:{shift:kind})}}
    async function preview(){const body=draft(),key=JSON.stringify(body);lock(true);try{const r=await request('/admin/schedule-preview',{method:'POST',body:JSON.stringify(body)});reviewed=key;box.querySelector('[data-preview-result]').innerHTML=`<p>${esc(r.note)}</p>${r.previews.map(p=>`<p>${esc(p.date)} · 班次 ${esc(p.startTime)}–${esc(p.endTime)} · ${p.earliestStart?'可开始 '+esc(p.earliestStart)+'–'+esc(p.latestStart):'没有完整可约时段'}</p>${p.warnings.map(x=>'<p>'+esc(x.message)+'</p>').join('')}${p.conflicts.length?'<ul>'+p.conflicts.map(c=>`<li>${esc(c.code)} · ${esc(c.startTime)}–${esc(c.endTime)} · ${esc(c.customerName)}</li>`).join('')+'</ul>':'<p>未发现时段外预约。</p>'}`).join('')}`;box.querySelector('[data-save]').textContent=t('确认保存排班','Confirm shift')}catch(e){reviewed=null;report('error',esc(e.message))}finally{lock(false)}}
    mask.addEventListener('click', async e=>{
      if(e.target.closest('[data-close]')) {close();return}
      if(busy)return
      if(e.target.closest('[data-fill-hours]')){if(day.isClosed)return;kind='full';reviewed=null;box.querySelector('[data-preview-result]').textContent='';render();return}
      const pick=e.target.closest('[data-kind]'); if(pick){kind=pick.dataset.kind;reviewed=null;box.querySelector('[data-preview-result]').textContent='';feedback.textContent='';render();return}
      if(e.target.closest('[data-save-split]')) {
        const value=box.querySelector('[data-split]').value, button=box.querySelector('[data-save-split]')
        if(!time(value)){report('error',t('请输入有效的分界时间。','Enter a valid split time.'));return}
        lock(true);button.textContent=t('保存中…','Saving…');report('pending',t('正在保存分界，请稍候…','Saving split, please wait…'))
        try {
          const out=await request('/admin/schedule-settings',{method:'PUT',body:JSON.stringify({afternoonStart:value})})
          if(out.afternoonStart!==value)throw Error(t('未收到正确的保存结果，请刷新核对。','Unexpected save result. Refresh to check.'))
          split=out.afternoonStart;reviewed=null;render();report('success',`<strong>${t('分界已保存','Split saved')} · ${esc(split)}</strong><p>${t('已有排班未改动；要排半天，请选择上午或下午，再保存排班。','Existing shifts are unchanged. Choose Morning or Afternoon and save the shift to apply half-day hours.')}</p>`)
        } catch(err){report('error',`<strong>${t('分界保存未完成','Split save did not complete')}</strong><p>${esc(err.message)}</p>`)} finally{lock(false);button.textContent=t('保存分界','Save split')}
        return
      }
      if(e.target.closest('[data-preview]')){await preview();return}
      if(e.target.closest('[data-save]')) {
        if(reviewed!==JSON.stringify(draft())){await preview();return}
        const body={date:day.date,shift:kind}, button=box.querySelector('[data-save]')
        if(kind==='custom'){body.startTime=box.querySelector('[data-start]').value;body.endTime=box.querySelector('[data-end]').value;body.isWorking=true;if(!time(body.startTime)||!time(body.endTime)||body.startTime>=body.endTime){report('error',t('结束时间必须晚于开始时间。','End must be later than start.'));return}}
        lock(true);button.textContent=t('正在保存…','Saving…');report('pending',t('正在保存排班，请稍候…','Saving shift, please wait…'))
        let saved=false
        try {
          const out=await request(`/admin/technicians/${encodeURIComponent(technician.id)}/schedule`,{method:'PATCH',body:JSON.stringify(body)})
          const actual=out.schedule
          if(!actual||actual.date!==day.date||actual.technician_id!==technician.id)throw Error(t('未收到完整保存结果，请刷新核对后再操作。','Incomplete save result. Refresh to check before retrying.'))
          saved=true
          const conflicts=out.conflicts||[], warnings=out.warnings||[]
          const range=actual.is_working?`${actual.start_time}–${actual.end_time}`:t('休息','Off')
          report(conflicts.length||warnings.length?'warning':'success',`<strong>${t('排班已保存','Shift saved')} · ${esc(technician.name)} · ${esc(day.date)} · ${esc(range)}</strong>${warnings.map(w=>`<p>${esc(w.message||w)}</p>`).join('')}${conflicts.length?`<p>${t(`有 ${conflicts.length} 单预约落在时段外，预约未自动取消，请另行处理：`,`${conflicts.length} bookings fall outside the shift; they have not been cancelled:`)}</p><ul>${conflicts.map(c=>`<li>${esc(c.date||day.date)} ${esc(c.startTime)}–${esc(c.endTime)} · ${esc(c.customerName)} · ${esc(c.serviceName)}</li>`).join('')}</ul>`:''}`)
          button.textContent=t('已保存 · 再次保存','Saved · Save again')
          try {await onSaved(out)} catch(err) {feedback.insertAdjacentHTML('beforeend',`<p>${t('排班已保存，但列表刷新失败。请关闭后刷新页面核对。','Shift saved, but the list could not refresh. Close and refresh the page to check.')}</p>`)}
        }catch(err){report('error',`<strong>${t('未能确认保存成功','Save could not be confirmed')}</strong><p>${esc(err.message)}</p><p>${t('当前选择已保留。如遇网络超时，请先刷新核对，避免重复操作。','Your selection is kept. After a timeout, refresh to check before retrying.')}</p>`)}finally{lock(false);if(!saved)button.textContent=t('重试保存排班','Retry saving shift')}
      }
    })
    document.addEventListener('keydown',key);render();box.querySelector('[data-close]').focus()
  }
  return { open }
})()
