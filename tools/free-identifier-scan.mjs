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
  .replace(/`(?:\\.|[^`\\])*`/g, '``')
  .replace(/"(?:\\.|[^"\\])*"/g, '""')
  .replace(/'(?:\\.|[^'\\])*'/g, "''")

/* 认得出的绑定形式:声明 / 参数 / 解构(含嵌套与重命名) */
function boundNames(code) {
  const names = new Set()
  for (const m of code.matchAll(/(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
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
])

export function freeIdentifiers(file) {
  const code = strip(readFileSync(file, 'utf8'))
  const bound = boundNames(code)
  const called = new Set([...code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]))
  return [...called].filter((n) => !bound.has(n) && !GLOBALS.has(n))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = process.argv.slice(2)
  if (!files.length) { console.error('用法:node tools/free-identifier-scan.mjs <文件…>'); process.exit(2) }
  let bad = 0
  for (const f of files) {
    const free = freeIdentifiers(f)
    if (free.length) { bad++; console.error(`❌ ${f}:${free.join(' ')}`) }
    else console.log(`✅ ${f}:无自由标识符`)
  }
  process.exit(bad ? 1 : 0)
}
