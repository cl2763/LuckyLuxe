/* 结算单用券回归(2026-08-09,设计图《结算单用券》v3 规则⓪–⑥):
   ③ 恒等式含券:应收 ≡ 档位小计 − 定金 − 券;共优惠(含券)= 档位优惠 + 券;
      分成基数 ≡ 档位小计 —— **定金是付款时序、券是店铺让利,都不扣技师**(店主 08-09 拍板)
   ② 一单一张 / 门槛不满足 / 大类不匹配 / 过期 → 置灰并写清原因
   ① 代付单用**卡主**的券,被服务者的券不出现
   ⑤ 核销时序:签成才 used(签前一直 active,自动回到券包);更正退券留痕
   ⓪ 自定义发放仅老板可用(员工 403),发放记录只追加(禁删触发器)
   设计图算例:原价 680 / 档位小计 394 / 定金 100 / 券 30 → 应收 264,逐分复现 */
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

// 恒等式:手会算错,减法不会。每一处金额都用这四条验一遍
function assertMoney(label, s) {
  const coupon = s.couponDiscountCents || 0
  check(`${label}:档位优惠 ≡ 原价合计 − 档位小计`, s.tierDiscountCents === s.listTotalCents - s.subtotalCents,
    `${s.tierDiscountCents} vs ${s.listTotalCents} - ${s.subtotalCents}`)
  check(`${label}:共优惠(含券) ≡ 档位优惠 + 券`, s.discountTotalCents === s.tierDiscountCents + coupon,
    `${s.discountTotalCents} vs ${s.tierDiscountCents} + ${coupon}`)
  check(`${label}:应收 ≡ 档位小计 − 定金 − 券`, s.totalCents === s.subtotalCents - s.depositDeductCents - coupon,
    `${s.totalCents} vs ${s.subtotalCents} - ${s.depositDeductCents} - ${coupon}`)
  check(`${label}:分成基数 ≡ 档位小计(定金与券都不扣技师)`, s.perfBaseCents === s.subtotalCents,
    `${s.perfBaseCents} vs ${s.subtotalCents}`)
  // 无定金无券的单:基数就等于应收 —— 08-09 改口径对这种单逐分不变
  if (s.depositDeductCents === 0 && coupon === 0) {
    check(`${label}:无定金无券时基数 = 应收(改口径前后逐分不变)`, s.perfBaseCents === s.totalCents,
      `${s.perfBaseCents} vs ${s.totalCents}`)
  }
}

async function newShop(label) {
  const id = `cps-${label}-${RUN_ID}`
  const created = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id, name: `券店${label}${RUN_ID}`, plan: 'chain' }) })
  if (created.status !== 201) throw new Error(`建店失败: ${JSON.stringify(created.data)}`)
  const { username, initialPassword } = created.data.owner
  const first = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: initialPassword }) }, null)
  const pass = `Pw-${RUN_ID}-${label}9`
  await request('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: initialPassword, newPassword: pass, confirmPassword: pass }) }, first.data.auth.accessToken)
  const again = await request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: username, password: pass }) }, null)
  const token = again.data.auth.accessToken
  const unlock = await request('/admin/finance/unlock', { method: 'POST', body: JSON.stringify({ password: PLATFORM }) }, token)
  if (unlock.data?.financeKey) financeKeys.set(token, unlock.data.financeKey)
  return { tenantId: id, token, username }
}

async function main() {
  const shop = await newShop('a')
  check('临时店建好', Boolean(shop.token))

  // ---- 价目:与设计图算例一致(主项 604/358、补甲单指 38/18、免卸甲 0)----
  const catNail = (await request('/admin/pricing/categories', { method: 'POST', body: JSON.stringify({ key: 'nail_simple', name: '美甲简单款式' }) }, shop.token)).data.category
  const catLash = (await request('/admin/pricing/categories', { method: 'POST', body: JSON.stringify({ key: 'lash', name: '美睫' }) }, shop.token)).data.category
  const mk = async (body) => (await request('/admin/pricing/items', { method: 'POST', body: JSON.stringify(body) }, shop.token)).data.item
  const main3h = await mk({ nameZh: '简单款式 3 小时', type: 'NAIL', categoryId: catNail.id, itemKind: 'main', listPriceCents: 60400, memberPriceCents: 35800, baseDurationMin: 180 })
  const fiber = await mk({ nameZh: '纤维/甲片补甲', type: 'NAIL', categoryId: catNail.id, itemKind: 'addon', unit: 'per_finger', listPriceCents: 3800, memberPriceCents: 1800, addonScope: [catNail.id] })
  const freeRemoval = await mk({ nameZh: '本店制作免卸甲', type: 'NAIL', categoryId: catNail.id, itemKind: 'addon', listPriceCents: 0, memberPriceCents: 0, addonScope: [catNail.id] })
  check('价目按算例搭好', Boolean(main3h.id && fiber.id && freeRemoval.id))
  // 定金:固定 ¥100 且抵扣尾款
  await request('/admin/deposit-config', { method: 'PUT', body: JSON.stringify({ config: { enabled: true, deductible: true, mode: 'fixed', fixedAmountCents: 10000 } }) }, shop.token)

  // ---- 顾客(卡主 + 朋友)----
  const imp = await request(`/platform/tenants/${shop.tenantId}/import/customers`, {
    method: 'POST',
    body: JSON.stringify({
      dryRun: false,
      rows: [
        { name: `小红${RUN_ID}`, phone: `1386${RUN_ID.slice(-7)}`, balanceCents: 0 },
        { name: `阿雅${RUN_ID}`, phone: `1387${RUN_ID.slice(-7)}`, balanceCents: 0 }
      ]
    })
  })
  const cardOwner = imp.data.users[0].userId
  const friend = imp.data.users[1].userId
  check('两位顾客建档', Boolean(cardOwner && friend))
  const techA = (await request(`/platform/tenants/${shop.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: `小婕${RUN_ID}` }) })).data.technician
  const techB = (await request(`/platform/tenants/${shop.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: `翠花${RUN_ID}` }) })).data.technician

  // ---- 券模板:满300减30 / 满500减60 / 仅美睫体验券 ----
  const mkCoupon = async (body) => (await request('/admin/coupons', { method: 'POST', body: JSON.stringify(body) }, shop.token)).data.coupon
  const c300 = await mkCoupon({ name: '满300减30', amountCents: 3000, minSpendCents: 30000, validDays: 60 })
  const c500 = await mkCoupon({ name: '满500减60', amountCents: 6000, minSpendCents: 50000, validDays: 60 })
  check('券模板建好', Boolean(c300.id && c500.id))

  // ---- ⓪ 自定义发放:仅老板可用,原因必填 ----
  const noReason = await request('/admin/coupon-grants/custom', {
    method: 'POST', body: JSON.stringify({ userId: cardOwner, amountCents: 5000 })
  }, shop.token)
  check('⓪ 发放原因必填', noReason.status === 400 && noReason.data.error.code === 'REASON_REQUIRED', JSON.stringify(noReason.data))

  const special = await request('/admin/coupon-grants/custom', {
    method: 'POST',
    body: JSON.stringify({ userId: cardOwner, amountCents: 5000, minSpendCents: 0, validDays: 30, reason: '上次服务补偿', name: '¥50 无门槛' })
  }, shop.token)
  check('⓪ 老板可发特批券', special.status === 201 && special.data.granted.grantKind === 'custom', JSON.stringify(special.data))

  // 模板券也能从同一个入口指定发放(记发放人+原因)
  const byTemplate = await request('/admin/coupon-grants/custom', {
    method: 'POST', body: JSON.stringify({ userId: cardOwner, mode: 'template', couponId: c300.id, reason: '充值¥1000档' })
  }, shop.token)
  check('⓪ 同一入口可发现有券模板', byTemplate.status === 201 && byTemplate.data.granted.grantKind === 'template', JSON.stringify(byTemplate.data))
  // 门槛高的那张也发一张(用来验「未满 ¥500」的置灰原因)
  await request('/admin/coupon-grants/custom', { method: 'POST', body: JSON.stringify({ userId: cardOwner, mode: 'template', couponId: c500.id, reason: '活动' }) }, shop.token)
  // 仅美睫大类的券(验大类不匹配的置灰原因)
  const lashOnly = await request('/admin/coupon-grants/custom', {
    method: 'POST',
    body: JSON.stringify({ userId: cardOwner, amountCents: 8000, validDays: 30, scopeCategoryIds: [catLash.id], reason: '美睫体验', name: '美睫体验券' })
  }, shop.token)
  check('⓪ 可发限定大类的券', lashOnly.status === 201, JSON.stringify(lashOnly.data))
  // 朋友(被服务者)也有一张券 —— 它不该出现在卡主的选券面板里
  const friendGrant = await request('/admin/coupon-grants/custom', {
    method: 'POST', body: JSON.stringify({ userId: friend, amountCents: 9900, validDays: 30, reason: '朋友的券' })
  }, shop.token)
  check('⓪ 朋友也有一张券', friendGrant.status === 201)

  // 特批券模板不进券模板列表(否则模板区会被一次性券刷屏)
  const tpls = await request('/admin/coupons', {}, shop.token)
  check('⓪ 特批券不进券模板列表', tpls.data.coupons.every((c) => c.isCustom === false) && tpls.data.coupons.length === 2,
    JSON.stringify(tpls.data.coupons.map((c) => c.name)))

  /* 设计图算例要出「定金抵扣 ¥100」,而 v1.2 §五 补拍① 规定抵扣依据＝**收取记录**:
     所以先建一张预约并标记已收定金,试算时把 bookingId 带上 —— 光配定金规则不再产生抵扣行。 */
  const tech0 = (await request(`/platform/tenants/${shop.tenantId}/technicians`, { method: 'POST', body: JSON.stringify({ name: `算例师${RUN_ID}` }) })).data.technician
  const depBooking = (await request('/admin/bookings/direct', {
    method: 'POST',
    body: JSON.stringify({ userId: cardOwner, serviceId: main3h.id, technicianId: tech0.id, date: (await request('/admin/store-clock', {}, shop.token)).data.today, time: '14:10', durationMin: 60, depositPaid: false })
  }, shop.token)).data.booking
  await request(`/admin/bookings/${depBooking.id}/deposit-receipt`, { method: 'POST', body: JSON.stringify({}) }, shop.token)

  // ---- ② 选券面板:可用在上、不可用在下并写原因 ----
  const draft = {
    tierKey: 'member', userId: cardOwner, payerUserId: cardOwner, depositApplied: true, bookingId: depBooking.id,
    items: [{ serviceId: main3h.id }, { serviceId: fiber.id, fingers: 2 }, { serviceId: freeRemoval.id }]
  }
  const noCoupon = await request('/admin/settlements/preview', { method: 'POST', body: JSON.stringify(draft) }, shop.token)
  const base = noCoupon.data.settlement
  check('算例·原价合计 ¥680', base.listTotalCents === 68000, String(base.listTotalCents))
  check('算例·档位小计 ¥394', base.subtotalCents === 39400, String(base.subtotalCents))
  check('算例·定金抵扣 ¥100', base.depositDeductCents === 10000, String(base.depositDeductCents))
  check('未选券时应收 = 394 − 100 = ¥294', base.totalCents === 29400, String(base.totalCents))
  assertMoney('未选券', base)

  const opts = base.couponOptions
  const byName = (n) => opts.find((o) => o.name === n)
  check('② 满300减30 可用', byName('满300减30').usable === true, JSON.stringify(byName('满300减30')))
  check('② 未满门槛写清原因', byName('满500减60').usable === false && /未满/.test(byName('满500减60').reason), byName('满500减60').reason)
  check('② 大类不匹配写清原因', byName('美睫体验券').usable === false && /仅适用/.test(byName('美睫体验券').reason), byName('美睫体验券').reason)
  check('① 朋友的券不出现在卡主券包里', !opts.some((o) => o.grantId === friendGrant.data.granted.id), JSON.stringify(opts.map((o) => o.name)))
  check('② 券包给的是后端算好的抵扣额', byName('满300减30').discountCents === 3000, String(byName('满300减30').discountCents))

  // ---- ③ 设计图算例:选上满300减30 → 应收 ¥264 ----
  const withCoupon = await request('/admin/settlements/preview', {
    method: 'POST', body: JSON.stringify({ ...draft, couponGrantId: byName('满300减30').grantId })
  }, shop.token)
  const w = withCoupon.data.settlement
  check('③ 算例逐分复现:680 / 394 / 定金100 / 券30 → 应收 ¥264', w.totalCents === 26400, String(w.totalCents))
  check('③ 共优惠(含券) = ¥316', w.discountTotalCents === 31600, String(w.discountTotalCents))
  check('③ 券抵扣 ¥30 单列', w.couponDiscountCents === 3000, String(w.couponDiscountCents))
  check('③ 分成基数 ¥394 = 档位小计(定金与券都不扣技师)', w.perfBaseCents === 39400, String(w.perfBaseCents))
  assertMoney('选券后', w)

  // 用不了的券:严格模式下正式开单直接拒(不悄悄按无券算)
  const badCreate = await request('/admin/settlements', {
    method: 'POST',
    body: JSON.stringify({
      cardOwnerUserId: cardOwner,
      settlements: [{ ...draft, couponGrantId: byName('满500减60').grantId, technicians: [{ technicianId: techA.id, role: 'main', itemNos: [1] }] }]
    })
  }, shop.token)
  check('② 用不了的券开单直接拒(不悄悄按无券算)', badCreate.status === 400 && badCreate.data.error.code === 'COUPON_UNUSABLE', JSON.stringify(badCreate.data))

  // ---- 正式开单(两张:卡主本人 + 代付朋友)----
  const grant300 = byName('满300减30').grantId
  const group = await request('/admin/settlements', {
    method: 'POST',
    body: JSON.stringify({
      cardOwnerUserId: cardOwner,
      settlements: [
        {
          ...draft,
          couponGrantId: grant300,
          technicians: [{ technicianId: techA.id, role: 'main', itemNos: [1, 3] }, { technicianId: techB.id, role: 'assist', itemNos: [2] }]
        },
        { tierKey: 'member', servedPersonName: '朋友', items: [{ serviceId: main3h.id }], technicians: [{ technicianId: techA.id, role: 'main', itemNos: [1] }] }
      ]
    })
  }, shop.token)
  check('开单成功(2 张)', group.status === 201 && group.data.sheetCount === 2, JSON.stringify(group.data).slice(0, 200))
  const [sheet1, sheet2] = group.data.settlements
  check('券信息落库', sheet1.coupon && sheet1.coupon.name === '满300减30' && sheet1.couponDiscountCents === 3000, JSON.stringify(sheet1.coupon))
  check('店员代选留了标记', sheet1.coupon.selectedBy === 'staff', sheet1.coupon.selectedBy)
  assertMoney('落库单据1', sheet1)
  assertMoney('落库单据2(代付,无券)', sheet2)

  // ---- ② 一单一张:同一张券不能再挂到第二张单 ----
  const dup = await request(`/admin/settlements/${sheet2.id}/coupon`, { method: 'POST', body: JSON.stringify({ grantId: grant300 }) }, shop.token)
  check('② 一单一张:同一张券不能挂两张单', dup.status === 400 && /一单一张/.test(dup.data.error.message), JSON.stringify(dup.data))

  // 已挂在别的单上的券,在这张单的券包里就该是置灰的(而不是点下去才报错)
  const packOnSheet2 = await request(`/settlements/${sheet2.code}`, {}, null)
  const heldOpt = packOnSheet2.data.coupons.options.find((o) => o.grantId === grant300)
  check('② 别的单占用中的券在面板上就置灰并写原因', heldOpt && heldOpt.usable === false && /一单一张/.test(heldOpt.reason), JSON.stringify(heldOpt && heldOpt.reason))

  // ---- ⑤ 签字前券一直是 active(退出/改单自动回券包)----
  const grantsMid = await request('/admin/coupon-grants', {}, shop.token)
  const g300Mid = grantsMid.data.grants.find((g) => g.id === grant300)
  check('⑤ 签字前券仍在券包里(active)', g300Mid.status === 'active' && !g300Mid.settlementCode, JSON.stringify(g300Mid.status))

  // ---- ① 代付单选券:用的是卡主的券,不是被服务者的 ----
  const proxyPick = await request(`/admin/settlements/${sheet2.id}/coupon`, {
    method: 'POST', body: JSON.stringify({ grantId: special.data.granted.id })
  }, shop.token)
  check('① 代付单可用卡主的特批券', proxyPick.status === 200 && proxyPick.data.settlement.couponDiscountCents === 5000, JSON.stringify(proxyPick.data.settlement.coupon))
  const proxyFriend = await request(`/admin/settlements/${sheet2.id}/coupon`, {
    method: 'POST', body: JSON.stringify({ grantId: friendGrant.data.granted.id })
  }, shop.token)
  check('① 代付单不能用被服务者的券', proxyFriend.status === 400, JSON.stringify(proxyFriend.data))
  // 收回来,后面的断言按无券走
  await request(`/admin/settlements/${sheet2.id}/coupon`, { method: 'POST', body: JSON.stringify({ grantId: '' }) }, shop.token)

  // ---- ④ 顾客签署页:签字前可换券,金额后端重算 ----
  const pub = await request(`/settlements/${sheet1.code}`, {}, null)
  check('④ 签署页随单下发券包', Array.isArray(pub.data.coupons.options) && pub.data.coupons.selectedGrantId === grant300, JSON.stringify(pub.data.coupons.selectedGrantId))
  check('④ 签署页标出店员已代选', pub.data.settlement.coupon.selectedBy === 'staff')
  const swap = await request(`/settlements/${sheet1.code}/coupon`, { method: 'POST', body: JSON.stringify({ grantId: special.data.granted.id }) }, null)
  check('④ 顾客换成 ¥50 特批券,应收由后端重算为 ¥244', swap.status === 200 && swap.data.settlement.totalCents === 24400, String(swap.data.settlement.totalCents))
  assertMoney('顾客换券后', swap.data.settlement)
  const clear = await request(`/settlements/${sheet1.code}/coupon`, { method: 'POST', body: JSON.stringify({ grantId: '' }) }, null)
  check('④ 顾客可取消用券,应收回到 ¥294', clear.status === 200 && clear.data.settlement.totalCents === 29400, String(clear.data.settlement.totalCents))
  const back = await request(`/settlements/${sheet1.code}/coupon`, { method: 'POST', body: JSON.stringify({ grantId: grant300 }) }, null)
  check('④ 再选回满300减30 → ¥264', back.status === 200 && back.data.settlement.totalCents === 26400, String(back.data.settlement.totalCents))

  // ---- ⑤ 签字那一刻才核销 ----
  const signed = await request(`/settlements/${sheet1.code}/sign`, {
    method: 'POST',
    body: JSON.stringify({ disclaimerAccepted: true, signature: '小红', strokes: [[{ x: 10, y: 60 }, { x: 60, y: 20 }]] })
  }, null)
  check('签字成功', signed.status === 200 && signed.data.settlement.status === 'signed', JSON.stringify(signed.data).slice(0, 200))
  const grantsAfter = await request('/admin/coupon-grants', {}, shop.token)
  const g300After = grantsAfter.data.grants.find((g) => g.id === grant300)
  check('⑤ 签成才核销:状态 used + 关联单号', g300After.status === 'used' && g300After.settlementCode === sheet1.code, JSON.stringify({ s: g300After.status, c: g300After.settlementCode }))
  check('⑤ 核销写进券流水(只追加)', g300After.logs.some((l) => l.action === 'redeemed' && l.settlementCode === sheet1.code), JSON.stringify(g300After.logs))

  // ---- ④ 签后锁定:券不能再改 ----
  const afterSign = await request(`/settlements/${sheet1.code}/coupon`, { method: 'POST', body: JSON.stringify({ grantId: '' }) }, null)
  check('④ 签字后券锁定,不能再改', afterSign.status === 400 && afterSign.data.error.code === 'ALREADY_SIGNED', JSON.stringify(afterSign.data))
  const pubSigned = await request(`/settlements/${sheet1.code}`, {}, null)
  check('④ 已签单不再下发券包', pubSigned.data.coupons === null)

  // ---- 快照上有券行,且与所签构成一致 ----
  // 真机 SVG 空白件后:出图是 PNG,内容层断言走原文口 ?format=svg(引擎产物不变)
  const snap = await request(`/settlements/${sheet1.code}/snapshot?format=svg`, {}, null)
  const svg = String(snap.data && snap.data.raw ? snap.data.raw : '')
  // D65 改版:快照=一条五步账,券行句式「优惠券抵扣(名称) −X」(flow 块后端句)
  check('快照 SVG 上有优惠券行', /优惠券抵扣\(满300减30\)/.test(svg), svg.slice(0, 120))
  check('快照共优惠标注含券', /共优惠（含券）/.test(svg) || /共优惠\(含券\)/.test(svg), svg.slice(0, 120))

  // ---- ③ 业绩口径:分成按 perfBase(券不扣技师)----
  const badShare = await request(`/admin/settlements/${sheet1.id}/allocate`, {
    method: 'POST', body: JSON.stringify({ shares: [{ technicianId: techA.id, shareCents: 26400 }, { technicianId: techB.id, shareCents: 0 }] })
  }, shop.token)
  check('③ 分成合计按业绩基数校验(应收 ≠ 基数时直接拒)', badShare.status === 400 && badShare.data.error.code === 'SHARE_MISMATCH', JSON.stringify(badShare.data))
  const alloc = await request(`/admin/settlements/${sheet1.id}/allocate`, {
    method: 'POST', body: JSON.stringify({ shares: [{ technicianId: techA.id, pct: 70 }, { technicianId: techB.id, pct: 30 }] })
  }, shop.token)
  check('③ 按比例分成成功', alloc.status === 200, JSON.stringify(alloc.data).slice(0, 200))
  const sum = alloc.data.shares.reduce((n, s) => n + s.shareCents, 0)
  check('③ 分成合计 = 业绩基数 ¥394(不是应收 ¥264,也不是扣了定金的 ¥294)', sum === 39400, String(sum))

  // ---- ⓪ 员工端整区 403 ----
  const staffAcc = await request('/admin/staff-accounts', {
    method: 'POST', body: JSON.stringify({ technicianId: techB.id })
  }, shop.token)
  const staffUser = staffAcc.data && (staffAcc.data.account || staffAcc.data)
  const staffLogin = await request('/admin/auth/login', {
    method: 'POST', body: JSON.stringify({ email: staffUser.username, password: staffUser.initialPassword })
  }, null)
  const staffToken = staffLogin.data?.auth?.accessToken
  check('员工账号可登录', Boolean(staffToken), JSON.stringify(staffLogin.data).slice(0, 200))
  const staffList = await request('/admin/coupon-grants', {}, staffToken)
  check('⓪ 员工看不到发放记录(403)', staffList.status === 403, String(staffList.status))
  const staffGrant = await request('/admin/coupon-grants/custom', {
    method: 'POST', body: JSON.stringify({ userId: cardOwner, amountCents: 100000, reason: '试试' })
  }, staffToken)
  check('⓪ 员工不能发券(403)', staffGrant.status === 403, String(staffGrant.status))

  // ---- ⑤ 更正退券:原单不动,券回券包,留痕 ----
  const amend = await request(`/admin/settlements/${sheet1.id}/amend`, {
    method: 'POST', body: JSON.stringify({ totalCents: 29400, reason: '券用错了,退回顾客券包', releaseCoupon: true })
  }, shop.token)
  check('⑤ 更正可退券', amend.status === 200 && amend.data.couponReleased === true, JSON.stringify(amend.data).slice(0, 200))
  const grantsRel = await request('/admin/coupon-grants', {}, shop.token)
  const g300Rel = grantsRel.data.grants.find((g) => g.id === grant300)
  check('⑤ 退券后回到券包(active)', g300Rel.status === 'active' && !g300Rel.settlementCode, JSON.stringify(g300Rel.status))
  check('⑤ 退券留痕', g300Rel.logs.some((l) => l.action === 'released'), JSON.stringify(g300Rel.logs.map((l) => l.action)))
  const stillSigned = await request(`/settlements/${sheet1.code}`, {}, null)
  check('⑤ 原签署单一分没动(已签不可改)', stillSigned.data.settlement.totalCents === 26400 && stillSigned.data.settlement.couponDiscountCents === 3000,
    JSON.stringify({ t: stillSigned.data.settlement.totalCents, c: stillSigned.data.settlement.couponDiscountCents }))

  // ---- 审计只追加:发放记录与券流水都禁删 ----
  const del = await request(`/admin/coupon-grants/${grant300}/revoke`, { method: 'POST', body: JSON.stringify({ reason: '' }) }, shop.token)
  check('⓪ 作废原因必填', del.status === 400 && del.data.error.code === 'REASON_REQUIRED', JSON.stringify(del.data))
  const revoke = await request(`/admin/coupon-grants/${grant300}/revoke`, { method: 'POST', body: JSON.stringify({ reason: '重复补偿,作废' }) }, shop.token)
  check('⓪ 作废成功且留痕', revoke.status === 200)
  const grantsRev = await request('/admin/coupon-grants', {}, shop.token)
  const g300Rev = grantsRev.data.grants.find((g) => g.id === grant300)
  check('⓪ 作废是留痕不是删除(记录还在)', g300Rev.status === 'revoked' && g300Rev.revokeReason === '重复补偿,作废', JSON.stringify(g300Rev.status))
  check('⓪ 券流水按动作全程留痕', ['granted', 'redeemed', 'released', 'revoked'].every((a) => g300Rev.logs.some((l) => l.action === a)),
    JSON.stringify(g300Rev.logs.map((l) => l.action)))

  // 数据库层禁删(不靠人记纪律)
  const { DatabaseSync } = await import('node:sqlite')
  const dbPath = process.env.TEST_DB_PATH || `${process.env.DATA_DIR || './local-data'}/lucky-luxe.sqlite`
  const rawDb = new DatabaseSync(dbPath)
  let deleteBlocked = false
  try { rawDb.prepare('DELETE FROM coupon_grants WHERE id = ?').run(grant300) } catch { deleteBlocked = true }
  let logDeleteBlocked = false
  try { rawDb.prepare('DELETE FROM coupon_grant_logs WHERE grant_id = ?').run(grant300) } catch { logDeleteBlocked = true }
  rawDb.close()
  check('⓪ 发放记录数据库层禁删', deleteBlocked)
  check('⓪ 券流水数据库层禁删', logDeleteBlocked)

  // ---- 财务:月度券让利汇总(特批 / 系统)----
  const fin = await request('/admin/finance/coupon-discounts', {}, shop.token)
  check('财务月度券让利汇总可取', fin.status === 200, JSON.stringify(fin.data).slice(0, 200))
  check('券让利合计 = 已签单上实际抵掉的 ¥30', fin.data.couponDiscounts.totalCents === 3000, String(fin.data.couponDiscounts.totalCents))
  check('券让利按特批/系统拆栏', fin.data.couponDiscounts.templateCents === 3000 && fin.data.couponDiscounts.customCents === 0,
    JSON.stringify(fin.data.couponDiscounts))

  // ---- 过期券:置灰并写原因 ----
  const expired = await request('/admin/coupon-grants/custom', {
    method: 'POST', body: JSON.stringify({ userId: cardOwner, amountCents: 1000, validDays: 1, reason: '马上过期的券' })
  }, shop.token)
  const rawDb2 = new (await import('node:sqlite')).DatabaseSync(dbPath)
  rawDb2.prepare('UPDATE coupon_grants SET expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', expired.data.granted.id)
  rawDb2.close()
  const afterExpire = await request('/admin/settlements/preview', { method: 'POST', body: JSON.stringify(draft) }, shop.token)
  const expOpt = afterExpire.data.settlement.couponOptions.find((o) => o.grantId === expired.data.granted.id)
  check('② 过期券置灰并写原因', expOpt && expOpt.usable === false && /过期/.test(expOpt.reason), JSON.stringify(expOpt))

  console.log(`\n结算单用券回归通过:${checks} 项断言全绿`)
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`)
  process.exit(1)
})
