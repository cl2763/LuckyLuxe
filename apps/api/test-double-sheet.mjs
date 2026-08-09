/* 双单场景回归(店主 2026-08-09 追问②)。

   口径(《待办总方案》小拍板备忘):
     **一个预约一张有效结算单** —— 未签可撤回重开;已签要补消费=新建即时预约再开单
     或走更正链;**同一顾客同日多单合法**。

   本文件只覆盖 corner case,正常路径靠别的套件(报告纪律:corner case 为主)。 */
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const PLATFORM = process.env.TEST_ADMIN_TOKEN || 'owner-demo-token'
const RUN = Date.now().toString(36)
/* 「今天」一律问后端要(门店时区),不用测试机的本地日期 ——
   跨零点那一下机器日期和门店日期会差一天,断言就会莫名其妙地空。 */
let STORE_TODAY = ''
const todayStr = () => STORE_TODAY
const uidOf = (b) => (b && (b.userId || (b.user && b.user.id))) || ''

const raw = (r) => (typeof r.data === 'string' ? r.data : (r.data && r.data.raw) || '')

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
  const id = `dbl-${label}-${RUN}`
  const created = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id, name: `双单店${label}${RUN}`, plan: 'chain' }) })
  if (created.status !== 201) throw new Error(`建店失败: ${JSON.stringify(created.data)}`)
  const { username, initialPassword } = created.data.owner
  const first = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: initialPassword }) }, null)
  const pass = `Dbl-${RUN}-${label}9`
  await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: initialPassword, newPassword: pass, confirmPassword: pass }) }, first.data.auth.accessToken)
  const again = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: pass }) }, null)
  const token = again.data.auth.accessToken
  const unlock = await request('/admin/finance/unlock', { method: 'POST', body: JSON.stringify({ password: PLATFORM }) }, token)
  if (unlock.data?.financeKey) financeKeys.set(token, unlock.data.financeKey)
  return { tenantId: id, token }
}

async function main() {
  const shop = await newShop('a')
  STORE_TODAY = (await request('/admin/daily-close', {}, shop.token)).data.dailyClose.date
  const cat = (await request('/admin/pricing/categories', { method: 'POST', body: JSON.stringify({ key: 'nail', name: '美甲' }) }, shop.token)).data.category
  const svc = (await request('/admin/pricing/items', {
    method: 'POST', body: JSON.stringify({ nameZh: '精品单色', type: 'NAIL', categoryId: cat.id, itemKind: 'main', listPriceCents: 20000, memberPriceCents: 20000 })
  }, shop.token)).data.item
  const techA = (await request(`/platform/tenants/${shop.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: `甲${RUN}` }) })).data.technician
  const techB = (await request(`/platform/tenants/${shop.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: `乙${RUN}` }) })).data.technician
  await request('/admin/deposit-config', {
    method: 'PUT', body: JSON.stringify({ config: { enabled: true, deductible: true, mode: 'fixed', fixedAmountCents: 5000 } })
  }, shop.token)
  const cust = uidOf((await request('/admin/bookings/direct', {
    method: 'POST',
    body: JSON.stringify({ newCustomerName: '双单客', phone: `1381${RUN.slice(-7)}`, serviceId: svc.id, technicianId: techA.id, date: todayStr(), time: '09:10', durationMin: 60, depositPaid: false })
  }, shop.token)).data.booking)

  const mkBooking = async (time, tech) => (await request('/admin/bookings/direct', {
    method: 'POST',
    body: JSON.stringify({ userId: cust, serviceId: svc.id, technicianId: tech.id, date: todayStr(), time, durationMin: 60, depositPaid: false })
  }, shop.token)).data.booking
  const mkSheet = async (booking, tech, extra = {}) => (await request('/admin/settlements', {
    method: 'POST',
    body: JSON.stringify({
      cardOwnerUserId: cust,
      settlements: [{ bookingId: booking.id, tierKey: 'list', payIntent: 'offline_full', items: [{ serviceId: svc.id }], technicians: [{ technicianId: tech.id, role: 'main', itemNos: [1] }], ...extra }]
    })
  }, shop.token))
  const sign = (code, who = '双单客') => request(`/settlements/${code}/sign`, {
    method: 'POST', body: JSON.stringify({ disclaimerAccepted: true, signature: who, strokes: [[{ x: 5, y: 50 }, { x: 40, y: 15 }]] })
  }, null)

  /* ---- ① 同一预约开第二张单被拒(未签态)---- */
  const bk1 = await mkBooking('10:10', techA)
  const s1 = await mkSheet(bk1, techA)
  check('① 第一张单开得出来', s1.status === 201, JSON.stringify(s1.data).slice(0, 140))
  const dup1 = await mkSheet(bk1, techA)
  check('① 同一预约再开第二张:409 被拒(未签态提示先撤回)',
    dup1.status === 409 && dup1.data.error.code === 'BOOKING_ALREADY_SETTLED' && dup1.data.error.message.includes('撤回'),
    JSON.stringify(dup1.data).slice(0, 200))
  // 撤回后可以重开(未签可撤回重开)
  await request(`/admin/settlements/${s1.data.settlements[0].id}/void`, { method: 'POST' }, shop.token)
  const reopen = await mkSheet(bk1, techA)
  check('① 撤回后同一预约可以重开', reopen.status === 201, String(reopen.status))
  // 已签态的提示措辞不同(要新建即时预约或走更正)
  await sign(reopen.data.settlements[0].code)
  const dupSigned = await mkSheet(bk1, techA)
  check('① 已签后再开:409 且提示走「新建即时预约 / 更正」',
    dupSigned.status === 409 && dupSigned.data.error.message.includes('更正'),
    JSON.stringify(dupSigned.data).slice(0, 200))

  /* ---- ② 同日两单先后开(同一顾客同日多单合法)---- */
  const bk2 = await mkBooking('11:20', techA)
  const s2 = await mkSheet(bk2, techA)
  check('② 同一顾客同日第二张单(挂另一条预约)开得出来', s2.status === 201, String(s2.status))

  /* ---- ③ 并行待签:两枚签署码互不干扰,各签各的 ---- */
  const bk3 = await mkBooking('12:30', techB)
  const s3 = await mkSheet(bk3, techB)
  const t2 = (await request(`/admin/settlements/${s2.data.settlements[0].id}/sign-token`, { method: 'POST', body: '{}' }, shop.token)).data
  const t3 = (await request(`/admin/settlements/${s3.data.settlements[0].id}/sign-token`, { method: 'POST', body: '{}' }, shop.token)).data
  check('③ 两张待签单各有各的签署码', t2.token !== t3.token, JSON.stringify({ a: t2.token, b: t3.token }))
  const r2 = await request(`/settlements/by-token/${t2.token}`, {}, null)
  const r3 = await request(`/settlements/by-token/${t3.token}`, {}, null)
  check('③ 两枚码各自换到自己的单,不串',
    r2.data.code === s2.data.settlements[0].code && r3.data.code === s3.data.settlements[0].code,
    JSON.stringify({ a: r2.data.code, b: r3.data.code }))
  // 出第二张的码不会作废第一张的(作废只在同一张单内)
  const t2b = (await request(`/admin/settlements/${s2.data.settlements[0].id}/sign-token`, { method: 'POST', body: '{}' }, shop.token)).data
  const stillOk = await request(`/settlements/by-token/${t3.token}`, {}, null)
  check('③ 给 A 单重发码,不影响 B 单那枚', stillOk.status === 200 && t2b.token !== t2.token, String(stillOk.status))

  /* ---- ④ 一签一待签时,撤回只动待签那张 ---- */
  await sign(s2.data.settlements[0].code)
  const voidSigned = await request(`/admin/settlements/${s2.data.settlements[0].id}/void`, { method: 'POST' }, shop.token)
  check('④ 已签那张撤不动(ALREADY_SIGNED)', voidSigned.status === 400 && voidSigned.data.error.code === 'ALREADY_SIGNED', String(voidSigned.status))
  const voidPending = await request(`/admin/settlements/${s3.data.settlements[0].id}/void`, { method: 'POST' }, shop.token)
  check('④ 待签那张撤得动', voidPending.status === 200, String(voidPending.status))
  const afterVoid = await request(`/settlements/${s2.data.settlements[0].code}`, {}, null)
  check('④ 撤回待签单不影响已签那张', afterVoid.data.settlement.status === 'signed', afterVoid.data.settlement.status)

  /* ---- ⑤ 券一单一张,跨两单不能复用 ---- */
  const coupon = (await request('/admin/coupons', { method: 'POST', body: JSON.stringify({ name: '满100减20', amountCents: 2000, minSpendCents: 10000, validDays: 30 }) }, shop.token)).data.coupon
  const grantId = (await request('/admin/coupon-grants/custom', {
    method: 'POST', body: JSON.stringify({ userId: cust, mode: 'template', couponId: coupon.id, reason: '双单测试' })
  }, shop.token)).data.granted.id
  const bk4 = await mkBooking('13:40', techA)
  const bk5 = await mkBooking('14:50', techB)
  const s4 = await mkSheet(bk4, techA, { couponGrantId: grantId })
  check('⑤ 第一张单用上券(抵 ¥20)', s4.data.settlements[0].couponDiscountCents === 2000, String(s4.data.settlements[0].couponDiscountCents))
  const s5 = await mkSheet(bk5, techB, { couponGrantId: grantId })
  check('⑤ 同一张券被第二单复用 → 拒或不抵(一单一张)',
    s5.status >= 400 || (s5.data.settlements && s5.data.settlements[0].couponDiscountCents === 0),
    JSON.stringify(s5.data).slice(0, 200))
  await sign(s4.data.settlements[0].code)
  const grantAfter = (await request('/admin/coupon-grants', {}, shop.token)).data.grants.find((g) => g.id === grantId)
  check('⑤ 券核销挂在真正用掉它的那一张单上', grantAfter.status === 'used' && grantAfter.settlementCode === s4.data.settlements[0].code,
    JSON.stringify({ s: grantAfter.status, c: grantAfter.settlementCode }))

  /* ---- ⑥ 定金只抵**有收取记录**的那一张(v1.2 §五 补拍①)---- */
  const bkDep = await mkBooking('15:20', techA)
  const bkNoDep = await mkBooking('16:30', techA)
  await request(`/admin/bookings/${bkDep.id}/deposit-receipt`, { method: 'POST', body: '{}' }, shop.token)
  const sDep = await mkSheet(bkDep, techA, { depositApplied: true })
  const sNoDep = await mkSheet(bkNoDep, techA, { depositApplied: true })
  check('⑥ 标过定金那张:抵 ¥50', sDep.data.settlements[0].depositDeductCents === 5000, String(sDep.data.settlements[0].depositDeductCents))
  check('⑥ 没标过的那张:一分不抵(哪怕也勾了「已付定金抵扣」)',
    sNoDep.data.settlements[0].depositDeductCents === 0, String(sNoDep.data.settlements[0].depositDeductCents))
  await sign(sDep.data.settlements[0].code)
  await sign(sNoDep.data.settlements[0].code)
  const cons = await request('/admin/finance/deposit-conservation', {}, shop.token)
  check('⑥ 两张都签完,定金守恒仍 ok', cons.data.ok === true, JSON.stringify(cons.data.broken).slice(0, 200))

  /* ---- ⑦ 日结业绩:两单同技师合并、不同技师各算 ---- */
  /* 日结的业绩行是**确认之后**才落的(F1:单技师单也要店长点确认)。
     所以这里先确认当天日结,再读行 —— 顺带验证「5 张单都进了待确认队列」。 */
  const before = (await request(`/admin/daily-close?date=${todayStr()}`, {}, shop.token)).data.dailyClose
  check('⑦ 5 张已签单都进了「待确认」队列(F1 语义)', (before.awaitingConfirm || []).length === 5,
    JSON.stringify((before.awaitingConfirm || []).map((a) => a.code)))
  const confirmed = await request('/admin/daily-close', { method: 'POST', body: JSON.stringify({ date: todayStr() }) }, shop.token)
  check('⑦ 日结确认成功', confirmed.status === 200, JSON.stringify(confirmed.data).slice(0, 200))
  const view = (await request(`/admin/daily-close?date=${todayStr()}`, {}, shop.token)).data.dailyClose
  const rowA = (view.technicians || []).find((r) => r.technicianId === techA.id)
  const rowB = (view.technicians || []).find((r) => r.technicianId === techB.id)
  /* 甲今天签成的:reopen(¥200)+ s2(¥200)+ s4(¥200−券20=业绩仍按档位小计 ¥200)
     + sDep(¥200)+ sNoDep(¥200)= ¥1000;乙:s3 被撤回、s5 没开成 → ¥0。
     业绩基数恒等于**档位小计**,券与定金都不减它 —— 这条是财务红线。 */
  check('⑦ 同技师的多张单业绩合并(技师甲 ¥1000)', rowA && rowA.perfCents === 100000, JSON.stringify((view.technicians || []).map((r) => [r.name, r.perfCents])))
  check('⑦ 另一技师不被串(技师乙 ¥0,他那张被撤回了)', !rowB || rowB.perfCents === 0, JSON.stringify(rowB && rowB.perfCents))
  check('⑦ 红线:券没减业绩(用券那张仍按档位小计 ¥200 计)', rowA.perfCents === 100000, String(rowA.perfCents))

  /* 跨零点单的自解释标注(店主 2026-08-10)。口径不变(签字时刻=记账时刻、按门店时区落自然日),
     但日结行必须说清这单是哪天的 —— 否则「台面本日休息、日结却有单」没人看得懂。 */
  const sameDay = (view.awaitingConfirm || []).concat(view.pendingAllocation || [])
  check('跨零点标注:当天做当天签的单**不加**多余标注',
    sameDay.every((x) => !x.crossDayNote), JSON.stringify(sameDay.map((x) => x.crossDayNote)))
  check('跨零点标注:字段随日结一起下发(前端不自己算日期)',
    sameDay.every((x) => Object.prototype.hasOwnProperty.call(x, 'crossDayNote')), JSON.stringify(sameDay[0] || {}).slice(0, 160))

  /* 顾客端更正卡(图 D1/D1b,2026-08-10 批图)。规则⓪:快照不可变、更正只追加显示;
     规则②:四要素 + 实际应付全部后端下发,**实际应付 ≡ 原单合计 + Σ差额**。 */
  const amendBk = await mkBooking('19:20', techA)
  const amendSheet = (await mkSheet(amendBk, techA)).data.settlements[0]
  await sign(amendSheet.code)
  const amdBefore = (await request(`/settlements/${amendSheet.code}`)).data.settlement
  check('D1 空态:没更正的普通单不出更正卡、不出徽标',
    amdBefore.amendments.length === 0 && amdBefore.amendBadgeText === '' && amdBefore.actualDueCents === amdBefore.totalCents,
    JSON.stringify({ n: amdBefore.amendments.length, b: amdBefore.amendBadgeText }))
  const snapBefore = raw(await request(`/settlements/${amendSheet.code}/snapshot`, {}, null))

  await request(`/admin/settlements/${amendSheet.id}/amend`, {
    method: 'POST', body: JSON.stringify({ totalCents: amendSheet.totalCents - 2000, reason: '技师少做了一项' })
  }, shop.token)
  await request(`/admin/settlements/${amendSheet.id}/amend`, {
    method: 'POST', body: JSON.stringify({ totalCents: amendSheet.totalCents + 3000, reason: '漏记加价项' })
  }, shop.token)
  const after = (await request(`/settlements/${amendSheet.code}`)).data.settlement
  check('D1b 多次更正:徽标带次数「已更正 ×2」', after.amendBadgeText === '已更正 ×2', after.amendBadgeText)
  check('D1b 按时间顺序,方向文案后端给(先退后补)',
    after.amendments.map((a) => a.directionText).join('/') === '退回差额/补收差额',
    JSON.stringify(after.amendments.map((a) => a.directionText)))
  check('D1 四要素齐:方向/±金额/原因原文/双时间戳',
    after.amendments.every((a) => a.directionText && a.deltaText && a.reason && a.raisedAtText && a.effectiveAtText),
    JSON.stringify(after.amendments[0]))
  check('D1 ±方向标对(退=refund 补=charge)',
    after.amendments[0].direction === 'refund' && after.amendments[1].direction === 'charge',
    JSON.stringify(after.amendments.map((a) => a.direction)))
  /* 🔴 财务红线:实际应付恒等于 原单合计 + Σ差额 */
  const sum = after.amendments.reduce((n, a) => n + a.amountDeltaCents, 0)
  check('D1b 红线:实际应付 ≡ 原单合计 + Σ差额',
    after.actualDueCents === after.totalCents + sum,
    JSON.stringify({ actual: after.actualDueCents, total: after.totalCents, sum }))
  check('D1 红线:更正**不改原单一个字节**(合计仍是原值)', after.totalCents === amdBefore.totalCents,
    JSON.stringify({ before: amdBefore.totalCents, after: after.totalCents }))
  const snapAfter = raw(await request(`/settlements/${amendSheet.code}/snapshot`, {}, null))
  check('D1 红线:更正不动签署快照(逐字节相同)', snapBefore === snapAfter && snapBefore.length > 0,
    `${snapBefore.length} vs ${snapAfter.length}`)
  // 边界:一正一负相抵回原值
  await request(`/admin/settlements/${amendSheet.id}/amend`, {
    method: 'POST', body: JSON.stringify({ totalCents: after.actualDueCents - 1000, reason: '再退 ¥10' })
  }, shop.token)
  const third = (await request(`/settlements/${amendSheet.code}`)).data.settlement
  check('D1b 边界:第三笔后恒等式仍成立',
    third.actualDueCents === third.totalCents + third.amendments.reduce((n, a) => n + a.amountDeltaCents, 0),
    JSON.stringify({ a: third.actualDueCents, t: third.totalCents }))

  console.log(`\n双单场景回归通过:${checks} 项断言全绿`)
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`)
  process.exit(1)
})
