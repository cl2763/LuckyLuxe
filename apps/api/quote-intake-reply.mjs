/* 报价采集的出句(《代码结构公约》② 边改边拆:05n 裁 (1) 动的就是这块)

   ⚠️ 图 v1.3(店主 05n 裁 (1)):**报价采集也一句一问,7 项表退役。**
   `quoteIntakeReply('collect_template')` 现在回的是 `quoteMissingQuestions()` 的
   **第一个缺项**,不再甩整张表。报价单本身(槽位、`expires_at`、报价状态、
   `ready_quote` / `manual_review` 各出口)一个字没动。

   `quoteCollectionTemplate` 仍然留着:顾客把填好的整段粘回来时要认得
   (`test-quote-tenant` 就是那么喂的),而且它是「缺项一个都取不到」时的兜底。 */

import { classifyTurn, TURN_TEXT } from './turn-classify.mjs'   // D145:采集态每句先分类

export function createQuoteIntakeReply(deps) {
  /* 只列**真用到**的三个 —— 头一版我按印象多写了六个,其中
     `storeDisplayName` / `quotePreviewLine` / `staffDisplayName` **全仓根本不存在**,
     服务当场起不来(`ReferenceError: storeDisplayName is not defined`)。
     依赖清单要照代码里真在用的写,不照记忆写。 */
  const { canSpecifyTechnician, quoteIntakeSummary, isIntakeFormLikeResponse, answerForTurn } = deps
  for (const [name, fn] of Object.entries(deps)) {
    if (typeof fn !== 'function') throw new Error(`createQuoteIntakeReply 缺依赖或类型不对:${name}`)
  }

  function quoteCollectionTemplate(serviceType = 'nail', state = {}) {
    const withTech = canSpecifyTechnician(state)
    if (serviceType === 'lash') {
      const lines = [
        '可以的亲亲，我先帮您把美睫预约/确认需要的信息一次性整理好，这样确认会更快，也避免漏掉细节。',
        '',
        '请您按下面格式回复我（可以直接粘贴本段话到聊天框）：',
        '',
        '1. 项目类型：美睫',
        '2. 想做款式：自然款 / 浓密款 / 中式设计款 / 不确定',
        '3. 是否需要下睫毛：',
        '4. 是否需要卸睫：',
        '5. 想做日期和时间：',
        '6. 是否第一次做美睫 / 眼睛是否容易敏感：',
        '7. 其他备注：'
      ]
      if (withTech) lines.push('8. 是否指定技师：')
      lines.push('', '如果暂时有些信息不确定也没关系，您先填知道的部分，我会帮您整理后确认。')
      return lines.join('\n')
    }
    const lines = [
      '可以的亲亲，我先帮您把预约/报价需要的信息一次性整理好，这样技师确认会更快，也避免漏掉细节。',
      '',
      '请您按下面格式回复我（可以直接粘贴本段话到聊天框）：',
      '',
      '1. 项目类型：美甲',
      '2. 想做日期和时间：',
      '3. 是否需要卸甲：',
      '4. 是否需要延长：',
      '5. 是否有断甲需要修补：',
      '6. 是否有参考图：有的话请直接发图；没有也可以写“无图”',
      '7. 其他备注：'
    ]
    if (withTech) lines.push('8. 是否指定技师：')
    lines.push('', '如果这段信息没有补充完全也没关系，您先填知道的部分，我会帮您整理；大部分信息补充后就可以交给技师/人工判断。')
    return lines.join('\n')
  }

  function intakeCompletion(state = {}) {
    if (state.serviceType === 'lash') {
      const fields = [
        state.serviceTypeConfirmed,
        state.lashStyleKnown,
        state.lowerLashRequested !== 'unknown',
        state.lashRemovalNeeded !== 'unknown',
        state.hasDateTime,
        state.healthCheckClear !== 'unknown',
        state.hasOtherNotes
      ]
      return { filled: fields.filter(Boolean).length, total: fields.length }
    }
    const fields = [
      state.serviceTypeConfirmed,
      state.hasDateTime,
      state.removalNeeded !== 'unknown',
      state.extensionNeeded !== 'unknown',
      state.repairNeeded !== 'unknown',
      Boolean(state.referenceImages?.length || state.noReferenceImage),
      state.hasOtherNotes
    ]
    return { filled: fields.filter(Boolean).length, total: fields.length }
  }

  function shouldHandOffForQuote(state = {}) {
    const completion = intakeCompletion(state)
    const overHalf = completion.filled >= Math.ceil(completion.total / 2)
    const hasReferenceAnswer = Boolean(state.referenceImages?.length || state.noReferenceImage)
    if (state.serviceType === 'lash') return overHalf && (state.priceIntent || state.capabilityIntent || isIntakeFormLikeResponse(state.currentText))
    return overHalf && hasReferenceAnswer && (state.priceIntent || state.capabilityIntent || state.contextualFollowup || isIntakeFormLikeResponse(state.currentText))
  }

  function quoteIntakeReply(kind, state, missingQuestions) {
    const missing = missingQuestions.zh || []
    if (kind === 'collect_template') {
      /* 🔴 图 v1.3(店主 05n 裁 (1)):**报价采集也一句一问。**
         图 §七 原本写「不改现有报价采集的槽位与文案」,与 §五 像人硬线「不发 7 项表单」打架 ——
         店主 A2/A3 当初抱怨的就是这张表,**硬线赢**。
         ⑤ 现测:200 句里 25 句出表,像人五通里两通中招(③ 只治了预约采集,表活在这儿)。

         改的只有**问法**:整张表 → `quoteMissingQuestions()` 里的**第一个缺项**。
         报价单本身(槽位、`expires_at`、报价状态、ready_quote/manual_review 各出口)一个字没动;
         `intent` 也保持 `*_intake_template` 不变 —— 那是报价采集这条路的身份标记,
         改了它 `test-intent-guards` 的两条正向断言与状态机都会跟着晃。
         (模板函数 `quoteCollectionTemplate` 暂时留着:顾客粘回填好的整段仍要认得,
          `test-quote-tenant` 就是那么喂的。) */
      const missing = quoteMissingQuestions(state)
      /* 🔴 缺项列表是**按项目类型**给的:`quoteMissingQuestions` 只在 serviceType
         是 nail 或 lash 时才有问题可问;项目还没定时它回空。
         头一版我在这儿兜底回了整张表,于是 200 句里还剩 **7 句**在出表(裁定要的是 0)。
         项目没定就先问项目 —— **这本来就是该问的第一个缺项**。 */
      /* 🔴 D145:**先看这句话是不是在给槽**,再决定要不要追下一个缺项。
         病根就在这儿 —— 原来不管顾客说什么,一律 `missing[0]` 顶上去,于是
         「好的谢谢你啦」被回「请问是否有断甲?」、「我再想想」被继续追问。
         道别就收尾、犹豫就让开一轮,**这一轮一个问号都不出**。
         `intent` 保持 `*_intake_template` 不变 —— 那是这条路的身份标记,
         改了 `test-intent-guards` 两条正向断言会跟着晃(05n 已经栽过一次)。 */
      const turnKind = classifyTurn(state.currentText || '', { gaveSlot: false })
      /* D145 后半:在问事 / 问预算 → **先答,再至多一问**(答从价目/知识库取,取不到就让原流程走) */
      if (turnKind === 'question' || turnKind === 'budget') {
        /* `again`:这一会话是不是已经报过一次最便宜(报过就换个说法,别一字不差重复) */
        const ans = answerForTurn(turnKind, { text: state.currentText || '', serviceName: state.serviceType || '', again: Boolean(state.cheapestShown) })
        if (turnKind === 'budget') state.cheapestShown = true
        if (ans && String(ans.text || '').trim()) {
          const one = (quoteMissingQuestions(state).zh || [])[0] || ''
          return {
            data: {
              intent: `${state.serviceType || 'nail'}_intake_template`,
              answerZh: `${ans.text}${one ? ` ${one}` : ''}`,
              answerEn: `${ans.en || ans.text}${one ? ` ${(quoteMissingQuestions(state).en || [])[0] || ''}` : ''}`,
              handoffRequired: false
            },
            source: 'quote_intake_template'
          }
        }
      }
      if (turnKind === 'farewell' || turnKind === 'hesitate') {
        return {
          data: {
            intent: `${state.serviceType || 'nail'}_intake_template`,
            answerZh: TURN_TEXT[turnKind].zh,
            answerEn: TURN_TEXT[turnKind].en,
            handoffRequired: false
          },
          source: 'quote_intake_template'
        }
      }
      const svc = String(state.serviceType || '')
      /* 三种情况,**一种都不许甩表**(裁定 (1) 要的是 200 句出表 = 0):
         ① 有缺项 → 问第一个缺项;
         ② 项目还没定 → 先问项目(这本来就是第一个缺项);
         ③ 项目定了、缺项也空了 → 那就更没道理甩表(根本没东西要问)——
            说一句「我整理给技师」并请他补充,由后面的 ready_quote / 人工那条路接。
         现测:①② 修完 200 句还剩 7 句出表,全是 ③ 这种状态。 */
      const askZh = (missing.zh || [])[0]
        || (svc ? '好的,我把这些整理给技师确认;还有别的要补充吗?' : '您想做美甲还是美睫呀?')
      const askEn = (missing.en || [])[0]
        || (svc ? "Got it — I'll pass this to the technician. Anything else to add?" : 'Would you like nails or lashes?')
      return {
        data: {
          intent: `${state.serviceType || 'nail'}_intake_template`,
          answerZh: askZh || quoteCollectionTemplate(state.serviceType || 'nail', state),
          answerEn: askEn || (state.serviceType === 'lash'
            ? 'Sure. Please send your lash style, whether lower lashes/removal are needed, preferred date/time, eye sensitivity, and any notes. If anything is uncertain, send what you know first.'
            : 'Sure. Please send your nail service type, preferred date/time, whether removal/extensions/repairs are needed, reference photo status, and any notes. If anything is uncertain, send what you know first.'),
          handoffRequired: false
        },
        source: 'quote_intake_template'
      }
    }
    if (kind === 'ready_quote') {
      return {
        data: {
          intent: 'pricing',
          answerZh: `好的亲亲，我已经把需求整理好啦：${quoteIntakeSummary(state)}。我现在转给技师确认最终报价和可预约时长，正常 10 分钟内给您回复；如果技师正在服务中，我也会在收到回复后第一时间发给您。`,
          answerEn: `Got it. I have organized the request: ${quoteIntakeSummary(state)}. I will send it to the technician for the final quote and duration, and usually reply within 10 minutes.`,
          handoffRequired: true
        },
        source: 'quote_intake_state'
      }
    }
    if (kind === 'ready_returning_feasibility') {
      return {
        data: {
          intent: 'returning_feasibility_check',
          answerZh: `好的亲亲，我已经把这款需求整理好啦：${quoteIntakeSummary(state)}。我先转给技师确认这款能不能做、建议预留时长和可预约安排；如果涉及额外价格，技师会一起备注，我收到后再用清楚一点的话术发给您。`,
          answerEn: `Got it. I have organized the request: ${quoteIntakeSummary(state)}. I will send it to the technician to confirm feasibility, suggested duration, and booking arrangement. If any extra pricing applies, I will summarize it clearly after the technician replies.`,
          handoffRequired: true
        },
        source: 'quote_intake_state'
      }
    }
    if (kind === 'manual_intake_review') {
      return {
        data: {
          intent: 'manual_intake_review',
          answerZh: `亲亲，我先不继续反复追问啦。我已经把目前的信息整理好：${quoteIntakeSummary(state)}。接下来我会转给人工/技师帮您判断缺少哪些关键信息，收到回复后我再第一时间发给您。`,
          answerEn: `I will stop asking repeated questions for now. I have organized the current information: ${quoteIntakeSummary(state)}. I will send this to staff/technician to check what key details are still needed and reply once we have an update.`,
          handoffRequired: true
        },
        source: 'quote_intake_manual_review'
      }
    }
    if (kind === 'manual_special_review') {
      return {
        data: {
          intent: 'manual_special_review',
          answerZh: `亲亲，这个属于需要人工确认的特殊安排，我先帮您转给店里确认一下。收到回复后我会第一时间发给您。`,
          answerEn: `This needs a manual check from our team. I will send it to the store first and reply as soon as we have an update.`,
          handoffRequired: true
        },
        source: 'quote_special_manual_review'
      }
    }
    if (kind === 'ask_missing') {
      if (!missing.length) {
        return {
          data: {
            intent: 'nail_quote',
            answerZh: `可以的亲亲，目前需求信息基本齐了：${quoteIntakeSummary(state)}。如果您是想确认具体价格，我可以现在帮您转给技师报价。`,
            answerEn: `Sure. The request details are mostly complete: ${quoteIntakeSummary(state)}. If you would like the exact quote, I can send it to the technician now.`,
            handoffRequired: false
          },
          source: 'quote_intake_state'
        }
      }
      return {
        data: {
          intent: 'nail_quote',
          answerZh: `可以的亲亲，我先不急着转技师报价，避免信息不完整导致报价不准。想确认一下：${missing.join(' ')} 确认后我再把图片和需求一起整理给技师看价。`,
          answerEn: `Sure. Before sending this to the technician, I need to confirm: ${(missingQuestions.en || []).join(' ')} Once confirmed, I will organize the image and details for a quote.`,
          handoffRequired: false
        },
        source: 'quote_intake_state'
      }
    }
    if (!missing.length) {
      return {
        data: {
          intent: 'nail_quote',
          answerZh: `这款我先看到啦，当前信息是：${quoteIntakeSummary(state)}。如果您想问具体价格，我可以帮您转给技师确认报价；如果只是问能否还原，也需要技师结合细节最终确认。`,
          answerEn: `I see this style. Current details: ${quoteIntakeSummary(state)}. If you want an exact quote, I can send it to the technician; final feasibility also depends on technician review.`,
          handoffRequired: false
        },
        source: 'quote_intake_state'
      }
    }
    return {
      data: {
        intent: 'nail_quote',
        answerZh: `图片/款式我先收到啦。能不能完全还原需要技师结合甲面长度和细节确认；如果您想要我帮您问具体价格，我先确认：${missing.join(' ')} 然后再统一整理给技师。`,
        answerEn: `I have the reference/style. Whether it can be fully recreated depends on nail length and details. If you would like a quote, please confirm: ${(missingQuestions.en || []).join(' ')}`,
        handoffRequired: false
      },
      source: 'quote_intake_state'
    }
  }

  function quoteMissingQuestions(input) {
    const zh = []
    const en = []
    if (input.serviceType === 'nail') {
      if (input.extensionNeeded === 'unknown') {
        zh.push('请问这款是做本甲还是需要延长？')
        en.push('Is this for natural nails, or do you need extensions?')
      }
      if (input.removalNeeded === 'unknown') {
        zh.push('请问是否需要卸甲？如果是非本店作品，卸甲会另计费用和时间。')
        en.push('Do you need removal? Removal from another salon may add time and cost.')
      }
      if (input.repairNeeded === 'unknown') {
        zh.push('请问是否有断甲或需要修补？')
        en.push('Do you have any broken nails or repairs needed?')
      }
    }
    if (input.serviceType === 'lash') {
      if (input.lowerLashRequested === 'unknown') {
        zh.push('请问这次是否需要下睫毛服务？')
        en.push('Would you like lower lashes included?')
      }
      if (input.healthCheckClear === 'unknown') {
        zh.push('请问近 3 个月内是否做过眼部手术，或目前是否有结膜炎、红肿等眼部症状？')
        en.push('Have you had eye surgery in the past 3 months, or any current eye irritation, redness, or conjunctivitis?')
      }
    }
    return { zh, en }
  }

  return { quoteCollectionTemplate, intakeCompletion, shouldHandOffForQuote, quoteIntakeReply, quoteMissingQuestions }
}
