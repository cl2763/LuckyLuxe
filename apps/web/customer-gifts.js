window.CustomerGifts={async mount(host,userId,{request,escapeHtml:e,money,toast,isOwner=true}){
 if(!host)return
 const kinds=[['all','全部'],['coupon','优惠券'],['service_voucher','服务兑换券'],['service_timecard','服务次卡'],['physical','实物领取'],['history','使用记录']]
 let data={gifts:[]},filter='all',receipt=null
 const eventHtml=(g,ev)=>'<div class="gift-event"><strong>'+e(ev.label)+' '+e(ev.quantityText||'')+'</strong><p>'+e(ev.createdText)+(ev.actor?' · '+e(ev.actor):'')+'</p><p>'+e(ev.reason||'')+'</p>'+(isOwner&&ev.action==='claim'&&ev.returnable>0?'<button class="ghost slim" data-return="'+e(g.id)+'" data-event="'+e(ev.id)+'">更正这笔领取</button>':'')+'</div>'
 function render(){
  const visible=data.gifts.filter(g=>filter==='all'||filter==='history'?true:g.kind===filter)
  host.innerHTML='<section class="card customer-gifts-panel"><h2>赠送权益与领取</h2><p class="subtle">实物交给顾客后，由门店登记领取。服务权益在结算单签署后核销。</p><nav class="gift-filter-bar" aria-label="权益分类">'+kinds.map(([k,label])=>'<button class="'+(filter===k?'primary':'ghost')+' slim" data-gift-filter="'+k+'" aria-pressed="'+(filter===k)+'">'+label+'</button>').join('')+'</nav><div class="customer-gifts-layout"><div data-gift-list>'+(visible.length?visible.map(g=>'<article class="gift-list-record"><div class="section-row"><div><small>'+e(g.kindLabel)+'</small><h3>'+e(g.name)+'</h3><p>剩余 '+g.remaining+' / '+g.quantity+' · 已用或已领 '+g.claimed+(g.voided?' · 已作废 '+g.voided:'')+'</p><p class="subtle">'+e(g.expiresOn?'有效至 '+g.expiresOn:'长期有效')+(g.expired?' · 已过期':'')+'</p></div>'+(g.canClaim&&filter!=='history'?'<button class="primary slim" data-claim="'+e(g.id)+'">登记领取</button>':'')+'</div><details'+(filter==='history'?' open':'')+'><summary>查看使用及领取记录</summary>'+(g.events.length||g.records?.length?[...(g.records||[]),...g.events].map(ev=>eventHtml(g,ev)).join(''):'<p class="subtle">暂无使用或领取记录</p>')+'</details></article>').join(''):'<p class="empty-state">本分类暂无赠送权益</p>')+'</div><aside data-gift-action class="gift-claim-card"></aside></div></section>'
  const aside=host.querySelector('[data-gift-action]')
  if(receipt){const g=data.gifts.find(g=>g.id===receipt.grantId),ev=g?.events.find(ev=>ev.id===receipt.eventId);aside.innerHTML='<h3>'+(receipt.action==='claim'?'领取已登记':'退回已登记')+'</h3><p>'+e(receipt.name)+' · '+(receipt.action==='claim'?'已领 ':'已退回 ')+receipt.quantity+' 件</p><p>剩余待领取 '+receipt.remaining+' 件</p>'+(ev?'<p>操作员工 '+e(ev.actor)+'</p><p>时间 '+e(ev.createdText)+'</p>':'')+'<p class="subtle">原发放记录保留，可在使用记录中查看。登记错误由老板办理退回。</p><button class="ghost slim" data-receipt-close>返回赠送权益</button>';aside.querySelector('[data-receipt-close]').onclick=()=>{receipt=null;render()}}
  else aside.innerHTML='<h3>登记实物领取</h3><p class="subtle">请选择左侧需要交付的实物。参考价值留空不影响领取；登记不扣储值余额、不新增服务收款。</p>'
  host.querySelectorAll('[data-gift-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.giftFilter;render()})
  host.querySelectorAll('[data-claim],[data-return]').forEach(b=>b.onclick=()=>open(b))
 }
 function open(button){
  const action=button.dataset.claim?'claim':'return',g=data.gifts.find(g=>g.id===(button.dataset.claim||button.dataset.return)),claimId=button.dataset.event||null,requestId=crypto.randomUUID(),aside=host.querySelector('[data-gift-action]')
  let busy=false
  aside.innerHTML='<h3>'+(action==='claim'?'登记实物领取':'更正领取记录')+'</h3><div class="gift-claim-fact"><span>物品</span><strong>'+e(g.name)+'</strong></div><div class="gift-claim-fact"><span>当前可领取</span><strong>'+g.remaining+' 件</strong></div><label>本次数量 *<input data-claim-quantity aria-label="本次领取或退回数量" type="number" min="1" max="999" step="1" value="1"></label><label>'+(action==='return'?'更正原因（必填）':'领取备注 · 选填')+'<textarea data-claim-reason maxlength="300" placeholder="'+(action==='return'?'说明更正原因':'如：顾客到店领取')+'"></textarea></label>'+(action==='claim'?'<label class="gift-delivered"><input data-claim-delivered type="checkbox">已核对物品和数量，顾客已实际领取。</label>':'<p class="subtle">追加退回记录，保留原领取历史。</p>')+'<p data-claim-error role="alert"></p><div class="action-row"><button class="ghost slim" data-claim-cancel>取消</button><button class="primary slim" data-claim-save>'+(action==='claim'?'确认领取':'确认退回')+'</button></div>'
  aside.querySelector('[data-claim-cancel]').onclick=()=>{if(!busy)render()}
  aside.querySelector('[data-claim-save]').onclick=async()=>{
   if(busy)return
   const q=aside.querySelector('[data-claim-quantity]').value,reason=aside.querySelector('[data-claim-reason]').value.trim(),error=aside.querySelector('[data-claim-error]')
   if(action==='claim'&&!aside.querySelector('[data-claim-delivered]').checked){error.textContent='请先确认顾客已实际领取';return}
   if(!/^\d+$/.test(q)||+q<1||+q>999){error.textContent='请输入1至999的整数件数';return}
   if(action==='return'&&!reason){error.textContent='请填写更正原因';return}
   busy=true;error.textContent='';aside.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=true)
   try{const result=await request('/admin/customers/'+encodeURIComponent(userId)+'/gift-entitlements/'+encodeURIComponent(g.id)+'/'+action,{method:'POST',body:JSON.stringify({quantity:+q,reason,claimId,requestId})});receipt={...result,name:g.name};await load();toast(action==='claim'?'已登记领取':'已追加退回记录')}
   catch(err){error.textContent=err.message||'操作失败，请重试'}
   finally{busy=false;aside.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=false)}
  }
  aside.scrollIntoView({block:'nearest'});aside.querySelector('[data-claim-quantity]').focus({preventScroll:true})
 }
 async function load(){
  try{data=await request('/admin/customers/'+encodeURIComponent(userId)+'/gift-entitlements');if(!host.isConnected)return;if(!data.enabled){host.innerHTML='';return}render()}
  catch(error){if(host.isConnected){host.innerHTML='<section class="card customer-gifts-panel"><p>'+e(error.message||'权益读取失败')+'</p><button class="ghost slim" data-retry>重新读取</button></section>';host.querySelector('[data-retry]').onclick=load}}
 }
 await load()
}}
