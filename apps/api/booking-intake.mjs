/* ③ 预约采集状态机(图 v1.2 §二)—— **规则层写状态,模型只抽槽与说话**

   ══ 为什么要有它(靶子就是 05h 测出来的三个数)══
   现在顾客说「明天下午三点有空吗」,得到的是**一整张 7 项表**。
   05h 基线(12 通「想约」× 真模型):**到底 0 通 · 被丢 7 项表 10 通 · 中途进人工 7 通**。
   这一批要把这三个数改成:一句一问、查真可约、顾客确认了才建草稿。

   ══ 态与出口(照图,不自行发挥)══
   `idle → collecting → checking → drafted → booked`
   · collecting  每句抽槽,**只问缺的,一次一问**;项目对到本店价目,需报价 → 交给现有报价采集
   · checking    查**真** `/availability`:有位 → 报定金;无位 → 给最近 3 个可约时段
   · drafted     建 `booking_drafts` **一行并复用**;顾客再问别的 → 带草稿上下文答,**不复建**

   ══ 三条不许碰的线 ══
   ① 报价采集(`quote_intake_*`,21 个套件)**一字不动** —— 需报价的项目转过去,回来继续;
   ② 模型**不写任何库字段**(图 §七):它只交 slots,写状态与建草稿都在这里;
   ③ 时段只许来自 `/availability` 的返回集合 —— 编一个「明天三点有位」比不回答坏得多。 */

/* 槽位:图 §二 collecting 那一行点名的五个 */
export const SLOT_KEYS = ['serviceType', 'date', 'time', 'technician', 'addons']

/* 一次只问一个 —— **顺序固定**,不然同一通对话里问题会跳来跳去。
   问法写成人话,不写成表单标签(「项目类型:」那种就是 7 项表的味道)。 */
const ASK = [
  ['serviceType', '您想做美甲还是美睫呀?', 'Would you like nails or lashes?'],
  ['date', '想约哪天呢?', 'Which day works for you?'],
  ['time', '大概几点方便?', 'What time suits you?'],
]

/* 从模型给的 slots 里挑出**这一句**新抽到的,合并进已有的槽。
   只认非空串;模型抽不到会给空,空的不许覆盖已经问到的(否则顾客补一句就把前面清了)。 */
export function mergeSlots(prev = {}, incoming = {}) {
  const out = { ...prev }
  for (const k of SLOT_KEYS) {
    const v = incoming?.[k]
    if (v === undefined || v === null) continue
    if (Array.isArray(v)) { if (v.length) out[k] = v; continue }
    const s = String(v).trim()
    if (s) out[k] = s
  }
  return out
}

/* 三槽齐了才能去查可约 */
export const isReadyToCheck = (slots = {}) =>
  Boolean(String(slots.serviceType || '').trim() && String(slots.date || '').trim() && String(slots.time || '').trim())

/* 下一个该问的槽(只问缺的);都齐了回 null */
export function nextMissing(slots = {}) {
  for (const [key, zh, en] of ASK) {
    if (!String(slots[key] || '').trim()) return { key, zh, en }
  }
  return null
}

/* 「顾客在确认」的形状 —— 只认明确的应答,含糊的(「嗯」「哦」)不算,
   宁可多问一句,也不要替顾客把单建了。 */
const CONFIRM_HEAD = /^(好的?|行|可以|就这个|就这样|就它|定了|确定|确认|对|是的|没错|ok|okay|yes|sure|sounds good|book it)/i
/* 带问号/疑问词的一律不是确认 —— 「好的话要等多久」开头也是「好」,但它在问事。 */
const ASKING = /[??]|吗|呢|多久|多少|几点|哪天|怎么|能不能|可不可以|还是/
/* 确认后面常跟一小截附和(「好的,就这个时间」「行,就这样吧」)——
   `^…$` 那种整串锚定认不出来,而顾客**就是这么说话的**:
   现测 12 通里「好的,就这个时间」一句都没被认成确认,于是一张草稿都建不出来。 */
const CONFIRM_TAIL = /^[,,、\s]*(就(这个|这样|它|这个时间|那个时间)?|这个|那就这样|吧|谢谢|thanks|please)*[!!。.~\s]*$/i
export const looksConfirm = (text = '') => {
  const t = String(text || '').trim()
  if (!t || ASKING.test(t)) return false
  const head = t.match(CONFIRM_HEAD)
  if (!head) return false
  return CONFIRM_TAIL.test(t.slice(head[0].length))
}

/* 顾客在改时间 → 回 collecting 重问 */
export const looksReschedule = (text = '') =>
  /换个?时间|改个?时间|别的时间|另外的时间|换一天|其他时间|another time|different time/i.test(String(text || ''))

/* ── 规则层补槽 ────────────────────────────────────────────────
   图 §二 写的是「模型从每句话抽槽位」。这里**不替代模型**,只做一件事:
   **模型没抽到的,用规则补上**(`mergeSlots` 的空值不覆盖律保证模型抽到的优先)。

   为什么必须有:模型漏抽一个「明天」,整通对话就卡在反复追问同一个槽 ——
   而日期/时间/项目这三样恰好是正则最稳的东西。判据角度也需要它:
   没有它,mock 模式下机器永远走不到 checking/drafted,㋐㋑两把刀**一次都咬不动**
   (零命中的判据等于没有判据)。 */

const WEEKDAY = { '日': 0, '天': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 }
const EN_WEEKDAY = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 }
const CN_NUM = { '零': 0, '一': 1, '两': 2, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 }

/* 中文数字/阿拉伯数字都收(「三点」「3点」「十一点」) */
function cnHour(raw) {
  const t = String(raw || '').trim()
  if (/^\d{1,2}$/.test(t)) return Number(t)
  if (t === '十') return 10
  const m = t.match(/^十([一二三四五六七八九])$/)
  if (m) return 10 + CN_NUM[m[1]]
  return CN_NUM[t] ?? null
}

/* 把「明天/后天/周六/9月8日/2026-09-08」解析成 YYYY-MM-DD。
   **基准日必须由调用方给**(门店时区的今天)—— 这里不许 `new Date()`(店在多伦多,店主常在别的时区)。 */
export function parseDate(text, todayISO) {
  const t = String(text || '')
  const iso = t.match(/(20\d{2})-(\d{2})-(\d{2})/)
  if (iso) return iso[0]
  const base = new Date(`${todayISO}T12:00:00Z`)
  const shift = (n) => new Date(base.getTime() + n * 86400000).toISOString().slice(0, 10)
  if (/今天|today/i.test(t)) return shift(0)
  if (/明天|tomorrow/i.test(t)) return shift(1)
  if (/后天/.test(t)) return shift(2)
  const md = t.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/)
  if (md) return `${todayISO.slice(0, 4)}-${String(md[1]).padStart(2, '0')}-${String(md[2]).padStart(2, '0')}`
  /* 模型很爱直接回英文星期(现测:它把「周六」抽成 `"Saturday"`)——
     那串东西原样喂给 `/availability` 就是 `Invalid time value`,整通对话转人工。
     槽位归一化是**规则层的活**:模型说什么都行,能不能用由这里说了算。 */
  const en = t.trim().toLowerCase().match(/^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/)
  if (en) {
    const want = EN_WEEKDAY[en[1]]
    const cur = base.getUTCDay()
    let d = (want - cur + 7) % 7
    if (d === 0) d = 7
    return shift(d)
  }
  if (/^tomorrow$/i.test(t.trim())) return shift(1)
  if (/^today$/i.test(t.trim())) return shift(0)
  const wd = t.match(/(?:周|星期|礼拜)\s*([一二三四五六日天])/)
  if (wd) {
    const want = WEEKDAY[wd[1]]
    const cur = base.getUTCDay()
    let delta = (want - cur + 7) % 7
    if (delta === 0) delta = 7            // 「周六」在周六说,指的是下个周六
    return shift(delta)
  }
  return ''
}

/* 只说了个时段(「下午都行」「上午吧」)——**不是没说,也不是说定了**。
   合同 §二 checking 那一行给的正是这种情况的答案:给最近 3 个可约时段。
   现测:12 通里有 2 通卡在这儿(「周五下午都行」),机器一直追问「几点」,顾客一直没答。 */
export const PERIODS = { 上午: [0, 720], 中午: [660, 840], 下午: [720, 1080], 晚上: [1020, 1440] }
export function periodOf(text = '') {
  const t = String(text || '')
  for (const key of ['上午', '中午', '下午', '晚上']) {
    if (t.includes(key)) return key
  }
  if (/morning/i.test(t)) return '上午'
  if (/afternoon/i.test(t)) return '下午'
  if (/evening|tonight/i.test(t)) return '晚上'
  return ''
}

/* 「下午三点」「15:00」「晚上7点半」→ HH:MM(半点收进来,`timeHit` 再去可约集合里对) */
export function parseTime(text) {
  const t = String(text || '').replace(/\s/g, '')
  const hhmm = t.match(/([01]?\d|2[0-3])[::](\d{2})/)
  if (hhmm) return `${String(hhmm[1]).padStart(2, '0')}:${hhmm[2]}`
  /* 模型也会回 `3pm` / `10 AM` —— 同样是「模型说什么都行,归一化在规则层」 */
  const ampm = t.match(/(\d{1,2})\s*(am|pm)/i)
  if (ampm) {
    let h = Number(ampm[1]) % 12
    if (/pm/i.test(ampm[2])) h += 12
    return `${String(h).padStart(2, '0')}:00`
  }
  const m = t.match(/(上午|中午|下午|晚上)?(\d{1,2}|[零一两二三四五六七八九十]{1,2})\s*点\s*(半)?/)
  if (!m) return ''
  let h = cnHour(m[2])
  if (h === null) return ''
  if (/下午|晚上/.test(m[1] || '') && h < 12) h += 12
  if (m[1] === '中午' && h < 12) h += 12
  return `${String(h).padStart(2, '0')}:${m[3] ? '30' : '00'}`
}

/* 归一化:槽位无论来自模型还是规则,**出这道门必须是能用的形状**。
   日期不是 YYYY-MM-DD、时间不是 HH:MM 的,一律**丢掉重问**,不许原样往下游传 ——
   下游是 `/availability`,喂它一个 `"Saturday"` 就是 500/转人工,而顾客只会觉得「这机器人不行」。 */
export function normalizeSlots(slots = {}, todayISO = '') {
  const out = { ...slots }
  const d = String(out.date || '').trim()
  if (d) {
    out.date = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : parseDate(d, todayISO)
    if (!out.date) delete out.date
  }
  const t = String(out.time || '').trim()
  if (t) {
    out.time = /^([01]?\d|2[0-3]):[0-5]\d$/.test(t) ? t.padStart(5, '0') : parseTime(t)
    if (!out.time) delete out.time
  }
  return out
}

/* 「这句话是在**约时间**吗」—— ③ 该不该从报价采集手里接管,判据就这一条。

   🔴 头一版写成「服务开始意向 or 预约询问」,把「哈喽,想做美甲」也抢了 ——
   而 **美甲是需报价项目**,图 §二 白纸黑字:「需报价的项目 → 转报价采集」。
   `test-working-memory` 当场红(first nail inquiry should return intake template),
   红得对:那是我抢错了,不是判据过时。

   所以收窄成:**明确在说「约/位子/空位」**,或者「想做 X」并且**带了日期/时间/时段**。
   反向守过 `大约多少钱` / `延长大约要多久` —— 都带「约」字,都不许抢。 */
/* 强信号:句子本身就在要时间/问位子 —— 即使顺带提了项目,也归 ③ */
const BOOKING_STRONG = /预约|约个时间|约一个时间|约时间|位子|位置还有|空位|有位|有空|排得上|约吗|能约|可以约|帮我约/
/* 弱信号:只是「想约个 X」—— 项目名一出来,**需报价的先走报价采集**(图 §二),
   除非同时给了具体日期/时间/时段,那才说明他真在挑时间。 */
const BOOKING_WEAK = /想约|要约|约个|约一个/

/* **问规则 ≠ 要约时间。**「预约需要付定金吗?定金多少?」里有「预约」二字,
   但顾客要的是政策口径,不是要我给他占个位;「你们周日营业吗?」同理。
   带这些词一律让开 —— 宁可少接管,也不许把一个问规则的人拖进采集流程。
   三条都是回归咬出来的:定金(intent-guards)、营业时间(business-hours)、地址(intent-guards)。 */
const POLICY_ASK = /定金|押金|订金|取消|改期|退款|退钱|多少钱|价格|价目|怎么算|规则|政策|收费|贵不贵|营业|开门|关门|地址|怎么走|联系方式/

export function hasBookingSignal(text = '', todayISO = '', serviceStart = false) {
  const t = String(text || '')
  if (POLICY_ASK.test(t)) return false
  if (BOOKING_STRONG.test(t)) return true
  const r = extractSlotsByRule(t, todayISO)
  const concrete = Boolean(r.date || r.time || periodOf(t))
  if (!concrete) return false
  return BOOKING_WEAK.test(t) || serviceStart
}

export function extractSlotsByRule(text, todayISO) {
  const t = String(text || '')
  const out = {}
  if (/美睫|睫毛|lash/i.test(t)) out.serviceType = '美睫'
  else if (/美甲|指甲|nail|manicure/i.test(t)) out.serviceType = '美甲'
  const d = parseDate(t, todayISO)
  if (d) out.date = d
  const tm = parseTime(t)
  if (tm) out.time = tm
  return out
}

export function createBookingIntake(deps) {
  const {
    getConversationState, getAvailability,
    firstActiveStoreId, firstActiveService, createBookingDraft, depositPolicyText,
    existingDraftFor, hasBookingIntentByRule, todayISO, onLookupFailed,
  } = deps
  for (const [name, fn] of Object.entries(deps)) {
    if (typeof fn !== 'function') throw new Error(`createBookingIntake 缺依赖或类型不对:${name}`)
  }

  /* 查真可约。**任何时段都从这里的返回集合里取**,不许自己拼。
     查不动(店没设营业时间/服务不存在)就回 null,由调用方转人工 —— 不许假装有位。 */
  function realSlots({ tenantId, slots }) {
    try {
      const storeId = firstActiveStoreId()
      const service = firstActiveService(/睫|lash/i.test(String(slots.serviceType || '')) ? 'lash' : 'nail')
      if (!storeId || !service) {
        onLookupFailed({ reason: `本店没有可用的${storeId ? '服务' : '门店'}`, date: slots.date, serviceType: slots.serviceType })
        return null
      }
      const av = getAvailability({ storeId, serviceId: service.id, date: slots.date })
      const flat = []
      for (const tech of av?.slots || []) {
        for (const s of tech.slots || []) flat.push(String(s.time || s))
      }
      return { storeId, service, times: [...new Set(flat)].sort() }
    } catch (e) {
      /* 查不动就转人工是对的,但**不许连原因都吞掉** —— 静默失败器族。
         现测就吃过这个亏:10/12 通转人工,而日志里一个字都没有,只能靠猜。 */
      onLookupFailed({ reason: e?.message || String(e), date: slots.date, serviceType: slots.serviceType })
      return null
    }
  }

  /* 顾客说的时间是不是真在可约集合里 —— 只做前缀比对(顾客说「三点」,集合里是「15:00」) */
  const timeHit = (want, times) => {
    const w = String(want || '').replace(/\s/g, '')
    const norm = w.replace(/下午(\d{1,2})点?/, (_, h) => `${Number(h) < 12 ? Number(h) + 12 : h}:00`)
      .replace(/上午(\d{1,2})点?/, (_, h) => `${String(h).padStart(2, '0')}:00`)
      .replace(/(\d{1,2})点/, (_, h) => `${String(h).padStart(2, '0')}:00`)
    return times.find((t) => t === norm || t.startsWith(norm)) || null
  }

  /* 单一入口:回 { reply, state } 或 null(null = 这一句不归我管,交回原流程) */
  function step({ tenantId, conversationId, text, lang, modelSlots, intent }) {
    const st = getConversationState(conversationId) || {}
    const s = st.state || {}
    const stage = s.bookingStage || 'idle'
    const zh = lang !== 'en'

    /* 已经有草稿:带着草稿上下文答,**不再建**(图 §二 drafted 那一行) */
    if (stage === 'drafted') {
      /* 顾客要改时间 → 回 collecting 重问;草稿**不复建**(下面 checking 段有 already>0 兜底) */
      if (looksReschedule(text)) {
        return {
          reply: say(zh, '好的,那您想改到几点呢?', 'Sure — what time would you like instead?'),
          stage: 'collecting',
          statePatch: { ...s, bookingStage: 'collecting', bookingSlots: { ...(s.bookingSlots || {}), time: '' } },
        }
      }
      /* 又确认一次(「好的」「确认」)→ 把**同一张**草稿再说一遍,不建第二张。
         图 §二 写的是「草稿只建一次」;这里如实回同一个 id,判据才验得到「只建了一次」。 */
      if (looksConfirm(text)) {
        const held = existingDraftFor(conversationId)
        return {
          reply: say(zh, '这单我已经给您留着了,不用重复约哦。', "I've already held this for you — no need to book again.", { draftId: held }),
          stage: 'drafted',
          statePatch: { ...s, bookingStage: 'drafted', bookingDraftId: held },
        }
      }
      /* 问别的(地址/价格/……)→ 交回原流程照答,**带着草稿上下文,不再建**(图 §二 drafted) */
      return null
    }

    /* 进 collecting 的触发有两路,**规则层这一路是必须的**:
       模型心情不好不给 `intent:'booking'` 时,「我想预约」整通就掉回泛泛回答或 7 项表 ——
       那正是 05h 基线(到底 0/12、被丢表 10/12)的样子。规则层写状态(图 §二),不把状态托付给模型。
       规则这一路的边界见 `hasBookingSignal`:**只认在说「约时间」的句子**,
       「想做美甲」这种需报价的开场不抢,留给报价采集。 */
    const today = todayISO()
    const isBooking = intent === 'booking' || hasBookingIntentByRule(text, today)
      || stage === 'collecting' || stage === 'checking'
    if (!isBooking) return null

    /* 顾客要改时间 → 回 collecting,把 time 清掉重问 */
    if (stage === 'checking' && looksReschedule(text)) {
      const slots = { ...(s.bookingSlots || {}), time: '' }
      return {
        reply: say(zh, '好的,那您想换到几点呢?', 'Sure — what time would you prefer?'),
        stage: 'collecting',
        statePatch: { ...s, bookingStage: 'collecting', bookingSlots: slots },
      }
    }

    /* 模型先、规则补:`mergeSlots` 的「空值不覆盖」保证模型抽到的赢 */
    const byRule = extractSlotsByRule(text, today)
    const slots = normalizeSlots(
      mergeSlots(mergeSlots(s.bookingSlots || {}, byRule), modelSlots || {}), today)

    /* checking 段顾客确认 → 建草稿(**只建一次**) */
    if (stage === 'checking' && looksConfirm(text)) {
      /* 图 §二 drafted:「建 `booking_drafts` 一行并**复用**」——
         幂等判据律:问的是「**建过没有**」,不是「现在还剩几张」。 */
      const already = existingDraftFor(conversationId)
      if (already) {
        return {
          reply: say(zh, '这单我已经给您留着了,不用重复约哦。', "I've already held this for you — no need to book again.", { draftId: already }),
          stage: 'drafted',
          statePatch: { ...s, bookingSlots: slots, bookingStage: 'drafted', bookingDraftId: already },
        }
      }
      const real = realSlots({ tenantId, slots })
      const hit = real ? timeHit(slots.time, real.times) : null
      if (!real || !hit) {
        /* 顾客说了「好的」,但他要的那个点其实没位(常见:我们刚给了三个选项,他回「好的」)。
           **别转人工,也别替他挑一个** —— 把选项再摆一遍,问他要哪个。
           现测:12 通里有 2 通就是在这一步白白进了人工。 */
        const near = (real?.times || []).slice(0, 3)
        if (near.length) {
          return {
            reply: say(zh, `您要 ${near.join(' / ')} 里的哪一个呢?`, `Which one would you like — ${near.join(' / ')}?`),
            stage: 'checking', statePatch: { ...s, bookingSlots: { ...slots, time: '' } },
          }
        }
        return {
          reply: say(zh, '这个时间我这边核不上,我请同事帮您确认一下。', "I couldn't verify that time — I'll have a colleague confirm."),
          handoff: true, statePatch: { ...s, bookingSlots: slots },
        }
      }
      const draft = createBookingDraft({
        conversationId, storeId: real.storeId, serviceId: real.service.id,
        date: slots.date, time: hit, sourceChannel: 'ai_booking_intake',
      }, {})
      const dep = depositPolicyText()
      return {
        reply: say(zh,
          `好的,${slots.date} ${hit} 给您留着了。${dep ? dep : ''}`,
          `Great — ${slots.date} ${hit} is held for you. ${dep || ''}`,
          { draftId: draft?.id || null }),
        stage: 'drafted',
        statePatch: { ...s, bookingSlots: slots, bookingStage: 'drafted', bookingDraftId: draft?.id || null },
      }
    }

    /* 三槽齐 → 查真可约 */
    if (isReadyToCheck(slots)) {
      const real = realSlots({ tenantId, slots })
      const checkingPatch = { ...s, bookingSlots: slots, bookingStage: 'checking' }
      if (!real) {
        return {
          reply: say(zh, '我这边暂时查不到这天的排班,先帮您转给同事确认。', "I can't pull that day's schedule — passing this to a colleague."),
          handoff: true, statePatch: checkingPatch,
        }
      }
      const hit = timeHit(slots.time, real.times)
      if (hit) {
        const dep = depositPolicyText()
        return {
          reply: say(zh,
            `${slots.date} ${hit} 有位子。${dep ? dep + ' ' : ''}要我先帮您留着吗?`,
            `${slots.date} ${hit} is available. ${dep ? dep + ' ' : ''}Shall I hold it for you?`),
          stage: 'checking', statePatch: checkingPatch,
        }
      }
      /* 无位:给最近 3 个 —— **都必须在返回集合里**(图 §二 checking) */
      const near = real.times.slice(0, 3)
      if (!near.length) {
        return {
          reply: say(zh, '这天已经约满了,我请同事看看别的安排。', "That day is fully booked — I'll ask a colleague about alternatives."),
          handoff: true, statePatch: checkingPatch,
        }
      }
      return {
        reply: say(zh,
          `这个点没位子了,${slots.date} 还剩 ${near.join(' / ')},您看哪个方便?`,
          `That time is taken. On ${slots.date} we still have ${near.join(' / ')} — which works?`),
        stage: 'checking', statePatch: checkingPatch,
      }
    }

    /* 只报了时段(「下午都行」)且日期项目都齐 → 别再追问钟点,**直接把那个时段的真时段报出来** */
    const period = !String(slots.time || '').trim() ? periodOf(text) || periodOf(s.lastPeriod || '') : ''
    if (period && String(slots.serviceType || '').trim() && String(slots.date || '').trim()) {
      const real = realSlots({ tenantId, slots })
      const [lo, hi] = PERIODS[period]
      const inPeriod = (real?.times || []).filter((t) => {
        const [h, m] = t.split(':').map(Number)
        const mins = h * 60 + m
        return mins >= lo && mins < hi
      })
      const patch = { ...s, bookingSlots: slots, bookingStage: 'checking', lastPeriod: period }
      if (inPeriod.length) {
        return {
          reply: say(zh, `${slots.date} ${period}还剩 ${inPeriod.slice(0, 3).join(' / ')},您看哪个方便?`,
            `On ${slots.date} we have ${inPeriod.slice(0, 3).join(' / ')} — which works?`),
          stage: 'checking', statePatch: patch,
        }
      }
      if (real) {
        const near = real.times.slice(0, 3)
        if (near.length) {
          return {
            reply: say(zh, `${slots.date} ${period}没位子了,还剩 ${near.join(' / ')},您看哪个方便?`,
              `${period} is full on ${slots.date}. We still have ${near.join(' / ')} — which works?`),
            stage: 'checking', statePatch: patch,
          }
        }
      }
    }

    /* 还缺槽 → **只问缺的,一次一问** */
    const miss = nextMissing(slots)
    return {
      reply: say(zh, miss.zh, miss.en), stage: 'collecting',
      statePatch: { ...s, bookingSlots: slots, bookingStage: 'collecting' },
    }
  }

  /* `extra` 现在只用来带 `draftId` —— 草稿 id 必须能被顾客端与判据看见:
     图 §二 drafted 那一行要求「说清下一步(草稿链接 / 定金怎么付)」,
     判据这边也靠它验「只建了一次」(全仓没有 GET 列表口,拿计数验等于永远 0 —— 现测栽过)。 */
  const say = (zh, textZh, textEn, extra = {}) => ({
    data: {
      intent: 'booking',
      answerZh: textZh,
      answerEn: textEn,
      handoffRequired: false,
      gate: 'booking_intake',
      ...extra,
    },
    source: 'booking_intake',
  })

  return { step }
}
