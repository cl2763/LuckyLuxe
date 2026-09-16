/* 🔴 D137 落值触发器回落旗舰店(店主 04g §一 裁,现修)+ 重建型迁移必先备份(§二 立刀)

   ══ 病 ══
   七条 `_tenant_fill` 触发器的兜底写的是
   `COALESCE((SELECT 父表.tenant_id …), 'lucky-luxe')` —— **父表找不到就静默算旗舰店的**;
   开机还有一段「NULL 的一律归旗舰店」。这与 D126(列默认值)/ D130(身份表)/ D131(31 张表)
   **是同一个根子换了身衣服**:有默认值,打错了不报错。

   🔴 更要紧的是:我 04f-2 新立的判据「可空租户列必须有落值触发器」**把它当合规放过了** ——
   判据只问「有没有触发器」,没问「那条触发器兜的是什么」。
   店主 04g 把判据改成:**落值触发器里不许有常量兜底**。

   ══ 修法 ══
   解得出就填;解不出 → `RAISE(ABORT, 'TENANT_UNRESOLVED')`,**整行不落**;
   开机那七条 UPDATE 改成**只报数不改值**(`/health.tenantNullRows`)。

   ⚠️ standalone:CI_SUITES="tenant-fill-trigger" bash apps/api/run-all-tests.sh */
import { readFileSync, existsSync, statSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { assertTestTarget } from './test-guard.mjs'

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
await assertTestTarget(BASE_URL)
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

const DBP = process.env.TEST_DB_PATH || ''
if (!DBP) {
  check('前置:拿得到 TEST_DB_PATH —— 取不到就红,不许静默跳过(断言增量律)', false, '未设')
} else {
  const db = new DatabaseSync(DBP, { readOnly: true })
  const trgs = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger' AND name LIKE '%_tenant_fill'").all()

  /* ① 白名单式静态:每一条落值触发器都不许有常量兜底 */
  const withConst = trgs.filter((t) => /COALESCE\s*\(/i.test(t.sql) || /'lucky-luxe'/.test(t.sql))
  check(`① 🔴 落值触发器**不许有常量兜底**:现有 ${trgs.length} 条 \`_tenant_fill\`,`
    + '逐条不许出现 COALESCE 兜底或写死的租户 id —— '
    + '「父表找不到就算旗舰店的」与 D126/D130/D131 是同一个根子换了身衣服;'
    + '04f-2 那条「必须有落值触发器」的判据只问有没有、没问兜的是什么,把它当合规放过了',
  withConst.length === 0, withConst.map((t) => t.name).join(' · '))

  check(`①b 反向守:七条都在且都会拒绝落行(逐条含 RAISE(ABORT) 与 TENANT_UNRESOLVED)—— `
    + '一条「什么都不做」的触发器同样能让 ① 绿',
  trgs.length >= 7 && trgs.every((t) => /RAISE\s*\(\s*ABORT/i.test(t.sql) && /TENANT_UNRESOLVED/.test(t.sql)),
  `${trgs.length} 条:${trgs.filter((t) => !/RAISE/i.test(t.sql)).map((t) => t.name).join(' · ')}`)

  /* ② 开机回填改成只报数:源码里不许再有「NULL 的一律归旗舰店」 */
  const srv = readFileSync(join(ROOT, 'apps/api/local-server.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/^[^\S\n]*\/\/.*$/gm, '')
  const nullFix = /UPDATE\s+\w+\s+SET\s+tenant_id\s*=\s*'?\$?\{?DEFAULT_TENANT_ID\}?'?\s+WHERE\s+tenant_id\s+IS\s+NULL/i.test(srv)
  check('② 开机不许再「把 NULL 的一律归旗舰店」—— 改成只报数不改值,由人处置',
    !nullFix, '源码里还留着那条 UPDATE')

  db.close()

  /* ③ 行为层:在**临时副本**上插一行父表解不出的 payments —— 必须失败,且不许出现在任何租户下 */
  const dir = mkdtempSync(join(tmpdir(), 'll-d137-'))
  const COPY = join(dir, 'probe.sqlite')
  copyFileSync(DBP, COPY)
  const w = new DatabaseSync(COPY)
  const before = w.prepare('SELECT COUNT(*) AS n FROM payments').get().n
  let threw = ''
  try {
    w.prepare(`INSERT INTO payments (id, booking_id, provider, status, amount_cents, currency, created_at, updated_at)
      VALUES ('pay_d137_probe', 'booking-that-does-not-exist', 'mock', 'paid', 100, 'CAD', datetime('now'), datetime('now'))`).run()
  } catch (error) { threw = String(error.message || error) }
  const after = w.prepare('SELECT COUNT(*) AS n FROM payments').get().n
  const leaked = w.prepare("SELECT COUNT(*) AS n FROM payments WHERE id = 'pay_d137_probe'").get().n
  console.log(`   [刀] 父表解不出的插入:抛错=${threw ? `「${threw.slice(0, 46)}」` : '否'} · payments ${before}→${after} · 残留 ${leaked}`)
  check('③ 🔴 行为:父表解不出所属门店的插入 → **拒绝落行**,一行都不许留下 —— '
    + '原来它会落进旗舰店,而且不报错',
  /TENANT_UNRESOLVED/.test(threw) && after === before && leaked === 0,
  `抛错=${threw.slice(0, 80)} · ${before}→${after} · 残留 ${leaked}`)

  /* ③b 正向守:带真 booking 的插入必须落到**那张单的租户**(一把「谁都拒」的闸证明不了它在分辨) */
  /* 造景律:全新 CI 库里一张单都没有 —— 自己先造一张(自造一次性数据,不取真账里的行) */
  let bk = w.prepare('SELECT id, tenant_id FROM bookings LIMIT 1').get()
  if (!bk) {
    const st = w.prepare('SELECT id FROM stores LIMIT 1').get()
    const tech = w.prepare('SELECT id FROM technicians LIMIT 1').get()
    const svc = w.prepare('SELECT id FROM services LIMIT 1').get()
    w.prepare(`INSERT INTO bookings (id, public_code, store_id, technician_id, service_id, status,
      appointment_start, appointment_end, addons_json, service_price_cents, deposit_cents, final_due_cents,
      total_duration_min, created_at, updated_at, tenant_id)
      VALUES ('bk_d137_probe', 'D137P', ?, ?, ?, 'confirmed', datetime('now'), datetime('now'), '[]',
      19800, 0, 19800, 60, datetime('now'), datetime('now'), 'lucky-luxe')`).run(st.id, tech.id, svc.id)
    bk = w.prepare("SELECT id, tenant_id FROM bookings WHERE id = 'bk_d137_probe'").get()
  }
  let okThrew = ''
  try {
    w.prepare(`INSERT INTO payments (id, booking_id, provider, status, amount_cents, currency, created_at, updated_at)
      VALUES ('pay_d137_ok', ?, 'mock', 'paid', 100, 'CAD', datetime('now'), datetime('now'))`).run(bk.id)
  } catch (error) { okThrew = String(error.message || error) }
  const got = w.prepare("SELECT tenant_id FROM payments WHERE id = 'pay_d137_ok'").get()
  check('③b 正向守:带真 booking 的插入必须落到**那张单的租户** —— '
    + '一把「谁来都拒」的闸跟关掉这张表一样',
  !okThrew && got && got.tenant_id === bk.tenant_id, `${okThrew} · 落到 ${got?.tenant_id} / 期望 ${bk.tenant_id}`)

  /* ④ finance_targets 收紧成 NOT NULL(店主 04g 裁:不补触发器) */
  const ft = w.prepare("SELECT \"notnull\" AS nn FROM pragma_table_info('finance_targets') WHERE name = 'tenant_id'").get()
  check('④ `finance_targets.tenant_id` 收紧成 **NOT NULL**(店主 04g 裁:不补触发器 —— '
    + '补触发器就是再造一个「打错了不报错」;`TEXT PRIMARY KEY` 在 SQLite 里本来是可空的)',
  ft && ft.nn === 1, JSON.stringify(ft))

  w.close()
  rmSync(dir, { recursive: true, force: true })
}

/* ⑤ 备份刀:重建型迁移必须先复制库文件(店主 04g §二) */
const dropSrc = readFileSync(join(ROOT, 'apps/api/tenant-default-drop.mjs'), 'utf8')
const srvRaw = readFileSync(join(ROOT, 'apps/api/local-server.mjs'), 'utf8')
check('⑤ 🔴 重建型迁移**开机路径也必须先备份库文件** —— '
  + '04f-2 那次重建 31 张表一个备份都没留;事务回滚只保得住「迁移失败」,'
  + '保不住「迁移成功但迁错了」',
  /* 🔴 09n:锚改了一次,记下为什么(J-58③:锚不许选在正当重构会抹掉的字面量上)。
     原来锚的是 `export function backupBeforeRebuild` 这个**字面形式**;
     09n 件 A 把实现收进唯一出口 `./db-backup-core.mjs`,这里改成**转出**,
     字面没了 —— 判据当场红,而能力不但没丢,还从 cp 变成了 VACUUM INTO。
     新锚锚在**能力**上:①这个模块确实对外给出 backupBeforeRebuild(哪种写法都行)
     ②调用处带 dbPath ③启动日志打得出来 ④🔴 **它最终走的是 VACUUM INTO,不是 cp**。 */
  /export\s+(?:function\s+backupBeforeRebuild|\{[^}]*\bbackupBeforeRebuild\b[^}]*\}\s+from)/.test(dropSrc)
  && /backupBeforeRebuild\(\{[\s\S]{0,200}?dbPath/.test(srvRaw)
  && /重建前已备份/.test(srvRaw)
  && /VACUUM INTO/.test(readFileSync(join(ROOT, 'apps/api/db-backup-core.mjs'), 'utf8'))
  && !/copyFileSync/.test(readFileSync(join(ROOT, 'apps/api/db-backup-core.mjs'), 'utf8')), '')

/* ⑤b 行为层:临时库造一张带 DEFAULT 的表 → 起服后必须留下备份且大小等于起服前 —— 见回执现测。
   这里守的是「备份那一行不许被摘掉」的静态形制;行为层由回执的起服冒烟给证据。 */
check('⑤b 备份路径必须打进启动日志(没打日志 = 出了事找不到那份备份)',
  /console\.log\(`\[migrate\] 重建前已备份/.test(srvRaw), '')

console.log(`\n[D137] 落值触发器零常量兜底 · 解不出拒绝落行 · finance_targets NOT NULL · 重建前必备份`)
if (fails.length) { console.error(`\n❌ test-tenant-fill-trigger ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-tenant-fill-trigger 通过 ${checks} 项`)
