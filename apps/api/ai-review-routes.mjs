/* ④ 审样本页(图 v1.2 §四 + §六「审样本」)

   ══ 它解决什么 ══
   ① 把门换成模型之后,**模型放行的每一轮都没人看过**。
   ④ 就是那双眼睛:老板逐轮点「对 / 改一句 / 不该答」,
   「对」和「改一句」回流成样本,「不该答」进反例集 —— 同一句话再来先反问。

   ══ 三条口径(别自己发挥)══
   1. **待审 = 模型放行的轮**(`gate === 'model'`)。规则层出的句子(报价/预约/事实闸/三档)
      不进待审 —— 那些不是模型在自由发挥,审它没意义。
   2. **回流按租户隔离**:A 店审出来的样本**绝不许**进 B 店的提示词。
      表上 `tenant_id NOT NULL`,写入取 `currentTenantId()`,读出按租户过滤,两头都锁。
   3. **一轮只算一次**:同一 (conversation, turnIndex) 重复裁决 = 覆盖,不是追加。
      认可率的分母是「审过的轮数」,不是「点过几次按钮」。

   ══ 三个数(页顶)══
   · 本周模型放行 = 本周 gate='model' 的轮数(**全录里现数**,不存计数器)
   · 老板认可率   = 对 ÷ 已裁决          ← 店主问的「准确率」就是这个
   · 反问率       = 三档第 2 档(ask_back)轮数 ÷ 模型放行+反问
   计数即证:三个数都从库里现算,不许有第二份真相。 */

export function createAiReviewRoutes(deps) {
  const { db, apiError, randomId, iso, currentTenantId, readWecomTranscript } = deps
  for (const [name, v] of Object.entries(deps)) {
    if (v === undefined || v === null) throw new Error(`createAiReviewRoutes 缺依赖:${name}`)
  }

  const VERDICTS = new Set(['ok', 'revised', 'rejected'])

  function ensureSchema() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_review_marks (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        turn_index INTEGER NOT NULL,
        verdict TEXT NOT NULL,
        customer_message TEXT NOT NULL DEFAULT '',
        original_reply TEXT NOT NULL DEFAULT '',
        revised_reply TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_review_marks_turn
        ON ai_review_marks(tenant_id, conversation_id, turn_index);
      CREATE INDEX IF NOT EXISTS idx_ai_review_marks_tenant ON ai_review_marks(tenant_id, verdict);
    `)
    /* 交付纪律⑧:新列一律 try/catch ALTER,只写进 CREATE TABLE 等于只对全新库生效 */
    for (const ddl of [
      'ALTER TABLE ai_review_marks ADD COLUMN customer_message TEXT NOT NULL DEFAULT \'\'',
      'ALTER TABLE ai_review_marks ADD COLUMN original_reply TEXT NOT NULL DEFAULT \'\'',
      'ALTER TABLE ai_review_marks ADD COLUMN revised_reply TEXT NOT NULL DEFAULT \'\'',
    ]) {
      try { db.exec(ddl) } catch { /* 已有该列 */ }
    }
  }

  /* 把一家店的全录摊平成「模型放行的轮」。
     顾客原话 = 这一轮 assistant 之前最近的那条 customer —— 审的时候要看见上下文。 */
  function modelTurns(tenantId, { onlyPending = false, limit = 200 } = {}) {
    const convs = db.prepare(
      'SELECT id, external_user_id, updated_at FROM wechat_conversations WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT 400'
    ).all(tenantId)
    const marks = new Map()
    for (const m of db.prepare('SELECT conversation_id, turn_index, verdict FROM ai_review_marks WHERE tenant_id = ?').all(tenantId)) {
      marks.set(`${m.conversation_id}#${m.turn_index}`, m.verdict)
    }
    const out = []
    for (const c of convs) {
      const t = readWecomTranscript(c.id) || []
      for (let i = 0; i < t.length; i += 1) {
        const turn = t[i]
        if (turn?.role !== 'assistant' || turn?.gate !== 'model') continue
        let ask = ''
        for (let j = i - 1; j >= 0; j -= 1) {
          if (t[j]?.role === 'customer') { ask = String(t[j].content || ''); break }
        }
        const verdict = marks.get(`${c.id}#${i}`) || null
        if (onlyPending && verdict) continue
        out.push({
          conversationId: c.id,
          externalUserId: c.external_user_id,
          turnIndex: i,
          customerMessage: ask,
          reply: String(turn.content || ''),
          intent: turn.intent || null,
          confidence: typeof turn.confidence === 'number' ? turn.confidence : null,
          at: turn.at || null,
          verdict,
        })
        if (out.length >= limit) return out
      }
    }
    return out
  }

  /* 页顶三个数 —— 全部从库里现算(计数即证:不许有计数器当第二份真相) */
  function stats(tenantId, sinceISO) {
    const convs = db.prepare('SELECT id FROM wechat_conversations WHERE tenant_id = ?').all(tenantId)
    let modelPass = 0
    let askBack = 0
    for (const c of convs) {
      for (const turn of readWecomTranscript(c.id) || []) {
        if (turn?.role !== 'assistant') continue
        if (sinceISO && String(turn.at || '') < sinceISO) continue
        if (turn.gate === 'model') modelPass += 1
        else if (turn.gate === 'ask_back') askBack += 1
      }
    }
    const rows = db.prepare(
      'SELECT verdict, COUNT(*) AS n FROM ai_review_marks WHERE tenant_id = ? GROUP BY verdict'
    ).all(tenantId)
    const by = Object.fromEntries(rows.map((r) => [r.verdict, r.n]))
    const judged = (by.ok || 0) + (by.revised || 0) + (by.rejected || 0)
    return {
      modelPassThisWeek: modelPass,
      judged,
      approved: by.ok || 0,
      revised: by.revised || 0,
      rejected: by.rejected || 0,
      /* 分母为 0 时给 null,**不给 0** —— 零回落律:算不出来就如实说算不出来 */
      approvalRate: judged ? (by.ok || 0) / judged : null,
      askBackRate: (modelPass + askBack) ? askBack / (modelPass + askBack) : null,
    }
  }

  /* 裁决 —— 一轮一条,重复裁决是覆盖 */
  function judge({ conversationId, turnIndex, verdict, revisedReply }) {
    if (!VERDICTS.has(verdict)) throw apiError(400, 'BAD_VERDICT', 'verdict 只能是 ok / revised / rejected。')
    const tenantId = currentTenantId()
    /* 跨店直调必须挡住:拿 A 店 token 裁 B 店的轮次,一律 404(不告诉他这条存不存在)。
       🔴 租户条件必须**写在同一句 SQL 里**,不许「先按 id 查出来、再在 JS 里比一下」——
       后者当下也safe,但那是一句随时会被删掉的判断;`test-conversation-tenant` 的白名单判据
       就是冲这个来的(全仓每一处 `FROM wechat_conversations … WHERE id = ?` 都得同句带 tenant_id)。
       我头一版正是 JS 侧比的,被它当场咬红。 */
    const conv = db.prepare('SELECT id FROM wechat_conversations WHERE id = ? AND tenant_id = ?')
      .get(conversationId, tenantId)
    if (!conv) throw apiError(404, 'NOT_FOUND', '会话不存在。')
    const t = readWecomTranscript(conversationId) || []
    const turn = t[Number(turnIndex)]
    if (!turn || turn.role !== 'assistant') throw apiError(404, 'TURN_NOT_FOUND', '这一轮不存在。')
    if (turn.gate !== 'model') throw apiError(400, 'NOT_MODEL_TURN', '只有模型放行的轮次进待审。')
    const revised = String(revisedReply || '').trim()
    if (verdict === 'revised' && !revised) throw apiError(400, 'REVISION_REQUIRED', '「改一句」必须给出改后的话。')

    let ask = ''
    for (let j = Number(turnIndex) - 1; j >= 0; j -= 1) {
      if (t[j]?.role === 'customer') { ask = String(t[j].content || ''); break }
    }
    const now = iso(new Date())
    db.prepare(`
      INSERT INTO ai_review_marks
        (id, tenant_id, conversation_id, turn_index, verdict, customer_message, original_reply, revised_reply, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, conversation_id, turn_index) DO UPDATE SET
        verdict = excluded.verdict,
        revised_reply = excluded.revised_reply,
        updated_at = excluded.updated_at
    `).run(randomId('airev'), tenantId, conversationId, Number(turnIndex), verdict,
      ask, String(turn.content || ''), revised, now, now)

    /* 回流:「对」与「改一句」进样本;「不该答」不进样本(它进反例,靠 verdict 自己就是反例集) */
    if (verdict === 'ok' || verdict === 'revised') {
      const corrected = verdict === 'revised' ? revised : String(turn.content || '')
      db.prepare(`
        INSERT INTO ai_learning_examples
          (id, tenant_id, conversation_id, source, customer_message, original_reply, corrected_reply, status, created_at, updated_at)
        VALUES (?, ?, ?, 'owner_review', ?, ?, ?, 'approved', ?, ?)
      `).run(randomId('aiex'), tenantId, conversationId, ask, String(turn.content || ''), corrected, now, now)
    }
    return { ok: true, verdict, tenantId }
  }

  /* 「不该答」过的句子:同句再来**先反问**(图 §四 回流那一行)。
     按租户取,**绝不跨店** —— 这就是造病刀要砍的那条线。 */
  function rejectedAsks(tenantId) {
    return db.prepare(
      "SELECT DISTINCT customer_message FROM ai_review_marks WHERE tenant_id = ? AND verdict = 'rejected' AND customer_message <> ''"
    ).all(tenantId).map((r) => String(r.customer_message))
  }
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/[\s,,。.!!??~]/g, '')
  function shouldAskBackFirst(text, tenantId = currentTenantId()) {
    const n = norm(text)
    if (!n) return false
    return rejectedAsks(tenantId).some((m) => norm(m) === n)
  }

  return { ensureSchema, modelTurns, stats, judge, rejectedAsks, shouldAskBackFirst }
}
