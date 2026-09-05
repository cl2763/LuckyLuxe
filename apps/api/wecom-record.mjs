/* 进线落库与欢迎语(《代码结构公约》② 边改边拆:④ 打标动的就是 `recordWecomConversation`)

   ⚠️ 这是**全仓唯一**把一轮对话写进 `conversation_messages`(⓪ 全录)与 `transcript_json` 的地方。
   ④ 审样本页要的 `gate` / `confidence` 标就落在这里的 assistant 那一轮上 ——
   标只写进 `transcript_json` 是没用的:`readWecomTranscript` 有全录就只读全录。 */

export function createWecomRecord(deps) {
  const {
    db, iso, randomId, currentTenantId, parseJson, t, storeDisplayName,
    readWecomTranscript, logConversationMessage, wecomRouting, quoteState,
    injectRepriceIfExpired, conversationCard, resolveUserByIdentity,
    wecomConversationId, isReturningCustomerInbound, isNewCustomerInbound,
    tenantKbFacts, welcomeText,
  } = deps
  for (const [name, v] of Object.entries(deps)) {
    if (v === undefined || v === null) throw new Error(`createWecomRecord 缺依赖:${name}`)
  }
  function recordWecomConversation(inbound, reply, status = 'ai_replied') {
    const conversationId = wecomConversationId(inbound.externalUserId)
    const current = wecomRouting.conversationRow(conversationId, 'transcript_json')
    const transcript = readWecomTranscript(conversationId)
    const replyData = reply?.data || reply || {}
    /* ⓪ 对话全录:这里是**第二个漏斗** —— 它用裸 `transcript.push` 攒完再整段覆盖写,
       不走 `appendWecomConversationMessage`。所以在这儿记下起点,收尾时把**新增的每一条**落成行。
       (只记新增的那几条:老的已经在表里,重复落行等于把对话记录读成两遍。) */
    const logFrom = transcript.length
    const logNew = () => {
      for (const m of transcript.slice(logFrom)) {
        logConversationMessage(db, {
          tenantId: currentTenantId(),
          conversationId,
          message: {
            ...m,
            channelMsgId: m.role === 'customer' ? (inbound.channelMsgId || null) : null,
            attachments: m.role === 'customer' ? (inbound.attachments || null) : null,
          },
          patch: { sourceChannel: inbound.sourceChannel },
          iso,
          randomId,
        })
      }
    }
    transcript.push({
      role: 'customer',
      content: inbound.content,
      messageId: inbound.messageId,
      msgType: inbound.msgType,
      referenceImages: inbound.referenceImages || [],
      at: iso(new Date())
    })
    if (reply) {
      if (shouldSendReturningCustomerWelcome(inbound, transcript)) {
        transcript.push({
          role: 'assistant',
          content: injectRepriceIfExpired(conversationId, returningCustomerWelcome(inbound.lang || 'zh')),
          intent: 'returning_customer_welcome',
          handoffRequired: false,
          at: iso(new Date())
        })
      } else if (shouldSendNewCustomerWelcome(inbound, transcript)) {
        transcript.push({
          role: 'assistant',
          content: injectRepriceIfExpired(conversationId, newCustomerWelcome(inbound.lang || 'zh')),
          intent: 'new_customer_welcome',
          handoffRequired: false,
          at: iso(new Date())
        })
      }
      transcript.push({
        role: 'assistant',
        content: injectRepriceIfExpired(conversationId, replyData.answerZh || replyData.answerEn || ''),
        intent: replyData.intent,
        handoffRequired: Boolean(replyData.handoffRequired),
        /* ④ 审样本按「轮」审,所以标要落在**这一轮**上,不能只留在 ai_reply_json ——
           那里只存最后一次回复,历史轮次全查不到。 */
        gate: replyData.gate || null,
        confidence: typeof replyData.confidence === 'number' ? replyData.confidence : null,
        at: iso(new Date())
      })
    }
    db.prepare(`
      INSERT INTO wechat_conversations
        (id, tenant_id, provider, external_user_id, open_kfid, source_channel, status, last_intent, last_message, ai_reply_json, transcript_json, raw_event_json, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        open_kfid = excluded.open_kfid,
        source_channel = COALESCE(NULLIF(excluded.source_channel, ''), wechat_conversations.source_channel),
        status = excluded.status,
        last_intent = excluded.last_intent,
        last_message = excluded.last_message,
        ai_reply_json = excluded.ai_reply_json,
        transcript_json = excluded.transcript_json,
        raw_event_json = excluded.raw_event_json,
        updated_at = excluded.updated_at
    `).run(
      conversationId,
      currentTenantId(),
      inbound.provider,
      inbound.externalUserId,
      inbound.openKfid,
      inbound.sourceChannel,
      replyData.handoffRequired ? 'needs_human' : status,
      replyData.intent || 'unknown',
      inbound.content,
      JSON.stringify(reply || {}),
      JSON.stringify(transcript),
      JSON.stringify(inbound.raw || {}),
      iso(new Date()),
      iso(new Date())
    )
    logNew()   // ⓪ 对话全录:缓存写完之后把新增的每一条落成行
    return conversationId
  }

  function returningCustomerWelcome(lang = 'zh') {
    return lang === 'en' ? 'Welcome back, babe. How can I help you today?' : '欢迎回来宝，有什么可以帮到您~'
  }

  function shouldSendReturningCustomerWelcome(inbound = {}, transcript = []) {
    if (!isReturningCustomerInbound(inbound)) return false
    return !(Array.isArray(transcript) ? transcript : []).some((item) => (
      ['assistant', 'staff'].includes(item?.role)
      && /欢迎回来宝|welcome back/i.test(String(item?.content || ''))
    ))
  }

  function newCustomerWelcome(lang = 'zh') {
    const brand = tenantKbFacts(currentTenantId())?.brandName
      || db.prepare('SELECT name FROM stores WHERE tenant_id = ? AND is_active = 1 ORDER BY rowid ASC LIMIT 1').get(currentTenantId())?.name || ''   // 02v 拔回落:拿不到就空,措辞由 store-identity 按空态给
    return welcomeText({ brand, lang })
  }

  function shouldSendNewCustomerWelcome(inbound = {}, transcript = []) {
    if (!isNewCustomerInbound(inbound)) return false
    return !(Array.isArray(transcript) ? transcript : []).some((item) => (
      ['assistant', 'staff'].includes(item?.role)
      /* 🔴 02v 裁定五:原来靠「欢迎来到 <店名>」判断"欢迎语发过没有" —— 店名一改就再也匹配不上,
         会对老顾客重发。改锚在**结构词**(助手自称)上,店名再改也不受影响。 */
      && /预约助手|booking assistant/i.test(String(item?.content || ''))
    ))
  }

  return { recordWecomConversation, shouldSendNewCustomerWelcome, newCustomerWelcome,
    returningCustomerWelcome, shouldSendReturningCustomerWelcome }
}
