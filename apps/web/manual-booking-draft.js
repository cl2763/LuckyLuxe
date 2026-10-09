/* Owner and technician share one manual draft creator. No AI call or payment. */
(function(){
 let deps, draft, dialog
 const text=(zh,en)=>deps.lang==='en'?en:zh
 async function open(){
  if(dialog?.open)return
  dialog=document.createElement('dialog');dialog.className='manual-draft-dialog card'
  dialog.innerHTML=`<div class="section-row"><h2>${text('人工预约草稿','Manual booking draft')}</h2><button type="button" class="ghost" data-close>${text('关闭','Close')}</button></div><p>${text('草稿有效 30 分钟，不锁定档期。由顾客确认后才生成预约，收款在门店线下完成。','Valid for 30 minutes. Availability is checked on confirmation. Payments are collected offline at the store.')}</p><div data-body>${text('正在加载门店服务…','Loading store services…')}</div>`
  const opened=dialog;opened.onclose=()=>{opened.remove();if(dialog===opened)dialog=null};document.body.append(opened);opened.querySelector('[data-close]').onclick=()=>opened.close();opened.showModal()
  try{const o=await deps.request('/admin/booking-draft-options'),h=deps.escapeHtml
   const option=(a)=>a.map(x=>`<option value="${h(x.id)}">${h(x.name||x.nameZh||x.id)}</option>`).join('')
   dialog.querySelector('[data-body]').innerHTML=`<form class="manual-draft-grid"><label>${text('门店','Store')}<select name="storeId" required>${option(o.stores)}</select></label><label>${text('服务','Service')}<select name="serviceId" required>${option(o.services)}</select></label><label>${text('技师','Technician')}<select name="technicianId" required></select></label><label>${text('日期','Date')}<input name="date" type="date" value="${h(deps.storeToday())}" required></label><label>${text('时间','Time')}<input name="time" type="time" required></label><label class="quote-notes-field">${text('顾客需求（选填）','Notes (optional)')}<textarea name="notes" maxlength="1000" rows="3"></textarea></label><button class="primary" type="submit">${text('生成预约草稿','Create draft')}</button></form><p role="status" data-status></p><div data-result></div>`
   const form=dialog.querySelector('form'),status=dialog.querySelector('[data-status]'),result=dialog.querySelector('[data-result]')
   const filter=()=>{form.elements.technicianId.innerHTML=option(o.technicians.filter(t=>t.store_id===form.elements.storeId.value&&t.serviceIds.includes(form.elements.serviceId.value)));draft=null;result.innerHTML=''}
   form.elements.storeId.onchange=filter;form.elements.serviceId.onchange=filter;filter()
   form.onsubmit=async e=>{e.preventDefault();const b=form.querySelector('[type=submit]');b.disabled=true;status.textContent=text('正在生成…','Creating…');result.innerHTML='';draft=null
    try{const body=Object.fromEntries(new FormData(form));form.querySelectorAll('input,select,textarea').forEach(el=>el.disabled=true);body.sourceChannel='admin_manual';const out=await deps.request('/admin/booking-drafts',{method:'POST',body:JSON.stringify(body)});draft=out.bookingDraft;status.textContent=text('草稿已生成，等待顾客确认。','Draft created; awaiting customer confirmation.');result.innerHTML=`<p>${h(draft.date)} ${h(draft.time)} · ${h(draft.service.name)}</p><button type="button" class="primary" data-copy>${text('复制网页确认链接','Copy web confirmation link')}</button><button type="button" class="ghost" data-code>${text('显示小程序确认码','Show mini-program code')}</button><div data-qr></div>`
     result.querySelector('[data-copy]').onclick=async()=>{try{await navigator.clipboard.writeText(draft.linkUrl);status.textContent=text('网页确认链接已复制。','Web confirmation link copied.')}catch{status.textContent=draft.linkUrl}}
     result.querySelector('[data-code]').onclick=()=>{const image=new Image();image.className='manual-draft-code';const q=result.querySelector('[data-qr]');q.textContent=text('正在加载小程序码…','Loading mini-program code…');image.onload=()=>q.replaceChildren(image);image.onerror=()=>q.textContent=text('小程序码加载失败，请重试或复制网页确认链接。','Code unavailable. Retry or copy the web link.');image.src=`${deps.apiBase}/mini-code/${draft.scene}`}
    }catch(e){status.textContent=e.message||text('生成失败，请重试。','Failed. Please retry.')}finally{b.disabled=false;form.querySelectorAll('input,select,textarea').forEach(el=>el.disabled=false)}
   }
  }catch(e){if(dialog)dialog.querySelector('[data-body]').textContent=e.message||text('加载失败，关闭后重试。','Could not load. Close and retry.')}
 }
 window.ManualBookingDraft={setup(d){deps=d;const b=document.getElementById('manualDraftOrderEntry');if(b){const bar=document.getElementById('manualDraftToolbar');bar.classList.toggle('hidden',d.view!=='today');b.querySelector('[data-draft-label]').textContent=text('预约草稿','Booking draft');bar.querySelector('[data-draft-hint]').textContent=text('分享给顾客确认','Share for customer confirmation');b.onclick=open}}}
})()
