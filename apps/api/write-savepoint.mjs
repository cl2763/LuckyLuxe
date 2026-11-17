/** Reserve the SQLite writer before taking a configuration snapshot.
 * A deferred SAVEPOINT can hit SQLITE_BUSY_SNAPSHOT after another connection
 * commits; busy_timeout cannot repair that stale snapshot. A zero-row UPDATE
 * obtains the writer reservation without changing records or firing row triggers.
 * Unlike BEGIN IMMEDIATE this also works inside a platform draft transaction.
 */
export function beginWriteSavepoint(db, name, table) {
  if (!/^[a-z_]+$/.test(name) || !/^[a-z_]+$/.test(table)) throw new Error('Invalid write savepoint')
  db.exec(`SAVEPOINT ${name}`)
  try { db.exec(`UPDATE "${table}" SET rowid=rowid WHERE 0`) }
  catch (error) { db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`); throw error }
}
