/* 顾客迁移中心 v1
   - 只把语义明确的主档/期初余额/历史累计消费写入现行业务字段。
   - 老平台订单、卡、赠品与原始字段进入只读迁移档案，不参与本系统财务、业绩或权益计算。
   - 每批记录源平台导出时间、数据截止时间、商家确认时间与实际执行时间，支持后续增量续导。
*/

const PACKAGE_TYPE = 'youji-customer-migration-v1'

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
}

function asText(value, max = 500) {
  return String(value ?? '').trim().slice(0, max)
}

function asDate(value) {
  const raw = asText(value, 80)
  if (!raw || !Number.isFinite(Date.parse(raw))) return null
  // 保留源平台给出的时区偏移；增量边界展示时不能把北京时间悄悄改写成 UTC 文案。
  return raw
}

function asCents(value) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
}

function tagsOf(value) {
  const input = Array.isArray(value) ? value : String(value || '').split(/[,，、|;]/)
  return Array.from(new Set(input.map((tag) => asText(tag, 60)).filter(Boolean))).slice(0, 40)
}

export function createMigrationCenter({ db, apiError, randomId, iso, createHash, normalizePhone, importTenantCustomers }) {
  const hashJson = (value) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')

  function ensureSchema() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS migration_batches (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        package_hash TEXT NOT NULL,
        source_system TEXT NOT NULL,
        source_exported_at TEXT NOT NULL,
        data_cutoff_at TEXT NOT NULL,
        source_timezone TEXT NOT NULL,
        source_hash TEXT,
        merchant_confirmed_at TEXT,
        mode TEXT NOT NULL DEFAULT 'initial',
        status TEXT NOT NULL,
        record_count INTEGER NOT NULL,
        import_count INTEGER NOT NULL,
        excluded_count INTEGER NOT NULL,
        opening_balance_cents INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        executed_at TEXT,
        created_by TEXT,
        result_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE (tenant_id, source_system, package_hash)
      );
      CREATE INDEX IF NOT EXISTS idx_migration_batches_cutoff ON migration_batches(tenant_id, source_system, data_cutoff_at);
      CREATE TABLE IF NOT EXISTS customer_migration_records (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        source_record_id TEXT NOT NULL,
        user_id TEXT,
        status TEXT NOT NULL,
        exclusion_reason TEXT,
        mapped_json TEXT NOT NULL DEFAULT '{}',
        source_json TEXT NOT NULL DEFAULT '{}',
        details_json TEXT NOT NULL DEFAULT '{}',
        review_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        UNIQUE (batch_id, source_record_id)
      );
      CREATE INDEX IF NOT EXISTS idx_customer_migration_records_user ON customer_migration_records(tenant_id, user_id);
      CREATE TABLE IF NOT EXISTS customer_migration_links (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        source_system TEXT NOT NULL,
        source_record_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        opening_balance_applied_cents INTEGER NOT NULL DEFAULT 0,
        first_batch_id TEXT NOT NULL,
        last_batch_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (tenant_id, source_system, source_record_id)
      );
      CREATE INDEX IF NOT EXISTS idx_customer_migration_links_user ON customer_migration_links(tenant_id, user_id);
      CREATE TABLE IF NOT EXISTS customer_legacy_transactions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        source_system TEXT NOT NULL,
        source_record_id TEXT NOT NULL,
        source_item_id TEXT NOT NULL,
        occurred_at TEXT,
        summary TEXT,
        raw_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (tenant_id, source_system, source_item_id)
      );
      CREATE INDEX IF NOT EXISTS idx_customer_legacy_tx_user ON customer_legacy_transactions(tenant_id, user_id, occurred_at);
      CREATE TABLE IF NOT EXISTS customer_legacy_assets (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        source_system TEXT NOT NULL,
        source_record_id TEXT NOT NULL,
        source_item_id TEXT NOT NULL,
        asset_kind TEXT NOT NULL,
        title TEXT,
        raw_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (tenant_id, source_system, asset_kind, source_item_id)
      );
      CREATE INDEX IF NOT EXISTS idx_customer_legacy_assets_user ON customer_legacy_assets(tenant_id, user_id, asset_kind);
    `)
  }

  function normalizePackage(input) {
    const pkg = input && typeof input === 'object' ? input : {}
    if (pkg.packageType !== PACKAGE_TYPE) throw apiError(400, 'BAD_MIGRATION_PACKAGE', `迁移包类型必须是 ${PACKAGE_TYPE}。`)
    const sourceSystem = asText(pkg.sourceSystem, 80).toLowerCase()
    const sourceExportedAt = asDate(pkg.sourceExportedAt)
    const dataCutoffAt = asDate(pkg.dataCutoffAt)
    const merchantConfirmedAt = asDate(pkg.merchantConfirmedAt)
    const sourceTimezone = asText(pkg.sourceTimezone, 80) || 'Asia/Shanghai'
    const mode = pkg.mode === 'incremental' ? 'incremental' : 'initial'
    const records = Array.isArray(pkg.records) ? pkg.records : []
    if (!sourceSystem) throw apiError(400, 'BAD_MIGRATION_PACKAGE', '缺少 sourceSystem。')
    if (!sourceExportedAt) throw apiError(400, 'BAD_MIGRATION_PACKAGE', 'sourceExportedAt 不是有效时间。')
    if (!dataCutoffAt) throw apiError(400, 'BAD_MIGRATION_PACKAGE', 'dataCutoffAt 不是有效时间。')
    if (!records.length) throw apiError(400, 'BAD_MIGRATION_PACKAGE', '迁移包没有会员记录。')
    if (records.length > 5000) throw apiError(400, 'BAD_MIGRATION_PACKAGE', '单个迁移包最多 5000 位会员。')
    return {
      packageType: PACKAGE_TYPE,
      schemaVersion: 1,
      sourceSystem,
      sourceExportedAt,
      dataCutoffAt,
      merchantConfirmedAt,
      sourceTimezone,
      sourceHash: asText(pkg.sourceHash, 128) || null,
      mode,
      records,
      anonymousOrders: Array.isArray(pkg.anonymousOrders) ? pkg.anonymousOrders : []
    }
  }

  function latestBatch(tenantId, sourceSystem) {
    return db.prepare(`SELECT id, data_cutoff_at, source_exported_at, executed_at, record_count, import_count, excluded_count, opening_balance_cents
      FROM migration_batches WHERE tenant_id = ? AND source_system = ? AND status = 'executed'
      ORDER BY data_cutoff_at DESC LIMIT 1`).get(tenantId, sourceSystem) || null
  }

  function analyze(tenantId, rawPackage) {
    ensureSchema()
    const pkg = normalizePackage(rawPackage)
    const packageHash = hashJson(pkg)
    const previous = latestBatch(tenantId, pkg.sourceSystem)
    const report = {
      packageType: PACKAGE_TYPE,
      packageHash,
      sourceSystem: pkg.sourceSystem,
      sourceExportedAt: pkg.sourceExportedAt,
      dataCutoffAt: pkg.dataCutoffAt,
      merchantConfirmedAt: pkg.merchantConfirmedAt,
      sourceTimezone: pkg.sourceTimezone,
      mode: pkg.mode,
      rowCount: pkg.records.length,
      toCreate: 0,
      toUpdate: 0,
      excluded: [],
      conflicts: [],
      skipped: [],
      openingBalanceCents: 0,
      detailCounts: { transactions: 0, serviceNotes: 0, cards: 0, gifts: 0, attachments: 0 },
      sourceDetailCounts: { transactions: 0, serviceNotes: 0, cards: 0, gifts: 0, attachments: 0 },
      preservedFieldNames: new Set(),
      previousBatch: previous,
      blockingReasons: []
    }
    if (previous && Date.parse(pkg.dataCutoffAt) <= Date.parse(previous.data_cutoff_at)) {
      report.blockingReasons.push(`本批数据截止时间 ${pkg.dataCutoffAt} 没有晚于上批 ${previous.data_cutoff_at}。`)
    }
    if (db.prepare(`SELECT id FROM migration_batches WHERE tenant_id = ? AND source_system = ? AND package_hash = ? AND status = 'executed'`).get(tenantId, pkg.sourceSystem, packageHash)) {
      report.blockingReasons.push('这个迁移包已经执行过，不能重复导入。')
    }
    const ids = new Set()
    const phones = new Map()
    const actions = []
    pkg.records.forEach((raw, index) => {
      const sourceRecordId = asText(raw?.sourceRecordId, 160)
      const mapped = raw?.mapped && typeof raw.mapped === 'object' ? raw.mapped : {}
      const source = raw?.source && typeof raw.source === 'object' ? raw.source : {}
      const details = raw?.details && typeof raw.details === 'object' ? raw.details : {}
      const review = raw?.review && typeof raw.review === 'object' ? raw.review : {}
      const name = asText(mapped.name, 120)
      const phone = normalizePhone(mapped.phone)
      const excluded = raw?.excluded === true
      const exclusionReason = asText(raw?.exclusionReason || review.note, 500)
      if (!sourceRecordId) {
        report.skipped.push({ line: index + 1, name, reason: '缺少源会员编号。' })
        return
      }
      if (ids.has(sourceRecordId)) {
        report.skipped.push({ line: index + 1, sourceRecordId, name, reason: '同一迁移包内源会员编号重复。' })
        return
      }
      ids.add(sourceRecordId)
      Object.keys(source).forEach((key) => report.preservedFieldNames.add(key))
      for (const key of Object.keys(report.sourceDetailCounts)) {
        const value = details[key]
        report.sourceDetailCounts[key] += Array.isArray(value) ? value.length : 0
      }
      if (excluded) {
        report.excluded.push({ sourceRecordId, name, reason: exclusionReason || '商家确认不导入' })
        actions.push({ mode: 'excluded', sourceRecordId, mapped, source, details, review, name, phone, exclusionReason })
        return
      }
      if (!name && !phone) {
        report.skipped.push({ line: index + 1, sourceRecordId, reason: '姓名和手机号都为空。' })
        return
      }
      for (const key of Object.keys(report.detailCounts)) {
        const value = details[key]
        report.detailCounts[key] += Array.isArray(value) ? value.length : 0
      }
      if (phone && phones.has(phone) && phones.get(phone) !== sourceRecordId) {
        report.conflicts.push({ sourceRecordId, name, phone, reason: `迁移包内手机号重复（另一源编号 ${phones.get(phone)}）。` })
        return
      }
      if (phone) phones.set(phone, sourceRecordId)
      const link = db.prepare(`SELECT * FROM customer_migration_links WHERE tenant_id = ? AND source_system = ? AND source_record_id = ?`).get(tenantId, pkg.sourceSystem, sourceRecordId)
      let existing = link ? db.prepare('SELECT * FROM users WHERE tenant_id = ? AND id = ?').get(tenantId, link.user_id) : null
      if (!existing && phone) existing = db.prepare('SELECT * FROM users WHERE tenant_id = ? AND phone = ? ORDER BY rowid ASC LIMIT 1').get(tenantId, phone)
      if (existing && name && asText(existing.display_name, 120) && asText(existing.display_name, 120) !== name) {
        report.conflicts.push({ sourceRecordId, name, phone, existingName: existing.display_name, reason: '命中已有顾客，但姓名不同，请先人工确认。' })
        return
      }
      const balanceCents = link ? 0 : asCents(mapped.balanceCents)
      const totalSpendCents = asCents(mapped.totalSpendCents)
      report.openingBalanceCents += balanceCents
      if (existing) report.toUpdate += 1
      else report.toCreate += 1
      actions.push({
        mode: existing ? 'update' : 'create', sourceRecordId, mapped, source, details, review,
        name, phone, existing, link, balanceCents, totalSpendCents,
        tags: tagsOf(mapped.tags), birthday: asText(mapped.birthday, 40) || null,
        note: asText(mapped.note, 400) || null
      })
    })
    report.importCount = actions.filter((a) => a.mode === 'create' || a.mode === 'update').length
    report.excludedCount = actions.filter((a) => a.mode === 'excluded').length
    report.preservedFieldNames = Array.from(report.preservedFieldNames).sort()
    if (report.conflicts.length || report.skipped.length) report.blockingReasons.push('仍有冲突或无效记录，请修正迁移包后重新预检。')
    return { pkg, report, actions }
  }

  function preview(tenantId, rawPackage) {
    const { report } = analyze(tenantId, rawPackage)
    return { dryRun: true, tenantId, report }
  }

  function execute(tenantId, body = {}) {
    const { pkg, report, actions } = analyze(tenantId, body.package)
    if (report.blockingReasons.length) throw apiError(409, 'MIGRATION_BLOCKED', report.blockingReasons.join(' '))
    if (asText(body.confirmPackageHash, 128) !== report.packageHash) throw apiError(400, 'PACKAGE_CONFIRM_MISMATCH', '迁移包已变化，请重新预检。')
    if (Math.round(Number(body.confirmOpeningBalanceCents)) !== report.openingBalanceCents) throw apiError(400, 'BALANCE_CONFIRM_MISMATCH', '期初余额确认金额与预检结果不一致。')
    if (Math.round(Number(body.confirmImportCount)) !== report.importCount || Math.round(Number(body.confirmExcludedCount)) !== report.excludedCount) {
      throw apiError(400, 'COUNT_CONFIRM_MISMATCH', '导入/排除人数与预检结果不一致。')
    }
    const now = iso(new Date())
    const batchId = randomId('migration')
    let created = 0
    let updated = 0
    let openingWrittenCents = 0
    let notesWritten = 0
    let transactionsWritten = 0
    let assetsWritten = 0
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare(`INSERT INTO migration_batches (id, tenant_id, package_hash, source_system, source_exported_at, data_cutoff_at, source_timezone,
        source_hash, merchant_confirmed_at, mode, status, record_count, import_count, excluded_count, opening_balance_cents,
        created_at, executed_at, created_by, result_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'executed', ?, ?, ?, ?, ?, ?, 'platform-migration-center', '{}')`).run(
        batchId, tenantId, report.packageHash, pkg.sourceSystem, pkg.sourceExportedAt, pkg.dataCutoffAt, pkg.sourceTimezone,
        pkg.sourceHash, pkg.merchantConfirmedAt, pkg.mode, report.rowCount, report.importCount, report.excludedCount,
        report.openingBalanceCents, now, now)
      for (const action of actions) {
        if (action.mode === 'excluded') {
          db.prepare(`INSERT INTO customer_migration_records (id, batch_id, tenant_id, source_record_id, user_id, status, exclusion_reason,
            mapped_json, source_json, details_json, review_json, created_at) VALUES (?, ?, ?, ?, NULL, 'excluded', ?, ?, ?, ?, ?, ?)`).run(
            randomId('migrec'), batchId, tenantId, action.sourceRecordId, action.exclusionReason || '商家确认不导入',
            JSON.stringify(action.mapped), JSON.stringify(action.source), JSON.stringify(action.details), JSON.stringify(action.review), now)
          continue
        }
        let userId = action.existing?.id || null
        if (action.mode === 'create') {
          userId = randomId('user')
          db.prepare(`INSERT INTO users (id, display_name, phone, tenant_id, tags_json, notes, birthday, is_migrated, legacy_total_spend_cents)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`).run(userId, action.name || action.phone || `迁移会员 ${action.sourceRecordId}`, action.phone || null,
            tenantId, JSON.stringify(action.tags), action.note, action.birthday, action.totalSpendCents)
          const provider = action.phone ? 'phone' : `legacy:${pkg.sourceSystem}`
          const providerUserId = action.phone || action.sourceRecordId
          db.prepare(`INSERT OR IGNORE INTO user_identities (id, user_id, provider, provider_user_id, phone, created_at, updated_at, tenant_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(randomId('identity'), userId, provider, providerUserId, action.phone || null, now, now, tenantId)
          created += 1
        } else {
          let currentTags = []
          try { currentTags = JSON.parse(action.existing.tags_json || '[]') } catch { currentTags = [] }
          const mergedTags = Array.from(new Set([...currentTags, ...action.tags]))
          db.prepare(`UPDATE users SET tags_json = ?, notes = COALESCE(notes, ?), birthday = COALESCE(birthday, ?), is_migrated = 1,
            legacy_total_spend_cents = MAX(legacy_total_spend_cents, ?) WHERE tenant_id = ? AND id = ?`).run(
              JSON.stringify(mergedTags), action.note, action.birthday, action.totalSpendCents, tenantId, userId)
          updated += 1
        }
        if (action.balanceCents > 0) {
          db.prepare(`INSERT INTO stored_value_transactions (id, tenant_id, user_id, type, amount_cents, pay_channel, note, created_by, created_at, bucket)
            VALUES (?, ?, ?, 'migrate_opening', ?, 'migration', ?, 'platform-migration-center', ?, 'legacy')`).run(
              randomId('sv'), tenantId, userId, action.balanceCents,
              `${pkg.sourceSystem} 截止 ${pkg.dataCutoffAt} 的迁移期初余额（源会员 ${action.sourceRecordId}）`, now)
          openingWrittenCents += action.balanceCents
        }
        const existingLink = db.prepare(`SELECT id, opening_balance_applied_cents FROM customer_migration_links
          WHERE tenant_id = ? AND source_system = ? AND source_record_id = ?`).get(tenantId, pkg.sourceSystem, action.sourceRecordId)
        if (existingLink) {
          db.prepare(`UPDATE customer_migration_links SET user_id = ?, last_batch_id = ?, updated_at = ? WHERE id = ?`).run(userId, batchId, now, existingLink.id)
        } else {
          db.prepare(`INSERT INTO customer_migration_links (id, tenant_id, source_system, source_record_id, user_id, opening_balance_applied_cents,
            first_batch_id, last_batch_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
              randomId('miglink'), tenantId, pkg.sourceSystem, action.sourceRecordId, userId, action.balanceCents, batchId, batchId, now, now)
        }
        db.prepare(`INSERT INTO customer_migration_records (id, batch_id, tenant_id, source_record_id, user_id, status, exclusion_reason,
          mapped_json, source_json, details_json, review_json, created_at) VALUES (?, ?, ?, ?, ?, 'imported', NULL, ?, ?, ?, ?, ?)`).run(
            randomId('migrec'), batchId, tenantId, action.sourceRecordId, userId, JSON.stringify(action.mapped), JSON.stringify(action.source),
            JSON.stringify(action.details), JSON.stringify(action.review), now)

        const transactions = Array.isArray(action.details.transactions) ? action.details.transactions : []
        for (let i = 0; i < transactions.length; i += 1) {
          const item = transactions[i]
          const sourceItemId = asText(item?.sourceId, 180) || `${action.sourceRecordId}:transaction:${i}`
          const fields = item?.fields && typeof item.fields === 'object' ? item.fields : {}
          const occurredAt = asDate(item?.occurredAt || fields['结单时间'])
          const summary = asText(item?.summary || fields['订单内容'] || fields['订单号'], 500) || null
          const result = db.prepare(`INSERT OR IGNORE INTO customer_legacy_transactions (id, tenant_id, user_id, batch_id, source_system,
            source_record_id, source_item_id, occurred_at, summary, raw_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
              randomId('legacytx'), tenantId, userId, batchId, pkg.sourceSystem, action.sourceRecordId, sourceItemId, occurredAt, summary, JSON.stringify(item), now)
          transactionsWritten += Number(result.changes || 0)
        }
        const serviceNotes = Array.isArray(action.details.serviceNotes) ? action.details.serviceNotes : []
        for (let i = 0; i < serviceNotes.length; i += 1) {
          const item = serviceNotes[i]
          const sourceItemId = asText(item?.sourceId, 180) || hashJson([pkg.sourceSystem, action.sourceRecordId, 'note', i, item]).slice(0, 32)
          const noteId = `migration-note-${hashJson([tenantId, pkg.sourceSystem, sourceItemId]).slice(0, 32)}`
          const noteText = asText(item?.note || item?.rawText || item?.text, 5000)
          if (!noteText) continue
          const result = db.prepare(`INSERT OR IGNORE INTO service_notes (id, tenant_id, user_id, booking_id, technician_id, technician_name,
            service_name, raw_text, structured_json, created_by, created_at) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, 'platform-migration-center', ?)`).run(
              noteId, tenantId, userId, asText(item?.staff, 120) || null, asText(item?.serviceName, 200) || null, noteText,
              JSON.stringify({ migrated: true, sourceSystem: pkg.sourceSystem, sourceRecordId: action.sourceRecordId, sourceItemId, source: item }),
              asDate(item?.createdAt || item?.date) || pkg.dataCutoffAt)
          notesWritten += Number(result.changes || 0)
        }
        for (const [kind, list, titleKey] of [
          ['card', action.details.cards, 'name'], ['gift', action.details.gifts, 'name'], ['attachment', action.details.attachments, 'name']
        ]) {
          const items = Array.isArray(list) ? list : []
          for (let i = 0; i < items.length; i += 1) {
            const item = items[i]
            const sourceItemId = asText(item?.sourceId, 180) || `${action.sourceRecordId}:${kind}:${i}`
            const fields = item?.fields && typeof item.fields === 'object' ? item.fields : {}
            const title = asText(item?.[titleKey] || fields['储值卡名称'] || fields['赠品名称'] || fields['名称'], 300) || null
            const result = db.prepare(`INSERT OR IGNORE INTO customer_legacy_assets (id, tenant_id, user_id, batch_id, source_system,
              source_record_id, source_item_id, asset_kind, title, raw_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
                randomId('legacyasset'), tenantId, userId, batchId, pkg.sourceSystem, action.sourceRecordId, sourceItemId, kind, title, JSON.stringify(item), now)
            assetsWritten += Number(result.changes || 0)
          }
        }
      }
      const result = { batchId, created, updated, excluded: report.excludedCount, openingWrittenCents, notesWritten, transactionsWritten, assetsWritten }
      db.prepare('UPDATE migration_batches SET result_json = ? WHERE id = ?').run(JSON.stringify(result), batchId)
      db.exec('COMMIT')
      return { dryRun: false, tenantId, report, result }
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  function list(tenantId) {
    ensureSchema()
    const batches = db.prepare(`SELECT id, source_system, source_exported_at, data_cutoff_at, source_timezone, merchant_confirmed_at, mode, status,
      record_count, import_count, excluded_count, opening_balance_cents, executed_at, result_json
      FROM migration_batches WHERE tenant_id = ? ORDER BY executed_at DESC LIMIT 50`).all(tenantId).map((row) => ({
        ...row,
        result: (() => { try { return JSON.parse(row.result_json || '{}') } catch { return {} } })()
      }))
    return { tenantId, batches }
  }

  async function route({ req, res, path, isPlatform, readBody, json }) {
    const legacyMatch = path.match(/^\/platform\/tenants\/([^/]+)\/import\/customers$/)
    const migrationMatch = path.match(/^\/platform\/tenants\/([^/]+)\/migrations(?:\/(preview|execute))?$/)
    if (!legacyMatch && !migrationMatch) return false
    if (!isPlatform()) throw apiError(401, 'UNAUTHORIZED', 'Platform token required.')
    const tenantId = (legacyMatch || migrationMatch)[1]
    if (!db.prepare('SELECT id FROM tenants WHERE id = ?').get(tenantId)) throw apiError(404, 'NOT_FOUND', 'Tenant not found.')
    if (legacyMatch && req.method === 'POST') {
      json(res, 200, importTenantCustomers(tenantId, await readBody(req)))
      return true
    }
    if (migrationMatch && req.method === 'GET' && !migrationMatch[2]) {
      json(res, 200, list(tenantId))
      return true
    }
    if (migrationMatch && req.method === 'POST' && migrationMatch[2] === 'preview') {
      const body = await readBody(req)
      json(res, 200, preview(tenantId, body.package))
      return true
    }
    if (migrationMatch && req.method === 'POST' && migrationMatch[2] === 'execute') {
      json(res, 200, execute(tenantId, await readBody(req)))
      return true
    }
    throw apiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.')
  }

  return { ensureSchema, preview, execute, list, route, packageType: PACKAGE_TYPE }
}
