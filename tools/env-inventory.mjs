/* 环境变量清单 —— **从代码里量,不碰 Railway**(店主 09f)
 *
 * 分工写死(边界令②):**Code 量「代码要什么」,店主核「Railway 上有什么」,两边对。**
 * 🔴 本刀**只报名字与它的判定依据,永远不读、不打印、不拷贝任何值**(09f 停线)。
 *
 * ── 为什么要这把刀 ──
 * 此前给店主的清单是**从台账里抄的名字**。两天内已经因为「抄来的不是量出来的」记过两笔
 * (批了一条跑不动的查询 · 写了个宽八倍的指纹)。**这一份必须是量出来的。**
 *
 * ── J-73:读环境变量的写法不止一种,每一种都要有靶子 ──
 *   ① `process.env.FOO`          ② `process.env['FOO']` / `["FOO"]` / 反引号
 *   ③ `const { FOO } = process.env`(含重命名 `{ FOO: x }`)
 *   ④ `process.env[变量]` —— **动态取键,抠不出名字** → 单列「说不清」,点名到行(J-66③ 按最坏那格)
 *   ⑤ 带默认值:`process.env.FOO || 'x'` / `?? 'x'` / 解构默认 `{ FOO = 'x' }`
 *   ⑥ 别名:`const env = process.env` 之后的 `env.FOO`
 *
 * ── J-65③:每个数都要带扫描面 ──
 *   报「这次扫了几个文件 / 下限几个」,对不上就红。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const NAME = '[A-Z][A-Z0-9_]*'
const DOT = new RegExp(`(?:process\\.env|\\benv)\\.(${NAME})`, 'g')
const BRACKET = new RegExp(`(?:process\\.env|\\benv)\\[\\s*['"\`](${NAME})['"\`]\\s*\\]`, 'g')
const DYNAMIC = /(?:process\.env|\benv)\[\s*(?!['"`])([^\]]{1,40})\]/g
const DESTRUCT = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*process\.env/g

/* 🔴 J-61①(数执行不数提及)· **`process.env` 这几个字出现在字符串里,不算读环境变量。**
 *   案底:probe 第一轮就咬红了 —— `const i = 'process.env.FOO_I'` 被数成一个变量。
 *   判法按**位置**:看 `process.env` 那个词本身在不在引号里;
 *   ⚠️ 不能整行剥字符串 —— `process.env['FOO_B']` 的名字**本来就长在字符串里**,剥了就漏。
 */
function inQuote(line, idx) {
  let q = ''
  for (let i = 0; i < idx; i += 1) {
    const c = line[i]
    if (c === '\\') { i += 1; continue }
    if (q) { if (c === q) q = '' } else if (c === "'" || c === '"' || c === '`') q = c
  }
  return Boolean(q)
}
/* 行注释也不算(块注释由调用方剥) */
const stripLineComment = (line) => {
  /* 🔴 要找的是**第一个不在引号里**的 `//`,不是第一个 `//` ——
     `const n = "http://x" // …` 那一行,第一个 `//` 长在字符串里(probe 当场咬红)。 */
  for (let i = line.indexOf('//'); i >= 0; i = line.indexOf('//', i + 1)) {
    if (!inQuote(line, i)) return line.slice(0, i)
  }
  return line
}

/** 这一行里,这个名字后面紧跟着什么样的兜底。
 *  🔴 **「兜底成空」不是默认值** —— `|| ''` / `|| null` / `|| undefined` / `|| 0` 的意思是
 *  「没配就拿不到东西」,那一段功能**照样是死的**,只是不报错。
 *  把它算成「可选」是**把「没配就不工作」说成了「没配也没关系」** ——
 *  而这份清单正是给店主核 Railway 用的,错在这一格,她会以为那几个微信/企微变量可以不设。
 *  所以分三种:`none`(没兜底)· `empty`(兜底成空)· `real`(兜底成一个能用的默认值)。 */
const fallbackKind = (line, name) => {
  const re = new RegExp(`(?:process\\.env|\\benv)(?:\\.${name}|\\[\\s*['"\`]${name}['"\`]\\s*\\])\\s*(?:\\|\\||\\?\\?)\\s*(.{0,24})`)
  const m = re.exec(line)
  if (!m) {
    const d = new RegExp(`\\b${name}\\s*=\\s*(['"\`][^'"\`]*['"\`]|\\d+)`).exec(line)
    if (d && /=\s*process\.env/.test(line)) return /^(''|""|``|0)$/.test(d[1]) ? 'empty' : 'real'
    return 'none'
  }
  const tail = m[1].trim()
  /* 🔴 **兜底到另一个环境变量 = 别名对,不是「有默认值」。**
   *   案底(现测):`process.env.WECHAT_MINI_APPID || process.env.WX_MINI_APPID || ''`
   *   —— 前者被判成「可选」、后者被判成「功能必需」,**同一件事被拆进两格**。
   *   店主拿着这张表去核 Railway,会以为前者可以不设。 */
  if (/^(?:process\.env|\benv)\./.test(tail)) return 'alias'
  return /^(''|""|``|null\b|undefined\b|0\b|\[\]|\{\})/.test(tail) ? 'empty' : 'real'
}

/** 这一行里,`name` 兜底到了哪个别名(取不到回空串) */
export function aliasOf(line, name) {
  const m = new RegExp(
    `(?:process\\.env|\\benv)(?:\\.${name}|\\[\\s*['"\`]${name}['"\`]\\s*\\])\\s*(?:\\|\\||\\?\\?)\\s*(?:process\\.env|env)\\.([A-Z][A-Z0-9_]*)`).exec(line)
  return m ? m[1] : ''
}

/* 🔴 **比较式使用不是「必需」** —— `process.env.X === 'keyword' ? a : b` 这种,
 *   不设它只是走另一支,**没有任何东西会坏**。把它算成「功能必需」,
 *   会让店主以为 Railway 上少了它就出事。(现测这一类有 AI_GATE / AI_REQUIRE_REAL / AI_ENABLE_THINKING 等) */
const isCompare = (line, name) => new RegExp(
  `(?:process\\.env|\\benv)(?:\\.${name}|\\[\\s*['"\`]${name}['"\`]\\s*\\])\\s*(?:===|!==|==|!=)`).test(line)

export function scanFile(src, rel) {
  const lines = src.split('\n')
  const out = { names: new Map(), dynamic: [] }
  const add = (name, i, line, fb) => {
    if (!out.names.has(name)) out.names.set(name, { 出现: [], 全有真兜底: true, 有空兜底: false })
    const rec = out.names.get(name)
    rec.出现.push({ 文件: rel, 行: i + 1, 兜底: fb, 文: line.trim().slice(0, 100) })
    if (fb === 'alias') { rec.别名 = rec.别名 || aliasOf(line, name) }
    if (fb !== 'real' && fb !== 'compare') rec.全有真兜底 = false
    if (fb === 'empty') rec.有空兜底 = true
  }
  lines.forEach((raw, i) => {
    const line = stripLineComment(raw)
    for (const re of [DOT, BRACKET]) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(line))) { if (!inQuote(line, m.index)) add(m[1], i, line, isCompare(line, m[1]) ? 'compare' : fallbackKind(line, m[1])) }
    }
    DESTRUCT.lastIndex = 0
    let d
    while ((d = DESTRUCT.exec(line))) {
      for (const piece of d[1].split(',')) {
        const n = piece.trim().split(':')[0].split('=')[0].trim()
        if (new RegExp(`^${NAME}$`).test(n)) add(n, i, line, /=/.test(piece.split(':').pop() || '') ? 'real' : 'none')
      }
    }
    DYNAMIC.lastIndex = 0
    let dy
    while ((dy = DYNAMIC.exec(line))) if (!inQuote(line, dy.index)) out.dynamic.push({ 文件: rel, 行: i + 1, 键: dy[1].trim(), 文: line.trim().slice(0, 100) })
  })
  return out
}

const walk = (root, rel, out = [], pred = () => true) => {
  let es = []
  try { es = readdirSync(join(root, rel), { withFileTypes: true }) } catch { return out }
  for (const e of es) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) walk(root, p, out, pred)
    else if (pred(p)) out.push(p)
  }
  return out
}

/** 🔴 生产运行面 = **从 `local-server.mjs` 顺着 import 走得到的那些模块**,不是「apps/api 下非测试的全部」。
 *  案底(现测):`apps/api/e2e-stress-test.mjs` 是压测脚本,**线上根本不跑它**,
 *  而它读的 `API_BASE` 被算进了「生产功能必需」—— 那会让店主去 Railway 上找一个根本不需要的变量。
 *  改成**按可达性算**:从入口出发,`import`/`await import` 逐层跟,跟到不动为止。 */
export function prodFiles(root) {
  const seen = new Set()
  const queue = ['apps/api/local-server.mjs']
  while (queue.length) {
    const f = queue.shift()
    if (seen.has(f)) continue
    let src = ''
    try { src = readFileSync(join(root, f), 'utf8') } catch { continue }
    seen.add(f)
    for (const m of src.matchAll(/(?:from|import\()\s*['"`](\.\/[^'"`]+\.mjs)['"`]/g)) {
      queue.push(`apps/api/${m[1].replace(/^\.\//, '')}`)
    }
  }
  return [...seen].sort()
}
/** 全仓面 = 再加上 tools / 根脚本 —— 它们**不在生产上跑**,单独一栏 */
export const otherFiles = (root) => [
  ...walk(root, 'tools', [], (p) => /\.(mjs|cjs|sh)$/.test(p)),
  ...walk(root, 'apps/web', [], (p) => /\.js$/.test(p)),
  ...walk(root, '', [], (p) => /^[^/]+\.command$/.test(p)),
]

export function inventory(root, files) {
  const all = new Map()
  const dynamic = []
  for (const f of files) {
    let src = ''
    try { src = readFileSync(join(root, f), 'utf8') } catch { return { err: `读不了 ${f}` } }
    const r = scanFile(src, f)
    for (const [n, rec] of r.names) {
      if (!all.has(n)) all.set(n, { 出现: [], 全有真兜底: true, 有空兜底: false })
      const a = all.get(n)
      a.出现.push(...rec.出现)
      if (!rec.全有真兜底) a.全有真兜底 = false
      if (rec.有空兜底) a.有空兜底 = true
      if (rec.别名 && !a.别名) a.别名 = rec.别名
    }
    dynamic.push(...r.dynamic)
  }
  return { all, dynamic, 扫了: files.length }
}

/* ══ 分类 ══
 * 🔴 **不许猜。** 每一格都要有机械依据;依据取不到的一律进「说不清」。
 */

/** ① 启动必需:这把钥匙走的是 `secret-gate` 那道闸 —— 取不到就 `process.exit(1)`(J-53 fail closed)。
 *  名字不是我列的,是**从那两个闸自己的 `envNames` 里读出来的**(同一把尺子,J-39)。 */
export async function startupFatalNames(root) {
  const names = new Set()
  const mods = ['apps/api/mini-token-secret.mjs', 'apps/api/owner-token.mjs']
  for (const f of mods) {
    const src = readFileSync(join(root, f), 'utf8')
    for (const m of src.matchAll(/envNames:\s*\[([^\]]*)\]|EXPLICIT_ENV_NAMES\s*=\s*\[([^\]]*)\]/g)) {
      for (const p of String(m[1] || m[2] || '').split(',')) {
        const n = p.trim().replace(/^['"`]|['"`]$/g, '')
        if (/^[A-Z][A-Z0-9_]*$/.test(n)) names.add(n)
      }
    }
  }
  return names
}

/* ② 🔴 **必须未设** —— 设了就是洞。具名清单,每条给**代码位置 + 设了会发生什么**。
 *    只许变短;要进新成员必须店主点头。 */
export const MUST_BE_UNSET = [
  { name: 'ALLOW_DEMO_ADMIN_LOGIN', where: 'apps/api/data-scope.mjs:82',
    设了会怎样: '它是演示门的第三道条件(前两道是「环境变量说是生产」与「库域不是 ci/sandbox」)。'
      + '在生产上这两道会先把门关死,所以单设它打不开门;**但在任何被判成 ci/sandbox 的实例上,设它 = 邮箱登录不校验密码即可登入**。'
      + '生产上一律不设 —— 它没有任何正当用途。' },
  { name: 'DEMO_LOGIN', where: '(历史名,现仓已无引用)', 设了会怎样: '旧口径遗留;现在的门只认上面那个,设它无效。留在册里是为了「它要是回来了得有人看见」。' },
]

/* ③ 判一个名字属于哪一格(返回带依据) */
export function classify(name, rec, fatal) {
  if (fatal.has(name)) return { 格: '启动必需', 依据: '走 secret-gate 那道闸:取不到 → `process.exit(1)`(J-53 fail closed)' }
  const must = MUST_BE_UNSET.find((x) => x.name === name)
  if (must) return { 格: '🔴 必须未设', 依据: must.设了会怎样 }
  if (rec.全有真兜底) {
    const cmp = rec.出现.filter((o) => o.兜底 === 'compare').length
    return { 格: '可选',
      依据: cmp === rec.出现.length
        ? `每一处都是**比较式使用**(${cmp} 处)—— 不设只是走另一支,没有东西会坏`
        : `每一处读它都兜底成**一个能用的默认值**或比较式使用(${rec.出现.length} 处)` }
  }
  if (rec.别名) return { 格: '功能必需',
    依据: `它与 \`${rec.别名}\` 是**别名对**(读不到就读那个,两个都没有才是空)—— **两个设一个即可,但不能都不设**` }
  const empty = rec.出现.filter((o) => o.兜底 === 'empty')
  const none = rec.出现.filter((o) => o.兜底 === 'none')
  if (none.length) return { 格: '功能必需', 依据: `有 ${none.length} 处**不带兜底**(首处 ${none[0].文件}:${none[0].行}),不设则那一段拿到 undefined` }
  return { 格: '功能必需', 依据: `每一处都兜底成**空**(${empty.length} 处,首处 ${empty[0].文件}:${empty[0].行})—— **不报错,但那一段功能是死的**` }
}

/* ══ probe(J-73:六种写法各一个靶子,两面)══ */
if (process.argv[1] && process.argv[1].endsWith('env-inventory.mjs')) {
  const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
  if (process.argv.includes('--probe')) {
    const { probe } = await import('./scanner-probe.mjs')
    const names = (t) => [...scanFile(String(t), 'x.mjs').names.keys()]
    const ok = probe('env-inventory · 读环境变量的六种写法', [
      { 样本: 'const a = process.env.FOO_A', 该命中: true },
      { 样本: "const b = process.env['FOO_B']", 该命中: true },
      { 样本: 'const c = process.env[`FOO_C`]', 该命中: true },
      { 样本: 'const { FOO_D } = process.env', 该命中: true },
      { 样本: 'const { FOO_E: renamed } = process.env', 该命中: true },
      { 样本: "const f = process.env.FOO_F || 'x'", 该命中: true },
      { 样本: 'const g = env.FOO_G', 该命中: true },
      /* ══ 反面:形似而非 ══ */
      { 样本: 'const h = obj.FOO_H', 该命中: false },          // 不是 env 上的
      { 样本: "const i = 'process.env.FOO_I'", 该命中: false }, // 字符串里提到(J-61:数执行不数提及)
      { 样本: 'const j = process.environment.FOO_J', 该命中: false },
      { 样本: 'const k = process.env[dynamicKey]', 该命中: false }, // 动态取键抠不出名字 → 进说不清那一格,不算命中
      { 样本: 'const m = 1   // 以前这里读过 process.env.FOO_M', 该命中: false }, // 🔴 行尾注释里提及
      { 样本: 'const n = "http://x" // process.env.FOO_N', 该命中: false },       // 注释判定不许被 // 前的字符串骗了
    ], (t) => names(t).length > 0)
    /* 动态取键要**单独证明它被抓进「说不清」那一格**,不是被漏掉 */
    const dyn = scanFile('const k = process.env[dynamicKey]', 'x.mjs').dynamic
    console.log(`  [说不清那一格] 动态取键现测抓到 ${dyn.length} 处 —— ${dyn.length === 1 ? '✅ 没被漏掉' : '🔴 漏了'}`)
    process.exit(ok && dyn.length === 1 ? 0 : 1)
  }
  const prod = prodFiles(ROOT)
  const other = otherFiles(ROOT)
  const P = inventory(ROOT, prod)
  const O = inventory(ROOT, other)
  const fatal = await startupFatalNames(ROOT)
  console.log(`# 环境变量清单(从代码里量)\n`)
  console.log(`> 🔴 **扫描面**(J-65③):生产运行面 **${P.扫了}** 个模块(**从 \`local-server.mjs\` 顺 import 可达**,不是「apps/api 下全部」)`
    + ` · 其余面 **${O.扫了}** 个(tools / apps/web / 根脚本 —— **不在生产上跑**)`)
  console.log(`> 生产运行面上的变量名 **${P.all.size}** 个 · 动态取键 **${P.dynamic.length}** 处\n`)
  const rows = [...P.all.entries()].map(([n, rec]) => ({ n, rec, ...classify(n, rec, fatal) }))
  const order = { '启动必需': 0, '🔴 必须未设': 1, '功能必需': 2, '可选': 3 }
  rows.sort((a, b) => order[a.格] - order[b.格] || a.n.localeCompare(b.n))
  console.log('| 变量名 | 格 | 依据 | 首处代码位置 | 生产面出现 |')
  console.log('|---|---|---|---|---|')
  for (const r of rows) {
    console.log(`| \`${r.n}\` | ${r.格} | ${r.依据.slice(0, 150)} | \`${r.rec.出现[0].文件}:${r.rec.出现[0].行}\` | ${r.rec.出现.length} 处 |`)
  }
  console.log(`\n## 🔴 说不清(动态取键,抠不出名字)—— ${P.dynamic.length} 处,按 J-66③ 当最坏那格`)
  for (const d of P.dynamic) console.log(`- \`${d.文件}:${d.行}\` 键是 \`${d.键}\` —— ${d.文}`)
  const byBox = {}
  for (const r of rows) byBox[r.格] = (byBox[r.格] || 0) + 1
  const sum = Object.values(byBox).reduce((a, b) => a + b, 0)
  console.log(`\n## 底数闭合(J-48)`)
  console.log(Object.entries(byBox).map(([k, v]) => `${k} ${v}`).join(' · ')
    + ` · 说不清 ${P.dynamic.length} —— 四格合计 ${sum} ≡ 变量名 ${P.all.size} ${sum === P.all.size ? '✅' : '🔴'}`)
}
