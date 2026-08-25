/* 平台运维域(店主 2026-08-25「乙线开锁」这一批边改边拆,公约②)。

   这一族原本散在 local-server.mjs 的路由里:重置财务密码、按需备份、逐店五项、运维日志。
   共同点是**平台侧动商家的东西,每一次都要留痕** —— 收成一处,以后加动作只在这里加,
   不会再出现"某个平台动作忘了写日志"。路由那边只剩门禁 + 分发。 */
export function createPlatformOps({ db, apiError, randomId, iso, snapshotDb, dbPath, backupDir, financeSessions, adminPasswordHash, randomPassword }) {
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

  /* 🔴 D76:改**可见性**(顾客选店页出不出现)。只写 tenants.listed 一列 ——
     不碰 kind、不碰账本,D75 那两道锁一条都不触发(它们管账本归属,不管展示)。 */
  function setListed({ tenantId, listed, reason }) {
    const t = db.prepare('SELECT id, name, listed FROM tenants WHERE id = ?').get(tenantId)
    if (!t) throw apiError(404, 'NOT_FOUND', 'Tenant not found.')
    if (typeof listed !== 'boolean') throw apiError(400, 'BAD_REQUEST', 'listed 必须是 true / false。')
    const why = String(reason || '').trim()
    if (!why) throw apiError(400, 'REASON_REQUIRED', '改可见性必须写一句原因(会写进平台运维日志)。')
    db.prepare('UPDATE tenants SET listed = ?, updated_at = ? WHERE id = ?').run(listed ? 1 : 0, now(), tenantId)
    writeLog(tenantId, 'tenant_listed_change',
      `选店页可见性 ${t.listed ? '可见' : '隐藏'} → ${listed ? '可见' : '隐藏'}(只改展示,账本与归属未动)。原因:${why.slice(0, 200)}`)
    return { tenantId, tenantName: t.name, listed }
  }

  /* 🔴 重置**商家老板**密码(店主 2026-08-25 定,B 案先做)。
     立这条不是为了演示店:**真商户上线后忘记老板密码是必然事件**,
     而平台端此前只有「员工账号重置」与「财务密码重置」——真商户一旦忘,
     除了直接改数据库没有别的办法。那是运营能力缺口,不是演示需求。
     所以**真店也能重置**,靠护栏兜住:
       ① 手打完整店名二次确认(与 demo-reset 同款,不许勾选框)
       ② 必填原因
       ③ 落 platform_ops_log
       ④ 下发一次性新密码 + **首登强制改密**(must_change_password=1)
       ⑤ 旧会话一并吊销 —— 不然拿着旧 token 的人还在里面,重置等于没重置 */
  function resetOwnerPassword({ tenantId, confirmName, reason, operator = 'platform' }) {
    const t = db.prepare('SELECT id, name FROM tenants WHERE id = ?').get(tenantId)
    if (!t) throw apiError(404, 'NOT_FOUND', 'Tenant not found.')
    if (String(confirmName || '').trim() !== String(t.name || '').trim()) {
      throw apiError(400, 'CONFIRM_NAME_MISMATCH', `二次确认没通过 —— 请一字不差手打这家店的完整名称「${t.name}」。`)
    }
    const why = String(reason || '').trim()
    if (!why) throw apiError(400, 'REASON_REQUIRED', '重置老板密码必须写一句原因(会写进平台运维日志)。')
    const account = db.prepare("SELECT * FROM admin_accounts WHERE tenant_id = ? AND role = 'owner' ORDER BY created_at ASC LIMIT 1").get(tenantId)
    if (!account) throw apiError(404, 'NO_OWNER_ACCOUNT', '这家店没有老板账号(建店时未生成?)。')
    const initialPassword = randomPassword()
    const now2 = now()
    db.prepare('UPDATE admin_accounts SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?')
      .run(adminPasswordHash(account.username, initialPassword), now2, account.id)
    let revoked = 0
    try {
      revoked = db.prepare('SELECT COUNT(*) n FROM admin_sessions WHERE account_id = ?').get(account.id).n
      db.prepare('DELETE FROM admin_sessions WHERE account_id = ?').run(account.id)
    } catch (e) { /* 会话表不在就算了,密码已经换掉 */ }
    writeLog(tenantId, 'owner_password_reset',
      `重置商家老板密码(账号 ${account.username});已吊销该账号 ${revoked} 个在用会话;新密码首登强制改。原因:${why.slice(0, 200)}`, operator)
    return { tenantId, tenantName: t.name, username: account.username, initialPassword, mustChangePassword: true, revokedSessions: revoked }
  }

  /* 平台租户清单(平台后台那张表的数据源)。
     随列表下发 kind(D73:归属认数据不认名字)与 listed(D76:选店页可见性)。 */
  function listTenants(monthStartIso) {
    const rows = db.prepare(`
      SELECT t.id, t.name, t.plan, t.status, t.plan_expires_at, t.kind, t.listed,
        (SELECT COUNT(*) FROM stores s WHERE s.tenant_id = t.id AND s.is_active = 1) AS store_count,
        (SELECT COUNT(*) FROM bookings b WHERE b.tenant_id = t.id) AS booking_count,
        (SELECT COUNT(*) FROM bookings b WHERE b.tenant_id = t.id AND b.appointment_start >= ?) AS month_booking_count,
        (SELECT username FROM admin_accounts a WHERE a.tenant_id = t.id AND a.role = 'owner' LIMIT 1) AS owner_username
      FROM tenants t ORDER BY t.rowid ASC
    `).all(monthStartIso)
    return rows.map((r) => ({
      id: r.id, name: r.name, plan: r.plan, status: r.status, kind: r.kind || 'real', listed: r.listed === 1,
      planExpiresAt: r.plan_expires_at, storeCount: r.store_count, bookingCount: r.booking_count,
      monthBookingCount: r.month_booking_count, ownerUsername: r.owner_username || ''
    }))
  }

  const recentLogs = () => db.prepare('SELECT * FROM platform_ops_log ORDER BY created_at DESC, rowid DESC LIMIT 100').all()

  return { resetFinanceLock, resetOwnerPassword, backup, tenantStats, logDemoSeed, setListed, listTenants, recentLogs, writeLog }
}
