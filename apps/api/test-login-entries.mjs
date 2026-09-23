#!/usr/bin/env node
/* 「**界面上有按钮,那条路就必须走得通**」(店主 07g/夜10 段一③,2026-09-12)
 *
 * ══ 案由(D190)══
 * 网页顾客端登录区画着三个入口,而**生产口径下一个都走不通**:
 *   · 邮箱注册 / 邮箱登录 → 后端有这条路由,但 `DEMO_LOGIN_ALLOWED=false` 时 **403 DEMO_LOGIN_DISABLED**
 *   · 使用 Google 登录 → `/auth/google/start` **后端从来没有过**(只有 /auth/google/demo)
 *   · 微信登录 → 网页端**根本没画这个按钮**
 * 结果:10 个私有页在生产上顾客一个都进不去。
 * 而所有判据都**站在一扇生产上不存在的门后面**测 —— 所以一直是绿的。
 *
 * ══ 店主定的口径(写进代码,不只写进回执)══
 *   **没有入口不丢人,有入口但点不动才丢人。**
 *
 * ══ 判法 ══
 * ① 从 `customer.js` 的登录区渲染函数里**枚举可点入口**(带 data-auth-action / id 的按钮);
 * ② 每个入口映射到它真正会打的后端路径;
 * ③ 那条路径必须 **(a) 后端真有** 且 **(b) 不被 `DEMO_LOGIN_ALLOWED` 挡住**。
 * 入口为 0 时这一条**自然通过** —— 那正是「没有入口不丢人」。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

const web = readFileSync(join(ROOT, 'apps/web/customer.js'), 'utf8')
const api = readFileSync(join(ROOT, 'apps/api/local-server.mjs'), 'utf8')

/* ── 登录区那一段:从 authTemplate/renderAuth 那个模板串里取 ── */
/* 🔴 锚点换过一次,记下来:头一版锚在 `data-auth-action` 上 ——
   而段三把那两个按钮撤掉之后,这个字符串**不存在了**,取到 0 字符,
   整条判据当场变成空转(它会"通过",因为一个入口都没枚举到)。
   是 ④ 那条反向守把它咬出来的 —— **锚要锚在不会随这次改动消失的东西上**(J-45 同族)。
   现在锚在渲染登录区那一句 `els.authView.innerHTML =` 上:入口有几个都在它下面。 */
const authBlock = (() => {
  const i = web.indexOf('els.authView.innerHTML =')
  if (i < 0) return ''
  const end = web.indexOf('\n}', i)
  return web.slice(i, end > 0 ? end : i + 3000)
})()

/* 可点入口 → 它会打哪条后端路径。**新入口没登记在这里 = 红**(白名单式) */
const ENTRY_ROUTES = {
  'data-auth-action="register"': '/auth/email/register',
  'data-auth-action="login"': '/auth/email/login',
  'id="googleRegister"': '/auth/google/start',
}
/* 不算登录入口的可点件(具名豁免 + 理由,只许变短) */
const NOT_ENTRY = {
  'id="continueGuest"': '不是登录入口:它把人放进**公开页**(店铺/作品/价目),不拿 token、不进私有页',
}
const NOT_ENTRY_CAP = 1

const present = Object.keys(ENTRY_ROUTES).filter((k) => authBlock.includes(k))
/* 后端有没有这条路径(与 test-frontend-routes 同一口径:精确 + 前缀 + 正则前缀) */
const backend = new Set()
for (const m of api.matchAll(/path === '([^']+)'/g)) backend.add(m[1])
const pre = [...api.matchAll(/path\.startsWith\('([^']+)'\)/g)].map((m) => m[1])
const backendHas = (p) => backend.has(p) || pre.some((x) => p.startsWith(x))
/* 这条路径会不会被演示门挡住:在它的处理块里找 `if (!DEMO_LOGIN_ALLOWED)` */
const gatedByDemo = (p) => {
  const i = api.indexOf(`path === '${p}'`)
  if (i < 0) return false
  return /!DEMO_LOGIN_ALLOWED/.test(api.slice(i, i + 1200))
}

const broken = present.map((k) => {
  const p = ENTRY_ROUTES[k]
  if (!backendHas(p)) return `${k} → ${p} :: 后端没有这条路由`
  if (gatedByDemo(p)) return `${k} → ${p} :: 演示门关掉时 403 DEMO_LOGIN_DISABLED`
  return ''
}).filter(Boolean)

check(`① 登录区现有可点入口 ${present.length} 个,每个都要在**演示门关掉**那一档走得通到「拿到 token」`
  + '(口径:**没有入口不丢人,有入口但点不动才丢人**;入口为 0 时这条自然通过)',
broken.length === 0, broken.join(' | '))

check(`② 豁免只许变短:${Object.keys(NOT_ENTRY).length} 条 <= ${NOT_ENTRY_CAP},每条写明为什么不算登录入口`,
  Object.keys(NOT_ENTRY).length <= NOT_ENTRY_CAP && Object.values(NOT_ENTRY).every((v) => String(v).length > 10), '')

/* ③ 自守:把两个死按钮当已知阳性 —— 刀必须认得出它们坏在哪一种 */
const probe = ['data-auth-action="login"', 'id="googleRegister"'].map((k) => {
  const p = ENTRY_ROUTES[k]
  return !backendHas(p) ? 'no-route' : (gatedByDemo(p) ? 'demo-gated' : 'ok')
})
check('③ 自守:两个死按钮各自的坏法必须被分得出来 —— 邮箱那条是**演示门挡住**,Google 那条是**后端压根没有**',
  probe[0] === 'demo-gated' && probe[1] === 'no-route', JSON.stringify(probe))

/* ④ 反向守:登录区那一段真的取到了(取空了这条就是空转) */
check(`④ 反向守:登录区那一段取到了 ${authBlock.length} 字符(>=200);取空了这条判据就是空转`,
  authBlock.length >= 200, `${authBlock.length}`)

/* ══ ⑤ 商家端登录页:同一条法的另一侧(店主 12m §一-4)══
 *
 * D190 守的是**顾客端**;商家端 `admin.html` 的「Register Owner」按钮是同一个病的另一侧:
 * 后端 local-server.mjs 那条 `/admin/auth/register` 在 DEMO_LOGIN_ALLOWED=false 时 403,
 * 而按钮在生产登录页照样亮着 —— 商家点下去必然失败。
 * J-112 第二款:挡了后端一层不算,**前端这一侧也要收**,两侧各写一条。
 *
 * 判的是**可见性条件**,不是「按钮存不存在」—— 沙箱 demo 模式下它仍该在。 */
const adminJs = readFileSync(join(ROOT, 'apps/web/admin.js'), 'utf8')
const adminHtml = readFileSync(join(ROOT, 'apps/web/admin.html'), 'utf8')

check('⑤a 反向守:admin.html 里确实还有这个按钮(按钮没了这条就是空转)',
  /id="ownerRegisterButton"/.test(adminHtml), '')

const visLine = (adminJs.match(/els\.ownerRegisterButton\.classList\.toggle\([^\n]*\)/) || [''])[0]
check('⑤b 可见性只取到一处(多处各写一套 = 迟早有一处漏改)',
  (adminJs.match(/els\.ownerRegisterButton\.classList\.toggle/g) || []).length === 1, visLine)
check('⑤c 可见性条件里必须带上「注册是否开放」,不能只看角色',
  /registrationAllowed/.test(visLine), visLine || '(取不到那一行)')
check('⑤d 三态 fail-closed:写成 `!== true`,null(还没问到)与 false 都藏',
  /registrationAllowed\s*!==\s*true/.test(visLine), visLine)

const probeFn = (() => {
  const i = adminJs.indexOf('async function probeRegistrationAllowed')
  if (i < 0) return ''
  const j = adminJs.indexOf('\n}', i)
  return adminJs.slice(i, j > 0 ? j : i + 1200)
})()
check(`⑤e 反向守:探测函数取到了 ${probeFn.length} 字符(取空了后面三条全是空转)`,
  probeFn.length >= 200, String(probeFn.length))
check('⑤f 探测读的是 /health 的 demoLoginAllowed(后端 10587 现有出口,不新开一个)',
  /'\/health'/.test(probeFn) && /demoLoginAllowed/.test(probeFn), probeFn.slice(0, 80))
check('⑤g 探测失败不许静默放行:catch 里把状态留在 null(静默失败器族)',
  /catch[\s\S]*registrationAllowed\s*=\s*null/.test(probeFn), '')
check('⑤h 后端那一侧仍在挡(两侧各一条,J-112 第二款)',
  /DEMO_LOGIN_ALLOWED\)\s*throw apiError\(403[^\n]*注册已停用/.test(api), '')

console.log(`\n[底数闭合] 登记的登录入口 ${Object.keys(ENTRY_ROUTES).length} 个 · 现存 ${present.length} 个`
  + ` · 走不通 ${broken.length} 个 · 具名豁免(不算入口)${Object.keys(NOT_ENTRY).length} 个`)
if (fails.length) { console.error(`\n❌ test-login-entries ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-login-entries 通过 ${checks} 项`)
