/* D194 痕迹查询 · **只读**(店主 08a §四 裁 #108 批准的四条 SELECT,一字不改)
 *
 * 🔴 停线(店主 08a §十三):**查出非 0 → 立刻停,只报不动,不许删任何行。**
 *   动了之后,「别人打的」和「我们清理的」就再也分不开(J-72 同族:这张表说不清了)。
 *
 * 指纹为什么唯一(先证再查,J-58①):生产部署那份代码(`origin/main` 285b20d)里
 *   写 `users.google_id` 的**只有一处** —— `:6085`,在 `registerGoogleDemoUser` 里;
 *   写 `provider='google'` 身份行的只有 `:6081/:6086`(同一个函数)与 `:17657` 的回填迁移
 *   (而回填是**从 `users.google_id` 派生**的)。
 *   ⇒ **`google_id` 非空的行,只可能出自 `POST /auth/google/demo` 那条路。**
 *
 * 三条硬条件(同 `prod-readonly-five.cjs`,少一个不跑):
 *   ① `readOnly: true` 显式传;② 目标库显式给,无默认值(J-64);③ 先打印绝对路径 + 大小 + mtime。
 */
const { DatabaseSync } = require('node:sqlite')
const { statSync } = require('node:fs')

const DB = process.argv[2] || ''
if (!DB) { console.error('🔴 拒绝执行:没有显式指定目标库(J-64)'); process.exit(2) }
let st
try { st = statSync(DB) } catch (e) { console.error(`🔴 打不开:${DB} —— ${e.message}`); process.exit(2) }
console.log('══ 读的是哪个库(J-64:读也要认库)══')
console.log(`   绝对路径:${DB}`)
console.log(`   大小:${st.size} 字节 · mtime:${new Date(st.mtimeMs).toISOString()} · inode:${st.ino}`)

let db
try { db = new DatabaseSync(DB, { readOnly: true }) }
catch (e) { console.error(`🔴 只读打不开 —— 停,不去掉只读标志、不改 journal 模式、不建任何文件:${e.message}`); process.exit(2) }
console.log('   只读标志:readOnly=true(显式传,不靠默认)\n')

const q = (sql) => db.prepare(sql).all()

console.log('── ① 有没有被打过(这条路唯一会写出的形态)')
const one = q("SELECT COUNT(*) AS n FROM users WHERE google_id IS NOT NULL AND google_id != ''")
console.log('   ' + JSON.stringify(one[0]))

console.log('\n── ② 底数:0 是「没有」还是「没扫到」靠它分(J-58①)')
const two = q(`SELECT COUNT(*) AS users_total,
       SUM(CASE WHEN google_id IS NOT NULL AND google_id != '' THEN 1 ELSE 0 END) AS has_google,
       SUM(CASE WHEN wechat_open_id IS NOT NULL THEN 1 ELSE 0 END) AS has_wechat
FROM users`)
console.log('   ' + JSON.stringify(two[0]))

/* 🔴 **我提交给店主批的那条 ③ 用了 `users.created_at` —— 那个列不存在。**
 *   本机库自测当场报 `no such column: created_at`;
 *   `origin/main`(生产跑的那份)的 `CREATE TABLE users` 里也没有任何时间列。
 *   **批下来的查询原文是跑不动的,错在我提交的时候没先在本机库试一次。**
 *   改法:时间从 `user_identities.created_at` 取(那条路每建一个人必写一行身份),
 *   并且**逐列先探存在**,生产 schema 与本机不同也不会炸。 */
const cols = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name))
const hasTenant = cols.has('tenant_id')
console.log(`   [schema] users 列:${[...cols].join(', ')}`)
console.log(`   [schema] tenant_id ${hasTenant ? '在' : '🔴 不在(这一栏报不了)'}`)

console.log('\n── ③ 逐行看形态(刻意不取姓名 / 完整邮箱 / 电话;时间改从 user_identities 取)')
const three = q(`SELECT u.id${hasTenant ? ', u.tenant_id' : ''},
       substr(u.email, 1, 3) || '***' AS email_head,
       CASE WHEN u.phone IS NULL THEN 1 ELSE 0 END AS no_phone,
       CASE WHEN u.wechat_open_id IS NULL THEN 1 ELSE 0 END AS no_wechat,
       (SELECT MIN(created_at) FROM user_identities i WHERE i.user_id = u.id) AS first_identity_at
FROM users u
WHERE u.google_id IS NOT NULL AND u.google_id != ''
ORDER BY first_identity_at`)
console.log(`   ${three.length} 行`)
for (const r of three) console.log('   ' + JSON.stringify(r))

console.log('\n── ④ 对应的身份行')
const four = q(`SELECT provider, COUNT(*) AS n FROM user_identities
WHERE user_id IN (SELECT id FROM users WHERE google_id IS NOT NULL AND google_id != '')
GROUP BY provider`)
console.log(`   ${four.length} 组`)
for (const r of four) console.log('   ' + JSON.stringify(r))

const hit = Number(one[0].n || 0)
const base = Number(two[0].users_total || 0)
console.log('\n══ 结论 ══')
if (base === 0) console.log('   🔴 **底数也是 0 —— 这不是「没有」,是「没扫到」。库读错了或表是空的,结论作废。**')
else if (hit === 0) console.log(`   ✅ **没有被打过**:google_id 非空 0 行 / users 底数 ${base} 行(底数非 0,所以这个 0 是量出来的)`)
else console.log(`   🔴🔴 **已经被打过:${hit} 行**(底数 ${base})—— **停在这里,一行都不动**(店主 08a §十三)`)
