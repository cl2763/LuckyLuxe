#!/usr/bin/env node
/* 搬迁后必跑:找出「调用了但本文件没有、也没从依赖里解构进来」的标识符。

   ══ 为什么要有它 ══
   从 local-server.mjs 往外搬模块,**漏注一个依赖不会当场报错** —— 它是
   `undefined is not a function`,要等顾客真发出那句话才炸(静默失败器族)。
   04c 漏了 `notifyWecomStaff`、04f-1 漏了 `tenantKbFacts`,都是这么栽的。

   ══ 尺子自身的缺陷史(留着当案底)══
   第一版用 `^\s{4}(\w+)[,:]` 认解构名,**一行写两个名字就只认第一个** ——
   于是 `flattenPersistedQuoteState` 等 5 个明明注进去了却被报成自由标识符。
   误报和漏报一样有害:它训练人无视这把刀。现在改成先框出解构块、再逐名取。 */

import { readFileSync } from 'node:fs'

const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '')
  /* 🔴 正则字面量也要剥:`/\b(no|not)\s+/` 里的 `\b(` 长得跟「调用函数 b」一模一样,
     不剥就会把 `b` 报成自由标识符(05d 现测踩到)。剥在去注释之后、去字符串之前 ——
     顺序反了会把字符串里的斜杠当成正则开头。 */
  .replace(/(^|[=(,:[!&|?{;+\-*%<>~^]\s*)\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\/[gimsuy]*/g, '$1/RE/')
  .replace(/`(?:\\.|[^`\\])*`/g, '``')
  .replace(/"(?:\\.|[^"\\])*"/g, '""')
  .replace(/'(?:\\.|[^'\\])*'/g, "''")

/* 认得出的绑定形式:声明 / 参数 / 解构(含嵌套与重命名) */
function boundNames(code) {
  const names = new Set()
  for (const m of code.matchAll(/(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
  /* 🔴 import 绑定也算数(05d 补):`import { compactIntentText } from './x.mjs'` 没有 `=`,
     下面那条解构规则匹配不到 —— 于是**明明 import 进来了却被报成自由标识符**。
     误报和漏报一样有害:它训练人无视这把刀(这已经是同一把刀的第三次误报了)。 */
  for (const m of code.matchAll(/import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from/g)) {
    if (m[1]) names.add(m[1])
    for (const piece of (m[2] || '').split(',')) {
      const t = piece.includes(' as ') ? piece.split(' as ').pop() : piece
      const n = t.trim()
      if (/^[A-Za-z_$][\w$]*$/.test(n)) names.add(n)
    }
  }
  for (const m of code.matchAll(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
  /* 🔴 对象字面量里的**方法简写**(`{ check(a, b) { … } }`)也是绑定,不是调用。
     05g 现测:`createFactGate` 返回的 `{ check(reply, ruleSource) {} }` 被报成自由标识符。
     这是这把刀的**第四次误报** —— 前三次:一行两个解构名 / 正则 `\b(` / import 绑定。
     误报四次说明它该有自己的套件(登记待排,J-11 已记),不能只靠我每次手动自证。 */
  for (const m of code.matchAll(/^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm)) names.add(m[1])
  /* 解构块:`{ ... }` 里逗号分隔的每个名字都算绑定;`a: b` 取 b */
  for (const m of code.matchAll(/\{([^{}]*)\}\s*=/g)) {
    for (const piece of m[1].split(',')) {
      const t = piece.includes(':') ? piece.split(':').pop() : piece
      const n = t.replace(/=.*/, '').trim()
      if (/^[A-Za-z_$][\w$]*$/.test(n)) names.add(n)
    }
  }
  /* 函数参数(含解构参数里的名字) */
  for (const m of code.matchAll(/function\s*[\w$]*\s*\(([^)]*)\)/g)) {
    for (const n of m[1].match(/[A-Za-z_$][\w$]*/g) || []) names.add(n)
  }
  for (const m of code.matchAll(/\(([^)]*)\)\s*=>/g)) {
    for (const n of m[1].match(/[A-Za-z_$][\w$]*/g) || []) names.add(n)
  }
  for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) names.add(m[1])
  return names
}

const GLOBALS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'await', 'new', 'throw', 'do',
  'String', 'Number', 'Boolean', 'Array', 'Object', 'Error', 'RegExp', 'JSON', 'Set', 'Map',
  'Math', 'Date', 'Promise', 'parseInt', 'parseFloat', 'isNaN', 'require', 'console', 'process',
  'decodeURIComponent', 'encodeURIComponent', 'decodeURI', 'encodeURI', 'structuredClone', 'BigInt', 'Symbol',
  /* 🔴 07i 补:这几个是 **Node 18+ 的真全局**,名单里漏了。
     漏掉真全局 = **误报**,而这份文件抬头自己写着「噪音淹掉信号,比不扫还坏」——
     所以补齐是修正误报,不是放宽判据(补进来的每一个都要真的是全局,不许拿它当豁免口)。
     现测:`node -p "typeof fetch"` → function。 */
  'fetch', 'URL', 'URLSearchParams', 'AbortController', 'Buffer',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'TextEncoder', 'TextDecoder',
])

/* 🔴 适用面:**刚搬出来的小模块**。
   这把刀做的是正则级近似分析,不做真作用域、不解析 SQL 字符串里的标识符。
   拿它扫 `local-server.mjs` 这种 18,000 行的巨型文件,会吐出一屏 `COUNT` / `VALUES` / `tenants`
   之类的 SQL 关键词当「自由标识符」—— 噪音淹掉信号,比不扫还坏(05e 现测)。
   所以超过 2,000 行直接拒跑并说明理由,免得有人(包括我)把那一屏噪音当结论。 */
const MAX_LINES = 2000

export function freeIdentifiers(file) {
  const raw = readFileSync(file, 'utf8')
  const lines = raw.split('\n').length
  if (lines > MAX_LINES) {
    throw new Error(`${file} 有 ${lines} 行,超过 ${MAX_LINES} —— 这把刀只适用于刚搬出来的小模块,`
      + '扫巨型文件会把 SQL 关键词当成自由标识符,噪音淹掉信号。请只扫本批新建/搬出的模块。')
  }
  const code = strip(raw)
  const bound = boundNames(code)
  const called = new Set([...code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]))
  return [...called].filter((n) => !bound.has(n) && !GLOBALS.has(n))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = process.argv.slice(2)
  if (!files.length) { console.error('用法:node tools/free-identifier-scan.mjs <文件…>'); process.exit(2) }
  let bad = 0
  for (const f of files) {
    try {
      const free = freeIdentifiers(f)
      if (free.length) { bad++; console.error(`❌ ${f}:${free.join(' ')}`) }
      else console.log(`✅ ${f}:无自由标识符`)
    } catch (e) { bad++; console.error(`⚠️ ${f}:${e.message}`) }
  }
  process.exit(bad ? 1 : 0)
}
