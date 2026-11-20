/* The existing verified-WeChat claim endpoint owns identity changes. */
window.CustomerBinding=(()=>{
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
 function mount(el,customer,{request,zh=true}){
  if(!el||customer.archived||!customer.customerBindingEnabled)return
  let hit=null,ticket=null,busy=false,timer=null
  el.className='card customer-binding'
  el.innerHTML=`<h2>${zh?'小程序绑定':'Mini-program binding'}</h2><p data-bind-status role="status">${zh?'正在核对绑定状态…':'Checking binding…'}</p><p class="subtle">${zh?'请顾客用自己的微信扫码，核对门店与档案后确认本人。绑定沿用原档案，不改变余额或历史记录。':'Ask the customer to scan with their own WeChat and confirm their profile. Existing records are retained.'}</p><div class="inline-actions"><button class="primary slim" data-bind-create disabled>${zh?'出示绑定码':'Show binding code'}</button><button class="ghost slim" data-bind-refresh>${zh?'刷新绑定状态':'Refresh status'}</button></div><div data-bind-code hidden></div><p data-bind-error role="alert"></p>`
  const status=el.querySelector('[data-bind-status]'),create=el.querySelector('[data-bind-create]'),refresh=el.querySelector('[data-bind-refresh]'),code=el.querySelector('[data-bind-code]'),error=el.querySelector('[data-bind-error]')
  function schedule(){clearTimeout(timer);if(ticket&&el.isConnected)timer=setTimeout(()=>{if(el.isConnected)check()},4000)}
  async function check(){
   refresh.disabled=true
   try{const r=await request('/admin/customers/lookup?userId='+encodeURIComponent(customer.id));if(!el.isConnected)return;hit=r.hit;if(!hit)throw Error(r.reason||(zh?'无法读取此档案的绑定状态。':'Cannot read binding status.'));status.textContent=hit.bound?(zh?'已绑定微信':'WeChat linked'):(zh?'未绑定微信':'Not linked to WeChat');create.hidden=hit.bound;create.disabled=busy||hit.bound;error.textContent='';if(hit.bound){ticket=null;code.hidden=true;code.replaceChildren();clearTimeout(timer)}else if(ticket&&Date.parse(ticket.expiresAt)<=Date.now()){ticket=null;code.hidden=true;error.textContent=zh?'绑定码已过期，请重新出示。':'Code expired. Generate a new code.'}}
   catch(e){hit=null;create.disabled=true;error.textContent=e.message||'读取失败，请重试。'}finally{refresh.disabled=false;schedule()}
  }
  refresh.onclick=check
  create.onclick=async()=>{
   if(busy||!hit||hit.bound)return;busy=true;create.disabled=true;error.textContent='';clearTimeout(timer)
   try{const r=await request('/admin/customers/'+encodeURIComponent(customer.id)+'/bind-token',{method:'POST',body:'{}'});if(!el.isConnected)return;ticket=r;code.hidden=false;code.innerHTML=`<p>${zh?'请本人扫码确认绑定':'Scan to confirm your profile'}</p>${r.miniCodePath?`<img class="customer-bind-code" alt="${zh?'顾客档案绑定小程序码':'Profile binding code'}" src="${esc((location.pathname.startsWith('/experience/')?'/experience':'')+r.miniCodePath)}">`:`<p>${zh?'绑定码暂不可用，请联系平台检查小程序码配置。':'Binding code unavailable. Please contact support.'}</p>`}<p class="subtle">${zh?'等待顾客确认。重新出示会使上一张绑定码失效。':'Waiting for confirmation. Generating a new code invalidates the previous one.'}</p>`;const img=code.querySelector('img');if(img)img.onerror=()=>{img.hidden=true;error.textContent=zh?'小程序码加载失败，请重新出示或联系平台。':'Code failed to load. Retry or contact support.'};create.textContent=zh?'重新出示绑定码':'Generate a new code'}
   catch(e){error.textContent=e.message||'生成失败，请重试。';if(e.code==='ALREADY_BOUND')await check()}
   finally{busy=false;create.disabled=!hit||hit.bound;schedule()}
  }
  check()
 }
 return {mount}
})()
