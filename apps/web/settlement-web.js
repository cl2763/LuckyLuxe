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
  /* 条目编号显示位(规则⑧,与小程序 noMark 同形):后端 itemNo 从 1 起;超过 10 直接显示数字 */
  const NO_MARKS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']
  const noMark = function (n) { return NO_MARKS[n - 1] || String(n) }

  const state = {
    open: false, ready: false, submitting: false,
    bookingId: '', userId: '', customerName: '',
    cats: [], items: [], roster: [], timecards: [], timecardPackages: [],
    depositDeductible: true, depositApplied: false,
    groups: [], couponGrantId: '', couponOptions: [], couponUsableCount: 0,
    payMenu: { useBalance: true, recharge: false },
    applyFootSurcharge: false, applyTipReuse: false,
    bind: null, couponPanel: false,
    rvDraft: null, rvPanel: null,
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
        rechargePackageId: i === 0 && st.rvDraft && st.rvDraft.packageId ? st.rvDraft.packageId : undefined,
        rechargeAmountCents: i === 0 && st.rvDraft && !st.rvDraft.packageId ? st.rvDraft.amountCents : undefined,
        depositApplied: i === 0 ? st.depositApplied : false,
        couponGrantId: i === 0 ? (st.couponGrantId || undefined) : undefined,
        applyFootSurcharge: i === 0 && !isTcGroup ? Boolean(st.applyFootSurcharge) : false,
        applyTipReuse: i === 0 && !isTcGroup ? Boolean(st.applyTipReuse) : false
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
      payMenu: { useBalance: true, recharge: false }, applyFootSurcharge: false, applyTipReuse: false,
      bind: null, couponPanel: false, rvDraft: null, rvPanel: null, preview: null, view: null, pendingSheets: []
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
      const tp = await request('/admin/timecard-packages').catch(function () { return null })
      state.timecardPackages = (tp && tp.packages) || []
      if (state.userId) {
        const lk = await request(`/admin/customers/lookup?userId=${encodeURIComponent(state.userId)}`).catch(function () { return null })
        state.bind = (lk && lk.hit) || null
        if (state.bind && state.bind.displayName && !state.customerName) state.customerName = state.bind.displayName
      }
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
    const bindInfo = state.bind || {}
    mount.innerHTML = `
      <section class="admin-card settle-composer">
        ${/* ═══ 头部(小程序 .hd):标题 + 顾客行(姓名+脱敏手机号+绑定徽标)═══ */''}
        <div class="section-row compact-row">
          <div>
            <h2>结算开单</h2>
            <div class="sw-s2row">
              ${state.customerName ? `<span class="sw-s2name">${escapeHtml(state.customerName)}</span>` : ''}
              ${bindInfo.phoneMasked ? `<span class="sw-s2phone">${escapeHtml(bindInfo.phoneMasked)}</span>` : ''}
              ${bindInfo.badgeText ? `<span class="sw-s2badge">${escapeHtml(bindInfo.badgeText)}</span>` : ''}
            </div>
          </div>
          <button class="ghost slim" data-sw-close type="button">返回订单</button>
        </div>
        ${state.pendingSheets.length ? `
          <div class="sw-pending">该预约已有待签单 ${state.pendingSheets.length} 张 —— 顾客侧签署中;要改单先撤回。
            ${state.pendingSheets.map(function (sheet) { return `<div class="sw-pending-row"><code>${escapeHtml(sheet.code)}</code> 待签</div>` }).join('')}
          </div>` : ''}
        ${state.groups.map(function (g, gi) { return renderGroup(g, gi, escapeHtml) }).join('')}
        <button class="sw-addmain" data-sw-add-group type="button">＋ 添加第二个服务项目</button>

        ${/* ═══ 单级卡:定金 / 券 / 整单规则(小程序屏 3 上半)═══ */''}
        <div class="sw-card" id="swPayBlock">
          <div class="sw-ch">定金 <span class="sw-hint">按店配收取 · 有收取记录才出开关</span></div>
          ${state.bookingId && state.depositDeductible && (v.depositReceiptCents || 0) > 0 ? `
            <div class="sw-radios">
              <button class="sw-radio ${state.depositApplied ? 'on' : ''}" data-sw-deposit="1" type="button"><span class="sw-dt"></span>已付定金抵扣${v.depositDeduct ? ` <span class="sw-ok">−${escapeHtml(v.depositDeduct)}</span>` : ''}</button>
              <button class="sw-radio ${state.depositApplied ? '' : 'on'}" data-sw-deposit="0" type="button"><span class="sw-dt"></span>未付定金</button>
            </div>`
          : (state.depositDeductible
            ? '<p class="sw-empty">这张单没有定金收取记录,没有可抵扣的定金</p>'
            : '<p class="sw-empty">本店定金不抵扣尾款（门店设置 → 定金与取消规则）</p>')}

          <button class="sw-cpnline" data-sw-coupon-open type="button">
            <span class="l">优惠券</span>
            ${state.couponGrantId && couponPickedOf() ? `<span class="v ok">${escapeHtml(couponPickedOf().title || couponPickedOf().name || '')} ${escapeHtml(couponPickedOf().deductText || '')}</span><span class="arr">›</span>`
              : (state.couponUsableCount ? `<span class="v">顾客有 ${state.couponUsableCount} 张可用券</span><span class="arr">›</span>` : '<span class="v mut">无可用券</span>')}
          </button>

          <div class="sw-gh">整单规则</div>
          <div class="sw-item"><span class="sw-iname wide">足部美甲<span class="sw-sub">手部基础上整单加收</span></span>
            <button class="sw-sw ${state.applyFootSurcharge ? 'on' : ''}" data-sw-foot type="button" aria-label="足部美甲"><span class="sw-dot"></span></button></div>
          <div class="sw-item"><span class="sw-iname wide">甲片重复利用<span class="sw-sub">固定价 · 仅限本店甲片</span></span>
            <button class="sw-sw ${state.applyTipReuse ? 'on' : ''}" data-sw-tipreuse type="button" aria-label="甲片重复利用"><span class="sw-dot"></span></button></div>
        </div>

        ${/* ═══ 支付构成 · 菜单式(小程序屏 3 中):勾"路",金额全部后端算 ═══ */''}
        <div class="sw-card">
          <div class="sw-ch">支付构成 · 菜单式 <span class="sw-hint">勾选支付方式,金额后端算</span></div>
          <button class="sw-paym ${state.payMenu.useBalance && v.hasStored ? 'on' : ''}" data-sw-balance type="button">
            <span class="sw-ck ${state.payMenu.useBalance && v.hasStored ? 'on' : ''}">${state.payMenu.useBalance && v.hasStored ? '✓' : ''}</span>
            <span class="sw-pmain"><b>储值卡抵扣</b><span class="sw-psmall">${v.balance ? `可用余额 ${escapeHtml(v.balance)}${escapeHtml(v.rvNote || '')}` : '勾了才烧余额'}${state.payMenu.useBalance && v.hasStored ? ` → 本单抵 ${escapeHtml(v.storedDeduct)}` : (state.payMenu.useBalance ? ' · 本单无可抵金额' : '')}</span></span>
          </button>
          <div class="sw-paym passive">
            <span class="sw-pmark">→</span>
            <span class="sw-pmain"><b>到店收 · 差额自动</b><span class="sw-psmall">现金/扫码/POS · 差额 ${escapeHtml(v.offlineDue || '—')}(其余支付方式结清后的余数,自动算)</span></span>
          </div>
          <button class="sw-paym ${state.payMenu.recharge ? 'on' : ''}" data-sw-recharge type="button">
            <span class="sw-ck ${state.payMenu.recharge ? 'on' : ''}">${state.payMenu.recharge ? '✓' : ''}</span>
            <span class="sw-pmain"><b>随单充值(签字生效)</b>　<span class="sw-rvlink ${state.bind && state.bind.bound ? '' : 'dis'}" data-sw-rv-open>${state.rvDraft ? '改充值 →' : '去挂充值 →'}</span>
              ${state.userId && state.bind && !state.bind.bound ? '<span class="sw-bindbar">未绑定档案不可充值 —— 本单签字时顾客扫码即完成绑定,下一单就能随单充值</span>' : ''}
              <span class="sw-psmall">${state.rvDraft ? `已挂:${escapeHtml(state.rvDraft.label)};签字那一刻才入账,充完即抵本单` : '挂到本单一起签:签字那一刻充值才入账,充完即抵本单'}</span></span>
          </button>
          <p class="sw-paynote">勾/不勾任何一项,金额分解都由后端重新算出并回显;不勾储值=全额线下。</p>
          ${(v.warnings || []).map(function (w) { return `<p class="sw-warn">${escapeHtml(w)}</p>` }).join('')}
        </div>

        ${/* ═══ 分组明细 + 合计(小程序 .total):原价合计与共优惠行不许丢 ═══ */''}
        <div class="sw-card sw-total-card" id="swTotalBlock">
          ${v.detailGroups ? v.detailGroups.map(function (dg) {
            return `<div class="sw-mg">${escapeHtml(dg.title)}</div>
              ${(dg.lines || []).map(function (l) { return `<div class="sw-dtl"><span class="sw-dtl-n">${escapeHtml(l.name || '')}${l.qty > 1 ? ' ×' + l.qty : ''}</span><span class="sw-dtl-r">${l.list ? `<span class="sw-mut sw-strike">${escapeHtml(l.list)}</span>` : ''}<span class="sw-dtl-a">${escapeHtml(l.amountText || '')}</span></span></div>` }).join('')}`
          }).join('') : '<p class="sw-empty">选好项目与技师后自动试算。</p>'}
          ${v.listTotal ? `<div class="sw-tl"><span>原价合计</span><span class="sw-strike">${escapeHtml(v.listTotal)}</span></div>` : ''}
          ${v.subtotal ? `<div class="sw-tl"><span>档位小计</span><span>${escapeHtml(v.subtotal)}</span></div>` : ''}
          ${v.discountTotal ? `<div class="sw-tl save"><span>${escapeHtml(v.discountLabel || '较原价共优惠')}</span><span>${escapeHtml(v.discountTotal)}</span></div>` : ''}
          ${v.timecardCover ? `<div class="sw-tl save"><span>次卡抵扣(签字扣次)</span><span>−${escapeHtml(v.timecardCover)}</span></div>` : ''}
          ${v.storedDeduct && v.hasStored ? `<div class="sw-tl"><span>储值抵扣</span><span>−${escapeHtml(v.storedDeduct)}</span></div>` : ''}
          ${v.depositDeduct && state.depositApplied ? `<div class="sw-tl"><span>定金抵扣</span><span>−${escapeHtml(v.depositDeduct)}</span></div>` : ''}
          ${v.couponDeduct ? `<div class="sw-tl save"><span>券抵扣</span><span>−${escapeHtml(v.couponDeduct)}</span></div>` : ''}
          ${v.hasPurchase ? `<div class="sw-tl"><span>现场购卡${v.purchaseName ? ' · ' + escapeHtml(v.purchaseName) : ''}(购卡款,预收)</span><span>+${escapeHtml(v.purchaseAmount)}</span></div>` : ''}
          ${v.hasRecharge ? `<div class="sw-tl"><span>本次充值实收(签字生效)</span><span>+${escapeHtml(v.rechargeAmount)}</span></div>` : ''}
          ${v.hasRecharge && v.rechargeBonus ? `<div class="sw-tl save"><span>充值赠送(营销让利)</span><span>+${escapeHtml(v.rechargeBonus)}</span></div>` : ''}
          ${v.hasRecharge && v.afterBalance ? `<div class="sw-tl"><span>充后余额(预计)</span><span>${escapeHtml(v.afterBalance)}</span></div>` : ''}
          ${v.totalText ? `<div class="sw-tl big"><span>到店应收</span><span>${escapeHtml(v.totalText)}</span></div>` : ''}
        </div>

        <button class="sw-cta" data-sw-submit ${state.submitting ? 'disabled' : ''} type="button" id="swSubmitBtn">${state.submitting ? '提交中…' : '生成待签结算单(顾客侧签署)'}</button>
        <p class="sw-foot">金额全部由后端计价引擎算出，本页不做任何金额运算 · 入账唯一路径=签署</p>
      </section>
      ${state.couponPanel ? renderCouponPanel(escapeHtml) : ''}
      ${state.rvPanel ? renderRvPanel(escapeHtml) : ''}
    `
    bind(mount)
    if (!state._scrolled) { state._scrolled = true; window.scrollTo(0, 0) }   // 开单块就在页顶:直接回顶,不与浏览器滚动锚定打架
  }

  const TIERS = [
    { key: 'list', label: '原价' }, { key: 'share', label: '分享价' },
    { key: 'member', label: '会员价' }, { key: 'course', label: '疗程价' }
  ]
  const TIER_PRICE_FIELD = { list: 'listPriceCents', share: 'sharePriceCents', member: 'memberPriceCents', course: 'coursePriceCents' }

  function priceCentsOf(it, tierKey) {
    const c = it[TIER_PRICE_FIELD[tierKey]]
    return (c === null || c === undefined) ? (it.listPriceCents ?? it.priceCents ?? 0) : c
  }

  /* 挂充值面板(死口清剿·三:原「先用小程序办」当批接回本端;与小程序 rvsheet 同句同件,
     金额三行由后端预览回显 —— 本页零运算;D55:挂充不联动勾储值) */
  function renderRvPanel(escapeHtml) {
    const p = state.rvPanel
    return `
      <div class="sw-cpnmask" data-sw-rv-close></div>
      <div class="sw-cpnsheet">
        <div class="sw-ch">帮 ${escapeHtml(state.customerName || '顾客')} 随单充值</div>
        ${p.pkgs.length ? '<p class="sw-hint-line">选充值套餐(充X赠Y,赠额后端按套餐算)</p>' : ''}
        <div class="sw-cpnlist">
          ${p.pkgs.map(function (o) {
            return `<button class="sw-cpn ${p.packageId === o.id ? 'on' : ''}" data-sw-rv-pick="${escapeHtml(o.id)}" type="button">${escapeHtml(o.label)}</button>`
          }).join('')}
        </div>
        <p class="sw-hint-line">或手输金额(无赠送)</p>
        <input type="text" inputmode="decimal" id="swRvAmt" placeholder="充值金额" value="${escapeHtml(p.amount || '')}">
        <p class="sw-hint-line">挂到本单一起签:签字那一刻充值才入账、随即抵扣本单,签署单上分行列明「充值实收 / 本单抵扣 / 充后余额」。未签退出=什么都没发生。</p>
        <button class="sw-cpnok" data-sw-rv-ok type="button">挂到本单(签字生效)</button>
        ${state.rvDraft ? '<button class="sw-cpn dis" data-sw-rv-remove type="button">移除本单充值</button>' : ''}
      </div>`
  }

  function couponPickedOf() {
    return state.couponOptions.find(function (o) { return o.grantId === state.couponGrantId }) || null
  }

  function renderGroup(g, gi, escapeHtml) {
    const money = state._deps.money
    const mains = state.items.filter(function (i) { return (i.itemKind || 'main') === 'main' && (i.categoryId || '') === g.catId })
    const addons = state.items.filter(function (i) { return i.itemKind === 'addon' })
    const isTc = g.catId === '__timecard'
    const decorateRow = function (it, on, qty) {
      const cents = priceCentsOf(it, isTc ? 'list' : g.tierKey)
      const listC = it.listPriceCents ?? cents
      return `<span class="sw-pr">${listC !== cents ? `<span class="sw-mut sw-strike">${money(listC, 2)}</span>` : ''}<span class="sw-now${cents === 0 ? ' free' : ''}">${cents === 0 ? '免收' : money(cents, 2)}</span></span>`
    }
    return `
      <div class="sw-card sw-group" data-gi="${gi}">
        <div class="sw-ch">服务项目 ${'①②③④⑤'[gi] || gi + 1}
          ${gi > 0 ? `<button class="ghost slim sw-grpx" data-sw-remove-group="${gi}" type="button">✕ 移除此项目</button>` : ''}
        </div>

        ${/* 价格体系:chips 单选(小程序同形;次卡组隐藏整排) */''}
        ${!isTc ? `
        <div class="sw-sec">价格体系(本组独立) <span class="sw-hint">${g.tierChanged ? '已改档，将留痕' : '默认按会员判定'}</span></div>
        <div class="sw-chiprow" id="swItemsBlock">
          ${TIERS.map(function (t2) { return `<button class="sw-chip ${g.tierKey === t2.key ? 'on' : ''}" data-sw-tier="${gi}" data-k="${t2.key}" type="button">${t2.label}${t2.key === g.tierDefault ? '(默认)' : ''}</button>` }).join('')}
        </div>` : '<div class="sw-sec">次卡为独立消费 <span class="sw-hint">按折算价/套餐价,不叠加会员价与优惠</span></div>'}

        ${/* 服务项目:大类横排 chips + 项目列表行(勾框+名+划线价+现价),单选自动替换 */''}
        <div class="sw-sec">服务项目(单选自动替换)</div>
        <div class="sw-chiprow sw-cattabs">
          ${state.cats.map(function (c) { return `<button class="sw-chip ${g.catId === c.id ? 'on' : ''}" data-sw-cat="${gi}" data-id="${c.id}" type="button">${escapeHtml(c.name)}</button>` }).join('')}
          ${(state.timecards.length || state.timecardPackages.length) ? `<button class="sw-chip ${isTc ? 'on' : ''}" data-sw-cat="${gi}" data-id="__timecard" type="button">次卡<span class="sw-tcbadge">${state.timecards.filter(function (c) { return c.redeemable }).length}</span></button>` : ''}
        </div>
        ${isTc ? `
          ${state.timecards.map(function (c) {
            return `<button class="sw-item sw-tccard ${c.redeemable ? '' : 'tcdead'}" data-sw-timecard="${gi}" data-id="${c.id}" type="button" ${c.redeemable ? '' : 'disabled'}>
              <span class="sw-ck ${g.timecardId === c.id ? 'on' : ''}">${g.timecardId === c.id ? '✓' : ''}</span>
              <span class="sw-iname">${escapeHtml(c.label || c.name || c.packageName || c.id)}${c.expired ? '<span class="sw-tcexp">已过期</span>' : ''}</span>
            </button>`
          }).join('')}
          ${state.timecardPackages.length ? `
            <div class="sw-sec">＋ 现场购卡(顾客没卡?当场买当场用)</div>
            ${state.timecardPackages.map(function (p2) {
              const on2 = g.purchasePackageId === p2.id
              return `<button class="sw-item sw-tccard" data-sw-tcpkg="${gi}" data-id="${p2.id}" type="button">
                <span class="sw-ck ${on2 ? 'on' : ''}">${on2 ? '✓' : ''}</span>
                <span class="sw-iname">${escapeHtml(p2.label || p2.name || p2.id)}</span>
              </button>`
            }).join('')}` : ''}
          ${(function () {
            const card2 = state.timecards.find(function (c) { return c.id === g.timecardId })
            const pkg2 = state.timecardPackages.find(function (p2) { return p2.id === g.purchasePackageId })
            const tcMode = card2 ? 'redeem' : (pkg2 ? 'purchase' : '')
            if (!tcMode) return ''
            const groupName = card2 ? card2.projectGroup : (pkg2 ? pkg2.projectGroup : null)
            const catNameOf = function (cid) { return ((state.cats.find(function (c2) { return c2.id === cid }) || {}).name) || '' }
            const svcs = state.items.filter(function (i) { return (i.itemKind || 'main') === 'main' })
              .filter(function (i) { return !groupName || catNameOf(i.categoryId) === groupName })
            const tcName = card2 ? (card2.name || '') : (pkg2 ? (pkg2.name || '') : '')
            const mainName = tcMode === 'redeem' ? `次卡核销 · ${tcName}` : `现场购卡 · ${tcName}(当场核销第 1 次)`
            return `<div class="sw-sec">本次核销项目(${tcMode === 'purchase' ? '新卡' : '卡'}关联组内选)</div>
            <div class="sw-chiprow">
              ${svcs.map(function (i) { return `<button class="sw-chip ${g.timecardServiceId === i.id ? 'on' : ''}" data-sw-tcservice="${gi}" data-id="${i.id}" type="button">${escapeHtml(i.nameZh || i.name)}</button>` }).join('')}
            </div>
            ${svcs.length ? '' : '<p class="sw-hint-line">卡关联组内暂无在售项目</p>'}
            <p class="sw-hint-line">本组:${escapeHtml(mainName)}(金额=折算单价,签字${tcMode === 'purchase' ? '购卡+扣第 1 次' : '扣一次'})</p>`
          })()}`
        : `
          ${mains.map(function (it) {
            const on = g.mainId === it.id
            return `<button class="sw-item" data-sw-main="${gi}" data-id="${it.id}" type="button">
              <span class="sw-ck ${on ? 'on' : ''}">${on ? '✓' : ''}</span>
              <span class="sw-iname">${escapeHtml(it.nameZh || it.name)}</span>
              ${decorateRow(it, on, 1)}
            </button>`
          }).join('')}
          ${mains.length ? '' : '<p class="sw-empty">该大类下暂无在售项目</p>'}
          ${g.mainId ? `<p class="sw-grppicked">本组主项目:${escapeHtml((state.items.find(function (i) { return i.id === g.mainId }) || {}).nameZh || '')}(点其他大类里的项目=替换)</p>` : ''}`}

        ${/* 加项:列表行勾选;按指计价的用 stepper(− n指 ＋) */''}
        <div class="sw-sec" id="swAddonBlock">加项目录 <span class="sw-hint">按本组价格档计价</span></div>
        ${addons.length ? addons.map(function (a) {
          const qty = g.addonIds[a.id] || 0
          const on = Object.prototype.hasOwnProperty.call(g.addonIds, a.id)
          if (a.unit === 'per_finger') {
            return `<div class="sw-item"><span class="sw-iname wide">${escapeHtml(a.nameZh || a.name)}</span>
              <span class="sw-stepper"><button class="sw-sb" data-sw-step="${gi}" data-svc="${a.id}" data-d="-1" type="button">−</button><span class="sw-qn">${qty} 指</span><button class="sw-sb" data-sw-step="${gi}" data-svc="${a.id}" data-d="1" type="button">＋</button></span></div>`
          }
          return `<button class="sw-item" data-sw-addon="${gi}" data-svc="${a.id}" type="button">
            <span class="sw-ck ${on ? 'on' : ''}">${on ? '✓' : ''}</span>
            <span class="sw-iname">${escapeHtml(a.nameZh || a.name)}</span>
            ${decorateRow(a, on, qty)}
          </button>`
        }).join('') : '<p class="sw-empty">本店没有加项。</p>'}

        ${/* 自选填写行(小程序 inputline 同形) */''}
        <div class="sw-sec" id="swCustomBlock">自选填写行(本组) <span class="sw-hint">价目表外项目</span></div>
        <div class="sw-inputline">
          <input class="sw-in" data-sw-custom-name="${gi}" placeholder="项目名称（例：钻球）">
          <input class="sw-in amt" data-sw-custom-amount="${gi}" data-money type="text" inputmode="decimal" autocomplete="off" placeholder="金额">
          <button class="sw-addbtn" data-sw-custom-add="${gi}" type="button">＋添加</button>
        </div>
        ${g.customItems.map(function (c, ci) { return `<button class="sw-cst" data-sw-custom-del="${gi}:${ci}" type="button"><span>${escapeHtml(c.name)}</span><span class="sw-cst-r"><span class="sw-cst-amt">${money(c.amountCents, 2)}</span><span class="sw-del">移除</span></span></button>` }).join('')}

        ${/* 技师:chips(小程序 roster 同形) */''}
        <div class="sw-sec" id="swTechBlock">本单技师(本组,1–2 位) <span class="sw-hint">双技师分成由店长日结核定</span></div>
        <div class="sw-chiprow sw-roster">
          ${state.roster.map(function (t2) {
            const on = g.selectedTechs.includes(t2.id)
            return `<button class="sw-chip ${on ? 'on' : ''}" data-sw-tech="${gi}" data-tech="${t2.id}" type="button">${escapeHtml(t2.name)}${on && g.selectedTechs[0] === t2.id ? '(主)' : on ? '(副)' : ''}</button>`
          }).join('')}
        </div>
        ${(function () {
          const dg = state.view && state.view.detailGroups && state.view.detailGroups[gi]
          const numLines = dg ? (dg.lines || []).filter(function (l) { return l.kind !== 'rule' && l.no }) : []
          if (g.selectedTechs.length !== 2 || !numLines.length) return ''
          return `<div class="sw-numlist">${numLines.map(function (l) { return `<span class="sw-numrow"><b>${noMark(l.no)}</b> ${escapeHtml(l.name)}</span>` }).join('')}</div>
          ${g.selectedTechs.map(function (tid2) {
            const tn = (state.roster.find(function (t2) { return t2.id === tid2 }) || {}).name || ''
            const nos = (g.techItems[tid2] || [])
            return `<div class="sw-techrow"><span class="sw-tn">${escapeHtml(tn)}</span>
              ${numLines.map(function (l) { return `<button class="sw-chip mini ${nos.includes(l.no) ? 'on' : ''}" data-sw-technos="${gi}" data-tech="${tid2}" data-no="${l.no}" type="button">${noMark(l.no)}</button>` }).join('')}
            </div>`
          }).join('')}
          <p class="sw-hint-line">每人点自己做的编号,可两人都点=共做;分成金额店长日结核定,此处只记录</p>`
        })()}

        ${/* 被服务者:input full(输入过程原样,不 trim 不重画) */''}
        <div class="sw-sec" id="swServedBlock">被服务者(本组) <span class="sw-hint">朋友不建档:填称呼即可,单据仍推卡主签</span></div>
        <input class="sw-in full" data-sw-served="${gi}" placeholder="留空=本人；朋友填称呼" value="${escapeHtml(g.servedPersonName)}">
      </div>`
  }

  function renderCouponPanel(escapeHtml) {
    return `
      <div class="sw-cpnmask" data-sw-coupon-close></div>
      <div class="sw-cpnsheet">
        <div class="sw-ch">选择优惠券 · ${escapeHtml(state.customerName || '顾客')}的券包</div>
        <div class="sw-cpnlist">
          ${state.couponOptions.map(function (o) {
            return `<button class="sw-cpn ${o.usable ? '' : 'dis'} ${state.couponGrantId === o.grantId ? 'on' : ''}" data-sw-coupon-pick="${escapeHtml(o.grantId)}" type="button" ${o.usable ? '' : 'disabled'}>
              <span class="l"><span class="n">${escapeHtml(o.title || o.name || '')}</span><span class="s">${escapeHtml(o.usable ? (o.subtitle || '') : (o.reason || '本单用不了'))}</span></span>
              ${o.usable ? `<span class="d">${escapeHtml(o.deductText || '')}</span>` : ''}
            </button>`
          }).join('')}
          <button class="sw-cpn ${state.couponGrantId ? '' : 'on'}" data-sw-coupon-pick="" type="button">
            <span class="l"><span class="n">不使用优惠券</span><span class="s">本单不抵扣</span></span>
          </button>
        </div>
        <button class="sw-cpnok" data-sw-coupon-close type="button">确定</button>
      </div>`
  }

  /* ===== 事件(输入原样进 state,不回写不重画;金额框走 data-money 全局兜底) ===== */
  function bind(mount) {
    const { toast } = state._deps
    const on = function (sel, fn) { mount.querySelectorAll(sel).forEach(function (el) { el.addEventListener('click', function (e2) { fn(el, e2) }) }) }
    mount.querySelector('[data-sw-close]')?.addEventListener('click', close)
    on('[data-sw-add-group]', function () {
      state.groups.push(newGroup(state.groups[0]?.tierDefault || 'list', (state.cats[0] || {}).id || ''))
      render(); schedulePreview()
    })
    on('[data-sw-remove-group]', function (el) { state.groups.splice(Number(el.dataset.swRemoveGroup), 1); render(); schedulePreview() })
    on('[data-sw-tier]', function (el) {
      const g = state.groups[Number(el.dataset.swTier)]
      g.tierKey = el.dataset.k; g.tierChanged = el.dataset.k !== g.tierDefault
      render(); schedulePreview()
    })
    on('[data-sw-cat]', function (el) {
      const g = state.groups[Number(el.dataset.swCat)]
      g.catId = el.dataset.id
      if (el.dataset.id !== '__timecard') { g.timecardId = ''; g.timecardServiceId = '' }
      render(); schedulePreview()
    })
    on('[data-sw-main]', function (el) {
      const g = state.groups[Number(el.dataset.swMain)]
      g.mainId = g.mainId === el.dataset.id ? '' : el.dataset.id   // 单选自动替换;再点=取消
      if (g.mainId && (g.timecardId || g.purchasePackageId)) {
        g.timecardId = ''; g.purchasePackageId = ''; g.timecardServiceId = ''
        toast('本组切回普通开单,已取消次卡')
      }
      render(); schedulePreview()
    })
    on('[data-sw-timecard]', function (el) {
      const g = state.groups[Number(el.dataset.swTimecard)]
      if (g.timecardId === el.dataset.id) { g.timecardId = ''; g.timecardServiceId = '' }
      else {
        g.timecardId = el.dataset.id
        g.timecardServiceId = ''
        g.purchasePackageId = ''
        if (g.mainId) { g.mainId = ''; toast('本组切为次卡核销,已清除主项目') }
      }
      render(); schedulePreview()
    })
    on('[data-sw-tcpkg]', function (el) {
      const g = state.groups[Number(el.dataset.swTcpkg)]
      if (g.purchasePackageId === el.dataset.id) { g.purchasePackageId = ''; g.timecardServiceId = '' }
      else {
        g.purchasePackageId = el.dataset.id
        g.timecardServiceId = ''
        g.timecardId = ''
        if (g.mainId) { g.mainId = ''; toast('本组切为现场购卡,已清除主项目') }
      }
      render(); schedulePreview()
    })
    on('[data-sw-tcservice]', function (el) {
      const g = state.groups[Number(el.dataset.swTcservice)]
      g.timecardServiceId = g.timecardServiceId === el.dataset.id ? '' : el.dataset.id
      render(); schedulePreview()
    })
    on('[data-sw-addon]', function (el) {
      const g = state.groups[Number(el.dataset.swAddon)]
      if (Object.prototype.hasOwnProperty.call(g.addonIds, el.dataset.svc)) delete g.addonIds[el.dataset.svc]
      else g.addonIds[el.dataset.svc] = 1
      render(); schedulePreview()
    })
    on('[data-sw-step]', function (el) {
      const g = state.groups[Number(el.dataset.swStep)]
      const id = el.dataset.svc
      const next = Math.max(0, (g.addonIds[id] || 0) + Number(el.dataset.d))
      if (next === 0) delete g.addonIds[id]
      else g.addonIds[id] = next
      render(); schedulePreview()
    })
    on('[data-sw-tech]', function (el) {
      const g = state.groups[Number(el.dataset.swTech)]
      const id = el.dataset.tech
      if (g.selectedTechs.includes(id)) g.selectedTechs = g.selectedTechs.filter(function (x) { return x !== id })
      else {
        if (g.selectedTechs.length >= 2) { toast('本组最多 2 位技师'); return }
        g.selectedTechs.push(id)
      }
      render(); schedulePreview()
    })
    mount.querySelectorAll('[data-sw-served]').forEach(function (el) {
      /* 🔴 被服务者:输入过程中**原样进 state,不回写、不 trim** —— 姓和名之间打得出空格 */
      el.addEventListener('input', function () { state.groups[Number(el.dataset.swServed)].servedPersonName = el.value })
    })
    on('[data-sw-custom-add]', function (el) {
      const gi = Number(el.dataset.swCustomAdd)
      const name = (mount.querySelector(`[data-sw-custom-name="${gi}"]`)?.value || '').trim()
      const cents = Math.round(Number(mount.querySelector(`[data-sw-custom-amount="${gi}"]`)?.value || 0) * 100)
      if (!name || !cents) { toast('名目和金额都要填'); return }
      state.groups[gi].customItems.push({ name, amountCents: cents })
      render(); schedulePreview()
    })
    on('[data-sw-custom-del]', function (el) {
      const parts = el.dataset.swCustomDel.split(':')
      state.groups[Number(parts[0])].customItems.splice(Number(parts[1]), 1)
      render(); schedulePreview()
    })
    on('[data-sw-deposit]', function (el) { state.depositApplied = el.dataset.swDeposit === '1'; render(); schedulePreview() })
    on('[data-sw-balance]', function () {
      const m = state.payMenu
      state.payMenu = { useBalance: !m.useBalance, recharge: m.useBalance ? false : m.recharge }
      render(); schedulePreview()
    })
    on('[data-sw-foot]', function () { state.applyFootSurcharge = !state.applyFootSurcharge; render(); schedulePreview() })
    on('[data-sw-tipreuse]', function () { state.applyTipReuse = !state.applyTipReuse; render(); schedulePreview() })
    on('[data-sw-coupon-open]', function () {
      if (!state.couponOptions.length) { toast('顾客券包里没有券'); return }
      state.couponPanel = true; render()
    })
    on('[data-sw-coupon-close]', function () { state.couponPanel = false; render() })
    on('[data-sw-coupon-pick]', function (el) {
      const id = el.dataset.swCouponPick || ''
      const picked = state.couponOptions.find(function (o) { return o.grantId === id })
      if (id && picked && !picked.usable) { toast(picked.reason || '这张券本单用不了'); return }
      state.couponGrantId = id; state.couponPanel = false
      render(); schedulePreview()
    })
    /* 随单充值(死口清剿·三接回):行为逐条镜像小程序 payToggleRecharge/rvPickPkg/rvConfirm/rvRemove;
       D55 同刀:挂充**不联动**勾储值 —— 储值意愿只由店员自己勾 */
    on('[data-sw-recharge]', function () {
      if (state.rvDraft) {
        state.rvDraft = null; state.payMenu.recharge = false
        render(); schedulePreview(); return
      }
      openRvPanel()
    })
    on('[data-sw-rv-open]', function (el, e2) { e2.stopPropagation(); openRvPanel() })   // catchtap 同刀:别冒泡进外层勾选行
    on('[data-sw-rv-close]', function () { state.rvPanel = null; render() })
    on('[data-sw-rv-pick]', function (el) {
      const id = el.dataset.swRvPick
      state.rvPanel = Object.assign({}, state.rvPanel, { packageId: state.rvPanel.packageId === id ? '' : id, amount: '' })
      render()
    })
    mount.querySelector('#swRvAmt')?.addEventListener('input', function (ev) {
      const hadPkg = Boolean(state.rvPanel && state.rvPanel.packageId)
      state.rvPanel = Object.assign({}, state.rvPanel, { amount: ev.target.value, packageId: '' })
      if (hadPkg) { render(); mount.querySelector('#swRvAmt')?.focus() }   // 手输清选档要见得到;无选档时不重渲染,保光标
    })
    on('[data-sw-rv-ok]', function () {
      const p = state.rvPanel
      if (!p) return
      let draft = null
      if (p.packageId) {
        const pkg = p.pkgs.find(function (x) { return x.id === p.packageId })
        if (!pkg) { toast('请重新选充值套餐'); return }
        draft = { packageId: pkg.id, label: pkg.label }
      } else {
        const payCents = Math.round(Number(String(p.amount || '').replace(/[^\d.]/g, '')) * 100)
        if (!Number.isFinite(payCents) || payCents <= 0) { toast('金额不对'); return }
        draft = { packageId: '', amountCents: payCents, label: '手输金额(无赠送)' }
      }
      state.rvDraft = draft; state.rvPanel = null; state.payMenu.recharge = true
      render(); schedulePreview()
    })
    on('[data-sw-rv-remove]', function () {
      state.rvDraft = null; state.rvPanel = null; state.payMenu.recharge = false
      render(); schedulePreview()
    })
    /* 双技师编号分配(死口清剿·三接回):每人点自己做的编号,可共做;buildSheets 原样带走 */
    on('[data-sw-technos]', function (el) {
      const g = state.groups[Number(el.dataset.swTechnos)]
      if (!g) return
      const tid = el.dataset.tech; const no = Number(el.dataset.no)
      const cur = (g.techItems[tid] || []).slice()
      const at = cur.indexOf(no)
      if (at >= 0) cur.splice(at, 1); else cur.push(no)
      g.techItems = Object.assign({}, g.techItems); g.techItems[tid] = cur
      render(); schedulePreview()
    })
    mount.querySelector('[data-sw-submit]')?.addEventListener('click', submit)
    /* 券弹层挂在 mount 外?不 —— 就在 composer 模板尾部,同一 mount,选择器都能找到 */
  }

  async function openRvPanel() {
    if (!state.userId || !state.bind || !state.bind.bound) {
      state._deps.toast('请先让顾客扫码绑定(会员码/签署码)再充值')
      return
    }
    let pkgs = []
    try { pkgs = ((await state._deps.request('/admin/recharge-packages')) || {}).packages || [] } catch (e) { /* 无套餐也能手输 */ }
    const cur = state.rvDraft
    state.rvPanel = {
      amount: cur && !cur.packageId ? String(cur.amountCents / 100) : '',
      packageId: cur ? (cur.packageId || '') : '',
      pkgs
    }
    render()
  }

  /* ===== 预览:响应次序护栏与小程序同刀(过期响应整包丢弃) ===== */
  let _t = null; let _seq = 0
  function schedulePreview() { clearTimeout(_t); _t = setTimeout(doPreview, 250) }
  async function doPreview() {
    /* C2 裁(08-30):空态守卫拆除 —— 小程序 doPreview 从来不设守卫,后端对空单回 200 合法零单
       (后端是最终闸)。守卫=前端多养一份「什么算空」的定义,D86(漏认购卡组)就是它咬的第一口。 */
    const { request } = state._deps
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
      const pay2 = pay
      state.view = {
        detailGroups: sheets.map(function (s2, i) {
          const g = state.groups[i] || {}
          const who = g.servedPersonName ? ` · 被服务者:${g.servedPersonName}` : ''
          const techNames = (g.selectedTechs || []).map(function (id) { return (state.roster.find(function (t2) { return t2.id === id }) || {}).name }).filter(Boolean).join('/')
          const mainName = (state.items.find(function (it) { return it.id === g.mainId }) || {}).nameZh || ''
          return {
            title: `项目${'①②③④⑤'[i] || i + 1} ${mainName || '(未选主项目)'}${techNames ? ' · ' + techNames : ''}${who}`,
            lines: (s2.lines || []).map(function (l) {
              return {
                no: l.itemNo, kind: l.kind, name: l.name, qty: l.qty,
                amountText: l.amountCents === 0 ? '免收' : money(l.amountCents, 2),
                list: l.listAmountCents !== l.amountCents && l.listAmountCents != null ? money(l.listAmountCents, 2) : ''
              }
            })
          }
        }),
        listTotal: money(grp.listTotalCents || 0, 2),
        subtotal: money(grp.subtotalCents || 0, 2),
        discountTotal: (grp.discountTotalCents || 0) > 0 ? money(grp.discountTotalCents, 2) : '',
        discountLabel: (grp.couponDiscountCents || 0) > 0 ? '共优惠（含券）' : '较原价共优惠',
        couponDeduct: (grp.couponDiscountCents || 0) > 0 ? money(grp.couponDiscountCents, 2) : '',
        depositDeduct: (grp.depositDeductCents || 0) > 0 ? money(grp.depositDeductCents, 2) : '',
        depositReceiptCents: grp.depositReceiptCents || 0,
        timecardCover: (pay2.timecardCoverCents || 0) > 0 ? money(pay2.timecardCoverCents, 2) : '',
        hasStored: (pay2.storedUsedCents || 0) > 0,
        storedDeduct: money(pay2.storedUsedCents || 0, 2),
        balance: (pay2.balanceAvailableCents || 0) > 0 ? money(pay2.balanceAvailableCents, 2) : '',
        offlineDue: money(pay2.offlineDueCents || 0, 2),
        hasPurchase: (pay2.purchaseCents || 0) > 0,
        purchaseAmount: money(pay2.purchaseCents || 0, 2),
        purchaseName: (function () { const sp = sheets.find(function (s3) { return s3.purchase }); return sp && sp.purchase ? sp.purchase.name : '' })(),
        hasRecharge: (pay2.rechargeCents || 0) > 0,
        rechargeAmount: money(pay2.rechargeCents || 0, 2),
        rechargeBonus: (function () { const sr = sheets.find(function (s3) { return s3.recharge }); const r2 = sr && sr.recharge; return r2 && r2.bonusCents > 0 ? money(r2.bonusCents, 2) : '' })(),
        afterBalance: pay2.afterRechargeBalanceCents != null ? money(pay2.afterRechargeBalanceCents, 2) : '',
        rvNote: (pay2.pendingRechargeCents || 0) > 0 ? `(含本单随签充值 +${money(pay2.pendingRechargeCents, 2)},签字生效)` : '',
        totalText: money(pay2.offlineDueCents != null ? pay2.offlineDueCents : (grp.totalCents || 0), 2),
        warnings: sheets.reduce(function (acc, s2) { return acc.concat((s2.softWarnings || []).map(function (w) { return w.message })) }, [])
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
