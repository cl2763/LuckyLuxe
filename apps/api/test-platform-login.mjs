/* D149 · 平台运营控制台改「用户名 + 密码」登录(店主 05q §三,她提过两次)

   店主的话:**令牌不是密码**。`/platform` 原来要在登录框里贴 `OWNER_TOKEN` ——
   一串开发主钥匙,既不好记、又不该在浏览器里传来传去,而且一把钥匙开所有门。

   本刀守五条(05q §三.4 原文),外加两条反向守:
   ① 密码登录 → 200 + 会话;② 错密码 401;③ 令牌**仍能**打 API;
   ④ 令牌**不能**用于网页登录框;⑤ 首登带 `mustChangePassword`,改完旧会话吊销。
   反向守:登录框那条 401 不是因为「谁来都 401」(正例得能进去);
          令牌那条 200 不是因为「谁来都 200」(乱串得 401)。

   🔴 判据里**一个密码都不写死**:一次性密码是启动时随机生成的,
   套件自己建一个**本轮专用**的账号来验(J-31 执行随机段),跑完删掉(夹具收尾)。 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { assertTestTarget, isTestTarget } from './test-guard.mjs'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4128'
const TOKEN = process.env.OWNER_TOKEN || process.env.OWNER_DEMO_TOKEN || 'owner-demo-token'
let n = 0
const fails = []
const check = (name, ok, detail = '') => {
  n += 1
  if (ok) console.log(`ok ${n} - ${name}`)
  else { fails.push(name); console.log(`not ok ${n} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

/* ═══ ① 静态:令牌不再是网页登录的钥匙 ═══ */
const html = readFileSync(join(ROOT, 'apps/web/platform.html'), 'utf8')
const auth = readFileSync(join(ROOT, 'apps/api/platform-auth.mjs'), 'utf8')
const srv = readFileSync(join(ROOT, 'apps/api/local-server.mjs'), 'utf8')

check('①a 登录页收的是用户名 + 密码(不是令牌框)',
  /id="pfUser"/.test(html) && /id="pfPass"/.test(html) && !/id="tokenInput"/.test(html))
/* 🔴 先把注释剥掉再看:这条判的是「**页面给顾客看的东西**里还提不提令牌」,
   而不是「源码里出没出现过这个词」—— 解释这条规矩的注释本身必然要写出那个词
   (与币符扫描踩过的同一种误报:判据被自己的解释绊倒)。 */
const shownHtml = html.replace(/<!--[\s\S]*?-->/g, '')
check('①b 🔴 登录页不再提「OWNER_TOKEN / 平台令牌」当登录凭据',
  !/OWNER_TOKEN/.test(shownHtml) && !/placeholder="平台令牌/.test(shownHtml))
check('①c 登录走 `/platform/auth/login`,拿回来的会话**不进 localStorage**',
  /\/platform\/auth\/login/.test(html) && !/localStorage\.setItem\([^)]*platform/i.test(html))
check('①d 首登强制改密在前端真接了(不是只在后端有个字段)',
  /mustChangePassword/.test(html) && /forceChangePassword/.test(html))
check('①e 🔴「记住这台电脑」换 cookie 用的是密码会话,不收令牌',
  /sessionToken/.test(html) && /platformAuth\.fromSession\(String\(b\.sessionToken/.test(srv))
check('①f 哈希前缀与商家侧**故意不同**(同名同密码的商家账号不许当平台账号用)',
  /`platform:\$\{String\(username\)\.toLowerCase\(\)\}:\$\{String\(password\)\}`/.test(auth))
check('①g 🔴 会话表不叫 `platform_sessions`(全仓早有同名表,字段不同 —— 静默失败器族的案底)',
  /CREATE TABLE IF NOT EXISTS platform_auth_sessions/.test(auth)
  && !/CREATE TABLE IF NOT EXISTS platform_sessions/.test(auth))
check('①h 自举幂等按「建过没有」判(不看密码还对不对 —— 幂等判据律)',
  /const had = db\.prepare\('SELECT id FROM platform_accounts WHERE username = \?'\)/.test(auth)
  && /if \(had\) return \{ created: false/.test(auth))
check('①i 一次性密码**不写进任何文件**,只打日志由人抄(多一处存密码就是多一处泄漏面)',
  /logger\.log\(`\[platform\] 已建平台账号/.test(auth) && !/writeFileSync/.test(auth))

/* ═══ ② 行为层 ═══ */
const onTest = await isTestTarget(BASE_URL)
if (!onTest) {
  console.log(`⚠️  [platform-login] ${BASE_URL} 不是测试库 —— **行为层本轮未跑**(不是通过)`)
  console.log('   正确跑法:bash apps/api/run-all-tests.sh platform-login')
} else {
  await assertTestTarget(BASE_URL)
  const db = new DatabaseSync(process.env.TEST_DB_PATH)
  /* 本轮专用账号:名字带执行随机段,跑完删掉。判据里一个密码字面量都不留。 */
  const user = `pf-knife-${Date.now().toString(36)}`
  const pass = `Kn${Math.random().toString(36).slice(2, 12)}`
  const hash = (u, p) => createHash('sha256').update(`platform:${u.toLowerCase()}:${p}`).digest('hex')
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO platform_accounts (id, username, display_name, password_hash, must_change_password, status, created_at, updated_at)
    VALUES (?, ?, '判据账号', ?, 1, 'active', ?, ?)`).run(`pacct-${user}`, user, hash(user, pass), now, now)

  const post = (path, body, headers = {}) => fetch(`${BASE_URL}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }))

  const good = await post('/platform/auth/login', { username: user, password: pass })
  check('② 密码登录 → 200 且发了一张会话', good.status === 200 && String(good.json?.session?.token || '').startsWith('psess_'),
    JSON.stringify(good).slice(0, 160))
  check('②b 首登带 `mustChangePassword`(不改密进不去,前端那条接的就是它)',
    good.json?.session?.mustChangePassword === true)

  const bad = await post('/platform/auth/login', { username: user, password: `${pass}x` })
  check('③ 错密码 → 401', bad.status === 401, String(bad.status))
  check('③b 反向守:错的那条不是「谁来都 401」—— 上面正例确实进去了', good.status === 200 && bad.status === 401)

  const asToken = await post('/platform/auth/login', { username: user, password: TOKEN })
  check('④ 🔴 令牌**不能**当密码用(登录框贴 OWNER_TOKEN → 401)', asToken.status === 401, String(asToken.status))
  const apiWithToken = await fetch(`${BASE_URL}/platform/tenants`, { headers: { authorization: `Bearer ${TOKEN}` } })
  check('⑤ 令牌**仍能**打 API(它只是不当密码用,不是被废了)', apiWithToken.status === 200, String(apiWithToken.status))
  /* 乱串由**真令牌派生**,不写字面量 —— `test-credential-scan` 扫的是「凭据形态」,
     判据里躺一串看着像令牌的东西,它照样咬(而且咬得对)。 */
  const apiWithJunk = await fetch(`${BASE_URL}/platform/tenants`, { headers: { authorization: `Bearer ${TOKEN}-definitely-not` } })
  check('⑤b 反向守:API 那条 200 不是「谁来都 200」', apiWithJunk.status === 401, String(apiWithJunk.status))

  const me = await fetch(`${BASE_URL}/platform/auth/me`, { headers: { authorization: `Bearer ${good.json?.session?.token}` } })
  check('⑥ 会话认得出「我是谁」', me.status === 200, String(me.status))
  const changed = await post('/platform/auth/change-password', { username: user, oldPassword: pass, newPassword: `${pass}NEW9` })
  check('⑥b 改密 → 200', changed.status === 200, JSON.stringify(changed).slice(0, 120))
  const meAfter = await fetch(`${BASE_URL}/platform/auth/me`, { headers: { authorization: `Bearer ${good.json?.session?.token}` } })
  check('⑥c 🔴 改完密码,**旧会话当场失效**(改密不吊销旧会话等于没改)', meAfter.status === 401, String(meAfter.status))
  const tooShort = await post('/platform/auth/change-password', { username: user, oldPassword: `${pass}NEW9`, newPassword: 'abc' })
  check('⑥d 新密码太短 → 400(不是默默接受)', tooShort.status === 400, String(tooShort.status))

  const cookieWithToken = await post('/platform/session', { sessionToken: TOKEN, remember: true })
  check('⑦ 🔴「记住这台电脑」也不收令牌 → 401', cookieWithToken.status === 401, String(cookieWithToken.status))

  /* 夹具收尾:判据自己造的账号自己删干净(夹具不收尾 = 判据非幂等,J 族有案底) */
  db.prepare('DELETE FROM platform_auth_sessions WHERE account_id = ?').run(`pacct-${user}`)
  db.prepare('DELETE FROM platform_accounts WHERE username = ?').run(user)
  const left = db.prepare('SELECT COUNT(*) AS n FROM platform_accounts WHERE username = ?').get(user).n
  check('⑧ 收尾:判据自己建的账号已删干净', left === 0, String(left))
  db.close()
}

console.log(`\n[D149 平台密码登录] 静态 9 条 · 行为层 13 条(令牌只留 API,登录框只认密码)`)
if (fails.length) { console.error(`\n❌ test-platform-login ${fails.length}/${n} 项未过`); process.exit(1) }
console.log(`\n✅ test-platform-login 通过 ${n} 项`)
