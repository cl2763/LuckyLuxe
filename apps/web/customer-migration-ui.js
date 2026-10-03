// Customer profile and reviewed migration flows. Loaded before admin.js; state is read when invoked.
async function saveCustomerProfile(customerId) {
  const zh = owner.lang === 'zh'
  const payload = {
    tags: (document.querySelector('#customerTagsInput')?.value || '').split(/[,，、]/).map((tag) => tag.trim()).filter(Boolean),
    notes: document.querySelector('#customerNotesInput')?.value || '',
    birthday: (document.querySelector('#customerBirthdayInput')?.value || '').trim()
  }
  const result = await request(`/admin/customers/${customerId}/profile`, { method: 'PATCH', body: JSON.stringify(payload) })
  const customer = owner.customers.find((item) => item.id === customerId)
  if (customer) Object.assign(customer, result.customer)
  toast(zh ? '运营信息已保存' : 'Saved')
  renderCustomers()
}

async function loadMigrationArchive(customerId, page=0) {
  const box=document.querySelector('#migrationArchiveBody')
  if(!box)return
  box.textContent='正在读取历史资料…'
  try {
    const data=await request(`/admin/customers/${encodeURIComponent(customerId)}/migration-archive?page=${page}`)
    if(owner.selectedCustomerId!==customerId || !box.isConnected)return
    const detail=(title,value)=>`<details><summary>${escapeHtml(title)}</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(JSON.stringify(value,null,2))}</pre></details>`
    box.innerHTML=`${data.pendingBalances.map(b=>`<p>${b.status==='pending'?'待核对旧余额':'原余额快照'} <strong>${money(b.amountCents,2)}</strong> · 数据截止 ${escapeHtml(b.cutoff)}<br><span class="subtle">${b.status==='pending'?'尚未启用，不计入当前可用余额。':b.status==='active'?'已确认启用；当前余额以账户流水为准。':b.status==='allocated'?'已分配为次数卡，未增加储值余额。':'已核对为耗尽。'}</span><br><button type="button" data-migration-balance="${escapeHtml(b.id)}">${b.status==='pending'?'核对旧余额':'查看启用回执'}</button><button type="button" data-migration-reconcile="${escapeHtml(b.id)}">分卡对平预览</button></p>`).join('')}
      ${data.records.map(a=>detail('原系统资料 · '+a.sourceRecordId,a.source)).join('')}
      ${data.transactions.map(a=>detail((a.date||'日期未知')+' · '+(a.summary||'历史消费'),a.details)).join('')}
      ${data.assets.map(a=>detail((a.kind==='gift'?'旧赠品':'旧资产')+' · '+(a.title||'未命名')+'（原始资料）',a.details)+(a.kind==='gift'?`<button type="button" data-migration-gift="${escapeHtml(a.id)}">核对／领取实物赠品</button><button type="button" data-migration-service="${escapeHtml(a.id)}">核对服务赠卡</button>`:'')).join('')}
      ${!data.records.length&&!data.transactions.length&&!data.assets.length&&!data.pendingBalances.length?'<p class="subtle">暂无导入的历史资料。</p>':''}
      <p class="subtle">历史资料只读，不等于已启用权益。服务小记仍在内部小记区域；小记图片本期暂未迁入。</p>
      <div class="button-row">${page?`<button data-migration-page="${page-1}" type="button">上一页</button>`:''}${data.hasMore?`<button data-migration-page="${page+1}" type="button">下一页</button>`:''}</div>`
  }catch(e){if(box.isConnected)box.textContent=e.message||'读取失败，请重新打开档案。'}
}
async function reviewMigrationService(assetId) {
  const userId=owner.selectedCustomerId,tenantId=owner.auth?.admin?.tenantId
  const base=`/admin/customers/${encodeURIComponent(userId)}/migration-gifts/${encodeURIComponent(assetId)}`
  const [info,catalog]=await Promise.all([request(base),request('/admin/pricing/items')])
  if(owner.selectedCustomerId!==userId||owner.auth?.admin?.tenantId!==tenantId)return
  if(info.grant){toast(info.grant.kind==='service'?`已启用，剩余 ${info.grant.remaining} 次。核销去服务结算，退回关联原单。`:'此来源已启用为实物，不能重复转成服务卡。');return}
  let attempt=null
  openFormModal({title:'核对旧服务赠卡',hint:'仅承接独立赠送、无现金余额、一次服务扣一次的赠卡。付费次卡及混合规则保持待核对。参考价值不转成现金；启用后从服务结算选卡核销。',fields:[
    {key:'title',label:'赠卡名称',value:info.sourceTitle||''},
    {key:'serviceId',type:'select',label:'仅限以下具体服务',options:[['','请选择服务'],...(catalog.items||[]).filter(i=>i.isActive!==false&&(i.itemKind||'main')==='main').map(i=>[i.id,i.nameZh||i.name])]},
    {key:'quantity',label:'核对后剩余次数（整数，耗尽填 0）'},
    {key:'unitValue',label:'单次参考价值（本店币种，不是可退本金）'},
    {key:'expiresOn',type:'date',label:'到期日期'},
    {key:'noExpiry',type:'checkbox',label:'原权益明确无期限'},
    {key:'serviceGiftConfirmed',type:'checkbox',label:'确认这是独立赠送的服务权益'},
    {key:'noCashBalance',type:'checkbox',label:'不包含付费本金或储值余额，未在其他权益重复启用'},
    {key:'oneUsePerService',type:'checkbox',label:'每次指定服务扣一次，无其他未承接限制'},
    {key:'rulesConfirmed',type:'checkbox',label:'项目、剩余次数、期限和原规则已核对'},
    {key:'sourceUseStopped',type:'checkbox',label:'已核对截止后的使用，原系统不再重复核销'},
    {key:'reason',label:'核对依据及次数差异原因（必填）'}
  ],saveText:'确认启用，不立即核销',onSave:async values=>{
    if(owner.selectedCustomerId!==userId||owner.auth?.admin?.tenantId!==tenantId)throw new Error('门店或顾客已变化，请重新进入。')
    if(!/^\d+$/.test(values.quantity))throw new Error('次数须为整数。')
    const payload={...values,quantity:Number(values.quantity),unitValueCents:values.unitValue.trim()?MoneyInput.strictCentsOf(values.unitValue):null,confirmVersion:info.version}
    delete payload.unitValue
    const fingerprint=JSON.stringify(payload)
    if(!attempt||attempt.fingerprint!==fingerprint)attempt={fingerprint,body:{...payload,requestId:crypto.randomUUID()}}
    await request(base+'/activate-service',{method:'POST',body:JSON.stringify(attempt.body)})
    toast('服务赠卡已启用，未核销。请在服务结算中选择。');loadMigrationArchive(userId)
  }})
}
async function reviewMigrationGift(assetId) {
  const userId=owner.selectedCustomerId,tenantId=owner.auth?.admin?.tenantId
  const base=`/admin/customers/${encodeURIComponent(userId)}/migration-gifts/${encodeURIComponent(assetId)}`
  const info=await request(base)
  if(owner.selectedCustomerId!==userId||owner.auth?.admin?.tenantId!==tenantId)return
  if(info.grant?.kind==='service'){toast(`已启用为服务赠卡，剩余 ${info.grant.remaining} 次，请在服务结算中选卡核销；退回关联原服务单。`);return}
  const grant=info.grant,returns=info.events.filter(e=>e.kind==='claim'&&e.returnable>0)
  let attempt=null
  const fields=grant?[
    {key:'operation',type:'select',label:'操作',value:'claim',options:[['claim','顾客领取'],...(returns.length?[['return','退回实物，恢复原权益']]:[])]},
    {key:'quantity',label:'本次数量（整数件）',value:'1'},
    {key:'claimId',type:'select',label:'原领取记录',showIf:v=>v.operation==='return',options:returns.map(e=>[e.id,`${e.created_at} · 领取 ${-e.delta} 件 · 尚可退 ${e.returnable} 件`])},
    {key:'reason',label:'顾客收货确认／实物退回依据（必填）'}
  ]:[
    {key:'title',label:'商品名称',value:info.sourceTitle||''},
    {key:'specification',label:'规格（例如 10ml）'},
    {key:'quantity',label:'核对后剩余件数（整数，已耗尽填 0）'},
    {key:'unitValue',label:'单件参考价值（按本店币种填写，不转为现金）'},
    {key:'expiresOn',type:'date',label:'有效期至（含当天）'},
    {key:'noExpiry',type:'checkbox',label:'已确认无期限（有到期日期时不要勾选）'},
    {key:'physicalGoodsConfirmed',type:'checkbox',label:'已确认这是实物赠品，不是服务次数、优惠券或余额'},
    {key:'rulesConfirmed',type:'checkbox',label:'已核对名称、规格、剩余件数和领取条件，无其他未承接限制'},
    {key:'sourceUseStopped',type:'checkbox',label:'已核对截止后的领取情况，旧系统不再重复领取'},
    {key:'reason',label:'核对依据／剩余数量变化原因（必填）'}
  ]
  openFormModal({title:grant?'实物赠品领取与退回':'核对旧实物赠品',hint:grant?`${escapeHtml(grant.title)} ${escapeHtml(grant.specification)} · 剩余 ${grant.remaining} 件 · ${grant.expiresOn?'有效期至 '+escapeHtml(grant.expiresOn):'无期限'}${grant.status==='expired'?' · 已到期，不可领取':''}<br>领取和退回都不产生营业收入。退回必须选原领取记录。`:'只承接实物；服务赠卡须通过服务结算核销。原始资料保留，确认启用不等于已领取。',fields,saveText:grant?'确认记录本次操作':'确认启用，不立即领取',onSave:async values=>{
    if(owner.selectedCustomerId!==userId||owner.auth?.admin?.tenantId!==tenantId)throw new Error('门店或顾客已变化，请重新进入。')
    if(!/^\d+$/.test(values.quantity))throw new Error('数量须为整数件。')
    const operation=grant?values.operation:'activate'
    const payload={quantity:Number(values.quantity),reason:values.reason,...(grant?{claimId:values.claimId}:{...values,quantity:Number(values.quantity),unitValueCents:values.unitValue.trim()?MoneyInput.strictCentsOf(values.unitValue):null,confirmVersion:info.version})}
    delete payload.unitValue
    const fingerprint=operation+JSON.stringify(payload)
    if(!attempt||attempt.fingerprint!==fingerprint)attempt={fingerprint,body:{...payload,requestId:crypto.randomUUID()}}
    await request(base+'/'+operation,{method:'POST',body:JSON.stringify(attempt.body)})
    toast(operation==='activate'?'实物权益已启用，未领取':operation==='claim'?'领取已记录':'退回已记录，已恢复原权益')
    if(owner.selectedCustomerId===userId)loadMigrationArchive(userId)
  }})
}
async function previewCardReconciliation(pendingId) {
 const uid=owner.selectedCustomerId,tid=owner.auth?.admin?.tenantId
 const base=`/admin/customers/${encodeURIComponent(uid)}/migration-balances/${encodeURIComponent(pendingId)}/reconciliation`
 const [info,catalog]=await Promise.all([request(base),request('/admin/pricing/items')])
 if(owner.selectedCustomerId!==uid||owner.auth?.admin?.tenantId!==tid)return
 if(!info.cards.length){await UIDialog.alert('此来源没有可核对的分卡资料，请保留原余额待核对。');return}
 const fields=[]
 info.cards.forEach((c,i)=>{
   const k='card'+i+'_',active=v=>v[k+'kind']!=='unresolved',times=v=>v[k+'kind']==='paid_timecard'
   fields.push({key:k+'kind',label:(c.title||'未命名旧卡')+' · 卡项类型',type:'select',value:'unresolved',options:[['unresolved','待核对'],['paid_timecard','付费次数卡'],['stored_value','储值卡']]},
    {key:k+'paid',label:'剩余本金（'+info.currency+'）',showIf:active},
    {key:k+'bonus',label:'剩余赠送金（无则填 0）',showIf:active},
    {key:k+'times',label:'剩余次数（整数）',showIf:times},
    {key:k+'serviceId',label:'指定服务',type:'select',showIf:times,options:[['','请选择'],...(catalog.items||[]).filter(x=>x.isActive!==false&&(x.itemKind||'main')==='main').map(x=>[x.id,x.nameZh||x.name])]},
    {key:k+'expiresOn',label:'到期日期',type:'date',showIf:active},
    {key:k+'noExpiry',label:'明确无期限',type:'checkbox',showIf:active})
 })
 openFormModal({title:'旧卡与总余额对平预览',mountContent:el=>el.querySelector('.form-modal-panel').classList.add('migration-card-review'),hint:`原总额 ${escapeHtml(money(info.snapshotAmountCents,2))}。原卡资料在下方历史档案保留。未知请选“待核对”，不要补成零。${info.alreadyPosted?'已有旧余额入账，分卡不能再加钱。':''}<br>本次仅计算，不保存确认，不启用任何权益。`,fields,saveText:'计算差额（不启用）',onSave:async v=>{
  if(owner.selectedCustomerId!==uid||owner.auth?.admin?.tenantId!==tid)throw new Error('门店或顾客已变化，请重新进入。')
  const cards=info.cards.map((c,i)=>{const k='card'+i+'_',kind=v[k+'kind'];if(kind==='unresolved')return{assetId:c.id,kind}
   if(!v[k+'paid'].trim()||!v[k+'bonus'].trim())throw new Error('本金和赠送金都需明确填写，未知请保持待核对。')
   if(kind==='paid_timecard'&&!/^\d+$/.test(v[k+'times']))throw new Error('剩余次数须为非负整数。')
   return{assetId:c.id,kind,paidCents:MoneyInput.strictCentsOf(v[k+'paid']),bonusCents:MoneyInput.strictCentsOf(v[k+'bonus']),remainingTimes:Number(v[k+'times']),serviceId:v[k+'serviceId'],noExpiry:v[k+'noExpiry'],expiresOn:v[k+'expiresOn']}
  })
  const result=await request(base,{method:'POST',body:JSON.stringify({cards,currency:info.currency,confirmVersion:info.version})})
  if(owner.selectedCustomerId!==uid||owner.auth?.admin?.tenantId!==tid)return
  await UIDialog.alert(`${result.balanced?'金额已对平':'尚未对平'}\n本金 ${money(result.paidCents,2)}，赠送 ${money(result.bonusCents,2)}\n总额减分卡合计：${money(result.differenceCents,2)}\n${result.issues.join('\n')}\n${result.message}`)
  if(owner.selectedCustomerId!==uid||owner.auth?.admin?.tenantId!==tid)return
  const eligible=result.balanced&&!info.alreadyPosted&&cards.length&&cards.every(c=>c.kind==='paid_timecard'&&c.bonusCents===0&&c.remainingTimes>0&&c.paidCents>0&&c.paidCents%c.remainingTimes===0)
  if(!eligible)return false
  let attempt=null
  openFormModal({title:'确认启用迁入次数卡',mountContent:el=>el.querySelector('.form-modal-panel').classList.add('migration-card-review'),hint:`共 ${cards.length} 张，剩余本金 ${escapeHtml(money(result.paidCents,2))}。启用后按指定服务核销，不增加储值余额，不立即记营业收入。<br>仅支持纯本金、每次金额相同的次数卡。原卡期限和历史资料保留。`,saveText:'确认启用，不立即核销',fields:[
   {key:'evidence',label:'核对依据（必填）',placeholder:'已核对原卡规则及截止后的消费、退款'},
   {key:'sourceUseStopped',type:'checkbox',label:'已核对截至此刻的变动，旧系统已停止使用这些权益'},
   {key:'allBalanceAllocated',type:'checkbox',label:'本次全部旧余额已分配到这些卡，不再另加储值'},
   {key:'equalPerUsePrincipal',type:'checkbox',label:'每张卡按相同本金扣一次，指定服务及期限均已核对'}
  ],onSave:async values=>{
   if(owner.selectedCustomerId!==uid||owner.auth?.admin?.tenantId!==tid)throw Error('门店或顾客已变化，请重新进入。')
   if(!values.evidence.trim()||!values.sourceUseStopped||!values.allBalanceAllocated||!values.equalPerUsePrincipal)throw Error('请填写核对依据并逐项确认；不符合规则的卡保持待核对。')
   const payload={...values,cards,currency:info.currency,confirmVersion:info.version},fingerprint=JSON.stringify(payload)
   if(!attempt||attempt.fingerprint!==fingerprint)attempt={fingerprint,body:{...payload,requestId:crypto.randomUUID(),cutoverAt:new Date().toISOString()}}
   await request(base.replace(/reconciliation$/,'activate-timecards'),{method:'POST',body:JSON.stringify(attempt.body)})
   if(owner.selectedCustomerId!==uid||owner.auth?.admin?.tenantId!==tid)return
   toast('次数卡已启用，未增加储值余额、未核销');loadMigrationArchive(uid)
  }})

 }})
}
async function reviewMigrationBalance(pendingId) {
  const customerId=owner.selectedCustomerId,tenantId=owner.auth?.admin?.tenantId
  const base=`/admin/customers/${encodeURIComponent(customerId)}/migration-balances/${encodeURIComponent(pendingId)}`
  const info=await request(base)
  if(owner.selectedCustomerId!==customerId||owner.auth?.admin?.tenantId!==tenantId)return
  if(info.confirmation?.mode==='paid_timecards'){await UIDialog.alert(`已分配为 ${info.confirmation.cards.length} 张付费次数卡，本金 ${money(info.confirmation.paidCents,2)}。未增加储值余额，未产生营业收入。请在会员卡包查看剩余次数。`);return}
  if(info.confirmation){await UIDialog.alert(`已核对：本金 ${money(info.confirmation.paidCents,2)}，赠送金 ${money(info.confirmation.bonusCents,2)}。启用本身未产生营业收入。当前可用金额以账户流水为准。`);return}
  let attempt=null
  openFormModal({title:'核对迁移储值账户',hint:`原快照 ${escapeHtml(money(info.snapshotAmountCents,2))} · 币种 ${escapeHtml(info.currency)}<br>最新资料截止 ${escapeHtml(info.dataCutoffAt)}。原资料保留；启用不立即核销。有分卡、有效期或项目限制的旧卡暂不支持此入口。`,saveText:'确认启用，不立即核销',fields:[
    {key:'paid',label:`核对后剩余本金（${info.currency}）`,value:''},
    {key:'bonus',label:`核对后剩余赠送金（${info.currency}，无则填 0）`,value:''},
    {key:'evidence',label:'核对依据（必填）',placeholder:'例如：已核对截止后的消费、充值和退款'},
    {key:'differenceReason',label:'与原快照不同的原因（有差额必填）'},
    {key:'noReliableCardBreakdown',type:'checkbox',label:'只有可靠总额，无可靠分卡余额；旧卡不另行重复加钱'},
    {key:'unrestricted',type:'checkbox',label:'已核对所有原卡规则，本余额无项目或扣减限制'},
    {key:'noExpiry',type:'checkbox',label:'已核对本余额没有有效期限制'},
    {key:'sourceUseStopped',type:'checkbox',label:'已核对截至本次确认的变动，旧系统已停止使用本余额'}
  ],mountContent:overlay=>{for(const k of ['paid','bonus']){const el=overlay.querySelector(`[data-fm-field="${k}"]`);el.setAttribute('inputmode','decimal');el.setAttribute('data-money','');el.setAttribute('data-money-strict','')}},onSave:async values=>{
    if(owner.auth?.admin?.tenantId!==tenantId||owner.selectedCustomerId!==customerId)throw new Error('门店或顾客已变化，请重新进入核对。')
    if(!values.paid.trim()||!values.bonus.trim())throw new Error('请分别填写本金和赠送金，未知不能按零启用。')
    const payload={...values,paidCents:MoneyInput.strictCentsOf(values.paid),bonusCents:MoneyInput.strictCentsOf(values.bonus),mode:'unrestricted_aggregate',currency:info.currency,confirmVersion:info.version}
    delete payload.paid;delete payload.bonus
    const fingerprint=JSON.stringify(payload)
    if(!attempt||attempt.fingerprint!==fingerprint)attempt={fingerprint,body:{...payload,cutoverAt:new Date().toISOString(),requestId:crypto.randomUUID()}}
    const result=await request(base+'/activate',{method:'POST',body:JSON.stringify(attempt.body)})
    toast(result.status==='exhausted'?'已核对为耗尽，原资料保留':'旧余额已启用，未发生核销')
    if(owner.auth?.admin?.tenantId===tenantId&&owner.selectedCustomerId===customerId){
      try{const data=await request('/admin/customers');owner.customers=data.customers;renderCustomerDetail()}catch{loadMigrationArchive(customerId)}
    }
  }})
}
async function saveMigrationProfile(button) {
  const id=owner.selectedCustomerId
  if(!id)return
  const payload={acquisitionSource:document.querySelector('#acquisitionSourceInput').value,originalJoinedDate:document.querySelector('#originalJoinedDateInput').value}
  button.disabled=true
  try {
    const data=await request(`/admin/customers/${encodeURIComponent(id)}/migration-profile`,{method:'PATCH',body:JSON.stringify(payload)})
    const customer=owner.customers.find(c=>c.id===id);if(customer)Object.assign(customer,data.profile)
    toast('获客来源与原建档日期已保存')
  }catch(e){toast(e.message)}finally{button.disabled=false}
}

function customerBookings(customerId) {
  return owner.bookings
    .filter((booking) => booking.user?.id === customerId)
    .sort((a, b) => `${b.appointmentDate} ${b.appointmentTime}`.localeCompare(`${a.appointmentDate} ${a.appointmentTime}`))
}


function handleMigrationClick(event) {
  const reconciliation=event.target.closest('[data-migration-reconcile]')
  if(reconciliation){previewCardReconciliation(reconciliation.dataset.migrationReconcile).catch(e=>toast(e.message));return true}
  const migrationService=event.target.closest('[data-migration-service]')
  if(migrationService){reviewMigrationService(migrationService.dataset.migrationService).catch(e=>toast(e.message));return true}
  const migrationGift=event.target.closest('[data-migration-gift]')
  if(migrationGift){reviewMigrationGift(migrationGift.dataset.migrationGift).catch(e=>toast(e.message));return true}
  const migrationBalance=event.target.closest('[data-migration-balance]')
  if(migrationBalance){reviewMigrationBalance(migrationBalance.dataset.migrationBalance).catch(e=>toast(e.message));return true}
  const migrationSave=event.target.closest('[data-migration-profile-save]')
  if(migrationSave){saveMigrationProfile(migrationSave).catch(e=>toast(e.message));return true}
  const migrationPage=event.target.closest('[data-migration-page]')
  if(migrationPage){loadMigrationArchive(owner.selectedCustomerId,Number(migrationPage.dataset.migrationPage)).catch(e=>toast(e.message));return true}
  return false
}
