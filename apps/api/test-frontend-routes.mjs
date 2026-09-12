#!/usr/bin/env node
/* 「**前端调的每一个接口,后端必须真的有**」(店主 07g/夜10 段一②,2026-09-12)
 *
 * ══ 案由 ══
 * D190 现查:网页顾客端画着「使用 Google 登录」,点下去打 `/auth/google/start` ——
 * **这条路由后端从来没有过**(后端只有 `/auth/google/demo`)。
 * 一个按钮在界面上站了不知道多久,点下去是 404,而**没有任何判据看这件事**。
 *
 * ══ 方向是单向的 ══
 * **只许「后端有、前端没调」,不许「前端调了、后端没有」。**
 * 后端多几条路由是正常的(小程序在用、将来要用、内部工具在用);
 * 前端调一条不存在的,那就是一个点不动的按钮 —— **有入口但点不动才丢人**。
 *
 * ══ 判法(白名单式,判据三)══
 * 前端侧:`apps/web/*.js` 与 `miniprogram/**` 里所有**请求路径字面量**;
 * 后端侧:`apps/api/*.mjs` 里所有 `path === '…'` / `path.startsWith('…')` / 路由表里的路径。
 * 逐条对;对不上的**必须落进具名白名单并写理由**(J-51),否则红并报出 `文件:行号`。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
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

const walk = (rel, re) => {
  const out = []
  const rec = (d) => {
    for (const e of readdirSync(join(ROOT, d), { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const p = `${d}/${e.name}`
      if (e.isDirectory()) rec(p)
      else if (re.test(e.name)) out.push(p)
    }
  }
  rec(rel)
  return out
}

/* ── 后端有哪些路径 ── */
const apiFiles = readdirSync(join(ROOT, 'apps/api')).filter((b) => b.endsWith('.mjs') && !/^(test-|run-)/.test(b)).map((b) => `apps/api/${b}`)
const backend = new Set()
for (const f of apiFiles) {
  const src = readFileSync(join(ROOT, f), 'utf8')
  for (const m of src.matchAll(/path === '([^']+)'/g)) backend.add(m[1])
  for (const m of src.matchAll(/path\.startsWith\('([^']+)'\)/g)) backend.add(`${m[1]}*`)
  /* 路由表/注册器那种写法也收:`'/admin/x': handler` 与 `route('/x'` */
  for (const m of src.matchAll(/route\(\s*'([^']+)'/g)) backend.add(m[1])
  /* 🔴 还有一族:**正则注册的路由**,例
       if (req.method === 'POST' && /^\/my\/bookings\/[^/]+\/after-sales\/withdraw$/.test(path))
     头一版不认它,于是 `/my/bookings/` 被报成「后端没有」——**误报**。
     误报的害处不只是噪音:白名单会被误报塞满,**真的那几条反而被淹掉**(判据三的老教训)。
     改法:取正则里**第一个特殊符号之前的字面前缀**当作前缀路由。 */
  for (const m of src.matchAll(/\/\^(\\\/[^\s]*?)\$?\/\s*\.test\(path\)/g)) {
    const lit = m[1].replace(/\\\//g, '/').split(/[[(+*?{]/)[0].replace(/\$$/, '')
    if (lit.startsWith('/') && lit.length > 1) backend.add(`${lit}*`)
  }
}
const prefixes = [...backend].filter((p) => p.endsWith('*')).map((p) => p.slice(0, -1))
const backendHas = (p) => backend.has(p) || prefixes.some((pre) => p.startsWith(pre))

/* ── 前端调了哪些路径 ──
   只收**以 / 开头的字面量**(拼出来的动态路径这把刀判不了,单独计数并如实报)。 */
const webFiles = walk('apps/web', /\.js$/)
const mpFiles = walk('miniprogram', /\.js$/)
/* 🔴 头一版只认**单引号**字面量 —— 于是**店主点名的那条恰恰漏了**:
   `apps/web/customer.js:986` 写的是 request(反引号 /auth/google/start?redirectTo=…),
   路径前缀是字面量、后面才拼参数,而它整条落进了「拼出来判不了」那一筐。
   判据漏掉的偏偏是立它的那个案例 —— 那就是废判据。
   改法:模板串也收,**取到第一个 ${ 或 ? 为止的那段字面前缀**(那一段就是路由)。 */
const CALL = /(?:request|api|req|get|post|put|del|patch)\w*\(\s*'(\/[A-Za-z0-9_\-/.]*)'/g
const CALL_TPL = /(?:request|api|req|get|post|put|del|patch)\w*\(\s*`(\/[A-Za-z0-9_\-/.]*)(?:[?`]|\$\{)/g
const calls = []
let dynamic = 0
for (const f of [...webFiles, ...mpFiles]) {
  const lines = readFileSync(join(ROOT, f), 'utf8').split('\n')
  lines.forEach((ln, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(ln)) return
    for (const m of ln.matchAll(CALL)) calls.push({ file: f, line: i + 1, path: m[1] })
    for (const m of ln.matchAll(CALL_TPL)) { if (m[1] && m[1] !== '/') calls.push({ file: f, line: i + 1, path: m[1], tpl: 1 }) }
    /* 「拼出来判不了」只留**前缀也不是字面量**的那种(例:request(反引号 ${base}/x)) */
    if (/(?:request|api)\w*\(\s*`\$\{/.test(ln)) dynamic += 1
  })
}

/* 具名白名单:key = `路径`,value = 理由(随码复核)。**只许变短**(J-51)。 */
const ALLOW = {
  '/': '不是接口:前端拿它当「回首页」的路径,不是请求',
}
const ALLOW_CAP = 1

const uniq = [...new Map(calls.map((c) => [c.path, c])).values()]
const missing = uniq.filter((c) => !backendHas(c.path) && !ALLOW[c.path])

check(`① 单向对齐:前端 ${webFiles.length + mpFiles.length} 个 js 里扫到请求路径字面量 ${calls.length} 处`
  + `(去重 ${uniq.length} 条),后端 ${backend.size} 条路径 —— **前端调了后端没有的:0 条**`,
missing.length === 0, missing.map((c) => `${c.file}:${c.line} ${c.path}`).join(' | '))

check(`② 白名单只许变短:${Object.keys(ALLOW).length} 条 <= ${ALLOW_CAP},每条有理由`,
  Object.keys(ALLOW).length <= ALLOW_CAP && Object.values(ALLOW).every((v) => String(v).length > 8), '')

/* ③ 自守(零命中先证刀能咬):造一条不存在的路径,必须被咬到 */
const canary = [{ file: 'canary.js', line: 1, path: '/auth/google/start' }]
  .filter((c) => !backendHas(c.path) && !ALLOW[c.path])
check('③ 自守:拿 D190 那条真病 `/auth/google/start` 当已知阳性 —— 后端确实没有它,必须被认出来',
  canary.length === 1, JSON.stringify(canary))
/* ③b 自守第二层:它在真文件里写的是**模板串**,刀必须从模板串里也认得出来
   (头一版只认单引号,恰恰漏了立这条判据的那个案例)。 */
const tplProbe = []
for (const m of "  const d = await request(`/auth/google/start?redirectTo=${x}`, { method: 'POST' })".matchAll(CALL_TPL)) tplProbe.push(m[1])
check('③b 自守:**模板串**写法里的路径前缀必须认得出来 —— 立这条判据的那一行就是模板串',
  tplProbe.length === 1 && tplProbe[0] === '/auth/google/start', JSON.stringify(tplProbe))

/* ④ 反向守:后端真有的那条 `/auth/google/demo` 不许被误报 */
check('④ 反向守:后端真有的 `/auth/google/demo` 不许被算成「缺」(否则白名单会被误报塞满)',
  backendHas('/auth/google/demo'), '')

/* ⑤ 覆盖面反向守:扫描面不许缩水 */
check(`⑤ 反向守:扫描面 前端 ${webFiles.length + mpFiles.length} 个 js >= 60 · 后端 ${backend.size} 条 >= 150`,
  (webFiles.length + mpFiles.length) >= 60 && backend.size >= 150, '')

console.log(`\n[底数闭合] 前端 js ${webFiles.length + mpFiles.length} 个 · 路径字面量 ${calls.length} 处 · 去重 ${uniq.length} 条`
  + ` · 拼出来判不了的 ${dynamic} 处(如实报)· 后端路径 ${backend.size} 条 · 对不上 ${missing.length} 条`)
if (fails.length) { console.error(`\n❌ test-frontend-routes ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-frontend-routes 通过 ${checks} 项`)
