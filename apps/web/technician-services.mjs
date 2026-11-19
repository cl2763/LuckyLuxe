export async function openTechnicianServices({request,escapeHtml:h}) {
 if(document.querySelector('[data-tech-services-dialog]'))return
 const d=document.createElement('dialog');d.className='card';d.dataset.techServicesDialog='';d.style.cssText='max-width:640px;width:calc(100% - 48px);max-height:85vh;overflow:auto;padding:24px'
 d.innerHTML='<div class="section-row"><h2>技师服务分工</h2><button type="button" data-close>关闭 ×</button></div><p>选择技师实际能提供的项目。保存后影响后续预约选择，不改变已有订单或排班。</p><div data-body>正在加载…</div><p data-status role="status"></p>'
 let busy=false,dirty=false;document.body.append(d);d.showModal();d.oncancel=e=>e.preventDefault();d.onclose=()=>d.remove();d.querySelector('[data-close]').onclick=()=>{if(!busy)d.close()}
 const status=d.querySelector('[data-status]')
 try{
  const o=await request('/admin/technician-services');if(!d.isConnected)return
  if(!o.technicians.length){d.querySelector('[data-body]').textContent='暂无在职技师，请先在员工管理中新增或核对在职状态。';return}
  d.querySelector('[data-body]').innerHTML='<label>技师<select data-tech>'+o.technicians.map(t=>'<option value="'+h(t.id)+'">'+h(t.name)+'</option>').join('')+'</select></label><form><div data-services></div><button type="submit">保存服务分工</button></form>'
  const select=d.querySelector('[data-tech]'),form=d.querySelector('form');let selectedId=select.value
  const render=()=>{const t=o.technicians.find(t=>t.id===select.value);selectedId=select.value;form.querySelector('[data-services]').innerHTML=o.services.map(s=>'<label style="display:flex;gap:12px;padding:14px 4px"><input type="checkbox" name="service" value="'+h(s.id)+'" '+(t.serviceIds.includes(s.id)?'checked':'')+'>'+h(s.name)+(s.isActive?'':'（已下架）')+'</label>').join('');dirty=false;status.textContent=''}
  select.onchange=async()=>{if(dirty){select.value=selectedId;status.textContent='请先保存当前技师的选择，再切换技师。';return}render()};form.onchange=()=>{dirty=true};render()
  form.onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;const serviceIds=[...new FormData(form).getAll('service')];d.querySelectorAll('input,select,button').forEach(x=>x.disabled=true)
   try{await request('/admin/technicians/'+encodeURIComponent(selectedId),{method:'PATCH',body:JSON.stringify({serviceIds})});o.technicians.find(t=>t.id===selectedId).serviceIds=serviceIds;dirty=false;status.textContent='服务分工已保存，重新打开预约草稿即可读取新配置。'}catch(e){status.textContent=e.message||'保存失败，选择已保留，请重试。'}finally{busy=false;d.querySelectorAll('input,select,button').forEach(x=>x.disabled=false)}
  }
 }catch(e){status.textContent=e.message||'加载失败，请关闭后重试';d.querySelector('[data-body]').textContent=''}
}
