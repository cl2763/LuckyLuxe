/* 对话记录的**写口** —— 目前只有 ⓪b 脱敏正门(店主 05b §一;代码结构公约①)

   ══ 为什么是「正门」而不是「一个接口」 ══
   `conversation_messages` 被追加锁锁死(不许 DELETE、不许改内容),这是 ⓪ 对话全录的地基。
   但图 §〇 第 4 条要求「顾客要求删除时**脱敏不删行**」—— 05b 店主核出来的正是这个矛盾:
   **触发器提示写着「去脱敏」,而全仓没有一条路能脱敏**。
   所以这里开的是唯一一道门,触发器只认它落下的那一种改法(固定标记 + redacted_at,别的列一个字不动),
   绕过它直接 UPDATE 成别的文案照样被拒。

   ══ 三道闩(缺一条这门就等于没锁)══
   ① 老板权限 —— 员工不能脱敏;② 事由必填(与 D122「改归属必须写一句原因」同族);
   ③ 留痕写 `platform_ops_log`,把「谁、哪通、脱了几条、为什么」都记下。
   再加一条**行数守恒**断言:脱敏前后行数必须相等 —— 脱敏不是删除,少一行就是这门漏了。 */

export function createConversationRoutes(deps) {
  const { db, iso, randomId, apiError, json, readBody, currentTenantId, conversationRow, redactConversation } = deps
  for (const [name, fn] of Object.entries(deps)) {
    if (name !== 'db' && typeof fn !== 'function') throw new Error(`createConversationRoutes 缺依赖:${name}`)
  }

  /* 认不出这条路就回 false,调用方继续往下匹配 —— 不吞别人的路由 */
  async function handle(req, res, path, adminSession) {
    const m = path.match(/^\/admin\/conversations\/(.+)\/redact$/)
    if (req.method !== 'POST' || !m) return false
    if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', '仅老板可脱敏对话记录。')
    const conversationId = decodeURIComponent(m[1])
    const tid = currentTenantId()
    const why = String((await readBody(req)).reason || '').trim()
    if (!why) throw apiError(400, 'REASON_REQUIRED', '脱敏必须写一句事由(会写进运维日志)。')
    if (!conversationRow(conversationId, 'id', tid)) throw apiError(404, 'NOT_FOUND', '会话不存在。')
    const count = () => db.prepare('SELECT COUNT(*) AS n FROM conversation_messages WHERE conversation_id = ? AND tenant_id = ?')
      .get(conversationId, tid).n
    const before = count()
    const r = redactConversation(db, { conversationId, tenantId: tid, iso })
    const after = count()
    db.prepare('INSERT INTO platform_ops_log (id, tenant_id, action, detail, operator, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(randomId('oplog'), tid, 'conversation_redact',
        `会话 ${conversationId}:脱敏 ${r.messages} 条顾客消息、身份档案 ${r.users} 份;行数 ${before}→${after}(必须相等);事由:${why}`,
        adminSession.email || adminSession.username || 'owner', iso(new Date()))
    json(res, 200, { redacted: true, mark: r.mark, messages: r.messages, users: r.users, rowsBefore: before, rowsAfter: after })
    return true
  }

  return { handle }
}
