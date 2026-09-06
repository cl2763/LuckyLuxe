/* 逐租户指纹 —— 证「既有行一行没动」,不是「行数没变」(店主 05o §一④「只许新增行、既有租户逐表零差异」)

   为什么不用 `db-snapshot.mjs` 顶:那把刀记的是**逐表 rows/cols/idx/trg/dflt**,
   它能证「表结构没动、总行数没变」,**证不了「既有那一行的内容没被 UPDATE 掉」** ——
   把一张单的金额从 198 改成 150,行数一分不动,快照全绿。
   《判据律》那句在这儿正好适用:**这条判据在缺陷存在时会不会照样绿?会,就是废判据。**

   所以这把刀按「内容」算:每张带 `tenant_id` 的表,**逐租户**把全部行按全列序拼成一串取 SHA-256;
   不带 `tenant_id` 的表整表算一份(记在 `__global__` 名下)。
   既有租户的指纹**必须逐表逐字节相同**;新店只许以「新增租户」的身份出现。

   用法:
     node tools/tenant-fingerprint.mjs <库文件绝对路径> <快照文件>            # 打指纹
     node tools/tenant-fingerprint.mjs <库文件绝对路径> --diff <快照文件>     # 对照(既有租户零差异,否则非零退出) */
import { DatabaseSync } from 'node:sqlite'
import { writeFileSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { requireTarget } from './db-target.mjs'

const dbPath = requireTarget({ envName: '第 1 个参数 <库文件绝对路径>', value: process.argv[2],
  hint: '(沙箱 apps/api/sandbox-data/… / 本机库 apps/api/local-data/…)' })
const args = process.argv.slice(3)
const diffAt = args.indexOf('--diff')
const snapFile = diffAt >= 0 ? args[diffAt + 1] : args[0]
if (!snapFile) { console.error('❌ 要写到哪个快照文件?第 2 个参数给路径。'); process.exit(2) }

const GLOBAL = '__global__'

function fingerprint(path) {
  const db = new DatabaseSync(path, { readOnly: true })
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name)
  const out = {}
  for (const t of tables) {
    const cols = db.prepare('SELECT name FROM pragma_table_info(?) ORDER BY cid').all(t).map((r) => r.name)
    if (!cols.length) continue
    const hasTenant = cols.includes('tenant_id')
    const order = cols.map((c) => `"${c}"`).join(', ')
    /* 全列取出、按全列排序 —— 不依赖表有没有 rowid,也不依赖插入顺序 */
    let rows = []
    try { rows = db.prepare(`SELECT ${order} FROM "${t}" ORDER BY ${order}`).all() } catch { continue }
    const buckets = new Map()
    for (const row of rows) {
      const key = hasTenant ? String(row.tenant_id ?? '(null)') : GLOBAL
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key).push(cols.map((c) => `${c}=${row[c] === null ? '\u0000' : String(row[c])}`).join('\u0001'))
    }
    for (const [key, lines] of buckets) {
      if (!out[key]) out[key] = {}
      /* 除了整桶指纹,再记**每一行的指纹**。为什么两样都要:
         整桶 sha 一变只说明「这张表变了」,分不出是**新增了一行**还是**改了既有的一行** ——
         而这两件事在《只许新增行》下一个合法、一个是事故。
         逐行指纹一比就分得开:**旧行消失 = 被改被删(红);只多出新行 = 新增(合法)**。
         还有一层非治不可的:`tenants` / `technician_services` 这类表**根本没有 tenant_id 列**,
         整桶记在 `__global__` 名下,新店自己的行会被算成「既有桶变了」——首跑就是这么误报的。 */
      out[key][t] = {
        rows: lines.length,
        sha: createHash('sha256').update(lines.join('\u0002')).digest('hex').slice(0, 16),
        lines: lines.map((l) => createHash('sha256').update(l).digest('hex').slice(0, 12))
      }
    }
  }
  db.close()
  return out
}

const now = fingerprint(dbPath)

if (diffAt < 0) {
  writeFileSync(snapFile, `${JSON.stringify({ dbPath, tenants: now }, null, 2)}\n`)
  const tenants = Object.keys(now).sort()
  console.log(`✓ 指纹已写 ${snapFile}`)
  console.log(`  库: ${dbPath}`)
  for (const t of tenants) {
    const tables = Object.keys(now[t])
    const rows = tables.reduce((a, k) => a + now[t][k].rows, 0)
    console.log(`  ${t.padEnd(16)} 表 ${String(tables.length).padStart(3)} · 行 ${String(rows).padStart(7)}`)
  }
  process.exit(0)
}

const before = JSON.parse(readFileSync(snapFile, 'utf8')).tenants
const beforeKeys = Object.keys(before)
const nowKeys = Object.keys(now)
const added = nowKeys.filter((k) => !beforeKeys.includes(k))
const removed = beforeKeys.filter((k) => !nowKeys.includes(k))
const changed = []      // 🔴 旧行不见了 = 被 UPDATE 或被 DELETE
const inserted = []     // ✅ 只是多出新行 = 合法新增
for (const key of beforeKeys) {
  if (!now[key]) continue
  const tables = new Set([...Object.keys(before[key]), ...Object.keys(now[key])])
  for (const t of tables) {
    const b = before[key][t]
    const a = now[key][t]
    if (!b || !a) { changed.push(`${key} · ${t} · ${b ? '整表消失' : '整表新增'}`); continue }
    if (b.sha === a.sha) continue
    if (!b.lines || !a.lines) { changed.push(`${key} · ${t} · 行 ${b.rows}→${a.rows}(旧快照没有逐行指纹,分不出新增还是改动)`); continue }
    /* 多重集差:同一行内容出现 N 次也算数,不能用 Set 顶 */
    const pool = new Map()
    for (const h of a.lines) pool.set(h, (pool.get(h) || 0) + 1)
    let gone = 0
    for (const h of b.lines) {
      const n = pool.get(h) || 0
      if (n > 0) pool.set(h, n - 1)
      else gone += 1
    }
    const add = [...pool.values()].reduce((x, y) => x + y, 0)
    if (gone) changed.push(`${key} · ${t} · **旧行消失 ${gone} 行**(行 ${b.rows}→${a.rows},其中新增 ${add})`)
    else if (add) inserted.push(`${key} · ${t} · 只新增 ${add} 行(${b.rows}→${a.rows})`)
  }
}

console.log(`\n════ 逐租户指纹对照 ════`)
console.log(`  库: ${dbPath}`)
console.log(`  新增租户: ${added.length ? added.join(', ') : '(无)'}`)
console.log(`  消失租户: ${removed.length ? removed.join(', ') : '(无)'}`)
if (added.length) {
  for (const key of added) {
    const tables = Object.keys(now[key])
    console.log(`    + ${key}: ${tables.length} 表 / ${tables.reduce((a, k) => a + now[key][k].rows, 0)} 行`)
    console.log(`      ${tables.map((t) => `${t}=${now[key][t].rows}`).join(' · ')}`)
  }
}
if (inserted.length) {
  console.log(`\n  ＋ 既有桶里**只新增、未改动** ${inserted.length} 处(没有 tenant_id 列的表,新店的行只能落这儿):`)
  for (const line of inserted) console.log(`    ${line}`)
}
if (changed.length) {
  console.log(`\n  🔴 既有行被改动/删除 ${changed.length} 处:`)
  for (const line of changed) console.log(`    ${line}`)
  process.exit(1)
}
if (removed.length) { console.log(`\n  🔴 有租户整个消失`); process.exit(1) }
console.log(`\n  ✅ 既有行一行没动(${beforeKeys.length} 个桶逐表逐行比过;只增不改)`)
