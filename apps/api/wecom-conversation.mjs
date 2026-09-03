/* 企微会话读写域(D132 起从 `local-server.mjs` 搬出,公约②:动哪个领域就把该领域搬出去)

   这一域就是 D132 的现场:会话 id 原来是全局主键 `wecom:<外部用户>`,读写口一处不带租户,
   于是两家店的同一个外部用户 id 撞在同一行上。现在:
   · id 由 `./wecom-routing.mjs` 的 `resolveConversationId` 按 (租户, provider, 外部用户) 解出;
   · 所有读走 `conversationRow`(**永远带租户**);
   · 写走 `ON CONFLICT(id)` 的 upsert,租户由 `currentTenantId()` 落。
   搬家只挪位置,逻辑与判据不变 —— 判据见 `test-conversation-tenant`。 */
export function createWecomConversation(deps) {
  const { db, wecomRouting, parseJson, iso, currentTenantId, quoteState, conversationCard,
    resolveUserByIdentity, getConversationState, injectRepriceIfExpired, HUMAN_REPLY_COOLDOWN_MINUTES,
    notifyWecomStaff, logConversationMessage, transcriptFromLog, randomId } = deps
  /* 🔴 D132(店主 04c §二 口径①②):会话 id 不再靠拼 —— 按 (租户, provider, 外部用户) 找,
     找不到才按**新形态** `wecom:<租户>:<外部用户>` 建。存量老形态 `wecom:<uid>` 照样找得到(三元组能命中),
     所以不用改存量 id。唯一出口在 `./wecom-routing.mjs`。 */
  function wecomConversationId(externalUserId = '', provider = 'wecom_customer_service') {
    return wecomRouting.resolveConversationId({ externalUserId, provider })
  }

  /* ⓪ 对话全录:`transcript_json` 降为**读缓存** —— 真相在 `conversation_messages`。
     表里有行就以表为准;一行都没有(全新会话)才回落缓存。
     两者对不上时以表为准,并由判据守「逐条一致」。 */
  function readWecomTranscript(conversationId) {
    const fromLog = transcriptFromLog(db, conversationId, currentTenantId())
    if (fromLog.length) return fromLog
    const current = wecomRouting.conversationRow(conversationId, 'transcript_json')
    return parseJson(current?.transcript_json)
  }

  function lastTranscriptMessageByRole(transcript = [], role = '') {
    return [...(Array.isArray(transcript) ? transcript : [])].reverse().find((item) => item?.role === role) || null
  }

  function shouldReleaseHumanConversationToAi(status = '', transcript = [], now = new Date()) {
    if (status !== 'human_active') return false
    const lastMessage = [...(Array.isArray(transcript) ? transcript : [])].reverse().find((item) => item?.role)
    const lastStaff = lastTranscriptMessageByRole(transcript, 'staff')
    if (!lastStaff?.at || lastMessage?.role !== 'staff') return false
    const lastStaffAt = new Date(lastStaff.at).getTime()
    if (!Number.isFinite(lastStaffAt)) return false
    return now.getTime() - lastStaffAt >= HUMAN_REPLY_COOLDOWN_MINUTES * 60 * 1000
  }

  function appendWecomConversationMessage(conversationId, message, patch = {}) {
    const current = wecomRouting.conversationRow(conversationId)
    const transcript = parseJson(current?.transcript_json)
    const now = iso(new Date())
    if (message.role === 'assistant') message = { ...message, content: injectRepriceIfExpired(conversationId, message.content) }
    transcript.push({ ...message, at: message.at || now })
    /* ⓪ 对话全录(大批05 §〇):**一条消息一行,只追加不改不删**。
       这里是全仓唯一的 transcript 写入漏斗(15 个调用点全从这过),所以行也只在这儿落一次。
       `transcript_json` 从此降为**读缓存** —— 它仍然写,但真相在 `conversation_messages` 里。
       渠道重投(同一个 channel_msg_id)返回 false,不算错,也不重复落行。 */
    logConversationMessage(db, {
      tenantId: currentTenantId(),
      conversationId,
      message: { ...message, at: message.at || now },
      patch,
      iso,
      randomId,
    })
    const provider = patch.provider || current?.provider || 'wecom_customer_service'
    const externalUserId = patch.externalUserId || current?.external_user_id || conversationId.replace(/^wecom:/, '')
    const aiReplyJson = patch.aiReply !== undefined ? JSON.stringify(patch.aiReply || {}) : (current?.ai_reply_json || '{}')
    const rawEventJson = patch.raw !== undefined ? JSON.stringify(patch.raw || {}) : (current?.raw_event_json || '{}')
    db.prepare(`
      INSERT INTO wechat_conversations
        (id, tenant_id, provider, external_user_id, open_kfid, source_channel, status, last_intent, last_message, ai_reply_json, transcript_json, raw_event_json, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider = excluded.provider,
        open_kfid = COALESCE(NULLIF(excluded.open_kfid, ''), wechat_conversations.open_kfid),
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
      provider,
      externalUserId,
      patch.openKfid || current?.open_kfid || '',
      patch.sourceChannel || current?.source_channel || '',
      patch.status || current?.status || 'open',
      patch.lastIntent || current?.last_intent || message.intent || message.role || 'unknown',
      patch.lastMessage || message.content || current?.last_message || '',
      aiReplyJson,
      JSON.stringify(transcript),
      rawEventJson,
      current?.created_at || now,
      now
    )
    const saved = getWecomConversation(conversationId)
    // 转人工的唯一收口:状态刚变成 needs_human 时,给店主的企业微信推一条提醒(不重复推)。
    // fire-and-forget:通知失败绝不影响会话主链路。
    if (saved?.status === 'needs_human' && current?.status !== 'needs_human') {
      const who = saved.linkedUser?.name || saved.externalUserId || '顾客'
      const gist = String(patch.lastMessage || message.content || '').slice(0, 60)
      notifyWecomStaff(`【有迹·需要人工】${who} 的咨询 AI 接不住了${gist ? `\n最后一句:${gist}` : ''}\n打开有迹小程序 → 客服工作台 处理`)
        .catch(() => {})
    }
    return saved
  }

  function getWecomConversation(conversationId) {
    const row = wecomRouting.conversationRow(conversationId)
    if (!row) return null
    // 会话↔会员互链:该外部账号若已绑定会员,带上会员信息供后台跳转客户档案
    const linkedUser = resolveUserByIdentity(row.provider || 'wecom_customer_service', row.external_user_id)
    const qsView = quoteState.quoteStateOf(row.id, row.tenant_id || currentTenantId())
    return {
      id: row.id,
      quoteState: qsView, customerCard: conversationCard(!!linkedUser, qsView.state, linkedUser && linkedUser.memberTier),   // D106+03r 等级名同出口(原地改行,不加行)
      provider: row.provider,
      externalUserId: row.external_user_id,
      linkedUserId: linkedUser?.id || null,
      linkedUserName: linkedUser?.display_name || null,
      openKfid: row.open_kfid,
      sourceChannel: row.source_channel,
      status: row.status,
      lastIntent: row.last_intent,
      lastMessage: row.last_message,
      aiReply: parseJson(row.ai_reply_json),
      /* 读缓存降级同上:表里有行就以表为准 */
      transcript: (() => {
        const fromLog = transcriptFromLog(db, row.id, row.tenant_id || currentTenantId())
        return fromLog.length ? fromLog : parseJson(row.transcript_json)
      })(),
      conversationState: getConversationState(conversationId),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  return { wecomConversationId, readWecomTranscript, lastTranscriptMessageByRole,
    shouldReleaseHumanConversationToAi, appendWecomConversationMessage, getWecomConversation }
}
