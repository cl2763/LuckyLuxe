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

/* 取一个名字的**定义体**。两种长相都要认:
 *   ① `function NAME (…) { … }`           → 花括号配对
 *   ② `const NAME = (…) => …`             → **箭头常量,没有花括号**
 * 🔴 案由(现测):`pointsEarnRows` 是 `points-ledger.mjs` 里
 *   `const pointsEarnRows = (userId, tenantId) => db.prepare(`SELECT … FROM settlements st …`)`
 *   —— 上一版只认 ①,于是跟进一层又跟了个空,`㋚5` 的因果链仍被误判成「撞上的」。
 *   **一次漏层修不干净,就还会以同样的形状再来一遍。** */
export function defBodyOf(src, name) {
  /* 🔴 **同名定义可能不止一处** —— 拿第一处就会踩转发壳:
   *   `local-server.mjs` 里 `const pointsEarnRows = (u,t) => pointsLedger.pointsEarnRows(u,t)`(壳),
   *   `points-ledger.mjs` 里 `const pointsEarnRows = (userId, tenantId) => db.prepare(\`… FROM settlements …\`)`(真身)。
   *   只取第一处 = 只拿到壳,读集永远缺那张表。**所以全取,拼起来。**(封顶 4 处,防同名泛滥) */
  const bodies = []
  const reF = new RegExp(`function\\s+${name}\\s*\\(`, 'g')
  let m
  while ((m = reF.exec(src)) && bodies.length < 4) { const b = braceBody(src, m.index); if (b) bodies.push(b) }
  const reC = new RegExp(`(?:const|let|var)\\s+${name}\\s*=`, 'g')
  while ((m = reC.exec(src)) && bodies.length < 4) bodies.push(src.slice(m.index, exprEnd(src, m.index)))
  return bodies.length ? bodies.join('\n') : null
}


/* 从 fromIdx 起,走到**表达式语句结束**:深度归零处的换行(字符串/模板/注释感知)。
 * 这比「定长窗口」准 —— 窗口会漏进隔壁定义,那正是本模块 probe 第一轮咬出来的毛病。 */
export function exprEnd(src, fromIdx) {
  let i = fromIdx, depth = 0, q = '', inLine = false, inBlock = false
  while (i < src.length) {
    const ch = src[i], n = src[i + 1]
    if (inLine) { if (ch === '\n') { inLine = false; if (depth <= 0 && i > fromIdx + 8) return i } i++; continue }
    if (inBlock) { if (ch === '*' && n === '/') { inBlock = false; i++ } i++; continue }
    if (q) { if (ch === '\\') { i += 2; continue } if (ch === q) q = ''; i++; continue }
    if (ch === '/' && n === '/') { inLine = true; i += 2; continue }
    if (ch === '/' && n === '*') { inBlock = true; i += 2; continue }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; i++; continue }
    if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) depth--
    else if (ch === '\n' && depth <= 0 && i > fromIdx + 8) return i
    i++
  }
  return src.length
}

/* 跟进被调用的本地定义 —— **一层,外加一条「转发壳」例外**。
 *
 * 🔴 两轮现测把边界钉死了(都是 `readset --probe` 自己咬出来的):
 *   ① **只跟一层不够**:`/my/points-history` 调 `pointsEarnRows()`,而 `local-server.mjs` 里
 *      那个只是转发壳 `const pointsEarnRows = (u, t) => pointsLedger.pointsEarnRows(u, t)`,
 *      真正读 `settlements` 的实现在 `points-ledger.mjs` 的第二层。
 *   ② **无脑跟两层更糟**:深度 2 一开,`/my/coupons` 的读集从 2 张涨到 8 张、
 *      `/my/points-history` 涨到 **36 张**(几乎是全库 schema)——
 *      **一把「什么都咬」的尺子,正面靶子照样全过**,而它报的分类全是废数。
 *      这正是 J-58 第六款要的那一面:**没有反面靶子,这个毛病看不出来。**
 *
 * 所以规则收成一条:**跟一层;那一层若是「转发壳」(自身零 SQL 且短),再多跟一层。**
 * 转发壳没有自己的读集,跟进它不会放大;有 SQL 的函数就此打住,不再向下蔓延。 */
export function followCalls(serverSrc, body) {
  const seen = new Set()
  const names = []
  let extra = ''
  /* 🔴 `.map(` / `.all(` / `.split(` **不是本地函数调用** —— 上一版没排除点号,
   *   于是 `map` / `all` 被拿去全仓找同名 `const`,找到的是别人家的 `db.prepare(...)`,
   *   读集当场从 1 张涨到 **36 张**(几乎全库 schema)。
   *   同样是「尺子什么都咬」那个毛病的第三种长相 —— 还是反面靶子咬出来的。
   *   例外:**转发壳**那一层允许带点号(`pointsLedger.pointsEarnRows(u, t)` 就是这样),
   *   壳体极短,放行的面很窄。 */
  const callsIn = (txt, allowMethod = false) => {
    const out = []
    const CALL = /(^|[^\w.$])([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g
    const ANY = /([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g
    const re = allowMethod ? ANY : CALL
    let m
    re.lastIndex = 0
    while ((m = re.exec(txt))) { const fn = allowMethod ? m[1] : m[2]; if (!SKIP_CALLS.has(fn)) out.push(fn) }
    return out
  }
  for (const fn of callsIn(body)) {
    if (seen.has(fn)) continue
    seen.add(fn)
    const def = defBodyOf(serverSrc, fn)
    if (!def) continue
    extra += def
    names.push(fn)
    /* 转发壳例外:自己一张表都不读,而且短 —— 那它的读集在下一层 */
    if (tablesIn(def).size === 0 && def.length < 220) {
      for (const fn2 of callsIn(def, true)) {
        if (seen.has(fn2)) continue
        seen.add(fn2)
        const def2 = defBodyOf(serverSrc, fn2)
        if (def2) extra += def2
      }
    }
  }
  return { extra, names }
}
const SKIP_CALLS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'typeof',
  'String', 'Number', 'Boolean', 'Array', 'Object', 'JSON', 'Math', 'Date', 'Set', 'Map', 'Promise',
  'json', 'require', 'import', 'console', 'parseInt', 'parseFloat', 'await'])



/* ── 对外主函数:给一段判据源码算读集 ── */
/* 🔴 **注释不是行为。** 抽读集前先把注释剥掉 ——
 *  `test-customer-paths.mjs` 的文件头注释里列着 `POST /payments/…`、`settlements` 这些字,
 *  而第一条断言(`前置:实例起得来`)那一段正好从文件头开始 ——
 *  于是一条「服务起没起来」的判据被算成读了 `settlements`,判进「该咬没咬」。
 *  **按注释里的字给判据分类,和按名字给判据分类是同一个毛病**(J-61③)。 */
export function stripComments(src) {
  let out = '', i = 0, q = '', inLine = false, inBlock = false
  while (i < src.length) {
    const c = src[i], n = src[i + 1]
    if (inLine) { if (c === '\n') { inLine = false; out += c } i++; continue }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i += 2; continue } i++; continue }
    if (q) { out += c; if (c === '\\') { out += src[i + 1] || ''; i += 2; continue } if (c === q) q = ''; i++; continue }
    if (c === '/' && n === '/') { inLine = true; i += 2; continue }
    if (c === '/' && n === '*') { inBlock = true; i += 2; continue }
    if (c === "'" || c === '"' || c === '`') { q = c }
    out += c; i++
  }
  return out
}

export function readSetOf(blockSrc, serverSrc) {
  blockSrc = stripComments(blockSrc)
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
    const { extra, names } = followCalls(serverSrc, body)
    const deep = tablesIn(extra)
    for (const t of deep) tables.add(t)
    why.push(`${p} → handler 读 {${[...own].join(',') || '—'}}`
      + (names.length ? ` · 跟进 ${names.slice(0, 4).join('/')}{${[...deep].slice(0, 8).join(',')}}` : ''))
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
/* ══ 裁 #106(店主 07y §四)· 列级读写集 —— **表级做底数,列级只许往保守那边移** ══
 *
 * 款文五条,这里落三条机械的:
 *   ① **表级是底数**:表相交先进「该咬」候选池(保守、不会漏);
 *   ② **列级是说明**:只有在列级现查出「列不相交」时,才许把一条移出候选池,
 *      且**必须点名是哪张表的哪两列**(案底 `㋚8`:读 `settlements.code` / 写 `settlements.status`);
 *   ③ 🔴 **方向锁死**:列级只许把一条从「该咬没咬」移到「无关」,**不许反向**。
 *      理由:列级分析本身会漏(`SELECT *`、动态列名、ORM 生成),
 *      锁死方向后,它的漏只会让结果**更保守**,不会让结果**更好看**(J-68)。
 *   ④ 读不出列的(`SELECT *` / 动态列名 / 跟进不到底)→ 一律 **说不清**,按该咬对待(J-66③)。
 */
const STAR = '*'

/** 某段文本里,对表 T 读了哪些列。取不到 / 有 `SELECT *` → 回 `'*'`(说不清)。 */
export function readColumnsOf(text, table) {
  const src = stripComments(String(text))
  const cols = new Set()
  let sawAny = false
  const re = new RegExp(`SELECT\\s+([\\s\\S]{1,400}?)\\s+FROM\\s+${table}\\b`, 'gi')
  let m
  while ((m = re.exec(src))) {
    sawAny = true
    const list = m[1]
    if (/\*/.test(list)) return STAR
    for (const piece of list.split(',')) {
      const c = piece.trim().replace(/^[a-z_]+\./i, '').split(/\s+AS\s+|\s+/i)[0]
      if (/^[a-z_][a-z0-9_]*$/i.test(c)) cols.add(c.toLowerCase())
    }
  }
  /* WHERE / ON 里点名的列也是读 */
  const reW = new RegExp(`FROM\\s+${table}\\b([\\s\\S]{0,300})`, 'gi')
  while ((m = reW.exec(src))) {
    for (const w of m[1].matchAll(/\b(?:WHERE|AND|OR|ON)\s+(?:[a-z_]+\.)?([a-z_][a-z0-9_]*)\s*(?:=|<|>|IN|IS|LIKE)/gi)) cols.add(w[1].toLowerCase())
  }
  if (!sawAny) return STAR
  return cols
}

/** 被砍那条语句对表 T 写了哪些列。取不到 → `'*'`。 */
export function writeColumnsOf(cutText, table) {
  const src = String(cutText)
  const m = new RegExp(`UPDATE\\s+${table}\\s+SET\\s+([\\s\\S]{1,400}?)(?:\\s+WHERE\\b|$)`, 'i').exec(src)
  if (m) {
    const cols = new Set()
    for (const piece of m[1].split(',')) {
      const c = piece.trim().split(/\s*=/)[0].replace(/^[a-z_]+\./i, '')
      if (/^[a-z_][a-z0-9_]*$/i.test(c)) cols.add(c.toLowerCase())
    }
    return cols.size ? cols : STAR
  }
  const ins = new RegExp(`INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+${table}\\s*\\(([^)]{1,400})\\)`, 'i').exec(src)
  if (ins) {
    const cols = new Set(ins[1].split(',').map((x) => x.trim().toLowerCase()).filter((x) => /^[a-z_][a-z0-9_]*$/.test(x)))
    return cols.size ? cols : STAR
  }
  return STAR   // DELETE / 动态列名 / 认不出 → 说不清
}

/** 裁 #106 主函数:表级已判「该咬」的一条,列级能不能把它移出去。
 *  回 { move: true, why } 才许移;其余一律留在最坏那格。 */
export function columnVerdict({ blockSrc, serverSrc, cutText, table }) {
  const rd = readColumnsOf(`${blockSrc}\n${serverSrc}`, table)
  const wr = writeColumnsOf(cutText, table)
  if (rd === STAR) return { move: false, why: `列级读不出(\`SELECT *\`/动态列名/跟进不到底)—— 按 J-66③ 留在该咬` }
  if (wr === STAR) return { move: false, why: '列级写不出(DELETE/动态列名)—— 留在该咬' }
  const inter = [...rd].filter((c) => wr.has(c))
  if (inter.length) return { move: false, why: `列相交 {${inter.join(',')}} —— 确是该咬` }
  return { move: true,
    why: `读 \`${table}.{${[...rd].slice(0, 6).join(',')}}\` / 写 \`${table}.{${[...wr].slice(0, 6).join(',')}}\` —— **表相交、列不相交**` }
}

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
    /* 这条守「转发壳」:handler 调的 pointsEarnRows 在 local-server 里只是个壳,
       真身在 points-ledger.mjs。壳穿不过去 → ㋚5 的因果链被误判成「撞上的」 */
    { 名: '转发壳 /my/points-history → points-ledger.pointsEarnRows', 块: 'await fetch(`${BASE}/my/points-history`)', 该含: 'settlements', 该中: true },
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
  /* 裁 #106 列级:两面靶子 —— 「表相交列不相交」该移出;「列也相交」不许移出;「读不出列」不许移出 */
  const CUT = "db.prepare(\"UPDATE settlements SET status = 'signed', signed_at = ? WHERE id = ?\")"
  const colCases = [
    { 名: '读 code / 写 status —— 表相交列不相交', 体: "db.prepare('SELECT code FROM settlements WHERE id = ?')", 该移: true },
    { 名: '读 status / 写 status —— 列也相交', 体: "db.prepare('SELECT status FROM settlements WHERE id = ?')", 该移: false },
    { 名: 'SELECT * —— 列读不出,按 J-66③ 留最坏那格', 体: "db.prepare('SELECT * FROM settlements WHERE id = ?')", 该移: false },
    { 名: '压根没有 SQL —— 读不出,留最坏那格', 体: 'await fetch(`${BASE}/x`)', 该移: false },
  ]
  let colBad = 0
  console.log('— 裁#106 列级 probe(两面靶子)—')
  for (const c of colCases) {
    const v = columnVerdict({ blockSrc: c.体, serverSrc: '', cutText: CUT, table: 'settlements' })
    const ok = v.move === c.该移
    if (!ok) colBad += 1
    console.log(`  ${ok ? '✅' : '🔴'} ${c.名} · 移出=${v.move}(该 ${c.该移})· ${v.why}`)
  }
  const colShould = colCases.filter((c) => c.该移).length
  console.log(`  该中 ${colShould} 个 · 不该中 ${colCases.length - colShould} 个 · 判错 ${colBad} 个`)
  if (!colShould || colShould === colCases.length) { console.log('  🔴 **靶子只有一面**(J-58⑥)'); process.exit(1) }
  if (colBad) { console.log('  🔴 列级分不开'); process.exit(1) }
  console.log('  ✅ 列级分得开')
  const should = cases.filter((c) => c.该中).length
  const shouldNot = cases.length - should
  console.log(`  该中 ${should} 个 · 不该中 ${shouldNot} 个 · 判错 ${bad} 个`)
  if (!should || !shouldNot) { console.log('  🔴 **J-58⑥:靶子只有一面,这把尺子的数不许用**'); process.exit(1) }
  console.log(bad ? '  🔴 分不开' : '  ✅ 分得开(两面都现测出数)')
  process.exit(bad ? 1 : 0)
}

