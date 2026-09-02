/* 客户标签(会员标 · RFM 分层)—— 2026-08-25 从 admin.js 搬出(公约②)。
   本批(N-5 退卡口)动的是会员这个域:退卡后还算不算会员由配置决定,
   而这枚标就是那条配置在店主眼里的样子,所以一并收进来。

   08-30h 拉平批①(RFM 接回网页,店主已裁):名单动作(点分层筛名单)与阈值微调(⚙)
   **就地可操作**,读写既有后端口 GET/PUT /admin/segment-rules(与小程序同两口,一份数据两端渲染);
   「名单动作与阈值微调在小程序客户库」死口句随功能删,crossend-cta 白名单随之减一。 */
window.CustomerTags = (function () {
  // 与后端 /admin/segment-rules 的默认值同数(规则未拉到前的初始形;拉到后一律以服务端为准)
  const DEFAULT_RULES = { aDays: 45, aVisits: 3, aSpendCents: 50000, nDays: 30, sDays: 60 }
  let stateR = { rules: null, filter: '', editing: false, loading: false }

  function memberTierBadge(customer, { lang, styles, escapeHtml }) {
    // D41:不分级店两态 —— member=会员 / guest=顾客(充值即会员,消费不算);分级店照旧梯子键
    const tier = customer.memberTier || 'Silver'
    const k = String(tier).toLowerCase()
    if (k === 'member') return `<span class="member-tier-badge tier-silver">${lang === 'zh' ? '会员' : 'Member'}</span>`
    if (k === 'guest') return `<span class="member-tier-badge" style="background:#eee;color:#666">${lang === 'zh' ? '顾客' : 'Guest'}</span>`
    /* 🔴 03r(gold 裸枚举同族第三处):原来 `tier === 'member'` 等三处比较与 styles 查表**都区分大小写**,
       而 memberTier 的大小写随来源(AI 记忆抽的是小写,梯子键可能是大写)——
       小写 'member' 走不进第一条分支,最后落到 `escapeHtml(tier)` 把原值印出来。
       ① 三处比较与配色查表改成大小写不敏感(纯显示,不涉口径);
       ② 四个内置等级给中文名,和小程序/后端同一套字面。
       ⬜ **未做、已登记待裁**:分级店用的是租户自定义梯子键(后端 memberTiers[] 带 label)。
          自定义等级到底该显示 `key` 还是 `label`,是业务口径 —— 不自己判断,等店主裁。
          在那之前保持原样显示键,不改现状。 */
    const CN = { silver: '银卡', gold: '金卡', platinum: '铂金', diamond: '钻石' }
    const styleKey = Object.keys(styles || {}).find((x) => x.toLowerCase() === k)
    const shown = lang === 'zh' && CN[k] ? CN[k] : tier
    return `<span class="member-tier-badge ${(styles || {})[styleKey] || 'tier-silver'}">${escapeHtml(shown)}</span>`
  }

  // RFM 分层(与小程序客户库同口径同两口;阈值=服务端 segment_rules)
  function rfmTierOf(c, lang) {
    const r = stateR.rules || DEFAULT_RULES
    const visits = c.completedCount || 0
    if (!visits) return null
    const days = (iso2) => iso2 ? Math.floor((Date.now() - new Date(iso2).getTime()) / 86400000) : 9999
    const lastD = days(c.lastCompletedAt)
    if (lastD > r.sDays) return { k: 's', label: lang === 'zh' ? '沉睡S' : 'Dormant', color: '#8a5a52' }
    if (lastD <= r.aDays && visits >= r.aVisits && (c.totalSpentCents || 0) >= r.aSpendCents) return { k: 'a', label: lang === 'zh' ? '高价值A' : 'VIP', color: '#b5885d' }
    if (days(c.firstVisitAt) <= r.nDays) return { k: 'n', label: lang === 'zh' ? '新客N' : 'New', color: '#3b6ea5' }
    return { k: 'b', label: lang === 'zh' ? '回头客B' : 'Repeat', color: '#3f6b52' }
  }

  async function ensureRules(request, rerender) {
    if (stateR.rules || stateR.loading) return
    stateR.loading = true
    try {
      const r = await request('/admin/segment-rules')
      stateR.rules = r.rules || DEFAULT_RULES
      rerender()
    } catch (e) { /* 拉不到用默认(与服务端默认同数,不是另一套口径) */ } finally { stateR.loading = false }
  }

  function currentFilter() { return stateR.filter }
  function applyFilter(customers, lang) {
    if (!stateR.filter) return customers
    return customers.filter((c) => (rfmTierOf(c, lang) || {}).k === stateR.filter)
  }

  function tierBar(customers, { lang, request, rerender }) {
    ensureRules(request, rerender)
    const counts = { a: 0, b: 0, n: 0, s: 0 }
    customers.forEach((c) => { const tr = rfmTierOf(c, lang); if (tr) counts[tr.k] += 1 })
    const chip = (k, zh, en) => `<button class="rfm-chip ${stateR.filter === k ? 'on' : ''}" data-rfm-filter="${k}" type="button">${lang === 'zh' ? zh : en} <strong>${counts[k]}</strong></button>`
    const r = stateR.rules || DEFAULT_RULES
    const editor = stateR.editing ? `
      <div class="rfm-rules-editor">
        <label>高价值A:最近 <input type="text" inputmode="numeric" data-rfm-num="aDays" value="${r.aDays}"> 天内 · ≥<input type="text" inputmode="numeric" data-rfm-num="aVisits" value="${r.aVisits}"> 次 · 累计 ≥<input type="text" inputmode="numeric" data-rfm-num="aSpend" value="${Math.round(r.aSpendCents / 100)}"> 元</label>
        <label>新客N:首次到店 ≤<input type="text" inputmode="numeric" data-rfm-num="nDays" value="${r.nDays}"> 天</label>
        <label>沉睡S:超过 <input type="text" inputmode="numeric" data-rfm-num="sDays" value="${r.sDays}"> 天没来</label>
        <button class="primary slim" data-rfm-save type="button">${lang === 'zh' ? '保存阈值' : 'Save'}</button>
      </div>` : ''
    return `<div class="rfm-bar">
      <span class="subtle">${lang === 'zh' ? '客户分层' : 'Tiers'}:</span>
      ${chip('a', '高价值A', 'VIP')}${chip('b', '回头客B', 'Repeat')}${chip('n', '新客N', 'New')}${chip('s', '沉睡S', 'Dormant')}
      ${stateR.filter ? `<button class="ghost slim" data-rfm-filter="" type="button">${lang === 'zh' ? '全部' : 'All'}</button>` : ''}
      <button class="ghost slim" data-rfm-rules type="button">⚙ ${lang === 'zh' ? '阈值' : 'Rules'}</button>
      <span class="subtle small">${lang === 'zh' ? '(自动按 最近到店/频率/累计消费;点分层筛名单)' : ''}</span>
    </div>${editor}`
  }

  async function handleClick(event, { request, toast, rerender }) {
    const chipEl = event.target.closest('[data-rfm-filter]')
    if (chipEl) {
      const k = chipEl.dataset.rfmFilter
      stateR.filter = stateR.filter === k ? '' : k
      rerender()
      return true
    }
    if (event.target.closest('[data-rfm-rules]')) {
      stateR.editing = !stateR.editing
      rerender()
      return true
    }
    if (event.target.closest('[data-rfm-save]')) {
      const num = (name) => Number(document.querySelector(`[data-rfm-num="${name}"]`)?.value)
      try {
        const resp = await request('/admin/segment-rules', {
          method: 'PUT',
          body: JSON.stringify({ aDays: num('aDays'), aVisits: num('aVisits'), aSpendCents: Math.round(num('aSpend') * 100), nDays: num('nDays'), sDays: num('sDays') })
        })
        stateR.rules = resp.rules
        stateR.editing = false
        toast('分层阈值已保存,两端同时生效')
        rerender()
      } catch (e) { toast(e.message || '保存失败') }
      return true
    }
    return false
  }

  return { memberTierBadge, rfmTierOf, tierBar, applyFilter, currentFilter, handleClick }
})()
