/* 主页大屏三接口(合同 = `handoff/商家端主页重画_两端设计图_2026-09-03.html` v3.1 §四)

   ══ 动手前那两问,现测答完了(09-08,沙箱库现查;不猜)══

   **问① 充值/购卡收款在账本里记的 `category` / `pay_channel` 是什么?**
   答:**它们根本不在账本里。** 全库 `finance_transactions` 的 category 全集里
   只有「服务收入-到店 / -耗卡 / -次卡核销 / -美甲 / -美睫 / -定金 / 产品销售 / 礼品卡」
   与各项支出,**没有「充值」「购卡」**。充值走 `stored_value_transactions`(type=recharge/bonus),
   次卡购买走 `member_timecards`(price_cents + created_at)。
   → 所以「现金业绩」= 账本里非储值渠道的收入 **∪** 储值充值 **∪** 次卡购买,
     三处相加,**不是**在账本里筛一个 category 就能得到。这一条写死在这里,免得下一个人去账本里找「充值」。

   **问② 次卡消耗记在哪张表?有没有能落到「当期」的时间戳?**
   答:**次数在 `member_timecards.used_times`,那是个累计计数,没有逐次的时间戳。**
   能落到当期的是**账本里 `pay_channel='times_card'` 的行**(带 `occurred_on`)——
   一行 = 一次核销。所以「次卡消耗次数」按账本行数算,金额不折钱(图 §四 原话:「不折钱」)。
   → 图里那一格因此**报得出来**;若哪天账本不再给次卡核销记行,这一格必须改成「—」而不是 0。

   ══ 跨已日结与未日结:逐日拼(图 §四 口径答①)══
   已日结的日子取 `daily_closes.revenue_cents` 快照;未日结的日子实时算;两段相加。

   ══ 身份裁字段(图 §四 口径答②)══
   **后端按身份裁**,不是前端隐藏:员工身份的响应体里根本没有 `metrics`。 */

export const METRIC_KEYS = ['revenue', 'cash', 'cardUse', 'newCard', 'visits', 'bookings']
export const PERIODS = ['today', 'week', 'month', 'year']

/* 日期算术只做纯字符串加减,基准日由调用方按**门店时区**给(CLAUDE.md 头一条) */
const shiftDay = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const monthStart = (iso) => `${iso.slice(0, 7)}-01`
const yearStart = (iso) => `${iso.slice(0, 4)}-01-01`

/* 当期与「上期同期至今」——上期取的是**同样长度、同样进度**的一段,
   不是整个上一期:比「上月同期至今」才有意义(图 §四 对比列)。 */
export function periodRange(period, todayISO) {
  if (period === 'week') {
    const dow = new Date(`${todayISO}T12:00:00Z`).getUTCDay()
    const from = shiftDay(todayISO, -((dow + 6) % 7))   // 周一起
    return { from, to: todayISO, prevFrom: shiftDay(from, -7), prevTo: shiftDay(todayISO, -7), sparkN: 7 }
  }
  if (period === 'month') {
    const from = monthStart(todayISO)
    const days = Number(todayISO.slice(8)) - 1
    const pm = shiftDay(from, -1)
    return { from, to: todayISO, prevFrom: monthStart(pm), prevTo: shiftDay(monthStart(pm), days), sparkN: 12 }
  }
  if (period === 'year') {
    const from = yearStart(todayISO)
    const py = String(Number(todayISO.slice(0, 4)) - 1)
    return { from, to: todayISO, prevFrom: `${py}-01-01`, prevTo: `${py}${todayISO.slice(4)}`, sparkN: 12 }
  }
  return { from: todayISO, to: todayISO, prevFrom: shiftDay(todayISO, -1), prevTo: shiftDay(todayISO, -1), sparkN: 7 }
}

/* prev = 0 时 deltaPct 必须是 **null**,不是 0、不是 ∞、不是 NaN(图 §七 第 4 条) */
export function deltaOf(value, prev) {
  const v = Number(value) || 0
  const p = Number(prev) || 0
  return { prev: p, deltaAbs: v - p, deltaPct: p === 0 ? null : Math.round(((v - p) / p) * 1000) / 10 }
}

export function createDashboardPulse(deps) {
  const {
    db, currentTenantId, todayOf, tenantCurrencyCodeOrNull, financeLocked,
    todayBoardOf, storeClosedOn,
  } = deps
  for (const [name, fn] of Object.entries(deps)) {
    if (name !== 'db' && typeof fn !== 'function') throw new Error(`createDashboardPulse 缺依赖或类型不对:${name}`)
  }

  /* 🔴 语句一律**懒编译**:模块在 `local-server` 顶部就被构造,而那时
     `daily_closes` 等表还没建(建表排在启动序列后面)—— 首版在这里 `db.prepare()`,
     全新库直接起不来服务(`no such table: daily_closes`)。
     静默失败器族的反面:它不是悄悄跳过,是当场炸;但同样是「把必须发生的事排早了」。 */
  const stmts = new Map()
  const P = (sql) => { if (!stmts.has(sql)) stmts.set(sql, db.prepare(sql)); return stmts.get(sql) }

  /* ── 逐日取数:已日结取快照,未日结实时算(图 §四 口径答①)────── */
  const closedRevenue = () => P(
    "SELECT revenue_cents AS c FROM daily_closes WHERE tenant_id = ? AND date = ? AND status = 'confirmed'")
  const ledgerIncomeOn = () => P(
    "SELECT COALESCE(SUM(amount_cents), 0) AS c FROM finance_transactions WHERE tenant_id = ? AND occurred_on = ? AND type = 'income'")

  function revenueOn(tid, day) {
    const snap = closedRevenue().get(tid, day)
    if (snap) return { cents: snap.c, settled: true }
    return { cents: ledgerIncomeOn().get(tid, day).c, settled: false }
  }
  const sumDays = (tid, from, to, fn) => {
    let total = 0
    for (let d = from; d <= to; d = shiftDay(d, 1)) total += fn(tid, d)
    return total
  }

  /* 现金业绩 = 账本非储值渠道收入 ∪ 储值充值 ∪ 次卡购买(见抬头 问①) */
  const cashLedger = () => P(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM finance_transactions
    WHERE tenant_id = ? AND occurred_on >= ? AND occurred_on <= ? AND type = 'income'
      AND COALESCE(pay_channel, '') NOT IN ('stored_value', 'times_card')`)
  const cashRecharge = () => P(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM stored_value_transactions
    WHERE tenant_id = ? AND type IN ('recharge') AND substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?`)
  const cashCardBuy = () => P(`SELECT COALESCE(SUM(price_cents), 0) AS c FROM member_timecards
    WHERE tenant_id = ? AND substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?`)
  const cashOn = (tid, from, to) => cashLedger().get(tid, from, to).c + cashRecharge().get(tid, from, to).c + cashCardBuy().get(tid, from, to).c

  /* 总卡耗:储值消耗金额 + 次卡核销次数(**钱与次两个数**,次不折钱) */
  const cardMoney = () => P(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM finance_transactions
    WHERE tenant_id = ? AND occurred_on >= ? AND occurred_on <= ? AND type = 'income' AND pay_channel = 'stored_value'`)
  const cardTimes = () => P(`SELECT COUNT(*) AS n FROM finance_transactions
    WHERE tenant_id = ? AND occurred_on >= ? AND occurred_on <= ? AND pay_channel = 'times_card'`)

  /* 新增持卡:当期**首次**开卡的顾客,按顾客去重(首充或首张次卡落在当期) */
  const newCardCount = () => P(`SELECT COUNT(*) AS n FROM (
      SELECT user_id, MIN(first_at) AS first_at FROM (
        SELECT user_id, MIN(substr(created_at, 1, 10)) AS first_at FROM stored_value_transactions
          WHERE tenant_id = ? AND type = 'recharge' GROUP BY user_id
        UNION ALL
        SELECT user_id, MIN(substr(created_at, 1, 10)) AS first_at FROM member_timecards
          WHERE tenant_id = ? GROUP BY user_id
      ) GROUP BY user_id
    ) WHERE first_at >= ? AND first_at <= ?`)

  /* 到店人次:当期到达「已到店 / 已完成」的预约,按单去重(台面同一状态机) */
  const visitsCount = () => P(`SELECT COUNT(*) AS n FROM bookings
    WHERE tenant_id = ? AND substr(appointment_start, 1, 10) >= ? AND substr(appointment_start, 1, 10) <= ?
      AND status IN ('ARRIVED', 'COMPLETED')`)
  /* 今日预约:所有**未取消**的预约数 */
  const bookingsCount = () => P(`SELECT COUNT(*) AS n FROM bookings
    WHERE tenant_id = ? AND substr(appointment_start, 1, 10) >= ? AND substr(appointment_start, 1, 10) <= ?
      AND status NOT IN ('CANCELLED', 'NO_SHOW')`)

  function metricsFor(tid, r) {
    const rev = sumDays(tid, r.from, r.to, (t, d) => revenueOn(t, d).cents)
    const revPrev = sumDays(tid, r.prevFrom, r.prevTo, (t, d) => revenueOn(t, d).cents)
    const cash = cashOn(tid, r.from, r.to)
    const cashPrev = cashOn(tid, r.prevFrom, r.prevTo)
    const cardM = cardMoney().get(tid, r.from, r.to).c
    const cardT = cardTimes().get(tid, r.from, r.to).n
    const nCard = newCardCount().get(tid, tid, r.from, r.to).n
    const nCardPrev = newCardCount().get(tid, tid, r.prevFrom, r.prevTo).n
    const vis = visitsCount().get(tid, r.from, r.to).n
    const visPrev = visitsCount().get(tid, r.prevFrom, r.prevTo).n
    const bk = bookingsCount().get(tid, r.from, r.to).n
    const bkPrev = bookingsCount().get(tid, r.prevFrom, r.prevTo).n

    /* spark:往回数 sparkN 个点。today/week 按天,month/year 按月。 */
    const spark = (fn) => {
      const out = []
      if (r.sparkN === 12) {
        for (let i = 11; i >= 0; i -= 1) {
          const m = new Date(`${r.to.slice(0, 7)}-01T12:00:00Z`)
          m.setUTCMonth(m.getUTCMonth() - i)
          const key = m.toISOString().slice(0, 7)
          out.push(fn(`${key}-01`, `${key}-31`))
        }
      } else {
        for (let i = 6; i >= 0; i -= 1) { const d = shiftDay(r.to, -i); out.push(fn(d, d)) }
      }
      return out
    }
    const sparkRev = spark((a, b) => sumDays(tid, a, b <= r.to ? b : r.to, (t, d) => revenueOn(t, d).cents))

    return [
      { key: 'revenue', value: rev, unit: 'money', ...deltaOf(rev, revPrev), spark: sparkRev },
      { key: 'cash', value: cash, unit: 'money', ...deltaOf(cash, cashPrev), spark: spark((a, b) => cashOn(tid, a, b <= r.to ? b : r.to)) },
      { key: 'cardUse', value: cardM, unit: 'money', extra: { times: cardT, timesUnit: '次' }, ...deltaOf(cardM, cardMoney().get(tid, r.prevFrom, r.prevTo).c), spark: spark((a, b) => cardMoney().get(tid, a, b).c) },
      { key: 'newCard', value: nCard, unit: 'people', ...deltaOf(nCard, nCardPrev), spark: spark((a, b) => newCardCount().get(tid, tid, a, b).n) },
      { key: 'visits', value: vis, unit: 'people', ...deltaOf(vis, visPrev), spark: spark((a, b) => visitsCount().get(tid, a, b).n) },
      { key: 'bookings', value: bk, unit: 'count', ...deltaOf(bk, bkPrev), spark: spark((a, b) => bookingsCount().get(tid, a, b).n) },
    ]
  }

  function pulse({ tenantId = currentTenantId(), period = 'today', role = 'owner' } = {}) {
    const tid = tenantId
    const p = PERIODS.includes(period) ? period : 'today'
    const today = todayOf(tid)
    const r = periodRange(p, today)
    const locked = Boolean(financeLocked(tid))
    const base = {
      asOf: new Date().toISOString(),
      period: p,
      currency: tenantCurrencyCodeOrNull(tid),
      settled: (() => { const s = closedRevenue().get(tid, today); return s ? { state: 'confirmed' } : { state: 'open' } })(),
      locked,
    }
    /* 🔴 身份裁字段**在后端**(图 §四 口径答②):员工身份的响应体里根本没有 metrics 这个键,
       不是「有键但值为空」—— 前端隐藏挡不住任何人直接调接口。 */
    if (role !== 'owner') return base
    const metrics = metricsFor(tid, r)
    /* 财务锁开着时**不下发 value**(图 §七 第 9 条):遮的是数,不是整块 */
    return { ...base, metrics: locked ? metrics.map(({ value, spark, ...rest }) => ({ ...rest, locked: true })) : metrics }
  }

  /* now:与今日台面**同源**,不另算(图 §四) */
  function now({ tenantId = currentTenantId() } = {}) {
    const tid = tenantId
    const today = todayOf(tid)
    const board = todayBoardOf(tid, today)
    return {
      asOf: new Date().toISOString(),
      closed: Boolean(storeClosedOn(tid, today)),
      total: board.total, doing: board.doing, waiting: board.waiting, done: board.done,
      next: board.next,
    }
  }

  /* todo:固定五项,**0 也返回**(由前端决定隐不隐;后端不许因为是 0 就不给这一项) */
  function todo({ tenantId = currentTenantId() } = {}) {
    const tid = tenantId
    const one = (sql, ...args) => { try { return db.prepare(sql).get(tid, ...args).n } catch { return 0 } }
    const today = todayOf(tid)
    return {
      asOf: new Date().toISOString(),
      items: [
        /* 🔴 口径(店主 05r §一 末裁):**待人工只数 `needs_human`**。
           `human_active` 是同事已经在接了 —— 那不是「待处理」,把它算进来等于让老板
           在首页看见一个自己已经在做的事。 */
        { key: 'aiHandoff', n: one("SELECT COUNT(*) AS n FROM wechat_conversations WHERE tenant_id = ? AND status = 'needs_human'"), to: 'ai-desk' },
        { key: 'quotePending', n: one("SELECT COUNT(*) AS n FROM quote_requests WHERE tenant_id = ? AND status = 'pending'"), to: 'quote' },
        { key: 'notePending', n: one("SELECT COUNT(*) AS n FROM bookings WHERE tenant_id = ? AND status = 'COMPLETED' AND substr(appointment_start,1,10) = ? AND id NOT IN (SELECT booking_id FROM service_notes WHERE booking_id IS NOT NULL)", today), to: 'notes' },
        { key: 'shiftApproval', n: one("SELECT COUNT(*) AS n FROM shift_requests WHERE tenant_id = ? AND status = 'pending'"), to: 'schedule' },
        { key: 'dailyClose', n: one("SELECT COUNT(*) AS n FROM daily_closes WHERE tenant_id = ? AND date = ? AND status <> 'confirmed'", today), to: 'daily-close' },
      ],
    }
  }

  /* 三条路由也住在本模块(公约①:新功能一律新模块,巨型文件只许搬出不许新增)。
     ⚠️ 调用点必须排在**租户上下文闸门之后**(交付纪律 7)—— local-server 那一行就在闸后。 */
  async function route(req, res, ctx) {
    const { path, query, adminSession, json } = ctx
    if (req.method !== 'GET' || !path.startsWith('/admin/dashboard/')) return false
    const role = adminSession?.role === 'owner' ? 'owner' : 'staff'
    if (path === '/admin/dashboard/pulse') { json(res, 200, pulse({ period: query.period, role })); return true }
    if (path === '/admin/dashboard/now') { json(res, 200, now({})); return true }
    if (path === '/admin/dashboard/todo') { json(res, 200, todo({})); return true }
    return false
  }

  return { pulse, now, todo, route, periodRange, deltaOf }
}
