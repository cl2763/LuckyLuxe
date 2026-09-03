/* 「未动须有证」快照件(店主 03q 立律,2026-09-03)

   立律案由(同族第三次,一次比一次贴近):
   ① 02x 误跑演示夹具 → 148 行写进本机库;
   ② 03d 手敲 curl → 冲销了一条真实收入;
   ③ 03p **我找到了病根(DB_PATH 焊死本机库)、修了脚本,但已落地的 5 行没清,
      回执还写了「本机库未动」** —— 店主拿 D123 备份逐表对行数查出来的。

   店主的定性(照录):**事故本身不是最重的,「未动」写错才是。**
   四库四名是交付里最后一道可信的话;**它一失实,别的都不用看了。**

   律:**开批先打逐表行数快照,交齐时对照;没有对照表不许写「未动」。**

   用法(两个目标都必须显式给,不许有默认 —— 与 db-target 同一姿态):
     node tools/db-snapshot.mjs <库文件绝对路径> [快照文件]        # 打快照
     node tools/db-snapshot.mjs <库文件绝对路径> --diff <快照文件>  # 对照 */
import { DatabaseSync } from 'node:sqlite'
import { writeFileSync, readFileSync } from 'node:fs'
import { requireTarget } from './db-target.mjs'

const dbPath = requireTarget({ envName: '第 1 个参数 <库文件绝对路径>', value: process.argv[2],
  hint: '(沙箱 apps/api/sandbox-data/… / 本机库 apps/api/local-data/…)' })
const args = process.argv.slice(3)
const diffAt = args.indexOf('--diff')
const snapFile = diffAt >= 0 ? args[diffAt + 1] : (args[0] || 'db-snapshot.json')

const db = new DatabaseSync(dbPath, { readOnly: true })
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name)
/* 🔴 03y(店主补):每表**行数与列数都记**。
   D121 那批本机库「87 张表逐表零差异」是**只说了行** —— 而启动迁移给两张表各加了一列
   (产品正常路径,不是事故)。行没变、结构变了,对照表看不出来。
   以后谁改了 schema,交齐时自然露出来。 */
/* 🔴 04c 再补一栏 **idx**(索引数)。案由与 03y 那次同族:
   D132 给 `wechat_conversations` 加了唯一索引 `(tenant_id, provider, external_user_id)` ——
   **行没变、列也没变、结构变了**,行/列两栏一个字都看不出来。
   「未动须有证」要的是「结构也没动」,索引是结构的一部分。 */
const now = {}
for (const t of tables) {
  let rows = null
  let cols = null
  let idx = null
  try { rows = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n } catch { rows = null }
  try { cols = db.prepare('SELECT COUNT(*) AS n FROM pragma_table_info(?)').get(t).n } catch { cols = null }
  try { idx = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND tbl_name = ?").get(t).n } catch { idx = null }
  now[t] = { rows, cols, idx }
}
db.close()

if (diffAt < 0) {
  writeFileSync(snapFile, `${JSON.stringify({ dbPath, tables: now }, null, 2)}\n`)
  const totalRows = Object.values(now).reduce((a, v) => a + (v.rows || 0), 0)
  const totalCols = Object.values(now).reduce((a, v) => a + (v.cols || 0), 0)
  const totalIdx = Object.values(now).reduce((a, v) => a + (v.idx || 0), 0)
  console.log(`\n════ 库快照(行 + 列 + 索引)════\n  库:${dbPath}\n  表:${tables.length} 张 · 总行数 ${totalRows} · 总列数 ${totalCols} · 总索引 ${totalIdx}\n  写入:${snapFile}`)
  process.exit(0)
}

const before = JSON.parse(readFileSync(snapFile, 'utf8'))
/* 老快照可能只存一个数字(行数)或 {rows, cols};新快照存 {rows, cols, idx}。
   三种都读得懂 —— 格式换了不许一律报差异(03y 那次的教训:判据要跟着被测物的格式走)。 */
const norm = (v) => (v && typeof v === 'object'
  ? { rows: v.rows ?? 0, cols: v.cols ?? null, idx: v.idx ?? null }
  : { rows: v ?? 0, cols: null, idx: null })
/* 🔴 04c 现测撞出的一个洞:**新建的空表对照表看不见** ——
   `norm(undefined)` 给出 {rows:0, cols:null},于是行差 0、列差 0(列是 null 就不比),一声不吭。
   D132 新建的 `wecom_unrouted` 就是这么溜过去的。表的增减必须单独报。 */
const added = Object.keys(now).filter((t) => !(t in before.tables))
const removed = Object.keys(before.tables).filter((t) => !(t in now))
const diffs = []
for (const t of new Set([...Object.keys(before.tables), ...Object.keys(now)])) {
  const a = norm(before.tables[t])
  const b = norm(now[t])
  const rowD = b.rows - a.rows
  const colD = (a.cols === null || b.cols === null) ? 0 : b.cols - a.cols
  const idxD = (a.idx === null || b.idx === null) ? 0 : b.idx - a.idx
  if (rowD !== 0 || colD !== 0 || idxD !== 0) {
    diffs.push({ 表: t, 行: `${a.rows}→${b.rows}`, 行差: rowD,
      列: a.cols === null ? '(旧快照没记列)' : `${a.cols}→${b.cols}`, 列差: colD,
      索引: a.idx === null ? '(旧快照没记索引)' : `${a.idx}→${b.idx}`, 索引差: idxD })
  }
}
console.log(`\n════ 「未动须有证」对照表 ════\n  库:${dbPath}\n  快照:${snapFile}`)
if (added.length || removed.length) {
  console.log(`  🔴 表的增减:新增 ${added.length}${added.length ? `(${added.join(' · ')})` : ''}`
    + ` · 消失 ${removed.length}${removed.length ? `(${removed.join(' · ')})` : ''}`)
}
if (!diffs.length && !added.length && !removed.length) {
  console.log('  ✅ 逐表零差异(**表、行、列、索引都比过**)—— 「本库未动」这句话有证据支撑')
  process.exit(0)
}
if (!diffs.length) process.exit(1)
console.log(`  🔴 ${diffs.length} 张表有差异,**不许写「未动」**:`)
for (const d of diffs) {
  const r = d.行差 === 0 ? '行 持平' : `行 ${d.行}(${d.行差 > 0 ? '+' : ''}${d.行差})`
  const c = d.列差 === 0 ? (d.列.startsWith('(') ? d.列 : '列 持平') : `列 ${d.列}(${d.列差 > 0 ? '+' : ''}${d.列差})`
  const x = d.索引差 === 0 ? (d.索引.startsWith('(') ? d.索引 : '索引 持平') : `索引 ${d.索引}(${d.索引差 > 0 ? '+' : ''}${d.索引差})`
  console.log(`     ${d.表}  ${r} · ${c} · ${x}`)
}
process.exit(1)
