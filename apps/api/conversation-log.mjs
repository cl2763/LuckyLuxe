/* ⓪ 对话全录(大批05 图 v1.1 §〇;店主 09-03 原话:
   「不管是人回复的还是机器回复的,只要在我们这个软件里面回复的所有一切对话记录全都会被记下来,
     这个是你要保证的,然后交给 AI 做之后的学习以及提升。」)

   ══ 修前的实情(现查,不是猜)══
   · 记录方式是**整段 JSON 覆盖写**(`wechat_conversations.transcript_json`)—— 理论上能被改写、能丢;
   · 企微客服 App 里技师直接打字回的那些:`origin === 5` 有落,但**孤儿消息 `continue` 掉**;
   · 顾客发的**文件 / 视频 / 位置**:`else continue` —— 一条不记;
   · `origin === 4`(系统推送)整类跳过。

   ══ 口径(图 §〇 四条)══
   ① 一条消息一行,**只追加不改不删**:新表 `conversation_messages` + 账本同款
      `no_delete / no_update` 触发器;`transcript_json` 降为**读缓存**,从这张表生成;
   ② **五条路一条不漏**:AI 回复 · 工作台人工回复 · 企微 App 技师打字(origin 5)·
      技师报价推送 · 系统通知句;顾客侧文本/图片/语音/文件/视频/位置全部落行
      (非文本记占位 + 附件引用),**不再 continue 跳过**;
   ③ **每店各记各的**,学习不跨店(D126–D132 那四把刀照守);
   ④ 顾客要求删除时:**脱敏不删行**(身份字段抹掉,记录仍在)。

   ══ 幂等 ══
   渠道消息 id(`channel_msg_id`)在**本租户内唯一** —— 企微 `sync_msg` 会重投,
   同一条 msgid 落两次等于对话记录里多出一句。 */

export const CONV_MSG_TRIGGERS = [
  ['conv_msg_no_delete', `CREATE TRIGGER conv_msg_no_delete BEFORE DELETE ON conversation_messages
    BEGIN SELECT RAISE(ABORT, 'conversation log is append-only'); END`],
  /* 🔴 ⓪b 脱敏正门(店主 05b §一):图 §〇 第 4 条要「顾客要求删除时**脱敏不删行**」,
     可 `content` 被这条锁锁死、提示写着「去脱敏」却**没有一条路能脱敏**。
     现在开一个**唯一的例外形状**:只有「内容换成固定标记 + `redacted_at` 落了时间 +
     role/source/会话/租户/时间戳一个字没动」这一种改法放行,其余照拒。
     ⚠️ 例外必须把**别的列也钉住** —— 否则同一条 UPDATE 里顺手改个 role 就跟着溜过去了。 */
  ['conv_msg_no_update', `CREATE TRIGGER conv_msg_no_update BEFORE UPDATE OF content, role, source, conversation_id, tenant_id, created_at ON conversation_messages
    WHEN NOT (NEW.redacted_at IS NOT NULL AND NEW.content LIKE '[已脱敏 %'
      AND NEW.role = OLD.role AND NEW.source = OLD.source
      AND NEW.conversation_id = OLD.conversation_id AND NEW.tenant_id = OLD.tenant_id
      AND NEW.created_at = OLD.created_at)
    BEGIN SELECT RAISE(ABORT, 'conversation log is append-only; redact via POST /admin/conversations/:id/redact'); END`],
]

export function ensureConversationLog(db) {
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS conversation_messages (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      source TEXT NOT NULL,
      content TEXT NOT NULL,
      attachments_json TEXT,
      channel_msg_id TEXT,
      staff_name TEXT,
      intent TEXT,
      created_at TEXT NOT NULL,
      redacted_at TEXT)`)
  } catch { /* 表在就跳过 */ }
  /* ⓪b:脱敏标记列。加列走 try/catch ALTER(交付纪律 8:只写进 CREATE TABLE 等于只对全新库生效) */
  try { db.exec('ALTER TABLE conversation_messages ADD COLUMN redacted_at TEXT') } catch { /* 列已在 */ }
  /* 幂等键按租户隔离:两家店各自的渠道消息 id 互不干涉(口径③) */
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_msg_channel ON conversation_messages(tenant_id, channel_msg_id) WHERE channel_msg_id IS NOT NULL') } catch { /* 已在 */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_conv_msg_conv ON conversation_messages(conversation_id, created_at)') } catch { /* 已在 */ }
  /* 追加锁:每次启动重建,保证与代码同版本(与账本那 12 条同一姿态) */
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const [name, sql] of CONV_MSG_TRIGGERS) {
      db.exec(`DROP TRIGGER IF EXISTS ${name}`)
      db.exec(sql)
    }
    db.exec('COMMIT')
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* 已不在事务里 */ }
    throw error
  }
}

/* 五条路各自的来源标记。**不在 15 个调用点各写一遍** ——
   从 role + intent + 渠道推出来,只有两条必须显式(企微 App 技师打字、工作台人工回复)。 */
export function sourceOf({ role, source, intent = '', sourceChannel = '' }) {
  if (source) return source
  if (role === 'staff') return 'workbench'
  if (role === 'system') return 'notice'
  if (role === 'assistant') return /quote|report|notice|handoff/.test(String(intent)) ? 'notice' : 'ai'
  return /wecom/i.test(String(sourceChannel)) ? 'wecom_app' : 'mini'
}

/* 唯一写入出口。**调用方是 `appendWecomConversationMessage` 那一个漏斗** ——
   15 个调用点全从那里过,所以这里只此一处写行。 */
export function logConversationMessage(db, { tenantId, conversationId, message, patch = {}, iso, randomId }) {
  const role = message.role || 'system'
  const source = sourceOf({ role, source: message.source, intent: message.intent, sourceChannel: patch.sourceChannel })
  const channelMsgId = message.channelMsgId || patch.channelMsgId || null
  try {
    db.prepare(`INSERT INTO conversation_messages
      (id, tenant_id, conversation_id, role, source, content, attachments_json, channel_msg_id, staff_name, intent, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      randomId('cmsg'), tenantId, conversationId, role, source,
      String(message.content ?? ''),
      message.attachments ? JSON.stringify(message.attachments) : null,
      channelMsgId, message.staffName || null, message.intent || null,
      message.at || iso(new Date()))
    return true
  } catch (error) {
    /* 幂等键撞了 = 渠道重投,不是错;别的错原样抛出去(静默失败器族:不许把真错吞掉) */
    if (/UNIQUE constraint failed: conversation_messages/.test(String(error.message || ''))) return false
    throw error
  }
}

/* `transcript_json` 降为读缓存:从这张表生成。
   顺序按 created_at,同刻按插入顺序(rowid)—— 覆盖写时代留下的老行也照样能读。 */
export function transcriptFromLog(db, conversationId, tenantId) {
  return db.prepare(`SELECT role, content, source, staff_name, intent, created_at
    FROM conversation_messages WHERE conversation_id = ? AND tenant_id = ?
    ORDER BY created_at ASC, rowid ASC`).all(conversationId, tenantId)
    .map((r) => ({
      role: r.role,
      content: r.content,
      at: r.created_at,
      ...(r.staff_name ? { staffName: r.staff_name } : {}),
      ...(r.intent ? { intent: r.intent } : {}),
    }))
}

/* 存量按条件迁移:把老的 `transcript_json` 拆成行。
   **只补不覆盖** —— 已经有行的会话跳过(幂等:重跑一分不动)。
   老行没有渠道消息 id,`source` 按 role 反推并标 `migrate` 前缀,
   免得把「从覆盖写时代捞回来的」当成「当时就一条一行记下来的」。 */
export function migrateTranscriptsIntoLog(db, { iso, randomId }) {
  let conversations = 0
  let rows = 0
  let convs = []
  try {
    convs = db.prepare(`SELECT c.id, c.tenant_id, c.transcript_json FROM wechat_conversations c
      WHERE c.transcript_json IS NOT NULL AND c.transcript_json != '' AND c.transcript_json != '[]'
        AND NOT EXISTS (SELECT 1 FROM conversation_messages m WHERE m.conversation_id = c.id)`).all()
  } catch { return { conversations: 0, rows: 0 } }
  if (!convs.length) return { conversations: 0, rows: 0 }
  const ins = db.prepare(`INSERT INTO conversation_messages
    (id, tenant_id, conversation_id, role, source, content, attachments_json, channel_msg_id, staff_name, intent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`)
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const c of convs) {
      let list = []
      try { list = JSON.parse(c.transcript_json) } catch { list = [] }
      if (!Array.isArray(list) || !list.length) continue
      conversations += 1
      for (const m of list) {
        const role = m && m.role ? String(m.role) : 'system'
        ins.run(randomId('cmsg'), c.tenant_id, c.id, role,
          `migrate:${sourceOf({ role, intent: m && m.intent })}`,
          String((m && m.content) ?? ''), (m && m.staffName) || null, (m && m.intent) || null,
          (m && m.at) || iso(new Date()))
        rows += 1
      }
    }
    db.exec('COMMIT')
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* 已不在事务里 */ }
    throw error
  }
  return { conversations, rows }
}

/* ⓪b 脱敏正门本体(店主 05b §一)——**唯一入口**,调用方负责鉴权与事由必填。
   做的事:把这通会话里**顾客侧**的内容换成固定标记、`users` 的身份字段一并抹掉;
   **行数一个不变**;`transcript_json` 那份读缓存同步成标记。
   ⚠️ 只动 `content` 与 `redacted_at` 两列 —— 触发器的例外形状就是按这个钉的。 */
export function redactConversation(db, { conversationId, tenantId, iso }) {
  const mark = `[已脱敏 ${iso(new Date()).slice(0, 10)}]`
  const now = iso(new Date())
  const rows = db.prepare(`SELECT id FROM conversation_messages
    WHERE conversation_id = ? AND tenant_id = ? AND role = 'customer' AND redacted_at IS NULL`)
    .all(conversationId, tenantId)
  const upd = db.prepare('UPDATE conversation_messages SET content = ?, redacted_at = ? WHERE id = ?')
  for (const r of rows) upd.run(mark, now, r.id)
  /* 读缓存同步:顾客侧那几句换成同一个标记(缓存与表必须说同一句话) */
  const conv = db.prepare('SELECT transcript_json FROM wechat_conversations WHERE id = ? AND tenant_id = ?').get(conversationId, tenantId)
  if (conv) {
    let list = []
    try { list = JSON.parse(conv.transcript_json || '[]') } catch { list = [] }
    const next = Array.isArray(list) ? list.map((m) => (m && m.role === 'customer' ? { ...m, content: mark } : m)) : []
    db.prepare('UPDATE wechat_conversations SET transcript_json = ? WHERE id = ? AND tenant_id = ?')
      .run(JSON.stringify(next), conversationId, tenantId)
  }
  /* 顾客身份字段一并抹掉(会话认得出是谁 = 没脱干净) */
  let users = 0
  const ext = db.prepare('SELECT external_user_id, provider FROM wechat_conversations WHERE id = ? AND tenant_id = ?').get(conversationId, tenantId)
  if (ext) {
    const u = db.prepare(`SELECT u.id FROM users u JOIN user_identities i ON i.user_id = u.id
      WHERE i.provider = ? AND i.provider_user_id = ? AND u.tenant_id = ?`).get(ext.provider, ext.external_user_id, tenantId)
    if (u) {
      db.prepare('UPDATE users SET display_name = ?, phone = NULL, email = NULL WHERE id = ? AND tenant_id = ?')
        .run(mark, u.id, tenantId)
      users = 1
    }
  }
  return { mark, messages: rows.length, users }
}
