/* 网页商家后台 · 结算开单(批次三 · 上线前必办,2026-08-29)。

   为什么是硬门槛:境外商家没有微信小程序 —— 招商来的本地店买了系统**开不了单**。
   与 08-14 拍板②(顾客端对齐)同一个理由,当时漏了商家端;08-19 店主自己撞过一次。

   合同三条(店主指令原文):
     ① 同一套后端路由(direct + preview + lookup + settlements),**不许新造接口**;
     ② 页面块与小程序「结算开单」一一对应(屏序照小程序:价格档 → 项目 → 次卡 → 加项 →
        自选行 → 技师 → 被服务者 → 定金/券/储值 → 合计 → 送签);
     ③ **入账唯一路径 = 签署,不变**:这里只到「生成待签结算单」为止,签署仍走顾客侧现有签署流。

   写法纪律:金额句零计算(全部渲染后端 preview 的 *Text 字段);body 构造是**纯函数**
   (buildSheets / buildBody),与小程序 groupSheets/formBody 同形 —— 测试直接加载本文件
   喂同一状态,断言两端产出的 body 一致(双端同批律第一案的判据①)。
   被服务者输入**原样存**(店主第 5 步那个坑:trim 只在提交那一刻做,姓和名之间打得出空格)。 */
window.SettlementWeb = (function () {
  const TIER_LABEL = { list: '原价', share: '分享价', member: '会员价', course: '疗程价' }

  const state = {
    open: false, ready: false, submitting: false,
    bookingId: '', userId: '', customerName: '',
    cats: [], items: [], roster: [], timecards: [], timecardPackages: [],
    depositDeductible: true, depositApplied: false,
    groups: [], couponGrantId: '', couponOptions: [], couponUsableCount: 0,
    payMenu: { useBalance: false, recharge: false },
    preview: null, view: null, pendingSheets: []
  }

  function newGroup(tierDefault, firstCat) {
    return {
      tierKey: tierDefault, tierDefault, tierChanged: false,
      catId: firstCat || '', mainId: '',
      timecardId: '', timecardServiceId: '', purchasePackageId: '',
      addonIds: {}, customItems: [], selectedTechs: [], techItems: {},
      servedPersonName: ''
    }
  }

  /* ===== 纯函数:与小程序 groupSheets() 同形(字段名逐个对齐,别名都不许起) ===== */
  function buildSheets(st) {
    return st.groups.map(function (g, i) {
      const items = []
      const all = st.items
      if (g.mainId) {
        const it = all.find(function (x) { return x.id === g.mainId }) || {}
        items.push(it.unit === 'per_finger' ? { serviceId: g.mainId, fingers: 1 } : { serviceId: g.mainId, qty: 1 })
      }
      for (const id of Object.keys(g.addonIds)) {
        const it = all.find(function (x) { return x.id === id }) || {}
        items.push(it.unit === 'per_finger' ? { serviceId: id, fingers: g.addonIds[id] } : { serviceId: id, qty: g.addonIds[id] })
      }
      const isTcGroup = Boolean(g.timecardId || g.purchasePackageId)
      return {
        bookingId: i === 0 ? (st.bookingId || undefined) : undefined,
        tierKey: isTcGroup ? 'list' : g.tierKey,
        tierChangedFrom: !isTcGroup && g.tierChanged ? g.tierDefault : undefined,
        items,
        timecardId: g.timecardId || undefined,
        purchasePackageId: g.purchasePackageId || undefined,
        timecardServiceId: (g.timecardId || g.purchasePackageId) ? (g.timecardServiceId || undefined) : undefined,
        customItems: g.customItems.map(function (c) { return { name: c.name, amountCents: c.amountCents } }),
        servedPersonName: String(g.servedPersonName || '').trim(),   // trim 只在这一刻(输入过程原样)
        technicians: g.selectedTechs.map(function (id, index) {
          return { technicianId: id, role: index === 0 ? 'main' : 'assist', itemNos: (g.techItems && g.techItems[id]) || [] }
        }),
        payIntent: payIntentOf(st),
        depositApplied: i === 0 ? st.depositApplied : false,
        couponGrantId: i === 0 ? (st.couponGrantId || undefined) : undefined,
        applyFootSurcharge: false,
        applyTipReuse: false
      }
    })
  }

  function payIntentOf(st) {
    const m = st.payMenu
    if (!m.useBalance) return 'offline_full'
    return m.recharge ? 'recharge_then_balance' : 'balance_plus_offline'
  }

  function buildBody(st) {
    return {
      bookingId: st.bookingId || undefined,
      userId: st.userId || undefined,
      payerUserId: st.userId || undefined,
      cardOwnerUserId: st.userId || undefined,
      payIntent: payIntentOf(st),
      settlements: buildSheets(st)
    }
  }

  /* ===== boot:同一套读口(direct 那条留给排单;开单读的与小程序 boot 一致) ===== */
  async function open(ctx, deps) {
    const { request, escapeHtml, toast, money } = deps
    Object.assign(state, {
      open: true, ready: false, submitting: false, _scrolled: false,
      bookingId: ctx.bookingId || '', userId: ctx.userId || '', customerName: ctx.customerName || '',
      groups: [], couponGrantId: '', couponOptions: [], couponUsableCount: 0,
      payMenu: { useBalance: false, recharge: false }, preview: null, view: null, pendingSheets: []
    })
    state._deps = deps
    try {
      const [cats, items, techs, dep] = await Promise.all([
        request('/admin/pricing/categories'),
        request('/admin/pricing/items'),
        request('/admin/technicians?roster=1'),
        request('/admin/deposit-config').catch(function () { return null })
      ])
      state.cats = (cats.categories || []).filter(function (c) { return c.isBookable !== false })
      state.items = (items.items || []).filter(function (i) { return i.isActive !== false })
      state.roster = (techs.technicians || []).map(function (t) { return { id: t.id, name: t.name } })
      state.depositDeductible = dep && dep.config ? dep.config.deductible !== false : true
      state.depositApplied = Boolean(state.bookingId)
      let tierDefault = 'list'
      if (state.userId) {
        const m = await request(`/admin/membership/members?userId=${encodeURIComponent(state.userId)}`).catch(function () { return null })
        const one = m && (m.members || [])[0]
        if (one && one.isMember) tierDefault = 'member'
        const tc = await request(`/admin/customers/${encodeURIComponent(state.userId)}/timecards`).catch(function () { return null })
        state.timecards = (tc && tc.timecards) || []
      } else state.timecards = []
      const g0 = newGroup(tierDefault, (state.cats[0] || {}).id || '')
      if (ctx.serviceId && state.items.some(function (i) { return i.id === ctx.serviceId })) {
        g0.mainId = ctx.serviceId
        const svc = state.items.find(function (i) { return i.id === ctx.serviceId })
        if (svc && svc.categoryId) g0.catId = svc.categoryId
      }
      state.groups = [g0]
      state.ready = true
      render()
      schedulePreview()
      /* D28「继续结算」同口径:该预约已有待签单 → 直接进送签态 */
      if (state.bookingId) {
        const r = await request(`/admin/settlements?bookingId=${encodeURIComponent(state.bookingId)}`).catch(function () { return null })
        const pending = ((r && r.settlements) || []).filter(function (x) { return x.status === 'pending_sign' })
        if (pending.length) { state.pendingSheets = pending; render() }
      }
    } catch (e) {
      toast((e && e.message) || '加载价目表失败')
      state.open = false
      render()
    }
  }

  function close() { state.open = false; render(); if (state._deps && state._deps.onClose) state._deps.onClose() }

  /* ===== 渲染(块序照小程序屏序;金额句全部来自后端 preview) ===== */
  function render() {
    const mount = document.querySelector('#settlementComposer')
    if (!mount) return
    const page = mount.closest('.admin-page') || mount.parentElement
    if (!state.open) {
      mount.classList.add('hidden'); mount.innerHTML = ''
      if (page) page.classList.remove('settle-open')
      return
    }
    /* 🔴 店主实测「点了没反应」的真相(2026-08-29 修):事件链一直是通的 ——
       composer 在订单页**顶部**打开,而真店列表 198 单很长,她点的卡在视口下面:
       开单页在她看不见的地方打开了,眼前画面纹丝不动。我走查用的夹具只有 1 张卡,
       页面短所以"看着通"(反例数据律:该用长列表验)。
       修两刀:①开单=一页不是一块 —— 打开时把订单列表整个藏掉(settle-open,与小程序
       navigateTo 的语义对应);②滚回到 composer,人在哪点的都能看见它。 */
    if (page) page.classList.add('settle-open')
    mount.classList.remove('hidden')
    const { escapeHtml } = state._deps
    if (!state.ready) { mount.innerHTML = '<div class="empty-state">加载中…</div>'; window.scrollTo(0, 0); return }
    const v = state.view || {}
    mount.innerHTML = `
      <section class="admin-card settle-composer">
        <div class="section-row compact-row">
          <h2>结算开单${state.customerName ? ` · ${escapeHtml(state.customerName)}` : ''}</h2>
          <button class="ghost slim" data-sw-close type="button">返回订单</button>
        </div>
        ${state.pendingSheets.length ? `
          <div class="sw-pending">该预约已有待签单 ${state.pendingSheets.length} 张 —— 顾客侧签署中;要改单先撤回。
            ${state.pendingSheets.map(function (sheet) { return `<div class="sw-pending-row"><code>${escapeHtml(sheet.code)}</code> 待签</div>` }).join('')}
          </div>` : ''}
        ${state.groups.map(function (g, gi) { return renderGroup(g, gi, escapeHtml) }).join('')}
        <button class="ghost slim" data-sw-add-group type="button">＋ 添加第二个服务项目</button>
        <div class="sw-block" id="swPayBlock">
          <h3>定金 / 券 / 储值</h3>
          ${state.bookingId ? `<label class="sw-check"><input type="checkbox" data-sw-deposit ${state.depositApplied ? 'checked' : ''}> 定金抵扣${state.depositDeductible ? '' : '(本店定金不抵尾款)'}</label>` : ''}
          <label class="sw-check"><input type="checkbox" data-sw-balance ${state.payMenu.useBalance ? 'checked' : ''}> 储值抵扣(勾了才烧余额)</label>
          ${state.couponOptions.length ? `
            <label>券(组①)<select data-sw-coupon>
              <option value="">不用券</option>
              ${state.couponOptions.map(function (o) { return `<option value="${escapeHtml(o.grantId)}" ${state.couponGrantId === o.grantId ? 'selected' : ''} ${o.usable ? '' : 'disabled'}>${escapeHtml(o.title || o.name || o.grantId)}${o.usable ? ` ${escapeHtml(o.deductText || '')}` : `(${escapeHtml(o.reason || '本单用不了')})`}</option>` }).join('')}
            </select></label>` : `<p class="subtle">顾客券包里没有可用券。</p>`}
        </div>
        <div class="sw-block" id="swTotalBlock">
          <h3>合计(后端试算,零前端计算)</h3>
          ${v.detailGroups ? v.detailGroups.map(function (dg) {
            return `<div class="sw-preview-group"><strong>${escapeHtml(dg.title)}</strong>
              ${(dg.lines || []).map(function (l) { return `<div class="sw-line"><span>${escapeHtml(String(l.no || ''))} ${escapeHtml(l.name || '')}</span><span>${escapeHtml(l.amountText || '')}</span></div>` }).join('')}</div>`
          }).join('') : '<p class="subtle">选好项目与技师后自动试算。</p>'}
          ${v.rows ? v.rows.map(function (r) { return `<div class="sw-line sw-pay"><span>${escapeHtml(r.label)}</span><span>${escapeHtml(r.text)}</span></div>` }).join('') : ''}
          ${v.totalText ? `<div class="sw-total"><span>合计</span><strong>${escapeHtml(v.totalText)}</strong></div>` : ''}
          ${(v.warnings || []).map(function (w) { return `<p class="sw-warn">${escapeHtml(w)}</p>` }).join('')}
        </div>
        <button class="primary" data-sw-submit ${state.submitting ? 'disabled' : ''} type="button" id="swSubmitBtn">生成待签结算单(顾客侧签署)</button>
        <p class="subtle">入账唯一路径=签署:这里只生成待签单,签字那一刻才记账。</p>
      </section>
    `
    bind(mount)
    if (!state._scrolled) { state._scrolled = true; window.scrollTo(0, 0) }   // 开单块就在页顶:直接回顶,不与浏览器滚动锚定打架
  }

  function renderGroup(g, gi, escapeHtml) {
    const catItems = state.items.filter(function (i) { return i.itemKind !== 'addon' && (!g.catId || i.categoryId === g.catId) })
    const addons = state.items.filter(function (i) { return i.itemKind === 'addon' })
    return `
      <div class="sw-group" data-gi="${gi}">
        <div class="sw-block"><h3>项目${'①②③④⑤'[gi] || gi + 1} · 价格体系</h3>
          <select data-sw-tier="${gi}">
            ${Object.keys(TIER_LABEL).map(function (k) { return `<option value="${k}" ${g.tierKey === k ? 'selected' : ''}>${TIER_LABEL[k]}${k === g.tierDefault ? '(系统判定)' : ''}</option>` }).join('')}
          </select>
        </div>
        <div class="sw-block" id="swItemsBlock"><h3>服务项目(单选自动替换)</h3>
          <select data-sw-cat="${gi}">
            ${state.cats.map(function (c) { return `<option value="${c.id}" ${g.catId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>` }).join('')}
            ${state.timecards.length ? `<option value="__timecard" ${g.catId === '__timecard' ? 'selected' : ''}>次卡(可核销 ${state.timecards.filter(function (c) { return c.redeemable }).length})</option>` : ''}
          </select>
          ${g.catId === '__timecard' ? `
            <select data-sw-timecard="${gi}">
              <option value="">选一张卡</option>
              ${state.timecards.map(function (c) { return `<option value="${c.id}" ${g.timecardId === c.id ? 'selected' : ''} ${c.redeemable ? '' : 'disabled'}>${escapeHtml(c.name || c.packageName || c.id)}(剩 ${c.remainTimes ?? '-'} 次)</option>` }).join('')}
            </select>
            ${g.timecardId ? `<select data-sw-tcservice="${gi}">
              <option value="">本次核销项目(卡关联)</option>
              ${state.items.filter(function (i) { return i.itemKind !== 'addon' }).map(function (i) { return `<option value="${i.id}" ${g.timecardServiceId === i.id ? 'selected' : ''}>${escapeHtml(i.nameZh || i.name)}</option>` }).join('')}
            </select>` : ''}` : `
            <select data-sw-main="${gi}">
              <option value="">选主项目</option>
              ${catItems.map(function (i) { return `<option value="${i.id}" ${g.mainId === i.id ? 'selected' : ''}>${escapeHtml(i.nameZh || i.name)}</option>` }).join('')}
            </select>`}
        </div>
        <div class="sw-block" id="swAddonBlock"><h3>加项目录</h3>
          ${addons.length ? addons.map(function (a) {
            return `<label class="sw-check"><input type="checkbox" data-sw-addon="${gi}" data-svc="${a.id}" ${g.addonIds[a.id] ? 'checked' : ''}> ${escapeHtml(a.nameZh || a.name)}</label>`
          }).join('') : '<p class="subtle">本店没有加项。</p>'}
        </div>
        <div class="sw-block" id="swCustomBlock"><h3>自选填写行(价目表外项目)</h3>
          ${g.customItems.map(function (c, ci) { return `<div class="sw-line"><span>${escapeHtml(c.name)}</span><span>${(c.amountCents / 100).toFixed(2)} <button class="ghost slim" data-sw-custom-del="${gi}:${ci}" type="button">删</button></span></div>` }).join('')}
          <div class="sw-inline">
            <input data-sw-custom-name="${gi}" placeholder="名目">
            <input data-sw-custom-amount="${gi}" data-money type="text" inputmode="decimal" autocomplete="off" placeholder="金额">
            <button class="ghost slim" data-sw-custom-add="${gi}" type="button">添加</button>
          </div>
        </div>
        <div class="sw-block" id="swTechBlock"><h3>本单技师(本组,1–2 位)</h3>
          ${state.roster.map(function (t) {
            const on = g.selectedTechs.includes(t.id)
            return `<label class="sw-check"><input type="checkbox" data-sw-tech="${gi}" data-tech="${t.id}" ${on ? 'checked' : ''}> ${escapeHtml(t.name)}${on && g.selectedTechs[0] === t.id ? '(主)' : on ? '(副)' : ''}</label>`
          }).join('')}
        </div>
        <div class="sw-block" id="swServedBlock"><h3>被服务者(本组)<span class="subtle"> 朋友不建档:填称呼即可,单据仍推卡主签</span></h3>
          <input data-sw-served="${gi}" placeholder="留空=本人；朋友填称呼" value="${escapeHtml(g.servedPersonName)}">
        </div>
      </div>`
  }

  /* ===== 事件(输入原样进 state,不回写不重画;金额框走 data-money 全局兜底) ===== */
  function bind(mount) {
    const { toast } = state._deps
    mount.querySelector('[data-sw-close]')?.addEventListener('click', close)
    mount.querySelector('[data-sw-add-group]')?.addEventListener('click', function () {
      state.groups.push(newGroup(state.groups[0]?.tierDefault || 'list', (state.cats[0] || {}).id || ''))
      render(); schedulePreview()
    })
    mount.querySelectorAll('[data-sw-tier]').forEach(function (el) {
      el.addEventListener('change', function () {
        const g = state.groups[Number(el.dataset.swTier)]
        g.tierKey = el.value; g.tierChanged = el.value !== g.tierDefault
        render(); schedulePreview()
      })
    })
    mount.querySelectorAll('[data-sw-cat]').forEach(function (el) {
      el.addEventListener('change', function () {
        const g = state.groups[Number(el.dataset.swCat)]
        g.catId = el.value; g.mainId = ''; g.timecardId = ''; g.timecardServiceId = ''
        render(); schedulePreview()
      })
    })
    mount.querySelectorAll('[data-sw-main]').forEach(function (el) {
      el.addEventListener('change', function () { state.groups[Number(el.dataset.swMain)].mainId = el.value; render(); schedulePreview() })
    })
    mount.querySelectorAll('[data-sw-timecard]').forEach(function (el) {
      el.addEventListener('change', function () { const g = state.groups[Number(el.dataset.swTimecard)]; g.timecardId = el.value; g.mainId = ''; render(); schedulePreview() })
    })
    mount.querySelectorAll('[data-sw-tcservice]').forEach(function (el) {
      el.addEventListener('change', function () { state.groups[Number(el.dataset.swTcservice)].timecardServiceId = el.value; render(); schedulePreview() })
    })
    mount.querySelectorAll('[data-sw-addon]').forEach(function (el) {
      el.addEventListener('change', function () {
        const g = state.groups[Number(el.dataset.swAddon)]
        if (el.checked) g.addonIds[el.dataset.svc] = 1
        else delete g.addonIds[el.dataset.svc]
        schedulePreview()
      })
    })
    mount.querySelectorAll('[data-sw-tech]').forEach(function (el) {
      el.addEventListener('change', function () {
        const g = state.groups[Number(el.dataset.swTech)]
        const id = el.dataset.tech
        if (el.checked) {
          if (g.selectedTechs.length >= 2) { el.checked = false; toast('本组最多 2 位技师'); return }
          g.selectedTechs.push(id)
        } else g.selectedTechs = g.selectedTechs.filter(function (x) { return x !== id })
        render(); schedulePreview()
      })
    })
    mount.querySelectorAll('[data-sw-served]').forEach(function (el) {
      /* 🔴 被服务者:输入过程中**原样进 state,不回写、不 trim** —— 姓和名之间打得出空格 */
      el.addEventListener('input', function () { state.groups[Number(el.dataset.swServed)].servedPersonName = el.value })
    })
    mount.querySelectorAll('[data-sw-custom-add]').forEach(function (el) {
      el.addEventListener('click', function () {
        const gi = Number(el.dataset.swCustomAdd)
        const name = (mount.querySelector(`[data-sw-custom-name="${gi}"]`)?.value || '').trim()
        const cents = Math.round(Number(mount.querySelector(`[data-sw-custom-amount="${gi}"]`)?.value || 0) * 100)
        if (!name || !cents) { toast('名目和金额都要填'); return }
        state.groups[gi].customItems.push({ name, amountCents: cents })
        render(); schedulePreview()
      })
    })
    mount.querySelectorAll('[data-sw-custom-del]').forEach(function (el) {
      el.addEventListener('click', function () {
        const [gi, ci] = el.dataset.swCustomDel.split(':').map(Number)
        state.groups[gi].customItems.splice(ci, 1)
        render(); schedulePreview()
      })
    })
    mount.querySelector('[data-sw-deposit]')?.addEventListener('change', function (e) { state.depositApplied = e.target.checked; schedulePreview() })
    mount.querySelector('[data-sw-balance]')?.addEventListener('change', function (e) { state.payMenu.useBalance = e.target.checked; schedulePreview() })
    mount.querySelector('[data-sw-coupon]')?.addEventListener('change', function (e) { state.couponGrantId = e.target.value; schedulePreview() })
    mount.querySelector('[data-sw-submit]')?.addEventListener('click', submit)
  }

  /* ===== 预览:响应次序护栏与小程序同刀(过期响应整包丢弃) ===== */
  let _t = null; let _seq = 0
  function schedulePreview() { clearTimeout(_t); _t = setTimeout(doPreview, 250) }
  async function doPreview() {
    const { request } = state._deps
    if (!state.groups.some(function (g) { return g.mainId || Object.keys(g.addonIds).length || g.customItems.length || g.timecardId })) return
    const seq = ++_seq
    try {
      const r = await request('/admin/settlements/preview', { method: 'POST', body: JSON.stringify(buildBody(state)) })
      if (seq !== _seq) return
      state.preview = r
      const sheets = r.sheets || []
      const pay = (r.group || {}).payment || {}
      state.couponOptions = ((sheets[0] || {}).couponOptions || [])
      state.couponUsableCount = (sheets[0] || {}).couponUsableCount || 0
      const grp = r.group || {}
      const money = state._deps.money
      /* 金额零**算术**:全部数字来自后端 cents,这里只做货币格式化(money()),
         与小程序 doPreview 的 m() 同口径 —— 加减乘除一处都没有。 */
      state.view = {
        detailGroups: sheets.map(function (s, i) {
          const g = state.groups[i] || {}
          const who = g.servedPersonName ? ` · 被服务者:${g.servedPersonName}` : ''
          const techNames = (g.selectedTechs || []).map(function (id) { return (state.roster.find(function (t) { return t.id === id }) || {}).name }).filter(Boolean).join('/')
          return {
            title: `项目${'①②③④⑤'[i] || i + 1}${techNames ? ' · ' + techNames : ''}${who}`,
            lines: (s.lines || []).map(function (l) { return { no: l.itemNo, name: l.name, amountText: l.freeReason ? '免收' : money(l.amountCents || 0, 2) } })
          }
        }),
        rows: [
          (grp.depositDeductCents || 0) > 0 ? { label: '定金抵扣', text: `−${money(grp.depositDeductCents, 2)}` } : null,
          (grp.couponDiscountCents || 0) > 0 ? { label: '券抵扣', text: `−${money(grp.couponDiscountCents, 2)}` } : null,
          (pay.timecardCoverCents || 0) > 0 ? { label: '次卡抵扣', text: `−${money(pay.timecardCoverCents, 2)}` } : null,
          (pay.storedUsedCents || 0) > 0 ? { label: '储值抵扣', text: `−${money(pay.storedUsedCents, 2)}` } : null,
          { label: '到店支付', text: money(pay.offlineDueCents || 0, 2) }
        ].filter(Boolean),
        totalText: money(grp.totalCents || 0, 2),
        warnings: sheets.reduce(function (acc, s) { return acc.concat((s.softWarnings || []).map(function (w) { return w.message })) }, [])
      }
      render()
    } catch (e) {
      if (seq !== _seq) return
      state.view = { warnings: [(e && e.message) || '试算失败'] }
      render()
    }
  }

  async function submit() {
    const { request, toast } = state._deps
    for (let i = 0; i < state.groups.length; i += 1) {
      const g = state.groups[i]
      const hasTc = Boolean(g.timecardId || g.purchasePackageId)
      if (!g.mainId && !Object.keys(g.addonIds).length && !g.customItems.length && !hasTc) { toast(`项目${i + 1} 还没选内容`); return }
      if (hasTc && !g.timecardServiceId) { toast(`项目${i + 1} 请选本次核销项目`); return }
      if (!g.selectedTechs.length) { toast(`项目${i + 1} 先勾本组技师`); return }
    }
    state.submitting = true; render()
    try {
      const r = await request('/admin/settlements', { method: 'POST', body: JSON.stringify(buildBody(state)) })
      state.pendingSheets = r.settlements || []
      toast(`待签结算单已生成(${state.pendingSheets.length} 张)—— 顾客侧签署,签字那一刻才记账`)
    } catch (e) {
      toast((e && e.message) || '开单失败')
    } finally {
      state.submitting = false; render()
    }
  }

  /* 订单页点击转发口(照 DailyCloseRows.handleClick 先例):admin.js 零业务逻辑 */
  function handleClick(event, deps) {
    const btn = event.target.closest('[data-settle-booking]')
    if (!btn) return false
    const bk = (deps.bookings || []).find(function (b) { return b.id === btn.dataset.settleBooking })
    if (!bk) { deps.toast('这张单不在当前列表数据里,刷新后再试'); return true }   // 静默失败器族:找不到必须出声
    open({ bookingId: bk.id, userId: (bk.user && bk.user.id) || '', customerName: (bk.user && bk.user.displayName) || '', serviceId: (bk.service && bk.service.id) || '' }, deps)
    return true
  }

  return { open, close, buildBody, buildSheets, newGroup, handleClick, _state: state }
})()
