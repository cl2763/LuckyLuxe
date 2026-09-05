import { compactIntentText } from './intent-text.mjs'

/* AI 客服的**门** —— 旧关键词门 + 新模型门三档,住在同一个文件里
   (大批05 ①,店主 05b §二;代码结构公约①「新功能一律新模块」②「边改边拆」)

   ══ 为什么这两道门必须同居一室 ══
   它们判的是**同一件事**:「这句话该不该由 AI 答」。分居在 local-server.mjs 几千行里各写一处,
   就是「改一处漏一处」的老病 —— ① 这一批要同时改两道门、还要能一键切回旧门跑对照,
   分开写必然漂。所以本文件是「门」的唯一真相。

   ══ 旧门(关键词)现在是什么身份 ══
   `hasCustomerServiceBusinessSignal` 那张白名单**降级为快速通道**:命中 → 直接放行(省一次判断);
   **没命中不再等于「不是本店业务」**。基线实测(200 句评测集,真模型):
   同义不含关键词那 80 句里 **72 句被静默** —— 顾客说「多少米」「明儿下午有空位吗」全部不理。
   `AI_GATE=keyword` 可整体切回旧门,用来跑两个数并排(达标才换门)。

   ══ 新门(模型)三档 ══
   ≥0.7 且 inScope → 答/推进 · 0.4–0.7 → **反问一句** · <0.4 或范围外 → 礼貌一句 + 转人工。
   第 3 档**有回复,不静默** —— 这是 D133 的解法之一:静默会把整通对话哑掉。

   ══ 依赖注入(不是懒,是因为这些判据本身还没搬完)══
   下面 inject 的几个 `has*Intent` 仍在 local-server.mjs 里(它们还被别处用着,
   一起搬会牵出更大的面)。按公约②「边改边拆」,这一批只搬「门」,判据下批跟上。 */


/* 从 `local-server.mjs` 搬来(公约②):这两个判据只服务于门,门在这儿它们就该在这儿。
   搬之前它们是 `createAiGate` 的注入参数 —— 注入是「还没搬完」的临时形态,搬完就不用注了。 */
export function isGreetingOnly(text = '') {
  const compact = compactIntentText(text)
  return /^(你好|您好|哈喽|哈咯|嗨|hi|hello|hey|在吗|在不在|想咨询一下|咨询一下|问一下|打扰一下)$/.test(compact)
}

export function hasServiceStartIntent(text = '') {
  const compact = compactIntentText(text)
  if (!compact) return false
  if (/退款|取消|改期|售后|投诉|退定金|开胶|起翘|翘边|掉甲|掉钻|掉色|色差|掉睫|红肿|过敏|发炎|刺痛|不舒服|refund|cancel|reschedule|complaint/.test(compact)) return false
  return /想做美甲|要做美甲|做美甲|想弄指甲|做指甲|想做指甲|想做美睫|要做美睫|做美睫|想接睫毛|接睫毛|种睫毛|做睫毛|nailappointment|lashappointment/.test(compact)
}

/* 「把我交回 AI」的意图 —— 从 `local-server.mjs` 搬来(公约②)。它判的是「门要不要重新开」,属门域。 */
export function isExplicitAiResumeIntent(text = '') {
  const compact = compactIntentText(text)
  return /交回ai|转回ai|ai继续|继续ai|请ai继续|让ai继续|机器人继续|恢复ai|ai接待/.test(compact)
}


/* 🔴 `book` 是个陷阱词(Cowork 05e:「book≠本店业务时**不进采集**」)。
   05e 实测:「Book me a flight」在**模型还没被问到之前**就被这里认成预约意图,
   走 `preQuoteWorkflow` 出了一整张美甲预约收集表 —— 提示词里的反例根本没机会起作用。
   所以 `book/reserve` 只有在**订的是本店的东西**(美甲/美睫/技师/位子/时段)时才算预约;
   订机票、订餐厅、订酒店一律不算。中文的「订」同理。 */
const BOOKS_SOMETHING_ELSE = /\b(flight|hotel|room|table|restaurant|taxi|cab|ticket|train|car)\b|机票|酒店|餐厅|饭店|房间|车票|出租车/i
export function hasAppointmentInquiryIntent(text = '') {
  const compact = compactIntentText(text)
  if (BOOKS_SOMETHING_ELSE.test(String(text || ''))) return false
  return /预约|想约|要约|可以约吗|能约吗|档期|有空吗|时间|book|appointment|available|availability/.test(compact)
}

/* 「可以吗 / 这个呢 / 多少钱」这类**没有上下文就看不懂**的短句 —— 从 `local-server.mjs` 搬来(公约②)。
   它判的是「这句话要不要靠前文才成立」,属门域。 */
export function isVagueContextFollowup(text = '') {
  const compact = compactIntentText(text)
  return /^(可以吗|好了吗|这个呢|这款呢|那这个呢|那价格呢|价格呢|多少钱|ok|好的|可以)$/.test(compact)
}


/* 「你们能做…吗」这类能力问法 —— 从 `local-server.mjs` 搬来(公约②)。它只服务于门,属门域。 */
export function hasCapabilityIntent(text = '') {
  const compact = compactIntentText(text)
  return /可以做吗|能做吗|能不能做|可不可以做|可以还原吗|能还原吗|这一款可以吗|这款可以吗|这个可以吗|可以吗|好了吗/.test(compact)
    || /can you do|can u do|possible|is it possible/.test(String(text || '').toLowerCase())
}


export function createAiGate(deps) {
  const {
    flattenPersistedQuoteState,
    hasAfterSalesProblemIntent, hasSpecialManualHandoffIntent, hasExplicitPriceIntent,
    isReturningCustomerInbound, shouldSendReturningCustomerWelcome,
  } = deps
  /* 🔴 静默失败器族:少注一个依赖,`undefined is not a function` 要等到顾客发那句话才炸。
     所以开工先点名 —— 缺谁当场报谁,不留到运行时。 */
  for (const [name, fn] of Object.entries(deps)) {
    if (typeof fn !== 'function') throw new Error(`createAiGate 缺依赖或类型不对:${name}`)
  }

  function hasConversationBusinessContext(transcript = [], persistedState = null) {
    const state = flattenPersistedQuoteState(persistedState)
    if ((persistedState?.quoteStage || '') && persistedState.quoteStage !== 'idle') return true
    if (state.serviceType || state.referenceImages?.length || state.pendingPriceIntent || state.pendingCapabilityIntent) return true
    const recentText = (Array.isArray(transcript) ? transcript : [])
      .slice(-8)
      .map((item) => `${item.role || ''}:${item.content || ''}`)
      .join('\n')
    return /美甲|指甲|本甲|延长|卸甲|断甲|款式|参考图|美睫|睫毛|预约|报价|价格|定金|技师|nail|lash|booking|appointment|quote|price/i.test(recentText)
  }

  function hasCustomerServiceBusinessSignal(inbound = {}, transcript = [], persistedState = null) {
    const text = String(inbound.content || '')
    const compact = compactIntentText(text)
    if (!compact && !(inbound.referenceImages || []).length) return false
    if ((inbound.referenceImages || []).length) return true
    if (hasAfterSalesProblemIntent(text, inbound.customerStage || persistedState?.customerStage || persistedState?.state?.customerStage || '')) return true
    if (hasSpecialManualHandoffIntent(text) || hasServiceStartIntent(text) || hasExplicitPriceIntent(text) || hasAppointmentInquiryIntent(text)) return true
    if (/美甲|指甲|本甲|延长|卸甲|断甲|修补|甲面|款式|参考图|图片|美睫|睫毛|上睫毛|下睫毛|嫁接|卸睫|门店|地址|营业|电话|客服|订单|支付|定金|退款|取消|改期|会员|优惠券|积分|储值|技师|作品|护理|售后|返修|开胶|起翘|翘边|掉甲|掉钻|掉色|色差|不满意|掉睫|红肿|过敏|nail|lash|booking|appointment|deposit|refund|cancel|reschedule|member|coupon|store|address|hours|technician|artist|aftercare/i.test(compact)) {
      return true
    }
    if (hasCapabilityIntent(text)) {
      return hasConversationBusinessContext(transcript, persistedState) || /这款|这个款|图片|图|参考|款式|style|design/i.test(compact)
    }
    return false
  }

  function isKnowledgeOnlyDefaultRule(rule = {}) {
    return String(rule.id || '') === 'booking.one_service'
  }

  function hasConcreteKnowledgeMatch(knowledgeContext = {}) {
    const matchedRules = Array.isArray(knowledgeContext.matchedRules) ? knowledgeContext.matchedRules : []
    const concreteRules = matchedRules.filter((rule) => !isKnowledgeOnlyDefaultRule(rule))
    return concreteRules.length > 0
      || (Array.isArray(knowledgeContext.matchedQa) && knowledgeContext.matchedQa.length > 0)
      || (Array.isArray(knowledgeContext.matchedHandoffRules) && knowledgeContext.matchedHandoffRules.length > 0)
  }

  function replyLooksUnknown(reply = null) {
    const data = reply?.data || reply || {}
    const intent = compactIntentText(data.intent || '')
    const answer = `${data.answerZh || ''}\n${data.answerEn || ''}`
    return /unknown|unclear|unsupported|outofscope|out_of_scope|other|smalltalk|chitchat|handoff/.test(intent)
      || /不确定|无法判断|不太确定|没太理解|not sure|cannot determine|i'm not sure/i.test(answer)
  }

  function shouldSilentHandoffBeforeAi({ inbound = {}, transcript = [], persistedState = null } = {}) {
    const text = String(inbound.content || '').trim()
    if (!text && !(inbound.referenceImages || []).length) return false
    if (isGreetingOnly(text)) return false
    if (isReturningCustomerInbound(inbound) && shouldSendReturningCustomerWelcome(inbound, transcript)) return false
    if (hasCustomerServiceBusinessSignal(inbound, transcript, persistedState)) return false
    if (/^(谢谢|感谢|好的|好滴|ok|嗯嗯|哈哈|收到|明白|辛苦了|thank you|thanks)$/i.test(compactIntentText(text))) return true
    if (/[?？吗呢]|为什么|怎么|如何|觉得|意思|what|why|how|where|when|can/i.test(text)) return true
    return text.length >= 4
  }

  function shouldSilentHandoffAfterAi({ inbound = {}, reply = null, quoteWorkflow = null, knowledgeContext = {}, transcript = [], persistedState = null } = {}) {
    const text = String(inbound.content || '').trim()
    if (!text && !(inbound.referenceImages || []).length) return false
    if (quoteWorkflow?.shouldCreateQuote || quoteWorkflow?.reply?.source) return false
    if (isReturningCustomerInbound(inbound) && shouldSendReturningCustomerWelcome(inbound, transcript)) return false
    if (isGreetingOnly(text) || hasCustomerServiceBusinessSignal(inbound, transcript, persistedState)) return false
    if (hasConcreteKnowledgeMatch(knowledgeContext)) return false
    return replyLooksUnknown(reply) || shouldSilentHandoffBeforeAi({ inbound, transcript, persistedState })
  }

  /* ══ 门的模式 ══ 🔴 **默认已换成模型门**(Cowork 05f §一 2「达标即换」,2026-09-04)

     换门依据是**三跑取中位**(同一构建,每轮 200 句 + 80 边角,真模型):
     | 轮 | 范围内(≥90%) | 范围内静默 | 无关句实质作答(≤2%) | 安全四线 |
     |---|---|---|---|---|
     | 1 | 90.0% | 0 | 0.0% | 0 破口 |
     | 2 | 91.2% | 0 | 0.0% | 0 破口 |
     | 3 | 93.8% | 0 | 0.0% | 0 破口 |
     | **中位** | **91.2% ✅** | **0** | **0.0% ✅** | **0 ✅** |

     为什么非要三跑:真模型跑间波动约 3%,而第 1 轮**正好卡在 90.0%** ——
     单跑一轮就下结论,等于拿噪声当结论(Cowork 05f §一 3 已把这条写成常驻规矩)。

     🔴 **`AI_GATE=keyword` 是回滚开关,保留** —— 线上出事一个环境变量切回旧门。
     旧门的代码与判据都没删(`shouldSilentHandoffBeforeAi` 等仍在,`test-ai-gate` 两档都验)。 */
  const gateMode = process.env.AI_GATE === 'keyword' ? 'keyword' : 'model'

  /* 三档判定(图 v1.2:第 3 档拆 3a / 3b)—— 只回「要不要替规则层出这一句」,不碰会话、不写库。
     返回 null = 不接管,按第 1 档继续往下走。

     ══ 3a 与 3b 的分界,以及为什么必须分 ══
     · **3a 范围外**(宠物店在哪 / 你是机器人吗)→ 礼貌拒绝 + **拉回业务**,`handoffRequired: false`。
       转人工是要占用同事时间的:顾客问宠物店,把它转给店员没有任何意义。
     · **3b 范围内但 AI 不该答**(健康 / 售后 / 账户 / 要动某张单某笔钱)→ 有回复 **+ 转人工**。
       这类**必须**有人接手,因为顾客真的有事要办。

     09-04 那一版把两者合成一档,后果是「你叫什么名字」也被转人工 ——
     既打扰了同事,又让顾客觉得问一句闲话就被推走了。
     判据锚 `tier` 字段(`3a`/`3b`),不锚文案。 */
  function resolveGateTier({ gate = {}, keywordFastPath = false, ruleTookOver = false, needsHuman = false, askBackFirst = false }) {
    if (gateMode !== 'model') return null
    /* 🔴 **模型明说范围外时,谁也不许盖过它**(05e 实测两处都栽在这上面):
       ① `Where is the pet store` 里有 `store` —— 撞上关键词快速通道,`inScope` 被强行拉成 true,
          3a 永远轮不到。**快速通道本意是「命中就省一次判断」,不是「关键词能推翻模型的判断」。**
       ② `Book me a flight` 快速通道没命中,但**规则层抢先接管**,出了美甲预约收集表
          (Cowork 原话:「book≠本店业务时**不进采集**」)。
       所以:模型显式 `inScope === false` 时,快速通道不再顶,规则层的接管也让位给 3a。
       模型没表态(undefined)时,快速通道照旧当作 inScope —— 那才是它该起作用的地方。 */
    const modelSaysOutOfScope = gate.inScope === false
    if (ruleTookOver && !modelSaysOutOfScope) return null
    const inScope = modelSaysOutOfScope ? false : (keywordFastPath || gate.inScope !== false)
    const conf = typeof gate.confidence === 'number' ? gate.confidence : (keywordFastPath ? 1 : 0.5)

    /* 3b:范围内、但这件事 AI 不该替顾客办。
       健康与售后在更前面就被各自的闸接走了(安全四线闸 / detectAfterSalesProblem),
       所以走到这儿的 3b 主要是**账户与动作**,由调用方传 `needsHuman` 告知。

       🔴 **不要求模型也说 inScope** —— `needsHuman` 为真本身就是「在范围内」的证据:
       顾客问的是**他自己在本店的账**、或要动**本店的某张单**,不可能不是本店业务。
       05e 现测栽过一次:「我卡里还剩多少?」模型判 `inScope=false`,
       于是这句被归成 3a「礼貌拒绝」—— 顾客问自己的余额,被回一句「这个我帮不上啦」。
       规则层比模型更确定的事,不该反过来听模型的。 */
    if (needsHuman) {
      return {
        status: 'needs_human',
        reply: { data: {
          intent: 'handoff',
          answerZh: '这个我请同事来帮您确认,通常 10 分钟内回复您。',
          answerEn: "I'll have a colleague confirm this for you — usually within about 10 minutes.",
          handoffRequired: true, gate: 'needs_human_in_scope', tier: '3b',
        } },
      }
    }

    /* 3a:与本店无关。礼貌拒绝 + 把话头拉回来,**不转人工**。 */
    if (!inScope || conf < 0.4) {
      return {
        status: 'ai_replied',
        reply: { data: {
          intent: 'out_of_scope',
          answerZh: '这个我帮不上啦 😊 店里预约、价格、营业时间随时问我。',
          answerEn: "That's outside what I can help with 😊 Ask me anything about booking, prices or opening hours.",
          handoffRequired: false, gate: 'out_of_scope', tier: '3a',
        } },
      }
    }
    /* ④ 回流:老板判过「不该答」的那句话,**同句再来先反问**(图 §四)。
       走的是第 2 档同一个出口 —— 不另写一句反问,免得两处真相。
       判据在 `test-ai-review`:判「不该答」→ 同句再问 → 必须是 ask_back。 */
    if (askBackFirst) {
      return {
        status: 'ai_replied',
        reply: { data: {
          intent: gate.intent || 'unknown',
          answerZh: (gate.suggestedQuestionsZh || [])[0]
            || '好呀 — 您是想先看看款式和价格,还是直接约个时间来做?',
          answerEn: (gate.suggestedQuestionsEn || [])[0]
            || 'Happy to help — would you like to look at styles and prices first, or book a time directly?',
          handoffRequired: false, gate: 'ask_back', tier: '2', askBackReason: 'owner_rejected_before',
        } },
      }
    }
    if (conf < 0.7) {
      /* 第 2 档:**只问一句,不猜**。模型给得出追问就用它的,给不出用兜底那句。 */
      return {
        status: 'ai_replied',
        reply: { data: {
          intent: gate.intent || 'unknown',
          answerZh: (gate.suggestedQuestionsZh || [])[0]
            || '好呀 — 您是想先看看款式和价格,还是直接约个时间来做?',
          answerEn: (gate.suggestedQuestionsEn || [])[0]
            || 'Happy to help — would you like to look at styles and prices first, or book a time directly?',
          handoffRequired: false, gate: 'ask_back', tier: '2',
        } },
      }
    }
    return null
  }

  return {
    gateMode,
    resolveGateTier,
    hasCustomerServiceBusinessSignal,
    shouldSilentHandoffBeforeAi,
    shouldSilentHandoffAfterAi,
  }
}
