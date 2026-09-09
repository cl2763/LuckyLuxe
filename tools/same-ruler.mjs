#!/usr/bin/env node
/* J-39「同一把尺子」(店主 06a §二 立)· 比两份带数的报告之前,先比**产出它们的那把刀**
 *
 * 案底是我自己:回执把「修前 237(3:1 那把尺子量的)」和「修后 0(2:1 这把尺子量的)」并排放,
 * 还写了「同一把修好的刀量的」——**两份红榜自己的抬头就否掉了这句话**。
 * 店主的话:「问题不在选 2:1,在于拿 3:1 的旧数和 2:1 的新数并排放,还写『同一把尺子』。」
 * 归族 J-38:**图要带时刻,数要带尺子。**
 *
 * 这把刀读两份(或多份)报告抬头里那一行「产出这份数的刀:… @ <提交号>」:
 *   · 提交号不一致 → 🔴 不许拿这两份的数并排比,要么重量一次,要么写清「不同尺」;
 *   · 任一份带 `+dirty`(刀当时有未提交改动)→ 🔴 那一份跟历史比不了,重跑一次再比;
 *   · 抬头里根本没有这一行 → 🔴 老报告没带尺子,补跑。
 *
 * 用法:node tools/same-ruler.mjs <报告A.md> <报告B.md> [...]
 */
import { readFileSync, existsSync } from 'node:fs'

const files = process.argv.slice(2)
if (files.length < 2) { console.error('用法: node tools/same-ruler.mjs <报告A.md> <报告B.md> [...]'); process.exit(2) }

const RULER = /产出这份数的刀[::]\s*`?([^`\n]+?)`?\s*@\s*([0-9a-f]{7,40}(?:\+dirty[^\n)]*)?)/
const CODE = /被测代码[::]\s*`?([^`\n]+)`?/

let n = 0
const fails = []
const check = (name, ok, detail = '') => {
  n += 1
  if (ok) console.log(`ok ${n} - ${name}`)
  else { fails.push(name); console.log(`not ok ${n} - ${name}${detail ? ` :: ${detail}` : ''}`) }
}

const seen = []
for (const f of files) {
  if (!existsSync(f)) { check(`${f} 在`, false, '找不到这份报告'); continue }
  const src = readFileSync(f, 'utf8')
  const m = src.match(RULER)
  const c = src.match(CODE)
  check(`${f}:抬头带着「产出这份数的刀」那一行`, Boolean(m),
    m ? '' : '没有这一行 —— 老报告没带尺子,补跑一次再比')
  if (!m) continue
  const rev = m[2]
  check(`${f}:刀是干净的(带 +dirty 就跟历史比不了)`, !/\+dirty/.test(rev), rev)
  seen.push({ f, tool: m[1].trim(), rev, code: c ? c[1].trim() : '(没写被测代码版本)' })
  console.log(`   ${f}\n     刀 ${m[1].trim()} @ ${rev} · 被测 ${c ? c[1].trim() : '(没写)'}`)
}

if (seen.length >= 2) {
  const revs = [...new Set(seen.map((x) => `${x.tool}@${x.rev}`))]
  check(`② 这 ${seen.length} 份报告出自**同一把尺子**(不同尺不许并排比数)`,
    revs.length === 1, `出现 ${revs.length} 种:${revs.join(' / ')}`)
  const codes = [...new Set(seen.map((x) => x.code))]
  check('②b 被测代码版本**互不相同**(都一样就不是「修前 vs 修后」,是同一份量了两遍)',
    codes.length === seen.length, `被测版本:${codes.join(' | ')}`)
}

if (fails.length) { console.error(`\n❌ same-ruler ${fails.length}/${n} 条未过 —— 这几个数不许并排比`); process.exit(1) }
console.log(`\n✅ same-ruler ${n} 条全过:同一把尺子、量的是不同版本的代码,可以并排比`)
