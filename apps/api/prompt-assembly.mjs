/* 喂给模型的那段「除了顾客原话之外还得知道的事」—— 从 `local-server.mjs` 搬出来(公约②边改边拆)。

   为什么单独成件:这一段是**好几条口径的汇合处**,一处改动会同时影响 D150/D152 与报价采集,
   散在巨型文件里看不出它们的关系。搬出来之后,「模型这一轮到底看到了什么」在一个函数里读得完。

   进来的四类,顺序即优先级(顾客原话永远第一句):
   ① 顾客原话;② D152 折扣事实(库里真有券才说有,没有就明写不许提券);
   ③ D150「换个角度」(壳算出来的:同一件事第二次问起,换一种答法);④ 测试/会话上下文。
   空的自动丢掉 —— 不许把空串拼成空行喂进去。 */

/** @returns {string} 拼好的那段话 */
export function enrichPrompt({ inbound = {}, discountNote = '', customerStage = '', memoryContextText = '', state = null } = {}) {
  const message = inbound.content || ''
  const repeatAngle = inbound.repeatAngle || ''
  const referenceImageCount = inbound.referenceImages?.length || 0
  const notes = [
    customerStage && customerStage !== 'unified_test' ? `测试顾客阶段：${customerStage}` : '',
    referenceImageCount ? `顾客已上传 ${referenceImageCount} 张参考图，当前阶段只能整理需求并转技师确认，不可直接按图最终报价。` : '',
    memoryContextText ? `系统 working memory:\n${memoryContextText}` : '',
    state?.summaryText ? `系统已记住的本会话需求：${state.summaryText}` : '',
    state?.quoteStage && state.quoteStage !== 'idle' ? `当前报价阶段：${state.quoteStage}；下一步：${state.nextAction || 'continue_ai_chat'}。` : '',
    state?.referenceImages?.length ? `本会话历史参考图数量：${state.referenceImages.length}。即使当前消息没有带图，后台报价也要带入历史参考图。` : '',
  ]
  return [message || '', discountNote, repeatAngle, ...notes].filter(Boolean).join('\n')
}
