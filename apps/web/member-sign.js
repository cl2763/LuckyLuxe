;(async function(){
 const root=document.getElementById('memberSign'),params=new URLSearchParams(location.search),groupId=params.get('group'),token=new URLSearchParams(location.hash.slice(1)).get('token');
 let group,current,strokes=[],busy=false,signatureViewport=null;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 async function request(path,body){
  const res=await fetch(window.memberSignPrefix+path,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-document-token':token},...(body?{body:JSON.stringify(body)}:{})});
  const data=await res.json();if(!res.ok){const e=Error(data.error?.message||'加载失败，请重试');e.code=data.error?.code;throw e}return data;
 }
 const row=(a,b)=>'<div class="row"><span>'+esc(a)+'</span><strong>'+esc(b)+'</strong></div>';
 function renderDoc(d){
  if(d.status==='voided')return '<section class="doc"><h2>服务单已撤回</h2><p>此单未生效，请从本人订单打开门店更新后的服务单。</p></section>';
  if(d.recheck)return '<section class="doc"><h2>暂不能签署</h2><p>'+esc(d.recheck.reason)+'</p>'+row('单据原折扣',d.recheck.originalDiscountText)+row('当前个人折扣',d.recheck.currentDiscountText)+row('本次扣款金额','待店员重新核对')+'<div class="notice">请店员返回本次开单，核对并更新未签单据。更新后从此入口刷新即可；这张未签单尚未扣款，已签单不受影响。</div><button id="refresh">刷新单据</button></section>';
  const quote=d.signed||d.quote,display=quote.display;if(!display)return '<div class="notice">此历史单尚无新版展示快照，请从原签署凭证入口查看。</div>';
  const signed=d.status==='signed';
  return '<section class="doc"><strong>'+esc(display.storeName)+'</strong><p class="meta">会员／付款人：'+esc(display.customerName)+'</p><p class="meta">服务单：'+esc(d.id)+'</p><h2>'+(signed?'服务签署凭证':'请核对本次服务')+'</h2>'+
   row('被服务者／付款会员',display.beneficiaryName+'／'+display.customerName)+row('采用折扣',display.discountText)+
   display.lines.map(l=>row(l.name+(l.technicians?' · '+l.technicians:''),l.amountText)).join('')+
   '<h2>费用明细</h2>'+display.rows.map(r=>row(r.label,r.value)).join('')+
   '<h2>本次支付</h2>'+display.paymentRows.filter(r=>!signed||!r.label.includes('预计')).map(r=>row(r.label,r.value)).join('')+
   (signed?(quote.balanceBeforeText?row('签署前账户余额',quote.balanceBeforeText):'')+row('本单签署后余额',quote.balanceAfterText):'')+
   (display.discountChangeText?row('充值后个人折扣',display.discountChangeText):'')+
   (display.gifts.length?'<h2>本次赠送</h2>'+display.gifts.map(g=>row(g.name+' × '+g.quantity+(g.unitLabel||'')+(g.kindLabel?' · '+g.kindLabel+' · '+g.expiryText:''),g.valueText?g.valueText+'／'+(g.unitLabel||'件'):'')).join('')+'<p class="meta">实物由门店登记领取，服务权益通过服务单核销；此清单不代表已使用或领取。</p>':'')+
   '<div class="notice">'+esc(signed?'此凭证保留签署时的原始明细。后续更正单独留档。':display.note)+'</div>'+
   (signed?'<p class="meta">签署时间：'+esc(d.signedAtText)+'</p><canvas data-signed="'+esc(d.id)+'" aria-label="已签名笔迹"></canvas>'+corrections(d):
    '<label class="check"><input id="confirm" type="checkbox">我已核对被服务者、付款会员、服务、充值、赠送及扣款明细，并确认由本人签署。</label><canvas id="signature" aria-label="请在此处手写签名"></canvas><div class="pad-foot"><span>请在此处签名</span><button id="clear" type="button">清除重签</button></div><p id="signError" class="error" role="alert"></p><button id="sign" class="submit" type="button">'+(group.documents.filter(x=>x.status==='pending_sign').length>1?'确认签署本张并继续':'确认签署，完成本次')+'</button>')+'</section>';
 }
 function corrections(d){const changed=d.components.filter(c=>c.amendedCount);if(!changed.length)return '';return '<h2>后续更正记录</h2>'+row('当前服务金额',d.correction.amountText)+changed.map(c=>'<p>'+esc(c.amendBadgeText)+'</p>').join('')+'<p class="meta">以上更正不改写原签名与签署时明细。</p>'}
 function paint(canvas,lines,viewport){
  const ratio=devicePixelRatio||1,w=canvas.clientWidth;canvas.width=w*ratio;canvas.height=160*ratio;
  const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);ctx.lineWidth=2.4;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#241f1a';if(viewport){const scale=Math.min(w/viewport.width,160/viewport.height);ctx.scale(scale,scale)}
  for(const line of lines){if(!line.length)continue;ctx.beginPath();ctx.moveTo(line[0].x,line[0].y);for(const pt of line.slice(1))ctx.lineTo(pt.x,pt.y);ctx.stroke()}return ctx;
 }
 function pad(){
  const canvas=document.getElementById('signature');signatureViewport=signatureViewport||{width:canvas.clientWidth,height:160};let ctx=paint(canvas,strokes,signatureViewport),drawing=false;const point=e=>{const r=canvas.getBoundingClientRect(),scale=Math.min(r.width/signatureViewport.width,160/signatureViewport.height);return {x:Math.round((e.clientX-r.left)/scale),y:Math.round((e.clientY-r.top)/scale)}};
  canvas.onpointerdown=e=>{e.preventDefault();drawing=true;canvas.setPointerCapture(e.pointerId);const p=point(e);strokes.push([p]);ctx.beginPath();ctx.moveTo(p.x,p.y)};
  canvas.onpointermove=e=>{if(!drawing)return;e.preventDefault();const p=point(e);strokes[strokes.length-1].push(p);ctx.lineTo(p.x,p.y);ctx.stroke()};
  canvas.onpointerup=canvas.onpointercancel=()=>{drawing=false};document.getElementById('clear').onclick=()=>{strokes=[];ctx=paint(canvas,strokes,signatureViewport)};document.getElementById('sign').onclick=sign;new ResizeObserver(()=>{ctx=paint(canvas,strokes,signatureViewport)}).observe(canvas);
 }
 async function load(){
  try{group=await request('/member-document-groups/'+encodeURIComponent(groupId));current=group.documents.find(d=>d.status==='pending_sign');strokes=[];signatureViewport=null;
   if(!current){const allSigned=group.documents.every(d=>d.status==='signed');root.innerHTML='<section class="doc"><h1>'+(allSigned?'本次签署已完成':'本次服务单记录')+'</h1><p>'+group.documents.filter(d=>d.status==='signed').length+'张服务单已签署。</p>'+group.documents.map(d=>row(d.quote.display?.beneficiaryName||d.quote.name,d.status==='signed'?'已签署':'已撤回')).join('')+'</section>'+group.documents.map(renderDoc).join('')+'<button id="print">打印／保存凭证</button>';root.querySelectorAll('[data-signed]').forEach(c=>{const d=group.documents.find(d=>d.id===c.dataset.signed).signed;const draw=()=>paint(c,d?.strokes||[],d?.signatureViewport);draw();new ResizeObserver(draw).observe(c)});document.getElementById('print').onclick=()=>window.print();return}
   const i=group.documents.indexOf(current)+1;root.innerHTML='<div class="progress"><strong>本次共'+group.documents.length+'张 · 第'+i+'张</strong><span>'+esc(current.quote.display?.beneficiaryName||current.quote.name)+'</span></div><h1>服务确认单</h1>'+renderDoc(current)+'<div class="notice">签完后自动进入下一张服务单，无需商家再次推送。</div>';if(current.recheck)document.getElementById('refresh').onclick=load;else pad();
  }catch(e){error(e)}
 }
 function error(e){const changed=['PRICING_CHANGED','MEMBERSHIP_CHANGED','DEPOSIT_CHANGED','DOCUMENT_CHANGED','DOCUMENT_VOIDED','DOCUMENT_COMPONENT_CHANGED'].includes(e.code);root.innerHTML='<section class="doc"><h1>'+(changed?'请店员重新核对':'暂时无法打开服务单')+'</h1><p>'+esc(e.message)+'</p><div class="notice">'+(changed?'影响本单的价格或权益已变化，请店员核对并更新未签单据。单据不按时间自动过期，已签单据不受影响。':'请重新打开本人订单中的服务单，或请门店重新打开本机签署。')+'</div><button id="refresh">重新读取</button></section>';document.getElementById('refresh').onclick=load}
 async function sign(){
  if(busy)return;const errorNode=document.getElementById('signError');if(!document.getElementById('confirm').checked){errorNode.textContent='请先勾选确认声明';return}if(!strokes.some(s=>s.length>2)){errorNode.textContent='请在签名框内手写签名';return}
  busy=true;document.getElementById('sign').disabled=true;
  try{await request('/member-documents/'+encodeURIComponent(current.id)+'/sign',{confirmationHash:current.confirmationHash,signature:current.quote.display.customerName||'本人签署',strokes,signatureViewport,disclaimerAccepted:true,signerConfirmed:true});await load()}
  catch(e){if(['PRICING_CHANGED','MEMBERSHIP_CHANGED','DEPOSIT_CHANGED','DOCUMENT_CHANGED','DOCUMENT_VOIDED','DOCUMENT_COMPONENT_CHANGED'].includes(e.code))error(e);else{errorNode.textContent=e.message;document.getElementById('sign').disabled=false}}finally{busy=false}
 }
 if(!groupId||!token){root.textContent='请从本人订单或商家提供的最新签署链接进入。';return}await load();
})()
