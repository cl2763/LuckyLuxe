/* 真库测试租户清理(店主 2026-08-24 裁 C)。

   🔴 默认**只预演不删**。真删必须显式加 --execute。

   守四条(店主原话):
   ① 先完整备份真库,备份路径写进回报;
   ② 真店黑名单**写进脚本**,命中即抛错(与 seed 脚本同款护栏);
   ③ 幂等 + 可回滚:整包一个事务,重跑一分不动;
   ④ 执行后给对账证据:保留店的收入总额与行数 改前=改后,对不上直接 ROLLBACK。

   用法:
     node tools/clean-test-tenants.mjs                 # 预演(只读,给清单与行数)
     node tools/clean-test-tenants.mjs --execute       # 真删(自动先备份)
     node tools/clean-test-tenants.mjs --db <路径>     # 指定库(默认本机真库)
*/
import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

const argv = process.argv.slice(2)
const EXECUTE = argv.includes('--execute')
const DB_PATH = (() => { const i = argv.indexOf('--db'); return i >= 0 ? argv[i + 1] : 'apps/api/local-data/lucky-luxe.sqlite' })()

/* 🔴 护栏一:真店黑名单。命中即抛错,不是"跳过" ——
   跳过会让人以为清干净了;抛错才逼人看一眼为什么会碰到真店。 */
const PROTECTED = new Set([
  'lucky-luxe',        // 店主本店
  'jics-nail',         // 小婕的店
  'demo-ai',           // 演示样板(带 AI)
  'demo-basic',        // 演示样板(基础)
  'hoptest-demo2'      // 五跳演示店:人工建的,店主裁定保留(不与自动化残留同批)
])

/* 护栏二:只删**套件建店前缀**命中的租户。前缀来自 test-*.mjs 里的 newShop() 命名。
   不在这张表里的一律不动(宁可少删,不许误删)。 */
const SUITE_PREFIX = {
  nsas: 'test-noshow-aftersales', dbl: 'test-double-sheet', p2dc: 'test-daily-close',
  p2sc: 'test-schedule-v2', p2sal: 'test-salary-v2', p2ft: 'test-finance-trend',
  p12: 'test-pricing-model', p25: 'test-membership-config', r3s: 'test-settle-stress',
  p0hy: 'test-tenant-hygiene', p2fl: 'test-finance-lock', r2s: 'test-settle-stress(压测)',
  'tenant': 'test-tenant-isolation(tenant-iso-b)',
  authx: 'test-auth-surface', diag: '诊断脚本'
}

const db = new DatabaseSync(DB_PATH)
const money = (c) => `¥${(c / 100).toFixed(2)}`

// —— 认租户:先拿全库租户,再按前缀判定
const allTenants = new Set()
for (const t of db.prepare('SELECT DISTINCT tenant_id FROM bookings').all()) allTenants.add(t.tenant_id)
for (const t of db.prepare('SELECT DISTINCT tenant_id FROM users').all()) allTenants.add(t.tenant_id)
for (const t of db.prepare('SELECT DISTINCT tenant_id FROM finance_transactions').all()) allTenants.add(t.tenant_id)
for (const t of db.prepare('SELECT id AS tenant_id FROM tenants').all()) allTenants.add(t.tenant_id)

const targets = [...allTenants].filter((tid) => {
  if (PROTECTED.has(tid)) return false
  return Boolean(SUITE_PREFIX[String(tid).split('-')[0]])
}).sort()

// 护栏一实锤:目标集合里出现任何一个受保护租户 = 立刻抛错
for (const tid of targets) {
  if (PROTECTED.has(tid)) throw new Error(`🔴 清理目标里出现受保护租户:${tid} —— 脚本拒绝执行`)
}

// —— 对账基线:保留店的收入与行数(删完必须一模一样)
const keepStats = () => [...PROTECTED].map((tid) => ({
  tenant_id: tid,
  income: db.prepare("SELECT COALESCE(SUM(amount_cents),0) n FROM finance_transactions WHERE tenant_id = ? AND type = 'income'").get(tid).n,
  fin_rows: db.prepare('SELECT COUNT(*) n FROM finance_transactions WHERE tenant_id = ?').get(tid).n,
  bookings: db.prepare('SELECT COUNT(*) n FROM bookings WHERE tenant_id = ?').get(tid).n,
  users: db.prepare('SELECT COUNT(*) n FROM users WHERE tenant_id = ?').get(tid).n,
  settlements: db.prepare('SELECT COUNT(*) n FROM settlements WHERE tenant_id = ?').get(tid).n
}))
const before = keepStats()

// —— 逐表点行数(70 张带 tenant_id 的表 + 4 张按外键关联的表)
const tenantTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map((r) => r.name)
  .filter((t) => db.prepare(`PRAGMA table_info(${t})`).all().some((c) => c.name === 'tenant_id'))

const placeholders = targets.map(() => '?').join(',')
const plan = []
let total = 0
for (const t of tenantTables) {
  const n = targets.length ? db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE tenant_id IN (${placeholders})`).get(...targets).n : 0
  if (n) { plan.push([t, n]); total += n }
}
// 关联表(没有 tenant_id,靠外键跟着走)
const orphanCounts = {
  admin_sessions: targets.length ? db.prepare(`SELECT COUNT(*) n FROM admin_sessions WHERE account_id IN (SELECT id FROM admin_accounts WHERE tenant_id IN (${placeholders}))`).get(...targets).n : 0,
  technician_services: targets.length ? db.prepare(`SELECT COUNT(*) n FROM technician_services WHERE technician_id IN (SELECT id FROM technicians WHERE tenant_id IN (${placeholders}))`).get(...targets).n : 0,
  schedule_change_requests: targets.length ? db.prepare(`SELECT COUNT(*) n FROM schedule_change_requests WHERE technician_id IN (SELECT id FROM technicians WHERE tenant_id IN (${placeholders}))`).get(...targets).n : 0,
  tenants: targets.length ? db.prepare(`SELECT COUNT(*) n FROM tenants WHERE id IN (${placeholders})`).get(...targets).n : 0
}
for (const [t, n] of Object.entries(orphanCounts)) if (n) { plan.push([`${t}(按外键)`, n]); total += n }

console.log(`库:${DB_PATH}`)
console.log(`模式:${EXECUTE ? '🔴 真删' : '预演(只读,不写库)'}`)
console.log(`受保护租户(一行不动):${[...PROTECTED].join(' / ')}`)
console.log(`清理目标:${targets.length} 个租户`)
console.log(targets.join(', ') || '(无)')
console.log('')
console.log('| 表 | 待删行数 |'); console.log('|---|---:|')
for (const [t, n] of plan) console.log(`| ${t} | ${n} |`)
console.log(`| **合计** | **${total}** |`)
console.log('')
console.log('保留店基线:')
for (const s of before) console.log(`  ${s.tenant_id.padEnd(16)} 收入 ${money(s.income).padStart(14)} | 账本 ${s.fin_rows} 行 | 单 ${s.bookings} | 顾客 ${s.users} | 结算单 ${s.settlements}`)

if (!EXECUTE) {
  console.log('\n预演结束,一行没动。真删:node tools/clean-test-tenants.mjs --execute')
  db.close()
  process.exit(0)
}

// —— ① 先备份(真删前置,不备份不执行)
const backupDir = join(dirname(DB_PATH), 'backups')
mkdirSync(backupDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const backupPath = join(backupDir, `lucky-luxe-${stamp}-清理测试租户前.sqlite`)
if (existsSync(backupPath)) throw new Error(`备份文件已存在,换个时间戳再来:${backupPath}`)
copyFileSync(DB_PATH, backupPath)
console.log(`\n① 已备份:${backupPath}`)

// —— ③ 整包一个事务:任何一步不对就 ROLLBACK
db.exec('BEGIN IMMEDIATE')
try {
  if (targets.length) {
    db.prepare(`DELETE FROM admin_sessions WHERE account_id IN (SELECT id FROM admin_accounts WHERE tenant_id IN (${placeholders}))`).run(...targets)
    db.prepare(`DELETE FROM technician_services WHERE technician_id IN (SELECT id FROM technicians WHERE tenant_id IN (${placeholders}))`).run(...targets)
    db.prepare(`DELETE FROM schedule_change_requests WHERE technician_id IN (SELECT id FROM technicians WHERE tenant_id IN (${placeholders}))`).run(...targets)
    for (const t of tenantTables) db.prepare(`DELETE FROM ${t} WHERE tenant_id IN (${placeholders})`).run(...targets)
    db.prepare(`DELETE FROM tenants WHERE id IN (${placeholders})`).run(...targets)
  }
  // —— ④ 对账:保留店一分一行都不许变,对不上直接回滚
  const after = keepStats()
  const diffs = []
  for (const b of before) {
    const a = after.find((x) => x.tenant_id === b.tenant_id)
    for (const k of ['income', 'fin_rows', 'bookings', 'users', 'settlements']) {
      if (a[k] !== b[k]) diffs.push(`${b.tenant_id}.${k}: ${b[k]} → ${a[k]}`)
    }
  }
  if (diffs.length) throw new Error(`🔴 保留店数字变了,已回滚:${diffs.join(' | ')}`)
  db.exec('COMMIT')
  console.log('③ 已提交(整包一个事务)')
  console.log('④ 对账:保留店收入/行数 改前=改后,零差异')
  for (const s of after) console.log(`  ${s.tenant_id.padEnd(16)} 收入 ${money(s.income).padStart(14)} | 账本 ${s.fin_rows} 行 | 单 ${s.bookings} | 顾客 ${s.users} | 结算单 ${s.settlements}`)
  console.log(`\n回滚办法:停服务 → cp "${backupPath}" "${DB_PATH}"`)
} catch (error) {
  db.exec('ROLLBACK')
  console.error('已回滚,库未改动:', error.message)
  process.exitCode = 1
}
db.close()
