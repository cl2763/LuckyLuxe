/* D162 + D157 · 采集中被问别的,**先答再接回来**(店主 05s 补二 §三 裁待裁 #10)

   六通 v4 通六现场:顾客在报价采集里问「有优惠吗」,机器回「请问是否需要卸甲?」;
   问「明天下午三点有位吗」,机器直接转人工 —— **采集把顾客的新问题吞掉了**。
   真人客服不会这样:她会先答那一句,再说「那我们接着说,本甲还是延长?」。

   店主裁的形状(一个中断口,不是三个补丁):
   顾客这句被判成 **可约 / 优惠 / 时长** 三类之一 → 先答 → **把待答的那句采集问句原样接回去**。
   (价格那一类不在这儿 —— `fixedPriceAnswer` 排在报价采集之前,早就先答掉了。)

   ══ 三条答案各自的来源,一个都不许编 ══
   · **可约** → `getAvailability`(和 `/availability` 同一个函数)。**只许报它返回的时段**;
     没位就说没位,并给最近两个真有位的时段。05q 原文:「编一个『明天三点有位』比不回答坏得多」。
   · **优惠** → `discountFacts`(库里真有的券才说,没有就说没有)。
   · **时长** → `services.base_duration_min`(库里那个数)。
   三条都拿不到 → 回 null,让原流程照旧走(**宁可不答,不许编**)。

   ══ 为什么答完要把采集问句接回去 ══
   不接回去,采集就断在半路上 —— 顾客答完这一岔,机器已经忘了它在问什么(D157)。
   接回去时用「那我们接着说,」起头,让顾客知道这是回到刚才那件事。 */

/** 顾客这句是不是在打岔问别的。**只认这三类**,别的一律 null(不抢原流程的活)。 */
export function classifyInterrupt(text = '') {
  const t = String(text || '')
  if (!t) return null
  /* 可约:问的是「有没有位」。带时间词才算 —— 「有位吗」单说也算(默认问今天/明天)。 */
  if (/(有位|有空位|约得上|能约|可以约|排得上|还有位置|有没有位)/.test(t)) return 'availability'
  if (/(优惠|折扣|券|活动|便宜点|减免)/.test(t)) return 'discount'
  if (/(多久|多长时间|要几个?小时|几个钟|耗时|做多长)/.test(t)) return 'duration'
  return null
}

/** 把「那我们接着说」和待答的采集问句接回去。
 *  采集问句**原样**接,不重写 —— 重写就成了第二处真相(D153 同族)。 */
export function resumeText(answer, pendingQuestion, lang = 'zh') {
  const a = String(answer || '').trim()
  const q = String(pendingQuestion || '').trim()
  if (!a) return ''
  if (!q) return a
  return lang === 'en' ? `${a} Back to where we were — ${q}` : `${a} 那我们接着说,${q}`
}

/** 可约那一条:**只从 `getAvailability` 出真时段**。
 *  @returns {string} 答不出来就空串(空串 = 不答,不是编一个) */
export function availabilityAnswer({ getAvailability, storeId, serviceId, date, humanDate, todayISO }, lang = 'zh') {
  if (!getAvailability || !storeId || !serviceId || !date) return ''
  let res = null
  try { res = getAvailability({ storeId, serviceId, date }) } catch { return '' }
  if (!res) return ''
  const day = humanDate ? humanDate(date, todayISO, lang) : date
  const slots = (res.slots || []).filter(Boolean)
  if (res.closed) return fullBooked(day, { getAvailability, storeId, serviceId, date, humanDate, todayISO }, lang, true)
  /* 🔴 这一行原来直接 return「约满了」,把下面「给两个替代」整段**跳过去了** ——
     判据一跑就露:替代一个都没有。空 slots 与「切出来没时段」是同一件事,走同一条路。 */
  /* 有位:报**前两个真时段**。一个字都不编 —— 报的就是它返回来的那几个。
     🔴 `slots` 是**按技师分组**的:`[{ technician, slots: ['10:00','10:30'…] }]`,
     不是一维时间表。第一版当成一维切字符串,切出来是「ect]、ect]」——
     现测一眼看出来的。取值前先看清楚它长什么样,别照着想象切。 */
  const times = [...new Set(slots.flatMap((g) => (Array.isArray(g.slots) ? g.slots : [])))].sort()
  if (!times.length) return fullBooked(day, { getAvailability, storeId, serviceId, date, humanDate, todayISO }, lang)
  const two = times.slice(0, 2)
  return lang === 'en'
    ? `${day} still has ${two.join(' and ')}.`
    : `${day}还有 ${two.join('、')} 有位。`
}

/** 没位(或店休)时:**给最近两个真有位的日子**(店主 05s 补二 §三:「没位就给两个替代」)。
 *  往后找 7 天,每天都问一次同一个真函数 —— 替代日也不是编的。找不到就只说没位。 */
function fullBooked(day, { getAvailability, storeId, serviceId, date, humanDate, todayISO }, lang = 'zh', closed = false) {
  const head = closed
    ? (lang === 'en' ? `We're closed on ${day}.` : `${day}门店休息哦。`)
    : (lang === 'en' ? `${day} is fully booked.` : `${day}已经约满了。`)
  const alts = []
  const base = Date.parse(`${date}T12:00:00Z`)
  for (let i = 1; i <= 7 && alts.length < 2; i += 1) {
    const d = new Date(base + i * 86400000).toISOString().slice(0, 10)
    let r = null
    try { r = getAvailability({ storeId, serviceId, date: d }) } catch { r = null }
    const t = r && !r.closed ? [...new Set((r.slots || []).flatMap((g) => (Array.isArray(g.slots) ? g.slots : [])))].sort() : []
    if (t.length) alts.push({ d, t: t[0] })
  }
  if (!alts.length) return head
  const say = alts.map((a) => `${humanDate ? humanDate(a.d, todayISO, lang) : a.d} ${a.t}`).join('、')
  return lang === 'en' ? `${head} The next openings are ${say}.` : `${head}最近有位的是 ${say}。`
}

/** 优惠那一条:库里真有的券才说。 */
export function discountAnswer(facts, lang = 'zh') {
  if (!facts) return ''
  if (!facts.hasAny) return lang === 'en' ? 'We have no coupons running at the moment.' : '这会儿没有在跑的优惠哦。'
  const d = facts.items[0]
  return lang === 'en' ? `We have "${d.name}" (${d.off}).` : `现在有「${d.name}」${d.off}。`
}

/** 时长那一条:`services.base_duration_min` 里那个数。
 *  🔴 **只在顾客点了名的项目上答**。没点名就不答(回空串)——
 *  现测第一版拿「店里第一个项目」的时长顶上去,答出「这个大概 90 分钟」,
 *  而顾客问的根本不是那个项目:那是编,不是答(零编造红线)。 */
export function durationAnswer(service, lang = 'zh') {
  const min = Number(service?.durationMin || service?.base_duration_min || 0)
  if (!min || !String(service?.name || '').trim()) return ''
  return lang === 'en' ? `${service.name} takes about ${min} minutes.` : `${service.name}大概 ${min} 分钟。`
}

/** 中断口总入口。答得出来才回一句,答不出来回 null(让原流程照旧)。
 *  @returns {{ kind: string, answer: string }|null} */
export function intakeInterrupt(deps, { text, lang = 'zh' } = {}) {
  const kind = classifyInterrupt(text)
  if (!kind) return null
  let answer = ''
  if (kind === 'availability') answer = availabilityAnswer({ ...deps, date: deps.resolveDate?.(text) }, lang)
  else if (kind === 'discount') answer = discountAnswer(deps.facts?.(), lang)
  else if (kind === 'duration') answer = durationAnswer(deps.service?.(text), lang)
  return answer ? { kind, answer } : null
}

/** 把中断的答案与那句采集问句合成一条回复。**采集问句原样搬**,不重写。
 *  `reply` 的其它字段(source / intent / 英文句)一并保留 —— 只换文本那一格。 */
export function withResume(collectReply, cut, lang = 'zh') {
  const d = collectReply?.data || {}
  const zh = resumeText(cut.answer, d.answerZh || '', lang)
  return { ...collectReply, source: `${collectReply?.source || 'collect_template'}+interrupt_${cut.kind}`,
    data: { ...d, answerZh: zh || d.answerZh, answerEn: resumeText(cut.answer, d.answerEn || '', 'en') || d.answerEn } }
}

/** 中断口要的三样东西:查可约(真口)、本店折扣、命中的项目。
 *  全从库/真函数取 —— 这个装配函数本身**不产生任何事实**。
 *  放这儿而不是放 `local-server.mjs`:巨型文件只许搬出(公约③)。 */
export function intakeInterruptDeps({ db, tenantId, today, getAvailability, humanDate, discountFacts,
  matchService, parseBookingDate, formatMoneyCents, firstActiveStoreId, firstActiveService }) {
  const rows = () => db.prepare("SELECT id, name_zh, base_duration_min, price_mode FROM services WHERE tenant_id = ? AND is_active = 1 AND (item_kind IS NULL OR item_kind = 'main')").all(tenantId)
  return {
    getAvailability, humanDate, todayISO: today,
    storeId: firstActiveStoreId(),
    serviceId: firstActiveService()?.id,
    resolveDate: (txt) => parseBookingDate(txt, today),
    facts: () => discountFacts(db, tenantId, (c) => formatMoneyCents(c)),
    /* 没点名就回 null —— 拿别的项目的时长顶上去是编,不是答 */
    service: (txt) => matchService(txt, rows().map((r) => ({ id: r.id, name: r.name_zh, durationMin: r.base_duration_min, priceMode: r.price_mode || 'fixed' }))) || null,
  }
}
