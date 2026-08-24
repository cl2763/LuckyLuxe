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
/* 直接跑才执行主流程;被 import 时只导出纯函数(护栏② 的会红测试要 import 它们)。 */
const RUN_DIRECT = String(process.argv[1] || '').endsWith('clean-test-tenants.mjs')

/* 🔴 护栏一:真店黑名单。命中即抛错,不是"跳过" ——
   跳过会让人以为清干净了;抛错才逼人看一眼为什么会碰到真店。 */
const PROTECTED = new Set([
  'lucky-luxe',        // 店主本店
  'jics-nail',         // 小婕的店
  'demo-ai',           // 演示样板(带 AI)
  'demo-basic',        // 演示样板(基础)
  'hoptest-demo2'      // 五跳演示店:人工建的,店主裁定保留(不与自动化残留同批)
])

/* 🔴 护栏二(D72 改判据,店主 08-24 裁):目标**按数据选,不按名字选** ——
   `tenants.kind = 'test'`。前缀表(SUITE_PREFIX)整张退役:
   靠名字立的法,就是 80 个空壳能在真库里攒起来的原因。
   新建的测试租户在建店那一刻就落了 kind='test'(见 local-server 建店路由),不再需要人来认。 */
export function pickTargets(db) {
  return db.prepare("SELECT id FROM tenants WHERE kind = 'test' ORDER BY id").all().map((r) => r.id)
}

/* 🔴 护栏一(D72 改成活的):店主机核指出原来那句「命中即抛错」是**装饰性断言** ——
   targets 早就把 PROTECTED 过滤掉了,那句永远不可能触发。
   现在改成对**真正要传进 DELETE 的那个参数数组**做断言,并且有一条会红的测试
   (故意塞一个受保护 id 进去,断言这里抛错)。 */
export function assertNoProtected(ids) {
  const hit = (ids || []).filter((id) => PROTECTED.has(id))
  if (hit.length) throw new Error(`🔴 DELETE 参数里出现受保护租户:${hit.join(', ')} —— 脚本拒绝执行`)
  return ids
}

export const PROTECTED_IDS = PROTECTED

if (RUN_DIRECT) {
  const db = new DatabaseSync(DB_PATH)
  const money = (c) => `¥${(c / 100).toFixed(2)}`

  // —— 认租户:先拿全库租户,再按前缀判定
  /* 归属自证:tenants 表里每一行都必须有归属(real/demo/test),没有归属的行说明
     建店路径没落 kind —— 那是 D72 的漏,当场报出来,不许闷头往下删。 */
  const unclassified = db.prepare("SELECT id FROM tenants WHERE kind NOT IN ('real','demo','test') OR kind IS NULL").all()

  const targets = assertNoProtected(pickTargets(db))   // 选目标(按 kind)→ 立刻对真参数断言

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
  console.log(`租户归属:real ${db.prepare("SELECT COUNT(*) n FROM tenants WHERE kind='real'").get().n} / demo ${db.prepare("SELECT COUNT(*) n FROM tenants WHERE kind='demo'").get().n} / test ${db.prepare("SELECT COUNT(*) n FROM tenants WHERE kind='test'").get().n} / 无归属 ${unclassified.length}`)
  console.log(`清理目标:${targets.length} 个租户(判据:kind='test')`)
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

  /* 小件①(店主 08-24 提):**先看有没有目标,再备份** —— 0 目标照样拷 11MB 是白花力气。 */
  if (!targets.length) {
    console.log('\n没有 kind=\'test\' 的租户,无事可做(没有备份,没有事务)。')
    db.close()
    process.exit(0)
  }

  // —— ① 备份(真删前置,不备份不执行)
  const backupDir = join(dirname(DB_PATH), 'backups')
  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  /* 小件②:同一秒重跑会撞文件名。原来直接 throw = 裸栈退出,看着像脚本坏了。
     现在给人话 + 自动加序号,退不了就明确告诉你怎么办。 */
  let backupPath = join(backupDir, `lucky-luxe-${stamp}-清理测试租户前.sqlite`)
  for (let n = 2; existsSync(backupPath) && n <= 20; n += 1) {
    backupPath = join(backupDir, `lucky-luxe-${stamp}-${n}-清理测试租户前.sqlite`)
  }
  if (existsSync(backupPath)) {
    console.error(`\n备份文件名连撞 20 次(同一秒跑了太多遍):${backupPath}\n等一秒再来,或先清理 ${backupDir} 里的同秒备份。`)
    db.close()
    process.exit(1)
  }
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
}
