window.LLStoreCode = { mount(request, lang) {
  const host=document.querySelector('#storeMiniCode')
  if(!host || host.dataset.ready===lang)return
  host.dataset.ready=lang
  const en=lang==='en'
  host.innerHTML='<button type="button" class="ghost"></button><p role="status"></p><img alt="">'
  const button=host.querySelector('button'),status=host.querySelector('p'),img=host.querySelector('img')
  button.textContent=en?'View store mini-program code':'查看门店专属小程序码'
  img.hidden=true;img.style.cssText='width:280px;max-width:100%;height:auto'
  button.onclick=async()=>{
    button.disabled=true;status.textContent=en?'Generating…':'正在生成…';img.hidden=true
    try {
      const code=await request('/admin/store/mini-code')
      img.onload=()=>{button.disabled=false;img.hidden=false;status.textContent=code.envVersion==='release'?(en?'Store code for public use.':'正式版门店码，可用于门店展示。'):(en?'Trial code. Testers only; do not print for customers.':'体验版门店码，仅供体验成员测试，请勿对外印刷。')}
      img.onerror=()=>{button.disabled=false;status.textContent=en?'Code failed. Retry or check WeChat configuration.':'门店码生成失败，请重试或联系平台核对微信配置。'}
      img.src=(location.pathname.startsWith('/experience/')?'/experience':'')+code.path+'?v='+Date.now();img.alt=en?'Store mini-program code':'门店专属小程序码'
    } catch(e) {button.disabled=false;status.textContent=e.message}
  }
} }
