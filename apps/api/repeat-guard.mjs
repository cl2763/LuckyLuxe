/* D150 · 层层递进不许复读,递进到底才转人工(店主 05q 通二打 3 分那条;05r 补五 待裁 #5 裁法)

   店主原话:「顾客层层递进问同一件事时,要**换一种答法**去想他到底要什么;
   实在答不了,就在递进过程中说『我可以帮您接人工』—— 这时候才是真需要人工。」

   ══ 为什么是「壳」不是「插在中间」══
   上一批我把守挂在 `factGate.check` 那一行,**不生效** —— 报价采集那条路在它之前就 return 了。
   `handleWecomInboundCore` 里有 14 个 return,回复从哪个出去要看走的是哪条子流程,
   所以**任何插在中间的一处收口都是错的**。
   店主裁的第三条路:原函数改名 Core,**原名变成一个薄壳** —— 14 个 return 一个不动
   (matrix 66 项不用打底),而壳看得见**每一个**出去的回复。

   ══ 两半 ══
   · **生成前**(`repeatPre`):同主题第几次、上一条 AI 原话是什么。第 2 次起把「换个角度」
     塞进这一轮的输入,让**同一个出口**换个答法生成 —— 不另开第二个生成口(D153 出口唯一)。
   · **生成后**(`repeatPost`):这一轮出来的话**还是**跟上一条一模一样,或者同主题已经第 3 次
     —— 换成「这个我帮您接人工问问」并转人工。

   ══ 改写就改流水里同一行(店主裁的第 3 条)══
   Core 已经把这轮 AI 回复写进 `conversation_messages` 了。壳改写时**UPDATE 那一行**,
   并在 `meta` 里记 `rewrittenFrom`(原文留证)。
   —— 这样「顾客看到的」与「流水里的」**仍是一处真相**,不会像挂在落库层那样分叉成两处。

   ══ 读口 ══
   上一条 AI 说了什么,只从 `conversation_messages` 读(全录是唯一读口,店主 05q 明写
   「不另开 state」)。 */

/** 同主题算不算「又问了一遍」:两句都落在 budget / question 这类**追问档**上才算。
    slot(给了时段)、farewell(结束语)不算 —— 那是在往前走,不是在原地打转。 */
const CHASING = new Set(['budget', 'question'])

/* 换答法的三个角度,轮着来。**不是三句话术**,是给同一个出口的三种「想什么」:
   顾客连着问同一件事,通常是我们没答到他真正在意的那一点。 */
const ANGLES = [
  { key: 'byType', zh: '顾客同一件事又问了一遍,说明上一句没答到点上。这次**换个角度**:按款式/项目类型分开说,给他一个能挑的范围,不要把上一句换个说法重讲。' },
  { key: 'byBudget', zh: '顾客同一件事已经问到第三遍了,换成**按预算区间**讲:低中高各能做到什么样,让他好对号入座。仍然不许重复前面说过的句子。' },
  { key: 'askWhat', zh: '前面几次都没答到点上。这次**别再报信息了,先问他最在意哪一点**(时间?价格?效果?),一句话问清楚。' },
]

/** 第二次还是原话时的**换答法**兜底句。
    为什么需要它:换角度是塞给模型的,模型**可能照样吐同一句**(mock 模型必然如此)。
    这时候店主要的是「换一种答法去想他到底要什么」——**不是**转人工(那是第三次的事)。
    所以这句只做一件事:承认没答到点,并把选择权交回顾客。它不编任何事实。 */
/* 🔴 D158 之三(店主 05s):**换答法必须仍然回答**。
   v4 通二现场:换答法把一句实答换成了一句空话「您最在意的是价格、时间,还是效果?」——
   顾客问了两遍,结果**连第一遍的答案都被拿走了**。
   改法:上一答**留着**,后面才接换角度那一问。我们造不出新答案,
   但绝不能把已有的答案换成一句反问。 */
export function reaskText(lang = 'zh', lastAnswer = '') {
  const ask = lang === 'en'
    ? 'Which matters most to you — price, timing, or the result?'
    : '您最在意的是价格、时间,还是做出来的效果呢?'
  const keep = String(lastAnswer || '').trim()
  return keep ? `${keep} ${ask}` : ask
}

/** 转人工那句 —— 店主原话的形状:「我可以帮您接人工」 */
export function escalationText(lang = 'zh') {
  return lang === 'en'
    ? "I'll pass this to a colleague — they'll get back to you shortly."
    : '这个我帮您接人工问问,同事看到会尽快回您~'
}

const squash = (s) => String(s ?? '').replace(/\s+/g, '')

/** 最近几条 AI 说过的话(唯一读口 = 全录表)。最新的排在前面。 */
export function recentAssistant(db, conversationId, tenantId, limit = 3) {
  try {
    return db.prepare(`SELECT id, content, created_at FROM conversation_messages
      WHERE conversation_id = ? AND tenant_id = ? AND role = 'assistant'
      ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(conversationId, tenantId, limit)
  } catch { return [] }
}

/** 最近几句顾客说的话(用来数「同一主题连着问了几次」)。最新的排在前面。 */
export function recentCustomer(db, conversationId, tenantId, limit = 4) {
  try {
    return db.prepare(`SELECT content, created_at FROM conversation_messages
      WHERE conversation_id = ? AND tenant_id = ? AND role = 'customer'
      ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(conversationId, tenantId, limit)
  } catch { return [] }
}

/** 生成前:这是同主题第几次、上一条 AI 原话是什么。
 *  @returns {{ run: number, angle: string, lastText: string }}
 *  `run` 从 1 起(1 = 头一次问)。 */
/* 🔴 D158(店主 05s §四 读六通 v4 读出来的):**同一档 ≠ 同一件事**。
   v4 通二现场:顾客问「那个最便宜的是哪种」——这是**新问题**,不是复读,
   却被判成同题、换成一句空话「我可能没答到点上~您最在意的是价格、时间,还是效果?」。
   两条收紧:
   ① 光是「都落在 question 档」不算同题 —— 还要**两句话真的在说同一件事**
      (共同的实词够多);
   ② 上一次 AI **答出了东西**才谈得上「又问了一遍」;上一答本来就是反问/空话,
      顾客再问是理所当然的,不该当复读处理。 */
const STOP = /[的了吗呢吧啊呀是不有我你他她它这那个们么多少大小好很就都还也要会能可以哪什么怎么样嘛]/g
const contentChars = (t) => new Set(String(t || '').replace(/\s|[,。!?、~,.!?]/g, '').replace(STOP, '').split(''))
export function sameTopic(a, b) {
  const A = contentChars(a)
  const B = contentChars(b)
  if (!A.size || !B.size) return false
  let hit = 0
  for (const c of A) if (B.has(c)) hit += 1
  /* 重合过半才算同一件事。「多久」vs「最便宜的是哪种」几乎不重合 → 不算同题 */
  return hit / Math.min(A.size, B.size) >= 0.5
}
/** 上一句 AI 到底**答没答出东西**:给了数字/时长/价格/明确说法才算答过。
    只是反问一句(采集问句、"您最在意哪一点")不算 —— 那本来就没答。 */
export function answered(text = '') {
  const t = String(text || '')
  if (!t) return false
  if (/^[^。!?]{0,40}[??]\s*$/.test(t.trim())) return false          // 整句就是一个问句
  return /\d/.test(t) || t.length >= 24
}

export function repeatPre({ db, conversationId, tenantId, text, classifyTurn }) {
  const kind = classifyTurn(text || '')
  if (!CHASING.has(kind)) return { run: 1, angle: '', lastText: '' }
  /* 往回数:顾客上几句里,连着几句**和这句说的是同一件事**。
     数的是**连续**的,中间插一句给时段就断了;换了话题也断(D158)。 */
  const prev = recentCustomer(db, conversationId, tenantId, 4)
  let run = 1
  for (const row of prev) {
    if (classifyTurn(row.content || '') !== kind) break
    if (!sameTopic(text, row.content)) break
    run += 1
  }
  const last = recentAssistant(db, conversationId, tenantId, 1)[0]
  const angle = run >= 2 ? (ANGLES[Math.min(run - 2, ANGLES.length - 1)] || ANGLES[0]).zh : ''
  return { run, angle, lastText: String(last?.content || '') }
}

/** 生成后要不要动它。**只看事实,不改任何东西** —— 改不改由调用方决定,方便判据单独验。
 *  三档,与店主原话一一对应:
 *  · 第 3 次仍在同主题上打转 → `escalate`(「递进到底才转人工」);
 *  · 第 2 次而且**还是原话** → `reask`(「换一种答法去想他到底要什么」)——**不是**转人工;
 *  · 其余 → 不动。
 *  @returns {{ action: 'none'|'reask'|'escalate', why: string }} */
export function repeatVerdict({ run, lastText, replyText }) {
  if (!replyText) return { action: 'none', why: 'no-reply' }
  /* D158 之二:上一答**没答出东西**的话,顾客再问是理所当然的 —— 不算复读,不动它。 */
  if (!answered(lastText)) return { action: 'none', why: 'last-had-no-answer' }
  const same = Boolean(lastText) && squash(lastText) === squash(replyText)
  if (run >= 3) return { action: 'escalate', why: same ? 'third-and-same' : 'third-time' }
  if (same) return { action: 'reask', why: 'same-as-last' }
  return { action: 'none', why: 'ok' }
}

/** 改写流水里**同一行**,原文进 `meta.rewrittenFrom`。
 *  🔴 只在那一行的现存文本确实等于我们要替换的文本时才动 ——
 *     对不上说明它不是我们刚写的那一行,宁可不改也不许改错行(改错行 = 篡改历史)。
 *  @returns {boolean} 真改了才回 true */
export function rewriteAssistantRow(db, { id, expect, content, why, iso }) {
  if (!id || !content) return false
  const row = db.prepare('SELECT content, meta FROM conversation_messages WHERE id = ?').get(id)
  if (!row) return false
  if (squash(row.content) !== squash(expect)) return false
  let meta = {}
  try { meta = row.meta ? JSON.parse(row.meta) : {} } catch { meta = {} }
  meta.rewrittenFrom = row.content
  meta.rewrittenBy = 'repeat-guard'
  meta.rewrittenWhy = why || ''
  meta.rewrittenAt = iso(new Date())
  db.prepare('UPDATE conversation_messages SET content = ?, meta = ? WHERE id = ?')
    .run(content, JSON.stringify(meta), id)
  return true
}

export const REPEAT_ANGLES = ANGLES

/** 壳的身子:Core 出来的结果过一遍守,该换话就换话、该转人工就转人工。
 *  放这儿而不是放 `local-server.mjs`:巨型文件「只许搬出、不许新增」(公约③),
 *  而且这一段的**全部逻辑**本来就属于 D150 这个域。
 *  `local-server` 那边只剩「算 pre → 调 Core → 交给这里」三行。 */
/** 这通对话现在是什么状态(待人工?)—— D161 要用。读口收在这儿,
 *  调用方不用再传一个 lambda 进来(巨型文件那边只留一行)。 */
function statusOf(db, conversationId, tenantId) {
  try { return (db.prepare('SELECT status FROM wechat_conversations WHERE id = ? AND tenant_id = ?').get(conversationId, tenantId) || {}).status || '' } catch { return '' }
}

export function applyRepeatGuard({ db, iso, getWecomConversation, hygiene }, { inbound, result, pre, conversationId, tenantId }) {
  let replyText = String(result?.reply?.data?.answerZh || result?.reply?.data?.answer || result?.reply?.data?.answerEn || '')
  /* D159 / D161 出口卫生:先把「答完还追着问表项」那半句砍掉、
     待人工态下的告别换成告别句 —— 这一步**只做减法**,不生成新事实。
     放在壳里的理由和 D150 一样:采集问句从十几条支路拼上来,逐处改必漏。 */
  if (hygiene && replyText) {
    const status = statusOf(db, conversationId, tenantId)
    const h = hygiene({ text: replyText, customerText: inbound.content || '', status, lang: inbound.lang || 'zh' })
    if (h.why) {
      const row0 = recentAssistant(db, conversationId, tenantId, 1)[0]
      rewriteAssistantRow(db, { id: row0?.id, expect: replyText, content: h.text, why: h.why, iso })
      const cleaned = { ...(result.reply || {}), data: { ...(result.reply?.data || {}), answerZh: h.text } }
      result = { ...result, reply: cleaned, hygiene: h.why }
      replyText = h.text
    }
  }
  const verdict = repeatVerdict({ run: pre.run, lastText: pre.lastText, replyText })
  if (verdict.action === 'none') return result
  const escalate = verdict.action === 'escalate'
  const lang = inbound.lang || 'zh'
  const text = escalate ? escalationText(lang) : reaskText(lang, pre.lastText)
  const row = recentAssistant(db, conversationId, tenantId, 1)[0]
  const rewritten = rewriteAssistantRow(db, { id: row?.id, expect: replyText, content: text, why: verdict.why, iso })
  if (escalate) {
    db.prepare('UPDATE wechat_conversations SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
      .run('needs_human', iso(new Date()), conversationId, tenantId)
  }
  const reply = { ...(result.reply || {}), data: { ...(result.reply?.data || {}), answerZh: text,
    answerEn: escalate ? escalationText('en') : reaskText('en'),
    handoffRequired: escalate ? true : Boolean(result.reply?.data?.handoffRequired) } }
  return { ...result, reply, repeatGuard: { ...verdict, run: pre.run, rewritten },
    conversation: getWecomConversation(conversationId) }
}

/** 整个壳 —— `local-server.mjs` 那边只剩一行调用(巨型文件只许搬出)。
 *  `core` 由调用方传进来:这样「Core 只许壳调」那条静态判据数的还是那两处。 */
export async function guardedHandle(deps, core, inbound, req) {
  const { db, classifyTurn, currentTenantId, wecomConversationId } = deps
  const conversationId = wecomConversationId(inbound.externalUserId)
  const tenantId = currentTenantId()
  const pre = repeatPre({ db, conversationId, tenantId, text: inbound.content || '', classifyTurn })
  const result = await core(pre.angle ? { ...inbound, repeatAngle: pre.angle } : inbound, req)
  return applyRepeatGuard(deps, { inbound, result, pre, conversationId, tenantId })
}
