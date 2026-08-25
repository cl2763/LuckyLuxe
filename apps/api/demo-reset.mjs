/* 演示店账本重置 —— **唯一入口**(店主 2026-08-25 裁定六条)。

   为什么要有这个模块:D72/D73 之后,演示店(kind='demo')的账本**不受只追加律保护** ——
   那是重播种必需的豁免。但"能改"必须配一条**有人管、有留痕**的路,
   否则豁免就是一个谁都能悄悄用的后门。

   店主六条(原话为准):
   ① 唯一入口 POST /platform/tenants/:id/demo-reset,isPlatform() 闸门;别处不许删演示店账本。
   ② 前置:kind='demo' 才放行;非 demo 一律 **403**(不是 404 —— 要让人知道是被拦了,不是找不到)。
   ③ 二次确认:**手打完整店名**才放行,不许勾选框。它删的是账本。
   ④ 重置前自动备份,备份不成就中止;备份路径写进回报与留痕。
   ⑤ 留痕写 platform_ops_log:平台账号、时间、店 id、重置前行数快照、原因(必填)、备份路径。
   ⑥ 会红的断言:拿 lucky-luxe 当探针打这条必须 403;拿 demo 店真跑一次必须成功且 ops-log 落一行。

   公约①:新功能一律新模块 —— local-server 只留 import + 一行分发。 */

/* 🔴 演示店判据 —— **唯一出口**(店主 08-25:判据只写一处,能共用就共用)。
   谁要判"这家店是不是演示店",一律问这里:重置口(本模块)、铺设脚本(tools/seed-demo-twin.mjs)、
   以后任何新入口都一样。判据落在**数据**(tenants.kind)上,不看名字 —— D73 立的规矩。
   fail-closed:kind 拿不到按 real 算,宁可拦住一次合法操作,不许放过一次真店。 */
export const DEMO_KIND = 'demo'
export function isDemoTenant(tenant) {
  return String(tenant?.kind || 'real') === DEMO_KIND
}

/* 演示店重置会清掉的表(**只清这家店的经营数据**,不动店本身/账号/门店资料/服务价目):
   重播种脚本会重新铺这些,所以清单与它对齐;不在这张表里的一律不碰。 */
const RESET_TABLES = [
  'finance_transactions', 'stored_value_transactions', 'points_transactions',
  'settlements', 'settlement_items', 'settlement_payments', 'settlement_technicians',
  'settlement_groups', 'settlement_amendments', 'settlement_sign_tokens',
  'bookings', 'booking_slots', 'booking_status_history', 'booking_drafts', 'payments',
  'deposit_receipts', 'deposit_disposals', 'deposit_retains',
  'coupon_grants', 'coupon_grant_logs', 'member_timecards',
  'after_sales_events', 'daily_closes', 'daily_close_lines',
  'salary_payrolls', 'salary_adjusts', 'salary_adjust_items',
  'service_notes', 'attendance_records', 'quote_requests'
]

export function createDemoReset({ db, apiError, randomId, iso, copyFileSync, dbPath, backupDir, mkdirSync, existsSync }) {
  /* 🔴 D73 留的洞(2026-08-25 铺设时撞到):归属只能在**建店那一刻**定,
     已经建好的店没有任何入口能改 —— 于是「小婕的店(演示)」这种**名字是演示、归属是 real** 的店
     既不能铺演示数据、也不能重置,而我写在错误提示里的那句"归属只能在平台后台显式设置"当时是句空话。
     现在补上:平台可以改归属,但**只在 real ↔ demo 之间**(test 只由测试库建店产生,不许人工设),
     且每次都写 ops-log —— 这一步改的是"这家店的账本受不受只追加律保护",必须有据可查。 */
  function setTenantKind({ tenantId, kind, reason, operator = 'platform' }) {
    const tenant = db.prepare('SELECT id, name, kind FROM tenants WHERE id = ?').get(tenantId)
    if (!tenant) throw apiError(404, 'NOT_FOUND', '找不到这家店。')
    if (!['real', 'demo'].includes(kind)) throw apiError(400, 'BAD_KIND', "归属只能设成 real 或 demo(test 由测试库建店自动产生,不许人工设)。")
    if (tenant.kind === 'test') throw apiError(403, 'TEST_TENANT', '这是测试库产生的租户,不许改归属。')
    const why = String(reason || '').trim()
    if (!why) throw apiError(400, 'REASON_REQUIRED', '改归属必须写一句原因(会写进平台运维日志)。')
    const now = iso(new Date())
    db.prepare('UPDATE tenants SET kind = ?, updated_at = ? WHERE id = ?').run(kind, now, tenantId)
    db.prepare('INSERT INTO platform_ops_log (id, tenant_id, action, detail, operator, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(randomId('oplog'), tenantId, 'tenant_kind_change',
        `归属 ${tenant.kind} → ${kind}(${kind === 'demo' ? '账本从此不受只追加律保护、可整体重置' : '账本从此受只追加律保护'})。原因:${why.slice(0, 200)}`,
        operator, now)
    return { tenantId, tenantName: tenant.name, from: tenant.kind, to: kind, at: now }
  }

  const countOf = (table, tenantId) => {
    try { return db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE tenant_id = ?`).get(tenantId).n } catch (e) { return 0 }
  }

  /* 重置前快照:留痕里要写"删之前有多少",不然事后没法判断这次重置删掉了什么。 */
  function snapshotOf(tenantId) {
    return {
      finance: countOf('finance_transactions', tenantId),
      bookings: countOf('bookings', tenantId),
      settlements: countOf('settlements', tenantId),
      users: countOf('users', tenantId)
    }
  }

  function demoReset({ tenantId, confirmName, reason, operator = 'platform' }) {
    const tenant = db.prepare('SELECT id, name, kind FROM tenants WHERE id = ?').get(tenantId)
    if (!tenant) throw apiError(404, 'NOT_FOUND', '找不到这家店。')
    // ② 非 demo 一律 403:让人知道是被拦了,不是找不到
    if (!isDemoTenant(tenant)) {
      throw apiError(403, 'NOT_DEMO_TENANT', `「${tenant.name}」不是演示店(kind=${tenant.kind}),不允许重置账本。演示店归属只能在平台后台显式设置。`)
    }
    // ③ 手打完整店名才放行(不许勾选框)
    if (String(confirmName || '').trim() !== String(tenant.name || '').trim()) {
      throw apiError(400, 'CONFIRM_NAME_MISMATCH', `二次确认没通过:请**手打完整店名**「${tenant.name}」。它删的是账本。`)
    }
    // ⑤ 原因必填
    const why = String(reason || '').trim()
    if (!why) throw apiError(400, 'REASON_REQUIRED', '重置原因必填(会写进平台运维日志)。')

    const before = snapshotOf(tenantId)
    const now = iso(new Date())

    // ④ 先备份,备份不成就中止
    let backupPath = ''
    try {
      mkdirSync(backupDir, { recursive: true })
      const stamp = now.replace(/[-:T]/g, '').slice(0, 14)
      backupPath = `${backupDir}/lucky-luxe-${stamp}-演示店重置前-${tenantId}.sqlite`
      for (let n = 2; existsSync(backupPath) && n <= 20; n += 1) {
        backupPath = `${backupDir}/lucky-luxe-${stamp}-${n}-演示店重置前-${tenantId}.sqlite`
      }
      if (existsSync(backupPath)) throw new Error('备份文件名连撞 20 次,等一秒再来')
      copyFileSync(dbPath, backupPath)
    } catch (error) {
      throw apiError(500, 'BACKUP_FAILED', `备份失败,已中止重置(一行没删):${error.message}`)
    }

    let deleted = 0
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const table of RESET_TABLES) {
        try { deleted += db.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).run(tenantId).changes || 0 } catch (e) { /* 老库没这张表:跳过 */ }
      }
      db.prepare('INSERT INTO platform_ops_log (id, tenant_id, action, detail, operator, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomId('oplog'), tenantId, 'demo_reset',
          `演示店账本重置:删 ${deleted} 行。重置前快照 账本 ${before.finance} / 单 ${before.bookings} / 结算单 ${before.settlements} / 顾客 ${before.users}。原因:${why.slice(0, 200)}。备份:${backupPath}`,
          operator, now)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw apiError(500, 'RESET_FAILED', `重置失败已回滚(库未改动):${error.message}`)
    }

    return {
      tenantId,
      tenantName: tenant.name,
      deletedRows: deleted,
      before,
      after: snapshotOf(tenantId),
      backupPath,
      reason: why,
      at: now,
      note: '演示店账本已重置。回滚办法:停服务 → 用上面这份备份覆盖回主库。'
    }
  }

  return { demoReset, setTenantKind, RESET_TABLES }
}
