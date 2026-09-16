/* 库文件备份的**唯一实现** —— 开了 WAL 之后 `cp` 那一份是打不开的
 *
 * 🔴 案底(05n 店主现场撞出来):给库开了 `journal_mode=WAL` 之后,按老规矩
 * `cp lucky-luxe.sqlite <备份名>` —— 拷出来的文件一打开就报 `file is not a database`,
 * 因为已提交的数据有 4.1 MB 还躺在 `-wal` 里。**只拷主文件等于拷了半个库。**
 * 更坏的是它**看起来是成功的**:exit 0、大小正常,直到真要回滚才知道是废的。
 *
 * 🔴 为什么核心住在 `apps/api/` 而不是 `tools/`(09n 件 A):
 * 开机迁移(`local-server.mjs` 里那两处重建)**在生产容器里**要用它。
 * 让生产代码去 import `tools/` 是跨层依赖,而且「`tools/` 在不在那个镜像里」我**没核到**
 * (`railway ssh` 那次连接被对端关了,我没有第二次去撞)。
 * **不确定的东西不许进开机链** —— 所以核心搬到这里,`tools/db-backup.mjs` 反过来引它。
 * 这样开机链只依赖 `apps/api` 自己,与 `local-server.mjs` 同一个目录。
 */
import { DatabaseSync } from 'node:sqlite'
import { statSync } from 'node:fs'

/** `VACUUM INTO` 出一个自洽单文件 + **当场打开验一次**。不验的备份不算备份。 */
export function backupDb(src, out) {
  const db = new DatabaseSync(src, { readOnly: true })
  db.prepare('VACUUM INTO ?').run(out)
  db.close()
  const check = new DatabaseSync(out, { readOnly: true })
  const tables = check.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get()?.n || 0
  check.close()
  if (!tables) throw new Error(`备份写出来了但读不到表:${out}`)
  return { out, bytes: statSync(out).size, tables }
}

/** 重建型迁移的备份出口:开机链上那两处都走它。取不到就抛 —— **备份失败不许被当成没事**。 */
export function backupBeforeRebuild({ dbPath, tag }) {
  if (!dbPath) throw new Error('backupBeforeRebuild:没给 dbPath —— 重建前必须备份,不许静默跳过')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const out = `${dbPath}.pre-${tag}-${stamp}`
  const r = backupDb(dbPath, out)
  return r.out
}
