/* D130 身份表串味刀(店主 04a §二 裁,2026-09-03 落)

   ══ 病 ══
   `user_identities.tenant_id TEXT NOT NULL DEFAULT 'lucky-luxe'`(D126/D128 同一根子),
   而启动回填四条 `INSERT OR IGNORE` **都不带 tenant_id**、每次启动都跑 ——
   本机库现测 **96 行**身份挂错店(lucky-luxe|demo-ai 48 · lucky-luxe|jics-nail 47 · lucky-luxe|hoptest-demo2 1)。

   ══ 危害不是「只是标错」 ══
   `upsertUserIdentity` 按 (provider, provider_user_id, ownerTenant) 找已有行:
   旗舰店一位顾客用手机号 X 绑定 → ownerTenant='lucky-luxe' →
   命中的是**别店顾客那行被错标成 lucky-luxe 的身份** → `UPDATE … SET user_id = 旗舰店顾客`
   → **别店那位的手机号身份被改指给了别人**。本刀 ③ 把这条路径真跑一遍。

   ══ 只打沙箱、且连沙箱本身都不碰 ══
   在库的一份**临时副本**上跑,跑完删。 */

import { readFileSync, copyFileSync, existsSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { backfillIdentities, createIdentityUpsert, scanIdentityMismatch, repairIdentityTenant, identityRulers } from './user-identity.mjs'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

/* ═══ ① 静态:回填四条**列表与 SELECT 表两边都得有 tenant_id** ═══
   第二层 —— `test-tenant-explicit` ①d 只看列名括号里有没有 tenant_id;
   `INSERT … SELECT` 还得 SELECT 出来一个值。列名写了、SELECT 忘了,照样报 NOT NULL 错或落默认。 */
const uiSrc = readFileSync(join(ROOT, 'apps/api/user-identity.mjs'), 'utf8')
const backfillStmts = [...uiSrc.matchAll(/INSERT\s+OR\s+IGNORE\s+INTO\s+user_identities\s*\(([^)]*)\)\s*SELECT([\s\S]*?)FROM\s+users/gi)]
const bad1 = backfillStmts.filter((m) => !/\btenant_id\b/.test(m[1]) || !/\btenant_id\b/.test(m[2]))
check(`① 白名单式:回填的 ${backfillStmts.length} 条 \`INSERT … SELECT\` **列名与 SELECT 两边都要有 tenant_id** —— `
  + '列名写了、SELECT 忘了照样落默认值(第二层:`test-tenant-explicit` ①d 只看得见列名那一半)',
backfillStmts.length === 4 && bad1.length === 0, `共 ${backfillStmts.length} 条,缺 ${bad1.length} 条`)

/* ② 零命中先证刀能咬:历史坏版(不带 tenant_id)必须被 ① 咬中 */
const OLD_BAD = `INSERT OR IGNORE INTO user_identities (id, user_id, provider, provider_user_id, created_at, updated_at)
  SELECT 'x', id, 'phone', phone, datetime('now'), datetime('now') FROM users WHERE phone IS NOT NULL`
check('② 🔴 零命中先证刀能咬:历史坏版(既不写列名也不 SELECT tenant_id)必须被 ① 的判据咬中',
  [...OLD_BAD.matchAll(/INSERT\s+OR\s+IGNORE\s+INTO\s+user_identities\s*\(([^)]*)\)\s*SELECT([\s\S]*?)FROM\s+users/gi)]
    .filter((m) => !/\btenant_id\b/.test(m[1]) || !/\btenant_id\b/.test(m[2])).length === 1, '')

/* ═══ 行为层:在库的临时副本上跑 ═══ */
const SRC = process.env.TEST_DB_PATH || join(ROOT, 'apps/api/sandbox-data/lucky-luxe.sqlite')
if (!existsSync(SRC)) {
  console.log(`   ⚠️ 拿不到库(${SRC})—— **行为层本轮未跑**(不静默跳过,如实说)`)
  check('③ 前置:行为层要有一份库才能跑 —— 拿不到就红,不许静默跳过(断言增量律)', false, SRC)
} else {
  const dir = mkdtempSync(join(tmpdir(), 'll-d130-'))
  const COPY = join(dir, 'probe.sqlite')
  copyFileSync(SRC, COPY)
  const db = new DatabaseSync(COPY)
  const iso = (d) => d.toISOString()
  let seq = 0
  const randomId = (p) => `${p}_d130probe_${(seq += 1)}`
  const upsert = createIdentityUpsert({ db, iso, randomId, currentTenantId: () => 'lucky-luxe' })

  /* 造景(自造一次性数据,不取真账里的行):两店各一位顾客,**同一个手机号** */
  const PHONE = '+19995550130'
  db.exec('BEGIN IMMEDIATE')
  db.prepare("INSERT INTO users (id, display_name, phone, tenant_id) VALUES ('u_d130_a', 'D130探针_旗舰店', ?, 'lucky-luxe')").run(PHONE)
  db.prepare("INSERT INTO users (id, display_name, phone, tenant_id) VALUES ('u_d130_b', 'D130探针_小婕店', ?, 'jics-nail')").run(PHONE)
  db.exec('COMMIT')

  const rowOf = (uid) => db.prepare('SELECT * FROM user_identities WHERE user_id = ? AND provider = ?').get(uid, 'phone')

  upsert({ userId: 'u_d130_b', provider: 'phone', providerUserId: PHONE, phone: PHONE })
  const bBefore = JSON.stringify(rowOf('u_d130_b'))
  upsert({ userId: 'u_d130_a', provider: 'phone', providerUserId: PHONE, phone: PHONE })
  const a = rowOf('u_d130_a')
  const bAfter = rowOf('u_d130_b')
  console.log(`   [刀] 造景:两店各一位顾客同号 ${PHONE};B 店先绑、A 店后绑`)
  check('③ 🔴 行为:两店同号各归各 —— A 行 tenant=lucky-luxe / B 行 tenant=jics-nail,user_id 各是各的',
    !!a && a.tenant_id === 'lucky-luxe' && !!bAfter && bAfter.tenant_id === 'jics-nail'
    && a.user_id === 'u_d130_a' && bAfter.user_id === 'u_d130_b', JSON.stringify({ a, bAfter }))
  check('③b 🔴 行为·逐字段对照:A 店那次 upsert 之后,**B 店那行一个字段都不许变**',
    bBefore === JSON.stringify(bAfter), `前 ${bBefore}\n后 ${JSON.stringify(bAfter)}`)

  /* ④ 危害路径复现:把 B 那行**手改成错标**(这正是 D130 存量的样子),再让 A 绑一次 */
  /* 顺序有讲究:先删掉 A 自己那行,再把 B 那行改成错标 ——
     唯一键是 (tenant_id, provider, provider_user_id),A 的正确行还在时根本改不成错标。
     而**这正是真实病灶的形状**:回填一人一行,旗舰店那位当时还没有行,
     别店那位的行先被落成了 lucky-luxe。 */
  db.prepare("DELETE FROM user_identities WHERE user_id = 'u_d130_a' AND provider = 'phone'").run()
  db.prepare("UPDATE user_identities SET tenant_id = 'lucky-luxe' WHERE user_id = 'u_d130_b' AND provider = 'phone'").run()
  upsert({ userId: 'u_d130_a', provider: 'phone', providerUserId: PHONE, phone: PHONE })
  const hijacked = db.prepare("SELECT user_id FROM user_identities WHERE tenant_id='lucky-luxe' AND provider='phone' AND provider_user_id=?").get(PHONE)
  check('④ 🔴 危害路径复现(证明这条病是真会咬人的,不是纸上推演):'
    + '把 B 店那行改成错标 → A 店再绑同号 → **B 店那位的身份行被改指给 A** '
    + '(她下次用手机号登自己店就找不到自己)—— 所以存量必须修,不能只修代码',
  !!hijacked && hijacked.user_id === 'u_d130_a', JSON.stringify(hijacked))

  /* ⑤ 修复本体:错标行修完两把尺归零 */
  const before = identityRulers(db)
  const rows = scanIdentityMismatch(db)
  db.exec('BEGIN IMMEDIATE')
  const res = repairIdentityTenant(db, rows)
  db.exec('COMMIT')
  const after = identityRulers(db)
  console.log(`   [刀] 修复:错标 ${before.mismatch} → ${after.mismatch}(改标 ${res.updated} · 删 ${res.deleted})`)
  check('⑤ 🔴 存量修复:两把尺归零 —— ①零错标 ②(tenant_id, provider, provider_user_id) 无重复',
    after.mismatch === 0 && after.dup === 0, JSON.stringify({ before, after, res }))

  /* ⑥ 回填不再造错标 + 反向守:历史坏版跑一次必须造出错标(证明这把尺真的在看) */
  db.exec('DELETE FROM user_identities')
  backfillIdentities(db)
  const fixed = identityRulers(db)
  db.exec('DELETE FROM user_identities')
  db.exec(`INSERT OR IGNORE INTO user_identities (id, user_id, provider, provider_user_id, phone, created_at, updated_at)
    SELECT 'bad-' || lower(hex(randomblob(6))), id, 'phone', phone, phone, datetime('now'), datetime('now')
    FROM users WHERE phone IS NOT NULL AND phone != ''`)
  const broken = identityRulers(db)
  console.log(`   [刀] 回填对照:现版错标 ${fixed.mismatch} · 历史坏版错标 ${broken.mismatch}`)
  check('⑥ 🔴 回填不再造错标:清空身份表后跑现版回填 → 错标 0',
    fixed.mismatch === 0 && fixed.dup === 0, JSON.stringify(fixed))
  check('⑥b 反向守:同一份数据喂**历史坏版**(不带 tenant_id)必须造出错标 —— '
    + '一把「怎么跑都 0」的尺子证明不了回填修好了',
  broken.mismatch > 0, JSON.stringify(broken))

  db.close()
  try { unlinkSync(COPY) } catch { /* 临时副本 */ }
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* 临时目录 */ }
  console.log('   [收尾] 临时副本已删,源库一个字节没碰')
}

console.log('\n[D130 身份串味] 静态两条 + 行为六条(两店同号各归各 / 旁店那行逐字段不变 / 危害路径复现 / 修复归零 / 回填对照)')
if (fails.length) { console.error(`\n❌ test-identity-tenant ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-identity-tenant 通过 ${checks} 项`)
