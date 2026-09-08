/* 通三 · 对顾客说定金,一句话说清(店主 05s 补二 §三.5)

   v4 通三现场:定金那段 >120 字,把七条取消政策一口气全倒给顾客 —— 那是**后台设置页**该有的样子,
   不是聊天里该有的样子。店主给的形状:

     「定金 ¥50(到店付,不抵尾款);提前 24 小时可全退,不足扣一半,爽约不退。要我先帮您留着吗?」

   细则(迟到宽限、改期时限、定金保留次数)**只在顾客追问时才出** —— 那份长的照旧由
   `depositPolicyText` 出,后台预览页与设置页用的还是它,一个字没动。

   ══ 数字全部来自同一份 config ══
   金额、小时数、百分比都从 `getDepositConfig` 那份配置里取 —— 这里**一个数都不编**。
   取不到就整段不出(宁可不说,不许说错)。 */

/** 一句话版。**保证 ≤120 字**;超了就按「先砍细则、再砍退款那半句」的顺序缩。
 *  @returns {string} 拿不到配置就空串 */
export function depositBrief(config, money, lang = 'zh') {
  if (!config || !config.enabled) {
    return lang === 'en'
      ? 'No deposit needed — your slot is locked once we confirm.'
      : '本店不收定金,确认时段就给您锁位。'
  }
  const amount = config.mode === 'fixed' ? money(config.fixedAmountCents)
    : (config.mode === 'pct' ? `项目价的 ${config.pct}%` : money(config.fallbackAmountCents))
  if (!amount) return ''
  const cp = config.cancelPolicy || {}
  const deduct = config.deductible ? '可抵尾款' : '不抵尾款'
  /* 退款那半句:能说准才说。`freeCancelHours` 没配就整句不提退款(不许编一个 24)。 */
  let refund = ''
  if (cp.refundable === false) refund = '定金不退'
  else if (cp.freeCancelHours !== null && cp.freeCancelHours !== undefined) {
    const late = Number(cp.lateForfeitPct) === 50 ? '扣一半' : (cp.lateForfeitPct ? `扣 ${cp.lateForfeitPct}%` : '')
    refund = `提前 ${cp.freeCancelHours} 小时可全退${late ? `,不足${late}` : ''}`
    if (Number(cp.noShowForfeitPct) === 100) refund += ',爽约不退'
  }
  if (lang === 'en') {
    return `Deposit ${amount} (paid in store, ${config.deductible ? 'deducted from' : 'not deducted from'} the balance). Shall I hold the slot for you?`
  }
  const core = `定金 ${amount}(到店付,${deduct})`
  const full = `${core}${refund ? `;${refund}` : ''}。要我先帮您留着吗?`
  if (full.length <= 120) return full
  /* 超了就先砍退款细则 —— 顾客最要紧的是「多少钱、要不要现在付」 */
  return `${core}。要我先帮您留着吗?`
}
