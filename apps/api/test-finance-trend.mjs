// P2.4 财务趋势回归(2026-08-08):
// ① 与单月 summary 同一计算函数 —— 趋势图上某个月的收入/支出/净利必须与
//    /admin/finance/progress 同月逐分一致(这是本套件存在的唯一理由)
// ② 四种粒度(日/周/月/年)都给出正确的区间与点数
// ③ 单量按「顾客签了字的服务单」算,与日结/员工业绩同一口径;客单 = 该周期单额均值
// ④ 目标只有按月才给(财务目标本身是月目标),其它粒度给 null,不编假目标
// ⑤ 环比:上一周期为 0 时百分比给 null,不硬写 0% 或 100%
// ⑥ 租户隔离:B 店的趋势里没有 A 店的钱
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
  const id = `p2ft-${label}-${RUN_ID}`
  const created = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id, name: `趋势店${label}${RUN_ID}`, plan: 'chain' }) })
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

  const today = (await request('/admin/store-clock', {}, shop.token)).data.today
  const month = today.slice(0, 7)

  // 记两笔账:收入 ¥800、支出 ¥300
  const income = await request('/admin/finance/transactions', {
    method: 'POST',
    body: JSON.stringify({ type: 'income', amountCents: 80000, category: '服务收入', occurredOn: today, note: `趋势测试${RUN_ID}` })
  }, shop.token)
  if (income.status >= 300) throw new Error(`记收入失败 ${income.status}: ${JSON.stringify(income.data)}`)
  await request('/admin/finance/transactions', {
    method: 'POST',
    body: JSON.stringify({ type: 'expense', amountCents: 30000, category: '材料', occurredOn: today, note: `趋势测试${RUN_ID}` })
  }, shop.token)

  // ---- ① 与单月 summary 同一口径 ----
  const progress = await request(`/admin/finance/progress?month=${month}`, {}, shop.token)
  const trend = await request('/admin/finance/trend?granularity=month&periods=6', {}, shop.token)
  const cur = trend.data.trend.points[trend.data.trend.points.length - 1]
  check('① 趋势最后一个点就是当月', cur.key === month, `${cur.key} vs ${month}`)
  check('① 收入与单月汇总逐分一致', cur.revenueCents === progress.data.progress.revenueCents,
    `${cur.revenueCents} vs ${progress.data.progress.revenueCents}`)
  check('① 支出与单月汇总逐分一致', cur.expenseCents === progress.data.progress.expenseCents,
    `${cur.expenseCents} vs ${progress.data.progress.expenseCents}`)
  check('① 净利与单月汇总逐分一致', cur.netCents === progress.data.progress.netCents,
    `${cur.netCents} vs ${progress.data.progress.netCents}`)
  check('① 数字确实是记进去的那两笔', cur.revenueCents === 80000 && cur.expenseCents === 30000 && cur.netCents === 50000,
    JSON.stringify({ r: cur.revenueCents, e: cur.expenseCents, n: cur.netCents }))

  // ---- ② 四种粒度 ----
  for (const [g, n] of [['day', 7], ['week', 4], ['month', 6], ['year', 2]]) {
    const r = await request(`/admin/finance/trend?granularity=${g}&periods=${n}`, {}, shop.token)
    check(`② ${g} 粒度给 ${n} 个点且区间连续`,
      r.data.trend.granularity === g && r.data.trend.points.length === n
      && r.data.trend.points.every((p) => p.from <= p.to),
      JSON.stringify(r.data.trend.points.map((p) => p.key)))
  }
  const dayTrend = await request('/admin/finance/trend?granularity=day&periods=7', {}, shop.token)
  const todayPoint = dayTrend.data.trend.points[6]
  check('② 日粒度最后一个点是今天,且金额对得上', todayPoint.key === today && todayPoint.revenueCents === 80000,
    JSON.stringify(todayPoint))

  // ---- ③ 单量与客单 ----
  const cat = (await request('/admin/pricing/categories', { method: 'POST', body: JSON.stringify({ key: 'nail', name: '美甲' }) }, shop.token)).data.category
  const svc = (await request('/admin/pricing/items', {
    method: 'POST', body: JSON.stringify({ nameZh: `款式${RUN_ID}`, type: 'NAIL', categoryId: cat.id, itemKind: 'main', listPriceCents: 40000, baseDurationMin: 60 })
  }, shop.token)).data.item
  const tech = (await request(`/platform/tenants/${shop.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: `技师${RUN_ID}` }) })).data.technician
  const imp = await request(`/platform/tenants/${shop.tenantId}/import/customers`, {
    method: 'POST', body: JSON.stringify({ dryRun: false, rows: [{ name: `顾客${RUN_ID}`, phone: `1385${RUN_ID.slice(-7)}` }] })
  })
  const cust = imp.data.users[0].userId
  for (let i = 0; i < 2; i += 1) {
    const g = await request('/admin/settlements', {
      method: 'POST',
      body: JSON.stringify({
        cardOwnerUserId: cust,
        settlements: [{ tierKey: 'list', items: [{ serviceId: svc.id }], technicians: [{ technicianId: tech.id, role: 'main', itemNos: [1] }] }]
      })
    }, shop.token)
    await request(`/settlements/${g.data.settlements[0].code}/sign`, { method: 'POST', body: JSON.stringify({ disclaimerAccepted: true, signature: '顾客' }) }, null)
  }
  const withOrders = await request('/admin/finance/trend?granularity=month&periods=3', {}, shop.token)
  const p = withOrders.data.trend.points[2]
  check('③ 单量 = 当期已签服务单数', p.orderCount === 2, String(p.orderCount))
  check('③ 客单 = 单额均值 ¥400', p.avgTicketCents === 40000, String(p.avgTicketCents))

  // ---- ④ 目标只有按月才给 ----
  await request('/admin/finance/targets', {
    method: 'PUT', body: JSON.stringify({ targetMode: 'revenue', monthTargetCents: 60000 })
  }, shop.token)
  const withTarget = await request('/admin/finance/trend?granularity=month&periods=3', {}, shop.token)
  const mp = withTarget.data.trend.points[2]
  check('④ 按月给出目标与达标判定', mp.targetCents === 60000 && mp.hitTarget === true, JSON.stringify({ t: mp.targetCents, h: mp.hitTarget }))
  const weekTrend = await request('/admin/finance/trend?granularity=week&periods=3', {}, shop.token)
  check('④ 非月粒度不编假目标(target 为 null)',
    weekTrend.data.trend.points.every((x) => x.targetCents === null && x.hitTarget === null),
    JSON.stringify(weekTrend.data.trend.points.map((x) => x.targetCents)))

  // ---- ⑤ 环比 ----
  const cmp = withTarget.data.trend.compare
  /* D70 合同②(08-24):签署即入账后,本期收入 = 手工那笔 + 夹具签的两单,不再是写死的 80000。
     判据改成表达**规则本身**:上一周期为 0 时 pct 给 null、delta 等于本期收入 —— 口径再变也不用改这行。 */
  check('⑤ 上一周期为 0 时环比百分比给 null,不硬写数字', cmp.revenueDeltaPct === null && cmp.revenueDeltaCents === (withTarget.data.trend.points[withTarget.data.trend.points.length - 1] || {}).revenueCents,
    JSON.stringify(cmp))

  // ---- ⑥ 租户隔离 ----
  const crossTrend = await request('/admin/finance/trend?granularity=month&periods=3', {}, other.token)
  check('⑥ B 店趋势里没有 A 店的钱',
    crossTrend.data.trend.points.every((x) => x.revenueCents === 0 && x.orderCount === 0),
    JSON.stringify(crossTrend.data.trend.points))

  console.log(`\n财务趋势回归通过:${checks} 项断言全绿`)
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`)
  process.exit(1)
})
