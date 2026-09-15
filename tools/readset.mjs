/* 读写集分类器 —— **按判据读了什么给判据分类,不按它叫什么**
 *
 * 🔴 立此模块的案由(店主 07x §一 · **J-61 第三款**):
 *   上一版造病台把「仍绿」拆成「该咬 / 无关」时,依据是 `claimPat` —— **一个名字正则**。
 *   店主的定性:「名字是人写的,行为是代码干的。**按名字分类的台子,分出来的格子是文本的格子,
 *   不是事实的格子。**」
 *   `㋚8 定金守恒` 正好演了全套:**按名字它该咬**(名字里有「定金守恒」,而刀砍的是签字落库,
 *   听起来相关)· **按它读的表它无关**(`auditDepositConservation()` 一个字都不碰 `settlements`)。
 *   名字和事实给出的是**相反**的答案。
 *
 * 所以这里换一把尺子:
 *   **刀的写集** = 被砍那条语句写了哪几张表(`UPDATE x` / `INSERT INTO x` / `DELETE FROM x`)
 *   **判据的读集** = 这条断言那一段源码碰到的表 —— 两层:
 *     ① suite 源码里直接写的 SQL;
 *     ② suite 打的 HTTP 路径 → 解析到 `local-server.mjs` 里那条路由的 handler 体,
 *        再**跟进一层**它调用的本地函数(`auditDepositConservation()` 就在这一层)。
 *   **该咬 ⇔ 读集 ∩ 写集 ≠ ∅**。
 *
 * 🔴 取不到读集的,一律报 **说不清**,单列 ——
 *   店主 07w §一:「**不许为了让四格加得起来,把说不清的一律扫进「无关」**」。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/* ── 字符串/注释感知的括号匹配:从 openIdx(那个 `(`)走到配对的 `)` ── */
export function matchParen(src, openIdx) {
  let depth = 0, i = openIdx
  let q = ''          // 当前在哪种引号里('、"、`)
  let inLine = false, inBlock = false
  while (i < src.length) {
    const c = src[i], n = src[i + 1]
    if (inLine) { if (c === '\n') inLine = false; i++; continue }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++ } i++; continue }
    if (q) {
      if (c === '\\') { i += 2; continue }
      if (c === q) q = ''
      i++; continue
    }
    if (c === '/' && n === '/') { inLine = true; i += 2; continue }
    if (c === '/' && n === '*') { inBlock = true; i += 2; continue }
    if (c === "'" || c === '"' || c === '`') { q = c; i++; continue }
    if (c === '(') depth++
    else if (c === ')') { depth--; if (depth === 0) return i }
    i++
  }
  return -1
}

/* ── 找出 suite 里所有 `check(` 调用的 [start, end) ── */
export function checkCalls(src, fnName = 'check') {
  const out = []
  const re = new RegExp(`(^|[^\\w.])${fnName}\\s*\\(`, 'g')
  let m
  while ((m = re.exec(src))) {
    const open = src.indexOf('(', m.index + m[0].length - 1)
    const close = matchParen(src, open)
    if (close < 0) continue
    out.push({ start: m.index + (m[1] ? 1 : 0), end: close + 1 })
    re.lastIndex = close
  }
  return out
}

const SQL_TABLE = /\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)/gi
/* 路径字面量。**要认带 ${} 的模板**:
 * `${BASE}/admin/settlements/${id}/sign-token` 里真正的路由是
 * `/admin/settlements/<通配>/sign-token`,而服务端那条写的是
 * `path.startsWith('/admin/settlements/') && path.endsWith('/sign-token')`。
 * 🔴 案由:上一版的正则遇到 `${` 就断,只取到 `/admin/settlements/` —— 于是 ㋚7 的因果链
 *   报「解析不到 handler」。**取不到就说不清,而说不清多一条,能用的结论就少一条。** */
const LIT = /(['"`])((?:\\.|\$\{[^}]*\}|(?!\1)[^\\])*?)\1/gs

export function tablesIn(text) {
  const s = new Set()
  let m
  SQL_TABLE.lastIndex = 0
  while ((m = SQL_TABLE.exec(text))) s.add(m[1].toLowerCase())
  return s
}

export function pathsIn(text) {
  const s = new Set()
  let m
  LIT.lastIndex = 0
  while ((m = LIT.exec(text))) {
    const raw = m[2].replace(/\$\{[^}]*\}/g, '\u0001')   // 插值先换成哨兵
    const i = raw.indexOf('/')
    if (i < 0) continue
    let p = raw.slice(i).split(/[?#\s]/)[0]
    p = p.split('\u0001').join('*').replace(/\*+/g, '*')
    if (!/^\/(admin|my|auth|settlements|bookings|payments|customers|stores|health|platform|staff)\b/.test(p)) continue
    p = p.replace(/\/+$/, '')
    if (p.length > 1) s.add(p)
  }
  return s
}


/* ── 把一条路径解析到 server 源码里那个 handler 体 ──
 *  路由长相:`if (req.method === 'GET' && path === '/admin/x') {` 或 `path.startsWith('/admin/bookings/')`
 *  取到的 handler 体再**跟进一层**本地函数调用。 */
export function handlerBody(serverSrc, p) {
  const cands = []
  if (!p.includes('*')) {
    for (const q of ["path === '" + p + "'", 'path === "' + p + '"']) {
      const i = serverSrc.indexOf(q)
      if (i >= 0) cands.push(i)
    }
  }
  if (!cands.length) {
    /* 带通配的:`*` 前那一段当 head、`*` 后那一段当 tail,去找 startsWith/endsWith 那一对。 */
    const star = p.indexOf('*')
    const head = star >= 0 ? p.slice(0, star) : p + '/'
    const tail = star >= 0 ? p.slice(p.lastIndexOf('*') + 1) : ''
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = tail
      ? new RegExp("path\\.startsWith\\(['\"]" + esc(head) + "['\"]\\)[^\\n]*?endsWith\\(['\"]" + esc(tail) + "['\"]\\)")
      : new RegExp("path\\.startsWith\\(['\"]" + esc(head) + "['\"]\\)")
    const m = re.exec(serverSrc)
    if (m) cands.push(m.index)
  }
  if (!cands.length) return null
  const at = cands[0]
  return braceBody(serverSrc, at)
}

/* 从 fromIdx 往后找第一个 `{`,花括号配对取整块(字符串/注释感知)。
 * 🔴 立此函数的案由:上一版 `followOneLevel` 用的是**定长 4,000 字符窗口** ——
 *   它会越过函数结尾漏进隔壁函数,把隔壁读的表算进来。
 *   `readset --probe` 当场咬红:`/admin/finance/deposit-conservation` 的读集里
 *   混进了 `settlements / technicians / bookings` 三张它根本不碰的表。
 *   **判据也是代码,也会坏** —— 所以这一版用真配对,不用窗口。 */
export function braceBody(src, fromIdx) {
  const brace = src.indexOf('{', fromIdx)
  if (brace < 0) return null
  let depth = 0, i = brace, q = '', inLine = false, inBlock = false
  while (i < src.length) {
    const c = src[i], n = src[i + 1]
    if (inLine) { if (c === '\n') inLine = false; i++; continue }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++ } i++; continue }
    if (q) { if (c === '\\') { i += 2; continue } if (c === q) q = ''; i++; continue }
    if (c === '/' && n === '/') { inLine = true; i += 2; continue }
    if (c === '/' && n === '*') { inBlock = true; i += 2; continue }
    if (c === "'" || c === '"' || c === '`') { q = c; i++; continue }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return src.slice(brace, i + 1) }
    i++
  }
  return null
}

/* 跟进一层:handler 体里调用的本地 function,把它们的函数体也算进读集 */
export function followOneLevel(serverSrc, body) {
  const called = new Set()
  let m
  const CALL = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g
  while ((m = CALL.exec(body))) called.add(m[1])
  let extra = ''
  const names = []
  for (const fn of called) {
    const def = new RegExp(`function\\s+${fn}\\s*\\(`).exec(serverSrc)
    if (!def) continue
    const body2 = braceBody(serverSrc, def.index)
    if (!body2) continue
    extra += body2
    names.push(fn)
  }
  return { extra, names }
}

/* ── 对外主函数:给一段判据源码算读集 ── */
export function readSetOf(blockSrc, serverSrc) {
  const why = []
  const tables = new Set()
  for (const t of tablesIn(blockSrc)) { tables.add(t); why.push(`suite 里直接 SQL:${t}`) }
  const paths = [...pathsIn(blockSrc)]
  const unresolved = []
  for (const p of paths) {
    const body = handlerBody(serverSrc, p)
    if (!body) { unresolved.push(p); continue }
    const own = tablesIn(body)
    for (const t of own) tables.add(t)
    const { extra, names } = followOneLevel(serverSrc, body)
    const deep = tablesIn(extra)
    for (const t of deep) tables.add(t)
    why.push(`${p} → handler 读 {${[...own].join(',') || '—'}}`
      + (names.length ? ` · 跟进一层 ${names.slice(0, 4).join('/')}{${[...deep].slice(0, 8).join(',')}}` : ''))
  }
  const known = tables.size > 0 || (paths.length > 0 && unresolved.length === 0)
  return { tables, paths, unresolved, why, known }
}

/* 🔴 被测源码不止 `local-server.mjs` 一个文件。
 *  案由(现测):`㋚5 积分真的跟过去了` 走 `/my/points-history`,而那条 handler 里的
 *  `pointsEarnRows()` 住在 **`points-ledger.mjs`**(代码结构公约:边改边拆搬出去的)。
 *  只读单文件 → 跟进一层跟了个空 → 读集缺 `settlements` → 因果链被误判成「撞上的」。
 *  **判据自己漏了一层,报出来的结论就是反的。**(J-56 尺子漏层结论连坐)
 *  所以:把 `apps/api` 下**全部非测试 .mjs** 拼起来当被测源码。
 *  方向上是保守的 —— 读集只会变大,结论只会更容易落进「该咬」那一格(J-66 第三款:
 *  未归类的余数按最坏那一格计)。 */
export function serverSources(apiDir) {
  const names = readdirSync(apiDir).filter((f) => f.endsWith('.mjs') && !f.startsWith('test-'))
  return names.map((f) => readFileSync(join(apiDir, f), 'utf8')).join('\n/* ── 文件边界 ── */\n')
}

export function writeSetOf(cutText) {
  const s = new Set()
  let m
  const W = /\b(?:UPDATE|INSERT\s+INTO|INSERT\s+OR\s+\w+\s+INTO|DELETE\s+FROM)\s+([a-z_][a-z0-9_]*)/gi
  while ((m = W.exec(cutText))) s.add(m[1].toLowerCase())
  return s
}

/* ── 自证:两面靶子(J-58 第六款)── */
if (process.argv[1] && process.argv[1].endsWith('readset.mjs') && process.argv.includes('--probe')) {
  const serverSrc = serverSources(new URL('../apps/api/', import.meta.url).pathname)
  const cases = [
    { 名: '直接 SQL 读 settlements', 块: "one('SELECT status FROM settlements WHERE code = ?', c)", 该含: 'settlements', 该中: true },
    /* 🔴 J-55 更正(07x 现测):07w §一 我写的是「`auditDepositConservation()` **一个字都不碰
     *   `settlements`**」—— **这句话是错的**。`local-server.mjs:7567` 那行明明白白:
     *   `SELECT code FROM settlements WHERE id = ?`。
     *   它是被**这个模块自己**咬出来的:probe 第一轮就报「含 settlements=true(该 false)」。
     *   我当时写的可反驳条件是「指出它其实读了 settlements,这条判定立刻推翻」——**现在被推翻了**。
     *   所以这条靶子的正确期望是 **该中**;它同时证明「跟进一层」那一层真的在跟。 */
    { 名: '走 /admin/finance/deposit-conservation(跟进一层进 auditDepositConservation)', 块: "await fetch(`${BASE}/admin/finance/deposit-conservation`)", 该含: 'settlements', 该中: true },
    /* 这条靶子专门守「带 ${} 的模板路径认不认得出」—— ㋚7 的因果链就卡在这里 */
    { 名: '模板路径 /admin/settlements/${id}/sign-token(㋚7 那条)', 块: 'await fetch(`${BASE}/admin/settlements/${sheetId}/sign-token`)', 该含: 'settlements', 该中: true },
    { 名: '走 /my/coupons', 块: "await fetch(`${BASE}/my/coupons`)", 该含: 'settlements', 该中: false },
    { 名: '名字里写着 settlements 但不读它(形似而非)', 块: "check('结算单相关:定金守恒 settlements 三个字在名字里', ok)", 该含: 'settlements', 该中: false },
  ]
  let bad = 0
  console.log('— readset probe(两面靶子:该含 / 形似而非)—')
  for (const c of cases) {
    const rs = readSetOf(c.块, serverSrc)
    const hit = rs.tables.has(c.该含)
    const ok = hit === c.该中
    if (!ok) bad++
    console.log(`  ${ok ? '✅' : '🔴'} ${c.名} · 含 ${c.该含}=${hit}(该 ${c.该中})· 读集 {${[...rs.tables].slice(0, 8).join(',')}}`)
  }
  const should = cases.filter((c) => c.该中).length
  const shouldNot = cases.length - should
  console.log(`  该中 ${should} 个 · 不该中 ${shouldNot} 个 · 判错 ${bad} 个`)
  if (!should || !shouldNot) { console.log('  🔴 **J-58⑥:靶子只有一面,这把尺子的数不许用**'); process.exit(1) }
  console.log(bad ? '  🔴 分不开' : '  ✅ 分得开(两面都现测出数)')
  process.exit(bad ? 1 : 0)
}
