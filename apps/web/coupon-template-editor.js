async function saveCoupon(existing) {
  const categories=(await request('/admin/pricing/categories')).categories||[]
  const issued=Boolean(existing?.issuedQty)
  // Original modal, now also includes the actual category scope.
  openFormModal({
    title: existing ? '编辑优惠券' : '新建优惠券',
    hint:issued?'已有顾客持券。另存为新模板可保留原券权益；原模板不支持变更已发券的适用范围。':'保存模板不会自动发券。',
    fields: [
      ...(issued?[{key:'copyTemplate',label:'另存为新模板',type:'checkbox',value:true}]:[]),
      ...categories.map(c=>({key:'scope_'+c.id,label:'适用大类 · '+c.name,type:'checkbox',value:existing?.scopeCategoryIds?.includes(c.id)||false,hint:'全部不选时适用全部大类'})),
      { key: 'name', label: '券名称', type: 'text', value: existing ? existing.name : '', placeholder: '如 满200减30' },
      { key: 'discountType', label: '类型', type: 'select', value: existing ? existing.discountType : 'amount', options: [['amount', '满减券(减固定金额)'], ['percent', '折扣券(立减百分比)']] },
      { key: 'amount', label: '面额(满减券用)', type: 'number', value: existing && existing.discountType !== 'percent' ? existing.amountCents / 100 : '' },
      { key: 'percent', label: '立减 %(折扣券用)', type: 'number', value: existing && existing.discountType === 'percent' ? existing.percentOff : '' },
      { key: 'minSpend', label: '使用门槛(0=无门槛)', type: 'number', value: existing ? existing.minSpendCents / 100 : 0 },
      { key: 'validDays', label: '有效天数', type: 'number', value: existing ? existing.validDays : 30 },
      { key: 'totalQty', label: '发放总量(0=不限量)', type: 'number', value: existing && existing.totalQty ? existing.totalQty : 0 }
    ],
    onSave: async (v) => {
      if (!String(v.name || '').trim()) { toast('券名称必填'); return false }
      const body = { scopeCategoryIds:categories.filter(c=>v['scope_'+c.id]).map(c=>c.id),name: String(v.name).trim(), discountType: v.discountType === 'percent' ? 'percent' : 'amount', minSpendCents: mCents(v.minSpend || 0), validDays: Math.round(Number(v.validDays) || 30), totalQty: Math.round(Number(v.totalQty) || 0) }
      if (body.discountType === 'amount') body.amountCents = mCents(v.amount)
      else body.percentOff = Math.round(Number(v.percent) || 0)
      if (existing&&!v.copyTemplate) await request(`/admin/coupons/${existing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      else await request('/admin/coupons', { method: 'POST', body: JSON.stringify(body) })
      toast('已保存')
      await loadMembershipPage()
    }
  })
}
