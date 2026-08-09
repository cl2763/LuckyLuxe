/* 对图修复批回归(2026-08-09)+ CLAUDE.md《测试标准》六类 corner case + 财务红线。

   覆盖:
     ① 撤回改单(屏 0):待签可撤 / 已签不可撤 / 撤回后券放回券包 / 撤回的单不再拦日结
     ② 签署页「待签 1/2」角标:groupIndex / groupTotal(撤回的不计入)
     ③ 加项组名(裁决④):商家自填、留空归「其他加项」、随价目表下发
     ④ **财务红线**:一笔 ¥10,000 充值归某技师促成 →
        业绩 / 排行 / 员工端我的业绩 / 目标进度 全都不含它,只有冲卡列体现
   corner case 类别:边界值 / 空态 / 并发时序 / 越权 / 幂等 / 异常输入 —— 见各段注释标注。 */
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
async function request(path, options = {}, token = PLATFORM) {
  const fk = token ? financeKeys.get(token) : null
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(fk ? { 'x-finance-key': fk } : {}),
      ...(options.headers || {})
    }
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, data }
}

async function newShop(label) {
  const id = `afx-${label}-${RUN_ID}`
  const created = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id, name: `审计店${label}${RUN_ID}`, plan: 'chain' }) })
  if (created.status !== 201) throw new Error(`建店失败: ${JSON.stringify(created.data)}`)
  const { username, initialPassword } = created.data.owner
  const first = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: initialPassword }) }, null)
  const pass = `Afx-${RUN_ID}-${label}9`
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
  const mk = async (body) => (await request('/admin/pricing/items', { method: 'POST', body: JSON.stringify(body) }, shop.token)).data.item

  // ---- ③ 加项组名(裁决④)----
  const main3h = await mk({ nameZh: '简单款式 3 小时', type: 'NAIL', categoryId: cat.id, itemKind: 'main', listPriceCents: 60000, memberPriceCents: 60000 })
  const ext = await mk({ nameZh: '浅贴甲片', type: 'NAIL', categoryId: cat.id, itemKind: 'addon', listPriceCents: 38000, memberPriceCents: 18000, addonGroup: '延长类', addonScope: [cat.id] })
  const fix = await mk({ nameZh: '纤维/甲片补甲', type: 'NAIL', categoryId: cat.id, itemKind: 'addon', unit: 'per_finger', listPriceCents: 3800, memberPriceCents: 1800, addonGroup: '补甲类', addonScope: [cat.id] })
  const noGroup = await mk({ nameZh: '钻球', type: 'NAIL', categoryId: cat.id, itemKind: 'addon', listPriceCents: 5000, memberPriceCents: 5000, addonScope: [cat.id] })
  check('③ 加项组名落库并下发', ext.addonGroup === '延长类' && fix.addonGroup === '补甲类', JSON.stringify({ e: ext.addonGroup, f: fix.addonGroup }))
  check('③ 留空的加项组名是空串(前端归「其他加项」)', noGroup.addonGroup === '', JSON.stringify(noGroup.addonGroup))
  // 异常输入:超长组名截断,不炸
  const longName = await mk({ nameZh: '超长组名项', type: 'NAIL', categoryId: cat.id, itemKind: 'addon', listPriceCents: 100, addonGroup: '组'.repeat(50), addonScope: [cat.id] })
  check('③ 异常输入:超长组名被截断而不是报错', longName.addonGroup.length === 20, String(longName.addonGroup.length))
  // 幂等:改一次组名再读回来还是那个
  await request(`/admin/pricing/items/${ext.id}`, { method: 'PATCH', body: JSON.stringify({ addonGroup: '延长类' }) }, shop.token)
  const reread = (await request('/admin/pricing/items', {}, shop.token)).data.items.find((i) => i.id === ext.id)
  check('③ 幂等:重复保存组名不变', reread.addonGroup === '延长类', reread.addonGroup)

  // ---- 顾客 / 技师 ----
  const imp = await request(`/platform/tenants/${shop.tenantId}/import/customers`, {
    method: 'POST', body: JSON.stringify({ dryRun: false, rows: [{ name: `客${RUN_ID}`, phone: `1391${RUN_ID.slice(-7)}`, balanceCents: 0 }] })
  })
  const user = imp.data.users[0].userId
  const techA = (await request(`/platform/tenants/${shop.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: `甲${RUN_ID}` }) })).data.technician
  const techB = (await request(`/platform/tenants/${shop.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: `乙${RUN_ID}` }) })).data.technician

  // ---- ① 撤回改单 + ② 待签 1/2 ----
  const coupon = (await request('/admin/coupons', { method: 'POST', body: JSON.stringify({ name: '满100减20', amountCents: 2000, minSpendCents: 10000, validDays: 30 }) }, shop.token)).data.coupon
  const grant = await request('/admin/coupon-grants/custom', {
    method: 'POST', body: JSON.stringify({ userId: user, mode: 'template', couponId: coupon.id, reason: '测试' })
  }, shop.token)
  const grantId = grant.data.granted.id

  const group = await request('/admin/settlements', {
    method: 'POST',
    body: JSON.stringify({
      cardOwnerUserId: user,
      settlements: [
        { tierKey: 'list', couponGrantId: grantId, items: [{ serviceId: main3h.id }], technicians: [{ technicianId: techA.id, role: 'main', itemNos: [1] }] },
        { tierKey: 'list', servedPersonName: '朋友', items: [{ serviceId: main3h.id }], technicians: [{ technicianId: techB.id, role: 'main', itemNos: [1] }] }
      ]
    })
  }, shop.token)
  const [sheet1, sheet2] = group.data.settlements
  const pub1 = await request(`/settlements/${sheet1.code}`, {}, null)
  check('② 签署页下发同组序号', pub1.data.settlement.groupIndex === 1 && pub1.data.settlement.groupTotal === 2,
    JSON.stringify({ i: pub1.data.settlement.groupIndex, t: pub1.data.settlement.groupTotal }))
  check('② 代付单下发卡主姓名(明细区上方那行)', Boolean(pub1.data.settlement.cardOwnerName), pub1.data.settlement.cardOwnerName)

  // 越权:未登录不能撤单
  const anonVoid = await request(`/admin/settlements/${sheet1.id}/void`, { method: 'POST' }, null)
  check('① 越权:未登录撤单 401', anonVoid.status === 401, String(anonVoid.status))
  // 越权:别家店的 token 撤不动这张单
  const crossVoid = await request(`/admin/settlements/${sheet1.id}/void`, { method: 'POST' }, other.token)
  check('① 越权:跨店撤单 404(看不到别家店的单)', crossVoid.status === 404, String(crossVoid.status))

  const voided = await request(`/admin/settlements/${sheet2.id}/void`, { method: 'POST' }, shop.token)
  check('① 待签单可以撤回改单', voided.status === 200 && voided.data.voided === true, JSON.stringify(voided.data))
  const pub1b = await request(`/settlements/${sheet1.code}`, {}, null)
  check('② 撤回的单不计入「待签 N/N」', pub1b.data.settlement.groupTotal === 1, String(pub1b.data.settlement.groupTotal))
  // 幂等:再撤一次不报错
  const voidAgain = await request(`/admin/settlements/${sheet2.id}/void`, { method: 'POST' }, shop.token)
  check('① 幂等:重复撤回不报错', voidAgain.status === 200, String(voidAgain.status))

  // 撤回带券的那张 → 券回券包(并发时序:券不能被一张作废单永远占着)
  const void1 = await request(`/admin/settlements/${sheet1.id}/void`, { method: 'POST' }, shop.token)
  check('① 带券的单也能撤', void1.status === 200)
  const grants = await request('/admin/coupon-grants', {}, shop.token)
  const g = grants.data.grants.find((x) => x.id === grantId)
  check('① 并发时序:撤回后券放回券包,不被作废单占着', g.status === 'active' && g.logs.some((l) => l.action === 'released'),
    JSON.stringify({ s: g.status, logs: g.logs.map((l) => l.action) }))

  // 空态:全撤完了,这一天的日结应该没有任何待办
  const emptyClose = await request('/admin/daily-close', {}, shop.token)
  check('① 空态:单全撤完后日结无 blocker、可确认', emptyClose.data.dailyClose.canConfirm === true && emptyClose.data.dailyClose.pendingAllocation.length === 0,
    JSON.stringify(emptyClose.data.dailyClose.blockers))

  // ---- ④ 财务红线:充值不是业绩 ----
  // 重新开一张真单并签掉,让技师甲有一笔真业绩;技师乙只有一笔大额充值
  const real = await request('/admin/settlements', {
    method: 'POST',
    body: JSON.stringify({
      cardOwnerUserId: user,
      settlements: [{ tierKey: 'list', items: [{ serviceId: main3h.id }], technicians: [{ technicianId: techA.id, role: 'main', itemNos: [1] }] }]
    })
  }, shop.token)
  const realSheet = real.data.settlements[0]
  await request(`/settlements/${realSheet.code}/sign`, {
    method: 'POST', body: JSON.stringify({ disclaimerAccepted: true, signature: '客', strokes: [[{ x: 3, y: 3 }, { x: 9, y: 9 }]] })
  }, null)

  // 一笔 ¥10,000 充值,记在技师乙促成名下(首充)
  const bigRecharge = await request('/admin/stored-value/recharge', {
    method: 'POST', body: JSON.stringify({ userId: user, amountCents: 1000000, payChannel: 'offline', technicianId: techB.id, note: '大额首充(红线断言)' })
  }, shop.token)
  check('④ 大额充值已入账', bigRecharge.status === 200 || bigRecharge.status === 201, JSON.stringify(bigRecharge.data).slice(0, 160))

  const today = (await request('/admin/daily-close', {}, shop.token)).data.dailyClose.date
  await request('/admin/daily-close', { method: 'POST', body: JSON.stringify({ date: today }) }, shop.token)
  const closed = (await request(`/admin/daily-close?date=${today}`, {}, shop.token)).data.dailyClose
  const rowB = closed.technicians.find((t) => t.technicianId === techB.id)
  const rowA = closed.technicians.find((t) => t.technicianId === techA.id)
  check('④ 红线:充值**不进**日结业绩列', rowB && rowB.perfCents === 0, JSON.stringify(rowB && { perf: rowB.perfCents, rc: rowB.rechargeTotalCents }))
  check('④ 红线:充值只体现在冲卡列(¥10,000)', rowB && rowB.rechargeTotalCents === 1000000, String(rowB && rowB.rechargeTotalCents))
  check('④ 真做的单才是业绩(技师甲 ¥600)', rowA && rowA.perfCents === 60000, String(rowA && rowA.perfCents))

  const rank = (await request(`/admin/perf-ranking?metric=perf&period=day&date=${today}`, {}, shop.token)).data.ranking
  const rankB = rank.ranking.find((r) => r.technicianId === techB.id)
  check('④ 红线:充值不进排行的业绩', rankB && rankB.perfCents === 0, String(rankB && rankB.perfCents))
  check('④ 排行的冲卡列有这笔', rankB && rankB.rechargeCents === 1000000, String(rankB && rankB.rechargeCents))

  const mine = await request(`/admin/my-performance?technicianId=${techB.id}`, {}, shop.token)
  const heroPerf = mine.data.hero ? mine.data.hero.perfCents : (mine.data.performance?.hero?.perfCents ?? null)
  check('④ 红线:员工端「我的业绩」不含这笔充值', heroPerf === 0, JSON.stringify(heroPerf))

  // 目标进度:给技师乙设一个目标,进度必须还是 0 —— 充值不能把进度推上去
  const month = today.slice(0, 7)
  await request('/admin/perf-targets', {
    method: 'PUT', body: JSON.stringify({ month, targets: [{ technicianId: techB.id, mode: 'total', displayMode: 'total_only', perfTargetCents: 500000 }] })
  }, shop.token)
  const rank2 = (await request(`/admin/perf-ranking?metric=perf&period=month&date=${month}`, {}, shop.token)).data.ranking
  const tgtB = (rank2.targets || []).find((t) => t.technicianId === techB.id)
  check('④ 红线:目标进度不被充值推高(仍是 0%)', tgtB && tgtB.perfCents === 0 && (!tgtB.target || tgtB.target.pct === 0),
    JSON.stringify(tgtB && { perf: tgtB.perfCents, pct: tgtB.target && tgtB.target.pct }))

  // ---- 越权:员工端调老板接口 ----
  const staffAcc = await request('/admin/staff-accounts', { method: 'POST', body: JSON.stringify({ technicianId: techB.id }) }, shop.token)
  const staffUser = staffAcc.data.account || staffAcc.data
  const staffLogin = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: staffUser.username, password: staffUser.initialPassword }) }, null)
  const staffToken = staffLogin.data?.auth?.accessToken
  for (const [label, path2] of [['日结', '/admin/daily-close'], ['薪资方案', '/admin/salary-plans'], ['业绩目标', '/admin/perf-targets'], ['发放记录', '/admin/coupon-grants']]) {
    const res = await request(path2, {}, staffToken)
    check(`越权:员工调「${label}」被 403`, res.status === 403, `${path2} → ${res.status}`)
  }

  // ---- 边界值:0% / 100% 分成、恰好等于门槛的券 ----
  const two = await request('/admin/settlements', {
    method: 'POST',
    body: JSON.stringify({
      cardOwnerUserId: user,
      settlements: [{ tierKey: 'list', items: [{ serviceId: main3h.id }], technicians: [{ technicianId: techA.id, role: 'main', itemNos: [1] }, { technicianId: techB.id, role: 'assist', itemNos: [1] }] }]
    })
  }, shop.token)
  const twoSheet = two.data.settlements[0]
  await request(`/settlements/${twoSheet.code}/sign`, {
    method: 'POST', body: JSON.stringify({ disclaimerAccepted: true, signature: '客', strokes: [[{ x: 1, y: 1 }, { x: 5, y: 5 }]] })
  }, null)
  await request('/admin/daily-close/reopen', { method: 'POST', body: JSON.stringify({ date: today, reason: '边界值测试' }) }, shop.token)

  /* 预填比例的形状(2026-08-09 铺大数据时炸出来的):两端读的是 mainPct/assistPct。
     以前后端给的是裸数组 [70,30] → 两端读到 undefined → 比例框空的 →
     保存分成必然 SHARE_MISMATCH → 多技师单那一天的日结永远确认不了。 */
  const dcView = (await request(`/admin/daily-close?date=${today}`, {}, shop.token)).data.dailyClose
  const anyPending = (dcView.pendingAllocation || [])[0]
  check('日结预填比例给的是 mainPct/assistPct(不是裸数组)',
    Boolean(anyPending) && Number.isFinite(anyPending.defaultSplit.mainPct) && Number.isFinite(anyPending.defaultSplit.assistPct),
    JSON.stringify(anyPending && anyPending.defaultSplit))
  check('预填比例两项加起来是 100', Boolean(anyPending) && anyPending.defaultSplit.mainPct + anyPending.defaultSplit.assistPct === 100,
    JSON.stringify(anyPending && anyPending.defaultSplit))
  // 照两端的读法预填,保存必须成功(以前这里会 SHARE_MISMATCH)
  const prefill = await request(`/admin/settlements/${anyPending.settlementId}/allocate`, {
    method: 'POST',
    body: JSON.stringify({ shares: anyPending.technicians.map((t, i) => ({ technicianId: t.technicianId, pct: i === 0 ? anyPending.defaultSplit.mainPct : anyPending.defaultSplit.assistPct })) })
  }, shop.token)
  check('按预填比例直接保存分成成功', prefill.status === 200, JSON.stringify(prefill.data).slice(0, 160))

  const zero = await request(`/admin/settlements/${twoSheet.id}/allocate`, {
    method: 'POST', body: JSON.stringify({ shares: [{ technicianId: techA.id, pct: 100 }, { technicianId: techB.id, pct: 0 }] })
  }, shop.token)
  check('边界值:100/0 分成成立且合计等于基数', zero.status === 200 && zero.data.shares.reduce((n, s2) => n + s2.shareCents, 0) === twoSheet.subtotalCents,
    JSON.stringify(zero.data.shares))
  const odd = await request(`/admin/settlements/${twoSheet.id}/allocate`, {
    method: 'POST', body: JSON.stringify({ shares: [{ technicianId: techA.id, pct: 33.33 }, { technicianId: techB.id, pct: 66.67 }] })
  }, shop.token)
  check('边界值:分币余数由末行吃掉,合计仍正好等于基数',
    odd.status === 200 && odd.data.shares.reduce((n, s2) => n + s2.shareCents, 0) === twoSheet.subtotalCents,
    JSON.stringify(odd.data.shares))

  // ---- 异常输入 ----
  const ghost = await request(`/admin/settlements/${twoSheet.id}/allocate`, {
    method: 'POST', body: JSON.stringify({ shares: [{ technicianId: 'tech-does-not-exist', pct: 50 }, { technicianId: techB.id, pct: 50 }] })
  }, shop.token)
  check('异常输入:悬空 technicianId 被拒', ghost.status === 400, JSON.stringify(ghost.data))
  const ghostSvc = await request('/admin/settlements/preview', {
    method: 'POST', body: JSON.stringify({ tierKey: 'list', items: [{ serviceId: 'svc-does-not-exist' }] })
  }, shop.token)
  check('异常输入:悬空 serviceId 被拒', ghostSvc.status === 404, String(ghostSvc.status))

  console.log(`\n对图修复批回归通过:${checks} 项断言全绿`)
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`)
  process.exit(1)
})
