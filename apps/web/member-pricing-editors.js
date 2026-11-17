function renderServiceEditor() {
  if (!owner.serviceEditor) {
    els.serviceEditor.innerHTML = ''
    return
  }
  const service = owner.serviceEditor
  els.serviceEditor.innerHTML = `
    <form class="service-editor-card card" id="serviceEditorForm">
      <div class="section-row compact-row">
        <h3>${owner.lang==='zh'?(service.mode==='create'?'新建上架服务':'修改上架服务 · '+escapeHtml(service.nameZh||'')):'Edit listed service'}</h3>
        <button class="ghost slim" data-cancel-service-editor type="button">${t('cancel')}</button>
      </div>
      <div class="form-grid">
        <label><span>${owner.lang === 'zh' ? '平台大类(必挂)' : 'Category'}</span><select name="type">
          <option value="NAIL" ${service.type === 'NAIL' ? 'selected' : ''}>${owner.lang === 'zh' ? '美甲' : 'Nail'}</option>
          <option value="LASH" ${service.type === 'LASH' ? 'selected' : ''}>${owner.lang === 'zh' ? '美睫' : 'Lash'}</option>
          <option value="CARE" ${service.type === 'CARE' ? 'selected' : ''}>${owner.lang === 'zh' ? '护理' : 'Care'}</option>
          <option value="OTHER" ${service.type === 'OTHER' ? 'selected' : ''}>${owner.lang === 'zh' ? '其他(归护理·其他类)' : 'Other'}</option>
        </select></label>
        ${/* 🔴 分类唯一真相律②(店主 2026-08-25):**编辑项目时只选大类,不许有第二个分类输入框**。
              这里原来是一个自由文本「分类」框(法式系列/日式款…),与大类各说各的 ——
              顾客端就是被它搞成「8 个分组各 1 项」的。现在只剩大类下拉;
              自由文本列已退役为派生字段(读时 join 大类字典,写时不接受)。 */''}
        <label><span>${owner.lang === 'zh' ? '大类(唯一分类口)' : 'Category'}</span><select name="categoryId">
          <option value="">${owner.lang === 'zh' ? '— 请选一个大类 —' : '— pick one —'}</option>
          ${pricingState.categories.map((c) => `<option value="${c.id}" ${c.id === service.categoryId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select></label>
        <label><span>${t('nameZh')}</span><input name="nameZh" value="${escapeHtml(service.nameZh)}"></label>
        <label><span>${t('nameEn')}</span><input name="nameEn" value="${escapeHtml(service.nameEn)}"></label>
      </div>
      <label><span>${t('descriptionZh')}</span><textarea name="descriptionZh" rows="2">${escapeHtml(service.descriptionZh)}</textarea></label>
      <label><span>${t('descriptionEn')}</span><textarea name="descriptionEn" rows="2">${escapeHtml(service.descriptionEn)}</textarea></label>
      ${window.ServiceImageEditor.field(service, owner.lang === 'zh')}
      <div class="form-grid">
        <label class="hidden"><span>${escapeHtml((owner.lang === 'zh' ? '价格 ' : 'Price ') + (storeCurrency() || '—'))}</span><input name="price" inputmode="decimal" value="${escapeHtml(service.price)}"></label>
        <label><span>${t('depositCad')}</span><input name="deposit" inputmode="decimal" value="${escapeHtml(service.deposit)}"></label>
        <label><span>${t('durationMin')}</span><input name="duration" inputmode="numeric" value="${escapeHtml(service.duration)}"></label>
        <label><span>${t('sortOrder')}</span><input name="sortOrder" inputmode="numeric" value="${escapeHtml(service.sortOrder)}"></label>
      </div>
      <div id="mpDisplayPrices"></div>
      <label class="check-row">
        <input name="isActive" type="checkbox" ${service.isActive ? 'checked' : ''}>
        <span>${t('active')}</span>
      </label>
      <button class="primary full" data-save-service-editor type="submit">${t('save')}</button>
    </form>
  `
  window.MemberPricingSettings.prices(document.querySelector('#mpDisplayPrices'),service.id,'display',{request,escapeHtml,toast,currency:storeCurrency()})
}


async function saveServiceEditor(event) {
  event.preventDefault()
  const form = new FormData(event.target)
  if (event.target.dataset.imageReading) throw Error('图片正在读取，请稍候'); const imageUrl = form.get('imageUrl')
  const body = {
    type: form.get('type'),
    // 分类唯一真相律:只送 categoryId,自由文本 category 不再送(后端也不再接受)
    categoryId: form.get('categoryId') || null,
    nameZh: form.get('nameZh'),
    nameEn: form.get('nameEn'),
    descriptionZh: form.get('descriptionZh'),
    descriptionEn: form.get('descriptionEn'),
    imageUrl, imageView: JSON.parse(form.get('imageView') || '{}'),
    priceCents: dollarsToCents(form.get('price')),
    priceSystemUpdate: window.MemberPricingSettings.read(document.querySelector('#mpDisplayPrices')),
    depositCents: dollarsToCents(form.get('deposit')),
    baseDurationMin: Number(form.get('duration')),
    sortOrder: Number(form.get('sortOrder')),
    isActive: form.get('isActive') === 'on'
  }
  const isCreate = owner.serviceEditor.mode === 'create'
  if(isCreate)body.priceCents=body.priceSystemUpdate.prices.list.priceCents
  await request(isCreate ? '/admin/services' : `/admin/services/${owner.serviceEditor.id}`, {
    method: isCreate ? 'POST' : 'PATCH',
    body: JSON.stringify(body)
  })
  owner.serviceEditor = null
  toast(isCreate ? t('serviceCreated') : t('serviceSaved'))
  await loadAll()
  await loadPricingPage()
}



function renderPricingItemEditor() {
  if (!els.pricingItemEditor) return
  const draft = pricingState.editing
  if (!draft) { els.pricingItemEditor.innerHTML = ''; return }
  const isAddon = draft.itemKind === 'addon'
  els.pricingItemEditor.innerHTML = `
    <div class="pricing-editor">
      <div class="section-row"><h3>${pzh() ? '编辑价档' : 'Edit price tiers'} · ${escapeHtml(draft.nameZh || (pzh() ? '新项目' : 'New item'))}</h3><button class="ghost slim" type="button" onclick="document.querySelector('#piCancel')?.click()">${pzh() ? '关闭返回' : 'Close'}</button></div>
      <div class="kb-facts-grid">
        <label><span>${pzh() ? '项目名称' : 'Name'}</span><input id="piName" value="${escapeHtml(draft.nameZh || '')}"></label>
        <label><span>${pzh() ? '英文名(选填)' : 'English name'}</span><input id="piNameEn" value="${escapeHtml(draft.nameEn || '')}"></label>
        <label><span>${pzh() ? '大类' : 'Category'}</span><select id="piCategory">
          ${pricingState.categories.map((c) => `<option value="${c.id}" ${c.id === draft.categoryId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select></label>
        <label><span>${pzh() ? '计费单位' : 'Unit'}</span><select id="piUnit">
          ${PRICING_UNITS.map(([v, label]) => `<option value="${v}" ${v === (draft.unit || 'once') ? 'selected' : ''}>${label}</option>`).join('')}
        </select></label>
        <label class="hidden"><span>${pzh() ? '原价' : 'List price'}</span><input id="piList" inputmode="decimal" value="${draft.listPriceCents ? draft.listPriceCents / 100 : ''}"></label>
        <label class="hidden"><span>${pzh() ? '分享价' : 'Share price'}</span><input id="piShare" inputmode="decimal" value="${draft.sharePriceCents ? draft.sharePriceCents / 100 : ''}"></label>
        <label class="hidden"><span>${pzh() ? '会员价' : 'Member price'}</span><input id="piMember" inputmode="decimal" value="${draft.memberPriceCents ? draft.memberPriceCents / 100 : ''}"></label>
        <label class="hidden"><span>${pzh() ? '疗程价(选填)' : 'Course price'}</span><input id="piCourse" inputmode="decimal" value="${draft.coursePriceCents ? draft.coursePriceCents / 100 : ''}"></label>
        <label class="hidden"><span>${pzh() ? '疗程次数' : 'Course times'}</span><input id="piCourseTimes" inputmode="numeric" value="${draft.courseTimes || ''}"></label><label><span>${pzh() ? '时长(分钟)' : 'Duration (min)'}</span><input id="piDuration" inputmode="numeric" value="${draft.baseDurationMin ?? (isAddon ? 0 : 60)}"></label>
      </div>${isAddon ? '' : `<label class="subtle mp-checkbox-row"><input type="checkbox" id="piQuoteMode" ${draft.priceMode === 'quote' ? 'checked' : ''}> <span>${pzh() ? '这项<b>需技师看过才报价</b>(勾上后 AI 不自己报数,也不进「最便宜的是哪种」)' : 'Quote on request (AI will not price it)'}</span></label>`}
      ${isAddon ? `
      <div class="pricing-addon-block">
        <label><span>${pzh() ? '加项组名(结算表单里按它分组,如 延长类 / 补甲类 / 卸甲类;留空归「其他加项」)' : 'Addon group'}</span>
          <input id="piAddonGroup" list="piAddonGroupList" value="${escapeHtml(draft.addonGroup || '')}" placeholder="${pzh() ? '例:延长类' : 'e.g. Extensions'}">
        </label>
        <datalist id="piAddonGroupList">${[...new Set((pricingState.items || []).map((i) => i.addonGroup).filter(Boolean))].map((g) => `<option value="${escapeHtml(g)}">`).join('')}</datalist>
        <label class="subtle"><input type="checkbox" id="piPctRule" ${draft.priceRule === 'pct_of_tier_price' ? 'checked' : ''}>
          ${pzh() ? '单指价按主项目该档价的百分比算(留空用规则默认 10%)' : 'Derive per-finger price from main item price'}</label>
        <input id="piPct" class="pricing-sort" inputmode="decimal" placeholder="%" value="${draft.priceRuleValue || ''}">
        <div class="subtle" style="margin-top:8px">${pzh() ? '适用大类(这个加项能配在哪些大类的项目上)' : 'Applies to categories'}</div>
        <div class="pricing-scope">
          ${pricingState.categories.map((c) => `<label class="subtle"><input type="checkbox" data-scope="${c.id}" ${(draft.addonScope || []).includes(c.id) ? 'checked' : ''}> ${escapeHtml(c.name)}</label>`).join('')}
        </div>
      </div>` : ''}
      <div id="mpSettlementPrices"></div>
      <div class="action-row wrap">
        <button class="primary slim" id="piSave" type="button">${pzh() ? '保存' : 'Save'}</button>
        <button class="ghost slim" id="piCancel" type="button">${pzh() ? '取消' : 'Cancel'}</button>
        <span class="subtle">${pzh() ? '留空的价档=未挂:开单时不会出现这个价档。改动即时生效于新开单;影响待签单的价格变化后须重新核对。' : 'Blank tiers are detached: they never appear at checkout. Changes apply to new settlements only.'}</span>
      </div>
    </div>`
  window.MemberPricingSettings.prices(document.querySelector('#mpSettlementPrices'),draft.id,'settlement',{request,escapeHtml,toast,currency:storeCurrency()})
}

function collectPricingItemForm() {
  const body = {
    nameZh: document.querySelector('#piName')?.value.trim(),
    nameEn: document.querySelector('#piNameEn')?.value.trim(),
    categoryId: document.querySelector('#piCategory')?.value || null,
    unit: document.querySelector('#piUnit')?.value || 'once',
    itemKind: pricingState.editing.itemKind,
    type: pricingState.editing.type || 'OTHER',
    listPriceCents: pCents(document.querySelector('#piList')?.value) ?? 0,
    sharePriceCents: pCents(document.querySelector('#piShare')?.value),
    memberPriceCents: pCents(document.querySelector('#piMember')?.value),
    coursePriceCents: pCents(document.querySelector('#piCourse')?.value),
    courseTimes: Number(document.querySelector('#piCourseTimes')?.value || 0) || null,
    baseDurationMin: Number(document.querySelector('#piDuration')?.value || 0),
    ...(pricingState.editing.itemKind === 'addon' ? {} : { priceMode: document.querySelector('#piQuoteMode')?.checked ? 'quote' : 'fixed' })   // D146:加项没有这一格,不发
  }
  if (pricingState.editing.itemKind === 'addon') {
    body.priceRule = document.querySelector('#piPctRule')?.checked ? 'pct_of_tier_price' : 'fixed'
    body.priceRuleValue = Number(document.querySelector('#piPct')?.value || 0) || 0
    body.addonScope = Array.from(document.querySelectorAll('[data-scope]')).filter((el) => el.checked).map((el) => el.dataset.scope)
    // 裁决④:加项组名由商家自填,结算表单按它给加项目录分组
    body.addonGroup = (document.querySelector('#piAddonGroup')?.value || '').trim()
  }
  return body
}


async function savePackage(kind, existing) {
  // D50:prompt 链 → 页内表单弹层(单弹层多字段)
  kind = kind || (existing && existing.kind) || 'recharge'
  const isTimes = kind === 'times'
  let giftEditor,discountWheel;const packageDiscount=!isTimes&&existing?await request('/admin/member-pricing/packages/'+encodeURIComponent(existing.id)):{rateBps:null,revision:0}
  /* 裁决(店主 08-20):关联项目组禁自由文本——下拉单选(现有二级分类+不限)。
     存量自由文本匹配不上=选项标 ⚠ 红提示商家改选,不静默改数据。 */
  let groupOptions = [['', '不限(不限制项目组)']]
  let legacyGroupBad = false
  if (isTimes) {
    const cats = (await request('/admin/pricing/categories').catch(() => ({ categories: [] }))).categories || []
    groupOptions = groupOptions.concat(cats.map((c) => [c.name, c.name]))
    const cur = existing ? String(existing.projectGroup || '') : ''
    if (cur && !cats.some((c) => c.name === cur)) {
      legacyGroupBad = true
      groupOptions.unshift([cur, `⚠ ${cur}(分类已不存在,请改选)`])
    }
  }
  openFormModal({
    closeButtonOnly: !isTimes,
    mountContent:overlay=>{if(!isTimes){const host=document.createElement("div");overlay.querySelector(".action-row").before(host);giftEditor=window.GiftEditor.mount(host,existing?.giftItems||[],mMoney(0).replace(/[0-9.,\s]/g,""));const wheel=document.createElement("div");host.after(wheel);discountWheel=window.DiscountWheel.mount(wheel,{value:packageDiscount.rateBps})}},
    title: existing ? `编辑${isTimes ? '次卡' : '充值套餐'}` : `新建${isTimes ? '次卡' : '充值套餐'}`,
    hint: isTimes ? '售卡=预收负债不计积分;核销按折算单价确认收入(批②)。' : '赠送=营销让利:入储值负债、单独列示,不算实收/业绩/积分。',
    fields: [
      { key: 'name', label: '名称', type: 'text', value: existing ? existing.name : '', placeholder: isTimes ? '如 美甲单色 5 次卡' : '如 充500赠50' },
      { key: 'price', label: isTimes ? '售价' : '充值金额', type: 'number', value: existing ? existing.priceCents / 100 : '' },
      ...(isTimes ? [
        { key: 'times', label: '总次数', type: 'number', value: existing ? existing.timesCount : 5 },
        { key: 'projectGroup', label: '关联项目组', type: 'select', value: existing ? existing.projectGroup || '' : '', options: groupOptions, hint: legacyGroupBad ? '⚠ 原项目组的分类已不存在,请改选后保存(不会自动改动已售卡)' : '核销时从组内选具体项目;选「不限」=全部项目可核销', danger: legacyGroupBad },
        { key: 'validDays', label: '有效期天数(留空=长期)', type: 'number', value: existing && existing.validDays ? existing.validDays : '' }
      ] : [
        { key: 'bonus', label: '赠送金额(可为 0)', type: 'number', value: existing && existing.bonusCents ? existing.bonusCents / 100 : '' }
      ]),
      { key: 'benefits', label: '权益说明(可留空)', type: 'text', value: existing ? existing.benefits || '' : '' },
      { key: 'mallVisible', label: '上架商城(顾客商城可见)', type: 'checkbox', value: existing ? existing.mallVisible !== false : true }
    ],
    onSave: async (v) => {
      if (!String(v.name || '').trim()) { toast('名称必填'); return false }
      const body = { kind, name: String(v.name).trim(), priceCents: mCents(v.price), benefits: String(v.benefits || '').trim(), mallVisible: Boolean(v.mallVisible) }
      if (isTimes) {
        body.timesCount = Math.round(Number(v.times) || 0)
        body.projectGroup = String(v.projectGroup || '').trim()
        body.validDays = v.validDays ? Math.round(Number(v.validDays) || 0) : null
      } else {
        body.bonusCents = mCents(v.bonus || 0)
        body.giftItems = giftEditor.read()
        body.defaultPersonalDiscount={expectedRevision:packageDiscount.revision,rateBps:discountWheel.read()}
      }
      if (existing) await request(`/admin/packages/${existing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      else await request('/admin/packages', { method: 'POST', body: JSON.stringify(body) })
      toast('已保存')
      await loadMembershipPage()
    }
  })
}

function mountMemberPricingConfig(){
 const deps={request,escapeHtml,toast};
 for(const [selector,system] of [['#serviceAdminList','display'],['#pricingItemList','settlement']]){const parent=document.querySelector(selector);if(!parent)continue;let host=parent.parentElement.querySelector('[data-mp-config="'+system+'"]');if(!host){host=document.createElement('div');host.dataset.mpConfig=system;parent.before(host)}window.MemberPricingSettings.config(host,system,deps)}
}
