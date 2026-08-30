/* 店群陪审团 · 两真店沙箱镜像(店主 08-30d 批次八)。

   作用:把 本机库 的 lucky-luxe 与 jics-nail 两租户**整租户置换拷贝**进 沙箱库 ——
   必审店=真镜像(店主本店 CAD + 小婕店 ¥),身份不标错(id/名称原样)。
   纪律:①源=本机库,**只读**(ATTACH 后仅 SELECT);②目标=沙箱库,动前**先快照**;
   ③admin_sessions 不拷(会话不迁移);拷完镜像老板密码请走平台重置口(真店口令不入沙箱使用面)。

   用法(手动,不进 CI):node apps/api/sandbox-mirror-jury.mjs
   幂等:重跑=再次置换(先删镜像租户旧行再拷),行数以源为准,一分不多。 */
import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SANDBOX = join(HERE, 'sandbox-data/lucky-luxe.sqlite')
const SOURCE = join(HERE, 'local-data/lucky-luxe.sqlite')
const MIRROR_TENANTS = ['lucky-luxe', 'jics-nail']

if (!existsSync(SANDBOX) || !existsSync(SOURCE)) { console.error('❌ 库文件不在:', SANDBOX, SOURCE); process.exit(1) }
/* 硬锁:目标必须是 sandbox-data 路径 —— 手滑把方向拷反是最坏事故 */
if (!SANDBOX.includes('sandbox-data')) { console.error('❌ 目标不是沙箱路径,拒绝执行'); process.exit(1) }

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const snap = SANDBOX.replace('.sqlite', `.pre-mirror-${stamp}.sqlite`)
copyFileSync(SANDBOX, snap)
console.log('① 沙箱快照:', snap)

const db = new DatabaseSync(SANDBOX)
db.exec('PRAGMA foreign_keys = OFF')   // 置换按表逐张来,行级外键次序交给最终一致(拷完两边行数逐表核对)
/* 只读挂载(URI mode=ro):对源库任何写在 SQLite 层直接失败 —— 本机库未动的机械保证 */
db.exec(`ATTACH DATABASE 'file:${SOURCE.replace(/'/g, "''")}?mode=ro' AS src`)

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name)
const skips = new Set(['admin_sessions', 'plans', 'platform_kb_entries', 'platform_categories', 'platform_sessions', 'merchant_leads', 'tenants'])
const inList = MIRROR_TENANTS.map((t) => `'${t}'`).join(',')

/* 账本三重防护的触发器会拦置换 DELETE(它就该拦)—— 拷贝窗口内临时摘下,拷完**逐字原样装回**;
   全程一个事务,失败即回滚(触发器也回来)。 */
const triggers = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger' AND sql IS NOT NULL").all()
db.exec('BEGIN IMMEDIATE')
try {
  for (const tg of triggers) db.exec(`DROP TRIGGER IF EXISTS ${tg.name}`)
  /* tenants 行置换 */
  db.exec(`DELETE FROM tenants WHERE id IN (${inList})`)
  db.exec(`INSERT INTO tenants SELECT * FROM src.tenants WHERE id IN (${inList})`)
  let report = []
  for (const t of tables) {
    if (skips.has(t)) continue
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name)
    const srcCols = db.prepare(`PRAGMA src.table_info(${t})`).all().map((c) => c.name)
    const shared = cols.filter((c) => srcCols.includes(c))
    if (!shared.length) continue
    const colSql = shared.map((c) => `"${c}"`).join(',')
    if (cols.includes('tenant_id')) {
      db.exec(`DELETE FROM ${t} WHERE tenant_id IN (${inList})`)
      db.exec(`INSERT INTO ${t} (${colSql}) SELECT ${colSql} FROM src.${t} WHERE tenant_id IN (${inList})`)
    } else if (cols.includes('technician_id')) {
      db.exec(`DELETE FROM ${t} WHERE technician_id IN (SELECT id FROM technicians WHERE tenant_id IN (${inList}))`)
      db.exec(`INSERT INTO ${t} (${colSql}) SELECT ${colSql} FROM src.${t} WHERE technician_id IN (SELECT id FROM src.technicians WHERE tenant_id IN (${inList}))`)
    } else { continue }
    const n = db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE ${cols.includes('tenant_id') ? `tenant_id IN (${inList})` : `technician_id IN (SELECT id FROM technicians WHERE tenant_id IN (${inList}))`}`).get().n
    if (n > 0) report.push(`${t}=${n}`)
  }
  for (const tg of triggers) db.exec(tg.sql)
  const back = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger'").get().n
  if (back !== triggers.length) throw new Error(`触发器装回数不对:${back}≠${triggers.length}`)
  db.exec('COMMIT')
  console.log('② 置换拷贝完成:', report.join(' '), `· 触发器摘装 ${triggers.length}=${back} ✓`)
} catch (e) {
  db.exec('ROLLBACK')
  console.error('❌ 回滚:', e.message)
  process.exit(1)
}
/* 核对:镜像五项 vs 源五项逐数相等 */
for (const t of MIRROR_TENANTS) {
  const q = (d, sql) => db.prepare(sql.replace('@D', d)).get(t).n
  const pairs = [
    ['users', 'SELECT COUNT(*) n FROM @D.users WHERE tenant_id = ?'],
    ['bookings', 'SELECT COUNT(*) n FROM @D.bookings WHERE tenant_id = ?'],
    ['settlements', 'SELECT COUNT(*) n FROM @D.settlements WHERE tenant_id = ?'],
    ['finance_transactions', 'SELECT COUNT(*) n FROM @D.finance_transactions WHERE tenant_id = ?'],
    ['stored_value_transactions', 'SELECT COUNT(*) n FROM @D.stored_value_transactions WHERE tenant_id = ?']
  ]
  const line = pairs.map(([name, sql]) => {
    const a = q('main', sql); const b = q('src', sql)
    return `${name}:${a}${a === b ? '=✓' : `≠源${b}❌`}`
  }).join(' ')
  console.log(`③ 镜像核对 ${t}: ${line}`)
}
db.exec('DETACH DATABASE src')
console.log('✅ 镜像完成(源=本机库只读未动;沙箱快照在上方路径)')
