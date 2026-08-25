/* 平台代商家导入老顾客(P0;2026-08-25 从 local-server.mjs 搬出,公约②)。

   口径:手机号是唯一主键;期初余额进 legacy 桶(那是老店欠顾客的服务,**不是本店的收入**,
   永远不进财务账本);历史累计消费只写 users.legacy_total_spend_cents,仅用于会员资格判定。
   搬家只挪位置,一行逻辑没改 —— 判据见 test-customer-import 套件。 */
export function createImportCustomers({ db, apiError, randomId, iso }) {
  function normalizeImportPhone(raw) {
    return String(raw || '').replace(/[\s\-()（）]/g, '').trim().slice(0, 30)
  }

  function importTenantCustomers(tenantId, body = {}) {
    const rows = Array.isArray(body.rows) ? body.rows : []
    if (!rows.length) throw apiError(400, 'BAD_REQUEST', '没有可导入的数据行。')
    if (rows.length > 5000) throw apiError(400, 'BAD_REQUEST', '单次导入上限 5000 行,请分批。')
    const dryRun = body.dryRun !== false
    const seenPhones = new Set()
    const report = { toCreate: 0, toUpdate: 0, conflicts: [], skipped: [], balanceSumCents: 0, rowCount: rows.length }
    const actions = []
    rows.forEach((raw, index) => {
      const line = index + 1
      const source = raw && typeof raw === 'object' ? raw : {}
      const name = String(source.name || source.displayName || '').trim()
      const nickname = String(source.nickname || '').trim()
      const phone = normalizeImportPhone(source.phone)
      if (!phone) {
        report.skipped.push({ line, name, reason: '缺手机号,无法去重,已跳过' })
        return
      }
      if (seenPhones.has(phone)) {
        report.skipped.push({ line, name, phone, reason: '同一文件内手机号重复,只取第一条' })
        return
      }
      seenPhones.add(phone)
      const balanceCents = Math.max(0, Math.round(Number(source.balanceCents) || 0))
      const totalSpendCents = Math.max(0, Math.round(Number(source.totalSpendCents) || 0))
      const existing = db.prepare('SELECT * FROM users WHERE tenant_id = ? AND phone = ? ORDER BY rowid ASC LIMIT 1').get(tenantId, phone)
      if (existing && name && String(existing.display_name || '').trim() && String(existing.display_name).trim() !== name) {
        report.conflicts.push({ line, phone, existingName: existing.display_name, incomingName: name, reason: '同手机号已存在但姓名不同,不自动合并,请人工确认' })
        return
      }
      report.balanceSumCents += balanceCents
      if (existing) report.toUpdate += 1
      else report.toCreate += 1
      actions.push({ mode: existing ? 'update' : 'create', userId: existing?.id || null, name, nickname, phone, balanceCents, totalSpendCents, source })
    })
    if (dryRun) return { dryRun: true, tenantId, ...report }
    // 执行前的最后一道闸:平台端必须把试跑报告里的期初余额总额原样回传,数额对不上直接拒绝
    if (body.confirmBalanceCents !== undefined && Math.round(Number(body.confirmBalanceCents) || 0) !== report.balanceSumCents) {
      throw apiError(400, 'BALANCE_CONFIRM_MISMATCH', `期初余额总额与试跑报告不一致(试跑 ${report.balanceSumCents} 分,确认 ${body.confirmBalanceCents} 分),请重新试跑。`)
    }
    const now = iso(new Date())
    let created = 0
    let updated = 0
    let openingWrittenCents = 0
    const writtenUsers = []
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const action of actions) {
        let userId = action.userId
        const tags = Array.isArray(action.source.tags)
          ? action.source.tags.map((tag) => String(tag).trim()).filter(Boolean)
          : String(action.source.tags || '').split(/[,，、|]/).map((tag) => tag.trim()).filter(Boolean)
        const noteParts = [String(action.source.note || '').trim()]
        if (action.nickname && action.nickname !== action.name) noteParts.push(`昵称:${action.nickname}`)
        const note = noteParts.filter(Boolean).join(' · ').slice(0, 400) || null
        const birthday = String(action.source.birthday || '').trim() || null
        if (action.mode === 'create') {
          userId = randomId('user')
          db.prepare(`INSERT INTO users (id, display_name, phone, tenant_id, tags_json, notes, birthday, is_migrated, legacy_total_spend_cents)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`).run(userId, action.name || action.nickname || action.phone, action.phone, tenantId,
            JSON.stringify(tags), note, birthday, action.totalSpendCents)
          db.prepare(`INSERT OR IGNORE INTO user_identities (id, user_id, provider, provider_user_id, phone, created_at, updated_at, tenant_id)
            VALUES (?, ?, 'phone', ?, ?, ?, ?, ?)`).run(randomId('identity'), userId, action.phone, action.phone, now, now, tenantId)
          created += 1
        } else {
          const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
          let curTags = []
          try { curTags = JSON.parse(cur.tags_json || '[]') } catch { curTags = [] }
          const mergedTags = Array.from(new Set([...curTags, ...tags]))
          db.prepare(`UPDATE users SET display_name = ?, tags_json = ?, notes = ?, birthday = ?, is_migrated = 1, legacy_total_spend_cents = ? WHERE id = ?`).run(
            String(cur.display_name || '').trim() || action.name || action.nickname || action.phone,
            JSON.stringify(mergedTags),
            note || cur.notes || null,
            birthday || cur.birthday || null,
            Math.max(cur.legacy_total_spend_cents || 0, action.totalSpendCents),
            userId)
          updated += 1
        }
        if (action.balanceCents > 0) {
          db.prepare(`INSERT INTO stored_value_transactions (id, tenant_id, user_id, type, amount_cents, pay_channel, note, created_by, created_at, bucket)
            VALUES (?, ?, ?, 'migrate_opening', ?, 'migration', ?, 'platform-import', ?, 'legacy')`).run(
            randomId('sv'), tenantId, userId, action.balanceCents,
            `老系统迁移期初余额(${action.phone})`, now)
          openingWrittenCents += action.balanceCents
        }
        writtenUsers.push({ userId, phone: action.phone, mode: action.mode, balanceCents: action.balanceCents })
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return { dryRun: false, tenantId, created, updated, openingWrittenCents, users: writtenUsers, ...report }
  }

  return { importTenantCustomers, normalizeImportPhone }
}
