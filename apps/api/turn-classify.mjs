/* D145 · 采集态每句话先分类 —— 「这句是给槽、是在问、还是在收尾」

   ══ 病根(05o §二,Cowork 逐句读五通 v2 读出来的)══
   采集态(报价采集 `quoting` / 预约采集 `collecting`)里,**每一句顾客的话都被当成「要么给槽、要么没给槽」**。
   于是:
   · 「大概要多久」   → 「请问是否需要卸甲?」   ← 答非所问
   · 「好的谢谢你啦」 → 「请问是否有断甲?」     ← 人家在道别
   · 「预算不多,能推荐吗」→ 「是否需要下睫毛?」 ← 人家在问最便宜的
   · 「我再想想」     → 继续追下一格           ← 该让开一轮
   七处现象,**一个病根**:分类只有「给槽 / 没给槽」两档。

   ══ 这个模块干什么 ══
   把一句话分成 **slot | question | farewell | hesitate | budget | other** 六档,
   并给出每一档该有的**出句**(后端唯一出口,两端同一句;前端零拼串)。
   它**只做分类与出句**,不碰任何状态机 —— 谁调用谁决定怎么用,便于逐条挨刀。

   ══ 判据形状(《判据律》:这条判据在缺陷存在时会不会照样绿?)══
   造病做法固定:把 `classifyTurn` 退化成「只认 slot」(见 `DEGRADED_FOR_KNIFE`),
   那七句里至少 4 句会掉回 `other` —— 判据必须当场红。 */

/* 道别:**开头**就在谢/别(「好的谢谢你啦」也算),不是句中带个「谢」就算。
   为什么锚开头:「那就 10:30,谢谢」是确认+给槽,不是道别 —— 锚开头才分得开。 */
const FAREWELL = /^\s*(好的?|行|嗯|ok|okay)?[\s,,、~]*(谢谢|多谢|感谢|thanks|thank you|thx|辛苦了?|麻烦你了?|拜拜|再见|bye|回头见|就这样吧?|不用了|没有了|没了|暂时没有|先这样|先这些)/i

/* 犹豫:要的是「让开一轮」,不是继续追问下一格 */
const HESITATE = /(我再想想|再想想|考虑一下|再考虑|再看看|看看再说|等我想好|想好了?再|先不(约|定|急)|还没想好|不太确定|拿不准|纠结|犹豫)/

/* 预算型:顾客在问「最便宜的是哪个」——该报价目里最便宜的 1–2 项,不是继续追缺项 */
const BUDGET = /(预算|便宜|最划算|划算|性价比|不想花太多|花太多|经济一?点|实惠|学生党|多少钱以内|便宜的?是?哪)/

/* 在问事:问号、疑问词、或典型的「多久/贵不贵」。
   注意与 `booking-intake` 的 `ASKING` 是两套:那一条是为「这句是不是确认」服务的(宁可放过),
   这一条是为「要不要先答再问」服务的(宁可多认)。**故意不共用** —— 两处要的松紧不同。 */
/* AABB 反复问句(「会不会」「行不行」「疼不疼」)是中文口语里最常见的一种问法,
   首版漏了 —— 判据锚的第 9 句「会不会很快就掉」当场把它揪出来。
   通用式 `(.)不\1` 收全这一类,不再一个个列(黑名单式列举永远漏没列的)。 */
const QUESTION = /[??]|吗|呢|多久|多长时间|几点|哪天|哪种|哪个|怎么|如何|什么时候|多少|([\u4e00-\u9fa5])不\1/

/* 一句话里同时像好几档时的**优先级**(高在前)。写死在这儿是为了让判据能逐条验:
   道别 > 犹豫 > 预算 > 给槽 > 在问 > 其它。
   为什么道别最高:「好的谢谢你啦」既像确认又像道别,当成确认就会**替顾客把单建了**;
   为什么给槽压过在问:「周日行吗?」既给了日期又是疑问句,**先把槽收下**再顺口答,
   比「让开一轮、日期丢掉」体验好得多(通四「那周日行吗」正是栽在这儿)。 */
export const TURN_KINDS = ['farewell', 'hesitate', 'budget', 'slot', 'question', 'other']

/* 造病开关:只给判据用。打开后退化成「只认 slot」,复刻 D145 修复前的行为。
   放在产品代码里是刻意的 —— 《刀留痕律》要的是「刀真落下去了」有凭据,
   而不是判据自己另写一份平行实现去「模拟」缺陷(那样验的是判据自己)。 */
export const DEGRADED_FOR_KNIFE = { on: false }

export function classifyTurn(text = '', { gaveSlot = false } = {}) {
  const t = String(text || '').trim()
  if (DEGRADED_FOR_KNIFE.on) return gaveSlot ? 'slot' : 'other'
  if (!t) return 'other'
  if (FAREWELL.test(t)) return 'farewell'
  if (HESITATE.test(t)) return 'hesitate'
  if (BUDGET.test(t)) return 'budget'
  if (gaveSlot) return 'slot'
  if (QUESTION.test(t)) return 'question'
  return 'other'
}

/* ── 各档的出句(后端唯一出口)────────────────────────────────
   都不带问号 —— 这几档的要害就是**这一轮别再追问**。 */
export const TURN_TEXT = {
  farewell: {
    zh: '好的呀,随时找我就行,祝您今天愉快~',
    en: "Anytime — just message me whenever. Have a lovely day!"
  },
  hesitate: {
    zh: '不着急的,您慢慢看,想好了随时跟我说。',
    en: 'No rush at all — take your time and just let me know when you decide.'
  }
}

/* 复述变化(D145 通四:「还是改成美睫吧」「那周日行吗」→ 机器连问两次「大概几点方便?」,
   顾客根本不知道自己改的那两样有没有被听进去)。
   规则:**槽变了就先说出来**,再问下一格。前端零拼串,句子只在这里长一次。 */
/* 🔴 D148(店主 05p 补二,五通 v3 读出):**「改成」只有真的换了才配说**。
   v3 原文里,顾客头一次说「做美甲」,机器回「好的,**改成**美甲了」——
   人家没改过任何东西,这句话听着像在纠正顾客。
   所以每格两种说法:**首次填** = 直接复述;**换掉** = 才说「改成…了」。 */
const SLOT_LABEL = {
  serviceType: (v, changed) => (changed ? `改成${v}了` : `${v}`),
  date: (v, changed) => (changed ? `改到${v}` : `${v} 可以`),
  time: (v, changed) => (changed ? `改到${v}` : `${v} 记下了`),
  technician: (v, changed) => (changed ? `改指定 ${v}` : `指定 ${v}`),
  addons: (v, changed) => (changed ? `加项改成${v}` : `加上${v}`)
}
export function slotEcho(before = {}, after = {}, lang = 'zh') {
  const parts = []
  for (const k of Object.keys(SLOT_LABEL)) {
    const b = String(before[k] || '').trim()
    const a = String(after[k] || '').trim()
    if (!a || a === b) continue
    /* 只在**改动**(原来有值、现在换了)与**首次给出**时复述;两者顾客都需要听到确认 */
    parts.push(lang === 'en' ? `${k}: ${a}` : SLOT_LABEL[k](a, Boolean(b)))
  }
  if (!parts.length) return ''
  /* 🔴 D148 之二:顿号「、」是**列举**用的,这里是两件并列的事,该用逗号。
     v3 原文「好的,改成美甲了、2026-09-12 可以。」读起来像半句话没说完。 */
  return lang === 'en' ? `Got it — ${parts.join(', ')}. ` : `好的,${parts.join(',')}。`
}
