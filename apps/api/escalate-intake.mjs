/* 「这通该不该转人工」的判断(公约② 边改边拆:D145 改的就是这一处的行为,顺手把它带出来)

   原来在 `local-server.mjs` 里,一个字没改地搬过来,只加了 D145 那一条闸。

   ══ D145 加的那条闸(05p §一;09-08 沙箱北京店现测撞出来的)══
   顾客在采集态第三句说「好的谢谢你啦」,机器回的是:
     「亲亲,我先不继续反复追问啦……接下来我会**转给人工/技师**帮您判断缺少哪些关键信息。」
   为什么会这样:`promptCount >= 2` 已满足、`hasSomeContext` 也满足,
   而「好的谢谢你啦」不像填表回复、又没带图 → `vagueAgain` 成立 → 转人工。
   **顾客说「谢谢」不是「说不清楚」** —— 把他转给同事,等于替店里凭空造一件事。
   同理「我再想想」:那是要空间,不是要人。

   这条闸放在**这里**而不是放在出句那一层,是因为出句那层根本轮不到:
   转人工的分支排在 `collect_template` 前面,先返回就先赢
   —— 我第一版就是把收尾句加在 `collect_template` 里,现测才发现它压根没被调用。 */
import { classifyTurn } from './turn-classify.mjs'

export function createEscalateIntake({ intakeCompletion, isVagueContextFollowup, isIntakeFormLikeResponse }) {
  function shouldEscalateUnclearIntake(state = {}, persistedState = null, missingQuestions = { zh: [] }) {
    const memory = persistedState?.state?.workingMemory || {}
    const promptCount = Number(memory.workflow?.intakePromptCount || persistedState?.state?.intakePromptCount || 0) || 0
    const completion = intakeCompletion(state)
    const hasSomeContext = state.hasReferenceContext
      || state.serviceStartIntent
      || state.appointmentIntent
      || state.priceIntent
      || state.capabilityIntent
      || state.contextualFollowup
      || completion.filled >= 2
    const vagueAgain = isVagueContextFollowup(state.currentText)
      || (!isIntakeFormLikeResponse(state.currentText) && !state.referenceImages?.length && missingQuestions.zh?.length)
    /* 🔴 D145:**道别 / 犹豫 / 在问事 / 问预算,四档都不许转人工**(理由见本文件抬头)。
       question / budget 是 05p 跑完五通 v3 才补上的:通二顾客问「会不会很快就掉」,
       这里先一步判成「又含糊了一次」→ 转人工,而我在出句那层写的「答不上来就说问技师」根本轮不到。
       **一个问得清清楚楚的问题,不是「说不清楚」** —— 那是我们答不上来,不该让顾客去等人。 */
    if (['farewell', 'hesitate', 'question', 'budget'].includes(classifyTurn(state.currentText || '', { gaveSlot: false }))) return false
    return promptCount >= 2 && hasSomeContext && vagueAgain
  }

  return { shouldEscalateUnclearIntake }
}
