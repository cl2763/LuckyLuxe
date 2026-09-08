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

function buildOwnerHome({ pulse, now, todo, period, nowHM, storeMoney, moneyFor }) {
  /* 钱的出口:按**这次下发的币种**绑一个;调用方给了 `moneyFor` 就用它(判据造景用)。
     两个都没有 → 一个钱数都不出(fail-closed)。 */
  const cur = pulse && pulse.currency
  const bound = makeMoneyFor(pulse && pulse.currencyDisplay, cur)
  const fmt = moneyFor ? (cents) => moneyFor(cents, cur) : (bound || storeMoney)
  const metrics = (pulse && pulse.metrics) || []
  const byKey = {}
  for (const m of metrics) byKey[m.key] = m
  const head = byKey.revenue || null

  const smalls = SMALL_KEYS.map((key) => {
    const m = byKey[key]
    const isMoney = key === 'cash' || key === 'cardUse'
    const unit = key === 'newCard' || key === 'visits' ? ' 人' : (key === 'bookings' ? ' 单' : '')
    return {
      key,
      label: key === 'bookings' ? bookingsLabel(period) : LABELS[key],
      value: isMoney ? (cur ? moneyText(m, fmt) : '—') : countText(m, unit),
      delta: deltaOf(m, period),
      /* 今日预约那一格的副行「在做 3 · 待到店 2」——**只在今日维度出**(图 §一) */
      sub: key === 'bookings' && period === 'today' && now
        ? `在做 ${now.doing || 0} · 待到店 ${now.waiting || 0}` : '',
      live: key === 'bookings' && period === 'today',
    }
  })

  const items = ((todo && todo.items) || []).filter((x) => Number(x.n) > 0)
  items.sort((a, b) => (URGENT.includes(b.key) ? 1 : 0) - (URGENT.includes(a.key) ? 1 : 0))

  return {
    periods: PERIODS.map((p) => ({ ...p, on: p.key === period })),
    headLabel: LABELS.revenue,
    headValue: cur ? moneyText(head, fmt) : '—',
    headDelta: deltaOf(head, period),
    /* 全 0 不画折线(图 §六:无数据时不画,不是画一条贴地的线) */
    spark: head && (head.spark || []).some((x) => Number(x) !== 0) ? head.spark : [],
    smalls,
    asOf: asOfText(pulse, nowHM),
    /* 月目标:**门店没设就整块不出现**。现在全仓没有这个配置项 —— 所以恒不出现,
       而不是编一个百分比出来(D154 在网页端已经这么定了,两端同口径)。 */
    goal: null,
    todos: items.map((x) => ({ ...x, label: TODO_LABEL[x.key] || x.key, urgent: URGENT.includes(x.key) })),
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
