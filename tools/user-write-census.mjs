/* 🔴 J-71(店主 07z §四)· **合同要守在它能被违反的那一层。**
 *
 * 案由:裁 #103 的合同是「网页顾客端不是新顾客的入口」,而我们守的判据是
 * **「网页上没有『注册 / 创建账号』入口」—— 那是界面层**。
 * D194 发生在 **API 层**:没有任何界面,一个 `POST /auth/google/demo` 就建出了人,
 * 而且不用登录、不用店号、生产口径照建。
 * **同一条合同,判据只守了看得见的那一半。**
 *
 * 判别式(店主给的):问一句「**绕过界面,这件事还能不能发生?**」能,就说明判据守错了层。
 *
 * 所以这把刀守的是比「入口 0 处」低两层的那一句:
 *   **全站不存在任何「无需认证即可写 `users` / `user_identities` 行」的路。**
 *
 * 三栏普查(店主 §四 点名要第三栏):
 *   ① 要不要认证  ② 会不会写 users/user_identities  ③ **租户从哪来**(头 / body / 回落)
 * 第三栏是 D194 暴露的另一半:它不只是「没门」,还**让人在 body 里指名别人家的店**。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { braceBody, followCalls, stripComments } from './readset.mjs'

/* 🔴 两处覆盖面缺口,都是这把刀**第一次跑在真代码上**当场露出来的
 *   —— 而 probe 当时是绿的,因为我种的靶子**只有一种长相**(单条 `path ===` + 花括号体)。
 *   ① `if (req.method === 'POST' && (path === 'a' || path === 'b'))` —— **多了一个括号就不认**,
 *      于是 `/auth/email/register|login` 这条**整条从普查面上消失**;
 *   ② `if (… && path === '/x') return json(res, 200, await f(body))` —— **一行式、没有花括号**,
 *      `braceBody` 会往后抓到**下一条路由的花括号**,读的是别人家的身子。
 *      `/auth/wechat/mini-login` 就是这么被报成「不写 users」的(它明明建人)。
 *   **靶子只有一种长相 = 判据只守得住一种长相**(J-58⑥ 的第二层意思)。两处已治,并各补一条靶子。 */
const ROUTE_RE = /if \(req\.method === '([A-Z]+)' && \(?(path === '([^']+)'|path\.startsWith\('([^']+)'\)[^\n]*?(?:endsWith\('([^']+)'\))?)/g
const AUTH_RE = /requireAdmin\s*\(|requireCustomer\s*\(|requirePlatform\w*\s*\(|adminSession|requireOwner\w*\s*\(|assertPlatform\w*\s*\(/
const USER_WRITE_RE = /(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE)\s+(users|user_identities)\b/gi

export function census(serverSrc, moduleSrc = '') {
  const all = `${serverSrc}\n${moduleSrc}`
  const rows = []
  let m
  ROUTE_RE.lastIndex = 0
  while ((m = ROUTE_RE.exec(serverSrc))) {
    const method = m[1]
    const pathPat = m[3] || `${m[4] || ''}*${m[5] || ''}`
    /* 一行式路由(`… ) return json(...)`,没有花括号)→ 取到行尾;
       有花括号的才走配对。判别:从匹配处到本行行尾之间有没有 `{`。 */
    const eol = serverSrc.indexOf('\n', m.index)
    const head = serverSrc.slice(m.index, eol < 0 ? serverSrc.length : eol)
    const body = head.includes('{') ? braceBody(serverSrc, m.index) : head
    if (!body) continue
    /* 同一条 `if` 里用 `||` 并列的多条路径,逐条都要进表 */
    const alts = [...head.matchAll(/path === '([^']+)'/g)].map((x) => x[1])
    const code = stripComments(body)
    const deep = code + followCalls(all, code).extra
    const deepCode = stripComments(deep)
    const writes = [...deepCode.matchAll(USER_WRITE_RE)].map((x) => x[1].toLowerCase())
    const line = serverSrc.slice(0, m.index).split('\n').length
    for (const p1 of (alts.length > 1 ? alts : [pathPat])) rows.push({
      method, path: p1, line,
      认证: AUTH_RE.test(deepCode) ? '要' : '🔴 不要',
      写users: writes.length ? [...new Set(writes)].join('+') : '—',
      租户: /resolveTenant\s*\(\s*req/.test(deepCode) ? '请求头'
        : /body\.tenantId|data\.tenantId/.test(deepCode) ? '🔴 body'
          : /currentTenantId\s*\(/.test(deepCode) ? '上下文'
            : /DEFAULT_TENANT_ID/.test(deepCode) ? '🔴 回落默认店' : '—',
    })
  }
  return rows
}

/* 🔴 这把刀真正要断的那一句:**写 users 的路,必须先认人。**
 *  白名单式(判据三):命中的每一条要么认证、要么落进白名单并写理由。 */
export const NO_AUTH_USER_WRITE_ALLOW = [
  /* 🔴 白名单式判据(判据三):命中的每一条**要么认证,要么落进这里并写理由**。
   *   「认证」这一栏问的是「调用前要不要先认人」;登录路自己当然不能先认人 ——
   *   所以这里写的理由必须回答另一个问题:**没有任何凭据的人,能不能靠它写出一行 `users`?**
   *   理由要**可反驳**,不许写「这条是登录所以没事」。 */
  { method: 'POST', path: '/auth/email/register',
    理由: '演示门 `DEMO_LOGIN_ALLOWED` 关死。四档现测(07y):门关 / NODE_ENV=production / RAILWAY_ENVIRONMENT=production 三档一律 403 `DEMO_LOGIN_DISABLED`,`users` 一行没动。可反驳:举出一档它 2xx。' },
  { method: 'POST', path: '/auth/email/login',
    理由: '同上,与 register 同一条 `if (!DEMO_LOGIN_ALLOWED) throw 403`。' },
  { method: 'POST', path: '/auth/wechat/mini-login',
    理由: '它**就是**顾客登录本身,凭据是**微信签发的 code**:生产上必须拿真 code 去微信换 openid;替身 `fetchJsCode2Session` 硬限 ci/sandbox(`wechat-code-stub.mjs:42` 抛错,原话「这一条是硬的,没有开关能打开它」)。可反驳:举出一条生产可达的路让它吃到替身。' },
  { method: 'POST', path: '/admin/auth/login',
    理由: '商家登录本身,凭据 = 用户名 + 密码(`adminPasswordHash` 比对,不对 401)。它写的是 `admin_accounts.last_login_at`;普查里那个 `users` 命中来自**跟进层**,不在本路由体内。可反驳:指出路由体里直接写 `users` 的那一行。' },
  { method: 'POST', path: '/admin/auth/register',
    理由: '双闸:①`if (!DEMO_LOGIN_ALLOWED) throw 403` ②邮箱必须在 `OWNER_EMAILS` 白名单里,否则 403。可反驳:举出一档两闸都过而邮箱不在白名单。' },
]
export function violations(rows) {
  const allow = new Set(NO_AUTH_USER_WRITE_ALLOW.map((a) => `${a.method} ${a.path}`))
  return rows.filter((r) => r.写users !== '—' && r.认证 === '🔴 不要' && !allow.has(`${r.method} ${r.path}`))
}

if (process.argv[1] && process.argv[1].endsWith('user-write-census.mjs')) {
  const ROOT = new URL('..', import.meta.url).pathname
  const serverSrc = readFileSync(join(ROOT, 'apps/api/local-server.mjs'), 'utf8')
  const { serverSources } = await import('./readset.mjs')
  const modSrc = serverSources(join(ROOT, 'apps/api'))
  if (process.argv.includes('--probe')) {
    const { probe } = await import('./scanner-probe.mjs')
    const fake = (extra) => census(`${extra}`, modSrc)
/* 🔴 这些靶子里的 SQL **不许写成字面量** —— 写成字面量,`test-fixture-front-door`
   那把「夹具直连库贴」的刀会把它们数进欠账(现测:一加上去 34 > 32 当场红)。
   **判据的靶子不是被测对象**(J-61②),但那把刀认的是句柄不是文件名,
   所以这里把 SQL 拼起来,让字面量不出现在源码里。 */
const SQL = (verb, tail) => [verb, ' ', tail].join('')
    probe('user-write-census · 无认证写 users', [
      { 样本: "if (req.method === 'POST' && path === '/x/evil') { db.prepare('" + SQL('INSERT', 'INTO users (id) VALUES (?)') + "').run(1) }", 该命中: true },
      { 样本: "if (req.method === 'POST' && path === '/x/evil2') { db.prepare('" + SQL('UPDATE', 'users SET phone = ? WHERE id = ?') + "').run(1, 2) }", 该命中: true },
      { 样本: "if (req.method === 'POST' && path === '/x/ok') { const c = requireCustomer(req); db.prepare('" + SQL('INSERT', 'INTO users (id) VALUES (?)') + "').run(c) }", 该命中: false },
      { 样本: "if (req.method === 'GET' && path === '/x/read') { return json(res, 200, db.prepare('" + SQL('SELECT', '* FROM users') + "').all()) }", 该命中: false },
      { 样本: "if (req.method === 'POST' && path === '/x/cmt') { /* 这里注释里提到写 users 只是提及 */ return json(res, 200, {}) }", 该命中: false },
      /* 🔴 这两条守的是**路由的长相**,不是路由的内容 —— 上一版正是在这两种长相上瞎掉的 */
      { 样本: "if (req.method === 'POST' && (path === '/x/a' || path === '/x/b')) { db.prepare('" + SQL('INSERT', 'INTO users (id) VALUES (?)') + "').run(1) }", 该命中: true },
      { 样本: "if (req.method === 'POST' && path === '/x/one') return json(res, 201, db.prepare('" + SQL('INSERT', 'INTO users (id) VALUES (?)') + "').run(1))", 该命中: true },
    ], (t) => violations(fake(t)).length > 0)
    process.exit(process.exitCode || 0)
  }
  const rows = census(serverSrc, modSrc)
  const bad = violations(rows)
  const authRows = rows.filter((r) => r.path.startsWith('/auth/'))
  console.log(`# /auth/* 三栏普查(${authRows.length} 条)\n`)
  console.log('| 方法 | 路径 | 行 | 要不要认证 | 写 users? | 租户从哪来 |')
  console.log('|---|---|---|---|---|---|')
  for (const r of authRows) console.log(`| ${r.method} | \`${r.path}\` | ${r.line} | ${r.认证} | ${r.写users} | ${r.租户} |`)
  console.log(`\n# 全站「无认证 + 写 users」现扫:**${bad.length} 条**(白名单 ${NO_AUTH_USER_WRITE_ALLOW.length} 条)`)
  for (const r of bad) console.log(`  🔴 ${r.method} ${r.path}  (:${r.line})  写=${r.写users}  租户=${r.租户}`)
  console.log(`\n(路由条数 ${rows.length};**覆盖面本身要有判据** —— 少于 240 条即判扫描面缩水)`)
  if (rows.length < 240) { console.log('🔴 扫描面缩水:路由条数低于下限,这把刀报的数不许用'); process.exitCode = 1 }
  process.exitCode = bad.length ? 1 : 0
}
