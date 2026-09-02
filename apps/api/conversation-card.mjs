/* 会话·顾客卡的句子 · 唯一出口(D106,店主 02x/03a 令)

   两处病一起收:
   ① `profile:null`(会话还没绑档案)时,网页端只剩一行「报价状态」,**没有一句话说明其余五项为什么没有**
      —— 空白不是空态,空态要说真话(店主:说「还没绑定档案」,不是空白)。
   ② 报价状态那句**两端各写了一份**(网页 '本会话已报价' / 小程序另一套)= 分叉债。
      现在一处出句,两端直渲。

   文案具名导出,判据引用这里 —— 店主 02y 的唯一例外条款:
   被测对象就是文案时,**引用其唯一出处,不得复制**。 */

export const CARD_TEXT = {
  unbound: '还没绑定档案',
  unboundHint: '绑定后才能看到会员等级、会员码、储值与次卡。',
  quote: {
    quoted: '本会话已报价',
    expired: '报价已过期',
    reference: '有历史报价',
    none: '本会话暂无报价',
  },
}

/* bound=会话是否已绑档案;quoteState=quote-state 的四态之一 */
export function conversationCard(bound, quoteState = 'none') {
  return {
    bound: !!bound,
    /* 没绑档案时给的是**一句真话 + 一句出路**,不是空白;绑了就不出这两句 */
    unboundNote: bound ? '' : CARD_TEXT.unbound,
    unboundHint: bound ? '' : CARD_TEXT.unboundHint,
    quoteLabel: CARD_TEXT.quote[quoteState] || CARD_TEXT.quote.none,
  }
}
