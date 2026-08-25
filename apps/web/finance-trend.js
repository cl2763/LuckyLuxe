/* 网页商家后台 · 财务趋势域(从 admin.js 搬出,2026-08-25 S6)。
   公约②「边改边拆」:S6 这一刀动的就是这块(占比改圆环、主图表加悬停),按约定顺手搬出来。
   **只搬不改**:整段原样搬,依赖(owner / trendMoney / escapeHtml / financeTrendState 等全局)
   在运行期解析;admin.html 里本文件排在 admin.js 之前加载。 */

function renderFinanceTrend() {
  const body = document.querySelector('#financeTrendBody')
  if (!body || !financeTrendState.data) return
  const zh = owner.lang === 'zh'
  const t = financeTrendState.data
  const hasTarget = Boolean(t.monthTargetCents)
  const max = Math.max(1, ...t.points.map((p) => Math.max(p.revenueCents, p.expenseCents, hasTarget ? t.monthTargetCents : 0)))
  const H = 150
  const px = (cents) => Math.round(Math.max(0, cents) / max * H)
  /* 净赚折线**和柱子共用同一根纵轴**(设计图第二条取舍:不做左右双轴,
     两根轴的比例是随便定的,等于凭空造一个「相关性」)。负数压到零轴上。 */
  const netY = (cents) => Math.max(4, Math.min(H, H - px(cents)))

  const rangeBtn = (key, label) => `<button class="ghost slim${financeTrendState.range === key ? ' active' : ''}" data-trend-range="${key}" type="button">${label}</button>`
  const tableBtn = (k) => `<button class="ghost slim trend-tv" data-trend-tv="${k}" type="button">${trendTableView[k] ? (zh ? '图表视图' : 'Chart') : (zh ? '表格视图' : 'Table')}</button>`

  const mainChart = trendTableView.main
    ? `<table class="dc-sum">
        <tr><th>${zh ? '月份' : 'Month'}</th><th>${zh ? '收入' : 'Revenue'}</th><th>${zh ? '支出' : 'Expense'}</th><th>${zh ? '净赚' : 'Net'}</th><th>${zh ? '单量' : 'Orders'}</th><th>${zh ? '客单' : 'Avg'}</th><th>${zh ? '目标' : 'Target'}</th></tr>
        ${t.points.slice().reverse().map((p) => `<tr>
          <td class="nm">${escapeHtml(p.label)}${p.partial ? ` <span class="subtle">${zh ? '本月至今' : 'MTD'}</span>` : ''}</td>
          <td>${trendMoney(p.revenueCents)}</td><td>${trendMoney(p.expenseCents)}</td><td>${trendMoney(p.netCents)}</td>
          <td>${p.orderCount}</td><td>${trendMoney(p.avgTicketCents)}</td>
          <td>${!hasTarget ? '—' : (p.hitTarget ? `<span class="dc-badge ok">${zh ? '达标' : 'Hit'}</span>` : trendMoney(t.monthTargetCents))}</td>
        </tr>`).join('')}
      </table>`
    : `<div class="trend-chart" style="position:relative">
        ${hasTarget ? `<div class="trend-targetline" style="bottom:${px(t.monthTargetCents) + 20}px"><span>${zh ? '月营收目标' : 'Target'} ${trendMoney(t.monthTargetCents)}</span></div>` : ''}
        ${/* 🔴 S6②(店主 08-25):顶部主图表**加悬停显示金额** —— 原来只有 title(浏览器自带气泡,
              要停一秒才出、样式不可控)。现在鼠标移到这根柱子上,收入/支出/净赚三行直接浮出来。
              title 保留:键盘/读屏用户与不支持 hover 的触屏还靠它。 */''}
        ${t.points.map((p) => `
          <div class="trend-bar">
            <div class="stack">
              <div class="trend-hover">${escapeHtml(p.label)} · ${zh ? '收入' : 'Rev'} ${trendMoney(p.revenueCents)} · ${zh ? '支出' : 'Exp'} ${trendMoney(p.expenseCents)} · ${zh ? '净赚' : 'Net'} ${trendMoney(p.netCents)}</div>
              <div class="b${hasTarget && p.hitTarget ? ' hit' : ''}${p.partial ? ' partial' : ''}" style="height:${px(p.revenueCents)}px" title="${zh ? '收入' : 'Revenue'} ${trendMoney(p.revenueCents)}"></div>
              <div class="b exp${p.partial ? ' partial' : ''}" style="height:${px(p.expenseCents)}px" title="${zh ? '支出' : 'Expense'} ${trendMoney(p.expenseCents)}"></div>
            </div>
            <span class="lb">${escapeHtml(p.label)}${p.partial ? `<em>${zh ? '至今' : 'MTD'}</em>` : ''}</span>
          </div>`).join('')}
        <svg class="trend-netline" viewBox="0 0 ${Math.max(1, t.points.length) * 100} ${H}" preserveAspectRatio="none">
          <polyline points="${t.points.map((p, i) => `${i * 100 + 50},${netY(p.netCents)}`).join(' ')}" fill="none" stroke="#2f7d5c" stroke-width="3" vector-effect="non-scaling-stroke"/>
          ${t.points.map((p, i) => `<circle cx="${i * 100 + 50}" cy="${netY(p.netCents)}" r="4" fill="#2f7d5c"/>`).join('')}
        </svg>
      </div>
      <div class="trend-legend">
        <span><i style="background:#c8a47e"></i>${zh ? '收入' : 'Revenue'}</span>
        ${hasTarget ? `<span><i style="background:#2f7d5c"></i>${zh ? '达标月' : 'Hit'}</span>` : ''}
        <span><i style="background:#e0d3c4"></i>${zh ? '支出' : 'Expense'}</span>
        <span><i style="background:#2f7d5c;height:3px;margin-bottom:3px"></i>${zh ? '净赚(折线)' : 'Net (line)'}</span>
        <span><i style="background:#efe4d5"></i>${zh ? '浅色=本月至今(未满月)' : 'light = MTD'}</span>
      </div>`

  const sd = t.sameDays
  const sameBlock = !sd ? '' : (trendTableView.same
    ? `<table class="dc-sum">
        <tr><th>${zh ? '区间' : 'Window'}</th><th>${zh ? '收入' : 'Revenue'}</th><th>${zh ? '支出' : 'Expense'}</th><th>${zh ? '净赚' : 'Net'}</th></tr>
        ${[[zh ? '本月至今' : 'This month', sd.current], [zh ? '上月同期' : 'Last month', sd.lastMonth], [zh ? '去年同期' : 'Last year', sd.lastYear]].map(([lab, w]) => `
          <tr><td class="nm">${lab} <span class="subtle">${w.from}~${w.to}</span></td><td>${trendMoney(w.revenueCents)}</td><td>${trendMoney(w.expenseCents)}</td><td>${trendMoney(w.netCents)}</td></tr>`).join('')}
      </table>`
    : `<div class="trend-same">
        ${[[zh ? '本月至今' : 'This month', sd.current, true], [zh ? '上月同期' : 'Last month', sd.lastMonth, false], [zh ? '去年同期' : 'Last year', sd.lastYear, false]].map(([lab, w, cur]) => {
          const m2 = Math.max(1, sd.current.revenueCents, sd.lastMonth.revenueCents, sd.lastYear.revenueCents)
          return `<div class="tsame-row${cur ? ' cur' : ''}">
            <span class="tsame-lab">${lab}</span>
            <span class="tsame-bar"><i style="width:${Math.round(w.revenueCents / m2 * 100)}%"></i></span>
            <b>${trendMoney(w.revenueCents)}</b>
          </div>`
        }).join('')}
        <p class="subtle">${zh ? `三组都是 1–${sd.days} 日的相同天数,黑线标出的是当前。` : `All windows truncated to the same ${sd.days} days.`}</p>
      </div>`)

  const eb = t.expenseBreakdown || { rows: [] }
  const ebMax = Math.max(1, ...eb.rows.map((r) => r.amountCents))
  const expenseBlock = trendTableView.expense
    ? `<table class="dc-sum">
        <tr><th>${zh ? '类别' : 'Category'}</th><th>${zh ? '本期' : 'Now'}</th><th>${zh ? '上期同区间' : 'Prev'}</th><th>${zh ? '增减' : 'Δ'}</th></tr>
        ${eb.rows.map((r) => `<tr><td class="nm">${escapeHtml(r.category)}</td><td>${trendMoney(r.amountCents)}</td><td>${trendMoney(r.prevAmountCents)}</td>
          <td class="${r.deltaCents > 0 ? 'warn' : ''}">${r.deltaCents >= 0 ? '+' : '−'}${trendMoney(Math.abs(r.deltaCents))}</td></tr>`).join('')}
      </table>`
    : (eb.rows.length ? `<div class="trend-hbars">
        ${eb.rows.map((r) => `<div class="thbar">
          <span class="thlab">${escapeHtml(r.category)}</span>
          <span class="thtrack"><i style="width:${Math.round(r.amountCents / ebMax * 100)}%"></i></span>
          <b>${trendMoney(r.amountCents)}</b>
          <span class="thdelta ${r.deltaCents > 0 ? 'up' : (r.deltaCents < 0 ? 'down' : '')}">${r.deltaCents === 0 ? '—' : `${r.deltaCents > 0 ? '+' : '−'}${trendMoney(Math.abs(r.deltaCents))}`}</span>
        </div>`).join('')}
      </div>` : `<p class="subtle">${zh ? '本期还没有支出记录。' : 'No expenses yet.'}</p>`)

  const mix = t.incomeMix || { months: [], categories: [] }
  const mixMax = Math.max(1, ...mix.months.map((m) => m.totalCents))
  const MIXC = ['#c8a47e', '#8fb6a4', '#d9b58c', '#a89b8c', '#e0d3c4', '#7f9bb5', '#c9a0a0', '#b9c4a0']
  const mixBlock = trendTableView.mix
    ? `<table class="dc-sum">
        <tr><th>${zh ? '月份' : 'Month'}</th>${mix.categories.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}<th>${zh ? '合计' : 'Total'}</th></tr>
        ${mix.months.slice().reverse().map((m) => `<tr><td class="nm">${escapeHtml(m.label)}</td>${mix.categories.map((c) => `<td>${trendMoney(m.parts[c] || 0)}</td>`).join('')}<td>${trendMoney(m.totalCents)}</td></tr>`).join('')}
      </table>`
    : (() => {
      /* 🔴 S6①(店主 2026-08-25):服务内容占比改**圆环图** —— 柱状图看不出百分比。
         口径:取所选区间**合计**(各月各类相加),每一瓣 = 该类占比;
         百分比与金额都写在图例上,不用把鼠标停上去猜。零数据出空态,不画一个假圆。 */
      const totals = {}
      for (const m of mix.months) for (const c of mix.categories) totals[c] = (totals[c] || 0) + (m.parts[c] || 0)
      const sum = Object.values(totals).reduce((a, b) => a + b, 0)
      if (!sum) return `<p class="subtle">${zh ? '这个区间还没有服务收入。' : 'No service income in this range.'}</p>`
      const parts = mix.categories.map((c, i) => ({ c, v: totals[c] || 0, color: MIXC[i % MIXC.length] })).filter((x) => x.v > 0)
      let acc = 0
      const stops = parts.map((x) => {
        const from = acc / sum * 100
        acc += x.v
        return `${x.color} ${from.toFixed(2)}% ${(acc / sum * 100).toFixed(2)}%`
      }).join(', ')
      return `<div class="mix-donut-wrap">
        <div class="mix-donut" style="background:conic-gradient(${stops})" role="img"
             aria-label="${zh ? '服务内容占比' : 'Service mix'}"><div class="mix-donut-hole"><b>${trendMoney(sum)}</b><span>${zh ? '合计' : 'Total'}</span></div></div>
        <div class="mix-donut-legend">
          ${parts.map((x) => `<div class="mix-legend-row"><i style="background:${x.color}"></i>
            <span class="nm">${escapeHtml(x.c)}</span>
            <b>${(x.v / sum * 100).toFixed(1)}%</b>
            <span class="amt">${trendMoney(x.v)}</span></div>`).join('')}
        </div>
      </div>`
    })()

  body.innerHTML = `
    <div class="section-row compact-row" style="gap:8px;flex-wrap:wrap">
      <div class="schedule-week-nav">
        ${rangeBtn('6m', zh ? '近 6 个月' : 'Last 6')}${rangeBtn('12m', zh ? '近 12 个月' : 'Last 12')}${rangeBtn('ytd', zh ? '今年' : 'YTD')}${rangeBtn('custom', zh ? '自定义' : 'Custom')}
      </div>
      <button class="ghost slim" id="trendCsv" type="button">${zh ? '导出 CSV' : 'Export CSV'}</button>
    </div>

    ${hasTarget ? '' : `<div class="trend-guide">
      <span>${zh ? '想看目标进度、收支平衡线、达标月份?就 3 项,一分钟;先不设也没关系,上面的真数和下面的走势永远都在。' : 'Set a target to see the goal line and hit months.'}</span>
      <button class="ghost slim" id="trendGoSetting" type="button">${zh ? '去设置 ›' : 'Set up ›'}</button>
    </div>`}

    <div class="section-row compact-row"><h3 class="trend-h">${zh ? '收入 / 支出 / 净赚' : 'Revenue / Expense / Net'}</h3>${tableBtn('main')}</div>
    ${mainChart}

    <div class="section-row compact-row"><h3 class="trend-h">${zh ? '本月至今 · 和谁比' : 'MTD comparison'}</h3>${tableBtn('same')}</div>
    ${sameBlock}

    <div class="section-row compact-row"><h3 class="trend-h">${zh ? '钱花在哪了 · 本期' : 'Where the money went'}</h3>${tableBtn('expense')}</div>
    ${expenseBlock}

    <div class="section-row compact-row"><h3 class="trend-h">${zh ? '收入构成变化 · 近 6 个完整月' : 'Income mix'}</h3>${tableBtn('mix')}</div>
    ${mixBlock}`

  body.querySelectorAll('[data-trend-tv]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.trendTv
    trendTableView[k] = !trendTableView[k]
    renderFinanceTrend()
  }))
  body.querySelectorAll('[data-trend-range]').forEach((b) => b.addEventListener('click', () => {
    loadFinanceTrend(null, b.dataset.trendRange).catch((error) => toast(error.message))
  }))
  const csv = body.querySelector('#trendCsv')
  if (csv) csv.addEventListener('click', () => exportTrendCsv(t))
  const go = body.querySelector('#trendGoSetting')
  if (go) go.addEventListener('click', () => document.querySelector('[data-fin-goal-edit]')?.click())
}

// 导出 CSV:图没法复制,表格能 —— 发给会计或自己核账用(设计图第三条取舍)
