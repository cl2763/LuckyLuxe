/* 网页后台首页 · 业绩大屏(合同 = `handoff/商家端主页重画_两端设计图_2026-09-03.html` v3.1 §三)

   🔴 **D154 重写**(店主 09-08 亲看后原话:「他跟我的合同图完全就是在 UI 方面是不一样的」)。
   上一版(段 6)只把**数据节点**接上了,页面没有按图排 —— 三块竖着叠、没有两栏、
   没有下一位卡、没有折线(后端 `spark` 已经给了数,前端没画)、没有 AI 一句、没有台面嵌入,
   而页顶那四张前端自算的旧卡还在。
   **我当时写「DOM 现测有证据」,证据证明的是「节点在」,不是「页面按图」——验错了层。**
   这一版按图 §三 逐块排,判据锚**选择器**不锚文案。

   ══ 整页只吃三个接口 ══
   `/admin/dashboard/pulse|now|todo`,前端零计算、零拼数;金额走注入的 `money()`(币种红线)。
   台面**原样嵌入** `window.TodayBoard`,不另画一套(自画就是两处真相)。

   ══ 三态 + 休息日(图 §六)══
   加载中骨架不显示 0 · 无数据说真话 · 失败不显示旧数不显示 0 ·
   休息日**只替换**此刻四格与下一位卡,大数/小牌/要处理照出。

   ══ 不做(图 §八)══
   图表页 / 导出 / 自定义指标 / 快捷格 / 多店汇总 / 首页轮询(全屏态归段 11,本批只占位)。
   月目标那一行**不出** —— 门店还没有「月目标」这个配置项,编一个 62% 就是假数(回执已登记)。 */
window.DashboardHome = (function () {
  const PERIODS = [
    { key: 'today', zh: '今日', en: 'Today', prevZh: '比昨日', prevEn: 'vs yesterday' },
    { key: 'week', zh: '本周', en: 'This week', prevZh: '比上周', prevEn: 'vs last week' },
    { key: 'month', zh: '本月', en: 'This month', prevZh: '比上月', prevEn: 'vs last month' },
    { key: 'year', zh: '本年', en: 'This year', prevZh: '比去年', prevEn: 'vs last year' },
  ]
  const LABEL = {
    revenue: ['营业收入 · 服务 + 耗卡 + 产品', 'Revenue'], cash: ['现金业绩 · 实收', 'Cash received'],
    cardUse: ['总卡耗', 'Card used'], newCard: ['新增持卡', 'New cards'],
    visits: ['到店人次', 'Visits'], bookings: ['今日预约', 'Bookings'],
  }
  const TODO_LABEL = {
    aiHandoff: ['客服待人工', 'AI handoffs'], quotePending: ['待报价', 'Quotes'],
    notePending: ['待写小记', 'Notes'], shiftApproval: ['调休待批', 'Shift requests'], dailyClose: ['待日结', 'Daily close'],
  }
  /* 急缓:客服待人工与待报价是**顾客在等**,排前面(图 §三 右下块) */
  const URGENT = ['aiHandoff', 'quotePending']

  /* 🔴 D168 段 3 第 6 条:轮播 + 数字滚动。
     `slot` = 大数字现在放大的是哪一个指标(图上 5 个 dots = 5 个轮播位);
     `rolled` = 上一次画出来的数,滚动要从它滚到新值 —— 没有它就只能「直接换」。 */
  const CAROUSEL = ['revenue', 'cash', 'cardUse', 'newCard', 'visits']
  const ROLL_MS = 600            // 图 §一 第 1 条原文:600ms
  const ROTATE_MS = 6000         // 与全屏态同一个数(图 §五)
  let st = { period: 'today', slot: 0, pulse: null, now: null, todo: null, aiLine: null, phase: 'loading', deps: null, host: null, rolled: {}, rotateAt: 0 }

  const esc = (s) => st.deps.escapeHtml(String(s == null ? '' : s))
  const zh = () => st.deps.isZh !== false
  const label = (k) => (zh() ? LABEL[k][0] : LABEL[k][1])
  const periodMeta = () => PERIODS.find((p) => p.key === st.period) || PERIODS[0]

  /* 金额:**一个币符都不许写在这里**(币种红线)。全仓出口是 admin.js 的 money(),注入进来。 */
  function moneyOf(cents, cur) {
    if (cents === undefined || cents === null || !cur) return '—'
    return st.deps.money(cents)
  }
  /* 🔴 大数那一处:**币种只出一遍**(店主 05r 补一 现看:大数整串带币码、旁边再挂一个小字币码 = 出两遍,还没千分位)。
     图上是「小字币码 + 2,486」——所以大数只摆**数字**(带千分位),币码单独作小字。
     两段都由注入的 `moneyParts()` 给,页面**仍然一个币符都不自己拼**(币种红线)。 */
  function bigMoney(m, cur) {
    if (!m) return '—'
    if (m.locked) return '🔒'
    if (m.value === undefined || m.value === null || !cur) return '—'
    const p = st.deps.moneyParts(m.value)
    /* 币码在**前**、小字;数字在后、大字 —— 图上就是这么摆的(「小字币码 + 2,486」) */
    return `<small class="dh-cur" data-dh-cur>${esc(p.prefix)}${esc(p.symbol)}</small>${esc(p.amount)}`
  }
  const valueText = (m, cur) => {
    if (m.locked) return '🔒'
    if (m.unit === 'money') return moneyOf(m.value, cur)
    return `${m.value}${m.unit === 'people' ? (zh() ? ' 人' : '') : ''}`
  }
  const deltaText = (m) => {
    if (m.locked) return ''
    const pm = periodMeta()
    if (m.deltaPct === null || m.deltaPct === undefined) {
      return `<span class="dh-delta dh-delta-none" data-delta="none">${zh() ? '上期 0,没法比' : 'No prior data'}</span>`
    }
    const up = m.deltaPct >= 0
    return `<span class="dh-delta ${up ? 'up' : 'down'}" data-delta="${m.deltaPct}">${up ? '▲' : '▼'} ${Math.abs(m.deltaPct)}% ${zh() ? pm.prevZh : pm.prevEn}</span>`
  }

  /* 折线:点数 = spark 数组长度;**全 0 不画**(图 §六:无数据时折线不画)。
     🔴 D168 段 3 第 5 条:图上这条线有**三件**,原来一件都没有 ——
     ①`<defs><linearGradient>` 渐变填充(stop-opacity .35 → 0)②描边金色 ③**末点一个圆环**
     (描边同底色,看起来像在深底上挖了个圈)。少一件就不是图上那条线。
     图上还只有**一条线、没有图例**(§一 第 4 条),所以中间点不画圆点了。 */
  function sparkSvg(spark) {
    const pts = (spark || []).map((x) => Number(x) || 0)
    if (!pts.length || pts.every((x) => x === 0)) return ''
    const w = 220
    const h = 44
    const max = Math.max(...pts, 1)
    const step = pts.length > 1 ? w / (pts.length - 1) : 0
    const xy = pts.map((v, i) => [Math.round(i * step), Math.round(h - (v / max) * (h - 6) - 3)])
    const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ')
    const last = xy[xy.length - 1]
    /* 渐变 id 每次画都换一个:同页面里若出现第二条折线(全屏态),id 撞了会串色 */
    const gid = `dh-sp-${st.period}-${st.slot}`
    return `<svg class="dh-spark" data-dh-spark viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
      <defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="var(--herogold)" stop-opacity=".35"/>
        <stop offset="1" stop-color="var(--herogold)" stop-opacity="0"/>
      </linearGradient></defs>
      <path d="${d} L${last[0]} ${h} L${xy[0][0]} ${h} Z" fill="url(#${gid})" stroke="none"/>
      <path d="${d}" fill="none" stroke="var(--herogold)" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="${last[0]}" cy="${last[1]}" r="3.5" fill="var(--herogold)" stroke="var(--hero)" stroke-width="2"/>
    </svg>`
  }

  const periodBar = () => `<div class="dh-periods" data-dh-periods>${PERIODS.map((p) => `
      <button type="button" class="dh-period${p.key === st.period ? ' on' : ''}" data-dh-period="${p.key}">${zh() ? p.zh : p.en}</button>`).join('')}
      <button type="button" class="dh-full ghost slim" data-dh-full title="${zh() ? '前台全屏大屏' : 'Fullscreen'}">⤢ ${zh() ? '全屏大屏' : 'Fullscreen'}</button>
    </div>`

  const skeleton = () => `<section class="card dh-card" data-dh-state="loading">
      ${periodBar()}<div class="dh-skeleton" data-dh-skeleton>${'<div class="dh-sk-line"></div>'.repeat(4)}</div>
    </section>`
  /* 🔴 与图不符一处,已报待裁 #2:图上按钮文案是「下拉重试 · 或稍后再看」——
     那是小程序的说法,**网页没有下拉刷新**,等于教店主做一个做不到的动作(D148 说人话族)。
     网页这一端改成按钮真能干的事;小程序端到段 9–11 落地时按图保留「下拉重试」。
     判据 ⑫ 守「网页首页里不许出现『下拉』」。 */
  const failed = () => `<section class="card dh-card" data-dh-state="failed">
      ${periodBar()}
      <p class="dh-truth" data-dh-truth>${zh() ? '业绩数据暂时取不到' : 'Metrics are unavailable right now'}</p>
      <button type="button" class="ghost slim" data-dh-retry>${zh() ? '点一下重试 · 或稍后再看' : 'Retry'}</button>
    </section>`

  /* ── 此刻四格 + 下一位卡(休息日只换这两块,图 §六)────────── */
  function nowPart() {
    const nw = st.now || {}
    if (nw.closed) {
      return `<p class="dh-truth dh-closed" data-dh-state="closed" data-dh-truth-closed>${zh() ? '今日休息' : 'Closed today'}</p>`
    }
    const nx = nw.next
    return `<div class="dh-now4">
        ${[['doing', '在做', 'In progress'], ['waiting', '待到店', 'Waiting'], ['done', '已完成', 'Done'], ['total', '今日预约', 'Bookings']]
    .map(([k, z, e]) => `<div class="dh-now-cell" data-dh-now="${k}"><span>${zh() ? z : e}</span><strong>${nw[k] ?? '—'}</strong></div>`).join('')}
      </div>
      ${nx ? `<div class="dh-next" data-dh-next>
          <strong class="dh-next-time" data-dh-next-time>${esc(nx.time)}</strong>
          <span class="dh-next-who">${esc(nx.customer)}</span>
          <span class="dh-next-what">${esc(nx.service)}${nx.tech ? ` · ${esc(nx.tech)}` : ''}</span>
          <button type="button" class="dh-next-go" data-dh-next-go data-dh-to="board">${zh() ? '看台面 ›' : 'Open board ›'}</button>
        </div>`
    : `<div class="dh-next dh-next-none" data-dh-next-none>${zh() ? '后面没有待到店的了' : 'No one waiting'}</div>`}`
  }

  /* ── 英雄区:**一整块深色**(图 §三)。左(维度条 + 大数 + 折线 + dots + 此刻四格 + 下一位)
       右(四小牌 + AI 今日一句横跨两列)。上一版是白卡片黑字,那是骨架不是皮。 ── */
  function heroMetric(ms) {
    /* 轮播位落在哪个指标上:图上 5 个 dots。
       ⚠️ **假设(图上没写死)**:后端给的是六个指标,而图上画的是 **5 个 dots**。
       这里取「营业收入 + 现金业绩 + 总卡耗 + 新增持卡 + 到店人次」五个轮播,
       **今日预约不进轮播** —— 它那一格带「在做 N · 待到店 N」的实时副行,
       图 §一 第 2 条说那是「主页上唯一的实时一眼」,不该被轮走。已记入假设清单。 */
    const key = CAROUSEL[st.slot % CAROUSEL.length]
    return ms.find((m) => m.key === key) || ms[0] || null
  }

  const dots = () => `<div class="dh-dots" data-dh-dots>${CAROUSEL.map((k, i) => `
      <button type="button" class="${i === (st.slot % CAROUSEL.length) ? 'on' : ''}" data-dh-dot="${i}" aria-label="${esc(label(k))}"></button>`).join('')}</div>`

  function hero() {
    const p = st.pulse || {}
    const cur = p.currency
    const ms = p.metrics || []
    const head = heroMetric(ms)
    const empty = ms.every((m) => !m.locked && !m.value)
    const tiles = ms.filter((m) => !head || m.key !== head.key).slice(0, 4)
    return `<section class="dh-card dh-hero-card" data-dh-state="ready">
      <div class="dh-hero" data-dh-hero>
        <div class="dh-hero-left" data-dh-hero-left>
          ${periodBar()}
          <p class="dh-k">${head ? label(head.key) : ''}</p>
          <h2 class="dh-big" data-dh-metric="${head ? esc(head.key) : ''}" data-dh-roll="${head && head.unit === 'money' ? 'money' : 'count'}" data-dh-roll-to="${head && head.value !== undefined && head.value !== null ? String(head.value) : ''}">${head && head.unit === 'money' ? bigMoney(head, cur) : (head ? esc(valueText(head, cur)) : '—')}</h2>
          <div class="dh-row">
            ${head ? deltaText(head) : ''}
            ${head ? sparkSvg(head.spark) : ''}
          </div>
          ${dots()}
          ${empty ? `<p class="dh-truth" data-dh-truth-empty>${zh() ? '今天还没有开单 · 暂无往日数据' : 'No orders yet today'}</p>` : ''}
          ${nowPart()}
        </div>
        <div class="dh-tiles" data-dh-tiles>
          ${tiles.map((m) => `<div class="dh-tile" data-dh-metric="${m.key}">
              <span class="dh-tile-k">${label(m.key)}</span>
              <strong class="dh-tile-v" data-dh-roll="${m.unit === 'money' ? 'money' : 'count'}" data-dh-roll-to="${m.value !== undefined && m.value !== null ? String(m.value) : ''}">${valueText(m, cur)}</strong>
              ${m.key === 'cardUse' ? `<span class="dh-tile-x" data-dh-times>${m.extra && m.extra.times ? `${zh() ? '次卡' : 'Card'} ${m.extra.times} ${esc((m.extra && m.extra.timesUnit) || '次')}` : '—'}</span>` : ''}
              ${deltaText(m)}
            </div>`).join('')}
          ${aiLine()}
        </div>
      </div>
    </section>`
  }

  /* ── AI 今日一句 ——**只读已生成的**,不为首页新起模型调用(图/裁定)。
       图 §三 里它是英雄块右栏**最后一格、横跨两列**,不是底下单独一条白通栏。 ── */
  function aiLine() {
    const a = st.aiLine
    if (a && a.text) {
      return `<div class="dh-ai" data-dh-ai-line>
        <span class="dh-ai-text">${esc(a.text)}</span>
        ${a.at ? `<span class="dh-ai-at">${esc(a.at)}</span>` : ''}</div>`
    }
    return `<div class="dh-ai" data-dh-ai-none>
      <span class="dh-ai-at">${zh() ? '今天还没有一句 —— 去「AI 日报」生成一次就有了' : 'No line yet today'}</span></div>`
  }

  function todoBlock() {
    const items = (st.todo && st.todo.items) || []
    const live = items.filter((x) => Number(x.n) > 0)
      .sort((a, b) => (URGENT.includes(b.key) ? 1 : 0) - (URGENT.includes(a.key) ? 1 : 0))
    if (!live.length) {
      return `<section class="card dh-card" data-dh-todo>
        <p class="dh-truth" data-dh-truth-todo>${zh() ? '今天没有要处理的' : 'Nothing to handle today'}</p></section>`
    }
    return `<section class="card dh-card" data-dh-todo>
      ${live.map((x) => `<button type="button" class="dh-todo-row" data-dh-todo-key="${esc(x.key)}"${URGENT.includes(x.key) ? ' data-urgent="1"' : ''} data-dh-to="${esc(x.to)}">
          <span>${zh() ? (TODO_LABEL[x.key] || [x.key])[0] : (TODO_LABEL[x.key] || ['', x.key])[1]}</span><strong>${x.n}</strong></button>`).join('')}
    </section>`
  }

  function paint() {
    if (!st.host) return
    if (st.phase === 'loading') { st.host.innerHTML = skeleton(); return }
    if (st.phase === 'failed') { st.host.innerHTML = failed(); bind(); return }
    /* AI 今日一句**画在英雄块右栏里**(图 §三),这里不再单独摆一块 */
    st.host.innerHTML = `${hero()}
      <div class="dh-bottom" data-dh-bottom>
        <section class="card dh-card dh-board" data-dh-board></section>
        ${todoBlock()}
      </div>`
    /* 台面**原样嵌入**:交给 today-board.js 自己画 —— 这里一行台面 HTML 都没有 */
    /* 段 11:全屏大屏(图 §五)。**顾客可能看到这块屏** —— 现金业绩与新增持卡默认不显,
       由门店设置那个开关决定(默认关);拿不到设置就按关来(fail-closed)。 */
    const full = st.host.querySelector('[data-dh-full]')
    if (full && window.DashboardFullscreen) {
      full.onclick = async () => {
        let showMoney = false
        try { showMoney = Boolean((await st.deps.request('/admin/store-settings/front-screen')).showMoney) } catch { showMoney = false }
        /* 店名走 D156 定的那一处真相(门店名,商家自己看的那个),不另取一份 */
        const storeName = (document.querySelector('[data-tenant-name]') || {}).textContent || ''
        window.DashboardFullscreen.open({ ...st.deps, storeName }, { showMoney })
      }
    }
    const board = st.host.querySelector('[data-dh-board]')
    if (board && window.TodayBoard && st.deps.boardDeps) {
      try { window.TodayBoard.mountInto(board, st.deps.boardDeps()) } catch (e) { board.innerHTML = '' }
    }
    bind()
    rollNumbers()
    scheduleRotate()
  }

  /* 轮播:6 秒换一个指标。**只重画手上的数,一个请求都不发** ——
     图 §八 的「首页不轮询」管的是取数,不是画面(§一 第 1 条明写「轮播换指标时数字滚动」)。
     用 `setTimeout` 一次一排(不是 `setInterval` 挂着):重画时先清掉旧的那一枚,
     免得两枚计时器叠着跑,越点越快。 */
  function scheduleRotate() {
    if (st.rotateAt) { window.clearTimeout(st.rotateAt); st.rotateAt = 0 }
    if (st.phase !== 'ready') return
    st.rotateAt = window.setTimeout(() => { st.slot = (st.slot + 1) % CAROUSEL.length; paint() }, ROTATE_MS)
  }

  /* ── 数字滚动(图 §一 第 1 条:600ms;系统「减少动态效果」则直接跳)──────
     滚的是**已经在手上的数**,不重取接口。
     第一次画不滚(`from === undefined`)—— 从 0 滚上来会让人以为这些钱是刚刚才赚到的。 */
  function rollNumbers() {
    const reduce = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    st.host.querySelectorAll('[data-dh-roll-to]').forEach((el) => {
      const to = Number(el.dataset.dhRollTo)
      const key = `${el.dataset.dhMetric || el.className}:${st.period}`
      const from = st.rolled[key]
      const cur = (st.pulse || {}).currency
      const fmt = (v) => {
        if (el.dataset.dhRoll !== 'money') return String(Math.round(v))
        const q = st.deps.moneyParts(Math.round(v))
        return `<small class="dh-cur" data-dh-cur>${esc(q.prefix)}${esc(q.symbol)}</small>${esc(q.amount)}`
      }
      if (Number.isFinite(to)) st.rolled[key] = to
      if (!Number.isFinite(to) || !cur) return
      if (reduce || from === undefined || from === to) return
      const t0 = (window.performance && window.performance.now()) || 0
      const step = (t) => {
        const k = Math.min(1, ((t || 0) - t0) / ROLL_MS)
        const eased = 1 - Math.pow(1 - k, 3)
        el.innerHTML = fmt(from + (to - from) * eased)
        if (k < 1) window.requestAnimationFrame(step)
      }
      window.requestAnimationFrame(step)
    })
  }

  function bind() {
    st.host.querySelectorAll('[data-dh-period]').forEach((el) => {
      el.addEventListener('click', () => { st.period = el.dataset.dhPeriod; load() })
    })
    /* dots:点一下换指标 —— 轮播与手点走同一条路(一处真相) */
    st.host.querySelectorAll('[data-dh-dot]').forEach((el) => {
      el.addEventListener('click', () => { st.slot = Number(el.dataset.dhDot) || 0; paint() })
    })
    /* ══ D179 图 §六 第 4/5 行(夜班令6 段 5)══
       长按大数字 / 点四小牌 → 各指标各去各的地方;点「此刻」四格 → 今日台面。
       落点表**与小程序端同一份**(那边在 `jumpMetric`),改一处必须两处一起改。 */
    const GO = { revenue: 'finance', cash: 'finance', cardUse: 'finance', newCard: 'customers', visits: 'board', bookings: 'board' }
    const jump = (key) => { const to = GO[key]; if (to && st.deps.goto) st.deps.goto(to) }
    st.host.querySelectorAll('[data-dh-tiles] [data-dh-metric]').forEach((el) => {
      el.style.cursor = 'pointer'
      el.addEventListener('click', () => jump(el.dataset.dhMetric))
    })
    const big = st.host.querySelector('[data-dh-hero-left] [data-dh-metric]')
    if (big) {
      /* 长按 = 按住 500ms 松手(网页没有 longpress 事件,自己记时间) */
      let t0 = 0
      big.addEventListener('mousedown', () => { t0 = Date.now() })
      big.addEventListener('mouseup', () => { if (Date.now() - t0 >= 500) jump(big.dataset.dhMetric) })
    }
    st.host.querySelectorAll('[data-dh-now]').forEach((el) => {
      el.style.cursor = 'pointer'
      el.addEventListener('click', () => { if (st.deps.goto) st.deps.goto('board') })
    })
    const retry = st.host.querySelector('[data-dh-retry]')
    if (retry) retry.addEventListener('click', () => load())
    st.host.querySelectorAll('[data-dh-to]').forEach((el) => {
      el.addEventListener('click', () => { if (st.deps.goto) st.deps.goto(el.dataset.dhTo) })
    })
  }

  async function load() {
    st.phase = 'loading'
    paint()
    try {
      const [p, nw, td, al] = await Promise.all([
        st.deps.request(`/admin/dashboard/pulse?period=${encodeURIComponent(st.period)}`),
        st.deps.request('/admin/dashboard/now'),
        st.deps.request('/admin/dashboard/todo'),
        /* 🔴 05t 段 2:AI 今日一句改成**从后端读**。原来读的是 `owner.dashAiLine`,
           而那个变量全仓没人赋过值 —— 于是这块永远是「今天还没有一句」,灌多少数据都没用。
           后端只回**今天**那条(隔夜的不算),前端零判断。 */
        st.deps.request('/admin/dashboard/ai-line').catch(() => null),
      ])
      st.pulse = p; st.now = nw; st.todo = td
      st.aiLine = (al && al.line) || (st.deps.readAiLine && st.deps.readAiLine()) || null
      st.phase = 'ready'
    } catch (e) {
      /* 失败态**不显示旧数、不显示 0**(图 §六):先把手上的数清掉再画 */
      st.pulse = null; st.now = null; st.todo = null; st.aiLine = null
      st.phase = 'failed'
    }
    paint()
  }

  function mountInto(host, deps) {
    st.host = host
    st.deps = deps
    load()
  }

  return { mountInto, load, _state: () => st }
})()
