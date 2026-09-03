#!/usr/bin/env node
/* 去掉 31 张表 `tenant_id` 的列默认值 —— **彩排 / 应急手跑** 的命令行外壳(店主 04f §一.2)

   核心在 `apps/api/tenant-default-drop.mjs`(唯一出口),开机迁移用的是同一个函数 ——
   两个调用方一份逻辑,不会各自漂。

   ══ 安全姿态(与写库自报律同一套)══
   无默认目标库(`requireTarget`)· 默认只演练 · `--apply` 才写 · 先备份 ·
   **逐表四栏前后对照(行 / 列 / 索引 / 触发器)** · 一个事务 · 幂等(没有 DEFAULT 就报 0 张)。
   `DROPDEF_FAIL_AT=<n>` **仅供造病验回滚**,正常跑不设。
   **生产随部署走开机迁移,不用手跑这个脚本。** */

import { DatabaseSync } from 'node:sqlite'
import { copyFileSync } from 'node:fs'
import { requireTarget } from './db-target.mjs'
import { tenantDefaultTargets, snapshot4, dropTenantDefaults } from '../apps/api/tenant-default-drop.mjs'

const DB_PATH = requireTarget({
  envName: 'DROPDEF_DB_PATH',
  value: process.env.DROPDEF_DB_PATH,
  hint: '(库文件**绝对路径**。沙箱 apps/api/sandbox-data/… / 本机库副本 —— 端口会骗人,路径不会)',
})
const APPLY = process.argv.includes('--apply')
const FAIL_AT = Number(process.env.DROPDEF_FAIL_AT || 0)

const db = new DatabaseSync(DB_PATH)
const list = tenantDefaultTargets(db)
console.log('\n════ 去掉 tenant_id 的列默认值 ════')
console.log(`  目标库(绝对路径):${DB_PATH}`)
console.log(`  模式:${APPLY ? '🔴 --apply(**会重建表**)' : '演练 dry-run(默认;不写一个字)'}`)
console.log(`\n  待处置:${list.length} 张表`)
if (list.length) console.log(`    ${list.map((r) => `${r.t}(${r.dv})`).join(' · ')}`)
if (!list.length) {
  console.log('  ✅ 零张 —— 幂等重跑就是这个结果(库一分不动)')
  db.close()
  process.exit(0)
}
if (FAIL_AT) console.log(`\n  ⚠️⚠️ DROPDEF_FAIL_AT=${FAIL_AT} —— **造病模式**:在第 ${FAIL_AT} 张表处故意抛错,验事务回滚。正常跑不设。`)
if (!APPLY) {
  console.log('\n  演练结束 —— **一个字没写**。要真跑:加 --apply(会先备份)')
  db.close()
  process.exit(0)
}

const names = list.map((r) => r.t)
const before = snapshot4(db, names)
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = `${DB_PATH}.pre-dropdefault-${stamp}`
copyFileSync(DB_PATH, backup)
console.log(`\n  备份已出:${backup}`)

let result = null
db.exec('PRAGMA foreign_keys=OFF')
db.exec('BEGIN IMMEDIATE')
try {
  result = dropTenantDefaults(db, { failAt: FAIL_AT })
  db.exec('COMMIT')
} catch (error) {
  try { db.exec('ROLLBACK') } catch { /* 已不在事务里 */ }
  db.exec('PRAGMA foreign_keys=ON')
  console.error(`\n  ❌ 失败,**已整批回滚**(库回到迁移前)。备份仍在:${backup}\n     ${error.message}`)
  const after0 = snapshot4(db, names)
  const moved = names.filter((t) => JSON.stringify(before[t]) !== JSON.stringify(after0[t]))
  console.error(`     回滚后四栏对照:${moved.length === 0 ? `✔ ${names.length} 张表行/列/索引/触发器全部与迁移前一致` : `🔴 有 ${moved.length} 张动了:${moved.join(' · ')}`}`)
  console.error(`     仍带 DEFAULT 的表:${tenantDefaultTargets(db).length}(回滚成功的话应当还是 ${list.length})`)
  db.close()
  process.exit(1)
}
db.exec('PRAGMA foreign_keys=ON')

const after = snapshot4(db, names)
const diffs = names.filter((t) => JSON.stringify(before[t]) !== JSON.stringify(after[t]))
console.log(`  全库触发器 ${result.triggers} 条:重建期间先摘下,做完原样装回(账本那 12 条也在内)`)
console.log('\n  逐表四栏对照(行 / 列 / 索引 / 触发器):')
if (!diffs.length) console.log(`    ✔ ${names.length} 张表四栏全部持平 —— 只有列定义变了,数据与结构一个没丢`)
else for (const t of diffs) console.log(`    🔴 ${t}  前 ${JSON.stringify(before[t])} → 后 ${JSON.stringify(after[t])}`)

const left = tenantDefaultTargets(db)
const trgTotal = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger'").get().n
console.log(`\n  仍带 DEFAULT 的表:${left.length}(必须 0)${left.length ? ' → ' + left.map((r) => r.t).join(' · ') : ''}`)
console.log(`  全库触发器总数:${trgTotal}`)
const ok = left.length === 0 && diffs.length === 0
console.log(`\n  形状:${ok ? '✔ 默认值全去掉,四栏零变化' : '🔴 不对 —— 请拿备份回滚'}`)
db.close()
process.exit(ok ? 0 : 1)
