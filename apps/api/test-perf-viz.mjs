// P2.5 技师业绩可视化回归(2026-08-08,设计图 V1/V2/V3):
// ① 排行三维度(业绩/单数/冲卡)排序各自正确
// ② 口径红线:排行数字与工资试算逐分一致(同一个 monthPerfFromCloses),未日结的天不计入
// ③ 未设目标 → target 为 null(前端据此显示「未设目标」,不画 0% 的条)
// ④ 员工端 hero 带目标进度与「还差 X 达标」;没设目标整块不下发
// ⑤ total_only 时 hero 的进度条照常给,分项仍然全页不下发(v5 修正不受影响)
// ⑥ 本日 / 本月两个周期都对
// ⑦ 租户隔离 + 员工看不到排行
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const PLATFORM = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN_ID = Date.now().toString(36)

let checks = 0
function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

async function request(path, options = {}, token = PLATFORM, extraHeaders = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders, ...(options.headers || {}) }
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, data }
}

async function newShop(label) {
  const id = `p25-${label}-${RUN_ID}`
  const created = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id, name: `可视化店${label}${RUN_ID}`, plan: 'chain' }) })
  if (created.status !== 201) throw new Error(`建店失败: ${JSON.stringify(created.data)}`)
  const { username, initialPassword } = created.data.owner
  const first = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: initialPassword }) }, null)
  const pass = `Pw-${RUN_ID}-${label}9`
  await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: initialPassword, newPassword: pass, confirmPassword: pass }) }, first.data.auth.accessToken)
  const again = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: pass }) }, null)
  return { tenantId: id, token: again.data.auth.accessToken }
}

async function main() {
  const shop = await newShop('a')
  const other = await newShop('b')
  check('两家临时店建好', Boolean(shop.token && other.token))

  const today = (await request('/admin/store-clock', {}, shop.token)).data.today
  const month = today.slice(0, 7)

  // 三位技师 + 一个项目 + 一位顾客
  const techs = {}
  for (const name of ['甲师', '乙师', '丙师']) {
    techs[name] = (await request(`/platform/tenants/${shop.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: `${name}${RUN_ID}` }) })).data.technician
  }
  const cat = (await request('/admin/pricing/categories', { method: 'POST', body: JSON.stringify({ key: 'nail', name: '美甲' }) }, shop.token)).data.category
  const svc = (await request('/admin/pricing/items', {
    method: 'POST', body: JSON.stringify({ nameZh: `款式${RUN_ID}`, type: 'NAIL', categoryId: cat.id, itemKind: 'main', listPriceCents: 10000, baseDurationMin: 60 })
  }, shop.token)).data.item
  const cust = (await request(`/platform/tenants/${shop.tenantId}/import/customers`, {
    method: 'POST', body: JSON.stringify({ dryRun: false, rows: [{ name: `顾客${RUN_ID}`, phone: `1386${RUN_ID.slice(-7)}` }] })
  })).data.users[0].userId
  /* D25(3-1b,2026-08-12):导入客非绑定,充值会被拦 —— fixture 直连库绑上微信(同 noshow ⑮ 先例) */
  {
    const { DatabaseSync } = await import('node:sqlite')
    const bindDb = new DatabaseSync(process.env.TEST_DB_PATH)
    bindDb.prepare('UPDATE users SET wechat_open_id = ? WHERE id = ?').run('wx-d25fix-' + cust, cust)
    bindDb.close()
  }

  // 甲师 3 单、乙师 2 单、丙师 1 单(单价 ¥100),签署后日结确认
  const counts = { 甲师: 3, 乙师: 2, 丙师: 1 }
  for (const [name, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i += 1) {
      const g = await request('/admin/settlements', {
        method: 'POST',
        body: JSON.stringify({
          cardOwnerUserId: cust,
          settlements: [{ tierKey: 'list', items: [{ serviceId: svc.id }], technicians: [{ technicianId: techs[name].id, role: 'main', itemNos: [1] }] }]
        })
      }, shop.token)
      await request(`/settlements/${g.data.settlements[0].code}/sign`, { method: 'POST', body: JSON.stringify({ disclaimerAccepted: true, signature: '顾客' }) }, null)
    }
  }
  // 丙师促成一笔充值 ¥500(冲卡维度用)
  await request('/admin/stored-value/recharge', {
    method: 'POST', body: JSON.stringify({ userId: cust, amountCents: 50000, technicianId: techs['丙师'].id, payChannel: 'cash' })
  }, shop.token)

  // ---- ② 没日结之前:排行必须是 0(未日结不计入)----
  const beforeClose = await request('/admin/perf-ranking', {}, shop.token)
  check('② 未日结时排行全 0(口径=已确认日结)',
    beforeClose.data.ranking.ranking.every((r) => r.perfCents === 0 && r.orderCount === 0),
    JSON.stringify(beforeClose.data.ranking.ranking.map((r) => [r.name, r.perfCents])))

  const closed = await request('/admin/daily-close', { method: 'POST', body: JSON.stringify({ date: today }) }, shop.token)
  if (closed.status !== 200) throw new Error(`日结失败: ${JSON.stringify(closed.data).slice(0, 200)}`)

  // ---- ① 三维度排序 ----
  const byPerf = (await request('/admin/perf-ranking?metric=perf', {}, shop.token)).data.ranking
  check('① 按业绩排:甲(¥300) > 乙(¥200) > 丙(¥100)',
    byPerf.ranking[0].perfCents === 30000 && byPerf.ranking[1].perfCents === 20000 && byPerf.ranking[2].perfCents === 10000,
    JSON.stringify(byPerf.ranking.map((r) => [r.name, r.perfCents])))
  check('① 名次与条宽比例跟着排序走(第一名 100%)',
    byPerf.ranking[0].rank === 1 && byPerf.ranking[0].barPct === 100 && byPerf.ranking[2].barPct === 33,
    JSON.stringify(byPerf.ranking.map((r) => [r.rank, r.barPct])))
  const byOrders = (await request('/admin/perf-ranking?metric=orders', {}, shop.token)).data.ranking
  check('① 按单数排:3 / 2 / 1', byOrders.ranking.map((r) => r.orderCount).join(',') === '3,2,1',
    JSON.stringify(byOrders.ranking.map((r) => [r.name, r.orderCount])))
  const byRecharge = (await request('/admin/perf-ranking?metric=recharge', {}, shop.token)).data.ranking
  check('① 按冲卡排:促成充值的丙师排第一', byRecharge.ranking[0].rechargeCents === 50000,
    JSON.stringify(byRecharge.ranking.map((r) => [r.name, r.rechargeCents])))

  // ---- ② 与工资试算逐分一致(本套件的核心)----
  const salary = (await request(`/admin/salary/estimate?month=${month}`, {}, shop.token)).data
  for (const r of byPerf.ranking) {
    const row = (salary.rows || []).find((x) => x.technicianId === r.technicianId)
    check(`② ${r.name} 排行业绩与工资试算逐分一致(${r.perfCents})`,
      row && row.perfCents === r.perfCents, `排行 ${r.perfCents} vs 试算 ${row && row.perfCents}`)
  }

  // ---- ⑥ 本日周期 ----
  const day = (await request(`/admin/perf-ranking?period=day&date=${today}`, {}, shop.token)).data.ranking
  check('⑥ 本日维度金额与本月一致(数据都在今天)', day.period === 'day' && day.ranking[0].perfCents === 30000,
    JSON.stringify({ period: day.period, top: day.ranking[0].perfCents }))
  check('⑥ 本日维度不给目标(目标本身是月目标)', day.ranking.every((r) => r.target === null))

  // ---- ③ 目标进度 ----
  check('③ 没设目标时 target 为 null(前端显示「未设目标」,不画 0% 的条)',
    byPerf.targets.every((t) => t.target === null), JSON.stringify(byPerf.targets))
  await request('/admin/perf-targets', {
    method: 'PUT',
    body: JSON.stringify({
      month,
      targets: [
        { technicianId: techs['甲师'].id, mode: 'total', displayMode: 'total_only', perfTargetCents: 20000 },
        { technicianId: techs['乙师'].id, mode: 'total', displayMode: 'total_only', perfTargetCents: 40000 }
      ]
    })
  }, shop.token)
  const withTargets = (await request('/admin/perf-ranking', {}, shop.token)).data.ranking
  const jia = withTargets.targets.find((t) => t.technicianId === techs['甲师'].id)
  const yi = withTargets.targets.find((t) => t.technicianId === techs['乙师'].id)
  const bing = withTargets.targets.find((t) => t.technicianId === techs['丙师'].id)
  check('③ 达标的给 hit=true 与 100% 以上', jia.target.hit === true && jia.target.pct === 150, JSON.stringify(jia.target))
  check('③ 未达标的给百分比与差额', yi.target.hit === false && yi.target.pct === 50 && yi.target.gapCents === 20000, JSON.stringify(yi.target))
  check('③ 没设目标的仍是 null', bing.target === null, JSON.stringify(bing))

  // ---- ④⑤ 员工端 hero ----
  const acct = await request('/admin/staff-accounts', { method: 'POST', body: JSON.stringify({ technicianId: techs['乙师'].id }) }, shop.token)
  const sf = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: acct.data.username, password: acct.data.initialPassword }) }, null)
  const sp = `Sf-${RUN_ID}-a9`
  await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: acct.data.initialPassword, newPassword: sp, confirmPassword: sp }) }, sf.data.auth.accessToken)
  const staffToken = (await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: acct.data.username, password: sp }) }, null)).data.auth.accessToken

  const mine = (await request(`/admin/my-performance?month=${month}`, {}, staffToken)).data.performance
  check('④ hero 给出目标进度与「还差 X 达标」',
    mine.hero.hasTarget === true && mine.hero.pct === 50 && mine.hero.gapCents === 20000 && mine.hero.hitTarget === false,
    JSON.stringify(mine.hero))
  check('⑤ display_mode=total_only 时进度条照给,分项仍然全不下发',
    mine.displayMode === 'total_only' && mine.hero.cardUsedCents === undefined && mine.daily.every((d) => d.cardUsedCents === undefined),
    JSON.stringify({ mode: mine.displayMode, hero: mine.hero }))

  // 丙师没设目标 → hero 不给进度块
  const acct2 = await request('/admin/staff-accounts', { method: 'POST', body: JSON.stringify({ technicianId: techs['丙师'].id }) }, shop.token)
  const sf2 = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: acct2.data.username, password: acct2.data.initialPassword }) }, null)
  const sp2 = `Sf-${RUN_ID}-b9`
  await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: acct2.data.initialPassword, newPassword: sp2, confirmPassword: sp2 }) }, sf2.data.auth.accessToken)
  const staff2 = (await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: acct2.data.username, password: sp2 }) }, null)).data.auth.accessToken
  const mine2 = (await request(`/admin/my-performance?month=${month}`, {}, staff2)).data.performance
  check('④ 没设目标的人 hero 不给进度(hasTarget=false,gap/pct 都是 null)',
    mine2.hero.hasTarget === false && mine2.hero.pct === null && mine2.hero.gapCents === null, JSON.stringify(mine2.hero))

  // ---- ⑦ 权限与隔离 ----
  const staffRank = await request('/admin/perf-ranking', {}, staffToken)
  check('⑦ 员工看不到全店排行(403)', staffRank.status === 403, `${staffRank.status}`)
  const crossRank = (await request('/admin/perf-ranking', {}, other.token)).data.ranking
  check('⑦ B 店排行里没有 A 店的人', crossRank.ranking.every((r) => !r.name.includes(RUN_ID)),
    JSON.stringify(crossRank.ranking.map((r) => r.name)))

  console.log(`\n技师业绩可视化回归通过:${checks} 项断言全绿`)
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`)
  process.exit(1)
})
