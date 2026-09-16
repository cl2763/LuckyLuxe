/* 09a 执行单 #1 · 两件补报 —— **只读,一行不许动**
 *   ① 第二个指纹:有 `user_identities` 行、而 `users` 那头没有 openid 的 —— 行数 + 与那 7 行 id 逐一对
 *   ② 那 7 行的 `tenant_id` 分布 + `lucky-luxe` 那几个数重算(37 / 28 要不要改)
 * 三条批准条件(J-75):同构库跑通 · 每列先探存在 · 每问带底数行。
 */
const { DatabaseSync } = require('node:sqlite')
const { statSync } = require('node:fs')
const DB = process.argv[2] || ''
if (!DB) { console.error('🔴 拒绝执行:没有显式指定目标库(J-64)'); process.exit(2) }
const st = statSync(DB)
console.log(`══ 库:${DB} · ${st.size} 字节 · mtime ${new Date(st.mtimeMs).toISOString()} · inode ${st.ino}`)
const db = new DatabaseSync(DB, { readOnly: true })
const cols = (t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name))
const q = (s, ...a) => db.prepare(s).all(...a)
const uc = cols('users')
console.log(`   [schema] users 列:${[...uc].join(', ')}`)

const SEVEN = q("SELECT id, tenant_id FROM users WHERE google_id IS NOT NULL AND google_id != '' ORDER BY id")
console.log(`\n── 指纹一(google_id 非空):${SEVEN.length} 行`)

console.log('\n── ② 那几行的 tenant_id 分布')
console.log('   ' + JSON.stringify(q("SELECT tenant_id, COUNT(*) n FROM users WHERE google_id IS NOT NULL AND google_id != '' GROUP BY tenant_id")))

console.log('\n── ① 第二个指纹:有 user_identities 行、而 users 那头没有 openid')
const second = q(`SELECT DISTINCT u.id, u.tenant_id
  FROM users u JOIN user_identities i ON i.user_id = u.id
  WHERE u.wechat_open_id IS NULL ORDER BY u.id`)
console.log(`   行数:${second.length}`)
const setA = new Set(SEVEN.map((r) => r.id))
const setB = new Set(second.map((r) => r.id))
const both = [...setA].filter((x) => setB.has(x))
console.log(`   与指纹一对得上:${both.length} / ${SEVEN.length}`)
console.log(`   只在指纹一里(有 google_id 但没有 user_identities 行,或有 openid):${[...setA].filter((x) => !setB.has(x)).length}`)
console.log(`   只在指纹二里(没 openid 但也没 google_id —— 那是别的来路):${[...setB].filter((x) => !setA.has(x)).length}`)
console.log('\n   —— 指纹二收窄成「provider=google 的身份行」再对一次(那条路写的正是 google 身份行)')
const second2 = q(`SELECT DISTINCT u.id FROM users u JOIN user_identities i ON i.user_id = u.id
  WHERE i.provider = 'google' ORDER BY u.id`)
const setC = new Set(second2.map((r) => r.id))
console.log(`   provider=google 的身份行覆盖 ${setC.size} 个人 · 与指纹一对得上 ${[...setA].filter((x) => setC.has(x)).length} / ${SEVEN.length}`)
console.log(`   只在指纹二(google 身份行)里:${[...setC].filter((x) => !setA.has(x)).length}`)

console.log('\n── ③ lucky-luxe 那几个数重算(底数一并出,J-58①)')
const rows = q(`SELECT
    COUNT(*) 全库,
    SUM(CASE WHEN tenant_id = 'lucky-luxe' THEN 1 ELSE 0 END) lucky_luxe,
    SUM(CASE WHEN tenant_id = 'lucky-luxe' AND google_id IS NOT NULL AND google_id != '' THEN 1 ELSE 0 END) lucky_luxe_压测行,
    ${uc.has('phone') ? "SUM(CASE WHEN tenant_id = 'lucky-luxe' AND (phone IS NULL OR phone = '') THEN 1 ELSE 0 END)" : '-1'} lucky_luxe_没手机号,
    ${uc.has('phone') ? "SUM(CASE WHEN tenant_id = 'lucky-luxe' AND (phone IS NULL OR phone = '') AND (google_id IS NULL OR google_id = '') THEN 1 ELSE 0 END)" : '-1'} lucky_luxe_没手机号_剔掉压测行
  FROM users`)
console.log('   ' + JSON.stringify(rows[0]))
console.log('\n══ 跑完:全部 SELECT,一行没动 ══')
