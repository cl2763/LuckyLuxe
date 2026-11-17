window.ConfigSync=(()=>{
function start({request,path,context,enabled=()=>true,canRefresh=()=>true,refresh}){
 let stopped=false,timer,busy=false,revision=null,key=null,dirty=false,pending=false,last='',error='';const status=document.createElement('div');status.setAttribute('role','status');status.style.cssText='padding:10px 24px;background:var(--wall);color:var(--ink);font-size:13px;line-height:1.6;display:none';document.body.prepend(status)
 const draw=()=>{status.style.display=error||pending||last?'block':'none';status.replaceChildren();const t=document.createElement('span');t.textContent=error||(pending?'配置已更新。当前输入已保留，核对后再保存。':'上次核对 '+last+'（本机时间）');status.append(t);{const b=document.createElement('button');b.type='button';b.textContent=error||pending?'重新读取':'立即刷新';b.style.cssText='margin-left:16px;padding:8px 16px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--ink)' ;b.onclick=async()=>{if(dirty&&!await window.UIDialog.confirm('重新读取最新配置',{hint:'这会替换本页尚未保存的输入，请确认已保留需要的内容。'}))return;try{await refresh(true);dirty=false;pending=false;error='';draw();tick()}catch(e){error=e.message;draw()}};status.append(b)}}
 const tick=async()=>{clearTimeout(timer);if(stopped)return;if(busy)return;if(document.hidden||!enabled()){timer=setTimeout(tick,5000);return}busy=true;try{const next=context();if(key!==next){revision=null;key=next;dirty=false;pending=false;error=''}const r=await request(path);if(stopped||key!==context())return;if(revision!==null&&revision!==r.revision){if(!dirty&&canRefresh()){await refresh(false);if(stopped||key!==context())return;pending=false}else pending=true}revision=r.revision;error='';last=new Date().toLocaleTimeString();draw()}catch(e){if(stopped)return;error='暂时无法核对最新配置；当前内容和输入已保留。';draw()}finally{busy=false;if(!stopped)timer=setTimeout(tick,5000)}}
 const changed=e=>{if(!status.contains(e.target))dirty=true},visible=()=>{if(!document.hidden)tick()};document.addEventListener('input',changed);document.addEventListener('change',changed);document.addEventListener('visibilitychange',visible);tick();return {stop(){stopped=true;clearTimeout(timer);document.removeEventListener('input',changed);document.removeEventListener('change',changed);document.removeEventListener('visibilitychange',visible);status.remove()}}
}
// U22: report only the acknowledged save and this page's successful reads.
const labels=[[/^\/admin\/packages(?:\/[^/]+)?$/, '会员套餐'],[/^\/admin\/business-hours$/, '营业与预约时间'],[/^\/admin\/deposit-config$/, '定金与取消规则'],[/^\/admin\/booking-addons$/, '预约附加服务'],[/^\/admin\/(?:services|pricing\/items)(?:\/[^/]+)?$/, '服务与价目'],[/^\/admin\/member-pricing\/config$/, '价格类型']]
function saved(path,options,{storeName,tenantId,context}){
 if(window.SetupPreview||!['POST','PUT','PATCH'].includes(options.method)||!tenantId)return
 const label=labels.find(([pattern])=>pattern.test(path.split('?')[0]))?.[1];if(!label)return
 document.querySelector('[data-config-save-receipt]')?.remove()
 const host=document.querySelector('main.admin-shell');if(!host)return
 const panel=document.createElement('section');panel.dataset.configSaveReceipt='';panel.className='card';panel.style.cssText='padding:24px;margin:16px 0;line-height:1.7;overflow-wrap:anywhere';panel.setAttribute('aria-label','设置保存结果')
 const title=document.createElement('h3');title.textContent='已保存';title.style.margin='0 0 16px';panel.append(title)
 const facts=document.createElement('dl');facts.style.cssText='display:grid;grid-template-columns:110px minmax(0,1fr);gap:12px 20px;margin:0 0 16px'
 for(const [key,value] of [['门店',storeName||'—'],['本次修改',label],['保存确认时间',new Date().toLocaleString()+'（本机时间）']]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;dd.style.margin='0';facts.append(dt,dd)}panel.append(facts)
 const note=document.createElement('p');note.textContent='新设置已保存到服务器。其他设备重新进入页面或点击刷新后读取最新内容。正在打开的页面会检查更新；网络异常时显示提示。';panel.append(note)
 const actions=document.createElement('div');actions.className='action-row';actions.style.cssText='display:flex;gap:12px;flex-wrap:wrap';const customer=document.createElement('a');customer.className='ghost-link';customer.textContent='查看顾客端';const url=new URL(window.WebScope?.path('/')||'/',window.location.origin);url.searchParams.set('store',tenantId);customer.href=url.href;customer.target='_blank';customer.rel='noopener';actions.append(customer)
 const merchant=document.createElement('button');merchant.type='button';merchant.className='ghost slim';merchant.textContent='查看商家端';merchant.onclick=()=>{panel.remove();document.querySelector('[data-admin-page].active')?.click()};actions.append(merchant)
 const close=document.createElement('button');close.type='button';close.className='ghost slim';close.textContent='收起';close.onclick=()=>panel.remove();actions.append(close);panel.append(actions)
 const foot=document.createElement('p');foot.textContent='本页最新核对状态见顶部提示；不代表所有设备均已读取。';foot.className='subtle';panel.append(foot);host.prepend(panel)
 // A receipt belongs to the shop that acknowledged the save, not the next session.
 const check=()=>{if(!panel.isConnected)return;if(context()!==tenantId){panel.remove();return}setTimeout(check,1000)};check()
}
return {start,saved}
})()
