/* 主页大屏三接口常驻套件 —— 合同 = 主页重画图 v3.1 **§七 逐条**
   (锚字段与身份,不锚文案;每条先造病验红)

   §七 原文那十一条,这里逐条落:
   ① 同口径:大屏 revenue.value === 财务页当期营收(同一夹具比)
   ② 已日结日 === daily_closes.revenue_cents 快照
   ③ metrics 恒六项、顺序固定;period=year 的 spark 恒 12 项
   ④ prev=0 → deltaPct === null,无 ∞/NaN
   ⑤ bookings.value 与副行三数 === 今日台面同一时刻的数(同源函数)
   ⑦ 今日要处理:0 的项**仍然返回**(隐不隐是前端的事)
   ⑧ 员工身份响应体不含店级 metrics;老板身份含
   ⑨ 币种随店;locked 时不下发 value
   —— ⑥(打卡门)、⑩(两端同源文本)、⑪(截图)属于页面层,归段 6/9/10。

   三店各跑(05o §一⑥):加拿大档 / 境内档 / 北京档,重点看币种与「今天」。 */
import { assertTestTarget } from './test-guard.mjs'
import { periodRange, deltaOf, METRIC_KEYS, PERIODS } from './dashboard-pulse.mjs'
/* 07f §五 批量切:token 改成问 helper 要(试点形状,见 owner-token.mjs) */
const { requireOwnerToken } = await import('./owner-token.mjs')

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
await assertTestTarget(BASE_URL)
const PLATFORM = process.env.OWNER_TOKEN || requireOwnerToken()
const RUN = Date.now().toString(36)
let n = 0
const fails = []
const check = (name, ok, detail = '') => {
  n += 1
  if (ok) console.log(`ok ${n} - ${name}`)
  else { fails.push(name); console.log(`not ok ${n} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}
async function req(path, options = {}, token = PLATFORM, tid = '') {
  const r = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(tid ? { 'x-admin-tenant-id': tid } : {}),
      ...(options.headers || {})
    }
  })
  let data = null
  try { data = await r.json() } catch { data = null }
  return { status: r.status, data }
}

/* ── 纯函数层:期间与 delta(跑得飞快,能逐字锚死)────────────── */
{
  const r = periodRange('today', '2026-09-08')
  check('①0 期间·今日:当期=今天,上期=昨天',
    r.from === '2026-09-08' && r.to === '2026-09-08' && r.prevFrom === '2026-09-07', JSON.stringify(r))
  const w = periodRange('week', '2026-09-10')   // 周四
  check('①1 期间·本周:从周一起,上期=上周同一段(比「上周同期至今」才有意义)',
    w.from === '2026-09-07' && w.prevFrom === '2026-08-31' && w.prevTo === '2026-09-03', JSON.stringify(w))
  const m = periodRange('month', '2026-09-08')
  check('①2 期间·本月:1 号起;上期=上月**同期至今**(到 8 号),不是整个上月',
    m.from === '2026-09-01' && m.prevFrom === '2026-08-01' && m.prevTo === '2026-08-08', JSON.stringify(m))
  const y = periodRange('year', '2026-09-08')
  check('①3 期间·本年:1 月 1 日起;上期=去年同期至今;spark 恒 12',
    y.from === '2026-01-01' && y.prevTo === '2025-09-08' && y.sparkN === 12, JSON.stringify(y))

  check('②0 🔴 §七④ prev=0 → deltaPct **必须是 null**(不是 0、不是 ∞、不是 NaN)',
    deltaOf(100, 0).deltaPct === null && deltaOf(0, 0).deltaPct === null, JSON.stringify(deltaOf(100, 0)))
  check('②1 反向守:prev 非 0 时算得出百分比(拦住 ∞ 不等于把功能拦没)',
    deltaOf(150, 100).deltaPct === 50 && deltaOf(50, 100).deltaPct === -50, JSON.stringify(deltaOf(150, 100)))
  check('②2 deltaAbs 永远给(它没有除零问题,不该跟着 pct 一起消失)',
    deltaOf(100, 0).deltaAbs === 100)
}

/* ── 造景:三档店各一家(三店并行)────────────────────────────── */
const SHOPS = [
  { key: 'A', id: `dp-a-${RUN}`, cur: 'CAD', tz: 'America/Toronto' },
  { key: 'B', id: `dp-b-${RUN}`, cur: 'CNY', tz: 'Asia/Shanghai' },
  { key: 'C', id: `dp-c-${RUN}`, cur: 'CNY', tz: 'Asia/Shanghai' },
]
let fixtureOk = true
for (const s of SHOPS) {
  const made = await req('/platform/tenants', {
    method: 'POST',
    body: JSON.stringify({ id: s.id, name: `大屏${s.key}${RUN}`, plan: 'chain', currency: s.cur, timezone: s.tz, city: `路${RUN}` })
  })
  if (made.status !== 201) { fixtureOk = false; s.err = made.status; break }
  s.owner = made.data.owner
}
check('③0 造景:三档店都建出来了(造不出来按红,不许「造不出来就当过了」)',
  fixtureOk, SHOPS.map((s) => `${s.key}${s.err || '✓'}`).join(' '))

if (fixtureOk) {
  for (const s of SHOPS) {
    const p = await req(`/admin/dashboard/pulse?period=today`, {}, PLATFORM, s.id)
    s.pulse = p.data
    check(`③ ${s.key} 档 pulse 取得到(200 且有 metrics)`, p.status === 200 && Array.isArray(p.data?.metrics), `status=${p.status}`)
  }
  const A = SHOPS[0].pulse || {}
  check('④ 🔴 §七③ metrics **恒六项、顺序固定**(少一项/换个位置都红)',
    Array.isArray(A.metrics) && A.metrics.length === 6
    && A.metrics.every((m, i) => m.key === METRIC_KEYS[i]),
    JSON.stringify((A.metrics || []).map((m) => m.key)))
  check('④b 每一项都带 value/unit/prev/deltaAbs/deltaPct/spark(缺字段前端就得自己猜)',
    (A.metrics || []).every((m) => 'value' in m && 'unit' in m && 'prev' in m && 'deltaAbs' in m && 'deltaPct' in m && Array.isArray(m.spark)))
  check('④c today 的 spark 恒 7 点', (A.metrics || []).every((m) => m.spark.length === 7),
    JSON.stringify((A.metrics || []).map((m) => m.spark.length)))
  const yr = (await req('/admin/dashboard/pulse?period=year', {}, PLATFORM, SHOPS[0].id)).data
  check('④d 🔴 §七③ period=year 的 spark **恒 12 项**',
    (yr?.metrics || []).every((m) => m.spark.length === 12),
    JSON.stringify((yr?.metrics || []).map((m) => m.spark.length)))
  check('④e 无效 period 落回 today(不许 500,也不许拿一个空壳糊弄)',
    (await req('/admin/dashboard/pulse?period=nonsense', {}, PLATFORM, SHOPS[0].id)).data?.period === 'today')
  check('④f PERIODS 白名单式:四档都取得到 200',
    (await Promise.all(PERIODS.map((p) => req(`/admin/dashboard/pulse?period=${p}`, {}, PLATFORM, SHOPS[0].id))))
      .every((x) => x.status === 200))

  /* §七⑨ 币种随店 */
  check('⑤ 🔴 §七⑨ 币种随店:A 档 CAD、B/C 档 CNY(不是写死一个)',
    SHOPS[0].pulse?.currency === 'CAD' && SHOPS[1].pulse?.currency === 'CNY' && SHOPS[2].pulse?.currency === 'CNY',
    SHOPS.map((s) => `${s.key}=${s.pulse?.currency}`).join(' '))

  /* §七① 同口径:大屏今日营收 === 财务页当期营收(同一夹具) */
  const tid = SHOPS[0].id
  const clock = (await req('/admin/store-clock', {}, PLATFORM, tid)).data
  const today = clock?.today
  /* 「财务页当期营收」的真出处是**账本流水**(`/admin/finance/transactions`,按 occurred_on),
     不是那个老的 `/admin/finance/summary`(它按 bookings 算、还带财务密码门,不是这一格的锚)。
     这里按财务页自己那条口径把今天的收入加起来,再跟大屏比。 */
  /* 🔴 零命中先证刀能咬:空店里 0 === 0 也是「相等」,那条判据什么都没验。
     先往账本里记一笔今天的收入,让两边都有一个**非零**的数可比。 */
  const put = await req('/admin/finance/transactions', {
    method: 'POST',
    body: JSON.stringify({ type: 'income', category: '服务收入-到店', amountCents: 13579, payChannel: 'card', occurredOn: today, note: `大屏同口径夹具${RUN}` })
  }, PLATFORM, tid)
  check('⑥a 造景:往账本记了一笔今天的收入 ¥135.79(记不进去 = 下面同口径那条没验成)',
    put.status === 201, `status=${put.status} ${JSON.stringify(put.data).slice(0, 90)}`)
  const pulse2 = (await req('/admin/dashboard/pulse?period=today', {}, PLATFORM, tid)).data
  SHOPS[0].pulse = pulse2
  const fin = await req(`/admin/finance/transactions?month=${today.slice(0, 7)}`, {}, PLATFORM, tid)
  const rowsFin = fin.data?.transactions || fin.data?.rows || []
  const finIncome = rowsFin
    .filter((t) => (t.type === 'income') && String(t.occurredOn || t.occurred_on || '') === today)
    .reduce((a, t) => a + Number(t.amountCents ?? t.amount_cents ?? 0), 0)
  const screen = Number((SHOPS[0].pulse?.metrics || []).find((m) => m.key === 'revenue')?.value ?? NaN)
  check('⑥0 前置:账本流水取得到(取不到 = 下面这条什么都没验)',
    fin.status === 200 && Array.isArray(rowsFin), `status=${fin.status} ${JSON.stringify(fin.data).slice(0, 90)}`)
  check('⑥b 🔴 两边都不是 0(0 === 0 也叫相等 —— 那条判据什么都没验)',
    finIncome > 0 && screen > 0, `大屏 ${screen} 财务页 ${finIncome}`)
  check('⑥ 🔴 §七① 同口径:大屏今日营收 === 财务页当期营收(同一夹具、同一天)',
    screen === finIncome, `大屏 ${screen} vs 财务页 ${finIncome}`)

  /* §七⑤ bookings 与 now 同源 */
  const nowRes = await req('/admin/dashboard/now', {}, PLATFORM, tid)
  const board = (await req(`/admin/schedule-day?date=${today}`, {}, PLATFORM, tid)).data
  const boardRows = (board?.bookings || []).filter((b) => !['CANCELLED', 'NO_SHOW'].includes(b.status))
  check('⑦0 now 取得到(200 且四格都在)',
    nowRes.status === 200 && ['total', 'doing', 'waiting', 'done'].every((k) => k in (nowRes.data || {})),
    JSON.stringify(nowRes.data).slice(0, 120))
  check('⑦ 🔴 §七⑤ now.total === 今日台面未取消的单数(**同源函数**,不另算)',
    nowRes.data?.total === boardRows.length, `now=${nowRes.data?.total} 台面=${boardRows.length}`)
  check('⑦b 四格相加 === total(自洽:一张单只能落在一格里)',
    (nowRes.data?.doing + nowRes.data?.waiting + nowRes.data?.done) === nowRes.data?.total,
    JSON.stringify(nowRes.data))
  const bkMetric = (SHOPS[0].pulse?.metrics || []).find((m) => m.key === 'bookings')
  check('⑦c 🔴 §七⑤ 今日维度下 bookings.value === now.total(大数字与副行同一时刻同一个数)',
    bkMetric?.value === nowRes.data?.total, `bookings=${bkMetric?.value} now=${nowRes.data?.total}`)

  /* §七⑦ todo 五项,0 也返回 */
  const todo = await req('/admin/dashboard/todo', {}, PLATFORM, tid)
  check('⑧ 🔴 §七⑦ 今日要处理**恒五项**,为 0 的项也返回(隐不隐是前端的事,后端不许替它决定)',
    (todo.data?.items || []).length === 5 && (todo.data.items).every((x) => typeof x.n === 'number' && x.to),
    JSON.stringify((todo.data?.items || []).map((x) => `${x.key}=${x.n}`)))

  /* §七⑧ 身份裁字段 —— 后端裁,不是前端隐藏 */
  const owner = SHOPS[0].owner
  const first = await req('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: owner.username, password: owner.initialPassword }) }, null)
  const pass = `Dp-${RUN}-9a`
  await req('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: owner.initialPassword, newPassword: pass, confirmPassword: pass }) }, first.data?.auth?.accessToken)
  const ownerTok = (await req('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: owner.username, password: pass }) }, null)).data?.auth?.accessToken
  const tech = (await req(`/platform/tenants/${tid}/technicians`, { method: 'POST', body: JSON.stringify({ name: `技${RUN}` }) })).data?.technician
  const acct = (await req('/admin/staff-accounts', { method: 'POST', body: JSON.stringify({ technicianId: tech?.id }) }, ownerTok)).data
  let staffTok = ''
  if (acct?.username) {
    const f = (await req('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: acct.username, password: acct.initialPassword }) }, null)).data
    const sp = `Dps-${RUN}-9a`
    await req('/admin/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: acct.initialPassword, newPassword: sp, confirmPassword: sp }) }, f?.auth?.accessToken)
    staffTok = (await req('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email: acct.username, password: sp }) }, null)).data?.auth?.accessToken
  }
  check('⑨0 造景:老板令牌与员工令牌都拿到了(拿不到 = 下面这条没验成)',
    Boolean(ownerTok) && Boolean(staffTok), `owner=${Boolean(ownerTok)} staff=${Boolean(staffTok)}`)
  if (ownerTok && staffTok) {
    const asOwner = await req('/admin/dashboard/pulse', {}, ownerTok, tid)
    const asStaff = await req('/admin/dashboard/pulse', {}, staffTok, tid)
    check('⑨ 🔴 §七⑧ 员工身份响应体**根本没有 metrics 这个键**(不是有键但空 —— 前端隐藏挡不住直接调接口)',
      !('metrics' in (asStaff.data || {})), JSON.stringify(Object.keys(asStaff.data || {})))
    check('⑨b 反向守:老板身份**有** metrics(裁字段不等于把功能裁没)',
      Array.isArray(asOwner.data?.metrics) && asOwner.data.metrics.length === 6)
  }
}

/* ══ D184 两把刀搬家(店主 05w §二 裁)══
   原来这两条只写在 `test-seed-rich.mjs` 里,而 `seed-rich` 按 D169 **不进全量** ——
   **没人跑的刀等于没立**。搬到这一套(它在 DEFAULT_SUITES 里,而且只要活服务 + 库句柄)。
   `seed-rich` 那份留着(那边跑的是三家真夹具店,数更像真的),这边保证**全量一定跑得到一份**。

   🔴 造景律:这一套的三家店是**空的**,空店里 newCard=0、顾客数=0,
   「0 ≤ 0」和「0 === 0」在缺陷存在时照样绿 —— 那就是废判据。
   所以先自己把景造出来:三位顾客 + 一笔今天的首充 + 一笔去年的首充(非当期反例),
   再验 `newCard` 只数当期那一位。 */
if (fixtureOk) {
  const A = SHOPS[0].id
  const dbFile = (await fetch(`${BASE_URL}/health`).then((r) => r.json())).dataFile
  const { DatabaseSync } = await import('node:sqlite')
  /* 护栏:上面 `assertTestTarget` 已经确认这台服务只往测试库写,所以这里开可写句柄是安全的;
     它写的也只是自己刚建的那家一次性店。 */
  const wdb = new DatabaseSync(dbFile)
  const today = (await req('/admin/store-clock', {}, PLATFORM, A)).data?.today
  const lastYear = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`
  const mkUser = (i) => {
    const id = `dpu-${RUN}-${i}`
    wdb.prepare('INSERT INTO users (id, display_name, tenant_id) VALUES (?, ?, ?)').run(id, `持卡${i}`, A)
    return id
  }
  const u1 = mkUser(1); const u2 = mkUser(2); mkUser(3)
  const mkRecharge = (uid, day, i) => wdb.prepare(
    `INSERT INTO stored_value_transactions (id, tenant_id, user_id, type, amount_cents, pay_channel, created_at)
     VALUES (?, ?, ?, 'recharge', 50000, 'cash', ?)`).run(`dpsv-${RUN}-${i}`, A, uid, `${day}T12:00:00.000Z`)
  mkRecharge(u1, today, 1)
  mkRecharge(u2, lastYear, 2)      // 反例:非当期的首充,当期不许数进去
  wdb.close()

  const NEWCARD_SQL = `SELECT COUNT(*) AS n FROM (
      SELECT user_id, MIN(first_at) AS first_at FROM (
        SELECT user_id, MIN(substr(created_at, 1, 10)) AS first_at FROM stored_value_transactions
          WHERE tenant_id = ? AND type = 'recharge' GROUP BY user_id
        UNION ALL
        SELECT user_id, MIN(substr(created_at, 1, 10)) AS first_at FROM member_timecards
          WHERE tenant_id = ? GROUP BY user_id
      ) GROUP BY user_id
    ) WHERE first_at >= ? AND first_at <= ?`
  const rodb = new DatabaseSync(dbFile, { readOnly: true })
  const userTotal = rodb.prepare('SELECT COUNT(*) AS n FROM users WHERE tenant_id = ?').get(A).n
  check('⑩0 造景:这家店真有顾客、也真有一笔当期首充(景造不出来 = 下面两条等于没跑)',
    userTotal === 3, `顾客 ${userTotal} 位(该是 3)`)
  for (const p of PERIODS) {
    const d = (await req(`/admin/dashboard/pulse?period=${p}`, {}, PLATFORM, A)).data
    const got = Number(((d && d.metrics) || []).find((m) => m.key === 'newCard')?.value)
    /* ① 死判据:去重后的人数不可能超过人数本身(店主亲查那张图:604 > 顾客总数 75) */
    check(`⑩ ${p} 新增持卡 ${got} ≤ 顾客总数 ${userTotal}(死判据:去重后的人数不可能超过人数本身)`,
      Number.isFinite(got) && got <= userTotal, `算出来 ${got} · 顾客总数 ${userTotal}`)
    /* ② 全等:接口值 === 直接跑那段 SQL;期间起止取后端那一份,判据不自己再算日界 */
    const r = periodRange(p, today)
    const want = rodb.prepare(NEWCARD_SQL).get(A, A, r.from, r.to).n
    check(`⑩b ${p} 新增持卡:接口 ${got} === 直接跑 SQL ${want}`, got === want,
      `接口=${got} SQL=${want}(${r.from}~${r.to})`)
  }
  /* 反例数据律:当期该是 1(去年那位不许数进来)—— 这一条也守住「别把两位都算上」 */
  const todayVal = Number((((await req('/admin/dashboard/pulse?period=today', {}, PLATFORM, A)).data?.metrics) || [])
    .find((m) => m.key === 'newCard')?.value)
  check('⑩c 反例:去年那笔首充不许算进「今日新增持卡」(今日该是 1,不是 2)', todayVal === 1, `今日=${todayVal}`)
  rodb.close()
}

console.log(`\n[主页大屏] 期间/delta 纯函数 · 六项恒序 · year spark 12 · 币种随店 · 同口径 · now 同源 · todo 五项 · 身份裁字段`)
if (fails.length) {
  console.error(`\n❌ test-dashboard-pulse ${fails.length}/${n} 项未过`)
  for (const f of fails) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`\n✅ test-dashboard-pulse 通过 ${n} 项`)
