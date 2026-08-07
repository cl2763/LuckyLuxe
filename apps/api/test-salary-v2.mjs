// P2 薪资方案 v2 回归(2026-08-08):
// ① 阶段(whole)vs 阶梯(progressive):同一业绩额算法不同,差额可断言
//    设计图算例:档位 0–8000×10% / 8000–15000×12% / 15000+×15%,业绩 ¥12,000
//    → 阶段 ¥1,440;阶梯 8,000×10% + 4,000×12% = ¥1,280;差 ¥160
// ② 存量方案映射:老的 base_ladder 一律 ladder_mode='whole',金额逐分不变
// ③ 保存时不传 ladderMode 不会把存量方案悄悄改成累进
// ④ 首充/续卡分开提成;耗卡不提成
// ⑤ 自定义卡提成行(名称 + 比例)
// ⑥ 开关族:关掉底薪/手工费/加班费/卡提成即不计入
// ⑦ 业绩口径 = 已确认日结累加;没日结的天不计
// ⑧ 锁月前置:当月还有天没日结就不许锁
// ⑨ 调整项多行(奖励/扣款各一条,每条必须写备注)
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
  const id = `p2sal-${label}-${RUN_ID}`
  const created = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id, name: `薪资店${label}${RUN_ID}`, plan: 'chain' }) })
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

const LADDER = [
  { minCents: 0, maxCents: 800000, pct: 10 },
  { minCents: 800000, maxCents: 1500000, pct: 12 },
  { minCents: 1500000, maxCents: null, pct: 15 }
]

async function main() {
  const shop = await newShop('a')
  check('临时店建好', Boolean(shop.token))

  // ---- ① 三模式对比试算(不落库)----
  const pv = await request('/admin/salary-plans/preview', {
    method: 'POST', body: JSON.stringify({ perfCents: 1200000, ladder: LADDER, flatPct: 8 })
  }, shop.token)
  check('① 阶段:业绩 ¥12,000 落第二档 → 全额 ×12% = ¥1,440', pv.data.whole.cents === 144000, String(pv.data.whole.cents))
  check('① 阶梯:8,000×10% + 4,000×12% = ¥1,280', pv.data.progressive.cents === 128000, String(pv.data.progressive.cents))
  check('① 两模式差额 ¥160', pv.data.diffCents === 16000, String(pv.data.diffCents))
  check('① 自定义固定提点 ¥12,000×8% = ¥960', pv.data.flat.cents === 96000, String(pv.data.flat.cents))
  const pvEdge = await request('/admin/salary-plans/preview', {
    method: 'POST', body: JSON.stringify({ perfCents: 800000, ladder: LADDER })
  }, shop.token)
  check('① 正好卡在档位边界:阶段落第二档 ¥960、阶梯全在第一档 ¥800',
    pvEdge.data.whole.cents === 96000 && pvEdge.data.progressive.cents === 80000,
    JSON.stringify({ w: pvEdge.data.whole.cents, p: pvEdge.data.progressive.cents }))

  // ---- ② 存量方案:老写法保存(不传 ladderMode)→ whole ----
  const legacy = await request('/admin/salary-plans', {
    method: 'PUT',
    body: JSON.stringify({ technicianId: '', template: 'base_ladder', baseSalaryCents: 300000, ladder: LADDER })
  }, shop.token)
  check('② 老写法存下来的方案 ladderMode = whole(语义等价存量)', legacy.data.plan.ladderMode === 'whole', legacy.data.plan.ladderMode)

  const tech = (await request(`/platform/tenants/${shop.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: `技师${RUN_ID}` }) })).data.technician

  // ---- ③ 再保存一次不传 ladderMode:不能被悄悄改成累进 ----
  await request('/admin/salary-plans', {
    method: 'PUT', body: JSON.stringify({ technicianId: '', template: 'base_ladder', baseSalaryCents: 300000, ladder: LADDER })
  }, shop.token)
  const stillWhole = await request('/admin/salary-plans/effective?technicianId=', {}, shop.token)
  check('③ 不传 ladderMode 时保持原算法,不被悄悄改', stillWhole.data.plan.ladderMode === 'whole', stillWhole.data.plan.ladderMode)

  // ---- ⑦ 业绩口径:没日结时为 0 ----
  const month = (await request('/admin/store-clock', {}, shop.token)).data.monthKey
  const before = await request(`/admin/salary/estimate?month=${month}`, {}, shop.token)
  const row0 = before.data.rows.find((r) => r.technicianId === tech.id)
  check('⑦ 业绩口径标明来自已确认日结', row0.perfSource === 'daily_close', String(row0.perfSource))
  check('⑦ 一天都没日结时业绩为 0', row0.perfCents === 0, String(row0.perfCents))
  check('⑦ 试算页带出日结模块', Array.isArray(before.data.dailyCloses.days), JSON.stringify(before.data.dailyCloses).slice(0, 120))
  check('归属备注区已退役(接口不再下发)', before.data.attributionNotes === undefined)

  // 造一天有业绩的日结:开单 → 签 → 日结确认
  const cat = (await request('/admin/pricing/categories', { method: 'POST', body: JSON.stringify({ key: 'nail', name: '美甲' }) }, shop.token)).data.category
  const svc = (await request('/admin/pricing/items', {
    method: 'POST',
    body: JSON.stringify({ nameZh: `款式${RUN_ID}`, type: 'NAIL', categoryId: cat.id, itemKind: 'main', listPriceCents: 1200000, memberPriceCents: 1200000, baseDurationMin: 60 })
  }, shop.token)).data.item
  const imp = await request(`/platform/tenants/${shop.tenantId}/import/customers`, {
    method: 'POST', body: JSON.stringify({ dryRun: false, rows: [{ name: `顾客${RUN_ID}`, phone: `1383${RUN_ID.slice(-7)}` }] })
  })
  const cust = imp.data.users[0].userId
  const g = await request('/admin/settlements', {
    method: 'POST',
    body: JSON.stringify({
      cardOwnerUserId: cust,
      settlements: [{ tierKey: 'list', items: [{ serviceId: svc.id }], technicians: [{ technicianId: tech.id, role: 'main', itemNos: [1] }] }]
    })
  }, shop.token)
  const sheet = g.data.settlements[0]
  const signRes = await request(`/settlements/${sheet.code}/sign`, { method: 'POST', body: JSON.stringify({ disclaimerAccepted: true, signature: '顾客' }) }, null)
  if (signRes.status !== 200) throw new Error(`签署失败: ${JSON.stringify(signRes.data)}`)
  const today = (await request('/admin/store-clock', {}, shop.token)).data.today

  // ---- ⑧ 没日结不许锁月 ----
  const lockEarly = await request('/admin/salary/lock', { method: 'POST', body: JSON.stringify({ month }) }, shop.token)
  check('⑧ 当月还有天没日结时不许锁工资', lockEarly.status === 400 && lockEarly.data.error.code === 'DAYS_NOT_CLOSED',
    JSON.stringify(lockEarly.data))

  await request('/admin/daily-close', { method: 'POST', body: JSON.stringify({ date: today }) }, shop.token)

  // ---- ④⑤⑥ 卡提成 ----
  await request('/admin/stored-value/recharge', {
    method: 'POST', body: JSON.stringify({ userId: cust, amountCents: 200000, technicianId: tech.id, note: '首充' })
  }, shop.token)
  await request('/admin/stored-value/recharge', {
    method: 'POST', body: JSON.stringify({ userId: cust, amountCents: 150000, technicianId: tech.id, note: '续充' })
  }, shop.token)
  await request('/admin/salary-plans', {
    method: 'PUT',
    body: JSON.stringify({
      technicianId: tech.id, template: 'base_ladder', ladderMode: 'progressive',
      baseSalaryCents: 300000, handworkFeeCents: 1000, ladder: LADDER,
      firstRechargePct: 3, renewRechargePct: 2,
      customCommissions: [{ name: '疗程卡销售', pct: 5 }]
    })
  }, shop.token)
  const est = await request(`/admin/salary/estimate?month=${month}`, {}, shop.token)
  const row = est.data.rows.find((r) => r.technicianId === tech.id)
  check('⑦ 日结确认后业绩计入 ¥12,000', row.perfCents === 1200000, String(row.perfCents))
  check('① 按阶梯算提成 ¥1,280', row.commissionCents === 128000, String(row.commissionCents))
  check('④ 首充 ¥2,000 × 3% = ¥60', row.firstRechargePayCents === 6000, JSON.stringify({ c: row.firstRechargeCents, p: row.firstRechargePayCents }))
  check('④ 续卡 ¥1,500 × 2% = ¥30', row.renewRechargePayCents === 3000, JSON.stringify({ c: row.renewRechargeCents, p: row.renewRechargePayCents }))
  check('④ 耗卡不提成(只展示卡耗金额,没有耗卡提成字段)', row.cardCents === undefined, JSON.stringify(Object.keys(row)))
  check('⑤ 自定义行按全部充值额 ¥3,500 × 5% = ¥175', row.customCommissionPayCents === 17500, JSON.stringify(row.customCommissionRows))
  check('工资合计 = 底薪 + 手工费 + 提成 + 首充 + 续卡 + 自定义 + 加班 + 调整',
    row.totalCents === row.baseSalaryCents + row.handworkCents + row.commissionCents
      + row.firstRechargePayCents + row.renewRechargePayCents + row.customCommissionPayCents
      + row.overtimePayCents + row.adjustCents,
    JSON.stringify(row))

  // ---- ⑥ 开关族 ----
  await request('/admin/salary-plans', {
    method: 'PUT',
    body: JSON.stringify({
      technicianId: tech.id, template: 'base_ladder', ladderMode: 'progressive',
      baseSalaryCents: 300000, handworkFeeCents: 1000, ladder: LADDER,
      firstRechargePct: 3, renewRechargePct: 2, customCommissions: [{ name: '疗程卡销售', pct: 5 }],
      enableBase: false, enableHandwork: false, enableCardCommission: false
    })
  }, shop.token)
  const off = await request(`/admin/salary/estimate?month=${month}`, {}, shop.token)
  const rowOff = off.data.rows.find((r) => r.technicianId === tech.id)
  check('⑥ 关掉底薪即不计入', rowOff.baseSalaryCents === 0, String(rowOff.baseSalaryCents))
  check('⑥ 关掉手工费即不计入', rowOff.handworkCents === 0, String(rowOff.handworkCents))
  check('⑥ 关掉卡提成后首充/续卡/自定义都不计',
    rowOff.firstRechargePayCents === 0 && rowOff.renewRechargePayCents === 0 && rowOff.customCommissionPayCents === 0,
    JSON.stringify({ f: rowOff.firstRechargePayCents, r: rowOff.renewRechargePayCents, c: rowOff.customCommissionPayCents }))
  check('⑥ 业绩提成不受这些开关影响', rowOff.commissionCents === 128000, String(rowOff.commissionCents))

  // ---- ⑨ 调整项多行 ----
  const noNote = await request('/admin/salary/adjust', {
    method: 'PUT', body: JSON.stringify({ month, technicianId: tech.id, items: [{ kind: 'bonus', amountCents: 50000, note: '' }] })
  }, shop.token)
  check('⑨ 每条调整都必须写备注', noNote.status === 400, JSON.stringify(noNote.data))
  const multi = await request('/admin/salary/adjust', {
    method: 'PUT',
    body: JSON.stringify({
      month, technicianId: tech.id,
      items: [{ kind: 'bonus', amountCents: 50000, note: '绩效完成奖励' }, { kind: 'deduct', amountCents: -8000, note: '迟到扣款' }]
    })
  }, shop.token)
  check('⑨ 一个月可以记多条调整', multi.status === 200 && multi.data.items.length === 2, JSON.stringify(multi.data))
  const withAdj = await request(`/admin/salary/estimate?month=${month}`, {}, shop.token)
  const rowAdj = withAdj.data.rows.find((r) => r.technicianId === tech.id)
  check('⑨ 多条调整逐条下发并合计 = +¥420', rowAdj.adjustItems.length === 2 && rowAdj.adjustCents === 42000,
    JSON.stringify({ n: rowAdj.adjustItems.length, c: rowAdj.adjustCents }))

  // ---- ⑧ 全部日结完成后可以锁 ----
  const lockOk = await request('/admin/salary/lock', { method: 'POST', body: JSON.stringify({ month }) }, shop.token)
  check('⑧ 当月日结全做完就能锁工资', lockOk.status < 300 && lockOk.data.locked === true, `${lockOk.status} ${JSON.stringify(lockOk.data).slice(0, 200)}`)

  console.log(`\n薪资方案 v2 回归通过:${checks} 项断言全绿`)
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`)
  process.exit(1)
})
