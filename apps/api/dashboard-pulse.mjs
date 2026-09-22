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

/* 五项待办各自的来源表 —— **判据从这里取**,不许在判据里再手抄一份(手抄那份不会跟着改)。
   `shift_requests` 现在不存在:登记在 `TODO_MISSING_TABLES` 里,判据按例外清单核,
   条数只许降不许升(建好那天这条自动该删)。 */
export const TODO_SOURCES = { aiHandoff: 'wechat_conversations', quotePending: 'quote_requests', notePending: 'service_notes', shiftApproval: 'shift_requests', dailyClose: 'daily_closes' }
export const TODO_MISSING_TABLES = ['shift_requests']   // 待裁 #12:调休申请功能没做,不是没数据

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
    db, currentTenantId, todayOf, tenantCurrencyCodeOrNull, currencyDisplayOf, financeLocked,
    todayBoardOf, storeClosedOn, storeClockText, aiRetouchCard,
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
      /* 🔴 币种红线:**币符怎么摆也由后端下发**(与 `/admin/store-clock`、公开 `/stores` 同一个出口)。
         段 9 现测:小程序端拿客户端缓存去拼,平台侧换店后小婕店/北京店(CNY)被显示成 `CAD $` ——
         缓存是「上次看的那家店」的。给了这一份,两端就都不用自己认识任何币种。 */
      currencyDisplay: currencyDisplayOf(tenantCurrencyCodeOrNull(tid)),
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

  /* 五项待办各自的**来源表** —— 判据拿这份去核「表在不在」(见下方 D172 那段)。
     写成数据而不是散在 SQL 里:判据不许靠列举被测对象(白名单判据律)。 */

  /* todo:固定五项,**0 也返回**(由前端决定隐不隐;后端不许因为是 0 就不给这一项)

     🔴 05t 段 2 现查:五项里**三项是死线**,而它们报出来的都是 0 —— 与「真的没有」长得一模一样。
     这正是静默失败器族:`try { ... } catch { return 0 }` 把「表不存在」「状态值对不上」
     一起吞成了「没有待办」。逐条:
     · **D170 `quotePending`**:数的是 `status='pending'`,而库里真值是 **`PENDING_STAFF`**
       (沙箱现查:PENDING_STAFF 287 / QUOTED 59 / DRAFT_CREATED 38 / DECLINED 4,**没有一行叫 pending**)。
       → 改数 `PENDING_STAFF`。
     · **D171 `dailyClose`**:数的是「今天有一行 daily_closes 且 status<>confirmed」,
       而 `daily_closes` **只在确认那一刻才插行**(status 只有 confirmed / reopened)——
       「还没日结」的日子在库里**根本没有行**,所以这一格永远是 0。
       → 按店主原话改成「**昨天有已完成单、却还没确认日结**」:1 或 0。
     · **D172 `shiftApproval`**:`shift_requests` 这张表**全仓不存在**(只有这一行 SQL 提到它),
       调休申请功能没做。它不是「暂时没数据」,是「这条线没接」。
       → 本批不擅自建表(那是新功能,超出本批),**如实下发 `available: false`**,
         并登记待裁 #12;判据里挂例外清单 + 条数上棘轮,建好那天例外自动该删。 */
  function todo({ tenantId = currentTenantId() } = {}) {
    const tid = tenantId
    const has = (t) => { try { return Boolean(db.prepare("SELECT 1 AS n FROM sqlite_master WHERE type = 'table' AND name = ?").get(t)) } catch { return false } }
    const one = (sql, ...args) => { try { return db.prepare(sql).get(tid, ...args).n } catch { return 0 } }
    const today = todayOf(tid)
    const yday = shiftDay(today, -1)
    const item = (key, table, n, to) => ({ key, n: has(table) ? n() : 0, to, available: has(table) })
    return {
      asOf: new Date().toISOString(),
      items: [
        /* 🔴 AI 修图入口(店主 11m §三 批:放「今日要处理」第一张)—— 三态由平台后台控。
           `off` ⇒ 这里返回 null,下面 `.filter(Boolean)` 掉,**整张卡不存在**(不是灰着);
           `soon` ⇒ 淡态 + 「敬请期待」,`to` 为空 ⇒ 点击不跳页,只 toast;
           `on`  ⇒ 真入口 —— **现在谁也拨不到 on**(平台口 409),所以这一档的渲染本批不写:
                   写了就是假入口(「不可用即不呈现,呈现即说明」)。
           句子(label/badge/hint)在后端出,前端零拼串 —— 改文案不用两端发版。 */
        (() => {
          const card = aiRetouchCard ? aiRetouchCard(tid) : null
          if (!card) return null
          return {
            key: 'aiRetouch', n: 0, to: card.tappable ? 'ai-retouch' : '', available: true,
            soon: card.state === 'soon', label: card.label, badge: card.badge, hint: card.hint,
          }
        })(),
        /* 🔴 口径(店主 05r §一 末裁):**待人工只数 `needs_human`**。
           `human_active` 是同事已经在接了 —— 那不是「待处理」,把它算进来等于让老板
           在首页看见一个自己已经在做的事。 */
        item('aiHandoff', 'wechat_conversations', () => one("SELECT COUNT(*) AS n FROM wechat_conversations WHERE tenant_id = ? AND status = 'needs_human'"), 'ai-desk'),
        item('quotePending', 'quote_requests', () => one("SELECT COUNT(*) AS n FROM quote_requests WHERE tenant_id = ? AND status = 'PENDING_STAFF'"), 'quote'),
        item('notePending', 'service_notes', () => one("SELECT COUNT(*) AS n FROM bookings WHERE tenant_id = ? AND status = 'COMPLETED' AND substr(appointment_start,1,10) = ? AND id NOT IN (SELECT booking_id FROM service_notes WHERE booking_id IS NOT NULL)", today), 'notes'),
        item('shiftApproval', 'shift_requests', () => one("SELECT COUNT(*) AS n FROM shift_requests WHERE tenant_id = ? AND status = 'pending'"), 'schedule'),
        /* 昨天有已完成的单、却没有一张 confirmed 的日结 → 待日结 1 天。
           **「有单」这一半不能省**:店休那天没单,不该在首页催老板去日结。 */
        item('dailyClose', 'daily_closes', () => (
          one("SELECT COUNT(*) AS n FROM bookings WHERE tenant_id = ? AND status = 'COMPLETED' AND substr(appointment_start,1,10) = ?", yday) > 0
          && one("SELECT COUNT(*) AS n FROM daily_closes WHERE tenant_id = ? AND date = ? AND status = 'confirmed'", yday) === 0 ? 1 : 0
        ), 'daily-close'),
      ].filter(Boolean),
    }
  }

  /* ── AI 今日一句:**落库 + 只读**(店主 05t 段 2 第 4 条)──────────────
     原状:`/admin/ai/daily-brief` 生成完直接回给页面,**一个字都没存**;
     首页那块读的是 `owner.dashAiLine`,而这个变量**全仓没有任何地方赋过值** ——
     所以它永远显示「今天还没有一句」。灌再多数据也治不了,因为这条线根本没接上。
     裁:生成那一刻按**门店当天**存一条(一天一条,同一天再生成就覆盖当天这条);
     首页只读,不新起模型调用(图/裁定原文)。存哪儿:`tenant_settings`,
     不为一句话新开一张表。 */
  const AI_LINE_KEY = 'ai_daily_line'
  function rememberAiLine(brief, tenantId = currentTenantId()) {
    /* 取哪一段:`createDailyBrief` 回的是 `headlineZh/headlineEn`(见 ai-utils.mjs 的 schema)。
       **按字段名取,不猜** —— 取错了就是首页恒空,而恒空和「今天还没生成」长得一样(静默失败器族)。 */
    const text = String(brief?.headlineZh || brief?.headlineEn || '').trim()
    if (!text) return brief                       // 没生成出东西就不存(不许存空壳去骗首页)
    const at = new Date().toISOString()
    /* 🔴 页面上要显示的是「10:05」这样的**门店当地时刻**(图 §三 那格写的就是「AI 今日一句 · 10:05」),
       不是一串 ISO。时区只有后端知道(顾客/店主可能在别的时区),所以**生成那一刻就把文本定死**,
       前端零计算、零格式化(同「后端出句」那一族)。 */
    const atText = storeClockText(tenantId)
    const value = JSON.stringify({ date: todayOf(tenantId), text, at, atText })
    db.prepare(`INSERT INTO tenant_settings (tenant_id, key, value, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(tenantId, AI_LINE_KEY, value, at)
    return brief
  }
  /** 首页那一句。**只回今天的** —— 昨天那句今天不算数(隔夜还挂着等于说谎)。 */
  function aiLine({ tenantId = currentTenantId() } = {}) {
    const row = db.prepare('SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = ?').get(tenantId, AI_LINE_KEY)
    let v = null
    try { v = row ? JSON.parse(row.value) : null } catch { v = null }
    if (!v || v.date !== todayOf(tenantId) || !v.text) return { line: null }
    return { line: { text: v.text, at: v.atText || '', iso: v.at || '' } }
  }

  /* 三条路由也住在本模块(公约①:新功能一律新模块,巨型文件只许搬出不许新增)。
     ⚠️ 调用点必须排在**租户上下文闸门之后**(交付纪律 7)—— local-server 那一行就在闸后。 */
  async function route(req, res, ctx) {
    const { path, query, adminSession, json } = ctx
    /* 段 11 图 §五:前台大屏「显示金额」开关。**默认关** —— 那块屏顾客可能看到,
       现金业绩与新增持卡不该默认摆在店门口。只有显式 true 才算开(fail-closed)。
       放这个模块:它和大屏三接口同一族,别再往巨型文件里塞(公约③只许搬出)。 */
    if (req.method === 'GET' && path === '/admin/store-settings/front-screen') {
      const row = db.prepare("SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = 'front_screen'").get(currentTenantId())
      let v = {}
      try { v = row ? JSON.parse(row.value) : {} } catch { v = {} }
      json(res, 200, { showMoney: v.showMoney === true })
      return true
    }
    if (req.method !== 'GET' || !path.startsWith('/admin/dashboard/')) return false
    const role = adminSession?.role === 'owner' ? 'owner' : 'staff'
    if (path === '/admin/dashboard/pulse') { json(res, 200, pulse({ period: query.period, role })); return true }
    if (path === '/admin/dashboard/now') { json(res, 200, now({})); return true }
    if (path === '/admin/dashboard/todo') { json(res, 200, todo({})); return true }
    if (path === '/admin/dashboard/ai-line') { json(res, 200, aiLine({})); return true }
    return false
  }

  return { pulse, now, todo, aiLine, rememberAiLine, route, periodRange, deltaOf }
}
