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
  /* 认不出的等级说这个 —— 不是空白(空白=看不出有没有等级),也不是原始枚举 */
  tierUnknown: '会员',
}

/* 🔴 03r(店主从七态截图里记的队尾小病):顾客卡上那枚等级药丸显示的是裸的 `gold`。
   查下来是三处各写一份、而且三处都不对:
   · 小程序两页 `const TIER = { Silver:'银卡', Gold:'金卡', … }` —— **键是首字母大写**,
     而 `memberTier` 来自 AI 抽取的记忆(`local-server:1439 body.memberTier || body.member_tier`),
     大小写随来源。`TIER['gold']` 取不到 → 兜底到 `cust.memberTier` → **把原始枚举当中文名显示**。
     「有兜底」和「兜底是对的」是两件事:这个兜底恰好把内部枚举漏给了人看。
   · 网页 `ai-desk.js:419` **一层映射都没有**,直接渲染原值 —— 同病,而且更彻底(双端同病检查律)。
   收法照这张卡既有的姿态:**后端一处出句,两端直渲**,不再各写一份(小程序两份字面完全相同=抄的)。 */
const TIER_TEXT = {
  silver: '银卡', gold: '金卡', platinum: '铂金', diamond: '钻石', member: '会员', guest: '顾客',
}
/* 大小写不敏感;**认不出来的一律说「会员」,绝不把原始枚举漏出去** ——
   顾客/商家看见的是中文名,内部枚举是内部的事(归族:假数回落红线,不许拿"另一个语义"顶上)。 */
export function tierText(raw) {
  const key = String(raw || '').trim().toLowerCase()
  if (!key) return ''
  return TIER_TEXT[key] || CARD_TEXT.tierUnknown
}

/* bound=会话是否已绑档案;quoteState=quote-state 的四态之一;tier=会员等级原始枚举 */
export function conversationCard(bound, quoteState = 'none', tier = '') {
  return {
    bound: !!bound,
    /* 没绑档案时给的是**一句真话 + 一句出路**,不是空白;绑了就不出这两句 */
    unboundNote: bound ? '' : CARD_TEXT.unbound,
    unboundHint: bound ? '' : CARD_TEXT.unboundHint,
    quoteLabel: CARD_TEXT.quote[quoteState] || CARD_TEXT.quote.none,
    tierText: bound ? tierText(tier) : '',
  }
}
