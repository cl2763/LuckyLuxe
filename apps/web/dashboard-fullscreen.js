/* 段 11 · 前台全屏大屏态(图 v3.2 §五)

   这块屏是挂在前台不动的 —— **顾客可能看到它**。所以它跟老板自己看的首页有两条本质区别:

   ① **默认不显示会被顾客看去的两个数**:现金业绩、新增持卡。
      只显营业收入、总卡耗、到店人次、今日预约。
      门店设置里有个开关「前台大屏显示金额」,**默认关**;财务锁开着时一律遮成 ••••。
   ② **这里是全仓唯一允许轮询的地方**(图 §八:首页不轮询)。因为它没人看着、
      要一直保持新鲜:每 **60 秒**静默重取一次 pulse 与 now。

   其余按图:只轮播**今日**五指标、每 **6 秒**一换;退出三条路 —— Esc / 点任意处 / 退出全屏。
   屏保:无操作 5 分钟数字放大 10% 缓慢呼吸,**尊重系统「减少动态效果」**(那时直接不动)。

   为什么单独一个文件:`dashboard-home.js` 是首页那一块的,全屏是另一种形态(另一批人看、另一套规矩);
   混在一起下次改首页会顺手把大屏改坏。两边共用的是**同三条接口**,不是同一段代码。 */
window.DashboardFullscreen = (function () {
  const ROTATE_MS = 6000        // 图 §五:每 6 秒换一个指标
  const REFRESH_MS = 60000      // 图 §五:每 60 秒静默重取(唯一允许轮询处)
  const SAVER_MS = 5 * 60000    // 图 §五:无操作 5 分钟进屏保

  /* 顾客可能看到 → 这两个默认藏起来。开关打开了才显示。 */
  const CUSTOMER_SENSITIVE = ['cash', 'newCard']
  const ORDER = ['revenue', 'cash', 'cardUse', 'newCard', 'visits', 'bookings']
  const LABEL = { revenue: '今日营业收入', cash: '现金业绩', cardUse: '总卡耗', newCard: '新增持卡', visits: '到店人次', bookings: '今日预约' }

  const st = { host: null, deps: null, timers: [], idx: 0, data: null, lastAct: 0, showMoney: false }
  const esc = (s) => (st.deps && st.deps.escapeHtml ? st.deps.escapeHtml(s) : String(s ?? ''))
  const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  /** 这一屏该显示哪几个指标:开关关着就把顾客敏感的两个摘掉(**摘掉不是遮成 0**)。 */
  function visibleMetrics(pulse, showMoney) {
    const by = {}
    for (const m of (pulse && pulse.metrics) || []) by[m.key] = m
    return ORDER.filter((k) => by[k]).filter((k) => showMoney || !CUSTOMER_SENSITIVE.includes(k)).map((k) => by[k])
  }

  function valueText(m) {
    if (!m) return '—'
    /* 财务锁开着一律遮 —— 与首页同一口径,不在这儿另判一次 */
    if (m.locked) return '••••'
    if (m.value === undefined || m.value === null) return '—'
    const money = m.key === 'revenue' || m.key === 'cash' || m.key === 'cardUse'
    return money ? st.deps.money(m.value) : `${m.value}${m.key === 'bookings' ? ' 单' : ' 人'}`
  }

  function paint() {
    if (!st.host || !st.data) return
    const { pulse, now } = st.data
    const list = visibleMetrics(pulse, st.showMoney)
    const m = list[st.idx % Math.max(1, list.length)] || null
    const nx = now && now.next
    const saver = Date.now() - st.lastAct > SAVER_MS && !reduceMotion()
    st.host.innerHTML = `
      <div class="fs-wrap${saver ? ' fs-saver' : ''}" data-fs-wrap>
        <div class="fs-top">
          <span data-fs-store>${esc(st.deps.storeName || '')}</span>
          <span class="fs-clock" data-fs-clock>${esc(new Date().toTimeString().slice(0, 5))}</span>
        </div>
        <p class="fs-label" data-fs-label>${esc(LABEL[m && m.key] || '')}</p>
        <h1 class="fs-big" data-fs-metric="${esc(m && m.key)}">${esc(valueText(m))}</h1>
        <div class="fs-now" data-fs-now>
          <span>在做 ${Number((now && now.doing) || 0)}</span>
          <span>待到店 ${Number((now && now.waiting) || 0)}</span>
          <span>已完成 ${Number((now && now.done) || 0)}</span>
        </div>
        ${nx ? `<div class="fs-next" data-fs-next>下一位 ${esc(nx.time || '')} · ${esc([nx.customer, nx.service, nx.tech].filter(Boolean).join(' · '))}</div>` : ''}
        <div class="fs-dots">${list.map((_, i) => `<i class="${i === st.idx % list.length ? 'on' : ''}"></i>`).join('')}</div>
        <p class="fs-exit" data-fs-exit>按 Esc 或点任意处退出</p>
      </div>`
  }

  async function refresh() {
    try {
      const [pulse, now] = await Promise.all([
        st.deps.request('/admin/dashboard/pulse?period=today'),
        st.deps.request('/admin/dashboard/now'),
      ])
      st.data = { pulse, now }
      paint()
    } catch { /* 取数失败:**留着上一帧**,不把屏幕清成 0(这块屏没人守着) */ }
  }

  function stop() {
    for (const t of st.timers) clearInterval(t)
    st.timers = []
    if (st.host) st.host.remove()
    st.host = null
    document.removeEventListener('keydown', onKey)
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  }
  const onKey = (e) => { if (e.key === 'Escape') stop() }

  /** 开一屏。`showMoney` 由门店设置给(**默认关**);拿不到就是关。 */
  async function open(deps, { showMoney = false } = {}) {
    st.deps = deps
    st.showMoney = Boolean(showMoney)
    st.idx = 0
    st.lastAct = Date.now()
    st.host = document.createElement('div')
    st.host.className = 'dh-fs'
    st.host.setAttribute('data-dh-fullscreen', '')
    st.host.addEventListener('click', stop)          // 点任意处退出(图 §五)
    document.body.appendChild(st.host)
    document.addEventListener('keydown', onKey)
    try { await document.documentElement.requestFullscreen() } catch { /* 浏览器不给就算了,屏还是全屏样式 */ }
    await refresh()
    st.timers.push(setInterval(() => { st.idx += 1; paint() }, ROTATE_MS))
    st.timers.push(setInterval(refresh, REFRESH_MS))   // 唯一允许轮询的地方
    st.timers.push(setInterval(paint, 30000))          // 时钟与屏保状态
  }

  return { open, stop, visibleMetrics, valueText, CUSTOMER_SENSITIVE, ROTATE_MS, REFRESH_MS, SAVER_MS, _state: () => st }
})()
