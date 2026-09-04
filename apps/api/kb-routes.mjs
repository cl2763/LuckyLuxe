/* 知识库路由(GET /admin/kb · PUT /admin/kb/facts · POST /admin/kb/import · 文档删除 ·
   POST/PATCH/DELETE /admin/kb/entries)—— 2026-09-03 **D134 现修那一批**从 `local-server.mjs` 搬出,
   **块一个字没改**(《棘轮律》+ 公约②边改边拆:动了知识库域就把该域路由层带走)。

   🔴 D134 就在 `PUT /admin/kb/facts` 里:`allowed` 之外的键原来**静默丢弃还回 200**,
   商家看到「保存成功」而库里没有。店主 04f 裁:**不认识的键 400 点名**,不做 ignoredKeys ——
   「保存成功」这四个字不许在没存的时候出现。

   ══ 为什么用 json 包装器 ══
   原块里全是 `return json(res, …)`,其中不少是多行的。想把它改写成 `json(); return true`
   得逐条动多行语句 —— **搬家就不再是"只搬不改"**。所以反过来:在这里把 `json` 包一层,
   调完返回 `true`,原块**一个字都不用动**;落到最后没命中就 `return false`,调用方照旧判。

   调用点仍在租户闸门之后(交付纪律 7);门禁扫描器扫全部 `*-routes.mjs`,本文件天生在面上。 */
export function createKbRoutes(deps) {
  const { apiError, readBody, db, currentTenantId, iso, randomId, liveTenantFacts, tenantKbFacts,
    parseKbEntriesFromText, countAiUsage, hasAi, extractKbEntriesFromDocument } = deps
  /* 调完就算这条路由处理过了 —— 原块里的 `return json(...)` 因此天然返回 true */
  const json = (...args) => { deps.json(...args); return true }
  async function route(req, res, ctx) {
    const { path, adminSession } = ctx
    if (req.method === 'GET' && path === '/admin/kb') {
      return json(res, 200, {
        facts: tenantKbFacts(currentTenantId()),
        // 2026-08-06:把"AI 实际拿到的实时事实"一并下发(价目三档价/加项目录/计价规则摘要),
        // 商家与运营可据此核对 AI 口径;只增字段,老前端不受影响。
        liveFacts: liveTenantFacts(),
        entries: db.prepare('SELECT id, question, keywords, answer_zh AS answerZh, answer_en AS answerEn, enabled, updated_at AS updatedAt FROM tenant_kb_entries WHERE tenant_id = ? ORDER BY created_at DESC').all(currentTenantId())
          .map((row) => ({ ...row, enabled: Boolean(row.enabled) })),
        documents: db.prepare('SELECT id, title, length(content) AS size, created_at AS createdAt FROM tenant_kb_documents WHERE tenant_id = ? ORDER BY created_at DESC').all(currentTenantId())
      })
    }
    if (req.method === 'PUT' && path === '/admin/kb/facts') {
      if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
      const body = await readBody(req)
      const facts = body.facts && typeof body.facts === 'object' ? body.facts : {}
      /* 🔴 J-20(Cowork 05h §一):`depositAmount` 从白名单撤走 —— 定金金额唯一真相是
         「门店设置 → 定金规则」(`deposit_config`),钱按它算,话也按它说。
         再传它就走 D134 那条既有口径:**400 点名**,不新造错误码,hint 里指路。 */
      const allowed = ['brandName', 'assistantName', 'storeAddress', 'currency']
      /* 🔴 D134(店主 04d §三 报、04f §一.1 裁现修):不认识的键**原来静默丢弃还回 200** ——
         商家看到「保存成功」而库里没有,从响应上分不出「存了」和「没存」。归族**静默失败器族**。
         裁法(店主原话):**不认识的键 400 点名**,不做 ignoredKeys ——
         「保存成功」这四个字不许在没存的时候出现。
         自由知识条目本来就有自己的口(`/admin/kb/entries`),错误信息里指过去。 */
      const unknown = Object.keys(facts).filter((k) => !allowed.includes(k))
      if (unknown.length) {
        /* 🔴 J-20:`depositAmount` 是**被撤走的**键,不是「不认识的键」——
           商家以前能在这儿改定金,现在不能了,只回一句「不是门店事实字段」会让人一头雾水。
           所以给它一句专门的指路(D134 定的口径本来就是「400 点名」,这里只是把话说清楚)。 */
        const retired = { depositAmount: '定金金额请到「门店设置 → 定金规则」改 —— 钱按那里算,AI 也按那里说' }
        const retiredHit = unknown.filter((k) => retired[k])
        throw apiError(400, 'UNKNOWN_KB_KEY',
          `这几项不是门店事实字段,没有保存:${unknown.join('、')}。`
          + (retiredHit.length ? `${retiredHit.map((k) => `【${k}】${retired[k]}` ).join(';')}。` : '')
          + `可保存的是:${allowed.join('、')};自由问答条目请用「知识库条目」(/admin/kb/entries)。`)
      }
      const stmt = db.prepare(`
        INSERT INTO tenant_kb_facts (tenant_id, key, value, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at
      `)
      for (const key of allowed) {
        if (facts[key] !== undefined) stmt.run(currentTenantId(), key, String(facts[key]), adminSession.email || 'owner', iso(new Date()))
      }
      return json(res, 200, { facts: tenantKbFacts(currentTenantId()) })
    }
    if (req.method === 'POST' && path === '/admin/kb/import') {
      if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
      const body = await readBody(req)
      const filename = String(body.filename || 'upload.txt').slice(0, 120)
      const content = String(body.content || '').slice(0, 40000)
      if (!content.trim()) throw apiError(400, 'BAD_REQUEST', 'File content is empty.')
      const insertEntry = (entry) => db.prepare(`
        INSERT INTO tenant_kb_entries (id, tenant_id, question, keywords, answer_zh, answer_en, enabled, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
      `).run(randomId('kb'), currentTenantId(), entry.question.slice(0, 200), String(entry.keywords || entry.question).slice(0, 300), entry.answerZh.slice(0, 2000), String(entry.answerEn || '').slice(0, 2000), adminSession.email || 'owner', iso(new Date()), iso(new Date()))
      // 1) 结构化格式（CSV / 问答体）直接拆条
      const parsed = parseKbEntriesFromText(content)
      if (parsed.length) {
        for (const entry of parsed) insertEntry(entry)
        return json(res, 201, { mode: 'entries', imported: parsed.length })
      }
      // 2) 自由文本：尝试 AI 拆条（需真实模型且需开通 AI 智能包），拆不出则整篇存为知识文档供 AI 参考
      if (hasAi()) countAiUsage()
      const aiExtracted = hasAi() ? await extractKbEntriesFromDocument({ content, filename }).catch(() => null) : null
      const aiEntries = (aiExtracted?.entries || []).filter((entry) => entry?.question && entry?.answerZh)
      if (aiEntries.length) {
        for (const entry of aiEntries) insertEntry(entry)
        return json(res, 201, { mode: 'ai_entries', imported: aiEntries.length })
      }
      db.prepare('INSERT INTO tenant_kb_documents (id, tenant_id, title, content, updated_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomId('kbdoc'), currentTenantId(), filename, content, adminSession.email || 'owner', iso(new Date()))
      return json(res, 201, { mode: 'document', imported: 0 })
    }
    const kbDocMatch = path.match(/^\/admin\/kb\/documents\/([^/]+)$/)
    if (req.method === 'DELETE' && kbDocMatch) {
      if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
      db.prepare('DELETE FROM tenant_kb_documents WHERE id = ? AND tenant_id = ?').run(decodeURIComponent(kbDocMatch[1]), currentTenantId())
      return json(res, 200, { deleted: true })
    }
    if (req.method === 'POST' && path === '/admin/kb/entries') {
      if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
      const body = await readBody(req)
      const question = String(body.question || '').trim()
      const answerZh = String(body.answerZh || '').trim()
      if (!question || !answerZh) throw apiError(400, 'BAD_REQUEST', 'question and answerZh are required.')
      const id = randomId('kb')
      db.prepare(`
        INSERT INTO tenant_kb_entries (id, tenant_id, question, keywords, answer_zh, answer_en, enabled, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
      `).run(id, currentTenantId(), question, String(body.keywords || question), answerZh, String(body.answerEn || ''), adminSession.email || 'owner', iso(new Date()), iso(new Date()))
      return json(res, 201, { entry: db.prepare('SELECT id, question, keywords, answer_zh AS answerZh, answer_en AS answerEn, enabled FROM tenant_kb_entries WHERE id = ?').get(id) })
    }
    const kbEntryMatch = path.match(/^\/admin\/kb\/entries\/([^/]+)$/)
    if ((req.method === 'PATCH' || req.method === 'DELETE') && kbEntryMatch) {
      if (adminSession.role !== 'owner') throw apiError(403, 'FORBIDDEN', 'Owner permission is required.')
      const id = decodeURIComponent(kbEntryMatch[1])
      const current = db.prepare('SELECT * FROM tenant_kb_entries WHERE id = ? AND tenant_id = ?').get(id, currentTenantId())
      if (!current) throw apiError(404, 'NOT_FOUND', 'KB entry not found.')
      if (req.method === 'DELETE') {
        db.prepare('DELETE FROM tenant_kb_entries WHERE id = ?').run(id)
        return json(res, 200, { deleted: true })
      }
      const body = await readBody(req)
      db.prepare(`
        UPDATE tenant_kb_entries SET
          question = ?, keywords = ?, answer_zh = ?, answer_en = ?, enabled = ?, updated_by = ?, updated_at = ?
        WHERE id = ?
      `).run(
        String(body.question ?? current.question),
        String(body.keywords ?? current.keywords),
        String(body.answerZh ?? current.answer_zh),
        String(body.answerEn ?? current.answer_en ?? ''),
        body.enabled === undefined ? current.enabled : Number(Boolean(body.enabled)),
        adminSession.email || 'owner',
        iso(new Date()),
        id
      )
      return json(res, 200, { entry: db.prepare('SELECT id, question, keywords, answer_zh AS answerZh, answer_en AS answerEn, enabled FROM tenant_kb_entries WHERE id = ?').get(id) })
    }
    return false
  }
  return { route }
}
