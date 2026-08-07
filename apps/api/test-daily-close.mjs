// P2 日结回归(2026-08-08):
// ① 单技师单不占「待分配」;双技师单必须逐单分成
// ② 分成合计必须正好等于单额,差一分都拒
// ③ 门槛:有单没签 / 有单没分配 → 不许确认,并说清原因
// ④ 确认后落 daily_close_lines 快照(单数/业绩/卡耗/冲卡)
// ⑤ 冲卡:当日首充与续充分开统计,首充判定按该顾客在本店的第一笔充值
// ⑥ 异常核查:价档改动逐条列出、免卸项按 ¥0 明细行计数
// ⑦ 目标列:没设目标就不显示,不编默认值
// ⑧ 重开日结留痕(状态 reopened + 次数 + 原因),重开后才允许改分成
// ⑨ 租户隔离:B 店看不到也改不动 A 店的日结
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const PLATFORM = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN_ID = Date.now().toString(36)

let checks = 0
function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

const financeKeys = new Map()
async function request(path, options = {}, token = PLATFORM, extraHeaders = {}) {
  const fk = token ? financeKeys.get(token) : null
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(fk ? { 'x-finance-key': fk } : {}),
      ...extraHeaders,
      ...(options.headers || {})
    }
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, data }
}

async function newShop(label) {
  const id = `p2dc-${label}-${RUN_ID}`
  const created = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id, name: `日结店${label}${RUN_ID}`, plan: 'chain' }) })
  if (created.status !== 201) throw new Error(`建店失败: ${JSON.stringify(created.data)}`)
  const { username, initialPassword } = created.data.owner
  const first = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: initialPassword }) }, null)
  const pass = `Pw-${RUN_ID}-${label}9`
  await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: initialPassword, newPassword: pass, confirmPassword: pass }) }, first.data.auth.accessToken)
  const again = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: pass }) }, null)
  const token = again.data.auth.accessToken
  const unlock = await request('/admin/finance/unlock', { method: 'POST', body: JSON.stringify({ password: PLATFORM }) }, token)
  if (unlock.data?.financeKey) financeKeys.set(token, unlock.data.financeKey)
  return { tenantId: id, token }
}

async function main() {
  const shop = await newShop('a')
  const other = await newShop('b')
  check('两家临时店建好', Boolean(shop.token && other.token))

  const cat = (await request('/admin/pricing/categories', { method: 'POST', body: JSON.stringify({ key: 'nail', name: '美甲' }) }, shop.token)).data.category
  const catRm = (await request('/admin/pricing/categories', { method: 'POST', body: JSON.stringify({ key: 'removal', name: '卸甲' }) }, shop.token)).data.category
  const mk = async (body) => (await request('/admin/pricing/items', { method: 'POST', body: JSON.stringify(body) }, shop.token)).data.item
  const svc = await mk({ nameZh: `款式${RUN_ID}`, type: 'NAIL', categoryId: cat.id, itemKind: 'main', listPriceCents: 40000, memberPriceCents: 30000, baseDurationMin: 120 })
  const freeRm = await mk({ nameZh: '本店制作免卸甲', type: 'NAIL', categoryId: catRm.id, itemKind: 'addon', listPriceCents: 0, memberPriceCents: 0, addonScope: [cat.id] })

  const techA = (await request(`/platform/tenants/${shop.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: `小婕${RUN_ID}` }) })).data.technician
  const techB = (await request(`/platform/tenants/${shop.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: `苏苏${RUN_ID}` }) })).data.technician

  const imp = await request(`/platform/tenants/${shop.tenantId}/import/customers`, {
    method: 'POST',
    body: JSON.stringify({ dryRun: false, rows: [{ name: `小美${RUN_ID}`, phone: `1382${RUN_ID.slice(-7)}` }] })
  })
  const cust = imp.data.users[0].userId

  const today = (await request('/admin/store-clock', {}, shop.token)).data.today
  check('取到门店时区的「今天」', /^\d{4}-\d{2}-\d{2}$/.test(today), String(today))

  // 单技师单一张(¥300)+ 双技师单一张(¥300,带免卸甲行)
  const g1 = await request('/admin/settlements', {
    method: 'POST',
    body: JSON.stringify({
      cardOwnerUserId: cust,
      settlements: [{ tierKey: 'member', items: [{ serviceId: svc.id }], technicians: [{ technicianId: techA.id, role: 'main', itemNos: [1] }] }]
    })
  }, shop.token)
  const solo = g1.data.settlements[0]
  const g2 = await request('/admin/settlements', {
    method: 'POST',
    body: JSON.stringify({
      cardOwnerUserId: cust,
      settlements: [{
        tierKey: 'member', items: [{ serviceId: svc.id }, { serviceId: freeRm.id }],
        technicians: [{ technicianId: techA.id, role: 'main', itemNos: [1] }, { technicianId: techB.id, role: 'assist', itemNos: [2] }]
      }]
    })
  }, shop.token)
  const duo = g2.data.settlements[0]
  check('两张服务单已开', Boolean(solo.code && duo.code))

  // ---- ③ 有单没签 → 不许日结 ----
  const beforeSign = await request(`/admin/daily-close?date=${today}`, {}, shop.token)
  check('③ 有单没签时不许确认', beforeSign.data.dailyClose.canConfirm === false)
  check('③ 拦住的原因写明「没签字」', beforeSign.data.dailyClose.blockers.some((b) => b.code === 'UNSIGNED'),
    JSON.stringify(beforeSign.data.dailyClose.blockers))

  const s1 = await request(`/settlements/${solo.code}/sign`, { method: 'POST', body: JSON.stringify({ disclaimerAccepted: true, signature: '小美' }) }, null)
  if (s1.status !== 200) throw new Error(`签署失败 ${s1.status}: ${JSON.stringify(s1.data)}`)
  const s2 = await request(`/settlements/${duo.code}/sign`, { method: 'POST', body: JSON.stringify({ disclaimerAccepted: true, signature: '小美' }) }, null)
  if (s2.status !== 200) throw new Error(`签署失败2 ${s2.status}: ${JSON.stringify(s2.data)}`)

  const afterSign = await request(`/admin/daily-close?date=${today}`, {}, shop.token)
  const view = afterSign.data.dailyClose
  check('① 单技师单不占待分配', view.pendingAllocation.length === 1 && view.pendingAllocation[0].code === duo.code,
    JSON.stringify(view.pendingAllocation.map((p) => p.code)))
  check('① 单技师单业绩直接整单归他', view.technicians.find((t) => t.technicianId === techA.id).perfCents >= 30000,
    JSON.stringify(view.technicians))
  check('① 双技师未分配时技师行显示待分配笔数', view.technicians.find((t) => t.technicianId === techB.id).pendingCount === 1,
    JSON.stringify(view.technicians.find((t) => t.technicianId === techB.id)))
  check('③ 有单没分配时仍不许确认', view.canConfirm === false && view.blockers.some((b) => b.code === 'UNALLOCATED'),
    JSON.stringify(view.blockers))
  check('预填比例来自 perf_split_default', JSON.stringify(view.perfSplitDefault) === '[70,30]', JSON.stringify(view.perfSplitDefault))

  // ---- ⑥ 异常核查:免卸项按 ¥0 明细行计数 ----
  check('⑥ 免卸甲按 ¥0 明细行计到 1 笔', view.anomalies.freeRemoval.count === 1, JSON.stringify(view.anomalies.freeRemoval))
  check('⑥ 没改过档就没有价档异常', view.anomalies.tierChanges.length === 0, JSON.stringify(view.anomalies.tierChanges))

  // ---- ⑦ 没设目标就不显示 ----
  check('⑦ 未设目标的技师 target 为 null', view.technicians.every((t) => t.target === null), JSON.stringify(view.technicians.map((t) => t.target)))

  // ---- ② 分成合计必须等于单额 ----
  const bad = await request(`/admin/settlements/${duo.settlementId || duo.id}/allocate`, {
    method: 'POST',
    body: JSON.stringify({ shares: [{ technicianId: techA.id, sharePct: 70, shareCents: 20000 }, { technicianId: techB.id, sharePct: 30, shareCents: 9000 }] })
  }, shop.token)
  check('② 分成合计对不上直接拒', bad.status === 400 && bad.data.error.code === 'SHARE_MISMATCH', JSON.stringify(bad.data))
  const ok = await request(`/admin/settlements/${duo.id}/allocate`, {
    method: 'POST',
    body: JSON.stringify({ shares: [{ technicianId: techA.id, sharePct: 70, shareCents: 21000 }, { technicianId: techB.id, sharePct: 30, shareCents: 9000 }] })
  }, shop.token)
  check('② 合计等于单额才收', ok.status === 200 && ok.data.allocated === true, JSON.stringify(ok.data).slice(0, 200))

  // ---- ⑤ 冲卡:首充 + 续充分开 ----
  const r1 = await request('/admin/stored-value/recharge', {
    method: 'POST', body: JSON.stringify({ userId: cust, amountCents: 50000, technicianId: techA.id, note: '首充' })
  }, shop.token)
  if (r1.status !== 200 && r1.status !== 201) throw new Error(`首充失败 ${r1.status}: ${JSON.stringify(r1.data)}`)
  await request('/admin/stored-value/recharge', {
    method: 'POST', body: JSON.stringify({ userId: cust, amountCents: 20000, technicianId: techA.id, note: '续充' })
  }, shop.token)

  const ready = await request(`/admin/daily-close?date=${today}`, {}, shop.token)
  const rv = ready.data.dailyClose
  check('③ 全签 + 全分配后可以确认', rv.canConfirm === true && rv.blockers.length === 0, JSON.stringify(rv.blockers))
  const rowA = rv.technicians.find((t) => t.technicianId === techA.id)
  check('⑤ 首充 ¥500 记到促成技师名下', rowA.rechargeFirstCents === 50000, JSON.stringify(rowA))
  check('⑤ 续充 ¥200 单独统计', rowA.rechargeRenewCents === 20000, JSON.stringify(rowA))
  check('⑤ 冲卡合计 = 首充 + 续充', rowA.rechargeTotalCents === 70000, String(rowA.rechargeTotalCents))

  // ---- ④ 确认日结落快照 ----
  const confirmed = await request('/admin/daily-close', { method: 'POST', body: JSON.stringify({ date: today }) }, shop.token)
  check('④ 确认成功', confirmed.status === 200 && confirmed.data.confirmed === true && confirmed.data.status === 'confirmed',
    JSON.stringify(confirmed.data).slice(0, 200))
  check('④ 快照记下当日单数与营业额', confirmed.data.orderCount === 2 && confirmed.data.revenueCents === 60000,
    JSON.stringify({ n: confirmed.data.orderCount, r: confirmed.data.revenueCents }))

  // ---- ⑧ 已确认后不许直接改分成 ----
  const locked = await request(`/admin/settlements/${duo.id}/allocate`, {
    method: 'POST',
    body: JSON.stringify({ shares: [{ technicianId: techA.id, sharePct: 50, shareCents: 15000 }, { technicianId: techB.id, sharePct: 50, shareCents: 15000 }] })
  }, shop.token)
  check('⑧ 已日结的那天改分成被拦', locked.status === 400 && locked.data.error.code === 'DAY_CLOSED', JSON.stringify(locked.data))

  const noReason = await request('/admin/daily-close/reopen', { method: 'POST', body: JSON.stringify({ date: today }) }, shop.token)
  check('⑧ 重开日结必须写原因', noReason.status === 400 && noReason.data.error.code === 'REASON_REQUIRED', JSON.stringify(noReason.data))
  const reopened = await request('/admin/daily-close/reopen', { method: 'POST', body: JSON.stringify({ date: today, reason: '分成填错了' }) }, shop.token)
  check('⑧ 重开后状态 reopened 且次数 +1', reopened.data.status === 'reopened' && reopened.data.reopenCount === 1,
    JSON.stringify({ s: reopened.data.status, c: reopened.data.reopenCount }))
  const afterReopen = await request(`/admin/settlements/${duo.id}/allocate`, {
    method: 'POST',
    body: JSON.stringify({ shares: [{ technicianId: techA.id, sharePct: 50, shareCents: 15000 }, { technicianId: techB.id, sharePct: 50, shareCents: 15000 }] })
  }, shop.token)
  check('⑧ 重开后才能改分成', afterReopen.status === 200 && afterReopen.data.allocated === true)

  // ---- 月度视图:未日结的天列出来,全部日结才允许锁月 ----
  const month = today.slice(0, 7)
  const monthView = await request(`/admin/daily-close/month?month=${month}`, {}, shop.token)
  check('月度视图列出当天', monthView.data.days.some((d) => d.date === today), JSON.stringify(monthView.data.days))
  check('重开后这天算「未确认」,当月不许锁工资', monthView.data.allClosed === false && monthView.data.openDays.includes(today),
    JSON.stringify(monthView.data.openDays))

  // ---- ⑦ 设了目标才出现在日结表 ----
  await request('/admin/perf-targets', {
    method: 'PUT',
    body: JSON.stringify({ month, targets: [{ technicianId: techA.id, mode: 'split', displayMode: 'with_split', perfTargetCents: 1200000, cardTargetCents: 300000, orderTarget: 40 }] })
  }, shop.token)
  const withTarget = await request(`/admin/daily-close?date=${today}`, {}, shop.token)
  const tA = withTarget.data.dailyClose.technicians.find((t) => t.technicianId === techA.id)
  const tB = withTarget.data.dailyClose.technicians.find((t) => t.technicianId === techB.id)
  check('⑦ 设过目标的技师带出目标', tA.target && tA.target.perfTargetCents === 1200000, JSON.stringify(tA.target))
  check('⑦ 没设的仍然是 null', tB.target === null, JSON.stringify(tB.target))

  // ---- ⑨ 租户隔离 ----
  const crossView = await request(`/admin/daily-close?date=${today}`, {}, other.token)
  check('⑨ B 店的日结页里没有 A 店的单', crossView.data.dailyClose.settlements.length === 0,
    JSON.stringify(crossView.data.dailyClose.settlements))
  const crossAlloc = await request(`/admin/settlements/${duo.id}/allocate`, {
    method: 'POST', body: JSON.stringify({ shares: [{ technicianId: techA.id, shareCents: 30000 }] })
  }, other.token)
  check('⑨ B 店改不动 A 店的分成(404)', crossAlloc.status === 404, `${crossAlloc.status} ${JSON.stringify(crossAlloc.data)}`)

  // ---- 员工端「我的业绩」:两道裁剪都在接口层 ----
  const acct = await request('/admin/staff-accounts', { method: 'POST', body: JSON.stringify({ technicianId: techA.id }) }, shop.token)
  const sf = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: acct.data.username, password: acct.data.initialPassword }) }, null)
  const sp = `Sf-${RUN_ID}-a9`
  await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: acct.data.initialPassword, newPassword: sp, confirmPassword: sp }) }, sf.data.auth.accessToken)
  const staffToken = (await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: acct.data.username, password: sp }) }, null)).data.auth.accessToken

  // 目标已设成 mode=split / display=with_split(上面那步),先看含分项形态
  await request('/admin/daily-close', { method: 'POST', body: JSON.stringify({ date: today }) }, shop.token)
  const withSplit = await request(`/admin/my-performance?month=${month}`, {}, staffToken)
  const pv = withSplit.data.performance
  check('员工端只能看自己的业绩(技师 id 就是自己)', pv.technicianId === techA.id, pv.technicianId)
  check('屏5a 含分项:hero 带卡耗与单量目标', pv.hero.cardUsedCents !== undefined && pv.hero.orderTarget === 40,
    JSON.stringify(pv.hero))
  check('屏5a 含分项:每日流水带卡耗', pv.daily.length > 0 && pv.daily[0].cardUsedCents !== undefined, JSON.stringify(pv.daily[0]))
  check('近 6 月趋势给 6 个点且最后一个是当月', pv.trend.length === 6 && pv.trend[5].isCurrent === true, JSON.stringify(pv.trend.map((t) => t.month)))

  // 切成「仅总进度」:整页都不能再出现分项来源(v5 修正:显示设置管整页,不只管 hero)
  await request('/admin/perf-targets', {
    method: 'PUT',
    body: JSON.stringify({ month, targets: [{ technicianId: techA.id, mode: 'split', displayMode: 'total_only', perfTargetCents: 1200000, cardTargetCents: 300000, orderTarget: 40 }] })
  }, shop.token)
  const totalOnly = await request(`/admin/my-performance?month=${month}`, {}, staffToken)
  const tv = totalOnly.data.performance
  check('屏5b 仅总进度:hero 不下发任何分项字段',
    tv.hero.cardUsedCents === undefined && tv.hero.cardTargetCents === undefined && tv.hero.orderTarget === undefined,
    JSON.stringify(tv.hero))
  check('屏5b 仅总进度:每日流水也不带卡耗(显示设置管整页)',
    tv.daily.every((d) => d.cardUsedCents === undefined), JSON.stringify(tv.daily))
  check('屏5b 仍然给总进度与剩余天数', tv.hero.perfCents > 0 && typeof tv.hero.daysLeft === 'number', JSON.stringify(tv.hero))

  // 可见性三态在接口层裁
  check('默认可见性 = 业绩+工资(沿用现状)', (await request('/admin/staff-visibility', {}, shop.token)).data.visibility === 'perf_and_salary')
  await request('/admin/staff-visibility', { method: 'PUT', body: JSON.stringify({ visibility: 'perf_only' }) }, shop.token)
  const salaryBlocked = await request('/admin/salary/my-estimate', {}, staffToken)
  check('纯业绩:员工端工资接口直接闭掉(不只是裁页面)', salaryBlocked.status === 403, `${salaryBlocked.status}`)
  await request('/admin/staff-visibility', { method: 'PUT', body: JSON.stringify({ visibility: 'salary_only' }) }, shop.token)
  const perfBlocked = await request(`/admin/my-performance?month=${month}`, {}, staffToken)
  check('纯工资:业绩明细整块不下发', perfBlocked.data.performance.hero === null && perfBlocked.data.performance.daily.length === 0,
    JSON.stringify(perfBlocked.data.performance).slice(0, 160))
  await request('/admin/staff-visibility', { method: 'PUT', body: JSON.stringify({ visibility: 'perf_and_salary' }) }, shop.token)

  console.log(`\n日结回归通过:${checks} 项断言全绿`)
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`)
  process.exit(1)
})
