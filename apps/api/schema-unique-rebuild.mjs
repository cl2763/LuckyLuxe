/* 唯一约束重建(users / user_identities:全局唯一 → **按租户**唯一)
   —— 2026-09-03 04f-2 从 `local-server.mjs` 搬出,**块一个字没改**(《棘轮律》+ 公约②:
   动了「表重建」这个域(去 tenant_id 列默认值)就把同域的另一处重建也带走)。

   为什么要按租户唯一:同一个 openid 在两家店各有一份档案是本系统的既定口径;
   全局唯一会让第二家店建不出档案,或者串到第一家店去 —— 「半串半不串,最难查的那种」。
   SQLite 不能改列约束,只能重建表。幂等:只有检测到旧的全局 UNIQUE 才重建,重跑一分不动。 */
export function rebuildTenantScopedUnique(db) {
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
