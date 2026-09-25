/* Independent customer intake. A repeated network request uses the same key. */
window.CustomerCreate = (() => {
  const esc=v=>String(v||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
  function open({request,onSaved}) {
    if (document.querySelector('.customer-create-mask')) return
    const focus=document.activeElement, key=crypto.randomUUID(), mask=document.createElement('div')
    mask.className='customer-create-mask'
    mask.innerHTML=`<form class="customer-create-panel" role="dialog" aria-modal="true" aria-labelledby="customerCreateTitle">
      <h2 id="customerCreateTitle">新建顾客</h2><label>顾客姓名 <span>必填</span><input name="displayName" required maxlength="40" autocomplete="off"></label>
      <label>联系方式 <span>选填</span><input name="phone" type="tel" maxlength="32" placeholder="手机号／联系电话" autocomplete="off"></label>
      <p>没留电话也可建档。后续出示绑定码，由顾客在自己的微信中确认本人。</p>
      <div class="customer-create-candidates"></div><p class="customer-create-error" role="alert"></p>
      <div class="customer-create-actions"><button class="ghost" type="button" data-cancel>取消</button><button class="primary" type="submit">保存档案</button></div></form>`
    document.body.append(mask);const form=mask.querySelector('form'),error=mask.querySelector('[role=alert]'),candidates=mask.querySelector('.customer-create-candidates')
    let busy=false, duplicate=false
    const close=()=>{if(busy)return;mask.remove();focus?.focus()}
    mask.querySelector('[data-cancel]').onclick=close
    mask.onclick=e=>{if(e.target===mask)close()}
    mask.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();close()}if(e.key==='Tab'){const all=[...mask.querySelectorAll('input,button')].filter(x=>!x.disabled);if(e.shiftKey&&document.activeElement===all[0]){e.preventDefault();all.at(-1).focus()}else if(!e.shiftKey&&document.activeElement===all.at(-1)){e.preventDefault();all[0].focus()}}}
    form.oninput=()=>{duplicate=false;candidates.innerHTML='';error.textContent=''}
    form.onsubmit=async e=>{
      e.preventDefault();if(busy||!form.reportValidity())return
      const displayName=form.elements.displayName.value.trim(),phone=form.elements.phone.value.trim()
      if(!displayName){error.textContent='请填写顾客姓名。';return}
      busy=true;form.querySelector('[type=submit]').disabled=true;error.textContent=''
      try {
        const r=await request('/admin/customers',{method:'POST',body:JSON.stringify({displayName,phone,requestId:key,allowDuplicatePhone:duplicate})})
        busy=false;close();await onSaved(r.customer)
      }catch(err){
        error.textContent=err.message
        if(err.code==='PHONE_EXISTS'){
          candidates.innerHTML=`<p>核对姓名和号码后选择：</p>${(err.details?.candidates||[]).map(c=>`<button class="ghost full" type="button" data-existing="${esc(c.id)}">使用已有档案：${esc(c.displayName)} · ${esc(c.phoneMasked)}</button>`).join('')}<button class="ghost" type="button" data-duplicate>同号不同人，仍新建档案</button>`
          candidates.querySelectorAll('[data-existing]').forEach(b=>b.onclick=()=>{const c=err.details.candidates.find(x=>x.id===b.dataset.existing);close();onSaved(c)})
          candidates.querySelector('[data-duplicate]').onclick=()=>{duplicate=true;candidates.innerHTML='<p>已选择仍新建。请点击保存档案。</p>';error.textContent=''}
        }
      }finally{busy=false;form.querySelector('[type=submit]').disabled=false}
    }
    form.elements.displayName.focus()
  }
  return {open}
})()
