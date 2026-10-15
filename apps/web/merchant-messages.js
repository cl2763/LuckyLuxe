// Uses the existing merchant request/authentication and theme; data is shared with mini-program.
(function(){
 const entry=document.getElementById('merchantMessagesEntry')
 const panel=document.getElementById('merchantMessagesPanel')
 let generation=0,items=[]
 const session=()=>String(owner.auth?.accessToken||owner.token||'')+'|'+String(owner.auth?.admin?.tenantId||'')
 async function badge(){const identity=session();if(!owner.auth?.accessToken&&!owner.token){entry.textContent='消息';if(panel.open)panel.close();return}try{const r=await request('/admin/messages');if(identity===session())entry.textContent='消息'+(r.unreadCount?' · '+r.unreadCount:'')}catch(e){/* The inbox itself offers retry. */}}
 window.addEventListener('focus',badge);setInterval(()=>{if(!document.hidden)badge()},60000)
 const esc=s=>escapeHtml(String(s??''))
 async function load(){
  const g=++generation,identity=session()
  panel.innerHTML='<button type="button" data-close>关闭</button><h2>消息</h2><p role="status">正在加载消息…</p>'
  try{
   const r=await request('/admin/messages')
   if(g!==generation||identity!==session()||!panel.open)return
   items=r.messages;entry.textContent='消息'+(r.unreadCount?' · '+r.unreadCount:'')
   panel.innerHTML='<button type="button" data-close>关闭</button><h2>消息 · 未读 '+r.unreadCount+'</h2>'+items.map(m=>'<button type="button" class="merchant-message-item" data-message="'+esc(m.id)+'"><strong>'+esc(m.readAt?'已读':'未读')+' · '+esc(m.title)+'</strong><small>'+esc(m.timeText)+'</small><span>'+esc(m.text)+'</span></button>').join('')+(items.length?'':'<p>暂无消息</p>')+'<p>'+esc(r.scopeText)+'</p>'
  }catch(e){if(g===generation&&panel.open)panel.innerHTML='<button type="button" data-close>关闭</button><h2>消息</h2><p>'+esc(e.message||'消息加载失败')+'</p><button type="button" data-retry>重试</button>'}
 }
 entry.addEventListener('click',()=>{panel.showModal();load()})
 panel.addEventListener('close',()=>{generation++;items=[];panel.innerHTML='';badge()})
 panel.addEventListener('click',async e=>{
  if(e.target.closest('[data-close]')){panel.close();return}
  if(e.target.closest('[data-retry]')){load();return}
  const bookingButton=e.target.closest('[data-booking]');if(bookingButton){const id=bookingButton.dataset.booking;if(!(owner.bookings||[]).some(b=>b.id===id)){bookingButton.textContent='预约已不可用，请在订单中核对';return}panel.close();jumpToBooking(id);return}
  const button=e.target.closest('[data-message]');if(!button||button.disabled)return
  const item=items.find(m=>m.id===button.dataset.message);if(!item)return
  button.disabled=true;const g=generation,identity=session()
  try{
   await request('/admin/messages/'+encodeURIComponent(item.id)+'/read',{method:'POST',body:JSON.stringify({})})
   if(g!==generation||identity!==session()||!panel.open)return
   panel.innerHTML='<button type="button" data-close>关闭</button><h2>'+esc(item.title)+'</h2><p>'+esc(item.timeText)+'</p><p>'+esc(item.text)+'</p><button type="button" data-retry>返回消息列表</button>'
  }catch(err){if(g===generation&&panel.open){button.disabled=false;const p=document.createElement('p');p.textContent=err.message||'读取消息失败，请重试。';panel.appendChild(p)}}
 })
})()
