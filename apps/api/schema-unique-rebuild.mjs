import { backupBeforeRebuild } from './db-backup-core.mjs'
/* 唯一约束重建(users / user_identities:全局唯一 → **按租户**唯一)
   —— 2026-09-03 04f-2 从 `local-server.mjs` 搬出,**块一个字没改**(《棘轮律》+ 公约②:
   动了「表重建」这个域(去 tenant_id 列默认值)就把同域的另一处重建也带走)。

   为什么要按租户唯一:同一个 openid 在两家店各有一份档案是本系统的既定口径;
   全局唯一会让第二家店建不出档案,或者串到第一家店去 —— 「半串半不串,最难查的那种」。
   SQLite 不能改列约束,只能重建表。幂等:只有检测到旧的全局 UNIQUE 才重建,重跑一分不动。 */
export function rebuildTenantScopedUnique(db, { dbPath = '' } = {}) {
  /* 🔴 09n 件 B-3:**`DROP TABLE` 之前必须先备份。**
   * 这一支现测在生产上**不会触发**(生产 `users` 的 `wechat_open_id` 没有 UNIQUE,
   * 且完整顺序跑完之后建表语句里也没有长出 UNIQUE —— 第二次开机逐表零差异现证)。
   * **但「这次恰好不触发」是运气,不是设计。** 它是全仓仅有的两处 `DROP TABLE`,
   * 而且此前**一行备份都没有**。这里补上,与另一处重建走同一个出口。
   * 取不到 `dbPath` 时**不静默跳过**:要么备份成功,要么把这件事说出来。 */
  const backupFirst = (tag) => {
    if (!dbPath) { console.warn(`[migrate] ${tag}:🔴 没拿到 dbPath,**这次重建没有备份**(调用方要把 dbPath 传进来)`); return '' }
    const out = backupBeforeRebuild({ dbPath, tag })
    console.log(`[migrate] ${tag} 重建前已备份(VACUUM INTO):${out}`)
    return out
  }
  try {
    const usersSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() || {}).sql || ''
    if (/wechat_open_id\s+TEXT\s+UNIQUE/i.test(usersSql)) {
      const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name)
      const defs = db.prepare('PRAGMA table_info(users)').all().map((c) => {
        const notNull = c.notnull ? ' NOT NULL' : ''
        const dflt = c.dflt_value === null || c.dflt_value === undefined ? '' : ` DEFAULT ${c.dflt_value}`
        const pk = c.pk ? ' PRIMARY KEY' : ''
        return `${c.name} ${c.type || 'TEXT'}${pk}${notNull}${dflt}`
      })
      db.exec('PRAGMA foreign_keys=OFF')
      db.exec('BEGIN')
      db.exec(`CREATE TABLE users_rebuild (${defs.join(', ')})`)
      db.exec(`INSERT INTO users_rebuild (${cols.join(', ')}) SELECT ${cols.join(', ')} FROM users`)
      backupFirst('unique-rebuild-users')
      db.exec('DROP TABLE users')
      db.exec('ALTER TABLE users_rebuild RENAME TO users')
      db.exec('COMMIT')
      db.exec('PRAGMA foreign_keys=ON')
      console.log('[migrate] users 唯一性重建:openid/google_id 全局唯一 → 按租户唯一')
    }
    const identSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='user_identities'").get() || {}).sql || ''
    if (/UNIQUE\s*\(provider,\s*provider_user_id\)/i.test(identSql)) {
      const cols = db.prepare('PRAGMA table_info(user_identities)').all().map((c) => c.name)
      const defs = db.prepare('PRAGMA table_info(user_identities)').all().map((c) => {
        const notNull = c.notnull ? ' NOT NULL' : ''
        const dflt = c.dflt_value === null || c.dflt_value === undefined ? '' : ` DEFAULT ${c.dflt_value}`
        const pk = c.pk ? ' PRIMARY KEY' : ''
        return `${c.name} ${c.type || 'TEXT'}${pk}${notNull}${dflt}`
      })
      db.exec('PRAGMA foreign_keys=OFF')
      db.exec('BEGIN')
      db.exec(`CREATE TABLE user_identities_rebuild (${defs.join(', ')})`)
      db.exec(`INSERT INTO user_identities_rebuild (${cols.join(', ')}) SELECT ${cols.join(', ')} FROM user_identities`)
      backupFirst('unique-rebuild-identities')
      db.exec('DROP TABLE user_identities')
      db.exec('ALTER TABLE user_identities_rebuild RENAME TO user_identities')
      db.exec('COMMIT')
      db.exec('PRAGMA foreign_keys=ON')
      console.log('[migrate] user_identities 唯一性重建:(provider,openid) 全局唯一 → 按租户唯一')
    }
  } catch (error) {
    console.warn('[migrate] 唯一性重建失败(已跳过,老数据未动):', error.message)
  }
}
