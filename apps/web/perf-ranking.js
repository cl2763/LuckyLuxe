/* Employee performance ranking and target view. Loaded before admin.js. */
/* ===== P2.5 技师业绩可视化(设计图 V1,2026-08-08)=====
   排行与目标进度都读 /admin/perf-ranking —— 后端那边与工资试算是同一个函数,
   两处数字逐分一致(测试里有断言)。前端只负责画,条宽用后端给的 barPct。
   设计图硬性要求:**金额在条外右列,进度条里不压任何文字**。 */
let perfRankState = { metric: 'perf', period: 'month', month: '', data: null, loading: false, error: '', serial: 0 }

async function loadPerfRanking() {
  const serial = ++perfRankState.serial
  const month = perfRankState.month || storeToday().slice(0, 7)
  perfRankState.month = month
  perfRankState.loading = true
  perfRankState.error = ''
  renderPerfRanking()
  try {
    const date = perfRankState.period === 'month' ? `&date=${encodeURIComponent(month)}` : ''
    const res = await request(`/admin/perf-ranking?metric=${perfRankState.metric}&period=${perfRankState.period}${date}`)
    if (serial !== perfRankState.serial) return
    perfRankState.data = res.ranking
  } catch (error) {
    if (serial === perfRankState.serial) perfRankState.error = error && error.message || '暂时无法加载业绩排行'
  } finally {
    if (serial === perfRankState.serial) { perfRankState.loading = false; renderPerfRanking() }
  }
}

function renderPerfRanking() {
  const body = document.querySelector('#perfRankBody')
  const prog = document.querySelector('#perfProgBody')
  if (!body || !prog) return
  const zh = owner.lang === 'zh'
  document.querySelectorAll('#perfRankMetric [data-rank-metric]').forEach((b) => b.classList.toggle('on', b.dataset.rankMetric === perfRankState.metric))
  document.querySelectorAll('#perfRankPeriod [data-rank-period]').forEach((b) => b.classList.toggle('on', b.dataset.rankPeriod === perfRankState.period))
  const monthPicker = document.querySelector('#perfRankMonth')
  if (monthPicker) { monthPicker.value = perfRankState.month || storeToday().slice(0, 7); monthPicker.classList.toggle('hidden', perfRankState.period !== 'month') }
  if (perfRankState.loading) { body.innerHTML = `<p class="subtle">${zh ? '加载中…' : 'Loading…'}</p>`; return }
  if (perfRankState.error) { body.innerHTML = `<p class="subtle">${escapeHtml(perfRankState.error)} <button type="button" data-retry-perf-rank>${zh ? '重试' : 'Retry'}</button></p>`; prog.innerHTML = ''; return }
  const d = perfRankState.data
  if (!d) { body.innerHTML = ''; prog.innerHTML = ''; return }

  const title = document.querySelector('#perfRankTitle')
  if (title) title.textContent = `${zh ? '业绩排行' : 'Ranking'} · ${d.key}`
  const valueText = (r) => (d.metric === 'orders'
    ? `${r.orderCount} ${zh ? '单' : ''}`
    : money(d.metric === 'recharge' ? r.rechargeCents : r.perfCents, 2))

  body.innerHTML = d.ranking.length ? d.ranking.map((r) => `
    <div class="rankrow">
      <span class="no ${r.rank <= 2 ? 'top' : ''}">${r.rank}</span>
      <span class="who">${escapeHtml(r.name)}<small>${escapeHtml(r.title || (zh ? '技师' : 'Tech'))} · ${r.orderCount} ${zh ? '单' : ''}</small></span>
      <span class="barwrap"><i style="width:${r.barPct}%"></i></span>
      <span class="amt">${valueText(r)}</span>
      <span class="meta">${zh ? '卡耗' : 'Card'} ${money(r.cardUsedCents, 2)} · ${zh ? '冲卡' : 'Recharge'} ${money(r.rechargeCents, 2)}</span>
    </div>`).join('') : `<p class="subtle">${zh ? '本店还没有已确认的日结,排行是空的。' : 'No confirmed daily closes yet.'}</p>`

  // 目标进度只在月维度有意义;日维度后端不下发 target,这里整块提示一句
  prog.innerHTML = d.period !== 'month'
    ? `<p class="subtle">${zh ? '目标按月设置,切到「本月」看进度。' : 'Targets are monthly.'}</p>`
    : (d.targets.length ? d.targets.map((t) => (t.target ? `
      <div class="progrow">
        <span class="nm">${escapeHtml(t.name)}</span>
        <span class="pbar"><i class="${t.target.hit ? 'done' : ''}" style="width:${Math.min(100, t.target.pct)}%"></i></span>
        <span class="pct"><b>${money(t.perfCents, 2)}</b> / ${money(t.target.perfTargetCents, 2)}</span>
        <span class="pct">${t.target.hit ? `<span class="dc-badge ok">${zh ? '已达标' : 'Hit'}</span>` : `<b>${t.target.pct}%</b>`}</span>
      </div>` : `
      <div class="progrow">
        <span class="nm">${escapeHtml(t.name)}</span>
        <span class="tag-none" style="grid-column:span 3">${zh ? '未设目标 · 去「业绩目标」页签设置' : 'No target set'}</span>
      </div>`)).join('') : '')
}
