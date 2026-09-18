/* 🔴 09r §二 · 只读算一遍:那两条一次性迁移会改判谁
 *
 * 立件:`backfillTenantKindOnce` 按 **id 前缀**判店铺类型,而 **D73 已经废弃这个判法**
 * (演示店走平台后台显式勾选,不再看 id 前缀);`retireLegacyDemoArchives` 按
 * **display_name 含「演示」** 打退役标。两条都**改内容**,不是加行。
 * 现成的靶子:**`jics-nail`(小婕真店)与 `jics-store`(沙箱镜像)前缀相同。**
 *
 * 🔴 **本脚本只 SELECT,一个字的写都没有。** 不调那两个迁移函数,而是**把它们的规则照抄一遍**
 * 在内存里算 —— 规则原文见 `apps/api/ledger-guards.mjs:125-147`,逐行对照抄在下面。
 *
 * 用法:node tools/d73-impact.mjs <库文件路径>
 */
import { DatabaseSync } from 'node:sqlite'
import { requireTarget } from './db-target.mjs'

/* ── 规则照抄(与 apps/api/ledger-guards.mjs:125-126 逐字一致)────────────── */
const LEGACY_TEST_PREFIX = ['nsas', 'dbl', 'p2dc', 'p2sc', 'p2sal', 'p2ft', 'p12', 'p25', 'r3s', 'r2s', 'authx', 'diag', 'p0hy', 'p2fl']
const LEGACY_DEMO_IDS = ['demo-ai', 'demo-basic', 'hoptest-demo2']

/** 照抄 `backfillTenantKindOnce` 的循环体(:137-145),只算不写 */
function wouldBecome(id) {
  const head = String(id).split('-')[0]
  if (LEGACY_DEMO_IDS.includes(id) || String(id).startsWith('demo-')) return 'demo'
  if (LEGACY_TEST_PREFIX.includes(head) || id === 'tenant-iso-b') return 'test'
  return null   // 规则没覆盖到 → 不动
}

/* 🔴 护栏:目标库**必须显式给,不许有默认值**(`db-target-guard ①c/①d` 当场咬住,咬得对)。
   「这是只读的,要什么护栏」—— 那条律治的病根不是「会不会写坏」,是
   **「有默认值,所以打错了不报错」**:只读打错库,**报出来的数照样是错库的数**,
   而它会被当成生产的答案写进回执。**读错库比写错库更难发现。** */
const dbPath = requireTarget({
  envName: '第 1 个参数 <库文件绝对路径>',
  value: process.argv[2],
  hint: '(生产 /app/apps/api/local-data/lucky-luxe.sqlite · 本机 apps/api/local-data/lucky-luxe.sqlite)',
})
console.log(`【目标库自报】${dbPath}\n`)
const db = new DatabaseSync(dbPath, { readOnly: true })

/* 🔴 J-75 · **每一列先探存在,不是探一列**。
   09p 我只探了 `payments.transaction_id`,`bookings.demo_seed` 没探,查询当场炸;
   这一版写这个脚本时又踩一次(`users.created_at` 在本机库里根本没有)。
   所以这里把**用到的每一列**列出来逐个探,缺一列就**明说是哪一列**,不给堆栈。 */
const NEED = { tenants: ['id', 'name', 'kind', 'status'], users: ['id', 'tenant_id', 'display_name', 'tags_json'] }
const missing = []
for (const [t, cols] of Object.entries(NEED)) {
  let have = []
  try { have = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name) } catch { missing.push(`${t}(表不存在)`); continue }
  for (const c of cols) if (!have.includes(c)) missing.push(`${t}.${c}`)
}
if (missing.length) {
  console.error(`🔴 这些列在这个库里不存在,**停**(不许改用别的列凑):${missing.join(' · ')}`)
  process.exit(3)
}
console.log(`【列存在性预探】${Object.entries(NEED).map(([t, c]) => `${t}(${c.length} 列)`).join(' · ')} —— 全部在 ✅\n`)

/* ── 查询① tenants 逐行 ──────────────────────────────────────────────── */
const tenants = db.prepare('SELECT id, name, COALESCE(kind, \'(null)\') AS kind, status FROM tenants ORDER BY rowid').all()
console.log(`【查询①】tenants 共 ${tenants.length} 行,逐行:`)
for (const t of tenants) console.log(`   ${String(t.id).padEnd(18)} kind=${String(t.kind).padEnd(8)} status=${String(t.status).padEnd(8)} ${t.name}`)

/* ── 查询② 照规则算:三栏,加起来必须等于底数(J-66)────────────────────── */
const scan = tenants.filter((t) => (t.kind === 'real' || t.kind === '(null)'))   // 迁移只看 COALESCE(kind,'real')='real' 这一批
const changed = [], unchanged = [], outOfScope = []
for (const t of tenants) {
  if (!scan.includes(t)) { outOfScope.push({ ...t, why: `kind=${t.kind},迁移的 WHERE 不选它` }); continue }
  const to = wouldBecome(t.id)
  if (to) changed.push({ ...t, to })
  else unchanged.push(t)
}
console.log(`\n【查询②】照 backfillTenantKindOnce 的规则算(只算不写):`)
console.log(`   🔴 会被改判 ${changed.length} 家:`)
for (const c of changed) console.log(`      🔴 ${c.id}  ${c.kind} → ${c.to}   「${c.name}」`)
if (!changed.length) console.log('      (无)')
console.log(`   算完不变 ${unchanged.length} 家:${unchanged.map((x) => x.id).join(' · ') || '(无)'}`)
console.log(`   规则没覆盖到(kind 已非 real,迁移根本不选)${outOfScope.length} 家:${outOfScope.map((x) => `${x.id}[${x.kind}]`).join(' · ') || '(无)'}`)
const sum = changed.length + unchanged.length + outOfScope.length
console.log(`   四格闭合:${changed.length} + ${unchanged.length} + ${outOfScope.length} = ${sum} · 底数 ${tenants.length} · ${sum === tenants.length ? '✅' : '🔴 加不上'}`)

/* ── 查询③ retireLegacyDemoArchives 的命中面 ──────────────────────────────
   规则照抄 legacy-demo-retire.mjs:19-22:
     tenant_id IN ('lucky-luxe','jics-nail')
     AND display_name NOT LIKE '演示2-%'
     AND (id LIKE 'demo-%' OR display_name LIKE '%演示%' OR display_name = '店主验签')  */
const hits = db.prepare(`SELECT id, tenant_id, display_name, tags_json FROM users
  WHERE tenant_id IN ('lucky-luxe', 'jics-nail')
    AND display_name NOT LIKE '演示2-%'
    AND (id LIKE 'demo-%' OR display_name LIKE '%演示%' OR display_name = '店主验签')
  ORDER BY tenant_id, id`).all()
console.log(`\n【查询③】retireLegacyDemoArchives 会打退役标的 users:**${hits.length} 行**`)
const byT = {}
for (const h of hits) byT[h.tenant_id] = (byT[h.tenant_id] || 0) + 1
for (const [t, n] of Object.entries(byT)) console.log(`   ${t}: ${n} 行`)
if (hits.length) {
  /* `users` 没有 created_at 这一列(现探),所以逐行给的是「店 · 名字 · id · 现有标签」——
     id 里带时间戳段,顺序也能看出先后。**不编一个不存在的列出来。** */
  console.log('   逐行(店 · 名字 · id · 现有标签):')
  for (const h of hits) console.log(`      🔴 ${h.tenant_id.padEnd(12)} 「${h.display_name}」  ${h.id}  tags=${h.tags_json || '[]'}`)
}
/* 底数:这两家真店一共多少顾客 —— 一个 0 不带底数不许写进报告(J-65③) */
const base = db.prepare("SELECT tenant_id, COUNT(*) n FROM users WHERE tenant_id IN ('lucky-luxe','jics-nail') GROUP BY tenant_id").all()
console.log(`   底数(这两家真店的 users):${base.map((b) => `${b.tenant_id}=${b.n}`).join(' · ')}`)
db.close()
