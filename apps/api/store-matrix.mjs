/* 店群陪审团 · 编造店配置矩阵(店主 08-30d 批次八)。
   一份矩阵两处用(公约④):CI 套件 test-store-jury 与 沙箱铺群脚本 —— 不许各写一份。
   维度:币种 × 营业时间(正常/未设置/七天全关/今天特殊休)× 次卡/会员套餐 × 客户量 × 技师数。 */

export const JURY_MATRIX = (() => {
  const list = []
  /* 三币种 × 满配/素配 */
  for (const cur of ['CAD', 'CNY', 'USD']) {
    list.push({ key: `full-${cur.toLowerCase()}`, name: `陪审满配店${cur}`, currency: cur, hours: 'set', techs: 3, customers: 3, timecardPkg: true, rechargePkg: true, bookings: 2 })
    list.push({ key: `basic-${cur.toLowerCase()}`, name: `陪审素配店${cur}`, currency: cur, hours: 'set', techs: 1, customers: 3, timecardPkg: false, rechargePkg: false, bookings: 1 })
  }
  /* 特征店(指令点名的形态) */
  list.push({ key: 'unset-hasbooking', name: '陪审未设置店甲', currency: 'CAD', hours: 'unset', techs: 1, customers: 1, bookings: 1 })   // D84 态A:没设置但有单
  list.push({ key: 'unset-empty', name: '陪审未设置店乙', currency: 'CNY', hours: 'unset', techs: 0, customers: 0, bookings: 0 })
  list.push({ key: 'allclosed-legacy', name: '陪审七天全关店', currency: 'CAD', hours: 'allclosed', techs: 1, customers: 1, bookings: 0 })  // 老库遗留形态=统一判定下的未设置
  list.push({ key: 'closed-today', name: '陪审今日特休店', currency: 'CNY', hours: 'closedtoday', techs: 2, customers: 2, bookings: 0 })
  list.push({ key: 'zero-customer', name: '陪审零客店', currency: 'CAD', hours: 'set', techs: 2, customers: 0, bookings: 0 })
  list.push({ key: 'big-customer', name: '陪审大客量店', currency: 'CAD', hours: 'set', techs: 3, customers: 40, bookings: 6 })
  list.push({ key: 'tc-only', name: '陪审只有次卡店', currency: 'CNY', hours: 'set', techs: 1, customers: 2, timecardPkg: true, rechargePkg: false, bookings: 1 })
  list.push({ key: 'member-only', name: '陪审只有会员店', currency: 'CAD', hours: 'set', techs: 1, customers: 2, timecardPkg: false, rechargePkg: true, bookings: 1 })
  /* 组合补位(拉到几十家):币种 × 套餐有无 × 单/多技师 */
  let i = 0
  for (const cur of ['CAD', 'CNY']) for (const pkg of [true, false]) for (const techs of [1, 3]) {
    i += 1
    list.push({ key: `combo-${i}`, name: `陪审组合店${i}`, currency: cur, hours: 'set', techs, customers: 2, timecardPkg: pkg, rechargePkg: !pkg, bookings: 1 })
  }
  return list
})()

/* 建一家矩阵店(request = 各端各自的请求函数;idPrefix 防撞) */
export async function buildJuryStore(request, spec, idPrefix, dbExec) {
  const tid = `${idPrefix}-${spec.key}`
  const mk = await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: tid, name: spec.name, plan: 'chain', currency: spec.currency, timezone: spec.currency === 'CNY' ? 'Asia/Shanghai' : 'America/Toronto' }) })
  if (mk.status !== 201) throw new Error(`建店失败 ${tid}: ${JSON.stringify(mk.data).slice(0, 120)}`)
  const H = { 'x-admin-tenant-id': tid, 'x-tenant-id': tid }
  const week = (mkDay) => [0, 1, 2, 3, 4, 5, 6].map(mkDay)
  if (spec.hours === 'set' || spec.hours === 'closedtoday') {
    await request('/admin/business-hours', { method: 'PUT', body: JSON.stringify({ hours: week((w) => (w === 1 ? { weekday: w, isClosed: true } : { weekday: w, openTime: '10:00', closeTime: '20:00', isClosed: false })) }) }, H)
  }
  if (spec.hours === 'allclosed' && dbExec) {
    /* 七天全关=老库遗留形态,PUT 会被 A2 终闸拒(它就该拒)—— 直插测试库摆出病态 */
    dbExec(tid)
  }
  const today = (await request('/admin/store-clock', {}, H)).data.today
  if (spec.hours === 'closedtoday') {
    await request('/admin/special-dates', { method: 'POST', body: JSON.stringify({ date: today, isClosed: true, note: '陪审特休' }) }, H)
  }
  const techs = []
  for (let i = 0; i < (spec.techs || 0); i += 1) {
    techs.push((await request('/admin/technicians', { method: 'POST', body: JSON.stringify({ name: `陪技${i + 1}`, isActive: true }) }, H)).data.technician)
  }
  const catId = ((await request('/admin/pricing/categories', {}, H)).data.categories || [])[0]?.id
  const svc = (await request('/admin/services', { method: 'POST', body: JSON.stringify({ type: 'NAIL', nameZh: '陪审项目', nameEn: 'jury', priceCents: 12800, baseDurationMin: 60, categoryId: catId }) }, H)).data.service
  let users = []
  if (spec.customers > 0) {
    const rows = Array.from({ length: spec.customers }, (_, k) => ({ name: `陪客${k + 1}`, phone: `13${String(900000000 + k)}` }))
    const imp = await request(`/platform/tenants/${tid}/import/customers`, { method: 'POST', body: JSON.stringify({ dryRun: false, rows }) })
    users = (imp.data.users || []).map((u) => u.userId)
  }
  if (spec.timecardPkg) await request('/admin/packages', { method: 'POST', body: JSON.stringify({ kind: 'times', name: '陪审十次卡', priceCents: 66000, timesCount: 10 }) }, H)
  if (spec.rechargePkg) await request('/admin/packages', { method: 'POST', body: JSON.stringify({ kind: 'recharge', name: '陪审充300赠30', priceCents: 30000, bonusCents: 3000 }) }, H)
  let made = 0
  for (let b = 0; b < (spec.bookings || 0) && users.length && techs.length; b += 1) {
    const r = await request('/admin/bookings/direct', { method: 'POST', body: JSON.stringify({ userId: users[b % users.length], serviceId: svc?.id, technicianId: techs[b % techs.length].id, date: today, time: `${String(9 + b).padStart(2, '0')}:00`, durationMin: 60 }) }, H)
    if (r.status === 201) made += 1
  }
  return { tid, spec, users, techs: techs.map((t) => t.id), serviceId: svc?.id, bookingsMade: made }
}
