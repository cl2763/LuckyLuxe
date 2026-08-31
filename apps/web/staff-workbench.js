/* 员工工作台(店主 2026-08-31 裁,员工端等同清单 #1+#3;公约①新功能新模块)
   四件一页,全部读既有口(后端路由零新增):
   ① 我的业绩  GET /admin/my-performance(可见性三态后端句照登)
   ② 薪资估算  GET /admin/salary/my-estimate(v2 薪资方案引擎;deps 里 admin.js 启动已拉;旧 my-compensation-estimate 已随收敛退役)
   ③ 我的排班  GET /admin/schedule-week(排班团队可见,只渲染自己那一列)
   ④ 报价试算  POST /admin/settlements/preview —— 与小程序 quote-calc **同一计价引擎同一 body 形**
     (报价口径=结算口径;试算不落库;金额红线:本页零金额运算,句/数全后端) */
window.StaffWorkbench = (function () {
  'use strict'
  const TIERS = [{ key: 'list', label: '原价' }, { key: 'share', label: '分享价' }, { key: 'member', label: '会员价' }]
  const TIER_PRICE_FIELD = { list: 'listPriceCents', share: 'sharePriceCents', member: 'memberPriceCents' }
  let st = { perf: null, cats: [], items: [], catId: '', tierKey: 'list', picked: {}, view: null, deps: null, mount: null, salMonth: '', sal: undefined }

  async function render(mount, deps) {
    st.deps = deps; st.mount = mount
    const { request, escapeHtml } = deps
    if (!st.perf) {
      try {
        const [perf, cats, items] = await Promise.all([
          request('/admin/my-performance'),
          request('/admin/pricing/categories'),
          request('/admin/pricing/items')
        ])
        st.perf = perf.performance
        st.cats = (cats.categories || []).filter((c) => c.isBookable !== false)
        st.items = (items.items || []).filter((i) => i.isActive !== false)
        st.catId = (st.cats[0] || {}).id || ''
      } catch (e) {
        mount.innerHTML = `<div class="empty-state"><strong>${escapeHtml(e.message || '工作台加载失败')}</strong></div>`
        return
      }
    }
    paint()
  }

  function myScheduleRows() {
    const { owner } = st.deps
    const wk = owner.scheduleWeek
    const techId = owner.auth?.admin?.technicianId
    if (!wk || !techId) return []
    const byDate = new Map((wk.schedules || []).filter((s) => s.technicianId === techId).map((s) => [s.date, s]))
    return (wk.days || []).map((d) => {
      const s = byDate.get(d.date)
      return {
        date: d.date, wd: '日一二三四五六'[d.weekday],
        text: d.hoursUnset ? '未设置' : (d.isClosed ? '店休' : (s ? (s.isWorking === false ? '休' : `${s.startTime || d.openTime || ''}–${s.endTime || d.closeTime || ''}`) : `${d.openTime || ''}–${d.closeTime || ''}`)),
        off: d.isClosed || (s && s.isWorking === false)
      }
    })
  }

  function paint() {
    const { escapeHtml, money, owner } = st.deps
    const p = st.perf || {}
    const hero = p.hero || null
    const est = st.sal !== undefined ? st.sal : owner.myCompEstimate
    const field = TIER_PRICE_FIELD[st.tierKey]
    const mains = st.items.filter((i) => (i.itemKind || 'main') === 'main' && (i.categoryId || '') === st.catId)
    const priceOf = (it) => { const c = it[field] === null || it[field] === undefined ? it.listPriceCents : it[field]; return c === 0 ? '免收' : money(c) }
    st.mount.innerHTML = `
      <div class="swb">
        <section class="card swb-card">
          <h3>我的业绩 <span class="subtle small">${escapeHtml(p.month || '')} · 口径=已确认日结</span></h3>
          ${p.note ? `<p class="subtle">${escapeHtml(p.note)}</p>` : ''}
          ${hero ? `<div class="finance-metrics">
            <div class="finance-metric"><span>本月业绩</span><strong>${money(hero.perfCents || 0)}</strong></div>
            <div class="finance-metric"><span>单数</span><strong>${hero.orderCount || 0}</strong></div>
            ${hero.targetCents ? `<div class="finance-metric"><span>目标进度</span><strong>${escapeHtml(hero.progressText || '')}</strong></div>` : ''}
          </div>` : (p.note ? '' : '<p class="subtle">本月还没有已确认的日结业绩。</p>')}
          ${(p.trend || []).length ? `<p class="subtle small">近 6 月:${p.trend.map((t) => `${t.month.slice(5)}月 ${money(t.perfCents || 0)}`).join(' · ')}</p>` : ''}
        </section>
        <section class="card swb-card">
          <div class="swb-monthbar">
            <button class="ghost slim" data-swb-mprev type="button">‹</button>
            <h3>${st.salMonth ? escapeHtml(st.salMonth) : '本月'} 薪资估算</h3>
            <button class="ghost slim" data-swb-mnext type="button" ${st.salMonth ? '' : 'disabled'}>›</button>
          </div>
          ${st.salNote ? `<p class="subtle">${escapeHtml(st.salNote)}</p>` : ''}
          ${est ? `<div class="finance-metrics">
            <div class="finance-metric"><span>底薪</span><strong>${money(est.baseSalaryCents || 0)}</strong></div>
            <div class="finance-metric"><span>本月业绩</span><strong>${money(est.perfCents || 0)}</strong></div>
            <div class="finance-metric"><span>提成估算</span><strong>${money(est.commissionCents || 0)}</strong></div>
            <div class="finance-metric good"><span>合计估算</span><strong>${money(est.totalCents || 0)}</strong></div>
          </div><p class="subtle small">估算=薪资方案引擎(底薪/手工费/阶梯提成/加班/冲卡提成/调整项)按已确认日结现算;以月结工资表为准。</p>` : (st.salNote ? '' : '<p class="subtle">暂无薪资方案,或本店未开放展示。</p>')}
        </section>
        <section class="card swb-card">
          <h3>我的排班 <span class="subtle small">本周</span></h3>
          <div class="swb-week">${myScheduleRows().map((r) => `
            <div class="swb-day ${r.off ? 'off' : ''}"><span>${escapeHtml(r.date.slice(5))} 周${r.wd}</span><strong>${escapeHtml(r.text)}</strong></div>`).join('') || '<p class="subtle">本周排班还没生成。</p>'}
          </div>
        </section>
        <section class="card swb-card">
          <h3>报价试算 <span class="subtle small">与结算同一计价引擎;只算不落库</span></h3>
          <div class="swb-tiers">${TIERS.map((t) => `<button class="rfm-chip ${st.tierKey === t.key ? 'on' : ''}" data-swb-tier="${t.key}" type="button">${t.label}</button>`).join('')}</div>
          <div class="swb-cats">${st.cats.map((c) => `<button class="rfm-chip ${st.catId === c.id ? 'on' : ''}" data-swb-cat="${c.id}" type="button">${escapeHtml(c.name)}</button>`).join('')}</div>
          <div class="swb-items">${mains.map((it) => `
            <label class="swb-item"><input type="checkbox" data-swb-item="${it.id}" ${st.picked[it.id] ? 'checked' : ''}> ${escapeHtml(it.nameZh)} <span class="subtle">${priceOf(it)}</span></label>`).join('') || '<p class="subtle">该大类暂无主项目。</p>'}
          </div>
          ${st.view ? `<div class="swb-quote">
            <p><strong>预估 ${escapeHtml(st.view.subtotal)}</strong> <span class="subtle">(${escapeHtml(st.view.tierLabel)} · ${escapeHtml(st.view.breakdown)})</span></p>
            <button class="ghost slim" data-swb-copy type="button">复制报价话术</button>
          </div>` : '<p class="subtle small">勾选项目后自动试算。</p>'}
        </section>
      </div>`
    bind()
  }

  async function loadSalary() {
    const { request } = st.deps
    try {
      const r = await request(`/admin/salary/my-estimate${st.salMonth ? `?month=${st.salMonth}` : ''}`)
      st.sal = (r.estimate && !r.estimate.noPlan) ? r.estimate : null
      st.salNote = ''
    } catch (e) { st.sal = null; st.salNote = (e && e.message) || '' }
    paint()
  }

  function shiftSalMonth(n) {
    const cur = storeToday().slice(0, 7)
    const [y, m] = (st.salMonth || cur).split('-').map(Number)
    const d = new Date(y, m - 1 + n, 1)
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (next > cur) return // 未来月不看:工资是历史账
    st.salMonth = next === cur ? '' : next
    loadSalary()
  }

  function bind() {
    const { toast } = st.deps
    const m = st.mount
    const mp = m.querySelector('[data-swb-mprev]'); if (mp) mp.addEventListener('click', () => shiftSalMonth(-1))
    const mn = m.querySelector('[data-swb-mnext]'); if (mn) mn.addEventListener('click', () => shiftSalMonth(1))
    m.querySelectorAll('[data-swb-tier]').forEach((b) => b.addEventListener('click', () => { st.tierKey = b.dataset.swbTier; paint(); preview() }))
    m.querySelectorAll('[data-swb-cat]').forEach((b) => b.addEventListener('click', () => { st.catId = b.dataset.swbCat; paint() }))
    m.querySelectorAll('[data-swb-item]').forEach((b) => b.addEventListener('change', () => {
      if (st.picked[b.dataset.swbItem]) delete st.picked[b.dataset.swbItem]
      else st.picked[b.dataset.swbItem] = 1
      preview()
    }))
    m.querySelector('[data-swb-copy]')?.addEventListener('click', async () => {
      const t = `您选的款式预估 ${st.view.subtotal}（含${st.view.breakdown}），最终以到店确认为准哦～`
      try { await navigator.clipboard.writeText(t); toast('话术已复制') } catch (e) { toast('复制失败,请手动选取') }
    })
  }

  async function preview() {
    const { request, toast } = st.deps
    const ids = Object.keys(st.picked)
    if (!ids.length) { st.view = null; paint(); return }
    try {
      const r = await request('/admin/settlements/preview', {
        method: 'POST',
        body: JSON.stringify({ tierKey: st.tierKey, items: ids.map((id) => ({ serviceId: id, qty: 1 })), depositApplied: false, payIntent: 'offline_full' })
      })
      const s = r.settlement || {}
      st.view = {
        subtotal: s.subtotalText || st.deps.money(s.subtotalCents || 0),
        tierLabel: (TIERS.find((t) => t.key === st.tierKey) || {}).label || '',
        breakdown: (s.lines || []).map((l) => l.name).join(' + ')
      }
      paint()
    } catch (e) { toast(e.message || '试算失败') }
  }

  return { render }
})()
