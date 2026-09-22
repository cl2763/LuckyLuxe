/* 小程序商家端首页 · 老板视角的**取数与出句**(图 v3.2 §一,段 9)

   为什么单独一个文件:
   ① 页面文件有 600 行上限(公约③),而这一版首页的规矩不少;
   ② 这里全是**纯函数** —— 给它一份 pulse/now/todo,它算出页面要显示的每一句话。
      纯函数才验得动:常驻回归起不了小程序,但能把这三份数据喂进来逐句对。
   ③ 网页端那一版(`apps/web/dashboard-home.js`)读的是**同样三条接口**,
      所以「一份数据两端渲染」这条律在这里是靠**同源接口 + 同套口径**成立的,
      不是靠两边各写一遍(那正是分叉债的来源)。

   🔴 三条红线在这个文件里的样子:
   · **零回落**:拿不到就出「—」,绝不用另一个字段顶上,也不编 0;
   · **不许自己拼币符**,而且币种要取**这次接口下发的那个**(`pulse.currency`):
     客户端那份币种缓存是「上次看的那家店」的,平台侧换店时它不会跟着变 ——
     段 9 截图现测:两家人民币店被显示成了加元的样子。这就是币种红线要防的事。
   · **不许编月目标**:门店没设目标,那一行整块不出现(不占位、不写「未设置」)。 */

const PERIODS = [
  { key: 'today', label: '今日' },
  { key: 'week', label: '本周' },
  { key: 'month', label: '本月' },
  { key: 'year', label: '本年' },
]

/* 五个小数(图 §一:大数底下一行五个)。顺序就是图上的顺序,不许改。 */
const SMALL_KEYS = ['cash', 'cardUse', 'newCard', 'visits', 'bookings']
/* 🔴 D168 段 4:轮播位 —— 图 §一 底下画的是 **5 个 dots**,而接口给的是六个指标。
   取「营业收入 + 现金业绩 + 总卡耗 + 新增持卡 + 到店人次」五个轮播,
   **今日预约不进轮播**:它那一格带「在做 N · 待到店 N」的实时副行,
   图 §一 第 2 条说那是「主页上唯一的实时一眼」,轮走了就没了。
   与网页端 `dashboard-home.js` 的 CAROUSEL **是同一份名单**(两端同一个轮播顺序)。 */
const CAROUSEL = ['revenue', 'cash', 'cardUse', 'newCard', 'visits']
const MONEY_KEYS = ['revenue', 'cash', 'cardUse']
const LABELS = {
  revenue: '营业收入 · 服务 + 耗卡 + 产品',
  cash: '现金业绩',
  cardUse: '总卡耗',
  newCard: '新增持卡',
  visits: '到店人次',
  bookings: '今日预约',
}
/* 「比上期」在四个维度上说的**不是同一句话**(D148 说人话族) */
const DELTA_WORD = { today: '比昨日', week: '比上周', month: '比上月', year: '比去年' }
/* 今日预约那一格换维度时改名(图 §一:维度切到本周/本月/本年时变「本期预约 N」) */
const bookingsLabel = (period) => (period === 'today' ? '今日预约' : '本期预约')

/* 要处理那五项:**来源固定成一张清单**,顺序按急缓 —— 顾客在等的两项排前面并标红 */
const TODO_LABEL = {
  aiHandoff: '客服待人工回复',
  quotePending: '待报价',
  notePending: '做完待写小记',
  shiftApproval: '调休申请待批',
  dailyClose: '昨日日结待确认',
}
const URGENT = ['aiHandoff', 'quotePending']

/** 钱怎么显示。**一个币符都不自己拼** —— 全交给 `storeMoney`。
 *  拿不到值或拿不到币种 → 「—」(零回落:不编 0,也不拿别的字段顶上)。 */
function moneyText(metric, storeMoney) {
  if (!metric) return '—'
  if (metric.locked) return '••••'          // 财务锁:遮成点,不是显示 0
  if (metric.value === undefined || metric.value === null) return '—'
  return storeMoney(metric.value)
}

/** 人数/单数这类**不是钱**的数。同样不编 0。 */
function countText(metric, unit = '') {
  if (!metric) return '—'
  if (metric.locked) return '••••'
  if (metric.value === undefined || metric.value === null) return '—'
  return `${metric.value}${unit}`
}

/** 比上期那一句。上期是 0 → **不显示箭头**(不显示 ∞/NaN,图 §一 明写)。 */
function deltaOf(metric, period) {
  const d = metric && metric.delta
  if (!d || d.basis === 0 || d.percent === null || d.percent === undefined) return null
  const up = Number(d.percent) > 0
  const flat = Number(d.percent) === 0
  return {
    arrow: flat ? '—' : (up ? '▲' : '▼'),
    tone: flat ? 'flat' : (up ? 'up' : 'down'),   // 升绿降红平灰,但**带箭头不只靠颜色**
    text: `${Math.abs(Number(d.percent)).toFixed(1)}% ${DELTA_WORD[period] || '比上期'}`,
  }
}

/** 截至行**说真话**:今日未日结就说未日结;已日结要说确认于几点。 */
function asOfText(pulse, nowHM) {
  const st = (pulse && pulse.settled) || {}
  if (st.state === 'closed') return `已日结 ✓ ${st.confirmedAt ? `老板确认于 ${st.confirmedAt}` : ''}`.trim()
  return `截至 ${nowHM} · 今日未日结,实时`
}

/** 把三份数据揉成页面要显示的东西。**页面那边零计算、零拼串**。 */
/** 按**这次接口下发的**币种绑一个钱格式化器。
 *  币符怎么摆全由后端那份 `currencyDisplay` 说了算 —— 这里不认识任何币种,
 *  所以平台侧换店时不会出现「CNY 店显示成 CAD」(段 9 现测过的那个)。
 *  下发里没有就回 `null`,由调用方出「—」(fail-closed,与 D140 同口径)。 */
function makeMoneyFor(currencyDisplay, code) {
  if (!currencyDisplay || !code) return null
  return (cents) => {
    const v = Number(cents || 0) / 100
    let txt = v.toFixed(currencyDisplay.trimZeroDecimals ? 0 : 2)
    if (currencyDisplay.trimZeroDecimals) txt = txt.replace(/\.00$/, '')
    txt = txt.replace(/\B(?=(\d{3})+(?!\d)(\.|$))/g, ',')
    return `${String(currencyDisplay.prefix || '').replace('<CODE>', code)}${currencyDisplay.symbol || ''}${txt}`
  }
}

/* 🔴 D178(店主 2026-09-09 逐条对图):大数字在图上是**三段**——
   `CAD`(1.2rem 金色 `--herogold`)+ `1,318`(3.3rem Fraunces)+ `.00`(1.6rem,淡一档)。
   她截图里是「币码 + 数字 + 分位」**整串一样大**,与网页端也不一致(网页那边早就是三段了)。
   这里把同一份 `currencyDisplay` 拆成三段给页面 —— 页面仍然一个币符都不自己拼。
   与网页 `money-format.js:parts()` 是**同一套规则**(千分位只给整数部分、trimZeroDecimals 同款);
   两端各写一份是端能力使然(小程序引不了网页那个文件),规则若要改必须两处一起改。 */
function makePartsFor(currencyDisplay, code) {
  if (!currencyDisplay || !code) return null
  return (cents) => {
    const v = Number(cents || 0) / 100
    let txt = v.toFixed(currencyDisplay.trimZeroDecimals ? 0 : 2)
    /* 🔴 05x §四(店主开 08截图/01 看出来的):同一屏上大数字写 `…5,668.00`、正下方小牌写 `5,668`,
       同一个数两种写法。裁:**大数与小牌共用同一出口,店主看的整数金额不带小数**
       (`.00` 只在需要分位的结算单据里出现)。
       所以这一处**不分币种**都把整分的 `.00` 去掉 —— 这是「仪表盘口径」,
       与 `makeMoneyFor`(通用金额出口,单据要 `.00` 时走它)分工写在这儿。
       真有分位的(如 `5,668.40`)照留,大数与小牌一起留。 */
    txt = txt.replace(/\.00$/, '')
    const bits = txt.split('.')
    const grouped = bits[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    return {
      code: `${String(currencyDisplay.prefix || '').replace('<CODE>', code)}${currencyDisplay.symbol || ''}`.trim(),
      amount: grouped,
      cents: bits[1] ? `.${bits[1]}` : '',
    }
  }
}

function buildOwnerHome({ pulse, now, todo, period, nowHM, storeMoney, moneyFor, headKey = 'revenue' }) {
  /* 钱的出口:按**这次下发的币种**绑一个;调用方给了 `moneyFor` 就用它(判据造景用)。
     两个都没有 → 一个钱数都不出(fail-closed)。 */
  const cur = pulse && pulse.currency
  const bound = makeMoneyFor(pulse && pulse.currencyDisplay, cur)
  const fmt = moneyFor ? (cents) => moneyFor(cents, cur) : (bound || storeMoney)
  const metrics = (pulse && pulse.metrics) || []
  const byKey = {}
  for (const m of metrics) byKey[m.key] = m
  /* 轮播:大数字放大的是哪一个由 `headKey` 定;名单外的一律回落到营业收入
     (回落到**同族的第一个**,不是回落到别的语义 —— 零回落律管的是「拿别的字段顶上」) */
  const hk = CAROUSEL.includes(headKey) ? headKey : 'revenue'
  const head = byKey[hk] || null

  const smalls = SMALL_KEYS.map((key) => {
    const m = byKey[key]
    /* 图 §一 第 2 条原文:「轮播把谁放大,谁就从这一行**暂时空出**(位置保留、数字淡出),
       其余四个照显 —— 五个数任何时刻都在屏上」。所以这里给一个 `dimmed` 标记,
       **不是把那一格删掉**(删掉就变成四格重排,图上不是那样)。 */
    const isMoney = key === 'cash' || key === 'cardUse'
    const unit = key === 'newCard' || key === 'visits' ? ' 人' : (key === 'bookings' ? ' 单' : '')
    /* 🔴 现测(裁 #21 拍到真机之后才看见的):五格一行里,「现金业绩」那一格
       连币码带分位整串塞不下,省略号一切**先切掉的就是数字**,那比折行更糟。
       (这段注释以前把那串金额原样抄了进来,`test-currency-scan` 当场点名 ——
        判据是对的:它防的就是「字面币符出现在代码里」,注释也算代码。)
       回去看图:`.mini5 b` 里写的是「3,120」—— **只有数字,没有币符**。
       币种由上面那个大数字交代(它有币码小字),这一行只报数。按图改。
       金额仍然只走后端下发的 `currencyDisplay`(拆段那一处),这里取它的 `amount` 段,
       页面照样一个币符都不自己拼。 */
    const partsOf = makePartsFor(pulse && pulse.currencyDisplay, cur)
    const smallMoney = () => {
      if (!m || m.locked) return m && m.locked ? '••••' : '—'
      if (m.value === undefined || m.value === null || !partsOf) return '—'
      const q = partsOf(m.value)
      /* 图上 `.mini5 b` 写的是「3,120」—— **只有数字,没有币码**(币种由上面那个大数字交代)。
         🔴 05x §四 改这一行:数字部分要**跟大数字一模一样** —— 原来这里把分位丢了,
         于是大数 `5,668.00` / 小牌 `5,668` 同屏打架。现在整分的 `.00` 在出口就没了,
         真有分位时两处一起显示。判据按「同一 metric 两处数字串必须相等」守。 */
      return `${q.amount}${q.cents}`
    }
    return {
      key,
      label: key === 'bookings' ? bookingsLabel(period) : LABELS[key],
      value: isMoney ? smallMoney() : countText(m, unit),
      delta: deltaOf(m, period),
      /* 今日预约那一格的副行「在做 3 · 待到店 2」——**只在今日维度出**(图 §一) */
      sub: key === 'bookings' && period === 'today' && now
        ? `在做 ${now.doing || 0} · 待到店 ${now.waiting || 0}` : '',
      live: key === 'bookings' && period === 'today',
      dimmed: key === hk,        // 正被放大的那一个:位置留着,数字淡出
    }
  })

  const items = ((todo && todo.items) || []).filter((x) => Number(x.n) > 0)
  items.sort((a, b) => (URGENT.includes(b.key) ? 1 : 0) - (URGENT.includes(a.key) ? 1 : 0))

  return {
    periods: PERIODS.map((p) => ({ ...p, on: p.key === period })),
    headKey: hk,
    headLabel: LABELS[hk],
    /* 三段式给页面(拿不到币种就三段全空,由 `headValue` 出「—」——零回落) */
    headParts: (() => {
      if (!MONEY_KEYS.includes(hk)) return { code: '', amount: String((head && head.value) != null ? head.value : '—'), cents: '' }
      const mk = makePartsFor(pulse && pulse.currencyDisplay, cur)
      if (!mk || !head || head.value == null) return { code: '', amount: '—', cents: '' }
      if (head.locked) return { code: '', amount: '••••', cents: '' }
      return mk(head.value)
    })(),
    /* 大数字也分钱与不是钱:新增持卡/到店人次是人数,不许套币符。
       ⚠️ `headValue` 现在**页面不用了**(页面渲染的是上面那三段 `headParts`)——
       它只剩「拿不到币种时出『—』」这一个用途与判据在用。
       05x §四 之后**它与 headParts 口径可能不同**(它走通用金额出口,带 `.00`),
       所以这里点名:**要显示就用 headParts,别捡 headValue 去渲染**,否则又是两种写法。 */
    headValue: MONEY_KEYS.includes(hk)
      ? (cur ? moneyText(head, fmt) : '—')
      : countText(head, hk === 'newCard' || hk === 'visits' ? ' 人' : ''),
    headDelta: deltaOf(head, period),
    /* dots:5 个,选中的那个会移动(图 §一) */
    dots: CAROUSEL.map((k) => ({ key: k, on: k === hk })),
    /* 全 0 不画折线(图 §六:无数据时不画,不是画一条贴地的线) */
    spark: head && (head.spark || []).some((x) => Number(x) !== 0) ? head.spark : [],
    smalls,
    asOf: asOfText(pulse, nowHM),
    /* 月目标:**门店没设就整块不出现**。现在全仓没有这个配置项 —— 所以恒不出现,
       而不是编一个百分比出来(D154 在网页端已经这么定了,两端同口径)。 */
    goal: null,
    /* 🔴 11m §三:AI 修图那张卡的 label/badge/hint **后端已经出好了**(soon 态的每个字都在那边),
       这里不许再拼一遍 —— `x.label ||` 那一段就是「后端给了就用后端的」。
       `soon` 的卡不算 urgent(它不是催人的事),也不进 todoEmpty 的计数口径外。 */
    todos: items.map((x) => ({ ...x, label: x.label || TODO_LABEL[x.key] || x.key, urgent: URGENT.includes(x.key) })),
    todoEmpty: items.length === 0,
    locked: Boolean(pulse && pulse.locked),
  }
}

module.exports = { makeMoneyFor, PERIODS, SMALL_KEYS, LABELS, TODO_LABEL, URGENT, DELTA_WORD, bookingsLabel, moneyText, countText, deltaOf, asOfText, buildOwnerHome }

/* ══════════ 段 10 · 员工视角:打卡门(图 v3.2 §二 两态)══════════

   店主要的东西一句话:**打卡不再是一条待办,是一道门**。
   没打卡 → 大屏位置只有一个「上班打卡」钮 + 今天的班次一句;
   打了卡 → 钮收起、业绩大屏**原地浮现**,右上角「✓ 已打卡 09:58」。

   三条容易做错的地方,写在这儿:
   ① **休息日 / 没排班不出打卡钮** —— 大屏直接显示,顶部一句「今天没有你的班」。
      这一句与台面同源(`closed` / 没有班次),**不另判**;
   ② **打卡失败不许假装打了** —— 钮不收起、钮下说清原因、不进大屏
      (「不可用即不呈现」的反面:没成功就不能演成成功);
   ③ 员工**看不到店的五个指标**,只看自己的业绩;维度只有今日 / 本月。 */

const STAFF_PERIODS = [{ key: 'today', label: '今日' }, { key: 'month', label: '本月' }]

/** 打卡门是什么态:`gate`(要先打卡)/ `open`(大屏可见)/ `off`(今天没班)。
 *  @param att 现有考勤接口 `/admin/attendance/today` 的原样返回,不另造一套形状 */
function clockGate(att, { scheduled = true, closed = false } = {}) {
  if (closed || !scheduled) {
    return { state: 'off', note: '今天没有你的班', showButton: false, showBoard: true, badge: '' }
  }
  const t = (att && att.today) || null
  const inAt = t && (t.clockInAt || t.clock_in_at || t.inAt)
  const outAt = t && (t.clockOutAt || t.clock_out_at || t.outAt)
  if (!inAt) {
    return { state: 'gate', note: '', showButton: true, showBoard: false, badge: '', action: 'in' }
  }
  return {
    state: 'open',
    note: '',
    showButton: false,
    showBoard: true,
    /* 角标说真话:下班打过卡就说已下班,没打就说已打卡几点 */
    badge: outAt ? `已下班 ${String(outAt).slice(11, 16) || outAt}` : `✓ 已打卡 ${String(inAt).slice(11, 16) || inAt}`,
    action: outAt ? '' : 'out',
  }
}

/** 打卡失败时说什么。**原样透出后端那句**,自己不翻译、不编 —— 后端才知道为什么不让打。 */
function clockFailText(err) {
  const msg = (err && (err.message || err.errMsg)) || ''
  return msg || '打卡没成功,请再试一次(连上店内 WiFi 会更顺)'
}

/** 员工那三个小数:今日单数(副行实时)/ 下一位 / 本周工时。**不是店里的五个指标**。 */
function staffSmalls({ perf, now, week }) {
  const next = (now && now.next) || null
  return [
    { key: 'myOrders', label: '今日单数', value: now && now.total !== undefined ? `${now.total} 单` : '—',
      sub: now ? `在做 ${now.doing || 0} · 待到店 ${now.waiting || 0}` : '', live: true },
    { key: 'next', label: '下一位', value: next ? `${next.time || ''}` : '—',
      sub: next ? [next.customer, next.service].filter(Boolean).join(' · ') : '后面没有了' },
    { key: 'weekHours', label: '本周工时',
      value: week && week.hours !== undefined && week.hours !== null ? `${week.hours} h` : '—',
      sub: '超时算加班' },
  ]
}

module.exports.STAFF_PERIODS = STAFF_PERIODS
module.exports.clockGate = clockGate
module.exports.clockFailText = clockFailText
module.exports.staffSmalls = staffSmalls
