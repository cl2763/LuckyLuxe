/* 网页后台首页 · 业绩大屏(合同 = `handoff/商家端主页重画_两端设计图_2026-09-03.html` v3.1 §三)

   替代原来那块「本月经营 / 本月账本收入 / 收入解锁 / 来源」—— 那几块是各算各的;
   现在**整页只吃后端三个接口**:`/admin/dashboard/pulse|now|todo`,
   前端零计算、零拼数(金额也由后端给币种,前端只负责摆)。

   ══ 三态 + 休息日,各自真话,互斥(图 §六)══
   · 加载中 → 骨架,**不显示 0**(0 会被当成真数);
   · 无数据 → 「今天还没有开单」,0 是真数照显,折线不画;
   · 取数失败 → 「业绩数据暂时取不到」,**不显示旧数、不显示 0**;
   · 休息日 → 「今日休息」,今日预约块隐藏。
   四种态的节点**互斥**:判据按节点在不在验(图 §七 第 11 条)。

   ══ 不做(图 §八)══
   图表页 / 导出 / 自定义指标 / 快捷格 / 多店汇总 / 首页轮询(全屏态除外,那是段 11)。
   右上「⤢ 全屏大屏」这一批只占位。 */
window.DashboardHome = (function () {
  const PERIODS = [
    { key: 'today', zh: '今日', en: 'Today' },
    { key: 'week', zh: '本周', en: 'This week' },
    { key: 'month', zh: '本月', en: 'This month' },
    { key: 'year', zh: '本年', en: 'This year' },
  ]
  /* 六项的名字与单位由前端只做「摆」——**数与币种都来自后端**(前端零计算) */
  const LABEL = {
    revenue: ['营业收入', 'Revenue'], cash: ['现金业绩', 'Cash'], cardUse: ['总卡耗', 'Card used'],
    newCard: ['新增持卡', 'New cards'], visits: ['到店人次', 'Visits'], bookings: ['今日预约', 'Bookings'],
  }
  let st = { period: 'today', pulse: null, now: null, todo: null, phase: 'loading', deps: null, host: null }

  const esc = (s) => st.deps.escapeHtml(String(s == null ? '' : s))
  const zh = () => st.deps.isZh !== false
  const label = (k) => (zh() ? LABEL[k][0] : LABEL[k][1])

  /* 🔴 金额**一个币符都不许写在这里**(币种红线;`test-currency-scan` 当场咬住了我第一版)。
     全仓金额出口是 `admin.js` 的 `money()`(它读门店币种映射表)—— 由调用方注入进来。
     没币种时它自己会退成什么样由那个出口负责,这里只负责「拿不到数就出「—」」。 */
  function moneyOf(cents, cur) {
    if (cents === undefined || cents === null) return '—'
    if (!cur) return '—'      // 没币种就不出数(D140 fail-closed),不是出个裸数字
    return st.deps.money(cents)
  }
  const valueText = (m, cur) => {
    if (m.locked) return '🔒'
    if (m.unit === 'money') return moneyOf(m.value, cur)
    return `${m.value}${m.unit === 'people' ? (zh() ? ' 人' : '') : ''}`
  }
  const deltaText = (m) => {
    if (m.locked) return ''
    if (m.deltaPct === null || m.deltaPct === undefined) {
      return `<span class="dh-delta dh-delta-none" data-delta="none">${zh() ? '上期 0,没法比' : 'No prior data'}</span>`
    }
    const up = m.deltaPct >= 0
    return `<span class="dh-delta ${up ? 'up' : 'down'}" data-delta="${m.deltaPct}">${up ? '▲' : '▼'} ${Math.abs(m.deltaPct)}%</span>`
  }

  const periodBar = () => `<div class="dh-periods" data-dh-periods>${PERIODS.map((p) => `
      <button type="button" class="dh-period${p.key === st.period ? ' on' : ''}" data-dh-period="${p.key}">${zh() ? p.zh : p.en}</button>`).join('')}
      <button type="button" class="dh-full ghost slim" data-dh-full disabled title="${zh() ? '全屏大屏(下一批)' : 'Fullscreen (next batch)'}">⤢ ${zh() ? '全屏大屏' : 'Fullscreen'}</button>
    </div>`

  /* ── 四种态,各自一句真话,节点互斥 ───────────────────────── */
  const skeleton = () => `<section class="card dh-card" data-dh-state="loading">
      ${periodBar()}
      <div class="dh-skeleton" data-dh-skeleton>${'<div class="dh-sk-line"></div>'.repeat(4)}</div>
    </section>`
  const failed = () => `<section class="card dh-card" data-dh-state="failed">
      ${periodBar()}
      <p class="dh-truth" data-dh-truth>${zh() ? '业绩数据暂时取不到' : 'Metrics are unavailable right now'}</p>
      <button type="button" class="ghost slim" data-dh-retry>${zh() ? '重试' : 'Retry'}</button>
    </section>`

  function bigBlock() {
    const p = st.pulse || {}
    const cur = p.currency
    const ms = p.metrics || []
    const head = ms[0]
    const empty = ms.every((m) => !m.locked && !m.value)
    return `<section class="card dh-card" data-dh-state="ready">
      ${periodBar()}
      <div class="dh-head">
        <p class="eyebrow">${label('revenue')}</p>
        <h2 class="dh-big" data-dh-metric="revenue">${head ? valueText(head, cur) : '—'}</h2>
        ${head ? deltaText(head) : ''}
        ${p.locked ? `<span class="dh-locked" data-dh-locked>${zh() ? '财务已上锁,解锁后可见' : 'Locked'}</span>` : ''}
      </div>
      ${empty ? `<p class="dh-truth" data-dh-truth-empty>${zh() ? '今天还没有开单 · 暂无往日数据' : 'No orders yet today'}</p>` : ''}
      <div class="dh-tiles" data-dh-tiles>
        ${ms.slice(1).map((m) => `<div class="dh-tile" data-dh-metric="${m.key}">
            <span class="dh-tile-k">${label(m.key)}</span>
            <strong class="dh-tile-v">${valueText(m, cur)}</strong>
            ${m.extra && m.extra.times !== undefined ? `<span class="dh-tile-x" data-dh-times>${m.extra.times} ${esc(m.extra.timesUnit || '次')}</span>` : ''}
            ${deltaText(m)}
          </div>`).join('')}
      </div>
    </section>`
  }

  function nowBlock() {
    const nw = st.now || {}
    if (nw.closed) {
      return `<section class="card dh-card" data-dh-state="closed">
        <p class="dh-truth" data-dh-truth-closed>${zh() ? '今日休息' : 'Closed today'}</p>
      </section>`
    }
    const nx = nw.next
    /* 区块自己用 `data-dh-now-block`,格子才用 `data-dh-now` —— 同名会让判据的选择器把区块也数进去(现测 DOM 里多出一个空格子) */
    return `<section class="card dh-card" data-dh-now-block>
      <div class="dh-now4">
        <div class="dh-now-cell" data-dh-now="doing"><span>${zh() ? '在做' : 'In progress'}</span><strong>${nw.doing ?? '—'}</strong></div>
        <div class="dh-now-cell" data-dh-now="waiting"><span>${zh() ? '待到店' : 'Waiting'}</span><strong>${nw.waiting ?? '—'}</strong></div>
        <div class="dh-now-cell" data-dh-now="done"><span>${zh() ? '已完成' : 'Done'}</span><strong>${nw.done ?? '—'}</strong></div>
        <div class="dh-now-cell" data-dh-now="total"><span>${zh() ? '今日预约' : 'Today'}</span><strong>${nw.total ?? '—'}</strong></div>
      </div>
      ${nx ? `<div class="dh-next" data-dh-next>${zh() ? '下一位' : 'Next'} ${esc(nx.time)} · ${esc(nx.customer)} · ${esc(nx.service)}${nx.tech ? ` · ${esc(nx.tech)}` : ''}</div>`
    : `<div class="dh-next dh-next-none" data-dh-next-none>${zh() ? '后面没有待到店的了' : 'No one waiting'}</div>`}
    </section>`
  }

  const TODO_LABEL = {
    aiHandoff: ['客服待人工', 'AI handoffs'], quotePending: ['待报价', 'Quotes'],
    notePending: ['待写小记', 'Notes'], shiftApproval: ['调休待批', 'Shift requests'], dailyClose: ['待日结', 'Daily close'],
  }
  function todoBlock() {
    const items = (st.todo && st.todo.items) || []
    /* 图 §七⑦:**为 0 的项无节点**;全 0 时真话块存在 —— 两者互斥 */
    const live = items.filter((x) => Number(x.n) > 0)
    if (!live.length) {
      return `<section class="card dh-card" data-dh-todo>
        <p class="dh-truth" data-dh-truth-todo>${zh() ? '今天没有要处理的' : 'Nothing to handle today'}</p></section>`
    }
    return `<section class="card dh-card" data-dh-todo>
      ${live.map((x) => `<button type="button" class="dh-todo-row" data-dh-todo-key="${esc(x.key)}" data-dh-to="${esc(x.to)}">
          <span>${zh() ? (TODO_LABEL[x.key] || [x.key])[0] : (TODO_LABEL[x.key] || ['', x.key])[1]}</span><strong>${x.n}</strong></button>`).join('')}
    </section>`
  }

  function paint() {
    if (!st.host) return
    if (st.phase === 'loading') { st.host.innerHTML = skeleton(); return }
    if (st.phase === 'failed') { st.host.innerHTML = failed(); bind(); return }
    st.host.innerHTML = `${bigBlock()}${nowBlock()}${todoBlock()}`
    bind()
  }

  function bind() {
    st.host.querySelectorAll('[data-dh-period]').forEach((el) => {
      el.addEventListener('click', () => { st.period = el.dataset.dhPeriod; load() })
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
      const [p, nw, td] = await Promise.all([
        st.deps.request(`/admin/dashboard/pulse?period=${encodeURIComponent(st.period)}`),
        st.deps.request('/admin/dashboard/now'),
        st.deps.request('/admin/dashboard/todo'),
      ])
      st.pulse = p; st.now = nw; st.todo = td
      st.phase = 'ready'
    } catch (e) {
      /* 🔴 失败态**不显示旧数、不显示 0**(图 §六):把手上的数清掉再画 */
      st.pulse = null; st.now = null; st.todo = null
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
