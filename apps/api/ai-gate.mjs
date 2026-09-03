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

export function createAiGate(deps) {
  const {
    compactIntentText, flattenPersistedQuoteState,
    hasAfterSalesProblemIntent, hasSpecialManualHandoffIntent, hasExplicitPriceIntent,
    hasAppointmentInquiryIntent, hasCapabilityIntent, hasServiceStartIntent,
    isGreetingOnly, isReturningCustomerInbound, shouldSendReturningCustomerWelcome,
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

  /* ══ 门的模式 ══ 🔴 **默认仍是旧的关键词门 —— 因为评测没达标,按「达标才换门」不换。**

     店主 05b 的话是规格:「四个数并排**达标才换门**」。09-04 实测(200 句 · 真模型 · 见回执 §二):
     · 范围内被答或被反问 38.1% → **81.2%**(门槛 ≥90%,**未达**)
     · 范围内被静默 73 句 → **0 句**(这一项达)
     · 无关句误答 5.0% → **17.5%**(门槛 ≤2%,**未达**)
     两项未达,所以**默认档不动**;`AI_GATE=model` 可显式切到新门(`test-ai-gate` 就是这么跑的)。

     ⚠️ 两项「未达」里有多少是评测集自己标错的,回执 §二 逐句列了 ——
     但**看完结果再去改标签就是「改夹具让它绿」**,所以我没改,等店主裁。
     注意:D133 的核心修复(`needs_human` 不再锁死会话)**两个档都生效**,不受这里影响;
     旧门「没命中关键词就静默」那一半仍在,那正是要换门才能解的。 */
  const gateMode = process.env.AI_GATE === 'model' ? 'model' : 'keyword'

  /* 三档判定 —— 只回「要不要替规则层出这一句」,不碰会话、不写库。
     出句与落库留在调用方(local-server),因为 recordWecomConversation 还没搬出来。
     返回 null = 不接管,按第 1 档继续往下走。 */
  function resolveGateTier({ gate = {}, keywordFastPath = false, ruleTookOver = false }) {
    if (gateMode !== 'model' || ruleTookOver) return null
    /* 快速通道命中的当作 inScope、置信度拉满 —— 白名单里的词本来就是本店业务 */
    const inScope = keywordFastPath || gate.inScope !== false
    const conf = typeof gate.confidence === 'number' ? gate.confidence : (keywordFastPath ? 1 : 0.5)
    if (!inScope || conf < 0.4) {
      return {
        status: 'needs_human',
        reply: { data: {
          intent: 'handoff',
          answerZh: '这个我就不专业啦 😊 店里的事随时问我;我也把您的消息转给同事了。',
          answerEn: "That's a bit outside what I can help with 😊 Ask me anything about the salon — I've also passed your message to a colleague.",
          handoffRequired: true, gate: 'out_of_scope',
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
          handoffRequired: false, gate: 'ask_back',
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
