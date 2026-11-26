/* 网页商家后台 · 模块① 上架服务列表(从 admin.js 搬出,2026-08-25 S13①)。
   公约②「边改边拆」:S13① 动的就是这块(按大类分组),顺手整域搬出。
   **只搬不改**:依赖(owner / pricingState / els / t / money / escapeHtml 等全局)运行期解析;
   admin.html 里本文件排在 admin.js 之前加载。 */

function renderServices() {
  /* S1 模块①(图=合同):上架服务=顾客橱窗。行=目录主项目(非次卡,单行自关联·假设③),
     开关=storefront 上架位(独立于 is_active);展示价=最低可用价档+「起」(规则⑤,后端算好下发)。 */
  // Detach before replacing the list: retain the editor host and its listeners.
  els.serviceAdminList?.before(els.serviceEditor)
  if (!els.serviceAdminList) return
  const zh = owner.lang === 'zh'
  /* 组合矩阵抓的口径:目录已停用(isActive=false)的项不进模块①——顾客端本来就看不见它,
     列表若仍标「已上架」就是自相矛盾(闭环纪律③);恢复启用回模块②。假设⑦已记录。 */
  const rows = owner.services.filter((svc) => (svc.itemKind || 'main') === 'main' && !svc.isTimecard && svc.isActive !== false)
  const tierNote = (svc) => {
    const it = pricingState.items.find((i) => i.id === svc.id)
    if (!it||it.displayReference) return ''
    const tiers = []
    if (it.listPriceCents) tiers.push(zh ? '普通' : 'list')
    if (it.sharePriceCents) tiers.push(zh ? '分享' : 'share')
    if (it.memberPriceCents) tiers.push(zh ? '会员' : 'member')
    if (it.coursePriceCents) tiers.push(zh ? '疗程' : 'course')
    if (!tiers.length) return ''
    if (!zh) return `(${tiers.join('/')})`
    const cnt = ['', '', '两', '三', '四'][tiers.length] || tiers.length
    return tiers.length === 1 ? `（${tiers[0]}价档）` : `（${tiers.join('/')}${cnt}档）`
  }
  const rowHtml = (svc) => `
    <div class="service-admin-row" data-service-row="${escapeHtml(svc.id)}">
      <div style="display:flex;gap:12px;align-items:flex-start">
        ${svc.imageUrl ? `<img src="${escapeHtml(svc.imageUrl)}" alt="" style="width:44px;height:44px;border-radius:10px;object-fit:cover;flex:none">` : ''}
        <div>
          <h3 style="display:inline">${escapeHtml(svc.nameZh)}</h3>
          <span class="status ${svc.storefront ? 'CONFIRMED' : 'CANCELLED'}" style="margin-left:8px">${svc.storefront ? (zh ? '已上架' : 'Listed') : (zh ? '已下架' : 'Unlisted')}</span>
          <p class="subtle" style="margin:4px 0 0">${zh ? '关联项目' : 'Catalog item'}：${escapeHtml(svc.nameZh)}${zh ? '（目录同项）' : ''} · ${zh ? '展示原价' : 'Display list price'} ${money(pricingState.items.find(i=>i.id===svc.id)?.displayReference?.prices.list?.priceCents ?? svc.startingPriceCents ?? svc.priceCents)}${tierNote(svc)} · ${zh ? '约' : '~'} ${svc.durationMin} ${zh ? '分钟' : 'min'}</p>
        </div>
      </div>
      <div style="display:flex;gap:10px;align-items:center">
        <label class="service-active-toggle">
          <input type="checkbox" data-service-active="${svc.id}" ${svc.storefront ? 'checked' : ''}>
          <span class="subtle">${zh ? '上架' : 'List'}</span>
        </label>
        <button class="ghost slim" data-edit-service="${svc.id}" type="button">${t('modify')}</button>
      </div>
    </div>`
  const offItems = rows.filter((svc) => !svc.storefront)
  const pickerHtml = pricingState.storefrontPicker ? `
    <div class="pricing-editor" data-storefront-picker>
      <p class="subtle" style="margin-top:0">${zh ? '从结算单目录选择未上架的主项目,点「上架」即关联进橱窗;或全新创建一个服务(同时进入目录与橱窗)。' : 'Pick an unlisted catalog item to list, or create a new service.'}</p>
      ${offItems.length ? offItems.map((svc) => `<button class="ghost slim" data-storefront-link="${svc.id}" type="button" style="margin:0 8px 8px 0">${escapeHtml(svc.nameZh)} · ${zh ? '上架' : 'list'}</button>`).join('') : `<p class="subtle">${zh ? '目录里没有未上架的主项目了。' : 'No unlisted catalog items.'}</p>`}
      <div class="action-row">
        <button class="primary slim" data-storefront-create type="button">${zh ? '全新创建' : 'Create new'}</button>
        <button class="ghost slim" data-storefront-collapse type="button">${zh ? '收起' : 'Close'}</button>
      </div>
    </div>` : `
    <div class="service-admin-row" data-storefront-new role="button" style="border:1.5px dashed var(--line);border-radius:12px;justify-content:center;cursor:pointer;color:var(--muted)">
      ＋ ${zh ? '新建上架服务（从结算单目录选项目关联，或全新创建）' : 'New storefront service (link a catalog item, or create new)'}
    </div>`
  /* 🔴 S13①(店主 2026-08-25):模块① 列表**按大类分组**显示 —— 原来一排平铺,店主说"很乱"。
     分组键=大类(categoryId,本店大类字典的那张表),组名读同一份字典(catName 唯一出口);
     **没挂大类的不藏起来**,单独一组「未归类」排在最后 —— 藏起来等于让店主永远发现不了漏挂。
     组内顺序不动(还是数据源给的顺序),这里只分组不排序。 */
  const catNameOf = (id) => pricingState.categories.find((c) => c.id === id)?.name || ''
  const groups = new Map()
  for (const svc of rows) {
    const item = pricingState.items.find((i) => i.id === svc.id)
    const key = item?.categoryId || ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(svc)
  }
  const ordered = [...groups.entries()].sort((a, b) => {
    if (!a[0]) return 1                       // 未归类永远最后
    if (!b[0]) return -1
    const ia = pricingState.categories.findIndex((c) => c.id === a[0])
    const ib = pricingState.categories.findIndex((c) => c.id === b[0])
    return ia - ib                            // 其余照大类字典自身的顺序
  })
  const groupHtml = ordered.map(([key, list]) => `
    <div class="svc-group" data-svc-group="${escapeHtml(key || 'uncategorized')}">
      <div class="svc-group-head">
        <span class="svc-group-name">${escapeHtml(key ? catNameOf(key) : (zh ? '未归类' : 'Uncategorized'))}</span>
        <span class="svc-group-count">${list.length}</span>
        ${key ? '' : `<span class="subtle">${zh ? '没挂大类 —— 点「修改」给它选一个,顾客端才好找' : 'No category yet'}</span>`}
      </div>
      ${list.map(rowHtml).join('')}
    </div>`).join('')
  els.serviceAdminList.innerHTML = (owner.serviceEditor ? '' : pickerHtml) + (rows.length
    ? groupHtml
    : `<div class="empty-state"><strong>${t('noServices')}</strong></div>`)
  if (owner.serviceEditor) {
    const row = pricingState.catalogInteractionV2 && owner.serviceEditor.mode === 'edit'
      ? Array.from(els.serviceAdminList.querySelectorAll('[data-service-row]')).find(el => el.dataset.serviceRow === owner.serviceEditor.id)
      : null
    if (row) row.after(els.serviceEditor)
    else els.serviceAdminList.prepend(els.serviceEditor)
  }
  renderServiceEditor()
}

// Settlement catalog rows share the same inline-editor placement discipline.
function renderPricingItems() {
  if (!els.pricingItemList) return
  // Preserve the live editor host before replacing rows that may contain it.
  els.pricingItemList.before(els.pricingItemEditor)
  const catName = (id) => pricingState.categories.find((c) => c.id === id)?.name || (pzh() ? '未分类' : 'Uncategorized')
  const group = (kind) => pricingState.items.filter((i) => i.itemKind === kind)
  /* S3(图=合同):价档 chips —— 挂了的实心展示;疗程价没挂=划线 na 态「未挂 · 开单时不出现」(不是置灰,开单时根本不存在)。 */
  const tierChips = (item) => {
    if(item.settlementPriceSummary)return item.settlementPriceSummary.map(p=>`<span class="tier-chip on">${escapeHtml(p.label)}${p.key==='member'?'':' '+escapeHtml(p.amountText)}</span>`).join('')
    const chips = []
    if (item.listPriceCents) chips.push(`<span class="tier-chip on">${pzh() ? '普通价' : 'List'} ${money(item.listPriceCents)}</span>`)
    if (item.sharePriceCents) chips.push(`<span class="tier-chip on">${pzh() ? '分享价' : 'Share'} ${money(item.sharePriceCents)}</span>`)
    if (item.memberPriceCents) chips.push(`<span class="tier-chip on">${pzh() ? '会员价' : 'Member'} ${money(item.memberPriceCents)}</span>`)
    if (item.coursePriceCents) chips.push(`<span class="tier-chip on">${pzh() ? '疗程价' : 'Course'} ${money(item.coursePriceCents)}${item.courseTimes ? `/${item.courseTimes}${pzh() ? '次' : 'x'}` : (pzh() ? '/次' : '/x')}</span>`)
    else chips.push(`<span class="tier-chip na">${pzh() ? '疗程价（未挂 · 开单时不出现）' : 'Course (not attached · hidden at checkout)'}</span>`)
    return chips.join('')
  }
  const rowHtml = (item) => `
    <div class="service-admin-item${item.isActive ? '' : ' inactive'}" data-pricing-item-row="${escapeHtml(item.id)}">
      <div>
        <strong>${escapeHtml(item.nameZh)}</strong>
        <span class="subtle">${escapeHtml(catName(item.categoryId))}${item.unit === 'per_finger' ? (pzh() ? ' · 按指' : ' · per finger') : ''}${item.isActive ? '' : (pzh() ? ' · 已停用' : ' · hidden')}${item.itemKind === 'main' ? (item.storefront ? (pzh() ? ' · 橱窗已上架' : ' · listed') : (pzh() ? ' · 橱窗未上架' : ' · unlisted')) : ''}</span>
        ${item.priceMode === 'quote' ? `<div class="subtle" style="margin-top:4px">${pzh() ? '需技师报价(AI 不报数)' : 'Quote on request'}</div>` : ''}${item.itemKind === 'main' ? `<div style="margin-top:4px">${tierChips(item)}</div>` : `<div class="subtle">${escapeHtml((pricingState.catalogInteractionV2 ? item.settlementPriceSummary?.find(p => p.key === 'list')?.amountText : null) ?? money(item.listPriceCents))}${item.priceRule === 'pct_of_tier_price' ? ` · ${pzh() ? '按主项目比例' : 'pct of main'} ${item.priceRuleValue || '默认'}%` : ''}</div>`}
        <div class="subtle">${item.baseDurationMin ? `${item.baseDurationMin}min` : ''}</div>
      </div>
      <div class="row-actions">
        <button class="ghost slim" data-item-edit="${item.id}" type="button">${item.itemKind === 'main' ? (pzh() ? '编辑价档' : 'Edit tiers') : (pzh() ? '编辑' : 'Edit')}</button>
        <button class="ghost slim" data-item-toggle="${item.id}" type="button">${item.isActive ? (pzh() ? '停用' : 'Hide') : (pzh() ? '启用' : 'Show')}</button>
        <button class="ghost slim" data-item-delete="${item.id}" type="button">${pzh() ? '删除' : 'Delete'}</button>
      </div>
    </div>`
  const mains = group('main').filter((i) => !i.isTimecard)
  const addons = group('addon')
  els.pricingItemList.innerHTML = `
    <h3 class="pricing-group-title">${pzh() ? `项目与价档(${mains.length})` : `Items & tiers (${mains.length})`}</h3>
    ${mains.length ? mains.map(rowHtml).join('') : `<div class="empty-state">${pzh() ? '还没有主项目' : 'No main items'}</div>`}
    <h3 class="pricing-group-title">${pzh() ? `加项(${addons.length})（只在开单时出现）` : `Add-ons (${addons.length}) — checkout only`}</h3>
    ${addons.length ? addons.map(rowHtml).join('') : `<div class="empty-state">${pzh() ? '还没有加项(卸甲、贴片、单指补甲都算加项)' : 'No add-ons'}</div>`}`
  renderPricingTimecards()
  renderPricingItemEditor()
}
