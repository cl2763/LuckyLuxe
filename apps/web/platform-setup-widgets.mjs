import {mountOperationalWidgets} from './platform-setup-operations.mjs'
// Structured editors for configuration collections; never ask merchants to type JSON.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
export function mountSetupWidgets({host,module,current,record,technicians,win,onChange}){
 if(module==='bookingAddons'){if(!window.BookingAddons?.editor)throw Error('附加服务编辑器未加载，请重新打开配置页。');host.addEventListener('click',e=>e.stopPropagation());return window.BookingAddons.editor(host,{config:current.config,services:current.serviceChoices,settlementItems:current.settlementChoices,onChange})}
 if(module==='pricingRules'){
  const rules=structuredClone(current.rules),titles={foot_surcharge:'足部加收',single_finger:'单指计价比例',tip_reuse:'甲片复用费用'}
  host.innerHTML='<p>按门店实际规则设置。保持关闭不会启用新收费；修改不改历史服务单。</p>'+Object.entries(rules).map(([k,r])=>`<section class="intake-card" data-rule="${k}"><h3>${titles[k]}</h3><label><input type="checkbox" data-active ${r.isActive?'checked':''}>启用</label><label class="intake-field"><span>${k==='single_finger'?'相应主项目价档的百分比':'收费金额（门店经营币种）'}</span><input data-value inputmode="decimal" value="${k==='single_finger'?r.config.pct:r.config.amountCents/100}"></label></section>`).join('')
  host.oninput=onChange
  return {read(){for(const row of host.querySelectorAll('[data-rule]')){const key=row.dataset.rule,r=rules[key];r.isActive=row.querySelector('[data-active]').checked;const v=row.querySelector('[data-value]').value;r.config=key==='single_finger'?{...r.config,pct:Number(v)}:{...r.config,amountCents:win.MemberPricingSettings.cents(v,true)}}return {rules}}}
 }
 const operational=mountOperationalWidgets({host,module,current,record,technicians,win,onChange});if(operational)return operational
 const field=(label,key,value,type='text')=>`<label class="intake-field"><span>${esc(label)}</span><input data-key="${key}" type="${type}" ${type==='checkbox'?(value?'checked':''):`value="${esc(value)}"`} ${type==='number'?'min="0" step="1"':''}></label>`
 let values,read=()=>({}),initial,busy=0
 if(module==='schedule'){
  const techs=(current.technicians||[]).filter(t=>t.is_active);values=current.entries?structuredClone(current.entries):[{technicianId:techs[0]?.id||'',date:'',shift:'full'}]
  const draw=()=>{host.innerHTML='<p>只补充尚无班表的日期。已有班表、历史日期及与预约冲突的安排会被拦截，请由老板在正常排班入口核对。</p>'+values.map((v,i)=>`<section class="intake-card" data-shift="${i}"><div class="intake-grid"><label class="intake-field"><span>技师</span><select data-key="technicianId">${techs.map(t=>`<option value="${esc(t.id)}" ${v.technicianId===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label>${field('日期','date',v.date,'date')}<label class="intake-field"><span>班次</span><select data-key="shift">${Object.entries({full:'全天',am:'上午',pm:'下午',off:'休息',custom:'自定义'}).map(([k,l])=>`<option value="${k}" ${v.shift===k?'selected':''}>${l}</option>`).join('')}</select></label>${field('自定义开始时间','startTime',v.startTime||'','time')}${field('自定义结束时间','endTime',v.endTime||'','time')}</div><button type="button" data-remove="${i}">移除这一行</button></section>`).join('')+'<button type="button" data-add>增加班次</button>'
   host.querySelectorAll('[data-key]').forEach(el=>el.oninput=()=>{values[+el.closest('[data-shift]').dataset.shift][el.dataset.key]=el.value;onChange()})
   host.querySelector('[data-add]').onclick=()=>{values.push({technicianId:techs[0]?.id||'',date:'',shift:'full'});draw();onChange()};host.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{values.splice(+b.dataset.remove,1);draw();onChange()})
  };draw();read=()=>({entries:values.map(v=>v.shift==='custom'?v:{technicianId:v.technicianId,date:v.date,shift:v.shift})})
 }
 if(module==='services'){
  let image=record?.imageUrl||'',changed=false
  host.innerHTML='<h3>服务图片</h3><img style="max-width:260px;max-height:180px;object-fit:contain" alt="当前服务图片"><label class="upload-label">选择服务图片<input type="file" accept="image/jpeg,image/png,image/webp"></label><p role="status"></p>'
  const img=host.querySelector('img');img.hidden=!image;if(image)img.src=image
  host.querySelector('input').onchange=async e=>{const f=e.target.files[0];if(!f)return;busy++;try{image=await win.ImageFraming.read(f,{maxChars:1300000});changed=true;img.src=image;img.hidden=false;onChange()}catch(e){host.querySelector('[role=status]').textContent=e.message}finally{busy--}}
  read=()=>{if(busy)throw Error('正在读取图片，请稍后保存');return changed?{imageUrl:image,imageView:{}}:{}}
 }
 if(module==='hours'){
  values=Array.from({length:7},(_,weekday)=>(current.hours||current.stores?.[0]?.hours||[]).find(h=>h.weekday===weekday)||{weekday,isClosed:true,openTime:'09:00',closeTime:'18:00'})
  const acceptance=structuredClone(current.bookingAcceptance||current.stores?.[0]?.bookingAcceptance||{mode:'finish_by_close',weekly:{},special:{}})
  host.innerHTML='<h3>每周营业及接客时段</h3><label class="intake-field"><span>预约规则</span><select data-acceptance><option value="finish_by_close">营业 / 班次结束前完成</option><option value="latest_start">最晚开始前接客，服务可延长至次日</option></select></label><p>已有班次和预约不自动修改。最晚开始留空跟随当天营业结束；特殊日期优先。</p>'+values.map(v=>`<div class="intake-grid" data-day="${v.weekday}">${field('周'+'日一二三四五六'[v.weekday]+'休息','isClosed',v.isClosed,'checkbox')}${field('开始时间','openTime',v.openTime,'time')}${field('结束时间','closeTime',v.closeTime,'time')}${field('最晚开始（可留空）','latestStartTime',acceptance.weekly[v.weekday]||'','time')}</div>`).join('')
  host.querySelector('[data-acceptance]').value=acceptance.mode
  const updateVisibility=()=>{host.querySelectorAll('[data-key=latestStartTime]').forEach(e=>e.closest('label').hidden=host.querySelector('[data-acceptance]').value!=='latest_start')};host.querySelector('[data-acceptance]').onchange=()=>{updateVisibility();onChange()};updateVisibility()
  read=()=>({hours:[...host.querySelectorAll('[data-day]')].map(row=>({weekday:Number(row.dataset.day),isClosed:row.querySelector('[data-key=isClosed]').checked,openTime:row.querySelector('[data-key=openTime]').value,closeTime:row.querySelector('[data-key=closeTime]').value})),bookingAcceptance:{...acceptance,mode:host.querySelector('[data-acceptance]').value,weekly:Object.fromEntries([...host.querySelectorAll('[data-day]')].map(row=>[row.dataset.day,row.querySelector('[data-key=latestStartTime]').value||null]))}})
 }
 if(module==='notifications'){
  values=current.rules||[]
  host.innerHTML='<p>这里只设置通知规则。已生成的通知记录保持原样；外部送达仍需要对应通道接入。</p><div class="setup-notifications"><nav aria-label="通知规则">'+values.map((r,i)=>`<button type="button" data-notify-select="${i}" aria-current="${i===0}">${esc(r.label)}</button>`).join('')+'</nav><div>'+values.map((r,i)=>`<section class="intake-card" data-rule="${i}" ${i?'hidden':''}><h3>${esc(r.label)}</h3><div class="intake-grid">${field('开启','enabled',r.enabled,'checkbox')}${[['offsetMinutes','提前分钟'],['advanceDays','提前天数'],['revisitDays','回访间隔天数']].filter(([k])=>r[k]!=null).map(([k,l])=>field(l,k,r[k],'number')).join('')}<label class="intake-field wide"><span>通知文案</span><textarea data-key="templateText" maxlength="300">${esc(r.templateText)}</textarea><small>可用变量：${r.vars.map(v=>esc('{'+v+'}')).join('、')}</small></label></div></section>`).join('')+'</div></div>'
  host.querySelectorAll('[data-notify-select]').forEach(b=>b.onclick=e=>{e.stopPropagation();host.querySelectorAll('[data-rule]').forEach(row=>row.hidden=row.dataset.rule!==b.dataset.notifySelect);host.querySelectorAll('[data-notify-select]').forEach(x=>x.setAttribute('aria-current',String(x===b)))})
  read=()=>({rules:[...host.querySelectorAll('[data-rule]')].map(row=>{const r=values[+row.dataset.rule],next={type:r.type};row.querySelectorAll('[data-key]').forEach(el=>next[el.dataset.key]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value);return next})})
 }
 if(module==='membership'){
  values=structuredClone(current.config.tiers||current.storedConfig?.tiers||[])
  let perks=(current.config.memberPerks||[]).join('\n')
  const draw=()=>{host.innerHTML='<h3>等级与权益</h3><p>停用分级会隐藏等级展示，保留原等级资料。这里不修改会员本人折扣。</p>'+values.map((t,i)=>`<article class="intake-card" data-tier="${i}"><div class="intake-grid">${field('等级显示名称','label',t.label)}${field('累计消费门槛','threshold',t._threshold??(t.minSpendCents||0)/100)}${field('该等级免定金','depositWaived',!!t.depositWaived,'checkbox')}</div><button type="button" data-remove-tier="${i}">从草稿移除这个等级</button></article>`).join('')+'<button type="button" data-add-tier>新增等级</button><label class="intake-field"><span>不分级会员的权益说明（每行一项，最多10项）</span><textarea data-perks>'+esc(perks)+'</textarea></label>'
   host.querySelector('[data-perks]').oninput=e=>{perks=e.target.value;onChange()}
   host.querySelectorAll('[data-tier] [data-key]').forEach(el=>el.oninput=()=>{const t=values[+el.closest('[data-tier]').dataset.tier];if(el.dataset.key==='threshold')t._threshold=el.value;else t[el.dataset.key]=el.type==='checkbox'?el.checked:el.value;onChange()})
   host.querySelector('[data-add-tier]').onclick=()=>{if(values.length>=20)return;values.push({key:'tier_'+Date.now()+'_'+values.length,label:'',minSpendCents:0,depositWaived:false});onChange();draw()}
   host.querySelectorAll('[data-remove-tier]').forEach(b=>b.onclick=()=>{values.splice(+b.dataset.removeTier,1);onChange();draw()})
  };draw();const originalTiers=JSON.stringify(values),originalPerks=perks
  read=()=>({...JSON.stringify(values)!==originalTiers?{tiers:values.map(({_threshold,...t})=>({...t,..._threshold!==undefined?{minSpendCents:win.MemberPricingSettings.cents(_threshold,true)}:{}}))}:{},...perks!==originalPerks?{memberPerks:perks.split('\n').map(v=>v.trim()).filter(Boolean)}:{}})
 }
 if(module==='deposit'){
  const cp=current.config.cancelPolicy
  const fields=[['refundable','允许取消退回','checkbox'],['freeCancelHours','免费取消提前小时','number'],['lateForfeitPct','逾时取消扣除比例（%）','number'],['noShowForfeitPct','未到店扣除比例（%）','number'],['lateArrivalGraceMin','迟到宽限分钟','number'],['rescheduleNoticeHours','改期提前小时','number'],['depositRetainTimes','允许保留定金次数','number']]
  host.innerHTML='<h3>取消与改期规则</h3><div class="intake-grid">'+fields.map(([k,l,t])=>field(l,k,cp[k]??'',t)).join('')+'</div>'
  read=()=>({cancelPolicy:Object.fromEntries(fields.map(([k,l,t])=>{const el=host.querySelector(`[data-key="${k}"]`);return [k,t==='checkbox'?el.checked:el.value===''?null:Number(el.value)]}))})
 }
 if(['guide','hero'].includes(module)){
  values=structuredClone(module==='guide'?current.config.steps:current.slides)
  const draw=()=>{
   host.innerHTML=`<p>最多6张。上传照片后可调整顺序；保存草稿不会立即展示给顾客。</p><div role="status"></div>`+values.map((v,i)=>`<article class="intake-card" data-image="${i}"><img src="${esc(v.image)}" alt="第${i+1}张图片" style="max-width:100%;max-height:220px;object-fit:contain;border-radius:8px"><div class="intake-grid">${module==='guide'?field('步骤说明（50字以内）','description',v.description):field('中文文案（40字以内）','labelZh',v.labelZh)+field('英文文案（40字以内）','labelEn',v.labelEn)+field('启用这张照片','isActive',v.isActive,'checkbox')}</div><div class="action-row"><button type="button" data-up="${i}" ${i===0?'disabled':''}>上移</button><button type="button" data-down="${i}" ${i===values.length-1?'disabled':''}>下移</button><button type="button" data-remove="${i}">从草稿移除</button></div></article>`).join('')+`<label class="upload-label">添加照片<input type="file" accept="image/jpeg,image/png,image/webp" multiple ${values.length>=6?'disabled':''}></label>`
   host.querySelectorAll('[data-key]').forEach(el=>el.oninput=()=>{const row=values[+el.closest('[data-image]').dataset.image];row[el.dataset.key]=el.type==='checkbox'?el.checked:el.value;onChange()})
   host.querySelectorAll('button').forEach(btn=>btn.onclick=()=>{if(busy)return;const i=Number(btn.dataset.up??btn.dataset.down??btn.dataset.remove);if(btn.hasAttribute('data-remove'))values.splice(i,1);else{const j=i+(btn.hasAttribute('data-up')?-1:1);[values[i],values[j]]=[values[j],values[i]]}onChange();draw()})
   host.querySelector('input[type=file]').onchange=async e=>{busy++;try{for(const f of e.target.files){if(values.length>=6)throw Error('最多6张；已选图片保留在草稿。');const image=await win.ImageFraming.read(f,{maxChars:module==='guide'?1300000:1900000});values.push(module==='guide'?{image,description:''}:{image,labelZh:'',labelEn:'',isActive:true});onChange()}draw()}catch(err){host.querySelector('[role=status]').textContent=err.message}finally{busy--}}
  };draw();read=()=>{if(busy)throw Error('图片仍在读取，请稍后保存。');return module==='guide'?{steps:values,revision:current.config.revision}:{slides:values}}
 }
 initial=JSON.stringify(read());host.addEventListener('input',onChange)
 return {read(){const value=read();return JSON.stringify(value)===initial?{}:value}}
}
