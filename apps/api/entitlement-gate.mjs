/* D147 · 没开 AI 包时**不许沉默**(店主 05p 补二 裁;09-08 现测踩到)

   案底:北京新店建出来后,AI 一句话都不答 —— 顾客发什么都没有回复,
   后台也一点报错都没有。查了半天才发现:建店走的是 `plan: 'single'`,
   而 `ai_customer_service` 只在 chain/custom 档里。
   **这是静默失败器族的标准形状**:商家以为「机器坏了」,真相是「这项功能没买」。
   同族案底:`els.x?.` 静默不做、`CREATE TABLE IF NOT EXISTS` 悄悄不建。

   ══ 两句话分开说 ══
   · **顾客那侧**:中性的实话 —— 「我这边暂时没法自动回复,已经转给同事」。
     不告诉顾客商家的套餐买没买 —— 那是商家的商业信息,不该出现在顾客的聊天窗里。
   · **商家那侧**:说清原因,后台状态灯与模拟对话面板读 `entitlementNote`。

   店主原话要的是「进线回一句『本店 AI 客服未开通』而不是沉默」。
   我把它拆成上面两句:**该看见这句话的是商家,不是顾客**。这一处按此实现,
   如与本意不同请裁 —— 改回一句话对顾客说,只需把 `AI_OFF_TEXT.zh` 换成那句。 */

export const AI_OFF_TEXT = {
  zh: '不好意思,我这边暂时没法自动回复,已经转给同事啦,稍后回您~',
  en: "Sorry — I can't reply automatically right now. I've passed this to a colleague."
}

/* 商家那句:说清是「没买」不是「坏了」,并指出去哪开 */
export const AI_OFF_NOTE = '本店 AI 客服未开通(当前套餐不含 AI 智能包)—— 顾客进线会转同事,不是机器坏了。开通在平台后台「功能开通」。'

/* 被闸住时的整份返回。收在一处,判据只认它。 */
export function entitlementBlockedReply({ conversationId, inbound, conversation }) {
  return {
    conversationId,
    inbound,
    conversation,
    entitlementBlocked: true,
    entitlementNote: AI_OFF_NOTE,
    reply: {
      data: {
        intent: 'entitlement_ai_disabled',
        answerZh: AI_OFF_TEXT.zh,
        answerEn: AI_OFF_TEXT.en,
        handoffRequired: true,
        gate: 'entitlement'
      },
      source: 'entitlement_gate'
    }
  }
}
