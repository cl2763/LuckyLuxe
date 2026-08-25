/* 平台运维域(店主 2026-08-25「乙线开锁」这一批边改边拆,公约②)。

   这一族原本散在 local-server.mjs 的路由里:重置财务密码、按需备份、逐店五项、运维日志。
   共同点是**平台侧动商家的东西,每一次都要留痕** —— 收成一处,以后加动作只在这里加,
   不会再出现"某个平台动作忘了写日志"。路由那边只剩门禁 + 分发。 */
export function createPlatformOps({ db, apiError, randomId, iso, snapshotDb, dbPath, backupDir, financeSessions }) {
  const now = () => iso(new Date())
  function writeLog(tenantId, action, detail, operator = 'platform') {
    db.prepare('INSERT INTO platform_ops_log (id, tenant_id, action, detail, operator, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(randomId('oplog'), tenantId, action, String(detail).slice(0, 500), operator, now())
  }

  /* 平台侧重置商家财务密码(「忘记密码找平台」的标准路径)。
     清空 hash 并把门禁关掉 —— 商家进得去财务区,想再上锁自己在卡上开。 */
  function resetFinanceLock(tenantId, reason) {
    const tenant = db.prepare('SELECT id, name, finance_password_hash, finance_lock_enabled FROM tenants WHERE id = ?').get(tenantId)
    if (!tenant) throw apiError(404, 'NOT_FOUND', 'Tenant not found.')
    const had = Boolean(tenant.finance_password_hash)
    db.prepare('UPDATE tenants SET finance_password_hash = NULL, finance_lock_enabled = 0, updated_at = ? WHERE id = ?').run(now(), tenantId)
    for (const [key, session] of financeSessions) {              // 该店已发出去的钥匙一并作废
      if (session && session.tenantId === tenantId) financeSessions.delete(key)
    }
    writeLog(tenantId, 'finance_lock_reset',
      `清空财务密码并关闭门禁(原状态:${had ? '有密码' : '无密码'}/${tenant.finance_lock_enabled ? '已开启' : '未开启'})。原因:${String(reason || '店主忘记密码,平台侧重置').slice(0, 200)}`)
    return {
      tenantId,
      tenantName: tenant.name,
      enabled: false,
      configured: false,
      hadPassword: had,
      note: '财务密码已清空、门禁已关闭。商家可在「财务 → 财务设置 → 财务密码」自助重新开启。'
    }
  }

  /* 🔴 生产例外第⑤条(店主 2026-08-25):按需备份 —— 动生产之前先调它,**备份或中止**;
     返回的路径要写进回报与运维日志。落盘走唯一出口 ./db-backup.mjs。 */
  function backup({ tag, tenantId, reason }) {
    let snap
    try {
      snap = snapshotDb({ dbPath, backupDir, tag: String(tag || '按需备份').slice(0, 40) })
    } catch (error) {
      /* 空间预检没过 / 落盘失败 —— 一律 400/500 抛出去,**没写**。
         调用方(铺设脚本)拿不到 path 就必须中止,这条不靠自觉。 */
      throw apiError(507, 'BACKUP_ABORTED', `备份已中止(没写):${error.message}`)
    }
    // ⓒ 剩余/总容量每次都进日志;ⓐ 清掉的旧快照也点名,别让人猜文件去哪了
    writeLog(String(tenantId || '__system__'), 'backup',
      `按需备份:${snap.path}(${snap.size} 字节)。${snap.spaceText}。`
      + `${snap.pruned.length ? `已按保留策略清理 ${snap.pruned.length} 份旧快照:${snap.pruned.join(' / ')}。` : '无旧快照可清。'}`
      + `原因:${String(reason || '').slice(0, 200)}`)
    return snap
  }

  /* 生产例外第⑥条:逐店五项 —— 铺设前后各取一次,对不上立刻停。 */
  function tenantStats(tenantId) {
    if (!db.prepare('SELECT id FROM tenants WHERE id = ?').get(tenantId)) throw apiError(404, 'NOT_FOUND', 'Tenant not found.')
    const n = (sql) => db.prepare(sql).get(tenantId).n
    return {
      incomeCents: n("SELECT COALESCE(SUM(amount_cents),0) n FROM finance_transactions WHERE tenant_id = ? AND type = 'income'"),
      financeRows: n('SELECT COUNT(*) n FROM finance_transactions WHERE tenant_id = ?'),
      bookings: n('SELECT COUNT(*) n FROM bookings WHERE tenant_id = ?'),
      users: n('SELECT COUNT(*) n FROM users WHERE tenant_id = ?'),
      settlements: n('SELECT COUNT(*) n FROM settlements WHERE tenant_id = ?')
    }
  }

  /* 生产例外第⑦条:铺设脚本跑完写一行(谁/何时/哪家店/铺了多少/备份路径)。
     内容由脚本组织,这里只校验"确实写了东西",不替它编。 */
  function logDemoSeed({ tenantId, detail }) {
    if (!String(tenantId || '').trim()) throw apiError(400, 'BAD_REQUEST', 'tenantId 必填。')
    if (!String(detail || '').trim()) throw apiError(400, 'BAD_REQUEST', 'detail 必填(要写清铺了多少行、备份在哪)。')
    writeLog(String(tenantId).trim(), 'demo_seed', detail)
    return { logged: true }
  }

  const recentLogs = () => db.prepare('SELECT * FROM platform_ops_log ORDER BY created_at DESC, rowid DESC LIMIT 100').all()

  return { resetFinanceLock, backup, tenantStats, logDemoSeed, recentLogs, writeLog }
}
