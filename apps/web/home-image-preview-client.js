(() => {
  let data=null,index=0
  function paint(){
    const slides=(data.slides||[]).filter(s=>s.isActive!==false).map(s=>({...s,label:data.zh?(s.labelZh||s.labelEn):(s.labelEn||s.labelZh)}));index=slides.length?(index+slides.length)%slides.length:0
    const root=document.querySelector('#preview')
    root.innerHTML=data.device==='mini'?`<section class="mini-home-preview card">${slides.length?`<div class="mini-home-preview-cover">${ImageFraming.image(slides[index].image,slides[index].imageView,'mini')}</div>`:''}<div class="mini-home-preview-name"><h1 data-fit-store-name>${ImageFraming.esc(data.name)}</h1><p>${data.zh?'扫码 / 切换门店 ›':'Switch shop ›'}</p></div></section>`:HomeImagePreview.hero({name:data.name,slides,index,book:data.zh?'立即预约':'Book now',member:data.zh?'会员档案':'Member profile'})
    if(data.device==='mini'&&slides.length>1)root.insertAdjacentHTML('beforeend',`<button class="ghost" data-hero-slide-prev>‹</button> ${index+1} / ${slides.length} <button class="ghost" data-hero-slide-next>›</button>`)
    ImageFraming.apply();requestAnimationFrame(()=>{const r=root.querySelector(data.device==='mini'?'.mini-home-preview-cover':'.hero-carousel')?.getBoundingClientRect();if(r)parent.postMessage({type:'youji-frame-metrics',device:data.device,width:r.width,height:r.height},location.origin)})
  }
  addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==parent||e.data?.type!=='youji-home-preview')return;data=e.data;index=0;paint()})
  document.onclick=e=>{if(!data)return;if(e.target.closest('[data-hero-slide-next]')){index++;paint()}else if(e.target.closest('[data-hero-slide-prev]')){index--;paint()}else if(e.target.closest('[data-hero-slide]')){index=Number(e.target.closest('[data-hero-slide]').dataset.heroSlide);paint()}else if(e.target.closest('button'))e.preventDefault()}
})()
