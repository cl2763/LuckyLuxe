/* 🔴 J-71(店主 07z §四)· **合同要守在它能被违反的最底那一层。**
 *
 * 裁 #103 的合同是「网页顾客端不是新顾客的入口」,而此前守它的判据是
 * **「网页上没有『注册 / 创建账号』入口」—— 界面层**。
 * D194 发生在 **API 层**:没有任何界面,一个 `POST /auth/google/demo` 就建出了人,
 * 不用登录、不用店号、生产口径照建,还能在 body 里指名别人家的店。
 * **同一条合同,判据只守了看得见的那一半。**
 *
 * 判别式:问一句「**绕过界面,这件事还能不能发生?**」能,就说明判据守错了层。
 * 这一套守的是低两层的那句:**全站不存在任何「无需认证即可写 users / user_identities 行」的路。**
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { census, violations, NO_AUTH_USER_WRITE_ALLOW } from '../../tools/user-write-census.mjs'
import { serverSources } from '../../tools/readset.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const serverSrc = readFileSync(join(ROOT, 'apps/api/local-server.mjs'), 'utf8')
const modSrc = serverSources(join(ROOT, 'apps/api'))
let n = 0
const fails = []
const check = (name, cond, detail = '') => {
  n += 1
  if (cond) console.log(`ok ${n} - ${name}`)
  else { console.log(`not ok ${n} - ${name} :: ${detail}`); fails.push(name) }
}

const rows = census(serverSrc, modSrc)
const bad = violations(rows)

/* ① 主断言:白名单式 —— 每条「写 users」的路,要么认证,要么在白名单里带理由 */
check(`① 🔴 全站「无认证 + 写 users/user_identities」现扫 **0 条**(现为 ${bad.length};白名单 ${NO_AUTH_USER_WRITE_ALLOW.length} 条,每条带可反驳理由)`,
  bad.length === 0, bad.map((r) => `${r.method} ${r.path}:${r.line} 写=${r.写users}`).join(' | '))
check(`②a 白名单每条都写了理由(没理由的白名单 = 把缺陷改名叫豁免)`,
  NO_AUTH_USER_WRITE_ALLOW.every((a) => String(a.理由 || '').length >= 30),
  JSON.stringify(NO_AUTH_USER_WRITE_ALLOW.filter((a) => String(a.理由 || '').length < 30)))
check(`②b 白名单棘轮 ≤ 5(现为 ${NO_AUTH_USER_WRITE_ALLOW.length};只减不增,再进新成员要店主点头)`,
  NO_AUTH_USER_WRITE_ALLOW.length <= 5)

/* ③ 覆盖面本身要有判据(判据三推论):扫描面缩水立刻红 */
check(`③ 扫描面:路由条数 ${rows.length} ≥ 240(路由搬走一批而这套照样绿,那才是最坏的情形)`, rows.length >= 240, String(rows.length))
const authRows = rows.filter((r) => r.path.startsWith('/auth/'))
check(`③b \`/auth/*\` 普查到 ${authRows.length} 条 ≥ 4`, authRows.length >= 4, authRows.map((r) => r.path).join(' '))

/* ④ 🔴 D194 专条:那条路**必须不存在**(裁 #107 是删路不是加门,所以判据也是「不存在」不是「被拒」)
   —— 裁 #104:守「不许存在」的合同,只许断言它不存在,不许再加一条「它存在时须合规」。 */
check('④ 🔴 `POST /auth/google/demo` **全站不存在**(裁 #107:删路不加门;裁 #104:只断言不存在)',
  !/path === '\/auth\/google\/demo'/.test(serverSrc), '还在 local-server.mjs 里')
check('④b `registerGoogleDemoUser()` 也不存在(留着函数 = 留着半条路)',
  !/function registerGoogleDemoUser/.test(serverSrc), '函数还在')

/* ⑤ 造病:加一条无认证写 users 的路 → ① 必须红(两面靶子,与扫描器共用同一个判定) */
const evil = "if (req.method === 'POST' && path === '/j71/evil') { db.prepare('INSERT INTO users (id) VALUES (?)').run(1) }"
check('⑤a 🔴 造病:塞一条无认证写 `users` 的路 → ① 必须咬中(不咬中说明这一套在空守)',
  violations(census(`${serverSrc}\n${evil}`, modSrc)).length === 1)
const good = "if (req.method === 'POST' && path === '/j71/ok') { const c = requireCustomer(req); db.prepare('INSERT INTO users (id) VALUES (?)').run(c) }"
check('⑤b 反向守:同一条路**先认人**就不许被咬中(否则这条判据会把正确写法一起判红)',
  violations(census(`${serverSrc}\n${good}`, modSrc)).length === 0)
const readOnly = "if (req.method === 'GET' && path === '/j71/read') { return json(res, 200, db.prepare('SELECT * FROM users').all()) }"
check('⑤c 反向守:只读 `users` 不算(这一套断的是**写**,不是读)',
  violations(census(`${serverSrc}\n${readOnly}`, modSrc)).length === 0)

/* ⑥ 第三栏:租户从哪来 —— D194 暴露的另一半(它让人在 body 里指名别人家的店) */
const bodyTenant = rows.filter((r) => r.租户 === '🔴 body' && r.写users !== '—')
check(`⑥ 「写 users 且租户取自 body」的路 ${bodyTenant.length} 条,逐条都在白名单里(新来的自动红)`,
  bodyTenant.every((r) => NO_AUTH_USER_WRITE_ALLOW.some((a) => a.method === r.method && a.path === r.path)),
  bodyTenant.map((r) => `${r.method} ${r.path}`).join(' | '))

console.log(`\n1..${n}`)
if (fails.length) { console.log(`\n🔴 ${fails.length} 条没过:`); for (const f of fails) console.log(`   - ${f}`); process.exitCode = 1 }
else console.log(`\n✅ 全过(${n} 条)`)
