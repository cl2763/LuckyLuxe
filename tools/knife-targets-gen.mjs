/* 夜13 §四 · 造病靶子生成器 —— 把「29 个涉钱口」变成造病台吃得下的 TARGETS。
 *
 * 为什么要生成而不是手写:手写 29 个 `{ep, suite, file, needle}` 一是慢,二是**手挑就有口径**
 * (裁 #72:名单不许我手挑)。这里三样都是**算出来的**:
 *   · 口 ← `assert-reads-fact` 的按口聚类(同一把尺子,J-39)
 *   · 落库那一行 ← 用 `readset` 解析到 handler 体,取里面**第一条写库语句**
 *   · 跑哪个套件 ← 挂在这个口上的 A 类断言最多的那个套件
 * 取不到的**单列**,不许猜(J-66③:说不清进最坏那格)。
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handlerBody, stripComments, followCalls, defBodyOf } from './readset.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const serverSrc = readFileSync(join(ROOT, 'apps/api/local-server.mjs'), 'utf8')
const WRITE = /db\.prepare\(\s*(`[^`]*`|'[^']*'|"[^"]*")\s*\)/g
const MUTATING = /^\s*(?:INSERT|UPDATE|DELETE)\b/i

const firstWrite = (code) => {
  WRITE.lastIndex = 0
  let m
  while ((m = WRITE.exec(code))) {
    const lit = m[1].slice(1, -1).trim()
    if (MUTATING.test(lit)) return { quote: m[1].slice(0, 1), lit }
  }
  return null
}

export function proposeTarget(ep, suites) {
  /* `:x` 是聚类时把 `${...}` 归一化留下的痕迹;开头那个是切串留下的,去掉 */
  const path = ep.replace(/^:x/, '').replace(/:x/g, '*')
  const body = handlerBody(serverSrc, path)
  if (!body) return { ep, err: '解析不到 handler(路径形态归一化之后仍对不上)' }
  const code = stripComments(body)
  /* ① 先看 handler 体里有没有直接写库 */
  const direct = firstWrite(code)
  if (direct) {
    return { ep, suite: suites[0], file: 'apps/api/local-server.mjs', 层: 'handler 体内',
      needle: `db.prepare(${direct.quote}${direct.lit.slice(0, 46)}`, sql: direct.lit.slice(0, 80) }
  }
  /* ② 没有就**跟进一层**它调用的本地函数 —— 落库那一行常常在 `createSettlementGroup()` 这种里面。
     跟进用的是 `readset` 那一套(同一把尺子,J-39),不另写一份解析。 */
  const CALL = /(?:^|[^\w.$])([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g
  let c
  const tried = []
  while ((c = CALL.exec(code))) {
    const fn = c[1]
    if (['if', 'for', 'while', 'return', 'json', 'String', 'Number', 'JSON', 'apiError', 'readBody', 'catch', 'switch', 'typeof', 'await'].includes(fn)) continue
    if (tried.includes(fn)) continue
    tried.push(fn)
    const def = defBodyOf(serverSrc, fn)
    if (!def) continue
    const w = firstWrite(stripComments(def))
    if (!w) continue
    return { ep, suite: suites[0], file: 'apps/api/local-server.mjs', 层: `跟进一层 ${fn}()`,
      needle: `db.prepare(${w.quote}${w.lit.slice(0, 46)}`, sql: w.lit.slice(0, 80) }
  }
  return { ep, err: `handler 体内与跟进一层(试了 ${tried.length} 个函数)都没找到写库语句 —— 单列,不猜` }
}

if (process.argv[1] && process.argv[1].endsWith('knife-targets-gen.mjs')) {
  const data = JSON.parse(readFileSync(process.argv[2] || '/tmp/arf2.json', 'utf8'))
  const MONEY = /充值|到账|退款|退卡|结算|支付|收款|付款|储值|券|次卡|核销|提成|工资|定金|冲销|作废|金额|settle|refund|recharge|payment|coupon|timecard|finance|daily-close|membership/i
  const bySuite = {}
  for (const r of data.明细.filter((x) => x.cls === 'A' && x.ep && x.ep !== '(追不到口)')) {
    (bySuite[r.ep] ||= {});
    bySuite[r.ep][r.file] = (bySuite[r.ep][r.file] || 0) + 1
  }
  const eps = data.按口.filter((x) => MONEY.test(x.口) && x.口 !== '(追不到口)').map((x) => x.口)
  const ok = [], bad = []
  for (const ep of eps) {
    const suites = Object.entries(bySuite[ep] || {}).sort((a, b) => b[1] - a[1])
      .map(([f]) => f.replace('apps/api/test-', '').replace('.mjs', ''))
    const t = proposeTarget(ep, suites)
    if (t.err || !suites.length) bad.push({ ...t, err: t.err || '挂不到套件' })
    else ok.push(t)
  }
  console.log(`# 涉钱口 ${eps.length} 个 · 生成得出靶子 **${ok.length}** 个 · 单列 **${bad.length}** 个\n`)
  for (const t of ok) console.log(`✅ ${t.ep}\n   套件 ${t.suite} · ${t.层} · 切:${t.sql}`)
  console.log('')
  for (const t of bad) console.log(`⚠️ ${t.ep} —— ${t.err}`)
  console.log(`\n底数闭合:${ok.length} + ${bad.length} = ${ok.length + bad.length} ≡ ${eps.length} ${ok.length + bad.length === eps.length ? '✅' : '🔴'}`)
}
