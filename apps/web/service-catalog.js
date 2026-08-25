/* 网页商家后台 · 模块① 上架服务列表(从 admin.js 搬出,2026-08-25 S13①)。
   公约②「边改边拆」:S13① 动的就是这块(按大类分组),顺手整域搬出。
   **只搬不改**:依赖(owner / pricingState / els / t / money / escapeHtml 等全局)运行期解析;
   admin.html 里本文件排在 admin.js 之前加载。 */

function renderServices() {
  /* S1 模块①(图=合同):上架服务=顾客橱窗。行=目录主项目(非次卡,单行自关联·假设③),
     开关=storefront 上架位(独立于 is_active);展示价=最低可用价档+「起」(规则⑤,后端算好下发)。 */
  renderServiceEditor()
  if (!els.serviceAdminList) return
  const zh = owner.lang === 'zh'
  /* 组合矩阵抓的口径:目录已停用(isActive=false)的项不进模块①——顾客端本来就看不见它,
     列表若仍标「已上架」就是自相矛盾(闭环纪律③);恢复启用回模块②。假设⑦已记录。 */
  const rows = owner.services.filter((svc) => (svc.itemKind || 'main') === 'main' && !svc.isTimecard && svc.isActive !== false)
  const tierNote = (svc) => {
    const it = pricingState.items.find((i) => i.id === svc.id)
    if (!it) return ''
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
    <div class="service-admin-row">
      <div style="display:flex;gap:12px;align-items:flex-start">
        ${svc.imageUrl ? `<img src="${escapeHtml(svc.imageUrl)}" alt="" style="width:44px;height:44px;border-radius:10px;object-fit:cover;flex:none">` : ''}
        <div>
          <h3 style="display:inline">${escapeHtml(svc.nameZh)}</h3>
          <span class="status ${svc.storefront ? 'CONFIRMED' : 'CANCELLED'}" style="margin-left:8px">${svc.storefront ? (zh ? '已上架' : 'Listed') : (zh ? '已下架' : 'Unlisted')}</span>
          <p class="subtle" style="margin:4px 0 0">${zh ? '关联项目' : 'Catalog item'}：${escapeHtml(svc.nameZh)}${zh ? '（目录同项）' : ''} · ${zh ? '展示价' : 'From'} ${money(svc.startingPriceCents ?? svc.priceCents)} ${zh ? '起' : ''}${tierNote(svc)} · ${zh ? '约' : '~'} ${svc.durationMin} ${zh ? '分钟' : 'min'}</p>
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
    <div class="service-admin-row" data-storefront-new role="button" style="border:1.5px dashed #d8cfc6;border-radius:12px;justify-content:center;cursor:pointer;color:#8c8279">
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
  els.serviceAdminList.innerHTML = (rows.length
    ? groupHtml
    : `<div class="empty-state"><strong>${t('noServices')}</strong></div>`) + pickerHtml
}
