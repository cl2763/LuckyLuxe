/* Owner directory views. The server supplies tenant-scoped live balances/counts;
   destructive actions always run the separate association review again. */
window.RecordTables=(()=>{
 const states=new WeakMap(),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
 function mount(el,kind,ctx){
  if(!el)return
  let state=states.get(el)
  if(!state||state.kind!==kind){state={kind,archived:false,version:0};states.set(el,state)}
  state.ctx=ctx
  const v=++state.version,employee=kind==='technicians',archived=state.archived
  el.innerHTML=`${!archived?ctx.leading||'':''}${employee?'<div class="directory-heading">':''}${employee?'<h2>员工名册</h2>':''}${employee?'<button class="ghost slim" type="button" data-roster-add>＋ 添加员工</button>':''}${employee?'</div>':''}<div class="directory-tabs"><button type="button" class="ghost slim" data-directory-active aria-pressed="${!archived}">${employee?'在职':'全部客户'}</button><button type="button" class="ghost slim" data-directory-archived aria-pressed="${archived}">${employee?'已离职':'已归档'}</button><button type="button" class="ghost slim" data-directory-refresh>刷新</button></div><div data-directory-rows aria-live="polite">正在读取本店资料…</div>`
  el.querySelector('[data-directory-active]').onclick=()=>{state.archived=false;mount(el,kind,state.ctx)}
  el.querySelector('[data-directory-archived]').onclick=()=>{state.archived=true;mount(el,kind,state.ctx)}
  el.querySelector('[data-directory-refresh]').onclick=()=>mount(el,kind,state.ctx)
  el.querySelector('[data-roster-add]')?.addEventListener('click',()=>document.querySelector('#addTechnicianButton')?.click())
  ctx.request('/admin/records/'+kind+'?summary=1&archived='+(archived?'1':'0')).then(r=>{
   if(v!==state.version||!el.querySelector('[data-directory-rows]'))return
   const q=String(ctx.query||'').trim().toLowerCase(),rows=r.records.filter(x=>{const c=(ctx.customers||[]).find(c=>c.id===x.id)||{};return [x.name,x.displayName,x.remarkName,c.phone,c.email,c.memberCode,x.phone,x.email].filter(Boolean).join(' ').toLowerCase().includes(q)&&(!ctx.order||archived||ctx.order.includes(x.id))});if(ctx.order&&!archived)rows.sort((a,b)=>ctx.order.indexOf(a.id)-ctx.order.indexOf(b.id))
   el.querySelector('[data-directory-rows]').innerHTML=`<div class="directory-scroll" tabindex="0" role="region" aria-label="资料列表，可横向滚动"><table class="directory-table" style="width:100%;border-collapse:collapse;min-width:660px"><thead><tr>${(employee?['员工','状态','待服务预约','账号','操作']:['顾客','储值余额','待处理事项','最近到店','操作']).map(x=>`<th style="text-align:left;padding:14px 16px;border-bottom:1px solid var(--line)">${x}</th>`).join('')}</tr></thead><tbody>${rows.map(x=>`<tr><td style="padding:16px">${esc(x.name)}</td>${employee?`<td style="padding:16px">${archived?'已离职':x.isActive?'在职':'已停用接客'}</td><td style="padding:16px">${x.pendingCount} 个</td><td style="padding:16px">${x.accountStatus==='none'?'未创建':x.accountStatus==='active'?'已启用':'已停用'}</td>`:`<td style="padding:16px">${ctx.money(x.balanceCents)}</td><td style="padding:16px">${x.pendingCount?x.pendingCount+' 个预约 / 售后':'无未完预约'}</td><td style="padding:16px">${x.lastVisitAt?esc(ctx.dateOnly(x.lastVisitAt)):'尚未到店'}</td>`}<td style="padding:16px"><div class="inline-actions compact-actions">${!archived?`<button class="ghost slim" type="button" ${employee?'data-tech-edit':'data-customer-detail'}="${esc(x.id)}">${employee?'编辑':'查看'}</button>`:''}<button class="ghost slim" type="button" data-record-manage="${kind}" data-record-id="${esc(x.id)}">${archived?'查看 / 恢复':employee?'删除 / 办理离职':'删除 / 归档'}</button>${!employee&&!archived?`<button class="ghost slim" type="button" data-account-adjust="${esc(x.id)}">账户调整</button>`:''}</div></td></tr>`).join('')||'<tr><td colspan="5" style="padding:24px">暂无符合条件的资料</td></tr>'}</tbody></table></div><p class="subtle">删除或归档前会再次核对余额、有效权益、待签单及其他关联事项。</p>`
  }).catch(e=>{if(v===state.version&&el.querySelector('[data-directory-rows]'))el.querySelector('[data-directory-rows]').textContent=e.message||'读取失败，请刷新重试。'})
 }
 return {mount}
})()
