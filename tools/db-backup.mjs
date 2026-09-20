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
import { requireTarget } from './db-target.mjs'
import { backupDb } from '../apps/api/db-backup-core.mjs'

/* 🔴 **实现住在 `apps/api/db-backup-core.mjs`**(09n 件 A):
   开机迁移在生产容器里要用它,而生产代码不该去 import `tools/`。
   这里只做**转出**,保持老调用方不用改 —— **唯一出口仍只有一个。** */
export { backupDb }

/* 🔴 10a:这个命令行入口原来有**两个病**,是在生产容器里真跑一次才咬出来的
 * (只读侦查跑不到它,`node -c` 也查不出来 —— 它是运行期的 ReferenceError)。
 *
 * ① **`statSync` 用了但从没 import** ⇒ 跑到最后一行 `ReferenceError`,整条命令非零退出。
 *    VACUUM 本身其实已经做完了,于是它是**最坏的那种坏**:事情做成了,命令报失败,
 *    照着 runbook 走的人会以为「备份没成」而重来或放弃。
 * ② 🔴 **它自己又手写了一遍 VACUUM INTO + 当场验**,而上面明明 `export` 了 `backupDb`。
 *    «唯一出口» 这四个字对 CLI 这条路是**假的** —— 归族「一件事两处真相」。
 *    ①其实是②的必然结果:抄的那一份漏了一个 import,而正本里有。
 *
 * 改法只能是②:**删掉手抄的那一份,改调 `backupDb`**。只修 ① 等于把抄本留着。
 * 配套 J-102:`test-script-smoke` 现在会真跑一次这条 CLI(见该套件),
 * 不然下一个漏 import 照样要等到生产容器里才发现。
 *
 * 用法:DBB_SRC=<库绝对路径> DBB_OUT=<备份文件绝对路径> node tools/db-backup.mjs
 */
if (!process.env.DBB_SRC && !process.env.DBB_OUT) { /* 作为模块被引入 */ } else {
  const SRC = requireTarget({ envName: 'DBB_SRC=<库绝对路径>', value: process.env.DBB_SRC, hint: '(要备份哪个库)' })
  const OUT = requireTarget({ envName: 'DBB_OUT=<备份文件绝对路径>', value: process.env.DBB_OUT, hint: '(备份写到哪)' })
  const r = backupDb(SRC, OUT)          // VACUUM INTO + 当场打开验一次,都在出口里
  console.log(JSON.stringify({ 源库: SRC, 备份: r.out, 字节: r.bytes, 表: r.tables, 已验证可打开: true }, null, 0))
}
