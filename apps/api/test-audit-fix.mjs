/* 对图修复批回归(2026-08-09)+ CLAUDE.md《测试标准》六类 corner case + 财务红线。

   覆盖:
     ① 撤回改单(屏 0):待签可撤 / 已签不可撤 / 撤回后券放回券包 / 撤回的单不再拦日结
     ② 签署页「待签 1/2」角标:groupIndex / groupTotal(撤回的不计入)
     ③ 加项组名(裁决④):商家自填、留空归「其他加项」、随价目表下发
     ④ **财务红线**:一笔 ¥10,000 充值归某技师促成 →
        业绩 / 排行 / 员工端我的业绩 / 目标进度 全都不含它,只有冲卡列体现
   corner case 类别:边界值 / 空态 / 并发时序 / 越权 / 幂等 / 异常输入 —— 见各段注释标注。 */
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
/* 测试护栏(裁 C):套件永远不许写进真库 —— 开跑前问服务器「你往哪个库写」 */
import { assertTestTarget } from './test-guard.mjs'
await assertTestTarget(BASE_URL)
const PLATFORM = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN_ID = Date.now().toString(36)

// 门店时区的今天(测试机与门店时区一致时就是本地日期)
// 四之五:日期问后端要门店时区的今天,不用测试机本地日期(白天绿半夜红的根源)
let STORE_TODAY = ''
const todayStr = () => STORE_TODAY || new Date().toLocaleDateString('en-CA')

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
  STORE_TODAY = (await request('/admin/store-clock', {}, shop.token)).data.today

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
  /* D25(3-1b,2026-08-12):导入客=phone 身份非绑定,充值会被拦 —— fixture 直连库绑上微信(同 noshow ⑮ 先例) */
  {
    const { DatabaseSync } = await import('node:sqlite')
    const bindDb = new DatabaseSync(process.env.TEST_DB_PATH)
    bindDb.prepare('UPDATE users SET wechat_open_id = ? WHERE id = ?').run('wx-d25fix-' + user, user)
    bindDb.close()
  }
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

  /* F1(店主 2026-08-09 口径):每天所有单都要经店长点确认,**单技师单也不例外** ——
     「不用分配」只是免去分成输入,不等于自动确认。所以单技师单必须在日结列表里
     以「无需分配 · 待确认」出现,而且在店长点确认之前那天不能是 confirmed。 */
  const soloG = await request('/admin/settlements', {
    method: 'POST',
    body: JSON.stringify({
      cardOwnerUserId: user,
      settlements: [{ tierKey: 'list', items: [{ serviceId: main3h.id }], technicians: [{ technicianId: techA.id, role: 'main', itemNos: [1] }] }]
    })
  }, shop.token)
  const soloSheet = soloG.data.settlements[0]
  await request(`/settlements/${soloSheet.code}/sign`, {
    method: 'POST', body: JSON.stringify({ disclaimerAccepted: true, signature: '客', strokes: [[{ x: 2, y: 2 }, { x: 7, y: 7 }]] })
  }, null)
  const soloView = (await request('/admin/daily-close', {}, shop.token)).data.dailyClose
  check('F1 单技师单进日结列表(无需分配 · 待确认)',
    (soloView.awaitingConfirm || []).some((a) => a.settlementId === soloSheet.id && /无需分配/.test(a.reason)),
    JSON.stringify((soloView.awaitingConfirm || []).map((a) => a.reason)))
  check('F1 单技师单不会被自动确认(当天仍未 confirmed)', soloView.status !== 'confirmed', soloView.status)

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
  // 技师甲这天做了两张 ¥600 的单(上面 F1 那张单技师单 + 这张),业绩 = ¥1200
  check('④ 真做的单才是业绩(技师甲 ¥1200 = 两张 ¥600)', rowA && rowA.perfCents === 120000, String(rowA && rowA.perfCents))

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

  /* 用户名:拼音自动生成 + 建号弹窗可改(店主 2026-08-09 拍板)。
     以前中文名会落到 staff / staff2 —— 用户名规则只取 ascii,中文全被剥掉了。 */
  const techCn = (await request(`/platform/tenants/${shop.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: '小婕' }) })).data.technician
  const sug = await request(`/admin/staff-accounts/suggest?technicianId=${techCn.id}`, {}, shop.token)
  check('用户名:中文名按拼音生成(小婕 → xiaojie)', sug.data.username === 'xiaojie', JSON.stringify(sug.data))
  const techCn2 = (await request(`/platform/tenants/${shop.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: '小婕' }) })).data.technician
  const madeCn = await request('/admin/staff-accounts', { method: 'POST', body: JSON.stringify({ technicianId: techCn.id }) }, shop.token)
  check('用户名:不传就用拼音', madeCn.data.username === 'xiaojie', JSON.stringify(madeCn.data.username))
  const sug2 = await request(`/admin/staff-accounts/suggest?technicianId=${techCn2.id}`, {}, shop.token)
  check('用户名:重名加数字后缀', sug2.data.username === 'xiaojie2', JSON.stringify(sug2.data.username))
  const custom = await request('/admin/staff-accounts', {
    method: 'POST', body: JSON.stringify({ technicianId: techCn2.id, username: 'jiejie88' })
  }, shop.token)
  check('用户名:弹窗里改的名字生效', custom.data.username === 'jiejie88', JSON.stringify(custom.data.username))
  const techCn3 = (await request(`/platform/tenants/${shop.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: '苏苏' }) })).data.technician
  const bad = await request('/admin/staff-accounts', { method: 'POST', body: JSON.stringify({ technicianId: techCn3.id, username: '苏苏' }) }, shop.token)
  check('用户名:异常输入(中文/太短)被拒', bad.status === 400 && bad.data.error.code === 'BAD_USERNAME', JSON.stringify(bad.data))
  const dup = await request('/admin/staff-accounts', { method: 'POST', body: JSON.stringify({ technicianId: techCn3.id, username: 'jiejie88' }) }, shop.token)
  check('用户名:重名被拒(查重)', dup.status === 409, JSON.stringify(dup.data).slice(0, 120))

  /* F2(店主 2026-08-09 随查):结算页看不到定金抵扣行。
     根因是数据(门店没配 deposit_config → deductible 默认 false),不是渲染。
     这里把「配了抵扣 → 定金真的抵进去 + 支付构成里有 deposit 腿」钉死,
     免得以后又出现「配了却抵不动」或「抵了却不出行」。 */
  await request('/admin/deposit-config', {
    method: 'PUT',
    body: JSON.stringify({ config: { enabled: true, deductible: true, mode: 'fixed', fixedAmountCents: 10000 } })
  }, shop.token)
  /* v1.2 §五 补拍①:抵扣依据＝**收取记录**。所以要先有预约、且这张预约标记过已收定金,
     结算才会出抵扣行 —— 光配了定金规则是不够的。 */
  const depBk = (await request('/admin/bookings/direct', {
    method: 'POST',
    body: JSON.stringify({ userId: user, serviceId: main3h.id, technicianId: techA.id, date: todayStr(), time: '12:10', durationMin: 60, depositPaid: false })
  }, shop.token)).data.booking
  const noReceiptSheet = (await request('/admin/settlements', {
    method: 'POST',
    body: JSON.stringify({
      cardOwnerUserId: user,
      settlements: [{ bookingId: depBk.id, tierKey: 'list', depositApplied: true, payIntent: 'offline_full', items: [{ serviceId: main3h.id }], technicians: [{ technicianId: techA.id, role: 'main', itemNos: [1] }] }]
    })
  }, shop.token)).data.settlements[0]
  check('F2/v1.2① 没标记收过定金的预约:结算不出抵扣行(不许抵没收过的钱)',
    noReceiptSheet.depositDeductCents === 0, String(noReceiptSheet.depositDeductCents))
  await request(`/admin/settlements/${noReceiptSheet.id}/void`, { method: 'POST' }, shop.token)
  await request(`/admin/bookings/${depBk.id}/deposit-receipt`, { method: 'POST', body: JSON.stringify({}) }, shop.token)
  const depSheet = (await request('/admin/settlements', {
    method: 'POST',
    body: JSON.stringify({
      cardOwnerUserId: user,
      settlements: [{ bookingId: depBk.id, tierKey: 'list', depositApplied: true, payIntent: 'offline_full', items: [{ serviceId: main3h.id }], technicians: [{ technicianId: techA.id, role: 'main', itemNos: [1] }] }]
    })
  }, shop.token)).data.settlements[0]
  check('F2 配了「定金抵扣尾款」后,定金真的抵进去了', depSheet.depositDeductCents === 10000, String(depSheet.depositDeductCents))
  check('F2 应收 ≡ 档位小计 − 定金 − 券',
    depSheet.totalCents === depSheet.subtotalCents - depSheet.depositDeductCents - (depSheet.couponDiscountCents || 0),
    JSON.stringify({ t: depSheet.totalCents, s: depSheet.subtotalCents, d: depSheet.depositDeductCents }))
  const depPublic = await request(`/settlements/${depSheet.code}`)
  const depLeg = (depPublic.data.settlement.payments || []).find((p) => p.leg === 'deposit')
  check('F2 顾客签署页拿得到 deposit 支付腿(定金抵扣行的数据源)',
    Boolean(depLeg) && depLeg.amountCents === 10000, JSON.stringify(depPublic.data.settlement.payments))
  check('F2 分成基数不受定金影响(仍 ≡ 档位小计)',
    depSheet.perfBaseCents === depSheet.subtotalCents, JSON.stringify({ p: depSheet.perfBaseCents, s: depSheet.subtotalCents }))

  /* 拍板 A(2026-08-09)·《财务记账总逻辑》v1.1 §五:线下收定金的记账。
     标记 = 写一条只追加的定金收取记录,计入定金预收(负债),**标记那一刻不进收入账本**。
     corner case:幂等 / 取消预约后留痕 / 越权 / 未配定金规则的店不出按钮 / 撤销留痕。 */
  const svcA = await mk({ nameZh: '定金测试项', type: 'NAIL', categoryId: cat.id, itemKind: 'main', listPriceCents: 50000, memberPriceCents: 50000 })
  const bk = (await request('/admin/bookings/direct', {
    method: 'POST',
    body: JSON.stringify({ userId: user, serviceId: svcA.id, technicianId: techA.id, date: todayStr(), time: '15:20', durationMin: 60, depositPaid: false })
  }, shop.token)).data.booking
  const deskBefore = (await request(`/admin/schedule-day?date=${todayStr()}`, {}, shop.token)).data
  check('A 未付定金的直接排单在台面上打了「未付定金」标',
    ((deskBefore.bookings || []).find((x) => x.id === bk.id) || {}).depositUnpaid === true,
    JSON.stringify((deskBefore.bookings || []).find((x) => x.id === bk.id)))

  const liabBaseline = (await request('/admin/stored-value', {}, shop.token)).data.storedValue.depositLiabilityCents
  const incomeBefore = (await request(`/admin/finance/transactions?month=${todayStr().slice(0, 7)}`, {}, shop.token)).data
  const beforeIncome = (incomeBefore.transactions || []).filter((t) => t.type === 'income').length

  const mark1 = await request(`/admin/bookings/${bk.id}/deposit-receipt`, { method: 'POST', body: JSON.stringify({}) }, shop.token)
  check('A 标记已收定金 → 201 并落一条记录', mark1.status === 201 && mark1.data.receipt.amountCents === 10000,
    JSON.stringify(mark1.data).slice(0, 200))
  check('A 金额由后端按店配算(¥100),不听前端的', mark1.data.receipt.amountCents === 10000, String(mark1.data.receipt.amountCents))
  check('A 记了经手人', Boolean(mark1.data.receipt.technicianId), mark1.data.receipt.technicianId)
  check('A 定金落到预约单上(¥100 = 10000 分)', mark1.data.booking.depositCents === 10000, String(mark1.data.booking.depositCents))
  const deskAfter = (await request(`/admin/schedule-day?date=${todayStr()}`, {}, shop.token)).data
  const deskRow = (deskAfter.bookings || []).find((x) => x.id === bk.id)
  check('A 台面上的「未付定金」标被摘掉(按钮随之消失)', deskRow && deskRow.depositUnpaid === false,
    JSON.stringify(deskRow && deskRow.depositUnpaid))

  const afterMark = (await request(`/admin/finance/transactions?month=${todayStr().slice(0, 7)}`, {}, shop.token)).data
  check('A 红线:标记那一刻**不进收入账本**',
    (afterMark.transactions || []).filter((t) => t.type === 'income').length === beforeIncome,
    `${beforeIncome} → ${(afterMark.transactions || []).filter((t) => t.type === 'income').length}`)

  const svSummary = (await request('/admin/stored-value', {}, shop.token)).data.storedValue
  check('A 计入定金预收(负债):这一笔让负债 +¥100', svSummary.depositLiabilityCents - liabBaseline === 10000,
    JSON.stringify({ baseline: liabBaseline, now: svSummary.depositLiabilityCents }))

  // 幂等:再标一次不重复记账
  const mark2 = await request(`/admin/bookings/${bk.id}/deposit-receipt`, { method: 'POST', body: JSON.stringify({}) }, shop.token)
  check('A 幂等:重复标记不再记一笔', mark2.status === 200 && mark2.data.created === false, JSON.stringify(mark2.data).slice(0, 160))
  const list1 = (await request(`/admin/bookings/${bk.id}/deposit-receipt`, {}, shop.token)).data
  check('A 幂等:留痕里仍然只有一条 receipt', list1.receipts.filter((r) => r.kind === 'receipt').length === 1,
    JSON.stringify(list1.receipts.map((r) => r.kind)))

  // 越权:未登录 / 跨店都不能标
  const anonMark = await request(`/admin/bookings/${bk.id}/deposit-receipt`, { method: 'POST', body: JSON.stringify({}) }, null)
  check('A 越权:未登录标定金 401', anonMark.status === 401, String(anonMark.status))
  const crossMark = await request(`/admin/bookings/${bk.id}/deposit-receipt`, { method: 'POST', body: JSON.stringify({}) }, other.token)
  check('A 越权:跨店标定金 404(看不到别家店的预约)', crossMark.status === 404, String(crossMark.status))

  // 撤销:写 revoke 留痕,原记录不删
  const rev = await request(`/admin/bookings/${bk.id}/deposit-receipt/revoke`, { method: 'POST', body: JSON.stringify({ reason: '标错了' }) }, shop.token)
  check('A 误标可撤销', rev.status === 200 && rev.data.revoked === true, JSON.stringify(rev.data))
  const list2 = (await request(`/admin/bookings/${bk.id}/deposit-receipt`, {}, shop.token)).data
  check('A 撤销留痕:原 receipt 还在,另加一行 revoke',
    list2.receipts.length === 2 && list2.receipts.some((r) => r.kind === 'receipt') && list2.receipts.some((r) => r.kind === 'revoke'),
    JSON.stringify(list2.receipts.map((r) => r.kind)))
  check('A 撤销后有效定金归零', list2.activeCents === 0, String(list2.activeCents))
  const svAfterRev = (await request('/admin/stored-value', {}, shop.token)).data.storedValue
  check('A 撤销后这一笔从负债里退出去(回到基线)', svAfterRev.depositLiabilityCents === liabBaseline,
    JSON.stringify({ baseline: liabBaseline, now: svAfterRev.depositLiabilityCents }))

  // 取消预约后:定金记录照样留着(留痕),不因订单取消而消失
  await request(`/admin/bookings/${bk.id}/deposit-receipt`, { method: 'POST', body: JSON.stringify({}) }, shop.token)
  await request(`/admin/bookings/${bk.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'CANCELLED' }) }, shop.token)
  const list3 = (await request(`/admin/bookings/${bk.id}/deposit-receipt`, {}, shop.token)).data
  check('A 取消预约后定金留痕还在', list3.receipts.length === 3, JSON.stringify(list3.receipts.map((r) => r.kind)))

  // DB 层:定金记录删不掉、金额改不动(不靠人记纪律)
  {
    const { DatabaseSync } = await import('node:sqlite')
    const dbPath = process.env.TEST_DB_PATH || `${process.env.DATA_DIR || './local-data'}/lucky-luxe.sqlite`
    /* D72(店主 08-24):禁删/禁改律的判据改成 tenants.kind='real'(不再靠租户名字)。
       套件建的店是 kind='test',默认可删 —— 所以这里先把它标成 real 再验律,验完标回去。 */
    const rawDb = new DatabaseSync(dbPath)
    rawDb.prepare("UPDATE tenants SET kind = 'real' WHERE id = ?").run(shop.tenantId)
    const anyId = list3.receipts.find((r) => r.kind === 'receipt').id
    let delBlocked = false
    try { rawDb.prepare('DELETE FROM deposit_receipts WHERE id = ?').run(anyId) } catch { delBlocked = true }
    let amtBlocked = false
    try { rawDb.prepare('UPDATE deposit_receipts SET amount_cents = 1 WHERE id = ?').run(anyId) } catch { amtBlocked = true }
    check('A 定金记录数据库层禁删(kind=real 的租户)', delBlocked)
    check('A 定金记录金额数据库层改不动(kind=real 的租户)', amtBlocked)
    rawDb.prepare("UPDATE tenants SET kind = 'test' WHERE id = ?").run(shop.tenantId)
    rawDb.close()
  }

  // 未配定金规则的店:直接排单不打「未付定金」标 → 前端也就不会出「标记已收定金」按钮
  await request('/admin/deposit-config', { method: 'PUT', body: JSON.stringify({ config: { enabled: false } }) }, shop.token)
  const bkNoDep = (await request('/admin/bookings/direct', {
    method: 'POST',
    body: JSON.stringify({ userId: user, serviceId: svcA.id, technicianId: techB.id, date: todayStr(), time: '17:40', durationMin: 60, depositPaid: false })
  }, shop.token)).data.booking
  const deskNoDep = (await request(`/admin/schedule-day?date=${todayStr()}`, {}, shop.token)).data
  check('A 未配定金规则的店:不打「未付定金」标(按钮就不会出现)',
    ((deskNoDep.bookings || []).find((x) => x.id === bkNoDep.id) || {}).depositUnpaid === false,
    JSON.stringify((deskNoDep.bookings || []).find((x) => x.id === bkNoDep.id)))
  const markNoDep = await request(`/admin/bookings/${bkNoDep.id}/deposit-receipt`, { method: 'POST', body: JSON.stringify({}) }, shop.token)
  check('A 没开定金的店后端也拒绝标记', markNoDep.status === 400 && markNoDep.data.error.code === 'DEPOSIT_DISABLED',
    JSON.stringify(markNoDep.data).slice(0, 140))
  // 还原,别影响后面的用例
  await request('/admin/deposit-config', {
    method: 'PUT', body: JSON.stringify({ config: { enabled: true, deductible: true, mode: 'fixed', fixedAmountCents: 10000 } })
  }, shop.token)

  /* 拍板 A 的兑现两条路(§五 ①②)。
     ① 抵扣开的店:签字时定金作为付款腿抵掉应收,**不再另记收入**(避免一笔钱记两次);
     ② 抵扣关的店:签字时把定金转成独立的「定金收入」账目行,不减应收、不进业绩。 */
  const monthKey = todayStr().slice(0, 7)
  const incomeRows = async () => ((await request(`/admin/finance/transactions?month=${monthKey}`, {}, shop.token)).data.transactions || [])

  // ① 抵扣开
  const bkD = (await request('/admin/bookings/direct', {
    method: 'POST',
    body: JSON.stringify({ userId: user, serviceId: svcA.id, technicianId: techA.id, date: todayStr(), time: '18:40', durationMin: 60, depositPaid: false })
  }, shop.token)).data.booking
  await request(`/admin/bookings/${bkD.id}/deposit-receipt`, { method: 'POST', body: JSON.stringify({}) }, shop.token)
  const shD = (await request('/admin/settlements', {
    method: 'POST',
    body: JSON.stringify({
      cardOwnerUserId: user,
      settlements: [{ bookingId: bkD.id, tierKey: 'list', depositApplied: true, payIntent: 'offline_full', items: [{ serviceId: svcA.id }], technicians: [{ technicianId: techA.id, role: 'main', itemNos: [1] }] }]
    })
  }, shop.token)).data.settlements[0]
  check('A① 抵扣开:定金抵进应收(¥500 − ¥100 = ¥400)',
    shD.depositDeductCents === 10000 && shD.totalCents === 40000, JSON.stringify({ d: shD.depositDeductCents, t: shD.totalCents }))
  check('A① 定金不进业绩:分成基数仍 ≡ 档位小计', shD.perfBaseCents === shD.subtotalCents,
    JSON.stringify({ p: shD.perfBaseCents, s: shD.subtotalCents }))
  const depIncomeBefore = (await incomeRows()).filter((t) => t.category === '服务收入-定金').length
  const liabBefore = (await request('/admin/stored-value', {}, shop.token)).data.storedValue.depositLiabilityCents
  await request(`/settlements/${shD.code}/sign`, {
    method: 'POST', body: JSON.stringify({ disclaimerAccepted: true, signature: '客', strokes: [[{ x: 5, y: 50 }, { x: 40, y: 15 }]] })
  }, null)
  /* 守恒(v1.2 §五 补拍②):抵扣开的店定金腿也**必须**记一行收入 ——
     负债减了 ¥100 而收入不涨,那 ¥100 就凭空消失了(2026-08-09 店主查出来的洞)。 */
  const depIncomeRows = (await incomeRows()).filter((t) => t.category === '服务收入-定金')
  check('A① 守恒:抵扣开的店签字时定金腿转收入(+¥100 一行)',
    depIncomeRows.length === depIncomeBefore + 1 && depIncomeRows[0].amountCents === 10000,
    JSON.stringify(depIncomeRows.map((t) => [t.category, t.amountCents])))
  const liabAfter = (await request('/admin/stored-value', {}, shop.token)).data.storedValue.depositLiabilityCents
  check('A① 守恒:负债同步减少 ¥100(减少额 = 收入增加额)', liabBefore - liabAfter === 10000,
    JSON.stringify({ before: liabBefore, after: liabAfter }))
  const legsAfter = (await request(`/settlements/${shD.code}`)).data.settlement.payments || []
  check('A① 定金腿签后置为已付', (legsAfter.find((l) => l.leg === 'deposit') || {}).status === 'paid',
    JSON.stringify(legsAfter.map((l) => [l.leg, l.status])))
  const recD = (await request(`/admin/bookings/${bkD.id}/deposit-receipt`, {}, shop.token)).data
  check('A① 签字后定金记录标成已兑现', Boolean(recD.receipts.find((r) => r.kind === 'receipt').settledSettlementId),
    JSON.stringify(recD.receipts.map((r) => r.settledSettlementId)))
  const cons1 = (await request('/admin/finance/deposit-conservation', {}, shop.token)).data
  check('A① 定金守恒审计通过(没有"负债减了收入没涨"的记录)', cons1.ok === true, JSON.stringify(cons1.broken).slice(0, 240))

  // ② 抵扣关(定位费不抵扣)
  await request('/admin/deposit-config', {
    method: 'PUT', body: JSON.stringify({ config: { enabled: true, deductible: false, mode: 'fixed', fixedAmountCents: 10000 } })
  }, shop.token)
  const bkN = (await request('/admin/bookings/direct', {
    method: 'POST',
    body: JSON.stringify({ userId: user, serviceId: svcA.id, technicianId: techB.id, date: todayStr(), time: '19:50', durationMin: 60, depositPaid: false })
  }, shop.token)).data.booking
  await request(`/admin/bookings/${bkN.id}/deposit-receipt`, { method: 'POST', body: JSON.stringify({}) }, shop.token)
  const shN = (await request('/admin/settlements', {
    method: 'POST',
    body: JSON.stringify({
      cardOwnerUserId: user,
      settlements: [{ bookingId: bkN.id, tierKey: 'list', depositApplied: true, payIntent: 'offline_full', items: [{ serviceId: svcA.id }], technicians: [{ technicianId: techB.id, role: 'main', itemNos: [1] }] }]
    })
  }, shop.token)).data.settlements[0]
  check('A② 抵扣关:定金不抵应收(应收仍是 ¥500)', shN.depositDeductCents === 0 && shN.totalCents === 50000,
    JSON.stringify({ d: shN.depositDeductCents, t: shN.totalCents }))
  await request(`/settlements/${shN.code}/sign`, {
    method: 'POST', body: JSON.stringify({ disclaimerAccepted: true, signature: '客', strokes: [[{ x: 5, y: 50 }, { x: 40, y: 15 }]] })
  }, null)
  const depIncome = (await incomeRows()).filter((t) => t.category === '定金收入')
  check('A② 抵扣关的店签字时记一行「定金收入」¥100', depIncome.length === 1 && depIncome[0].amountCents === 10000,
    JSON.stringify(depIncome.map((t) => [t.category, t.amountCents])))
  check('A② 定金收入不减应收:这张单的应收还是 ¥500',
    (await request(`/settlements/${shN.code}`)).data.settlement.totalCents === 50000,
    String((await request(`/settlements/${shN.code}`)).data.settlement.totalCents))
  check('A② 定金收入不进业绩:分成基数仍 ≡ 档位小计', shN.perfBaseCents === shN.subtotalCents,
    JSON.stringify({ p: shN.perfBaseCents, s: shN.subtotalCents }))
  await request('/admin/deposit-config', {
    method: 'PUT', body: JSON.stringify({ config: { enabled: true, deductible: true, mode: 'fixed', fixedAmountCents: 10000 } })
  }, shop.token)

  /* F3(店主 2026-08-09 更正):散客不做新入口 —— 所有散客先由**技师现场排单**建即时预约,
     再走正常结算。所以「直接排单」不能只给老板;员工只能排到自己那一列。 */
  const walkinAcct = (await request('/admin/staff-accounts', {
    method: 'POST', body: JSON.stringify({ technicianId: techA.id })
  }, shop.token)).data
  const walkinFirst = (await request('/admin/auth/login', {
    method: 'POST', body: JSON.stringify({ email: walkinAcct.username, password: walkinAcct.initialPassword })
  }, null)).data
  const staffPass = `Sfx-${RUN_ID}-9a`
  await request('/admin/auth/change-password', {
    method: 'POST', body: JSON.stringify({ oldPassword: walkinAcct.initialPassword, newPassword: staffPass, confirmPassword: staffPass })
  }, walkinFirst.auth.accessToken)
  const walkinLogin = (await request('/admin/auth/login', {
    method: 'POST', body: JSON.stringify({ email: walkinAcct.username, password: staffPass })
  }, null)).data
  const walkinToken = walkinLogin.auth && walkinLogin.auth.accessToken
  check('F3 员工账号可登录', Boolean(walkinToken), JSON.stringify(walkinLogin).slice(0, 160))
  const staffBook = await request('/admin/bookings/direct', {
    method: 'POST',
    body: JSON.stringify({ newCustomerName: `散客${RUN_ID}`, phone: `1372${RUN_ID.slice(-7)}`, serviceId: svcA.id, technicianId: techA.id, date: todayStr(), time: '20:40', durationMin: 60, depositPaid: false })
  }, walkinToken)
  check('F3 技师能给自己现场排单(散客即时预约)', staffBook.status === 201, JSON.stringify(staffBook.data).slice(0, 200))
  check('F3 现场建档 = 轻档案(有顾客 id,后面才结算得了)', Boolean(staffBook.data.booking.userId || staffBook.data.booking.user), JSON.stringify(staffBook.data.booking).slice(0, 160))
  const staffCross = await request('/admin/bookings/direct', {
    method: 'POST',
    body: JSON.stringify({ newCustomerName: '别人的客', serviceId: svcA.id, technicianId: techB.id, date: todayStr(), time: '21:40', durationMin: 60 })
  }, walkinToken)
  check('F3 越权:员工不能排到别人那一列 403', staffCross.status === 403, String(staffCross.status))
  const deskWalkIn = (await request(`/admin/schedule-day?date=${todayStr()}`, {}, shop.token)).data
  check('F3 即时预约立刻出现在今日台面上',
    (deskWalkIn.bookings || []).some((x) => x.startTime === '20:40'), JSON.stringify((deskWalkIn.bookings || []).map((x) => x.startTime)))
  const walkRow = (deskWalkIn.bookings || []).find((x) => x.startTime === '20:40')
  check('F3 台面上这条带顾客 id(「去结算」按钮才点得动)', Boolean(walkRow && walkRow.userId), JSON.stringify(walkRow && walkRow.userId))
  // 员工也能标定金(现场是技师收的钱)
  const staffMark = await request(`/admin/bookings/${staffBook.data.booking.id}/deposit-receipt`, { method: 'POST', body: JSON.stringify({}) }, walkinToken)
  check('A 员工也能标已收定金(现场是技师收的)', staffMark.status === 201, JSON.stringify(staffMark.data).slice(0, 160))
  const staffRevoke = await request(`/admin/bookings/${staffBook.data.booking.id}/deposit-receipt/revoke`, { method: 'POST', body: JSON.stringify({}) }, walkinToken)
  check('A 越权:员工不能撤销定金记录(撤销是老板的事)', staffRevoke.status === 403, String(staffRevoke.status))

  /* 守恒回填(v1.3 §五,店主 2026-08-09 拍板):错账靠**追加**改对,不改历史不删。
     这里只锁「幂等 + 越权」;真实回填在 KAP1 那次已验(两店审计 ok:true)。 */
  const repairAnon = await request('/admin/finance/deposit-conservation/repair', { method: 'POST', body: JSON.stringify({}) }, null)
  check('守恒回填 越权:未登录 401', repairAnon.status === 401, String(repairAnon.status))
  const repair1 = await request('/admin/finance/deposit-conservation/repair', { method: 'POST', body: JSON.stringify({}) }, shop.token)
  check('守恒回填:本来就守恒时不乱补', repair1.status === 200 && repair1.data.ok === true && repair1.data.repaired.length === 0,
    JSON.stringify(repair1.data).slice(0, 200))
  const repair2 = await request('/admin/finance/deposit-conservation/repair', { method: 'POST', body: JSON.stringify({}) }, shop.token)
  check('守恒回填 幂等:再跑一次还是 0 行', repair2.data.repaired.length === 0 && repair2.data.ok === true, JSON.stringify(repair2.data).slice(0, 160))

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
