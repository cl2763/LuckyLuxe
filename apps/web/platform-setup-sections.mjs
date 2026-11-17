import {mountSetupWidgets} from './platform-setup-widgets.mjs'
import {setupImpactHtml} from './platform-setup-impact.mjs'
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
export const sectionGroups={store:['store','hours','specialDates','hero','guide'],settlement:['settlement','pricingRules'],staff:['staff','accounts','visibility','schedule'],compensation:['salary','targets','recurring'],knowledge:['knowledge','quote'],membershipRules:['priceTypes','membership']}
const listModules=new Set(['specialDates','settlement','staff','accounts','salary','recurring','knowledge'])
const records=(s,key)=>key==='salary'?[s.defaultPlan,...(s.plans||[])].filter(Boolean):key==='specialDates'?(s.stores||[]).flatMap(store=>store.specialDates||[]):s.entries||s.items||s.technicians||s.accounts||s.rules||[]
// Each section owns its snapshot and input state. Saving one section must never use
// the selected module's fingerprint or discard another section's unsaved values.
export async function mountSetupSections({host,keys,overview,load,save,field,fields,win,changed,edit,preview,legacy,onSaved}){
 const states=[],doc=host.ownerDocument
 host.innerHTML='<div data-sections></div><section class="intake-card"><h3>本次配置依据</h3><label class="intake-field"><span>商家资料／确认说明（选填）</span><textarea data-section-source maxlength="2000"></textarea></label></section><div class="intake-savebar"><span>保存为草稿，逐项核对后应用。</span><button type="button" data-sections-save class="primary">保存本页草稿并核对</button></div><p role="status" data-section-status></p>'
 const container=host.querySelector('[data-sections]'),status=host.querySelector('[data-section-status]')
 host.querySelector('[data-section-source]').closest('section').insertAdjacentHTML('afterbegin','<div class="intake-checks">'+overview.materials.files.map(f=>`<label><input type="checkbox" data-section-source-id value="${esc(f.id)}">${esc(f.name)}</label>`).join('')+'</div>')
 for(const key of keys){
  const descriptor=overview.modules.find(m=>m.key===key);if(!descriptor?.enabled)continue
  const snapshot=await load(key),current=snapshot.current,section=doc.createElement('section');section.className='intake-card setup-section';section.dataset.section=key;container.append(section)
  section.innerHTML=`<div class="intake-title"><h2>${esc(key==='priceTypes'?'会员制度':descriptor.title)}</h2><button type="button" data-section-preview>预览商家端</button></div>`
  section.querySelector('[data-section-preview]').onclick=()=>preview(key)
  if(listModules.has(key)){
   const rows=records(current,key);section.insertAdjacentHTML('beforeend','<div class="tablewrap"><table><thead><tr><th>名称／日期</th><th>状态</th><th>操作</th></tr></thead><tbody>'+rows.map((r,i)=>`<tr><td>${esc(r.name||r.nameZh||r.username||r.question||r.date||overview.technicians.find(t=>t.id===r.technicianId)?.name||'全店默认')}</td><td>${r.isActive===false||r.is_active===0||r.enabled===false?'停用':'已配置'}</td><td>${['accounts','recurring','specialDates'].includes(key)?'已有配置保持原样':`<button type="button" data-section-edit="${i}">编辑草稿</button>`}</td></tr>`).join('')+'</tbody></table></div>'+(!rows.length?'<p class="subtle">尚无配置，可根据商家资料新增。</p>':'')+'<button type="button" data-section-new>新增'+esc(descriptor.title)+'</button>')
   section.querySelector('[data-section-new]').onclick=()=>edit(key,null);section.querySelectorAll('[data-section-edit]').forEach(b=>b.onclick=()=>edit(key,rows[Number(b.dataset.sectionEdit)]?.id));continue
  }
  const state={key,snapshot,dirty:false,section},touch=()=>{state.dirty=true;changed()};states.push(state)
  section.insertAdjacentHTML('beforeend','<form><div class="intake-grid">'+(fields[key]||[]).map(f=>field(f,current.config||{})).join('')+'</div><div data-section-widget></div></form>'+setupImpactHtml(key))
  const form=section.querySelector('form');form.onsubmit=e=>e.preventDefault();form.addEventListener('input',touch);form.addEventListener('change',touch);state.form=form;state.initial=new win.FormData(form)
  const widgetHost=section.querySelector('[data-section-widget]')
  if(key==='priceTypes'){
   widgetHost.innerHTML=`<label><input type="checkbox" name="membershipEnabled" ${current.config.membershipEnabled?'checked':''}>启用会员制度</label><p class="subtle">启用后结算保留会员价，按会员本人折扣结算。关闭不删除余额、权益或历史记录，也不会切换新版价格启用状态。</p>`
   state.widget={read:()=>({membershipEnabled:form.elements.membershipEnabled.checked,expectedRevision:current.config.revision,...form.elements.membershipEnabled.checked?{settlementTypes:[...new Set([...current.config.settlementTypes,'member'])]}:{}})}
  }else state.widget=mountSetupWidgets({host:widgetHost,module:key,current,technicians:overview.technicians,win,onChange:touch})
  if(key==='store'){
   section.insertAdjacentHTML('beforeend',`<div class="intake-grid setup-controlled"><label class="intake-field"><span>经营币种</span><input readonly value="${esc(overview.currency)}"></label><label class="intake-field"><span>所在时区</span><input readonly value="${esc(overview.timezone||'以门店当前设置为准')}"></label></div><button type="button" data-controlled-store>核对币种、时区与对外展示</button><p class="subtle">涉及历史账务的设置沿用平台原有保护流程。</p>`)
   section.querySelector('[data-controlled-store]').onclick=()=>legacy('store')
  }
 }
 if(keys.includes('knowledge')){const b=doc.createElement('button');b.type='button';b.textContent='企业微信接入配置';b.onclick=()=>legacy('wecom');container.append(b)}
 const button=host.querySelector('[data-sections-save]')
 button.onclick=async()=>{
  button.disabled=true;status.textContent='';let saved=0
  try{
   const pending=[]
   // Validate every changed section before creating the first draft.
   for(const s of states.filter(x=>x.dirty)){
    const form=new win.FormData(s.form),body={...s.widget.read()}
    for(const [key,label,type] of fields[s.key]||[]){
     if(JSON.stringify(form.getAll(key))===JSON.stringify(s.initial.getAll(key)))continue
     let v=form.get(key);if(type==='boolean')v=v==='on';else if(['categoryChecks','serviceChecks'].includes(type))v=form.getAll(key);else if(type==='money')v=win.MemberPricingSettings.cents(v,true);else if(['number','nullable','decimal'].includes(type)){v=type==='nullable'&&v===''?null:Number(v);if(v!==null&&(!Number.isFinite(v)||v<0||type!=='decimal'&&!Number.isSafeInteger(v)||type==='decimal'&&v>100))throw Error(label+'的数值不正确。')};body[key]=v
    }
    if(Object.keys(body).length)pending.push({s,body})
   }
   if(!pending.length)throw Error('还没有需要保存的变更。')
   for(const {s,body} of pending){await save({module:s.key,body,fingerprint:s.snapshot.fingerprint,sourceNote:host.querySelector('[data-section-source]').value,sourceIds:[...host.querySelectorAll('[data-section-source-id]:checked')].map(e=>e.value)});s.dirty=false;s.initial=new win.FormData(s.form);saved++}
   await onSaved()
  }catch(e){status.textContent=(saved?'已保存 '+saved+' 项草稿，剩余内容仍保留。':'')+e.message;status.className='intake-status error'}finally{button.disabled=false}
 }
 return {isDirty:()=>states.some(s=>s.dirty)}
}
