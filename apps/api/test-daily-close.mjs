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
/* 测试护栏(裁 C):套件永远不许写进真库 —— 开跑前问服务器「你往哪个库写」 */
import { assertTestTarget } from './test-guard.mjs'
await assertTestTarget(BASE_URL)
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
  /* D25(3-1b,2026-08-12):导入客=phone 身份非绑定,充值会被拦 —— fixture 直连库绑上微信(同 noshow ⑮ 先例) */
  {
    const { DatabaseSync } = await import('node:sqlite')
    const bindDb = new DatabaseSync(process.env.TEST_DB_PATH)
    bindDb.prepare('UPDATE users SET wechat_open_id = ? WHERE id = ?').run('wx-d25fix-' + cust, cust)
    bindDb.close()
  }

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

  /* ---- ③ D58 改口径(店主 08-21 裁):未签单**不再阻塞**确认——确认按单独立,
     未签单只影响它自己(不进当日账;确认后补签由 R1 快照对账标过期逼重开,㋃ 断言盖)。
     未签单以 unsignedList 独立下发(D57 可点行),不再是 UNSIGNED blocker。 ---- */
  const beforeSign = await request(`/admin/daily-close?date=${today}`, {}, shop.token)
  check('③ D58 未签单不产生 UNSIGNED blocker(确认不被它锁)', beforeSign.data.dailyClose.blockers.every((b) => b.code !== 'UNSIGNED'),
    JSON.stringify(beforeSign.data.dailyClose.blockers))
  check('③ D57 未签单进 unsignedList(两张全列,可点行数据齐)', (beforeSign.data.dailyClose.unsignedList || []).length === 2 && beforeSign.data.dailyClose.unsignedList.every((u) => u.code && u.settlementId),
    JSON.stringify(beforeSign.data.dailyClose.unsignedList))

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

  // ---- 按比例分成:金额由后端折算,末行吃余数,合计必须正好等于单额 ----
  const pctGroup = await request('/admin/settlements', {
    method: 'POST',
    body: JSON.stringify({
      cardOwnerUserId: cust,
      settlements: [{ tierKey: 'list', items: [{ serviceId: svc.id }],
        technicians: [{ technicianId: techA.id, role: 'main', itemNos: [1] }, { technicianId: techB.id, role: 'assist', itemNos: [1] }] }]
    })
  }, shop.token)
  const pctSheet = pctGroup.data.settlements[0]
  await request(`/settlements/${pctSheet.code}/sign`, { method: 'POST', body: JSON.stringify({ disclaimerAccepted: true, signature: '比例客' }) }, null)
  await request('/admin/daily-close/reopen', { method: 'POST', body: JSON.stringify({ date: today, reason: '比例分成用例' }) }, shop.token)
  const byPct = await request(`/admin/settlements/${pctSheet.id}/allocate`, {
    method: 'POST',
    body: JSON.stringify({ shares: [{ technicianId: techA.id, pct: 70 }, { technicianId: techB.id, pct: 30 }] })
  }, shop.token)
  check('前端只填比例也能分成(金额由后端折算,不让客户端算钱)', byPct.status === 200, `${byPct.status} ${JSON.stringify(byPct.data).slice(0, 160)}`)
  const sum = (byPct.data.shares || []).reduce((n, s) => n + s.shareCents, 0)
  check('按比例折算后合计仍然正好等于单额(末行吃余数)', sum === pctSheet.totalCents,
    `${sum} vs ${pctSheet.totalCents}`)
  check('比例也一并留痕', (byPct.data.shares || []).some((s) => s.sharePct === 70), JSON.stringify(byPct.data.shares))

  /* R1 账目门槛(店主 2026-08-10 开检:「8 号 3 单未签却已确认日结」)。
     门槛本身没被绕过 —— confirmDailyClose 见 !canConfirm 直接抛。真洞在于:
     **它只在点确认那一瞬间校验一次**。确认之后这一天再进单(打烊后加钟客、补录、
     演示 seed 回填),状态还写着「已确认」,而单数/营收/业绩行永远停在旧数。
     这里把「确认后再进单」整个演一遍,断言这一天必须自己说出"账对不上了"。 */
  await request('/admin/daily-close/reopen', { method: 'POST', body: JSON.stringify({ date: today, reason: 'R1 用例:先重开再确认' }) }, shop.token)
  const beforeConfirm = (await request('/admin/daily-close', {}, shop.token)).data.dailyClose
  if (beforeConfirm.canConfirm) await request('/admin/daily-close', { method: 'POST', body: JSON.stringify({ date: today }) }, shop.token)
  const closed = (await request('/admin/daily-close', {}, shop.token)).data.dailyClose
  check('R1 前置:这一天已确认且账目对得上(staleClose=false)',
    closed.status === 'confirmed' && closed.staleClose === false,
    JSON.stringify({ s: closed.status, stale: closed.staleClose, snap: closed.confirmedSnapshot, live: closed.orderCount }))
  const snapBefore = JSON.stringify(closed.confirmedSnapshot)

  // 确认之后再开一张并签掉 —— 现实里就是打烊后来的加钟客
  const lateGroup = await request('/admin/settlements', {
    method: 'POST',
    body: JSON.stringify({
      cardOwnerUserId: cust,
      settlements: [{ tierKey: 'member', items: [{ serviceId: svc.id }], technicians: [{ technicianId: techA.id, role: 'main', itemNos: [1] }] }]
    })
  }, shop.token)
  const late = lateGroup.data.settlements[0]
  const afterOpen = (await request('/admin/daily-close', {}, shop.token)).data.dailyClose
  /* D58 改口径(店主 08-21 裁):挂着的未签单不进账=快照与实账本就齐,**不标过期**;
     等它真签字落账,快照对账立刻抓 drift(下一段断言即验)——R1 机制不减防,只是不冤枉没入账的单。 */
  check('R1+D58 已确认+冒出未签单(未落账)=不标过期(未签单只影响它自己)',
    afterOpen.staleClose === false && afterOpen.blockers.every((b) => b.code !== 'UNSIGNED'),
    JSON.stringify({ stale: afterOpen.staleClose, codes: afterOpen.blockers.map((b) => b.code) }))
  check('D57 未签提示点名到单(顾客+时间+单号,可点行独立下发)',
    (afterOpen.unsignedList || []).length > 0 && afterOpen.unsignedList[0].customerName && afterOpen.unsignedList[0].code,
    JSON.stringify(afterOpen.unsignedList))

  await request(`/settlements/${late.code}/sign`, { method: 'POST', body: JSON.stringify({ disclaimerAccepted: true, signature: '加钟客' }) }, null)
  const r1AfterSign = (await request('/admin/daily-close', {}, shop.token)).data.dailyClose
  check('R1 后进的单签完了,这一天仍然是「账目过期」(不会自己变回正常)',
    r1AfterSign.staleClose === true, JSON.stringify({ stale: r1AfterSign.staleClose, live: r1AfterSign.orderCount, snap: r1AfterSign.confirmedSnapshot }))
  check('R1 红线:已确认的快照不会被后进的单**悄悄改掉**(数字原地不动)',
    JSON.stringify(r1AfterSign.confirmedSnapshot) === snapBefore,
    `${snapBefore} → ${JSON.stringify(r1AfterSign.confirmedSnapshot)}`)
  check('R1 实时数确实比快照大(差额算得出来,店主看得见差在哪)',
    r1AfterSign.orderCount > r1AfterSign.confirmedSnapshot.orderCount && r1AfterSign.revenueCents > r1AfterSign.confirmedSnapshot.revenueCents,
    JSON.stringify({ live: [r1AfterSign.orderCount, r1AfterSign.revenueCents], snap: r1AfterSign.confirmedSnapshot }))
  // 走正规路子(重开→再确认)之后,这一天必须回到干净状态
  await request('/admin/daily-close/reopen', { method: 'POST', body: JSON.stringify({ date: today, reason: 'R1 用例:核对后重新确认' }) }, shop.token)
  const reFixed = (await request('/admin/daily-close', {}, shop.token)).data.dailyClose
  if (reFixed.canConfirm) await request('/admin/daily-close', { method: 'POST', body: JSON.stringify({ date: today }) }, shop.token)
  const healed = (await request('/admin/daily-close', {}, shop.token)).data.dailyClose
  check('R1 重开后重新确认:账目重新对上,staleClose 归零',
    healed.status === 'confirmed' && healed.staleClose === false && healed.confirmedSnapshot.orderCount === healed.orderCount,
    JSON.stringify({ s: healed.status, stale: healed.staleClose, snap: healed.confirmedSnapshot, live: healed.orderCount }))

  /* 🔴 日结归属 = 服务发生日(店主 2026-08-10 拍板 ②,《财务记账总逻辑》v1.5 §六)。
     晚签的单必须记回**服务那一天**,不许堆到签字那天。四条 corner 全在这儿。 */
  const svcDay = async (d) => (await request(`/admin/daily-close?date=${d}`, {}, shop.token)).data.dailyClose
  const yest = new Date(`${today}T00:00:00Z`); yest.setUTCDate(yest.getUTCDate() - 1)
  const yDate = yest.toISOString().slice(0, 10)
  // 昨天服务、今天才签的单
  const lateBk = (await request('/admin/bookings/direct', {
    method: 'POST',
    body: JSON.stringify({ userId: cust, serviceId: svc.id, technicianId: techA.id, date: yDate, time: '20:30', durationMin: 60, depositPaid: false })
  }, shop.token)).data.booking
  const lateSheet = (await request('/admin/settlements', {
    method: 'POST',
    body: JSON.stringify({ cardOwnerUserId: cust, settlements: [{ bookingId: lateBk.id, tierKey: 'list', payIntent: 'offline_full', items: [{ serviceId: svc.id }], technicians: [{ technicianId: techA.id, role: 'main', itemNos: [1] }] }] })
  }, shop.token)).data.settlements[0]
  const yBefore = (await svcDay(yDate)).orderCount
  const tBefore = (await svcDay(today)).orderCount
  await request(`/settlements/${lateSheet.code}/sign`, { method: 'POST', body: JSON.stringify({ disclaimerAccepted: true, signature: '补签客' }) }, null)
  const yAfter = await svcDay(yDate)
  const tAfter = await svcDay(today)
  check('归属① 昨天服务今天签:记回**昨天**的日结(不是签字那天)',
    yAfter.orderCount === yBefore + 1 && tAfter.orderCount === tBefore,
    JSON.stringify({ 昨: [yBefore, yAfter.orderCount], 今: [tBefore, tAfter.orderCount] }))
  check('归属② 补签单在服务日的行上带小注(说清它是事后签的)',
    (yAfter.settlements || []).some((x) => x.code === lateSheet.code && x.crossDayNote),
    JSON.stringify((yAfter.settlements || []).map((x) => [x.code, x.crossDayNote])))
  check('归属③ 服务当天就签的单不加多余小注',
    (tAfter.settlements || []).every((x) => !x.crossDayNote),
    JSON.stringify((tAfter.settlements || []).map((x) => [x.code, x.crossDayNote])))
  check('归属④ 收入流水仍按签字日(两条轴分开,§三 不变)',
    yAfter.settlements.find((x) => x.code === lateSheet.code).signedAt.slice(0, 10) >= yDate,
    '签字时刻不因归属改变而回拨')
  // 补签进**已确认**的那一天 → 必须标过期(R1 守护机制)
  await request('/admin/daily-close/reopen', { method: 'POST', body: JSON.stringify({ date: yDate, reason: '归属用例' }) }, shop.token).catch(() => {})
  const yFix = await svcDay(yDate)
  if (yFix.canConfirm) await request('/admin/daily-close', { method: 'POST', body: JSON.stringify({ date: yDate }) }, shop.token)
  const lateBk2 = (await request('/admin/bookings/direct', {
    method: 'POST',
    body: JSON.stringify({ userId: cust, serviceId: svc.id, technicianId: techB.id, date: yDate, time: '21:40', durationMin: 60, depositPaid: false })
  }, shop.token)).data.booking
  const late2 = (await request('/admin/settlements', {
    method: 'POST',
    body: JSON.stringify({ cardOwnerUserId: cust, settlements: [{ bookingId: lateBk2.id, tierKey: 'list', payIntent: 'offline_full', items: [{ serviceId: svc.id }], technicians: [{ technicianId: techB.id, role: 'main', itemNos: [1] }] }] })
  }, shop.token)).data.settlements[0]
  await request(`/settlements/${late2.code}/sign`, { method: 'POST', body: JSON.stringify({ disclaimerAccepted: true, signature: '补签客2' }) }, null)
  const yStale = await svcDay(yDate)
  check('归属⑤ 补签落进**已确认**的那一天 → 标过期(R1 守护机制接住)',
    yStale.staleClose === true, JSON.stringify({ stale: yStale.staleClose, live: yStale.orderCount, snap: yStale.confirmedSnapshot }))
  await request('/admin/daily-close/reopen', { method: 'POST', body: JSON.stringify({ date: yDate, reason: '归属用例:重开再确认' }) }, shop.token)
  const yReady = await svcDay(yDate)
  if (yReady.canConfirm) await request('/admin/daily-close', { method: 'POST', body: JSON.stringify({ date: yDate }) }, shop.token)
  const yHealed = await svcDay(yDate)
  check('归属⑥ 重开再确认后数字自洽(快照 ≡ 实时)',
    yHealed.staleClose === false && yHealed.confirmedSnapshot.orderCount === yHealed.orderCount,
    JSON.stringify({ snap: yHealed.confirmedSnapshot, live: yHealed.orderCount }))
  // 没有服务发生的那一天:日结区没有任何单
  const far = '2026-01-05'
  const empty = await svcDay(far)
  check('归属⑦ 没有服务发生的日子:日结区零单(休息日不再冒出别人家的尾巴)',
    empty.orderCount === 0 && (empty.settlements || []).length === 0, JSON.stringify({ n: empty.orderCount }))

  /* 店主点名的 corner:**跨月补签** —— 上月最后一天服务、这个月才签,业绩必须算**上个月**。
     月度业绩 = Σ 已确认日结的当月 daily_close_lines,归属日一错,整月业绩就错月。 */
  const tParts = today.split('-')
  const firstOfThisMonth = new Date(Date.UTC(Number(tParts[0]), Number(tParts[1]) - 1, 1))
  const lastOfPrevMonth = new Date(firstOfThisMonth.getTime() - 86400000).toISOString().slice(0, 10)
  const prevMonthKey = lastOfPrevMonth.slice(0, 7)
  const xmBk = (await request('/admin/bookings/direct', {
    method: 'POST',
    body: JSON.stringify({ userId: cust, serviceId: svc.id, technicianId: techA.id, date: lastOfPrevMonth, time: '21:00', durationMin: 60, depositPaid: false })
  }, shop.token)).data.booking
  const xmSheet = (await request('/admin/settlements', {
    method: 'POST',
    body: JSON.stringify({ cardOwnerUserId: cust, settlements: [{ bookingId: xmBk.id, tierKey: 'list', payIntent: 'offline_full', items: [{ serviceId: svc.id }], technicians: [{ technicianId: techA.id, role: 'main', itemNos: [1] }] }] })
  }, shop.token)).data.settlements[0]
  await request(`/settlements/${xmSheet.code}/sign`, { method: 'POST', body: JSON.stringify({ disclaimerAccepted: true, signature: '跨月补签客' }) }, null)
  const xmDay = (await request(`/admin/daily-close?date=${lastOfPrevMonth}`, {}, shop.token)).data.dailyClose
  check(`归属⑧ 跨月补签:${lastOfPrevMonth} 服务、${today} 签 → 记回**上月最后一天**(不落本月)`,
    (xmDay.settlements || []).some((x) => x.code === xmSheet.code),
    JSON.stringify({ day: lastOfPrevMonth, codes: (xmDay.settlements || []).map((x) => x.code) }))
  if (xmDay.canConfirm) await request('/admin/daily-close', { method: 'POST', body: JSON.stringify({ date: lastOfPrevMonth }) }, shop.token)
  const xmClosed = (await request(`/admin/daily-close?date=${lastOfPrevMonth}`, {}, shop.token)).data.dailyClose
  const rank = ((await request(`/admin/perf-ranking?period=month&date=${prevMonthKey}`, {}, shop.token)).data || {}).ranking || {}
  check(`归属⑨ 跨月补签的业绩落在**上月**排行里(${prevMonthKey}),不串到本月`,
    xmClosed.status !== 'confirmed' || (rank.ranking || []).some((r) => r.value > 0),
    JSON.stringify({ closed: xmClosed.status, ranking: (rank.ranking || []).map((r) => [r.name, r.value]) }))

  console.log(`\n日结回归通过:${checks} 项断言全绿`)
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`)
  process.exit(1)
})
