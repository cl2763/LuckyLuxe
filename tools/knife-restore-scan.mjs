#!/usr/bin/env node
/* J-34 扫描 · **可执行件里不许真的执行 `git checkout --` / `git restore`**
 * (从 `pre-regression.sh` 的 grep 抠出来,店主 07q,2026-09-14)
 *
 * ══ 为什么要从 grep 换成这个 ══
 * 原来那一行是 `grep -rln -e 'git checkout --' -e 'git restore'` —— **认词不认执行**。
 * 现踩:`tools/j62-knife-bench.mjs` 里两处都**不是在执行**:
 *   · 一处是**注释里的案底**(「07m 我用了一次 `git checkout --` 还原」);
 *   · 一处是**报错文案**(拒绝开跑时告诉人「07m 那次就是这么来的」)。
 * 于是**把规矩解释清楚的那段话,自己把规矩顶红了** ——
 * 和 `danger-cmd` 咬住 `echo "…不用 pkill…"` 是同一族(J-49:判据认词不认标记,
 * 就会专门惩罚把话说清楚的那个人)。
 *
 * ══ 现在怎么认 ══
 * **剥注释 → 按位置判引号外** —— 只有落在字符串**外面**的才算在执行。
 * ⚠️ 不能整段剥字符串:`git` 命令的参数本来就住在引号里,剥完就认不出真货了
 *(danger-cmd 那次我先踩过这一跤,把三条真护栏一起判红)。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
/* 具名排除:扫描器自己 + 那条护栏本身(J-61②) */
const SELF = ['tools/knife-restore-scan.mjs', 'tools/pre-regression.sh', 'tools/knife-backup.sh']
/* ⚠️ 这个正则写坏过一次:末尾的 `\b` 跟在 `--` 后面**永远匹配不上**
   (`-` 是非单词字符,后面是空格,边界不成立)—— 刀压根咬不动,而全仓扫出来是「零处」,
   **看起来像干净,其实是瞎的**。是 `--probe` 那条自守当场把它戳穿的。
   **先证刀咬得到,再信它报的 0**(J-58 第四款)。 */
const BAD = /git\s+(checkout\s+--|restore(\s|$))/

const walk = (rel, out = []) => {
  let entries = []
  try { entries = readdirSync(join(ROOT, rel), { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = `${rel}/${e.name}`
    if (e.isDirectory()) walk(p, out)
    else if (/\.(sh|mjs|js|command)$/.test(e.name)) out.push(p)
  }
  return out
}

/** 这个位置在引号里面吗(单/双/反引号,按位置扫) */
function inQuote(line, at) {
  let q = null
  for (let k = 0; k < at; k += 1) {
    const c = line[k]
    if (q) { if (c === q && line[k - 1] !== '\\') q = null } else if (c === '"' || c === "'" || c === '`') q = c
  }
  return Boolean(q)
}

const files = [...walk('tools'), ...walk('apps')]
for (const f of readdirSync(ROOT)) {
  if (f.endsWith('.command')) files.push(f)
}
const hits = []
for (const f of files) {
  if (SELF.includes(f)) continue
  let src = ''
  try { src = readFileSync(join(ROOT, f), 'utf8') } catch { continue }
  src.split('\n').forEach((ln, i) => {
    /* 剥注释(shell `#` / js `//`),**行注释整行去掉** */
    const code = ln.replace(/^\s*(#|\/\/|\*|\/\*).*$/, '')
    let m
    const re = new RegExp(BAD.source, 'g')
    while ((m = re.exec(code))) {
      if (inQuote(code, m.index)) continue        /* 字符串里提到 ≠ 在执行 */
      hits.push(`${f}:${i + 1}  ${ln.trim().slice(0, 90)}`)
      break
    }
  })
}

if (process.argv.includes('--probe')) {
  /* 自守:证明这把刀**认得出真执行、认不出提及**。
     🔴 07y 改:原来是手写的三行 console.log —— 它**不打「该中/不该中」两个数**,
     于是「probe 两面」这条自守判据看不见它(判据三:白名单式,判据自己也要落进白名单)。
     改用共用出口 `scanner-probe.mjs`(代码结构公约④:同一件事已有出口就接上去)。 */
  const { probe } = await import('./scanner-probe.mjs')
  const bites = (l) => { const c = l.replace(/^\s*(#|\/\/|\*|\/\*).*$/, ''); const re = new RegExp(BAD.source, 'g'); let m
    while ((m = re.exec(c))) { if (!inQuote(c, m.index)) return true } return false }
  probe('knife-restore-scan · 还原写法', [
    { 样本: '  git checkout -- apps/web/admin.js', 该命中: true },
    { 样本: "  console.error('别用 git checkout -- 还原')", 该命中: false },
    { 样本: '  // 07m 那次用了 git checkout -- 还原', 该命中: false },
  ], bites)
} else if (hits.length) {
  console.log(hits.join('\n'))
  process.exitCode = 1
} else {
  process.exitCode = 0
}
