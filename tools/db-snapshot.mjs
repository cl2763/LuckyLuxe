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
const now = {}
for (const t of tables) {
  try { now[t] = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n } catch { now[t] = null }
}
db.close()

if (diffAt < 0) {
  writeFileSync(snapFile, `${JSON.stringify({ dbPath, tables: now }, null, 2)}\n`)
  console.log(`\n════ 库行数快照 ════\n  库:${dbPath}\n  表:${tables.length} 张 · 总行数 ${Object.values(now).reduce((a, b) => a + (b || 0), 0)}\n  写入:${snapFile}`)
  process.exit(0)
}

const before = JSON.parse(readFileSync(snapFile, 'utf8'))
const diffs = []
for (const t of new Set([...Object.keys(before.tables), ...Object.keys(now)])) {
  const a = before.tables[t] ?? 0
  const b = now[t] ?? 0
  if (a !== b) diffs.push({ 表: t, 开批: a, 现在: b, 差: b - a })
}
console.log(`\n════ 「未动须有证」对照表 ════\n  库:${dbPath}\n  快照:${snapFile}`)
if (!diffs.length) {
  console.log('  ✅ 逐表零差异 —— 「本库未动」这句话有证据支撑')
  process.exit(0)
}
console.log(`  🔴 ${diffs.length} 张表有差异,**不许写「未动」**:`)
for (const d of diffs) console.log(`     ${d.表}  ${d.开批} → ${d.现在}(${d.差 >= 0 ? '+' : ''}${d.差})`)
process.exit(1)
