/* D194 非 0 预案 · 只读补三样(店主 08a §四:created_at 分布 · 有没有消费/预约/余额 · 落哪几个租户)
   🔴 一行都不动。全部 SELECT。 */
const { DatabaseSync } = require('node:sqlite')
const { statSync } = require('node:fs')
const DB = process.argv[2] || ''
if (!DB) { console.error('🔴 拒绝执行:没有显式指定目标库(J-64)'); process.exit(2) }
const st = statSync(DB)
console.log(`══ 库:${DB} · ${st.size} 字节 · mtime ${new Date(st.mtimeMs).toISOString()} · inode ${st.ino}`)
const db = new DatabaseSync(DB, { readOnly: true })
const has = (t) => db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(t).n > 0
const cols = (t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name))
const q = (s, ...a) => db.prepare(s).all(...a)
const IDS = q("SELECT id FROM users WHERE google_id IS NOT NULL AND google_id != ''").map((r) => r.id)
const IN = IDS.map(() => '?').join(',')
console.log(`\n对象:${IDS.length} 行`)

console.log('\n── 甲 · 落在哪几个租户')
console.log('   ' + JSON.stringify(q("SELECT tenant_id, COUNT(*) n FROM users WHERE google_id IS NOT NULL AND google_id != '' GROUP BY tenant_id")))

console.log('\n── 乙 · 身份行的时刻分布(users 表没有时间列,时刻只能从 user_identities 取)')
console.log('   ' + JSON.stringify(q(`SELECT provider, created_at, COUNT(*) n FROM user_identities WHERE user_id IN (${IN}) GROUP BY provider, created_at ORDER BY created_at`, ...IDS)))

console.log('\n── 丙 · 有没有消费 / 预约 / 余额 / 券(逐表数;表不在就说表不在)')
for (const [t, col] of [['bookings','user_id'], ['settlements','user_id'], ['finance_transactions','user_id'],
                        ['stored_value_transactions','user_id'], ['coupon_grants','user_id'],
                        ['member_timecards','user_id'], ['payments','user_id'], ['deposit_receipts','user_id']]) {
  if (!has(t)) { console.log(`   ${t}: 表不在`); continue }
  if (!cols(t).has(col)) { console.log(`   ${t}: 没有 ${col} 列`); continue }
  const n = db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE ${col} IN (${IN})`).get(...IDS).n
  console.log(`   ${t}: ${n} 行${n ? '  🔴' : ''}`)
}

console.log('\n── 丁 · 这 7 行的 display_name / email 形态(判是不是我们自己的压测)')
console.log('   ' + JSON.stringify(q(`SELECT display_name, substr(email,1,12)||'…' AS email_head, google_id IS NOT NULL AS g FROM users WHERE id IN (${IN})`, ...IDS)))

console.log('\n── 戊 · 对照:同库里 wechat 用户与全部用户的时刻跨度(看这 7 行是不是孤立于某一天)')
console.log('   ' + JSON.stringify(q("SELECT MIN(created_at) AS first, MAX(created_at) AS last, COUNT(*) n FROM user_identities")))
