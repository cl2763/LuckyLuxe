/* Approved package gift rows. Call mount() inside the existing package form. */
const LegacyGiftEditor = (() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
  function mount(container, initial = [], currency = '') {
    const section = document.createElement('section')
    section.className = 'gift-editor'
    section.innerHTML = `<style>.gift-editor{margin:18px 0;min-width:0}.gift-editor-row{display:grid;grid-template-columns:minmax(80px,1fr) 62px 100px 30px;gap:8px;align-items:center;margin:10px 0}.gift-editor-row input{min-width:0;width:100%;padding:10px 8px}.gift-editor-row button{padding:6px;width:30px}.gift-editor .gift-head{font-size:12px;color:var(--muted)}.gift-editor h3{margin:0}.gift-editor .subtle{line-height:1.6}@media(max-width:480px){.gift-editor-row{grid-template-columns:minmax(72px,1fr) 48px 76px 26px;gap:5px}}</style><h3>赠送物品 <small class="subtle">选填，可多件</small></h3><div class="gift-editor-row gift-head"><span>物品名称</span><span>数量</span><span>参考价值（选填） ${esc(currency)}</span><span></span></div><div data-gift-rows></div><button type="button" class="ghost slim" data-gift-add>＋ 再加一行</button><p class="subtle">价值用于展示，不计入顾客储值余额、营业收入或技师业绩。物品领取请联系门店，此清单不代表已领取。</p>`
    const rows = section.querySelector('[data-gift-rows]')
    function add(g = {}) {
      if (rows.children.length >= 20) return
      const row = document.createElement('div'); row.className = 'gift-editor-row'
      row.innerHTML = `<input data-gift-name aria-label="赠品名称" maxlength="80" placeholder="物品名称" value="${esc(g.name || '')}"><input data-gift-quantity aria-label="赠品数量" type="number" min="1" max="999" step="1" value="${esc(g.quantity ?? 1)}"><input data-gift-value data-money data-money-strict aria-label="赠品单件价值" type="text" inputmode="decimal" autocomplete="off" placeholder="价值" value="${g.unitValueCents == null ? '' : esc(g.unitValueCents / 100)}"><button class="ghost" type="button" data-gift-remove aria-label="删除赠品">×</button>`
      rows.appendChild(row); section.querySelector('[data-gift-add]').disabled = rows.children.length >= 20
    }
    initial.forEach(add)
    section.addEventListener('click', (e) => {
      if (e.target.closest('[data-gift-add]')) { add(); rows.lastElementChild?.querySelector('input').focus() }
      if (e.target.closest('[data-gift-remove]')) { e.target.closest('.gift-editor-row').remove(); section.querySelector('[data-gift-add]').disabled = false }
    })
    container.appendChild(section)
    return { read() { return [...rows.children].map((row, i) => {
      const name = row.querySelector('[data-gift-name]').value.trim(), q = row.querySelector('[data-gift-quantity]').value.trim(), v = row.querySelector('[data-gift-value]').value.trim()
      if (!name || name.length > 80) throw new Error(`第 ${i + 1} 行请填写 1–80 字物品名称`)
      if (!/^\d+$/.test(q) || +q < 1 || +q > 999) throw new Error(`第 ${i + 1} 行数量须为 1–999 的整数`)
      if (v && (!/^\d+(\.\d{1,2})?$/.test(v) || +v > 1000000)) throw new Error(`第 ${i + 1} 行请填写非负单件价值（最多两位小数）`)
      return { name, quantity: Number(q), unitValueCents: v ? Math.round(Number(v) * 100) : null }
    }) }, element: section }
  }
  return { mount }
})()

/* Same editor in merchant and platform forms; legacy descriptions stay descriptive until explicitly classified. */
window.GiftEditor=(()=>{
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
 const labels={physical:'实物领取',coupon:'优惠券',service_voucher:'服务兑换券',service_timecard:'服务次卡'}
 function mount(container,initial=[],currency='',config={}){
  if(!config.enabled)return LegacyGiftEditor.mount(container,initial,currency)
  const items=initial.map(g=>({...g}));let editIndex=null,dirty=false
  const section=document.createElement('section');section.className='gift-editor gift-classified'
  section.innerHTML=`<style>
.gift-classified{margin:24px 0;min-width:0}.gift-classified *{box-sizing:border-box}.gift-classified .gift-workspace{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(280px,1fr);gap:24px}.gift-classified .gift-list-item,.gift-classified .gift-form{padding:20px;border:1px solid var(--line);border-radius:16px;background:var(--paper)}.gift-classified .gift-list-item{margin:12px 0}.gift-classified .gift-list-item p{margin:8px 0}.gift-classified .gift-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.gift-classified label{display:flex;flex-direction:column;gap:8px;min-width:0}.gift-classified input,.gift-classified select{min-width:0;width:100%;padding:12px}.gift-classified header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:16px}.gift-classified h3{margin:0}.gift-classified p{line-height:1.6}.gift-classified .gift-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}.gift-classified .gift-types{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}.gift-classified [hidden]{display:none}.gift-classified .gift-status{color:var(--bad);min-height:1.5em}.gift-package-panel.form-modal-panel{width:min(1120px,calc(100vw - 32px));max-width:1120px}.gift-package-panel>.kb-facts-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.gift-package-panel .gift-discount{margin:16px 0;padding:16px 0;border-bottom:1px solid var(--line)}@media(max-width:760px){.gift-classified .gift-workspace{grid-template-columns:1fr}.gift-package-panel.form-modal-panel{width:calc(100vw - 24px)}.gift-package-panel>.kb-facts-grid{grid-template-columns:1fr}}@media(max-width:480px){.gift-classified .gift-fields{grid-template-columns:1fr}.gift-classified .gift-form,.gift-classified .gift-list-item{padding:16px}}
</style><h3>赠送权益 <small class="subtle">选填，可混合添加</small></h3><p class="subtle">赠送卡金在上方填写。参考价值选填，不计入余额、收入或技师业绩。</p><div class="gift-types">${Object.entries(labels).map(([k,l])=>`<button type="button" class="ghost slim" data-gift-type="${k}">＋ ${l}</button>`).join('')}</div><div class="gift-workspace"><div><div data-gift-rows></div><p class="subtle">充值生效后发放；实物交付由商家登记，服务权益在签署服务单时核销。</p></div><div class="gift-form"><header><h3 data-editor-title>添加赠送权益</h3></header><div class="gift-fields"><label>权益类别<select data-gift-kind>${Object.entries(labels).map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}</select></label><label>展示名称<input data-gift-name aria-label="赠品名称" maxlength="80" placeholder="例如：护手霜一支"></label><label data-reference-field>对应服务或券模板<select data-gift-reference></select></label><label>数量 / 次数<input data-gift-quantity aria-label="赠品数量" type="number" min="1" max="999" step="1" value="1"></label><label>单件参考价值 ${esc(currency)}（选填）<input data-gift-value aria-label="赠品单件价值" inputmode="decimal" data-money data-money-strict placeholder="不明确可留空"></label><label>有效天数（选填）<input data-gift-days inputmode="numeric" placeholder="实物/服务留空长期；券沿用模板"></label></div><p class="subtle" data-gift-hint></p><p class="gift-status" data-gift-error role="alert"></p><div class="gift-actions"><button type="button" class="ghost slim" data-gift-cancel>取消编辑</button><button type="button" class="primary slim" data-gift-commit>加入套餐</button></div></div></div>`
  const field=k=>section.querySelector('[data-gift-'+k+']'),rows=field('rows')
  function render(){rows.innerHTML=items.length?items.map((g,i)=>`<article class="gift-list-item"><strong>${esc(g.name)} × ${g.quantity}</strong><p class="subtle">${esc(labels[g.kind]||'原有赠品说明（尚未分类）')} · ${g.validDays?esc(g.validDays)+' 天有效':g.kind==='coupon'?'有效期沿用券模板':'长期有效'}${g.unitValueCents==null?'':' · 单件参考价值 '+esc(currency)+' '+(g.unitValueCents/100).toFixed(2)}</p><div class="gift-actions"><button type="button" class="ghost slim" data-gift-edit="${i}">编辑</button><button type="button" class="ghost slim" data-gift-remove="${i}">移除</button></div></article>`).join(''):'<p class="empty-state">尚未添加赠送权益</p>'}
  function updateReference(selected=''){
   const k=field('kind').value,list=k==='coupon'?(config.coupons||[]):(config.services||[])
   section.querySelector('[data-reference-field]').hidden=k==='physical'
   field('reference').innerHTML='<option value="">请选择</option>'+list.map(v=>`<option value="${esc(v.id)}">${esc(v.name||v.nameZh||v.name_zh)}</option>`).join('');field('reference').value=selected
   field('hint').textContent=k==='physical'?'商家实际交付后，在客户档案登记领取；支持分次领取，顾客无需扫码或签字。':k==='coupon'?'充值生效后发到卡主券包；结算选择适用单据，签署成功后核销。':'仅可兑换指定服务，签署成功后扣减；不产生现金余额。'
  }
  function reset(g={},index=null){editIndex=index;field('kind').value=g.kind||'physical';field('name').value=g.name||'';field('quantity').value=g.quantity??1;field('value').value=g.unitValueCents==null?'':g.unitValueCents/100;field('days').value=g.validDays??'';updateReference(g.couponId||g.serviceId||'');section.querySelector('[data-editor-title]').textContent=index===null?'添加赠送权益':'编辑赠送权益';field('commit').textContent=index===null?'加入套餐':'保存本项';field('error').textContent='';dirty=false}
  function commit(){
   const value=k=>field(k).value.trim(),name=value('name'),q=value('quantity'),v=value('value'),days=value('days'),kind=value('kind')
   if(!name||name.length>80)throw Error('权益名称必填，最多80字')
   if(!/^\d+$/.test(q)||+q<1||+q>999)throw Error('数量须为1至999整数')
   if(v&&(!/^\d+(\.\d{1,2})?$/.test(v)||+v>1000000))throw Error('参考价值须为非负金额，最多两位小数')
   if(days&&(!/^\d+$/.test(days)||+days<1||+days>3650))throw Error('有效期须为1至3650天')
   const out={name,quantity:+q,unitValueCents:v?Math.round(+v*100):null,kind,validDays:days?+days:null}
   if(kind!=='physical'){const ref=value('reference');if(!ref)throw Error('请选择对应服务或优惠券');out[kind==='coupon'?'couponId':'serviceId']=ref}
   if(editIndex===null){if(items.length>=20)throw Error('最多添加20项赠送权益');items.push(out)}else items[editIndex]=out
   reset();render()
  }
  section.querySelector('.gift-form').addEventListener('input',()=>{dirty=true})
  section.querySelector('.gift-form').addEventListener('change',()=>{dirty=true})
  field('kind').onchange=()=>updateReference()
  field('reference').onchange=()=>{if(!field('name').value.trim()&&field('reference').value)field('name').value=field('reference').selectedOptions[0].textContent}
  section.addEventListener('click',e=>{
   const button=e.target.closest('button');if(!button)return
   try{
    if(button.hasAttribute('data-gift-commit'))commit()
    if(button.hasAttribute('data-gift-cancel'))reset()
    if(button.hasAttribute('data-gift-remove')){const i=+button.dataset.giftRemove;if(editIndex===i)reset();else if(editIndex!==null&&editIndex>i)editIndex--;items.splice(i,1);render()}
    if(button.hasAttribute('data-gift-edit')||button.hasAttribute('data-gift-type')){
     if(dirty)throw Error('请先将当前权益加入套餐，或取消编辑，再切换')
     if(button.hasAttribute('data-gift-edit')){const i=+button.dataset.giftEdit;reset(items[i],i)}else{reset({kind:button.dataset.giftType});dirty=true}
     field('name').focus()
    }
   }catch(error){field('error').textContent=error.message}
  })
  reset();render();container.append(section)
  return {element:section,read(){if(dirty||editIndex!==null)throw Error('还有未加入套餐的权益，请先点击「加入套餐 / 保存本项」，或取消编辑');return items.map(g=>({...g}))}}
 }
 return {mount}
})()
