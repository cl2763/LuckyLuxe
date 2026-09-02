/* 原生对话框刀(D104,店主 03t §二第 4 条,2026-09-03 落)

   ══ 案由 ══
   网页端还在用浏览器原生 `prompt / confirm / alert`:样式两套、阻塞主线程、手机上表现不一致,
   而且长在**工资发放、考勤改时刻、账本冲销、日结重开、顾客取消预约、员工密码重置**这些要紧动作上。

   ══ 我在这件事上连报错三次条数,根因是判据自己 ══
   ① 第一版报「10 处」:正则写了排除前导 `\w` 或点号,把 `window.prompt(...)` **整类**漏掉;
   ② 第二版报「25 处」:形态补齐了,但**行号与条数仍是错的**;
   ③ 真底数是 **34 处**(admin.js 28 + 其余 6)。

   ②③ 之间那个错更要命,而且与本刀直接相关 ——
   **我的剥注释用了 `\s` 星号,而 `\s` 包含换行**:`^` + `\s`星号 + 双斜杠
   会把前面的空行连同换行一起吃掉。现测 `admin.js` 剥完 **8551 → 8504,少 47 行**,
   于是「第几行命中」全部错位,我按错位的行号去改,还改坏过一个 IIFE
   (`(() => {…})()` 被加成 `async`,`node --check` 照样绿 —— **语法绿 ≠ 语义对**)。
   本刀的剥注释因此**必须**用「除换行外的空白」,并且块注释置空时保住换行。

   ══ 判据 ══
   白名单式:全仓 `apps/web/*.js` **零原生对话框**;确有理由的逐条写(现在白名单为空)。
   机制定义 = 「调用浏览器原生对话框」,**裸调用与 `window.` 前缀都算** —— 认机制不认长相。
   替代出口:`apps/web/ui-dialog.js` 的 `UIDialog.text / confirm / alert`(Promise 版)。 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
let checks = 0
const fails = []
const check = (name, cond, detail = '') => {
  checks += 1
  if (cond) console.log(`ok ${checks} - ${name}`)
  else { fails.push(name); console.log(`not ok ${checks} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

const tracked = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z', 'apps/web'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter((f) => f.endsWith('.js') && !f.endsWith('ui-dialog.js'))

/* 机制定义:调用浏览器原生对话框 —— 裸调用 **或** window. 前缀,两种都是同一件事 */
const NATIVE = /(?<![\w.])(?:window\s*\.\s*)?(prompt|confirm|alert)\s*\(/g

const scan = (src) => {
  const out = []
  src.split('\n').forEach((l, i) => {
    const t = l.trim()
    if (t.startsWith('//') || t.startsWith('*')) return          // 整行注释不算
    NATIVE.lastIndex = 0
    for (const m of l.matchAll(NATIVE)) {
      if (l.slice(Math.max(0, m.index - 24), m.index).includes('UIDialog')) continue  // 已换成出口的
      out.push({ line: i + 1, kind: m[1], text: t.slice(0, 70) })
    }
  })
  return out
}

const hits = []
for (const f of tracked) {
  let src = ''
  try { src = readFileSync(join(ROOT, f), 'utf8') } catch { continue }
  for (const h of scan(src)) hits.push({ file: f, ...h })
}

/* 白名单:确有理由留原生控件的逐条写(现在为空 —— 一处都不该有) */
const ALLOW = {}
const ALLOW_CAP = Object.keys(ALLOW).length
const bad = hits.filter((h) => !ALLOW[`${h.file}:${h.line}`])

check(`① 白名单式:${tracked.length} 个 apps/web/*.js **零原生对话框**(裸调用与 window. 前缀都算);`
  + '替代出口 = apps/web/ui-dialog.js 的 UIDialog.text/confirm/alert',
bad.length === 0, bad.slice(0, 8).map((h) => `${h.file}:${h.line}[${h.kind}] ${h.text}`).join(' | '))

check(`①b 白名单棘轮 ≤ ${ALLOW_CAP}(现为空;要加必须写理由并报批)`,
  Object.keys(ALLOW).length <= ALLOW_CAP, String(Object.keys(ALLOW).length))

/* ② 出口在,且三个方法齐 */
const dlg = readFileSync(join(ROOT, 'apps/web/ui-dialog.js'), 'utf8')
check('② 替代出口在场且三件齐(text / confirm / alert),并挂在 window.UIDialog 上',
  /window\.UIDialog\s*=/.test(dlg) && /function text\(/.test(dlg)
  && /function confirm\(/.test(dlg) && /function alert\(/.test(dlg), '')
const admin = readFileSync(join(ROOT, 'apps/web/admin.html'), 'utf8')
const index = readFileSync(join(ROOT, 'apps/web/index.html'), 'utf8')
check('②b 两端页面都挂了它(商家端 admin.html · 顾客端 index.html)—— 只在一端挂等于另一端点了没反应',
  /ui-dialog\.js/.test(admin) && /ui-dialog\.js/.test(index), '')

/* ③ 零命中先证刀能咬:四种写法各一个已知阳性 + 一个反向守 */
const CANARY = [
  "  const v = prompt('x')",
  "  if (!confirm('x')) return",
  "  window.alert('x')",
  "  const y = window.prompt('x', '')",
]
const bitten = CANARY.map((c) => scan(c).length)
check('③ 🔴 零命中先证刀能咬:裸 prompt / 裸 confirm / window.alert / window.prompt 四种写法各一个已知阳性,'
  + '必须全被咬中(第一版正则就是漏了 window. 前缀那两类,少报了 15 处)',
bitten.every((n) => n === 1), JSON.stringify(bitten))
check('③b 反向守:换成出口的写法**不许**被咬中(判据要能分出换没换,不是见 confirm 就红)',
  scan("  if (!await window.UIDialog.confirm('x')) return").length === 0, '')

/* ④ 剥注释这件事本身:证明「除换行外的空白」与「\\s」在真文件上真的不同 —— 不是理论担心 */
const raw = readFileSync(join(ROOT, 'apps/web/admin.js'), 'utf8')
const keepNl = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/^[^\S\n]*\/\/.*$/gm, '')
const eatNl = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(new RegExp('^\\s*//.*$', 'gm'), '')
const nRaw = raw.split('\n').length
const nKeep = keepNl(raw).split('\n').length
const nEat = eatNl(raw).split('\n').length
check(`④ 🔴 剥注释保行号:正确写法剥完仍 ${nKeep} 行(原文 ${nRaw});`
  + `用「\\s 星号」那种写法只剩 ${nEat} 行 —— 少 ${nRaw - nEat} 行,按它算的行号全错(我因此连报错三次)`,
nKeep === nRaw && nEat < nRaw, JSON.stringify({ raw: nRaw, keep: nKeep, eat: nEat }))

console.log(`\n[原生对话框] apps/web/*.js ${tracked.length} 个 · 残留 ${hits.length} 处(改前 34)· 白名单 ${Object.keys(ALLOW).length}`)
if (fails.length) { console.error(`\n❌ test-native-dialog ${fails.length}/${checks} 项未过`); process.exit(1) }
console.log(`\n✅ test-native-dialog 通过 ${checks} 项`)
