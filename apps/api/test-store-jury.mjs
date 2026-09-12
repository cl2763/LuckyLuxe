/* 店群陪审团(店主 08-30d 批次八):关键断言逐店迭代 —— 一家红整批红。

   店铺集合**运行时从库取**(不许写死清单):跑到本套件时,库里有本套件按矩阵新建的
   几十家编造店 + 前面全部套件留下的各态店(它们的千奇百怪正是陪审价值)。
   每店过不变量组 I1-I6(任何配置都必须成立的事实);矩阵店另按各自特征加验。

   ⚠️ standalone:CI_SUITES="store-jury" bash apps/api/run-all-tests.sh */
import { assertTestTarget } from './test-guard.mjs'
import { DatabaseSync } from 'node:sqlite'
import { JURY_MATRIX, buildJuryStore } from './store-matrix.mjs'
/* 07f §五 批量切:token 改成问 helper 要(试点形状,见 owner-token.mjs) */
const { requireOwnerToken } = await import('./owner-token.mjs')

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
await assertTestTarget(BASE_URL)
const PLATFORM = process.env.TEST_ADMIN_TOKEN || requireOwnerToken()
const RUN = Date.now().toString(36)

let checks = 0
function check(name, cond, detail = '') {
  checks += 1
  if (!cond) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}
async function request(path, options = {}, extra = {}) {
  const r = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${PLATFORM}`, ...extra, ...(options.headers || {}) }
  })
  const text = await r.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: r.status, data }
}
const db = new DatabaseSync(process.env.TEST_DB_PATH || (() => { throw new Error('需要 TEST_DB_PATH') })())

/* ===== ① 按矩阵建店(共享矩阵模块 —— 与沙箱铺群同一份) ===== */
const built = []
for (const spec of JURY_MATRIX) {
  built.push(await buildJuryStore(request, spec, `jury${RUN.slice(-4)}`, (tid) => {
    const sid = db.prepare('SELECT id FROM stores WHERE tenant_id = ? LIMIT 1').get(tid)?.id
    if (!sid) return
    const ins = db.prepare("INSERT OR REPLACE INTO business_hours (store_id, weekday, open_time, close_time, is_closed, tenant_id) VALUES (?, ?, '00:00', '00:00', 1, ?)")
    for (let w = 0; w <= 6; w += 1) ins.run(sid, w, tid)
  }))
}
check(`① 矩阵建店 ${JURY_MATRIX.length} 家(几十家编造店,币种/时段/套餐/客量/技师全拉开)`, built.length >= 20, String(built.length))

/* ===== ② 店铺集合=运行时从库取(含全部前序套件的店) ===== */
const allTenants = db.prepare(`SELECT t.id FROM tenants t WHERE EXISTS (SELECT 1 FROM stores s WHERE s.tenant_id = t.id AND s.is_active = 1)`).all().map((r) => r.id)
check(`② 运行时店铺集合 ≥ 矩阵数(现取 ${allTenants.length} 家,零硬编码清单)`, allTenants.length >= JURY_MATRIX.length, String(allTenants.length))

/* ===== ③ 不变量组逐店迭代(一家红整批红:check 抛错即带店名) ===== */
const CUR_PREFIX = { CAD: 'CAD $', CNY: '¥', USD: 'US $' }
let iterated = 0
for (const tid of allTenants) {
  const H = { 'x-admin-tenant-id': tid, 'x-tenant-id': tid }
  const label = `[${tid}]`
  /* I1 旗标↔库相符 */
  const me = await request('/admin/auth/me', {}, H)
  if (me.status !== 200) throw new Error(`${label} auth/me ${me.status}`)
  const sid = db.prepare('SELECT id FROM stores WHERE tenant_id = ? AND is_active = 1 LIMIT 1').get(tid)?.id
  const hasOpen = sid ? Boolean(db.prepare("SELECT 1 FROM business_hours WHERE store_id = ? AND is_closed = 0 LIMIT 1").get(sid)) : false
  if (me.data.hoursUnset !== !hasOpen) throw new Error(`${label} I1 hoursUnset=${me.data.hoursUnset} 与库(open=${hasOpen})不符`)
  /* I2 台面三态 + storeNow */
  const today = (await request('/admin/store-clock', {}, H)).data.today
  const day = await request(`/admin/schedule-day?date=${today}`, {}, H)
  if (day.status !== 200) throw new Error(`${label} schedule-day ${day.status}`)
  if (day.data.hoursUnset && day.data.isClosed) throw new Error(`${label} I2 未设置却显休息(D84 复活)`)
  if (!/^\d{2}:\d{2}$/.test(day.data.storeNow || '')) throw new Error(`${label} I2 storeNow 缺(${day.data.storeNow})`)
  /* I3 币种句一致:business-hours 下发币种 + 该店任一 facts 金额句前缀相符 */
  const bh = await request('/admin/business-hours', {}, H)
  if (bh.status !== 200 || !(bh.data.stores || []).length) throw new Error(`${label} I3 business-hours ${bh.status}`)
  /* I4 日结读 + 抽屉损益恒 0 */
  const dc = await request(`/admin/daily-close?date=${today}`, {}, H)
  if (dc.status !== 200) throw new Error(`${label} I4 daily-close ${dc.status}`)
  if (dc.data.dailyClose.cashDrawer.incomeImpactCents !== 0) throw new Error(`${label} I4 抽屉动了损益`)
  /* I5 多租户隔离:拿别家顾客 id 来查 → 必须「不属于本店」 */
  const foreign = db.prepare('SELECT id FROM users WHERE tenant_id != ? LIMIT 1').get(tid)
  if (foreign) {
    const lk = await request(`/admin/customers/lookup?userId=${encodeURIComponent(foreign.id)}`, {}, H)
    if (lk.status !== 200 || lk.data.hit !== null) throw new Error(`${label} I5 隔离破:别家顾客查出 hit=${JSON.stringify(lk.data.hit).slice(0, 60)}`)
  }
  /* I6 账调 facts(本店有顾客才验):balance ≡ 库内该客储值行合计。
     🔴 挨刀咬出的抽样盲:随手抽第一位顾客,有冲销行的那位永远抽不到 —— 判据要抽**最可能露馅**的:
     优先抽带 reversal 行的顾客,其次带任何储值行的,最后才随便一位(反例数据律进抽样) */
  const own = db.prepare(`SELECT u.id FROM users u WHERE u.tenant_id = ?
      ORDER BY (SELECT COUNT(*) FROM stored_value_transactions s WHERE s.user_id = u.id AND s.type = 'reversal') DESC,
               (SELECT COUNT(*) FROM stored_value_transactions s WHERE s.user_id = u.id) DESC
      LIMIT 1`).get(tid)
  if (own) {
    const f = await request(`/admin/account-adjust/facts?userId=${encodeURIComponent(own.id)}`, {}, H)
    if (f.status !== 200) throw new Error(`${label} I6 facts ${f.status}`)
    const truth = db.prepare('SELECT COALESCE(SUM(amount_cents),0) n FROM stored_value_transactions WHERE tenant_id = ? AND user_id = ?').get(tid, own.id).n
    if (f.data.facts.balanceCents !== truth) throw new Error(`${label} I6 余额句 ${f.data.facts.balanceCents} ≠ 库真值 ${truth}`)
  }
  /* I7 通知域(P3,08-30g):逐店三守 —— 队列行零串店 / 状态全在状态机集合内 /
     FAILED 必带 fail_reason(静默失败器零容忍在每一家店都成立,不只样板店)。
     串店按**机制**定义(L2 类按机制不按长相):任务租户 ≡ 来源实体租户 ——
     带 booking 的对 bookings.tenant_id,扫描类对 users.tenant_id。
     第一版直接对 users 全量比,被 deposit-config 夹具咬红:顾客走全局注册口(无租户头)落旗舰、
     再带 x-tenant-id 在 p12 店下单 —— 既有身份模型现实(跨店身份归 identity_links 域),
     预约在本店、任务就该在本店,不算通知域串店;已在回执登记该观察。 */
  const NOTIFY_TYPES7 = ['booking_created', 'booking_rescheduled', 'booking_cancelled', 'arrival_reminder', 'card_expiring', 'birthday', 'revisit', 'coupon_expiring']
  const ph7 = NOTIFY_TYPES7.map(() => '?').join(',')
  const crossBk = db.prepare(`SELECT COUNT(*) AS n FROM reminder_tasks t JOIN bookings b ON b.id = t.booking_id
    WHERE t.tenant_id = ? AND t.type IN (${ph7}) AND b.tenant_id != ?`).get(tid, ...NOTIFY_TYPES7, tid).n
  if (crossBk !== 0) throw new Error(`${label} I7 通知队列串店:${crossBk} 行的预约属于别家店`)
  const crossScan = db.prepare(`SELECT COUNT(*) AS n FROM reminder_tasks t JOIN users u ON u.id = t.user_id
    WHERE t.tenant_id = ? AND t.booking_id IS NULL AND t.type IN (${ph7}) AND u.tenant_id != ?`).get(tid, ...NOTIFY_TYPES7, tid).n
  if (crossScan !== 0) throw new Error(`${label} I7 通知队列串店:${crossScan} 条扫描任务指向别家顾客`)
  const badState = db.prepare(`SELECT COUNT(*) AS n FROM reminder_tasks WHERE tenant_id = ? AND type IN (${ph7})
    AND status NOT IN ('PENDING','SENT','FAILED','CANCELLED')`).get(tid, ...NOTIFY_TYPES7).n
  if (badState !== 0) throw new Error(`${label} I7 通知状态越出状态机:${badState} 行`)
  const dumbFail = db.prepare(`SELECT COUNT(*) AS n FROM reminder_tasks WHERE tenant_id = ? AND type IN (${ph7})
    AND status = 'FAILED' AND (fail_reason IS NULL OR fail_reason = '')`).get(tid, ...NOTIFY_TYPES7).n
  if (dumbFail !== 0) throw new Error(`${label} I7 FAILED 无原因(吞了):${dumbFail} 行`)
  /* I8 可见档库值(31k 裁定二主件):staff_visibility 存了就必须 ∈ 三枚 —— 写口 400 挡 API,
     这条守直写库的坏值(读口回落会把坏态吞成默认档,warn 只留痕,升面见红靠这里) */
  const visRow = db.prepare("SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = 'staff_visibility'").get(tid)
  if (visRow) {
    const v = String(visRow.value || '').replace(/"/g, '')
    if (!['perf_only', 'perf_and_salary', 'salary_only'].includes(v)) {
      throw new Error(`${label} I8 可见档库值非法:「${String(visRow.value).slice(0, 40)}」不在三枚内`)
    }
  }
  /* I9 值日域(31l):标记只许指向本店技师;开关值只许 '0'/'1' */
  const badDuty = db.prepare(`SELECT COUNT(*) AS n FROM duty_marks m WHERE m.tenant_id = ?
    AND NOT EXISTS (SELECT 1 FROM technicians t2 WHERE t2.id = m.technician_id AND t2.tenant_id = ?)`).get(tid, tid).n
  if (badDuty !== 0) throw new Error(`${label} I9 值日标记指向别家/不存在的技师:${badDuty} 行`)
  const dutyVal = db.prepare("SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = 'duty_enabled'").get(tid)
  if (dutyVal && !['0', '1'].includes(String(dutyVal.value).replace(/"/g, ''))) {
    throw new Error(`${label} I9 值日开关值非法:「${String(dutyVal.value).slice(0, 20)}」`)
  }
  /* I10 补录域(01v 小合同五):已日结那天**永不**再冒出新单 —— 补录该落今天。
     判据是事实级的:任一已确认日,若存在 backfill 单把预约日也落在该日 → 红。 */
  const badBackfill = db.prepare(`SELECT COUNT(*) AS n FROM bookings b
    WHERE b.tenant_id = ? AND b.backfill_service_date IS NOT NULL
      AND date(b.appointment_start) = b.backfill_service_date
      AND EXISTS (SELECT 1 FROM daily_closes c WHERE c.tenant_id = b.tenant_id
                  AND c.date = b.backfill_service_date AND c.status = 'confirmed')`).get(tid).n
  if (badBackfill !== 0) throw new Error(`${label} I10 补录写回了已日结的那天(历史账被回改):${badBackfill} 行`)
  /* I11 已日结日封口(01w 裁③,D102 护栏):**任何路径**往「过去的已日结日」写新单 → 红。
     判据带界定,只打真目标:
       · 写入日 > 服务日 = 往回写(补录口/将来别处任何写口)—— 这才是钱的漏洞
       · 写入日 = 服务日(当天日结后又来加钟客)**不算** —— 现实合法,由 R1「数字已过期」兜住
     防的是将来别处再开一个绕过 backfillPlanFor 归属判定的写口。 */
  /* 🔴 03p 现测查明的判据自身缺陷:这里原来用 `date(b.appointment_start)` —— 那是 **UTC 日期**,
     而 `daily_closes.date` 存的是**门店日**。多伦多 08-31 22:30 那单在 UTC 里是 09-01,
     于是两个含义不同的「09-01」被 JOIN 上了 → 误报「往已日结的过去日写单」。
     02w 全绿只是当时跑的时刻没落进这个窗口 —— **判据里一直有这个时区裸算**。
     这正是 CLAUDE.md「所有『今天』按门店时区算,不要裸 new Date() 推日期」在判据层的同一个坑。
     改法:先取该店时区,把 UTC 时刻换算成门店日再比。 */
  /* 🔴 03q 店主裁:**去掉退回多伦多的默认值 —— 小婕店在上海。**
     一个悄悄回落的默认时区,在上海店身上会把 UTC 与门店日重新错开 12 小时,
     刀照样绿而算出来的门店日是别人家的。归族「静默失败器族」:
     「这一步必须发生」的地方不许用 `|| 默认值` —— 要么显式判断并报错,要么在断言里守住它真的发生了。
     取不到时区**这条判据就没有成立的地基**,红,并点名是哪个租户。 */
  const tz = db.prepare("SELECT timezone FROM stores WHERE tenant_id = ? AND is_active = 1 ORDER BY rowid ASC LIMIT 1").get(tid)?.timezone
  if (!tz) {
    throw new Error(`${label} I11 门店时区缺失:tenant_id=${tid} 的 is_active=1 门店取不到 stores.timezone,`
      + '门店日无从算起 —— 判据不许回落到某个默认时区'
      + '(店主 03q:小婕店在上海,退回多伦多会把门店日整整错开半天,而刀照样绿)')
  }
  const storeDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
  const closed = db.prepare("SELECT date, confirmed_at FROM daily_closes WHERE tenant_id = ? AND status = 'confirmed'").all(tid)
  const closedMap = new Map(closed.map((c) => [c.date, c.confirmed_at]))
  const bookingRows = db.prepare('SELECT id, appointment_start, created_at, source_channel FROM bookings WHERE tenant_id = ?').all(tid)
  const offenders = bookingRows.filter((b) => {
    const svcDay = storeDay(b.appointment_start)
    const madeDay = storeDay(b.created_at)
    const confirmedAt = closedMap.get(svcDay)
    return confirmedAt && b.created_at > confirmedAt && madeDay > svcDay
  })
  const wroteIntoClosed = offenders.length
  if (wroteIntoClosed !== 0) {
    /* 🔴 03p:判据红了却说不出**是哪一行**,人就只能靠猜(临时库跑完就删,事后查不到)。
       红的时候把命中行原样打出来 —— 判据要能自己指认现场。 */
    console.error(`  [I11 命中行 · 门店时区 ${tz}] ${JSON.stringify(offenders.map((b) => ({ ...b, 服务日: storeDay(b.appointment_start), 建单日: storeDay(b.created_at) })))}`)
    throw new Error(`${label} I11 有单被写进**已日结的过去日**(绕过补录归属判定,历史账被回改):${wroteIntoClosed} 行(命中行见上一行)`)
  }
  iterated += 1
}
check(`🔴 ③ 不变量组 I1-I11 × ${iterated} 家全过(一家红整批红;含前序套件的各态店)`, iterated === allTenants.length)

/* ===== ④ 矩阵店特征各验(建店规格 → 现测) ===== */
let featChecked = 0
for (const b of built) {
  const H = { 'x-admin-tenant-id': b.tid, 'x-tenant-id': b.tid }
  const me = await request('/admin/auth/me', {}, H)
  const expectUnset = b.spec.hours === 'unset' || b.spec.hours === 'allclosed'
  if (me.data.hoursUnset !== expectUnset) throw new Error(`[${b.tid}] 特征:hoursUnset 应=${expectUnset}`)
  if (b.spec.hours === 'closedtoday') {
    const today = (await request('/admin/store-clock', {}, H)).data.today
    const day = await request(`/admin/schedule-day?date=${today}`, {}, H)
    if (!day.data.isClosed || !/陪审特休/.test(day.data.specialNote || '')) throw new Error(`[${b.tid}] 特征:今日特休没生效`)
  }
  if (b.spec.currency && b.serviceId && b.users.length) {
    const bh2 = await request('/admin/business-hours', {}, H)
    if ((bh2.data.stores[0] || {}).currency !== b.spec.currency) throw new Error(`[${b.tid}] 特征:店币种 ${(bh2.data.stores[0] || {}).currency} ≠ ${b.spec.currency}`)
    const pv = await request('/admin/settlements/preview', { method: 'POST', body: JSON.stringify({ userId: b.users[0], payerUserId: b.users[0], cardOwnerUserId: b.users[0], payIntent: 'offline_full', settlements: [{ tierKey: 'list', items: [{ serviceId: b.serviceId, qty: 1 }], customItems: [], servedPersonName: '', technicians: [], payIntent: 'offline_full', depositApplied: false, applyFootSurcharge: false, applyTipReuse: false }] }) }, H)
    if (pv.status !== 200) throw new Error(`[${b.tid}] 特征:预览 ${pv.status}`)
    const disp = pv.data.sheets[0].currencyDisplay || {}
    const wantSym = b.spec.currency === 'CNY' ? '¥' : '$'
    if (pv.data.sheets[0].currency !== b.spec.currency || disp.symbol !== wantSym) {
      throw new Error(`[${b.tid}] 特征:币种句 ${pv.data.sheets[0].currency}/${disp.symbol} ≠ ${b.spec.currency}/${wantSym}`)
    }
  }
  featChecked += 1
}
/* 🔴 02p 自守②咬出:原条件写死 true —— built 为空则一家没验也全绿。照 ③ 的写法改成计数即证。 */
check(`④ 矩阵店特征逐家现测 × ${featChecked} 家(未设置/全关=墙旗标;特休=isClosed+注;币种句随店)`,
  featChecked === built.length && featChecked > 0, `验了 ${featChecked}/${built.length} 家`)

/* ===== ⑤ 欠账补课:强制页链 L5 五连(API 层,未设置店夹具 ×5) ===== */
let chainRuns = 0
for (let i = 0; i < 5; i += 1) {
  const t5 = `jl5-${RUN.slice(-4)}-${i}`
  if ((await request('/platform/tenants', { method: 'POST', body: JSON.stringify({ id: t5, name: `五连店${i}`, plan: 'chain' }) })).status !== 201) throw new Error(`五连建店失败 ${i}`)
  const H5 = { 'x-admin-tenant-id': t5, 'x-tenant-id': t5 }
  const m1 = await request('/admin/auth/me', {}, H5)
  if (m1.data.hoursUnset !== true) throw new Error(`五连#${i}:新店旗标应=true`)
  const put = await request('/admin/business-hours', { method: 'PUT', body: JSON.stringify({ hours: [0, 1, 2, 3, 4, 5, 6].map((w) => (w === 0 ? { weekday: w, isClosed: true } : { weekday: w, openTime: '10:00', closeTime: '19:00', isClosed: false })) }) }, H5)
  if (put.status !== 200) throw new Error(`五连#${i}:保存 ${put.status}`)
  const m2 = await request('/admin/auth/me', {}, H5)
  if (m2.data.hoursUnset !== false) throw new Error(`五连#${i}:保存后旗标应翻 false`)
  chainRuns += 1
}
check(`🔴 ⑤ 强制页链五连(欠账补课):未设置→墙旗标→保存→立即生效 ×${chainRuns} 全成`,
  chainRuns === 5, `实跑 ${chainRuns}/5 连`)

console.log(`\n✅ test-store-jury 通过 ${checks} 项(矩阵 ${JURY_MATRIX.length} 家 + 运行时全集 ${allTenants.length} 家)`)
