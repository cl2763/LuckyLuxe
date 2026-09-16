/* 库文件备份 —— **开了 WAL 之后,`cp` 那一份是打不开的**(店主 05n 现场撞出来的)
 *
 * 🔴 案底:05n 裁 (6) 给库开了 `journal_mode=WAL`。当天按老规矩
 * 「一次库文件备份」`cp lucky-luxe.sqlite <备份名>` —— 拷出来的文件
 * Python 一打开就报 **`file is not a database`**,因为已提交的数据有 4.1 MB
 * 还躺在 `-wal` 里,只拷主文件等于拷了半个库。
 * 更坏的是它**看起来是成功的**:命令 exit 0、文件大小正常,
 * 直到真去读它(或真要回滚)才知道是废的。
 *
 * 所以备份改走 `VACUUM INTO`:SQLite 自己把一个**自洽的单文件**写出来,
 * 不需要 -wal/-shm 陪着,也不会拷到写了一半的页。
 * 写完当场**打开验一次**(能开、数得出表)—— 不验的备份不算备份。
 *
 * 用法:DBB_SRC=<库绝对路径> DBB_OUT=<备份文件绝对路径> node tools/db-backup.mjs
 */
import { DatabaseSync } from 'node:sqlite'
import { requireTarget } from './db-target.mjs'

/* 🔴 **实现搬到 `apps/api/db-backup-core.mjs` 了**(09n 件 A):
   开机迁移在生产容器里要用它,而生产代码不该去 import `tools/`。
   这里只做**转出**,保持老调用方不用改 —— **唯一出口仍只有一个。** */
export { backupDb } from '../apps/api/db-backup-core.mjs'

/* 下面是命令行入口;被 import 时不跑(没给 DBB_SRC 就直接返回)。 */
if (!process.env.DBB_SRC && !process.env.DBB_OUT) { /* 作为模块被引入 */ } else {

const SRC = requireTarget({ envName: 'DBB_SRC=<库绝对路径>', value: process.env.DBB_SRC, hint: '(要备份哪个库)' })
const OUT = requireTarget({ envName: 'DBB_OUT=<备份文件绝对路径>', value: process.env.DBB_OUT, hint: '(备份写到哪)' })

const src = new DatabaseSync(SRC, { readOnly: true })
src.prepare('VACUUM INTO ?').run(OUT)
src.close()

/* 当场验:打得开、表数对得上 —— 「备份成功」不能只看 exit 0 */
const check = new DatabaseSync(OUT, { readOnly: true })
const tables = check.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get()?.n || 0
const triggers = check.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger'").get()?.n || 0
check.close()
if (!tables) throw new Error(`备份写出来了但读不到表:${OUT}`)

console.log(JSON.stringify({
  源库: SRC, 备份: OUT, 字节: statSync(OUT).size, 表: tables, 触发器: triggers, 已验证可打开: true,
}, null, 0))
}
