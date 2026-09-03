#!/usr/bin/env node
/* D130 存量修复:`user_identities` 归属错标(店主 04a §二 第 3 条,2026-09-03)

   ══ 修什么 ══
   身份行的 `tenant_id` 与它主人的 `users.tenant_id` 不一致 ——
   病根是启动回填四条 INSERT 不带 tenant_id,列定义又带 `DEFAULT 'lucky-luxe'`(D126/D128 同族)。
   代码那一半已在本批修掉(`apps/api/user-identity.mjs`);这个脚本处理**存量**。

   ══ 两种处置(店主定的)══
   · 目标租户下**没有**同 (provider, provider_user_id) → 改标(UPDATE tenant_id = 主人的);
   · 目标租户下**已有**正确行 → 删错标行(身份表不是账本,允许删;删前后各报数)。

   ══ 安全姿态 ══
   无默认目标库(requireTarget)· 默认只演练 · `--apply` 才写 · 先备份 · 一个事务 ·
   前后逐表打数 · 收尾两把尺(零错标 + 唯一键无重复)· 幂等(零条就退)。 */

import { DatabaseSync } from 'node:sqlite'
import { copyFileSync } from 'node:fs'
import { requireTarget } from './db-target.mjs'
import { scanIdentityMismatch, planIdentityRepair, repairIdentityTenant, identityRulers } from '../apps/api/user-identity.mjs'

const DB_PATH = requireTarget({
  envName: 'IDENTITY_DB_PATH',
  value: process.env.IDENTITY_DB_PATH,
  hint: '(库文件**绝对路径**。沙箱 apps/api/sandbox-data/… / 本机库 apps/api/local-data/… —— 端口会骗人,路径不会)',
})
const APPLY = process.argv.includes('--apply')

const db = new DatabaseSync(DB_PATH)
const cnt = (sql) => db.prepare(sql).get().n

console.log('\n════ D130 · user_identities 归属错标修复 ════')
console.log(`  目标库(绝对路径):${DB_PATH}`)
console.log(`  模式:${APPLY ? '🔴 --apply(**会写库**)' : '演练 dry-run(默认;不写一个字)'}`)

const total = cnt('SELECT COUNT(*) AS n FROM user_identities')
const people = cnt('SELECT COUNT(DISTINCT user_id) AS n FROM user_identities')
const rows = scanIdentityMismatch(db)
console.log(`\n  user_identities 总 ${total} 行 / ${people} 人 · 错标 ${rows.length} 行`)

const dist = new Map()
for (const r of rows) {
  const k = `${r.wrong_tenant}|${r.owner_tenant}|${r.provider}`
  dist.set(k, (dist.get(k) || 0) + 1)
}
for (const [k, n] of [...dist.entries()].sort()) console.log(`    ${k}  ${n} 行`)
/* 预计与真跑走**同一个排程出口**(planIdentityRepair)—— 两处各算一遍必然对不上 */
const plan = planIdentityRepair(db, rows)
const willDelete = plan.filter((p) => p.动作 === 'delete').length
const willUpdate = plan.length - willDelete
console.log(`\n  处置预计:改标 ${willUpdate} 行 · 删错标行 ${willDelete} 行(目标租户下已有正确行)`)

const before = identityRulers(db)
console.log(`  修前尺:错标 ${before.mismatch} · (tenant,provider,provider_user_id) 重复 ${before.dup}`)

if (!APPLY) {
  console.log('\n  演练结束 —— **一个字没写**。要真跑:加 --apply(会先备份)')
  db.close()
  process.exit(0)
}
if (!rows.length) {
  console.log('\n  ✅ 零条 —— 幂等重跑就是这个结果(库一分不动)')
  db.close()
  process.exit(before.mismatch === 0 && before.dup === 0 ? 0 : 1)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = `${DB_PATH}.pre-d130-${stamp}`
copyFileSync(DB_PATH, backup)
console.log(`\n  备份已出:${backup}`)
console.log(`  修前行数:user_identities=${total} · users=${cnt('SELECT COUNT(*) AS n FROM users')}`)

let res
db.exec('BEGIN IMMEDIATE')
try {
  res = repairIdentityTenant(db, rows)
  db.exec('COMMIT')
} catch (error) {
  try { db.exec('ROLLBACK') } catch { /* 已不在事务里 */ }
  console.error(`\n  ❌ 修复失败,已回滚。备份仍在:${backup}\n     ${error.message}`)
  db.close()
  process.exit(1)
}

const totalAfter = cnt('SELECT COUNT(*) AS n FROM user_identities')
const after = identityRulers(db)
console.log(`  实际:改标 ${res.updated} 行 · 删 ${res.deleted} 行`)
console.log(`  修后行数:user_identities=${totalAfter}(${totalAfter - total >= 0 ? '+' : ''}${totalAfter - total})`
  + ` · users=${cnt('SELECT COUNT(*) AS n FROM users')}`)
console.log(`  修后尺:错标 ${after.mismatch}(必须 0) · 唯一键重复 ${after.dup}(必须 0)`)
const ok = after.mismatch === 0 && after.dup === 0 && res.updated === willUpdate && res.deleted === willDelete
  && totalAfter === total - willDelete
console.log(`\n  形状:${ok ? '✔ 改标/删除数与预计一致,行数只少了被删的那些,两把尺都 0' : '🔴 不对 —— 请拿备份回滚'}`)
db.close()
process.exit(ok ? 0 : 1)
