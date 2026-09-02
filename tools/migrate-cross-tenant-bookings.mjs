#!/usr/bin/env node
/* 跨租户单「拆档迁移」(D127 收尾,店主 03w §一 裁 / 03x §一.2 定做法,2026-09-03)

   ══ 处置的是什么 ══
   `bookings.tenant_id ≠ users.tenant_id` 的单 —— 单在 A 店、顾客档案在 B 店。
   生产上现有 **1 条**:小婕店那唯一一张预约,顾客被 `users.tenant_id DEFAULT 'lucky-luxe'`
   吞进了旗舰店。

   ══ 为什么不删 ══
   店主 03w 原话:**「这不是脏数据,是被吞的人。删掉是把受害者当垃圾清。」**
   正确处置是**拆档**:在单所属的那家店里给这位顾客建一份档案,把单指过去。

   ══ 拆档怎么拆(店主定的口径)══
   · **复制身份字段**(姓名 / 电话 / 邮箱 / openid)——人还是同一个人;
   · **不复制别店的余额、会员、次卡、消费记录** —— 那些是「他在 A 店的资产」,
     跨店复用正是 D127 串味的根子(每店一份档案是本系统的既定口径);
   · 已经在目标店有档案的(按 openid / 手机 / 邮箱找得到),**直接指过去,不新建**。

   ══ 安全姿态(与写库自报律、造景律同一套)══
   1. **无默认目标库** —— 不显式给就拒绝跑(`requireTarget`);
   2. **默认只演练**(dry-run),要写必须显式 `--apply`;
   3. `--apply` 前**先备份**,路径打印出来;
   4. **幂等**:跑完再跑一次,报 0 条、库一分不动;
   5. **逐表打数**:前后各打一次,差值必须等于「新建档案数」,别的表零变化;
   6. 全程**一个事务**(动的是顾客归属,属于「多步写」)。 */

import { DatabaseSync } from 'node:sqlite'
import { copyFileSync } from 'node:fs'
import { requireTarget } from './db-target.mjs'

const DB_PATH = requireTarget({
  envName: 'MIGRATE_DB_PATH',
  value: process.env.MIGRATE_DB_PATH,
  hint: '(库文件**绝对路径**。沙箱 apps/api/sandbox-data/… / 本机库 apps/api/local-data/… —— 端口会骗人,路径不会)',
})
const APPLY = process.argv.includes('--apply')

const db = new DatabaseSync(DB_PATH)
const one = (sql, ...a) => db.prepare(sql).get(...a)
const all = (sql, ...a) => db.prepare(sql).all(...a)
const COUNTED = ['bookings', 'users', 'settlements', 'stored_value_transactions', 'finance_transactions']
const snapshot = () => Object.fromEntries(COUNTED.map((t) => {
  try { return [t, one(`SELECT COUNT(*) AS n FROM "${t}"`).n] } catch { return [t, null] }
}))

console.log('\n════ 跨租户单拆档迁移 ════')
console.log(`  目标库(绝对路径):${DB_PATH}`)
console.log(`  模式:${APPLY ? '🔴 --apply(**会写库**)' : '演练 dry-run(默认;不写一个字)'}`)

const rows = all(`SELECT b.id AS bid, b.tenant_id AS bt, b.user_id AS uid, u.tenant_id AS ut,
  u.display_name AS name, u.phone AS phone, u.email AS email, u.wechat_open_id AS openid
  FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.tenant_id <> u.tenant_id`)

console.log(`\n  待处置:${rows.length} 条`)
if (!rows.length) {
  console.log('  ✅ 零条 —— 幂等重跑就是这个结果(库一分不动)')
  db.close()
  process.exit(0)
}

/* 逐条先算出「要指到哪个档案」:找得到就复用,找不到才新建 */
const plan = rows.map((r) => {
  const found = (r.openid ? one('SELECT id FROM users WHERE wechat_open_id = ? AND tenant_id = ?', r.openid, r.bt) : null)
    || (r.phone ? one('SELECT id FROM users WHERE phone = ? AND tenant_id = ?', r.phone, r.bt) : null)
    || (r.email ? one('SELECT id FROM users WHERE email = ? AND tenant_id = ?', r.email, r.bt) : null)
  return { ...r, 目标档案: found ? found.id : null, 动作: found ? '指到已有档案' : '在本店新建档案' }
})
for (const p of plan) {
  console.log(`    单 ${p.bid.slice(0, 24)} | 单属 ${p.bt} / 人属 ${p.ut} | ${p.动作}`
    + (p.目标档案 ? ` → ${p.目标档案.slice(0, 20)}` : ''))
}
const willCreate = plan.filter((p) => !p.目标档案).length
console.log(`\n  预计新建档案 ${willCreate} 份 · 复用已有 ${plan.length - willCreate} 份`)

if (!APPLY) {
  console.log('\n  演练结束 —— **一个字没写**。要真跑:加 --apply(会先备份)')
  db.close()
  process.exit(0)
}

/* ── 真跑:先备份 → 打数 → 一个事务里做完 → 再打数 ── */
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = `${DB_PATH}.pre-crosstenant-${stamp}`
copyFileSync(DB_PATH, backup)
console.log(`\n  备份已出:${backup}`)

const before = snapshot()
console.log(`  迁移前:${JSON.stringify(before)}`)

db.exec('BEGIN IMMEDIATE')
try {
  for (const p of plan) {
    let target = p.目标档案
    if (!target) {
      target = `user_mig_${Math.random().toString(36).slice(2, 10)}`
      /* 只复制身份字段;余额/会员/次卡/消费一概不带 —— 那是他在别店的资产 */
      db.prepare(`INSERT INTO users (id, display_name, phone, email, wechat_open_id, tenant_id)
        VALUES (?, ?, ?, ?, ?, ?)`).run(target, p.name || '顾客', p.phone || null, p.email || null, p.openid || null, p.bt)
    }
    db.prepare('UPDATE bookings SET user_id = ? WHERE id = ?').run(target, p.bid)
  }
  db.exec('COMMIT')
} catch (error) {
  try { db.exec('ROLLBACK') } catch { /* 已不在事务里 */ }
  console.error(`\n  ❌ 迁移失败,已回滚(库回到迁移前)。备份仍在:${backup}`)
  console.error(`     ${error.message}`)
  db.close()
  process.exit(1)
}

const after = snapshot()
console.log(`  迁移后:${JSON.stringify(after)}`)
const diff = Object.fromEntries(COUNTED.map((t) => [t, (after[t] ?? 0) - (before[t] ?? 0)]))
console.log(`  差值:  ${JSON.stringify(diff)}`)

const left = one(`SELECT COUNT(*) AS n FROM bookings b JOIN users u ON u.id = b.user_id
  WHERE b.tenant_id <> u.tenant_id`).n
const okShape = diff.users === willCreate && diff.bookings === 0
  && diff.settlements === 0 && diff.stored_value_transactions === 0 && diff.finance_transactions === 0
console.log(`\n  回读:剩余跨租户单 ${left}(必须 0)`)
console.log(`  差值形状:${okShape ? '✔ 只多了 ' + willCreate + ' 份档案,别的表零变化' : '🔴 不对 —— 请拿备份回滚'}`)
db.close()
process.exit(left === 0 && okShape ? 0 : 1)
