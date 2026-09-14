/* 回执引用的评测明细,档案目录里必须真有那个文件(店主 05p 补三,J-30)

   案底是同一件事两次:05l 已经裁过「评测明细不许写 `/tmp`」,
   而 05p 的到底率三跑**又**只留在 `/tmp/br-05p-*.json` ——
   回执上写着 6/6/7、10/10/10、4/6,**明细一份都没入仓**。
   数字没法核,就跟没有这个数一样。

   判据按「回执是怎么写的」来扫:最近改过的几份回执/读版里,
   凡提到 `ai-eval-results/某文件`,那个文件就得在。引了却不在 → 红。

   为什么单独一个文件而不是塞进 `pre-regression.sh` 的 heredoc:
   塞进去试过,`$( )` 里的 heredoc 一旦带**反引号或不配对的括号**,
   bash 仍会去数它们,整个脚本当场语法错(现试三次)。
   判据自己先得跑得起来 —— 这也是「判据也是代码」的一层。 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { probe } from './scanner-probe.mjs'

const DIR = 'handoff'
const SUB = join(DIR, 'ai-eval-results')

const recent = readdirSync(DIR)
  .filter((f) => /^(回执|夜班总结|AI客服准确率).*\.md$/.test(f))
  .map((f) => ({ f, m: statSync(join(DIR, f)).mtimeMs }))
  .sort((a, b) => b.m - a.m)
  .slice(0, 6)
  .map((x) => x.f)

const ghosts = []
let cited = 0
for (const f of recent) {
  const txt = readFileSync(join(DIR, f), 'utf8')
  /* 两种写法都要认(第二种是补出来的:第一版只认带目录前缀的,
     而回执里更常见的是**光写文件名**的清单 —— 那样就从判据面上消失了,
     判据的覆盖面本身也要有判据)。
     ① `ai-eval-results/xxx`;② 反引号里形如 `05p_….json` 的评测件名。 */
  const names = new Set()
  for (const m of txt.matchAll(/(?:handoff\/)?ai-eval-results\/([A-Za-z0-9_\u4e00-\u9fa5.-]+)/g)) names.add(m[1])
  for (const m of txt.matchAll(/`(\d{2}[a-z]_[A-Za-z0-9_\u4e00-\u9fa5.-]+\.(?:json|jsonl|md))`/g)) names.add(m[1])
  for (const raw of names) {
    const name = raw.replace(/[.,。;;:]+$/, '')
    cited += 1
    if (!existsSync(join(SUB, name))) ghosts.push(`${f} → ${name}`)
  }
}

/* 🔴 更要紧的一条:**回执里不许拿 `/tmp` 当证据出处**。
   J-30 的病根不是「文件名写错」,是「明细压根没落仓,回执却引它」——
   而 `/tmp` 会被系统清掉(沙箱库 08-24 就是这么没的),引它等于引一个明天不存在的东西。 */
const tmpCites = []
for (const f of recent) {
  const txt = readFileSync(join(DIR, f), 'utf8')
  for (const m of txt.matchAll(/\/tmp\/[A-Za-z0-9_.*-]+\.(?:json|jsonl|md|log)/g)) tmpCites.push(`${f} → ${m[0]}`)
}
if (tmpCites.length) {
  console.log(`🔴 回执拿 /tmp 当证据出处 ${tmpCites.length} 处(/tmp 会被清掉,引它等于引一个明天不存在的东西):`)
  for (const t of tmpCites) console.log(`   ${t}`)
  process.exit(1)
}

if (ghosts.length) {
  console.log(`🔴 回执引了 ${ghosts.length} 个不存在的评测明细:`)
  for (const g of ghosts) console.log(`   ${g}`)
  process.exit(1)
}
console.log(`✅ 最近 ${recent.length} 份回执共引用 ${cited} 处评测明细,文件都在`)


/* J-58⑤ 自守:核心判定是「这段文字里引没引评测明细文件名」 */
if (process.argv.includes('--probe')) {
  const cite = (t) => [...String(t).matchAll(/(?:handoff\/)?ai-eval-results\/([A-Za-z0-9_\u4e00-\u9fa5.-]+)/g)].length > 0
    || [...String(t).matchAll(/`(\d{2}[a-z]_[A-Za-z0-9_\u4e00-\u9fa5.-]+\.(?:json|jsonl|md))`/g)].length > 0
  probe('eval-citation-check', [
    { 样本: '明细见 handoff/ai-eval-results/07a_matrix.json', 该命中: true },
    { 样本: '明细见 `05p_matrix.jsonl`', 该命中: true },
    { 样本: '这一批没有引用任何评测明细', 该命中: false },
  ], cite)
}
