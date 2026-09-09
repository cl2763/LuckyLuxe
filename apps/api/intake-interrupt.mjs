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

/* 待答问句长什么样、句读怎么切 —— 与 `reply-hygiene` 认的是同一个形状。
   两处都要用,所以放在这儿一份(一件事一处真相)。 */
const INTAKE_WORD = /(卸甲|卸睫|延长|下睫毛|断甲|参考图|指定技师|第一次做美睫|眼睛.{0,4}敏感|本甲|款式|哪天|几点方便)/
const Q_END = /[?\uff1f]\s*$/
const SEPS = ['\u3002', '!', '\uff01', '?', '\uff1f', '~', '\uff5e']

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

/* 🔴 D164(店主 05s 补四 亲测四轮咬出来的两处):
   ① 接回来的是**下一问**,而顾客连**当前这问**都还没答(「本甲还是延长」没答,却接了「是否需要卸甲」);
   ② 第二次中断后接了个**空的**「那我们接着说,」。
   病因是同一个:接回的那句取自「这一轮采集模板算出来的下一问」,
   而中断那一句本身会被采集当成一轮(「明天下午三点有位吗」还顺手填了日期/时间槽),
   于是问题往前跳了一格;跳到没有了就成了空串。

   改法:**待答那句从会话流水里取** —— 最近一条 AI 说的话,如果它以采集问句收尾,
   那一句就是「发出去了、顾客还没答」的那问(顾客要是答了,下一条 AI 就不会再问它)。
   这跟 D150 用同一个读口(全录是唯一读口),也天然扛住连续几次中断:
   每次接回的都还是同一句,直到顾客真答了为止。 */

/** 从最近一条 AI 原话里取出「待答的那句采集问句」。取不到就空串(空 = 不接)。 */
export function pendingQuestion(lastAssistantText = '') {
  const t = String(lastAssistantText || '').trim()
  if (!t) return ''
  let at = t.lastIndexOf('请问')
  if (at < 0) {
    const sep = Math.max(...SEPS.map((c) => t.lastIndexOf(c, t.length - 2)))
    at = sep >= 0 ? sep + 1 : 0
  }
  const tail = t.slice(at).trim()
  if (!Q_END.test(tail) || !INTAKE_WORD.test(tail)) return ''
  return tail
}

/** 把「那我们接着说」和待答的采集问句接回去。
 *  采集问句**原样**接,不重写 —— 重写就成了第二处真相(D153 同族)。
 *  🔴 没有待答那句就**一个字都不加** —— 「那我们接着说,」后面接空,比不接更糟。 */
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
export function fullBooked(day, { getAvailability, storeId, serviceId, date, humanDate, todayISO }, lang = 'zh', closed = false) {
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
  const line = lang === 'en' ? `${head} The next openings are ${say}.` : `${head}最近有位的是 ${say}。`
  /* D173 下半:把这两个替代日**带出去**存进状态 —— 顾客下一句说「就这个时间」时要拿它回话,
     不许现编一个日期(零编造红线)。函数仍然返回字符串,附带信息挂在 `.alts` 上。 */
  const boxed = new String(line)
  boxed.alts = alts.map((a) => ({ date: a.d, time: a.t }))
  return boxed
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
export function durationAnswer(service, lang = 'zh', scoped = null) {
  const min = Number(service?.durationMin || service?.base_duration_min || 0)
  if (min && String(service?.name || '').trim()) {
    return lang === 'en' ? `${service.name} takes about ${min} minutes.` : `${service.name}大概 ${min} 分钟。`
  }
  /* 🔴 D166 第二半(店主 05s 补四 那四轮的**真出口**,05t 段 5 现测定位):
     顾客说的「手绘定制」在价目表里**根本没有这个名字**(北京店叫「参考图定制款」),
     所以「点名」这条路走不通 —— 而当时的写法是「点不了名就回空串」,
     于是整个中断口让开,这一轮掉进了报价采集模板:
     它答了**全店 90–180 分钟**(跨美甲美睫),还**另起了一个新问题**
     (问「要不要卸甲」,而顾客上一句「本甲还是延长」根本还没答)—— 那是 D164 在这条路上的复发。

     裁:点不了名时**不再让开**,改成答**采集里已经确定的那个大类**的真实区间
     (美甲就只说美甲,不把美睫的时长掺进来),再由 `withResume` 把待答那句原样接回。
     这仍然是从库里来的数,没有一个字是编的;而「跨大类的范围」本身就是答非所问。 */
  const mins = (scoped?.mins || []).map(Number).filter((x) => x > 0)
  if (!mins.length) return ''
  const lo = Math.min(...mins)
  const hi = Math.max(...mins)
  const label = scoped?.label || ''
  const span = lo === hi ? `${lo} 分钟左右` : `${lo}–${hi} 分钟`
  return lang === 'en'
    ? `${scoped?.labelEn || 'These'} run about ${lo === hi ? `${lo}` : `${lo}–${hi}`} minutes.`
    : `${label}的项目大概 ${span}。`
}

/** 中断口总入口。答得出来才回一句,答不出来回 null(让原流程照旧)。
 *  @returns {{ kind: string, answer: string }|null} */
export function intakeInterrupt(deps, { text, lang = 'zh' } = {}) {
  const kind = classifyInterrupt(text)
  if (!kind) return null
  let answer = ''
  if (kind === 'availability') answer = availabilityAnswer({ ...deps, date: deps.resolveDate?.(text) }, lang)
  else if (kind === 'discount') answer = discountAnswer(deps.facts?.(), lang)
  /* D166(店主 05s 补四):**「点名」要看整段会话,不只看当句** ——
     会话里已经说过「手绘定制」,再问「做一次要多久」就该用它的时长。
     仍然守住「真没点名过就不答」:`service()` 找不到就回 null。 */
  else if (kind === 'duration') answer = durationAnswer(deps.service?.(text) || deps.serviceFromHistory?.(), lang, deps.scopedRange?.())
  return answer ? { kind, answer } : null
}

/** 把中断的答案与那句采集问句合成一条回复。**采集问句原样搬**,不重写。
 *  `reply` 的其它字段(source / intent / 英文句)一并保留 —— 只换文本那一格。 */
export function withResume(collectReply, cut, lang = 'zh', pending = '') {
  const d = collectReply?.data || {}
  /* 待答那句由调用方从会话流水取(D164);取不到就只发答案,不说「接着说」 */
  const zh = resumeText(cut.answer, pending, lang)
  return { ...collectReply, source: `${collectReply?.source || 'collect_template'}+interrupt_${cut.kind}`,
    data: { ...d, answerZh: zh || cut.answer, answerEn: cut.answer, handoffRequired: false } }
}

/** 中断口要的三样东西:查可约(真口)、本店折扣、命中的项目。
 *  全从库/真函数取 —— 这个装配函数本身**不产生任何事实**。
 *  放这儿而不是放 `local-server.mjs`:巨型文件只许搬出(公约③)。 */
export function intakeInterruptDeps({ db, tenantId, today, getAvailability, humanDate, discountFacts,
  matchService, parseBookingDate, formatMoneyCents, firstActiveStoreId, firstActiveService, history = [], serviceType = '' }) {
  const rows = () => db.prepare("SELECT id, name_zh, base_duration_min, price_mode, type FROM services WHERE tenant_id = ? AND is_active = 1 AND (item_kind IS NULL OR item_kind = 'main')").all(tenantId)
  return {
    getAvailability, humanDate, todayISO: today,
    storeId: firstActiveStoreId(),
    serviceId: firstActiveService()?.id,
    resolveDate: (txt) => parseBookingDate(txt, today),
    facts: () => discountFacts(db, tenantId, (c) => formatMoneyCents(c)),
    /* 没点名就回 null —— 拿别的项目的时长顶上去是编,不是答 */
    service: (txt) => matchService(txt, rows().map((r) => ({ id: r.id, name: r.name_zh, durationMin: r.base_duration_min, priceMode: r.price_mode || 'fixed' }))) || null,
    /* D166:当句没点名,就回头在**这段会话里顾客说过的话**里找(最近的优先)。
       整段都没提过任何项目 → 仍然回 null,照旧不答(不许拿第一个项目顶)。 */
    serviceFromHistory: () => {
      const list = rows().map((r) => ({ id: r.id, name: r.name_zh, durationMin: r.base_duration_min, priceMode: r.price_mode || 'fixed' }))
      for (const txt of (history || [])) {
        const hit = matchService(txt, list)
        if (hit) return hit
      }
      return null
    },
    /* D166:点不了名时的**大类区间**。类型取采集里已经确定的那个(nail/lash),
       没确定就不给 —— 不确定还敢报范围,那又是「跨大类答非所问」。 */
    scopedRange: () => {
      const t = String(serviceType || '').toUpperCase()
      if (t !== 'NAIL' && t !== 'LASH') return null
      const mins = rows().filter((r) => String(r.type || '').toUpperCase() === t)
        .map((r) => Number(r.base_duration_min || 0)).filter((x) => x > 0)
      if (!mins.length) return null
      return { mins, label: t === 'NAIL' ? '美甲' : '美睫', labelEn: t === 'NAIL' ? 'Nail services' : 'Lash services' }
    },
  }
}
