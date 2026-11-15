/* Scroll selection is a draft until the picker is confirmed; the parent form then saves it. */
window.DiscountWheel={mount(host,{value=null,onChange=()=>{},disabled=false}={}){
 const input=window.MemberPricingInput,options=input.options.filter(o=>o.rateBps!==null);let selected=value,draft=value,timer;
 host.innerHTML='<div class="mp-wheel-field"><span>个人折扣</span><button type="button" class="ghost" data-open '+(disabled?'disabled':'')+'></button><small>滚动选择，支持一位小数；确认后生效。</small></div><dialog class="mp-wheel-dialog" aria-label="选择个人折扣"><h3>选择个人折扣</h3><div class="mp-wheel" role="listbox" tabindex="0" aria-label="个人折扣">'+options.map((o,i)=>'<button type="button" role="option" data-index="'+i+'">'+o.label+'</button>').join('')+'</div><p data-selected></p><p class="subtle">无折扣按原价结算；0.1–9.9折，精确一位小数。</p><div class="action-row"><button type="button" class="primary" data-confirm>确认选择</button><button type="button" class="ghost" data-cancel>取消</button></div></dialog>';
 const wheel=host.querySelector('.mp-wheel'),dialog=host.querySelector('dialog'),trigger=host.querySelector('[data-open]'),height=44;
 function select(index,scroll){index=Math.max(0,Math.min(options.length-1,index));draft=options[index].rateBps;wheel.querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-selected',String(i===index)));host.querySelector('[data-selected]').textContent='已选择 '+input.label(draft);if(scroll)wheel.scrollTop=index*height}
 function showValue(){trigger.textContent=input.label(selected)+' ›'}
 trigger.onclick=()=>{draft=selected;dialog.showModal();select(options.findIndex(o=>o.rateBps===draft),true);wheel.focus()};
 wheel.addEventListener('scroll',()=>{clearTimeout(timer);timer=setTimeout(()=>select(Math.round(wheel.scrollTop/height),false),90)});
 wheel.addEventListener('click',e=>{const b=e.target.closest('button');if(b)select(Number(b.dataset.index),true)});
 wheel.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();const i=options.findIndex(o=>o.rateBps===draft);select(e.key==='Home'?0:e.key==='End'?options.length-1:i+(e.key==='ArrowUp'?-1:1),true)}});
 host.querySelector('[data-confirm]').onclick=()=>{clearTimeout(timer);select(Math.round(wheel.scrollTop/height),false);selected=draft;showValue();dialog.close();onChange(selected)};
 host.querySelector('[data-cancel]').onclick=()=>{clearTimeout(timer);dialog.close()};dialog.addEventListener('cancel',()=>clearTimeout(timer));showValue();
 return {read:()=>selected,set:value=>{selected=value;showValue();if(dialog.open)select(options.findIndex(o=>o.rateBps===value),true);onChange(selected)}}
}};
