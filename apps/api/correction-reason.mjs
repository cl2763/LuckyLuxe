/* 纠错事由 · 唯一出口(D122,店主 03c 裁定)

   立件判词是 Code 自己那句、店主收作判词的话:
   **「同一件事 —— 纠错要说明白为什么 —— 在两个口子上,一个收了一个没收。」**
   金额更正 08-27 起后端硬拦「原因必填」;而**账本冲销连选填都没有** —— 收了一半族的又一案。

   活案由就在库里:02x 误跑演示夹具产生两笔假收入,03c 走正门冲销平了账,
   但账上只留下一句自动拼的「冲销:服务单 …」。**账本只追加,这个遗憾永远补不上。**

   本件把三个纠错口收成一句话:事由必填、长度有界、拼进 note 时格式统一。
   文案具名导出,判据引用这里(店主 02y 例外条款:被测对象是文案时引用唯一出处,不复制)。 */

export const REASON_TEXT = {
  code: 'REASON_REQUIRED',
  required: '纠错必须写事由(会进账本备注,以后查得到)。',
  tooLong: '事由太长了,请控制在 200 字以内。',
  prefix: '事由',
}
const MAX = 200

/* 取事由;不合格直接抛。apiError 由调用方传入(各模块的错误构造器不同,不在这里 import) */
export function requireReason(body, apiError) {
  const raw = String((body && body.reason) || '').trim()
  if (!raw) throw apiError(400, REASON_TEXT.code, REASON_TEXT.required)
  if (raw.length > MAX) throw apiError(400, 'BAD_REQUEST', REASON_TEXT.tooLong)
  return raw
}

/* 统一拼法:原摘要在前、事由在后,两端与账本看到的是同一句 */
export function withReason(baseNote, reason) {
  return `${baseNote} · ${REASON_TEXT.prefix}:${reason}`
}
