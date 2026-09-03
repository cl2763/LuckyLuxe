#!/usr/bin/env node
/* 跨租户单「拆档迁移」(D127 收尾,店主 03w §一 裁 / 03x §一.2 定做法 / **04a §一② 大修**)

   ══ 处置的是什么 ══
   `bookings.tenant_id ≠ users.tenant_id` 的单 —— 单在 A 店、顾客档案在 B 店。
   生产上现有 **1 条**:小婕店那唯一一张预约,顾客被 `users.tenant_id DEFAULT 'lucky-luxe'`
   吞进了旗舰店。

   ══ 为什么不删 ══
   店主 03w 原话:**「这不是脏数据,是被吞的人。删掉是把受害者当垃圾清。」**
   正确处置是**拆档**:在单所属的那家店里给这位顾客建一份档案,把单指过去。

   ══ 🔴 04a 店主亲核咬出的大病:「只拆了一半」 ══
   上一版只改 `bookings.user_id`,而**16 张表带 `user_id`**,
   其中六张同时带 `booking_id` —— 它们是「**这一次到店**」的从属记录:
   结算单 / 定金收据 / 定金处置 / 服务小记 / 提醒任务 / 预约草稿。
   拆完以后这些行还指着旗舰店那份旧档案,**串味只是换了张桌子坐**;
   而尺子「剩余跨租户单」只量 `bookings`,所以它报 0。
   店主的话:**「你的『储值/结算 0』是行数没变,不是归属对了。」**

   现在的口径(表清单**由 schema 现取,不手写**):
   · **跟单走** = 同时带 `user_id` + `booking_id` 的表 → 在**同一个事务**里跟着单一起指到新档案;
   · **不动**   = 只带 `user_id` 的表(储值 / 次卡 / 积分 / 券 / 退款 / 留存定金)
                 —— 那是「他在 A 店的资产」,跨店复用正是 D127 串味的根子;**但要逐表打数报出来**;
   · `user_identities` 单列 —— 见 **D130**(它自己的 `tenant_id` 有 DEFAULT,另有一把刀与一份存量修复)。

   ══ 拆档怎么拆(店主定的口径)══
   · **复制身份字段**(姓名 / 电话 / 邮箱 / openid)——人还是同一个人;
   · **不复制别店的余额、会员、次卡、消费记录**(每店一份档案是本系统的既定口径);
   · 已经在目标店有档案的(按 openid / 手机 / 邮箱找得到),**直接指过去,不新建**。

   ══ 安全姿态(与写库自报律、造景律同一套)══
   1. **无默认目标库** —— 不显式给就拒绝跑(`requireTarget`);
   2. **默认只演练**(dry-run),要写必须显式 `--apply`;
   3. `--apply` 前**先备份**,路径打印出来;
   4. **幂等**:跑完再跑一次,报 0 条、库一分不动;
   5. **逐表打数**:16 张表前后各打一次;
   6. 全程**一个事务**(动的是顾客归属,属于「多步写」);
   7. 收尾**逐表验尺**:跟单表 + bookings 的 `x.tenant_id <> u.tenant_id` 逐个必须 0。 */

import { DatabaseSync } from 'node:sqlite'
import { copyFileSync } from 'node:fs'
import { requireTarget } from './db-target.mjs'

const DB_PATH = requireTarget({
  envName: 'MIGRATE_DB_PATH',
  value: process.env.MIGRATE_DB_PATH,
  hint: '(库文件**绝对路径**。沙箱 apps/api/sandbox-data/… / 本机库 apps/api/local-data/… —— 端口会骗人,路径不会)',
})
const APPLY = process.argv.includes('--apply')

/* ⚠️ **仅供造病验红**:把某张跟单表从「跟单走」清单里拿掉,用来证明收尾那把尺真的在看它。
   正常跑一律不设。设了就大声说出来,不许悄悄生效。 */
const SKIP_FOLLOW = (process.env.MIGRATE_SKIP_FOLLOW || '').split(',').map((x) => x.trim()).filter(Boolean)

const db = new DatabaseSync(DB_PATH)
const one = (sql, ...a) => db.prepare(sql).get(...a)
const all = (sql, ...a) => db.prepare(sql).all(...a)
const cnt = (sql, ...a) => one(sql, ...a).n

/* ── 表清单由 schema 现取:哪张表带 user_id、带不带 booking_id ── */
const colsOf = (t) => all(`SELECT name FROM pragma_table_info(?)`, t).map((r) => r.name)
const allTables = all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .map((r) => r.name)
const withUser = allTables.map((t) => ({ t, cols: colsOf(t) })).filter((x) => x.cols.includes('user_id'))
const FOLLOW_ALL = withUser.filter((x) => x.t !== 'bookings' && x.cols.includes('booking_id')).map((x) => x.t)
const FOLLOW = FOLLOW_ALL.filter((t) => !SKIP_FOLLOW.includes(t))
const ASSETS = withUser.filter((x) => x.t !== 'bookings' && x.t !== 'user_identities' && !x.cols.includes('booking_id'))
  .map((x) => x.t)
const HAS_TENANT = new Set(withUser.filter((x) => x.cols.includes('tenant_id')).map((x) => x.t))

console.log('\n════ 跨租户单拆档迁移 ════')
console.log(`  目标库(绝对路径):${DB_PATH}`)
console.log(`  模式:${APPLY ? '🔴 --apply(**会写库**)' : '演练 dry-run(默认;不写一个字)'}`)
console.log(`  带 user_id 的表(schema 现取):${withUser.length} 张`)
console.log(`    跟单走(带 booking_id,${FOLLOW_ALL.length} 张):${FOLLOW_ALL.join(' · ')}`)
console.log(`    资产不动(只带 user_id,${ASSETS.length} 张):${ASSETS.join(' · ')}`)
console.log('    user_identities:单列 —— 见 D130(它自己的 tenant_id 有 DEFAULT,另有刀与存量修复)')
if (SKIP_FOLLOW.length) {
  console.log(`\n  ⚠️⚠️ MIGRATE_SKIP_FOLLOW=${SKIP_FOLLOW.join(',')} —— **造病模式**:`
    + `这几张表被故意排除在「跟单走」之外,收尾那把尺应当红。正常跑不许设这个环境变量。`)
}

const rows = all(`SELECT b.id AS bid, b.tenant_id AS bt, b.user_id AS uid, u.tenant_id AS ut,
  u.display_name AS name, u.phone AS phone, u.email AS email, u.wechat_open_id AS openid
  FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.tenant_id <> u.tenant_id`)

/* ── 收尾那把尺:跟单表 + bookings 逐个 `x.tenant_id <> u.tenant_id` 必须 0 ── */
const rulerTables = ['bookings', ...FOLLOW_ALL].filter((t) => HAS_TENANT.has(t))
const ruler = () => rulerTables.map((t) => ({
  t, n: cnt(`SELECT COUNT(*) AS n FROM "${t}" x JOIN users u ON u.id = x.user_id WHERE x.tenant_id <> u.tenant_id`),
}))
const printRuler = (label) => {
  const r = ruler()
  const bad = r.filter((x) => x.n > 0)
  console.log(`\n  ${label}(bookings + 跟单表 ${rulerTables.length} 张,逐个必须 0):`)
  console.log(`    ${r.map((x) => `${x.t}=${x.n}`).join(' · ')}`)
  return bad
}

console.log(`\n  待处置:${rows.length} 条`)

/* 逐条先算出「要指到哪个档案」+ **逐表打挂载数**(店主 04a:演练输出要逐表报数字) */
const plan = rows.map((r) => {
  const found = (r.openid ? one('SELECT id FROM users WHERE wechat_open_id = ? AND tenant_id = ?', r.openid, r.bt) : null)
    || (r.phone ? one('SELECT id FROM users WHERE phone = ? AND tenant_id = ?', r.phone, r.bt) : null)
    || (r.email ? one('SELECT id FROM users WHERE email = ? AND tenant_id = ?', r.email, r.bt) : null)
  const follow = FOLLOW_ALL.map((t) => ({ t, n: cnt(`SELECT COUNT(*) AS n FROM "${t}" WHERE booking_id = ? AND user_id = ?`, r.bid, r.uid) }))
  const assets = ASSETS.map((t) => ({ t, n: cnt(`SELECT COUNT(*) AS n FROM "${t}" WHERE user_id = ?`, r.uid) }))
  const ident = cnt('SELECT COUNT(*) AS n FROM user_identities WHERE user_id = ?', r.uid)
  return { ...r, 目标档案: found ? found.id : null, 动作: found ? '指到已有档案' : '在本店新建档案', follow, assets, ident }
})
for (const p of plan) {
  console.log(`\n    单 ${p.bid.slice(0, 28)} | 单属 ${p.bt} / 人属 ${p.ut} | ${p.动作}`
    + (p.目标档案 ? ` → ${p.目标档案.slice(0, 22)}` : ''))
  console.log(`      跟单走(会一起指过去):${p.follow.map((x) => `${x.t}=${x.n}`).join(' · ') || '—'}`)
  console.log(`      资产不动(留在旧档案名下):${p.assets.map((x) => `${x.t}=${x.n}`).join(' · ') || '—'}`)
  console.log(`      user_identities=${p.ident}(D130 单独处置,本脚本不动)`)
}
const willCreate = plan.filter((p) => !p.目标档案).length
const willMove = plan.reduce((s, p) => s + p.follow.reduce((a, x) => a + x.n, 0), 0)
console.log(`\n  预计:新建档案 ${willCreate} 份 · 复用已有 ${plan.length - willCreate} 份 · 跟单行 ${willMove} 行一起指过去`)

/* ── 第二遍:**落单的跟单行**(04a 造病验红当场撞出来的一个洞;04b §一.2 把口径再收窄一档)──
   造病跑过一次(或旧版脚本跑过一次)之后,单已经指到新档案、跟单行还留在旧档案上。
   这时 `bookings` 那条尺是 0、待处置也是 0 —— **本脚本按单迁移,修不回来**。

   🔴 04b 店主咬出:上一版的口径「这一行自己串味 **且** 这张单的顾客在这一行的租户里」
   **不够窄** —— 我自己写的那个反例正好能穿过去:
   A 在小婕店的单上,朋友 B 的结算单一行,而 **B 的档案也被 DEFAULT 吞进了旗舰店**
   (这正是本脚本要处理的那一群人)→ 「这一行串味」成立、「单的顾客 A 在小婕店」也成立
   → **B 的结算单会被指给 A**。本机库现测 0 条不等于设计上不会有。

   收窄后的口径 = 上面两条 **再加一条:旧档案与新档案是同一个人**
   (`wechat_open_id` / `phone` / `email` 任一相等且非空)。
   新建路径本来就是把这三个字段复制过去的,所以**真正落单的行一定满足**;
   「带朋友」那种不满足 —— 它们**一行不动**,只打印,归入「⚠️ 要人看」。 */
const sameIdentity = (a, b) => ['wechat_open_id', 'phone', 'email']
  .some((k) => a[k] && b[k] && String(a[k]) === String(b[k]))
const orphanAll = () => FOLLOW_ALL.filter((t) => HAS_TENANT.has(t)).flatMap((t) => all(
  `SELECT ? AS t, x.rowid AS rid, x.user_id AS old_uid, b.user_id AS new_uid, x.tenant_id AS tt,
          u.wechat_open_id AS o_openid, u.phone AS o_phone, u.email AS o_email, u.display_name AS o_name,
          bu.wechat_open_id AS n_openid, bu.phone AS n_phone, bu.email AS n_email, bu.display_name AS n_name
     FROM "${t}" x JOIN users u ON u.id = x.user_id
     JOIN bookings b ON b.id = x.booking_id JOIN users bu ON bu.id = b.user_id
    WHERE x.tenant_id <> u.tenant_id AND bu.tenant_id = x.tenant_id`, t))
const orphanSplit = () => {
  const rows = orphanAll()
  const same = (r) => sameIdentity(
    { wechat_open_id: r.o_openid, phone: r.o_phone, email: r.o_email },
    { wechat_open_id: r.n_openid, phone: r.n_phone, email: r.n_email })
  return { fix: rows.filter(same), human: rows.filter((r) => !same(r)) }
}
const { fix: orphans, human: orphansHuman } = orphanSplit()
if (orphans.length) {
  console.log(`\n  🔧 落单的跟单行:${orphans.length} 行(单已经指到新档案、这些行还留在旧档案上;**同一个人**)`)
  for (const o of orphans) console.log(`      ${o.t} rowid=${o.rid} ${String(o.old_uid).slice(0, 18)} → ${String(o.new_uid).slice(0, 18)}(租户 ${o.tt})`)
}
if (orphansHuman.length) {
  console.log(`\n  ⚠️ **要人看,本脚本一行不动**:${orphansHuman.length} 行 —— `
    + `这一行自己串味、单的顾客也在这个租户里,**但旧档案与新档案不是同一个人**`)
  console.log('     (典型形状:带朋友来 —— 朋友自己的档案也被吞进了旗舰店。指过去就是把两个人合成一个人。)')
  for (const o of orphansHuman) {
    console.log(`      ${o.t} rowid=${o.rid} 旧档案「${o.o_name || '?'}」→ 单的顾客「${o.n_name || '?'}」`
      + ` | 身份字段无一相等(openid/phone/email)`)
  }
}

const badBefore = printRuler('迁移前 · 尺')

if (!APPLY) {
  console.log('\n  演练结束 —— **一个字没写**。要真跑:加 --apply(会先备份)')
  db.close()
  process.exit(0)
}
if (!rows.length && !orphans.length && !badBefore.length) {
  console.log('\n  ✅ 零条待处置且尺全 0 —— 幂等重跑就是这个结果(库一分不动)')
  db.close()
  process.exit(0)
}

/* ── 真跑:先备份 → 打数 → 一个事务里做完 → 再打数 ── */
const COUNTED = ['users', 'bookings', ...FOLLOW_ALL, ...ASSETS, 'user_identities']
const snapshot = () => Object.fromEntries(COUNTED.map((t) => {
  try { return [t, cnt(`SELECT COUNT(*) AS n FROM "${t}"`)] } catch { return [t, null] }
}))

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = `${DB_PATH}.pre-crosstenant-${stamp}`
copyFileSync(DB_PATH, backup)
console.log(`\n  备份已出:${backup}`)

const before = snapshot()
console.log(`  迁移前行数:${JSON.stringify(before)}`)

let moved = 0
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
    /* 🔴 04a 补上的那一半:这一次到店的从属记录跟着单走(同一个事务) */
    for (const t of FOLLOW) {
      const r = db.prepare(`UPDATE "${t}" SET user_id = ? WHERE booking_id = ? AND user_id = ?`).run(target, p.bid, p.uid)
      moved += Number(r.changes || 0)
    }
  }
  /* 第二遍:落单的跟单行按行修(窄口径,见上面的类定义) */
  for (const o of orphans) {
    const r = db.prepare(`UPDATE "${o.t}" SET user_id = ? WHERE rowid = ? AND user_id = ?`).run(o.new_uid, o.rid, o.old_uid)
    moved += Number(r.changes || 0)
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
console.log(`  迁移后行数:${JSON.stringify(after)}`)
const diff = Object.fromEntries(COUNTED.map((t) => [t, (after[t] ?? 0) - (before[t] ?? 0)]))
console.log(`  行数差值:  ${JSON.stringify(diff)}`)
console.log(`  跟单行改指:${moved} 行(UPDATE,不改行数)`)

/* 差值形状:只许多出 willCreate 份档案,**别的表一行都不许多也不许少**(跟单是 UPDATE) */
const shapeBad = Object.entries(diff).filter(([t, d]) => (t === 'users' ? d !== willCreate : d !== 0))
const badAfter = printRuler('迁移后 · 尺')
const okShape = shapeBad.length === 0
console.log(`\n  差值形状:${okShape ? `✔ 只多了 ${willCreate} 份档案,别的表行数零变化` : `🔴 不对(${shapeBad.map(([t, d]) => `${t}${d > 0 ? '+' : ''}${d}`).join(' · ')})—— 请拿备份回滚`}`)
console.log(`  逐表验尺:${badAfter.length === 0 ? '✔ bookings + 跟单表全部 0' : `🔴 还有串味:${badAfter.map((x) => `${x.t}=${x.n}`).join(' · ')}`}`)
if (badAfter.length && !rows.length && !orphans.length) {
  console.log(`  ⚠️ 尺红,但待处置 0 条、可修的落单行也 0 行${orphansHuman.length ? `(另有 ${orphansHuman.length} 行属「要人看」,按口径不许动)` : ''}`
    + ' —— 本脚本修不了这一种,**停下来报店主**,不要反复重跑')
}
if (SKIP_FOLLOW.length && badAfter.length) console.log('  (造病模式下红是**对的** —— 它证明这把尺真的在看那几张跟单表)')
db.close()
process.exit(okShape && badAfter.length === 0 ? 0 : 1)
