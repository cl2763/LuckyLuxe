#!/usr/bin/env node
/* 12t补 §三 · 沙箱夹具与生产同名同形(店主 2026-09-24 扩到三家真店)
 *
 * ══ 做什么 ══
 * 把**生产**三家真店(lucky-luxe / luvia-bj / jics-nail)的
 *   门店信息 · 价目(含三档价、时长、主项/加项、大类)· 技师 · 营业时间
 * 写进**沙箱库**,好让截图里看到的就是小婕真实会看到的。
 *
 * 🔴 **不复制**:顾客(users)· 预约(bookings)· 结算(settlements)· 账号密码(admin_accounts)。
 *    这条是硬的 —— 下面 ALLOW 表之外的表名一个都不许出现在本文件的写语句里,判据会扫。
 *
 * ══ 生产只读 ══ 生产那一头的数据由 `tools/prod-ro.mjs`(只放行 SELECT)导出成 JSON,
 *    本脚本**只读那份 JSON、只写沙箱**,一次生产写都没有。
 *
 * ══ J-114 第二款:造景脚本必须自带反向删除 ══
 *    `--undo` 把本脚本写进去的行按 (表, tenant_id) 全删干净;
 *    `--verify` 逐表逐行与那份 JSON 对账(条数 + 金额),不一致即非零退出。
 *
 * 用法:
 *   node tools/sync-sandbox-from-prod.mjs --dump <生产导出.json>          # 写
 *   node tools/sync-sandbox-from-prod.mjs --dump <…> --verify             # 只对账
 *   node tools/sync-sandbox-from-prod.mjs --dump <…> --undo               # 反向删除
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { requireTarget } from './db-target.mjs'

const TENANTS = ['lucky-luxe', 'luvia-bj', 'jics-nail']
/* 🔴 白名单式:只许碰这七张。顾客/预约/结算/账号一个都不在里面。 */
const ALLOW = ['stores', 'service_categories', 'services', 'service_prices', 'technicians', 'business_hours', 'technician_services']
const DB = requireTarget({envName:'SANDBOX_DB',value:process.env.SANDBOX_DB,hint:'显式指定隔离沙箱数据库'})

const args = process.argv.slice(2)
const dumpPath = args[args.indexOf('--dump') + 1]
const MODE = args.includes('--undo') ? 'undo' : args.includes('--verify') ? 'verify' : 'write'
if (!dumpPath || !existsSync(dumpPath)) { console.error('🔴 --dump <生产导出.json> 必填且文件要在'); process.exit(2) }
if (!existsSync(DB)) { console.error(`🔴 沙箱库不在:${DB}`); process.exit(2) }
/* 目标库自证:只许打沙箱,路径不含 sandbox-data 一律拒(写库脚本不许有默认目标) */
if (!/sandbox-data/.test(DB)) { console.error(`🔴 目标库不是沙箱:${DB} —— 本脚本只许写沙箱`); process.exit(2) }

const dump = JSON.parse(readFileSync(dumpPath, 'utf8'))
for (const t of Object.keys(dump)) {
  if (!ALLOW.includes(t)) { console.error(`🔴 导出里有不许复制的表「${t}」—— 停`); process.exit(2) }
}
for (const t of ALLOW) {
  if (!Array.isArray(dump[t])) throw new Error(`导出缺少完整表 ${t}；拒绝把缺表当空表`)
  for(const r of dump[t]) if(t!=='technician_services'&&!TENANTS.includes(r.tenant_id)) throw new Error(`越界租户: ${t}`)
}
const techTenant=new Map(dump.technicians.map(r=>[r.id,r.tenant_id])),svcTenant=new Map(dump.services.map(r=>[r.id,r.tenant_id]))
for(const r of dump.technician_services) if(!techTenant.has(r.technician_id)||techTenant.get(r.technician_id)!==svcTenant.get(r.service_id)) throw new Error('技师项目关联缺失或跨店')
const db = new DatabaseSync(DB)
db.exec('PRAGMA foreign_keys=ON')
for(const t of ALLOW) {
  const columns=new Set(db.prepare(`PRAGMA table_info("${t}")`).all().map(r=>r.name))
  for(const r of dump[t]) for(const c of Object.keys(r)) if(!columns.has(c)) throw new Error(`未知字段 ${t}.${c}`)
}
for(const t of ['stores','services','technicians']) for(const r of dump[t]) {
  const existing=db.prepare(`SELECT tenant_id FROM "${t}" WHERE id=?`).get(r.id)
  if(existing&&existing.tenant_id!==r.tenant_id) throw new Error(`同ID跨店 ${t}`)
}

/* ══ 外键现实(沙箱现扫)══
 *   bookings / quote_requests / technician_services / technician_schedules / booking_slots
 *   都引用 services · technicians · stores。**删它们会断外键**(头一版就是这么红的)。
 *   所以改法按表分三类,并把每一步记进**变更流水**,`--undo` 照流水逐条回滚 ——
 *   不靠 `cp` 还原(J-114 第二款:库有服务开着时 cp 不算还原)。
 *
 *   ① stores        —— 三家的 store id 生产与沙箱**完全相同**(现测),所以**原地 UPDATE**
 *   ② service_categories / service_prices / business_hours —— 无人引用,整租户删了重插
 *   ③ services / technicians —— 被预约引用,**upsert**;沙箱多出来的**下架(is_active=0)不删**
 */
const JOURNAL = process.env.SYNC_JOURNAL || DB+'.sync-journal.json'
const SAFE_DELETE = ['service_categories', 'service_prices', 'business_hours']
const UPSERT = ['services', 'technicians']

function rowsOf(t) {
  if(t==='technician_services')return db.prepare(`SELECT ts.* FROM technician_services ts JOIN technicians tech ON tech.id=ts.technician_id WHERE tech.tenant_id IN (${TENANTS.map(()=>'?').join(',')})`).all(...TENANTS)
  return db.prepare(`SELECT * FROM "${t}" WHERE tenant_id IN (${TENANTS.map(() => '?').join(',')})`).all(...TENANTS)
}
function clearLinks(){db.prepare(`DELETE FROM technician_services WHERE technician_id IN (SELECT id FROM technicians WHERE tenant_id IN (${TENANTS.map(()=>'?').join(',')}))`).run(...TENANTS)}
function putLinks(rows){for(const r of rows)db.prepare('INSERT INTO technician_services (technician_id,service_id) VALUES (?,?)').run(r.technician_id,r.service_id)}


if (MODE === 'undo') {
  if (!existsSync(JOURNAL)) { console.error(`🔴 没有变更流水 ${JOURNAL} —— 无法逐条回滚,停`); process.exit(2) }
  const jr = JSON.parse(readFileSync(JOURNAL, 'utf8'))
  if(jr.undoneAt||jr.target!==resolve(DB)||!Array.isArray(jr.before.technician_services))throw new Error('流水目标或关联不完整，拒绝撤销')
  db.exec('BEGIN IMMEDIATE')
  try {
    clearLinks()
    let n = 0
    for (const t of SAFE_DELETE) { for (const tid of TENANTS) db.prepare(`DELETE FROM "${t}" WHERE tenant_id = ?`).run(tid) }
    for (const t of SAFE_DELETE) for (const r of (jr.before[t] || [])) {
      const c = Object.keys(r)
      db.prepare(`INSERT INTO "${t}" (${c.map((x) => `"${x}"`).join(',')}) VALUES (${c.map(() => '?').join(',')})`).run(...c.map((x) => r[x])); n += 1
    }
    for (const t of [...UPSERT, 'stores']) {
      for (const id of (jr.inserted[t] || [])) { db.prepare(`DELETE FROM "${t}" WHERE id = ?`).run(id); n += 1 }
      for (const r of (jr.before[t] || [])) {
        const c = Object.keys(r).filter((x) => x !== 'id')
        db.prepare(`UPDATE "${t}" SET ${c.map((x) => `"${x}"=?`).join(',')} WHERE id = ?`).run(...c.map((x) => r[x]), r.id); n += 1
      }
    }
    putLinks(jr.before.technician_services)
    db.exec('COMMIT')
    writeFileSync(JOURNAL,JSON.stringify({...jr,undoneAt:new Date().toISOString()}))
    console.log(`✅ 按流水逐条回滚 ${n} 处(${JOURNAL})`)
  } catch (e) { db.exec('ROLLBACK'); console.error('🔴 回滚失败:', e.message); process.exit(1) }
  process.exit(0)
}

if (MODE === 'write') {
  if(existsSync(JOURNAL)&&!JSON.parse(readFileSync(JOURNAL,'utf8')).undoneAt)throw new Error('已有未撤销流水；请先核对或选择新流水路径')
  const journal = { target:resolve(DB), at: new Date().toISOString(), before: {}, inserted: {} }
  for (const t of ALLOW) journal.before[t] = rowsOf(t)
  for(const t of [...UPSERT,'stores'])journal.inserted[t]=dump[t].filter(r=>!journal.before[t].some(b=>b.id===r.id)).map(r=>r.id)
  writeFileSync(JOURNAL,JSON.stringify(journal),{mode:0o600}) // 写前先保留恢复依据
  db.exec('BEGIN IMMEDIATE')
  try {
    clearLinks()
    let ins = 0, upd = 0, off = 0
    /* ① 门店:原地改字段,不动 id */
    for (const r of (dump.stores || [])) {
      const cols = Object.keys(r).filter((c) => c !== 'id' && c !== 'tenant_id')
      const n = db.prepare(`UPDATE stores SET ${cols.map((c) => `"${c}"=?`).join(',')} WHERE id = ?`).run(...cols.map((c) => r[c]), r.id).changes
      upd += n
      if (!n) { const c = Object.keys(r).filter(x=>x!=='tenant_id'); db.prepare(`INSERT INTO stores (tenant_id,${c.map((x) => `"${x}"`).join(',')}) VALUES (?,${c.map(() => '?').join(',')})`).run(r.tenant_id,...c.map((x) => r[x])); ins += 1 }
    }
    console.log(`  [门店] 原地改 ${upd} 行(id 不动,外键不断)`)
    /* ② 无人引用的三张:整租户换掉 */
    for (const t of SAFE_DELETE) {
      for (const tid of TENANTS) db.prepare(`DELETE FROM "${t}" WHERE tenant_id = ?`).run(tid)
      for (const r of (dump[t] || [])) {
        const c = Object.keys(r)
        db.prepare(`INSERT INTO "${t}" (${c.map((x) => `"${x}"`).join(',')}) VALUES (${c.map(() => '?').join(',')})`).run(...c.map((x) => r[x])); ins += 1
      }
      console.log(`  [换掉] ${t.padEnd(20)} ${String((dump[t] || []).length).padStart(3)} 行`)
    }
    /* ③ 被预约引用的两张:upsert;沙箱多出来的下架不删 */
    for (const t of UPSERT) {
      const want = dump[t] || []
      const wantIds = new Set(want.map((r) => r.id))
      const have = new Map(rowsOf(t).map((r) => [r.id, r]))
      for (const r of want) {
        const c = Object.keys(r)
        if (have.has(r.id)) {
          const cc = c.filter((x) => x !== 'id')
          db.prepare(`UPDATE "${t}" SET ${cc.map((x) => `"${x}"=?`).join(',')} WHERE id = ?`).run(...cc.map((x) => r[x]), r.id); upd += 1
        } else {
          db.prepare(`INSERT INTO "${t}" (${c.map((x) => `"${x}"`).join(',')}) VALUES (${c.map(() => '?').join(',')})`).run(...c.map((x) => r[x]))
          ;ins += 1
        }
      }
      for (const [id] of have) if (!wantIds.has(id)) { db.prepare(`UPDATE "${t}" SET is_active = 0 WHERE id = ?`).run(id); off += 1 }
      console.log(`  [upsert] ${t.padEnd(18)} 生产 ${String(want.length).padStart(3)} 行 · 沙箱多出来的下架 ${have.size - want.filter((r) => have.has(r.id)).length} 个`)
    }
    putLinks(dump.technician_services)
    db.exec('COMMIT')
    writeFileSync(JOURNAL, JSON.stringify(journal))
    console.log(`  插 ${ins} · 改 ${upd} · 下架 ${off} · 流水 → ${JOURNAL}`)
  } catch (e) { db.exec('ROLLBACK'); console.error('🔴 写失败,已回滚:', e.message); process.exit(1) }
}

/* ── 对账:逐表逐行与生产导出比,条数 + 每一行的关键字段(含金额)── */
let bad = 0
console.log('\n── 逐表对账(沙箱 vs 生产导出)──')
for (const t of ALLOW) {
  const want = dump[t] || []
  const got = rowsOf(t)
  /* services / technicians 沙箱还留着**下架的旧行**(被预约引用,不能删),
     所以这两张不比总条数,比「生产那些行在不在、对不对」;其余三张比总条数。 */
  const key=r=>t==='technician_services'?`${r.technician_id}:${r.service_id}`:t==='business_hours'?`${r.store_id}:${r.weekday}`:r.id
  const gotIds = new Set(got.map(key))
  const missing = want.filter((r) => !gotIds.has(key(r))).length
  const same = UPSERT.includes(t) ? missing === 0 : (want.length === got.length && missing === 0)
  const gotByKey=new Map(got.map(r=>[key(r),r]))
  const fieldDiff=want.filter(r=>!gotByKey.has(key(r))||Object.keys(r).some(k=>r[k]!==gotByKey.get(key(r))[k])).length
  if (!same||fieldDiff) bad += 1
  const extra = UPSERT.includes(t) ? `(沙箱另有 ${got.length - want.length} 行已下架的旧夹具)` : ''
  console.log(`  ${t.padEnd(20)} 生产 ${String(want.length).padStart(3)} · 沙箱 ${String(got.length).padStart(3)} · 缺 ${missing} ${same ? '✅' : '🔴'} ${extra}`)
}
/* 🔴 金额只在**生产那批 id 上**比 —— services/technicians 沙箱还留着已下架的旧夹具,
   把它们的钱加进合计再喊「对不上」,是比法的错,不是数据的错(头一版就这么红了 4 处)。 */
const byId = (rows) => new Map(rows.map((r) => [r.id, r]))
for (const [t, fields] of [['services', ['price_cents', 'deposit_cents', 'base_duration_min']], ['service_prices', ['price_cents']]]) {
  const want = dump[t] || []
  const gotAll = db.prepare(`SELECT * FROM "${t}" WHERE tenant_id IN (${TENANTS.map(() => '?').join(',')})`).all(...TENANTS)
  const g = byId(gotAll)
  for (const f of fields) {
    const a = want.reduce((x, r) => x + (Number(r[f]) || 0), 0)
    const b = want.reduce((x, r) => x + (Number((g.get(r.id) || {})[f]) || 0), 0)
    if (a !== b) bad += 1
    console.log(`  ${t}.${f.padEnd(18)} 生产 ${String(a).padStart(8)} · 沙箱同 id ${String(b).padStart(8)} ${a === b ? '✅' : '🔴'}`)
  }
  /* 逐行:生产每一条都要在,且每个字段逐一相同 */
  const diff = []
  for (const r of want) {
    const o = g.get(r.id)
    if (!o) { diff.push(`${r.id}(缺)`); continue }
    for (const k of Object.keys(r)) if (String(r[k] ?? '') !== String(o[k] ?? '')) { diff.push(`${r.id}.${k}`); break }
  }
  if (diff.length) bad += 1
  console.log(`  ${t} 逐行逐字段:${want.length} 条比完,不同 ${diff.length} ${diff.length ? '🔴 ' + diff.slice(0, 3).join(' ') : '✅'}`)
}
/* 🔴 真正该验的那条:沙箱多出来的旧夹具必须**全部下架**,否则顾客端还会看见它们 */
for (const t of UPSERT) {
  const wantIds = new Set((dump[t] || []).map((r) => r.id))
  const extras = db.prepare(`SELECT id, is_active FROM "${t}" WHERE tenant_id IN (${TENANTS.map(() => '?').join(',')})`).all(...TENANTS).filter((r) => !wantIds.has(r.id))
  const stillOn = extras.filter((r) => Number(r.is_active) === 1)
  if (stillOn.length) bad += 1
  console.log(`  ${t} 多出来的 ${extras.length} 行必须全下架:还亮着 ${stillOn.length} ${stillOn.length ? '🔴 ' + stillOn.slice(0, 3).map((r) => r.id).join(' ') : '✅'}`)
}
console.log(bad ? `\n❌ ${bad} 处对不上` : '\n✅ 逐表逐行对上(条数 + 金额)')
process.exit(bad ? 1 : 0)
