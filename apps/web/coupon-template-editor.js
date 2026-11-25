async function saveCoupon(existing) {
  const categories=(await request('/admin/pricing/categories')).categories||[]
  const gifts=await request('/admin/gift-entitlements/config')
  const issued=Boolean(existing?.issuedQty)
  const legacyFullDiscount=existing?.percentOff===100
  let couponWheel
  // Original modal, now also includes the actual category scope.
  openFormModal({
    title: existing ? '编辑优惠券' : '新建优惠券',
    hint:issued?'已有顾客持券。另存为新模板可保留原券权益；原模板不支持变更已发券的适用范围。':'保存模板不会自动发券。',
    fields: [
      ...(issued?[{key:'copyTemplate',label:'另存为新模板',type:'checkbox',value:true}]:[]),
      ...(gifts.enabled?[{key:'recipientMode',label:'使用对象',type:'select',value:existing?.recipientMode||'any',options:[['any','按本券适用规则'],['friend_original','好友同行 · 朋友整单原价打折']]}]:[]),
      ...categories.map(c=>({key:'scope_'+c.id,label:'适用大类 · '+c.name,type:'checkbox',value:existing?.scopeCategoryIds?.includes(c.id)||false,...(!gifts.enabled?{hint:'全部不选时适用全部大类'}:{})})),
      { key: 'name', label: '券名称', type: 'text', value: existing ? existing.name : '', placeholder: '如 满200减30' },
      { key: 'discountType', label: '类型', type: 'select', value: existing ? existing.discountType : 'amount', options: [['amount', '满减券(减固定金额)'], ['percent', '折扣券(立减百分比)']] },
      { key: 'amount', label: '面额(满减券用)', type: 'number', value: existing && existing.discountType !== 'percent' ? existing.amountCents / 100 : '' },
      { key: 'percent', label: '立减 %(折扣券用，15 即八五折)', type: 'number', value: existing && existing.discountType === 'percent' ? existing.percentOff : 15 },
      { key: 'minSpend', label: '使用门槛(0=无门槛)', type: 'number', value: existing ? existing.minSpendCents / 100 : 0 },
      { key: 'validDays', label: '有效天数', type: 'number', value: existing ? existing.validDays : 30 },
      { key: 'totalQty', label: '发放总量(0=不限量)', type: 'number', value: existing && existing.totalQty ? existing.totalQty : 0 }
    ],
    mountContent:overlay=>{
      if(!gifts.enabled)return
      const panel=overlay.querySelector('.form-modal-panel'),grid=panel.querySelector('.kb-facts-grid'),field=k=>overlay.querySelector('[data-fm-field="'+k+'"]')
      panel.classList.add('gift-coupon-panel')
      const layout=document.createElement('div');layout.className='gift-coupon-layout';grid.before(layout);layout.append(grid)
      const preview=document.createElement('aside');preview.className='gift-coupon-preview';layout.append(preview)
      const scopeHint=document.createElement('p');scopeHint.className='subtle gift-coupon-scope-hint';scopeHint.textContent='适用大类全部不选时，适用全部服务。';grid.append(scopeHint)
      const host=document.createElement('div');host.className='gift-coupon-wheel';overlay.querySelector('[data-fm-wrap="percent"]').after(host)
      couponWheel=window.DiscountWheel.mount(host,{value:10000-Number(field('percent').value)*100,onChange:rate=>{field('percent').value=100-rate/100;render()}})
      host.querySelector('.mp-wheel-field>span').textContent='优惠券折扣'
      host.querySelector('dialog').setAttribute('aria-label','选择优惠券折扣');host.querySelector('h3').textContent='选择优惠券折扣'
      function render(){
        const friend=field('recipientMode').value==='friend_original',percent=field('discountType').value==='percent',off=Number(field('percent').value)||0
        field('discountType').disabled=friend
        scopeHint.hidden=friend
        for(const c of categories){const el=field('scope_'+c.id);el.disabled=friend;overlay.querySelector('[data-fm-wrap="scope_'+c.id+'"]').style.display=friend?'none':'contents'}
        overlay.querySelector('[data-fm-wrap="amount"]').style.display=percent?'none':'contents'
        overlay.querySelector('[data-fm-wrap="percent"]').style.display=percent&&legacyFullDiscount?'contents':'none'
        host.hidden=!percent||legacyFullDiscount
        const rate=((100-off)/10).toFixed(1),name=escapeHtml(field('name').value||'优惠券')
        preview.innerHTML='<h3>顾客将看到</h3><strong>'+name+'</strong><p>'+(percent?rate+'折':'优惠 '+escapeHtml(field('amount').value||'0'))+'</p><p>'+(friend?'朋友整单收费服务按原价打折，不叠加会员折扣；持券人本人的折扣不受影响。':'按所选服务范围和使用门槛核销。')+'</p>'+(friend?'<h3>结算示例</h3><p>朋友原价合计 '+escapeHtml(mMoney(50000))+'</p><p>本券优惠 −'+escapeHtml(mMoney(Math.round(50000*off/100)))+'</p><strong>朋友应付 '+escapeHtml(mMoney(Math.round(50000*(100-off)/100)))+'</strong>':'')+'<p>有效期 '+escapeHtml(field('validDays').value||'30')+' 天 · 保存模板不会自动发券。</p>'
      }
      field('recipientMode').addEventListener('change',()=>{if(field('recipientMode').value==='friend_original'){field('discountType').value='percent';for(const c of categories)field('scope_'+c.id).checked=false}render()})
      overlay.addEventListener('input',render);overlay.addEventListener('change',render);render()
    },
    onSave: async (v) => {
      if (!String(v.name || '').trim()) { toast('券名称必填'); return false }
      const body = { scopeCategoryIds:categories.filter(c=>v['scope_'+c.id]).map(c=>c.id),name: String(v.name).trim(), discountType: v.discountType === 'percent' ? 'percent' : 'amount', minSpendCents: mCents(v.minSpend || 0), validDays: Math.round(Number(v.validDays) || 30), totalQty: Math.round(Number(v.totalQty) || 0) }
      if(gifts.enabled)body.recipientMode=v.recipientMode||'any'
      if(body.recipientMode==='friend_original'&&(body.discountType!=='percent'||body.scopeCategoryIds.length)){toast('好友同行券请选择折扣券，适用大类全部不选（整单服务适用）');return false}
      if (body.discountType === 'amount') body.amountCents = mCents(v.amount)
      else { body.percentOff = Math.round(Number(v.percent) || 0);if(body.percentOff<1||body.percentOff>100){toast('请选择有效折扣，优惠券不能设为无折扣');return false} }
      if (existing&&!v.copyTemplate) await request(`/admin/coupons/${existing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      else await request('/admin/coupons', { method: 'POST', body: JSON.stringify(body) })
      toast('已保存')
      await loadMembershipPage()
    }
  })
}
