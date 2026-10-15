// Customer inbox uses the existing authenticated request and page state.
let messagesRenderId=0
async function renderMessagesWeb() {
  const id=++messagesRenderId,en=state.lang==='en'
  const head=`<section class="section"><button type="button" data-me-target="me">${en?'Back':'返回我的'}</button><h2>${en?'Messages':'我的消息'}</h2>`
  els.screen.innerHTML=head+`<div class="card" role="status">${en?'Loading…':'正在加载消息…'}</div></section>`
  try {
    const result=await request('/my/messages')
    if(id!==messagesRenderId||state.view!=='messages')return
    els.screen.innerHTML=head+`<p>${en?'Unread':'未读'} ${Number(result.unreadCount)||0}</p>`+(result.messages?.length?result.messages.map(m=>`<article class="card"><button type="button" data-customer-message="${escapeHtml(m.id)}">${m.readAt?(en?'Read':'已读'):(en?'Read message · Unread':'查看消息 · 未读')}</button><p>${escapeHtml(m.text)}</p><small>${escapeHtml(m.timeText || '')}</small></article>`).join(''):`<div class="card">${en?'No messages':'暂无消息'}</div>`)+`<p>${en?'Latest 100 in-app notifications. These are separate from WeChat service notifications.':'显示最近100条站内通知；站内记录不代表微信推送已送达。'}</p></section>`
    els.screen.querySelectorAll('[data-customer-message]').forEach(button=>button.addEventListener('click',async()=>{
      const item=result.messages.find(m=>m.id===button.dataset.customerMessage)
      if(!item||button.disabled)return
      button.disabled=true
      try{
        await request('/my/messages/'+encodeURIComponent(item.id)+'/read',{method:'POST',body:JSON.stringify({})})
        if(id!==messagesRenderId||state.view!=='messages')return
        els.screen.innerHTML=head+`<article class="card"><p>${escapeHtml(item.text)}</p><small>${escapeHtml(item.timeText||'')}</small></article><button type="button" data-me-target="messages">${en?'Back to messages':'返回消息列表'}</button></section>`
      }catch(e){if(id===messagesRenderId&&state.view==='messages'){button.disabled=false;button.textContent=en?'Failed. Retry':'读取失败，请重试'}}
    }))
  } catch(e) {
    if(id!==messagesRenderId||state.view!=='messages')return
    els.screen.innerHTML=head+`<div class="card">${escapeHtml(e.message|| (en?'Could not load messages':'消息加载失败'))}</div><button type="button" data-me-target="messages">${en?'Retry':'重试'}</button></section>`
  }
}
