#!/usr/bin/env node
/* J-62 第二步:给每一处成功态**追上后端口**,再问「有没有判据碰过那个口」
 * (店主 07l §一 三栏表;仍然**只出清单不修**)
 *
 * 三栏怎么来的:
 *   ①界面上说了什么 —— 扫描器抠出来的那一行原文
 *   ②它承诺的事落在哪 —— 从这一行**往上找最近的一次接口调用**(回执总跟在动作后面),
 *     再拿那条路径去后端找它写哪张表
 *   ③有没有判据验它真落了 —— 全仓 `test-*.mjs` 里有没有人**真调**过那条路径
 *     (J-61:数调用不数提及 —— 只出现在注释/字符串表里的不算)
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const raw = JSON.parse(execSync('node tools/success-state-scan.mjs --json', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64e6 }))

/* ── ② 往上找最近一次接口调用 ── */
/* 先试**带路径参数**的包装器(adminPost('/x')、api.post('/x')…),再退回只有方法名的 */
const CALL_PATH = /(?:api\.\w+|apiFetch|request|fetch|adminPost|adminGet|adminPut|adminDel|post|put|del)\(\s*[`'"]([^`'"]+)/
const CALL = /(?:api\.(\w+)|request\(\s*['"`]([^'"`]+)|apiFetch\(\s*['"`]([^'"`]+)|fetch\(\s*[`'"]([^`'"]+)|\bpost\(\s*['"`]([^'"`]+)|\bput\(\s*['"`]([^'"`]+)|\bdel\(\s*['"`]([^'"`]+))/
const srcCache = new Map()
const linesOf = (f) => {
  if (!srcCache.has(f)) srcCache.set(f, readFileSync(join(ROOT, f), 'utf8').split('\n'))
  return srcCache.get(f)
}
/* api.js 里 `xxx: (…) => request('/path')` 形态,把方法名映射到路径 */
const apiMap = {}
for (const f of ['miniprogram/utils/api.js', 'apps/web/api.js']) {
  let src = ''
  try { src = readFileSync(join(ROOT, f), 'utf8') } catch { continue }
  const re = /(?:async\s+)?function\s+(\w+)[\s\S]{0,600}?request\(\s*[`'"]([^`'"]+)/g
  let m
  while ((m = re.exec(src))) if (!apiMap[m[1]]) apiMap[m[1]] = m[2]
}

/* ── ③ 判据面:全仓 test-*.mjs 里**真调**过的路径 ── */
const testDir = join(ROOT, 'apps/api')
const testSrc = readdirSync(testDir).filter((b) => /^test-.*\.mjs$/.test(b))
  .map((b) => readFileSync(join(testDir, b), 'utf8')).join('\n')
/* 🔴 09-14 这里返工过一次,原因记着:
   第一版拿正则去抠 `fetch(...)` 里的 URL 再做集合比对 —— **假阴一片**
   (`/my/stored-value/confirm` 明明被 test-noshow-aftersales 测了 5 次,却报「没判据」)。
   出清单的尺子自己不准,清单就是废的。改成**逐条拿路径去搜**,并且:
     · 路径里的 `${...}` 当通配符(测试里那一段是别的变量名)
     · 命中行是注释的不算(J-61:数调用不数提及)
   假阴比假阳更危险:假阳会被我逐条核掉,假阴**根本不会出现在清单上**。 */
const testFiles = testSrc.split('\n')
const judged = (path) => {
  if (!path || !path.startsWith('/')) return false
  /* 顺序要紧:**先**把 `${...}` 换成哨兵,**再**整体转义,最后哨兵放成通配。
     第一版把两步倒过来做 —— `${...}` 里的 `}` 先被转义了,通配那一步就再也认不出它,
     于是 `/bookings/${encodeURIComponent(id)}/cancel` 这种带函数调用的路径全数假阴。 */
  const SENT = '\u0001'
  const pat = path.replace(/\?.*$/, '')
    .replace(/\$\{[^}]*\}/g, SENT)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .split(SENT).join('[^`\'"]*')
  const re = new RegExp(pat)
  return testFiles.some((l) => re.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l))
}

/* 假阳过滤:状态字典 / 只读标签 —— 它们是**陈述**不是**回执**,不属于 J-62
   (J-62 管的是「点了之后界面说成了」,不管「这条数据的状态叫什么」) */
const NOT_RECEIPT = [
  { re: /^\s*const\s+\w+\s*=\s*\{[^}]*:\s*['"][^'"]*['"]\s*,/, why: '状态字典:一行里好几个状态词并列,是数据字典不是回执' },
  { re: /^\s*(\/\/|\*|\/\*)/, why: '注释' },
  { re: /^\s*[\w.'"\[\]]+\s*:\s*['"`][^'"`]*['"`]\s*,?\s*$/, why: '文案表条目:是词条定义,回执在用它的地方算' },
]

const rows = []
for (const h of raw.明细) {
  const self = linesOf(h.file)[h.line - 1] || ''
  const skip = NOT_RECEIPT.find((n) => n.re.test(self))
  if (skip) { rows.push({ ...h, path: '', judged: false, notReceipt: skip.why }); continue }
  const L = linesOf(h.file)
  let path = ''
  for (let i = h.line - 1; i >= Math.max(0, h.line - 45) && !path; i -= 1) {
    const mp = CALL_PATH.exec(L[i] || '')
    if (mp && mp[1].startsWith('/')) { path = mp[1]; break }
    const m = CALL.exec(L[i] || '')
    if (!m) continue
    const name = m[1]
    path = name ? (apiMap[name] || `api.${name}()`) : (m[2] || m[3] || m[4] || m[5] || m[6] || m[7] || '')
  }
  rows.push({ ...h, path, judged: judged(path) })
}

const MONEY = /充值|到账|退款|退卡|结算|支付|收款|付款|储值|券|次卡|核销|提成|工资|定金|冲销|作废|金额/
const CUSTOMER = /小程序顾客端|网页顾客端/
for (const r of rows) {
  r.money = MONEY.test(r.text) || MONEY.test(r.path || '')
  r.custVisible = CUSTOMER.test(r.surface)
}
const score = (r) => (r.custVisible ? 2 : 0) + (r.money ? 1 : 0)
rows.sort((a, b) => score(b) - score(a) || Number(a.judged) - Number(b.judged) || a.file.localeCompare(b.file))

const receipts = rows.filter((r) => !r.notReceipt)
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2))
} else {
  const n = (f) => receipts.filter(f).length
  console.log(`形态命中 ${raw.命中次数} 次 · 去重 ${raw.去重处数} 处 · 判成**回执**的 **${receipts.length}** 处(另 ${rows.length - receipts.length} 处是状态字典/文案表条目/注释,不算回执)`)
  console.log(`  顾客能看见 ${n((r) => r.custVisible)} · 涉及钱 ${n((r) => r.money)} · 两者都是 ${n((r) => r.custVisible && r.money)}`)
  console.log(`  追得到后端口 ${n((r) => r.path)} · 追不到(纯前端/纯展示)${n((r) => !r.path)}`)
  console.log(`  🔴 有回执但**判据没碰过那个口** ${n((r) => r.path && !r.judged)} 处`)
}
