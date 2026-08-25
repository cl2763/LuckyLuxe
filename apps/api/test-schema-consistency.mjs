/* 结构一致性回归(2026-08-08 加固):
   防的是这一类雷 —— 列只写进 CREATE TABLE、没写 try/catch ALTER。
   全新库看着没问题,老库(含生产)根本没有那几列,等到真用上才 500。
   2026-08-08 签署快照四列就是这么漏的,差点让生产第一张单一签字就炸。

   做法:
   1. 起一个全新库(独立 DATA_DIR),把 schema 逐表逐列 dump 出来;
   2. 与仓库里的基线 schema-baseline.json 比;
   3. 基线里有、现在没有 → 直接红(表/列不该消失);
   4. 表是新增的 → 放行(CREATE TABLE IF NOT EXISTS 对老库照样建);
   5. **老表上多出来的列 → 必须能在 local-server.mjs 里找到对应的
      ALTER TABLE <表> ADD COLUMN <列>**,找不到就红,并直接告诉你补哪一句。

   改完结构、确认迁移写全了,用 `node test-schema-consistency.mjs --update`
   刷新基线(基线随代码一起提交,它就是「上一版结构」的存档)。 */
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const BASELINE = join(here, 'schema-baseline.json')
/* 🔴 08-25:扫描范围从「只看 local-server.mjs」改成「后端所有非测试模块」。
   公约②「边改边拆」之后,迁移语句会跟着领域搬进模块(D76 的 tenants.listed 就搬进了
   tenant-visibility.mjs)—— 判据的**范围**得跟着被测物走,否则搬一次家就假红一次,
   而假红最后总是被人改成放行。 */
const SOURCE = readdirSync(here)
  .filter((f) => f.endsWith('.mjs') && !f.startsWith('test-'))
  .map((f) => readFileSync(join(here, f), 'utf8'))
  .join('\n/* ——— 模块分隔 ——— */\n')
const UPDATE = process.argv.includes('--update')
const PORT = process.env.SCHEMA_TEST_PORT || '4177'

let checks = 0
function check(name, condition, detail = '') {
  checks += 1
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
  console.log(`ok ${checks} - ${name}`)
}

// 起一次全新库的实例,等它把 schema 建完就关掉
async function dumpFreshSchema() {
  const dir = mkdtempSync(join(tmpdir(), 'll-schema-'))
  const child = spawn(process.execPath, [join(here, 'local-server.mjs')], {
    env: { ...process.env, DATA_DIR: dir, PORT, ALLOW_DEMO_ADMIN_LOGIN: 'true' },
    stdio: 'ignore'
  })
  try {
    let ready = false
    for (let i = 0; i < 60; i += 1) {
      await new Promise((r) => setTimeout(r, 500))
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/health`)
        if (res.ok) { ready = true; break }
      } catch { /* 还没起来 */ }
    }
    if (!ready) throw new Error('全新库实例 30 秒内没起来')
    child.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 600))
    const db = new DatabaseSync(join(dir, 'lucky-luxe.sqlite'))
    const schema = {}
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    for (const t of tables) {
      schema[t.name] = db.prepare(`PRAGMA table_info(${t.name})`).all().map((c) => c.name).sort()
    }
    db.close()
    return schema
  } finally {
    try { child.kill('SIGKILL') } catch { /* 已退出 */ }
    rmSync(dir, { recursive: true, force: true })
  }
}

function hasAlterFor(table, column) {
  // 迁移语句写法不统一(有直接写死的,也有 for 循环拼模板串的),两种都认
  const direct = new RegExp(`ALTER\\s+TABLE\\s+${table}\\s+ADD\\s+COLUMN\\s+${column}\\b`, 'i')
  if (direct.test(SOURCE)) return true
  const templated = new RegExp(`ALTER\\s+TABLE\\s+${table}\\s+ADD\\s+COLUMN\\s+\\$\\{`, 'i')
  if (!templated.test(SOURCE)) return false
  // 模板式迁移:列名会出现在同文件的列清单数组里(如 'snapshot_url TEXT')
  return new RegExp(`['"\`]${column}\\s+[A-Za-z]`, 'i').test(SOURCE)
}

async function main() {
  const fresh = await dumpFreshSchema()
  check('全新库 schema 已 dump', Object.keys(fresh).length > 10, `${Object.keys(fresh).length} 张表`)

  if (UPDATE || !existsSync(BASELINE)) {
    writeFileSync(BASELINE, `${JSON.stringify(fresh, null, 2)}\n`, 'utf8')
    console.log(`\n基线已写入 ${BASELINE}(${Object.keys(fresh).length} 张表)。记得随代码一起提交。`)
    return
  }

  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
  const missingTables = Object.keys(baseline).filter((t) => !fresh[t])
  check('没有表消失', missingTables.length === 0, missingTables.join('、'))

  const droppedColumns = []
  const missingAlters = []
  const newTables = []
  const newColumns = []
  for (const table of Object.keys(fresh)) {
    if (!baseline[table]) { newTables.push(table); continue }
    for (const col of baseline[table]) {
      if (!fresh[table].includes(col)) droppedColumns.push(`${table}.${col}`)
    }
    for (const col of fresh[table]) {
      if (baseline[table].includes(col)) continue
      newColumns.push(`${table}.${col}`)
      if (!hasAlterFor(table, col)) missingAlters.push(`${table}.${col}`)
    }
  }
  check('没有列消失', droppedColumns.length === 0, droppedColumns.join('、'))
  check(
    '老表上新增的列都写了 try/catch ALTER 迁移',
    missingAlters.length === 0,
    missingAlters.length
      ? `${missingAlters.join('、')} —— 只写进 CREATE TABLE 的话老库(含生产)不会有这几列。` +
        `请补 try { db.exec('ALTER TABLE <表> ADD COLUMN <列> <类型>') } catch(e){ if(!/duplicate column/.test(e.message)) throw e }`
      : ''
  )
  if (newTables.length) console.log(`   (新增表 ${newTables.length} 张:${newTables.join('、')} —— CREATE TABLE IF NOT EXISTS 对老库照样建,放行)`)
  if (newColumns.length) console.log(`   (老表新增列 ${newColumns.length} 个,迁移已写全:${newColumns.join('、')})`)
  console.log('   基线更新方式:node test-schema-consistency.mjs --update')

  console.log(`\n结构一致性回归通过:${checks} 项断言全绿`)
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`)
  process.exit(1)
})
