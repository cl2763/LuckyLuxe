/* Approved 2026-09-24 image framing contract: preserve source and save focus only. */
window.ImageFraming = (() => {
  const core=window.ImageViewCore, esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
  const clone=v=>JSON.parse(JSON.stringify(v||{}))
  function image(src,views={},profile='card',className='',alt='') {
    const data=esc(JSON.stringify(views||{}))
    return `<span class="image-frame ${esc(className)}" data-image-views="${data}" data-image-profile="${profile}"><img src="${esc(src)}" alt="${esc(alt)}" draggable="false" style="${core.style(views?.[profile])}"></span>`
  }
  function apply(root=document) {
    root.querySelectorAll('[data-image-views]').forEach(el=>{
      const profile=el.dataset.imageProfile==='hero'?(innerWidth<=920?'mobile':'desktop'):el.dataset.imageProfile
      const v=JSON.parse(el.dataset.imageViews||'{}')[profile]
      el.querySelector('img').style.cssText=core.style(v)
    })
    root.querySelectorAll('[data-fit-store-name]').forEach(el=>{
      const mobile=innerWidth<=760, max=mobile?26:32,min=mobile?18:22
      el.style.whiteSpace='nowrap';el.style.fontSize=max+'px'
      for(let size=max;size>min&&el.scrollWidth>el.clientWidth+1;size--)el.style.fontSize=(size-1)+'px'
      el.style.whiteSpace='normal';el.title=el.textContent
    })
  }
  let queued=false
  function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;apply()})}
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true})
  addEventListener('resize',schedule);document.fonts?.ready.then(schedule)
  document.addEventListener('click',e=>{const n=e.target.closest('[data-fit-store-name]');if(n&&n.scrollHeight>n.clientHeight+2)window.UIDialog.alert(n.textContent)})
  const profiles={desktop:['电脑网页','Desktop web',649/520],mobile:['手机网页','Mobile web',355/260],mini:['小程序','Mini program',1.42],card:['服务列表','Service card',168/150],detail:['服务详情','Service detail',1180/360]}
  function edit({src,views={},kind='hero',zh=true,onApply}) {
    const keys=kind==='hero'?['desktop','mobile','mini']:['card','detail'],draft=clone(views)
    let key=keys[0],drag=null;const ratios={};let measuredFrame=null
    const dialog=document.createElement('dialog');dialog.className='image-editor-dialog'
    dialog.innerHTML=`<div class="image-editor-head"><div><h2>${zh?'把想展示的部分，放进画框':'Choose the part to show'}</h2><p>${zh?'拖动照片或移动滑块。原图完整画面保留，各种展示位置分别保存范围。':'Drag the photo or use the sliders. Keep the full image; adjust each display separately.'}</p></div><button type="button" class="ghost" data-cancel aria-label="${zh?'取消':'Cancel'}">×</button></div><div class="image-profile-tabs">${keys.map(k=>`<button class="ghost" type="button" data-profile="${k}">${profiles[k][zh?0:1]}</button>`).join('')}</div><div class="image-edit-stage"><div class="image-edit-frame">${image(src,{},key)}</div></div><p class="subtle" data-frame-size></p><div class="image-edit-controls">${[['zoom',zh?'缩放':'Zoom',1,3,.01],['x',zh?'左右':'Horizontal',0,100,1],['y',zh?'上下':'Vertical',0,100,1]].map(([k,l,min,max,step])=>`<label>${l}<input type="range" data-range="${k}" min="${min}" max="${max}" step="${step}"><output data-value="${k}"></output></label>`).join('')}</div><div class="image-editor-actions"><button type="button" class="ghost" data-reset>${zh?'重置当前范围':'Reset this view'}</button><button type="button" class="ghost" data-cancel>${zh?'取消调整':'Cancel'}</button><button type="button" class="primary" data-adopt>${zh?'采用此范围':'Use this view'}</button></div>`
    const grid=document.createElement('div');grid.className='image-editor-grid';const aside=document.createElement('div');aside.className='image-editor-aside'
    dialog.querySelector('.image-edit-stage').before(grid);grid.append(dialog.querySelector('.image-edit-stage'),aside)
    aside.append(dialog.querySelector('[data-frame-size]'),dialog.querySelector('.image-edit-controls'),dialog.querySelector('.image-editor-actions'))
    aside.insertAdjacentHTML('beforeend',`<p class="image-editor-note">${zh?'不同端的画框比例不同，不强行用同一次裁切。下方预览随当前调整实时更新；其他位置保持原来的范围。采用范围后仍须保存到门店。':'Each surface has its own frame. Previews update as you adjust; other views stay unchanged. Save to publish after adopting the view.'}</p>`)
    dialog.insertAdjacentHTML('beforeend',`<div class="image-editor-previews">${keys.map(k=>`<div><div class="image-editor-mini-preview" style="aspect-ratio:${profiles[k][2]}">${image(src,draft,k)}</div><small>${profiles[k][zh?0:1]}</small></div>`).join('')}</div>`)
    document.body.append(dialog)
    const frame=dialog.querySelector('.image-edit-frame'),img=frame.querySelector('img')
    function paint(){const v=core.view(draft[key]);draft[key]=v;img.style.cssText=core.style(v);frame.querySelector('.image-frame').dataset.imageViews=JSON.stringify({[key]:v});frame.querySelector('.image-frame').dataset.imageProfile=key;dialog.querySelectorAll('[data-range]').forEach(e=>{e.value=v[e.dataset.range];dialog.querySelector(`[data-value=${e.dataset.range}]`).textContent=e.dataset.range==='zoom'?v.zoom.toFixed(2)+'×':Math.round(v[e.dataset.range])+'%'});dialog.querySelectorAll('[data-profile]').forEach(e=>e.classList.toggle('active',e.dataset.profile===key));dialog.querySelectorAll('.image-editor-mini-preview .image-frame').forEach(e=>{e.dataset.imageViews=JSON.stringify(draft);e.querySelector('img').style.cssText=core.style(draft[e.dataset.imageProfile])})}
    function select(k){key=k;const ratio=ratios[k]||profiles[k][2];frame.style.aspectRatio=String(ratio);frame.style.setProperty('--frame-ratio',ratio);paint();requestAnimationFrame(()=>{dialog.querySelector('[data-frame-size]').textContent=zh?`${profiles[k][0]} · 拖拽调整，其他位置单独设置`:`${profiles[k][1]} · Drag to adjust; other views are independent`})}
    dialog.querySelectorAll('[data-profile]').forEach(e=>e.onclick=()=>select(e.dataset.profile))
    dialog.querySelectorAll('[data-range]').forEach(e=>e.oninput=()=>{draft[key][e.dataset.range]=Number(e.value);paint()})
    frame.onpointerdown=e=>{if(e.button!==0)return;const r=frame.getBoundingClientRect();drag={x:e.clientX,y:e.clientY,v:clone(draft[key]),r};frame.setPointerCapture(e.pointerId);e.preventDefault()}
    frame.onpointermove=e=>{if(!drag||!img.naturalWidth)return;const g=core.geometry(img.naturalWidth,img.naturalHeight,drag.r.width,drag.r.height,drag.v);draft[key]={...drag.v,x:g.width>drag.r.width?Math.max(0,Math.min(100,drag.v.x-(e.clientX-drag.x)/(g.width-drag.r.width)*100)):50,y:g.height>drag.r.height?Math.max(0,Math.min(100,drag.v.y-(e.clientY-drag.y)/(g.height-drag.r.height)*100)):50};paint()}
    frame.onpointerup=frame.onpointercancel=()=>{drag=null}
    dialog.querySelectorAll('[data-cancel]').forEach(e=>e.onclick=()=>dialog.close())
    dialog.querySelector('[data-reset]').onclick=()=>{draft[key]=core.view();paint()}
    dialog.querySelector('[data-adopt]').onclick=()=>{onApply(clone(draft));dialog.close()}
    const measure=document.createElement('iframe');measure.className='image-measure-iframe';measure.tabIndex=-1;measure.setAttribute('aria-hidden','true');measure.src='/web/home-image-preview.html';document.body.append(measure)
    const measureKey=()=>{measure.style.width=(key==='desktop'?1240:375)+'px';measure.contentWindow.postMessage({type:'youji-home-preview',name:'',slides:[{image:src,imageView:{}}],device:key==='mini'?'mini':key==='desktop'?'desktop':'mobile',zh},location.origin)}
    const metrics=e=>{if(e.source!==measure.contentWindow||e.origin!==location.origin||e.data?.type!=='youji-frame-metrics'||kind!=='hero')return;const k=e.data.device;if(!keys.includes(k)||!e.data.width||!e.data.height)return;ratios[k]=e.data.width/e.data.height;if(key===k){frame.style.aspectRatio=String(ratios[k]);frame.style.setProperty('--frame-ratio',ratios[k]);dialog.querySelector('[data-frame-size]').textContent=(zh?'展示画框 ':'Display frame ')+Math.round(e.data.width)+' × '+Math.round(e.data.height)+' px · '+profiles[k][zh?0:1]}}
    addEventListener('message',metrics);measure.onload=()=>{measuredFrame=true;measureKey()};dialog.querySelectorAll('[data-profile]').forEach(e=>e.addEventListener('click',()=>{if(measuredFrame)measureKey()}))
    dialog.onclose=()=>{removeEventListener('message',metrics);measure.remove();dialog.remove()};dialog.showModal();select(key)
  }
  async function read(file){
    if(!file.type.startsWith('image/'))throw Error('请选择图片文件 / Choose an image')
    if(file.size>30*1024*1024)throw Error(file.name+'：原图超过 30MB，请换用较小图片 / Image exceeds 30MB')
    const src=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(Error(file.name+'：读取失败 / Read failed'));r.readAsDataURL(file)})
    const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error(file.name+'：无法识别图片 / Invalid image'));i.src=src})
    if(src.length<=2*1024*1024)return src
    // Resize the whole photograph to meet the existing API limit; never bake in a crop.
    for(const edge of [2400,1800,1200]){
      const ratio=Math.min(1,edge/Math.max(img.naturalWidth,img.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.round(img.naturalWidth*ratio);canvas.height=Math.round(img.naturalHeight*ratio)
      const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height)
      for(const quality of [.86,.7,.55]){const encoded=canvas.toDataURL('image/jpeg',quality);if(encoded.length<=2*1024*1024)return encoded}
    }
    throw Error(file.name+'：图片处理失败，请换一张 / Could not process image')
  }
  return {image,apply,edit,read,clone,esc}
})()
