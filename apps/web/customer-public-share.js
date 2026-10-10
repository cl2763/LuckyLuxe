(() => {
  const views=['home','services','detail','portfolio']
  function restore(state,toast) {
    const p=new URLSearchParams(location.search),v=p.get('publicView')
    if(!views.includes(v))return
    state.view=v
    if(v==='detail') {
      state.service=state.services.find(s=>s.id===p.get('serviceId'))||null
      if(!state.service){state.view='services';toast(state.lang==='en'?'Service is no longer available':'该服务已下架或不可用')}
    }
  }
  function render({state,root,tenant,toast}) {
    if(!tenant||!views.includes(state.view))return
    const button=document.createElement('button');button.type='button';button.className='ghost slim'
    button.textContent=state.lang==='en'?'Copy page link':'复制页面链接'
    button.addEventListener('click',async()=>{
      const url=new URL(location.pathname,location.origin)
      url.searchParams.set('store',tenant);url.searchParams.set('publicView',state.view)
      if(state.view==='detail'&&state.service)url.searchParams.set('serviceId',state.service.id)
      try{await navigator.clipboard.writeText(url.href);toast(state.lang==='en'?'Link copied':'链接已复制')}
      catch{toast(state.lang==='en'?'Could not copy. Please allow clipboard access and retry.':'复制失败，请允许剪贴板访问后重试。')}
    })
    root.prepend(button)
  }
  window.CustomerPublicShare={restore,render}
})()
